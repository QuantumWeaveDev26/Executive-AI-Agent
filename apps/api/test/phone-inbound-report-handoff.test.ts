import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import Fastify from 'fastify';
import {phoneInboundWorkflowRoutes} from '../src/routes/phone-inbound-workflow.js';
import {phoneInboundReportRoutes} from '../src/routes/phone-inbound-reports.js';
import {createSarvamInboundService,buildInboundServiceBinding} from '../src/services/phone-sarvam-inbound-service.js';
import {createInboundJournalReportFeed} from '../src/services/phone-inbound-journal-feed.js';
import {projectInboundEvents,type InboundCallEvent,type InboundEventInput} from '../src/services/phone-inbound-events.js';
import type {AuthenticatedScope} from '@thaara/db';

// HTTP/application handoff only. Fake transaction ledger is NOT database/RLS/provider evidence.
const token='synthetic-inbound-report-handoff-token-000000000';
const owner={workspaceId:'w',userId:'u',role:'owner',sessionTokenHash:'synthetic-owner-session'};
const profile={routeId:'handoff',workspaceId:'w',ownerUserId:'u',principalId:'p',revision:1,appId:'synthetic-agent',appVersion:5,deploymentId:'synthetic-inbound',agentPhoneNumber:'+918000000001',maxCallLengthSeconds:300 as const};
const base='/api/v1/connectors/phone/inbound';
const payload=()=>({app_id:profile.appId,app_version:5,deployment_id:profile.deploymentId,interaction_id:'20261104/handoff',user_phone_number:'+919000000001',agent_phone_number:profile.agentPhoneNumber,duration:20,start_datetime:'2026-11-04T00:00:00Z',end_datetime:null,
 final_agent_variables:{customer_name:'Ram',business_type:'Retail',requested_service:'Automation',callback_preference:'yes'},
 interaction_transcript:[{role:'agent',en_text:'Would you like our team to contact you at +919000000001 and discuss a solution for your business?'},{role:'user',en_text:'Yes, please.'}]});
async function fixture(options:{failCommit?:boolean;beforeCommit?:()=>Promise<void>}={}){
 let committed:InboundCallEvent[]=[];
 const transactions={withGrant:async(_request:unknown,work:any)=>{
  const staged=structuredClone(committed);
  const result=await work({...buildInboundServiceBinding(profile),tokenHash:createHash('sha256').update(token).digest('hex'),activeOwner:true,revokedAt:null,expiresAt:'2026-11-05T00:00:00Z',operations:['callback','completion']},{query:async(_sql:string,args:string[])=>{
   const event=JSON.parse(args[0]!) as InboundEventInput,old=staged.find(e=>e.eventId===event.eventId);
   if(old&&old.sourceDigest!==event.sourceDigest)throw Error('Synthetic conflict');
   if(!old)staged.push({...event,sequence:staged.length+1});
   return {rows:[{receipt:{saved:true,events:structuredClone(staged),duplicate:!!old}}]};
  }});
  await options.beforeCommit?.();if(options.failCommit)throw Error('PRIVATE synthetic commit failure');
  committed=staged;return result;
 }};
 const service=createSarvamInboundService({profile,transactions,now:()=>Date.parse('2026-11-04T00:01:00Z')});
 const rows=(scope:AuthenticatedScope)=>scope.workspaceId===owner.workspaceId&&scope.userId===owner.userId&&committed.length?[projectInboundEvents(owner,committed)]:[];
 const repository={list:vi.fn(async(scope:AuthenticatedScope)=>rows(scope)),read:vi.fn(async(scope:AuthenticatedScope,id:string)=>rows(scope).find(r=>r.id===id)??null)};
 const feed=createInboundJournalReportFeed({repository}),app=Fastify({logger:false});
 app.decorate('requireAuth',async(request:any,reply:any)=>{
  // Fixed synthetic sessions; header values never become production authorization.
  const session=request.headers['x-test-session'];if(!['owner','foreign','member'].includes(session))return reply.code(401).send({error:'Unauthorized'});
  request.scope={...owner,...(session==='foreign'?{workspaceId:'other'}:{}),...(session==='member'?{role:'member'}:{})};
 });
 await app.register(async child=>{await phoneInboundWorkflowRoutes(child,service);await phoneInboundReportRoutes(child,undefined,feed);},{prefix:'/api/v1'});
 return {app,repository,events:()=>committed,post:(phase:string,body:unknown)=>app.inject({method:'POST',url:base+'/'+phase+'/'+profile.routeId,headers:{authorization:'Bearer '+token},payload:body as any}),get:(suffix='',session='owner')=>app.inject({url:base+'/reports'+suffix,headers:{'x-test-session':session}})};
}
it('hands a committed callback to the owner list and Details without leaking full contact data in summaries',async()=>{
 const f=await fixture();try{
  const saved=await f.post('callback',payload());expect(saved.statusCode).toBe(200);expect(saved.json().action).toBe('callback_requested');expect(saved.body).not.toContain('Ram');
  const list=await f.get();expect(list.statusCode).toBe(200);expect(list.json().reports).toHaveLength(1);expect(list.body).not.toContain('+919000000001');expect(list.headers['cache-control']).toBe('no-store');
  const detail=await f.get('/'+saved.json().reportId);expect(detail.statusCode).toBe(200);expect(detail.json().report).toMatchObject({customerName:'Ram',business:'Retail',serviceNeeded:'Automation',outcome:'callback_requested',appointment:null});
  expect(detail.body).not.toMatch(/sessionTokenHash|ownerUserId|synthetic-owner-session/);
 }finally{await f.app.close();}
});
it('keeps a failed commit out of both acknowledgement and owner reports',async()=>{
 const f=await fixture({failCommit:true});try{const r=await f.post('callback',payload());expect(r.statusCode).toBe(503);expect(r.json().saved).toBe(false);expect(r.body).not.toContain('PRIVATE');expect((await f.get()).json().reports).toEqual([]);}finally{await f.app.close();}
});
it('does not expose a staged callback or acknowledge success before commit completes',async()=>{
 let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
 const f=await fixture({beforeCommit:async()=>{entered();await gate;}});let pending:ReturnType<typeof f.post>|undefined;
 try{let settled=false;pending=f.post('callback',payload());const response=Promise.resolve(pending).then(r=>{settled=true;return r;});await waiting;expect(settled).toBe(false);expect((await f.get()).json().reports).toEqual([]);release();expect((await response).statusCode).toBe(200);expect((await f.get()).json().reports).toHaveLength(1);}finally{release();if(pending)await pending;await f.app.close();}
});
it('reconciles completion and withdrawal into one report without reviving a replayed callback',async()=>{
 const f=await fixture();try{
  const saved=await f.post('callback',payload());const id=saved.json().reportId;
  expect((await f.post('completion',{...payload(),end_datetime:'2026-11-04T00:01:00Z',duration:60})).statusCode).toBe(200);
  const withdrawn={...payload(),interaction_transcript:[{role:'user',en_text:"Please don't call me."}]};expect((await f.post('callback',withdrawn)).json().action).toBe('callback_withdrawn');
  expect((await f.post('callback',payload())).json().action).toBe('callback_withdrawn');expect((await f.get()).json().reports).toHaveLength(1);
  expect((await f.get('/'+id)).json().report.callbackRequestId).toBeNull();expect(f.events()).toHaveLength(3);
 }finally{await f.app.close();}
});
it('keeps missing caller data and forged appointment claims truthful in owner Details',async()=>{
 const f=await fixture();try{
  const r=await f.post('completion',{...payload(),user_phone_number:null,interaction_transcript:[],final_agent_variables:{},end_datetime:'2026-11-04T00:01:00Z',appointment:{eventId:'forged'},recording_url:'https://example.test/private'});expect(r.statusCode).toBe(200);
  const detail=(await f.get('/'+r.json().reportId)).json().report;expect(detail).toMatchObject({callerPhone:null,customerName:null,outcome:'enquired',appointment:null,recordingReference:null});expect(detail.transcript).toBeUndefined();
 }finally{await f.app.close();}
});
it('separates provider credentials from owner sessions and denies member or foreign-owner access',async()=>{
 const f=await fixture();try{
  const saved=await f.post('callback',payload()),id=saved.json().reportId;
  expect((await f.app.inject({url:base+'/reports',headers:{authorization:'Bearer '+token}})).statusCode).toBe(401);
  f.repository.list.mockClear();expect((await f.get('','member')).statusCode).toBe(403);expect(f.repository.list).not.toHaveBeenCalled();
  expect((await f.get('','foreign')).json().reports).toEqual([]);expect((await f.get('/'+id,'foreign')).json().status).toBe('not_found');
  const denied=await f.app.inject({method:'POST',url:base+'/callback/'+profile.routeId,headers:{'x-test-session':'owner'},payload:payload()});expect(denied.statusCode).toBe(403);expect(f.events()).toHaveLength(1);
 }finally{await f.app.close();}
});
