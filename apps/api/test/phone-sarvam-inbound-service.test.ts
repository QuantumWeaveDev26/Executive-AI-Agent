import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import Fastify from 'fastify';
import {phoneInboundWorkflowRoutes} from '../src/routes/phone-inbound-workflow.js';
import {createSarvamInboundService,buildInboundServiceBinding} from '../src/services/phone-sarvam-inbound-service.js';
import type {InboundCallEvent,InboundEventInput} from '../src/services/phone-inbound-events.js';
const credential='synthetic-sarvam-inbound-service-token-0000000000';
const profile={routeId:'route-a',workspaceId:'w',ownerUserId:'u',principalId:'p',revision:1,appId:'agent-a',appVersion:5,deploymentId:'deployment-a',agentPhoneNumber:'+918000000001',maxCallLengthSeconds:300 as const};
const payload=()=>({app_id:'agent-a',app_version:5,deployment_id:'deployment-a',interaction_id:'20261103/synthetic',user_phone_number:'+919000000001',agent_phone_number:profile.agentPhoneNumber,duration:20,start_datetime:'2026-11-03T12:00:00Z',end_datetime:null,
 final_agent_variables:{customer_name:'Ram',business_type:'Retail',requested_service:'Automation',callback_preference:'yes'},
 interaction_transcript:[{role:'agent',en_text:'Would you like our team to contact you at +919000000001 and discuss a solution for your business?'},{role:'user',en_text:'Yes, please.'}]});
function fixture(options:{commitFails?:boolean;grantMismatch?:boolean;saveCallbackInPrincipalTransaction?:Parameters<typeof createSarvamInboundService>[0]['saveCallbackInPrincipalTransaction']}={}){
 let events:InboundCallEvent[]=[],commits=0;
 const query=vi.fn(async<R=any>(_sql:string,params?:any[])=>{
  const e=JSON.parse(params![0]) as InboundEventInput,old=events.find(x=>x.eventId===e.eventId);
  if(old&&old.sourceDigest!==e.sourceDigest)throw Error('Synthetic conflicting event');
  if(!old)events.push({...e,sequence:events.length+1});
  return {rows:[{receipt:{saved:true,events:structuredClone(events),duplicate:!!old}}] as R[]};
 });
 const withGrant=vi.fn(async(_r:any,fn:any)=>{
  const before=structuredClone(events);
  try{const result=await fn({...buildInboundServiceBinding(profile),tokenHash:createHash('sha256').update(credential).digest('hex'),activeOwner:true,revokedAt:null,expiresAt:'2026-11-04T00:00:00Z',operations:['callback','completion'],...(options.grantMismatch?{profileFingerprint:'f'.repeat(64)}:{})},{query});
   if(options.commitFails)throw Error('Synthetic commit failure');commits++;return result;
  }catch(e){events=before;throw e;}
 });
 const service=createSarvamInboundService({profile,transactions:{withGrant},now:()=>Date.parse('2026-11-03T12:01:00Z'),saveCallbackInPrincipalTransaction:options.saveCallbackInPrincipalTransaction});
 return {service,withGrant,query,state:()=>({events,commits})};
}
it('stages the inbound callback inside the admitted completion transaction',async()=>{
 const save=vi.fn();const f=fixture({saveCallbackInPrincipalTransaction:save});const body=payload();
 body.interaction_transcript[0]!.en_text='Ram, Retail, Automation. May I record a callback request for our team to contact you at +919000000001 and discuss a solution for your business?';
 await expect(f.service.complete('route-a','Bearer '+'x'.repeat(64),body)).rejects.toThrow();expect(save).not.toHaveBeenCalled();
 const final={...body,end_datetime:'2026-11-03T12:00:20Z'};
 expect((await f.service.complete('route-a','Bearer '+credential,final)).saved).toBe(true);
 expect(save).toHaveBeenCalledTimes(1);
 expect(save).toHaveBeenCalledWith(expect.objectContaining({query:f.query}),expect.objectContaining({workspaceId:'w',userId:'u',direction:'inbound',phoneNumber:'+919000000001',notificationStatus:'pending'}));
 const incomplete=fixture({saveCallbackInPrincipalTransaction:save});
 await incomplete.service.complete('route-a','Bearer '+credential,body);
 expect(save).toHaveBeenCalledTimes(1);
 const failing=fixture({saveCallbackInPrincipalTransaction:async()=>{throw Error('Synthetic callback write failed');}});
 await expect(failing.service.complete('route-a','Bearer '+credential,final)).rejects.toThrow();
 expect(failing.state().events).toHaveLength(0);
});
it('binds the exact server profile canonically and changes fingerprint when version or tenant changes',()=>{
 const a=buildInboundServiceBinding(profile),b=buildInboundServiceBinding({...profile});expect(a).toEqual(b);
 for(const changed of [{appVersion:6},{workspaceId:'other'},{revision:2},{deploymentId:'different'},{agentPhoneNumber:'+918000000002'}])expect(buildInboundServiceBinding({...profile,...changed}).profileFingerprint).not.toBe(a.profileFingerprint);
 expect(()=>buildInboundServiceBinding({...profile,maxCallLengthSeconds:600} as never)).toThrow();expect(()=>buildInboundServiceBinding({...profile,sessionTokenHash:'forbidden'} as never)).toThrow();
});
it('normalizes and commits one callback without using an owner login and returns only a minimal receipt',async()=>{
 const f=fixture(),r=await f.service.requestCallback('route-a','Bearer '+credential,payload());expect(r.saved).toBe(true);expect(r.action).toBe('callback_requested');expect(f.state().commits).toBe(1);expect(f.withGrant).toHaveBeenCalledTimes(1);
 expect(f.state().events[0]?.report.customerName).toBe('Ram');expect(JSON.stringify(r)).not.toContain('Ram');expect(JSON.stringify(r)).not.toContain('+919000000001');expect(JSON.stringify(f.withGrant.mock.calls[0]?.[0])).not.toContain('sessionTokenHash');
});
it('authenticates before parsing and rejects mismatched grants without touching payload or save',async()=>{
 const f=fixture(),b=Object.defineProperty({},'app_id',{get(){throw Error('Payload parsed before authentication');}});
 await expect(f.service.requestCallback('route-a','Bearer '+'x'.repeat(64),b)).rejects.toThrow();expect(f.query).not.toHaveBeenCalled();
 const mismatch=fixture({grantMismatch:true});await expect(mismatch.service.requestCallback('route-a','Bearer '+credential,b)).rejects.toThrow();expect(mismatch.query).not.toHaveBeenCalled();
});
it('rejects wrong provider bindings and ignores provider attempts to choose tenant, role or book an appointment',async()=>{
 const f=fixture();await expect(f.service.complete('route-a','Bearer '+credential,{...payload(),app_version:6})).rejects.toThrow();expect(f.query).not.toHaveBeenCalled();
 await f.service.requestCallback('route-a','Bearer '+credential,{...payload(),workspaceId:'attacker',userId:'attacker',role:'owner',appointment:{eventId:'forged'}});
 expect(f.state().events[0]?.report.workspaceId).toBe('w');expect(f.state().events[0]?.report.appointment).toBeNull();
});
it('merges completion, honors withdrawal and does not revive a replayed callback',async()=>{
 const f=fixture(),a=await f.service.requestCallback('route-a','Bearer '+credential,payload());
 const end={...payload(),end_datetime:'2026-11-03T12:02:00Z',duration:120,interaction_transcript:[],final_agent_variables:{callback_preference:'unknown'}};
 expect((await f.service.complete('route-a','Bearer '+credential,end)).reportId).toBe(a.reportId);
 const withdrawn=payload();withdrawn.interaction_transcript.push({role:'user',en_text:"Please don't call me."});
 expect((await f.service.requestCallback('route-a','Bearer '+credential,withdrawn)).action).toBe('callback_withdrawn');
 expect((await f.service.requestCallback('route-a','Bearer '+credential,payload())).action).toBe('callback_withdrawn');expect(f.state().events).toHaveLength(3);
});
it('does not invent missing caller details or confirm interest without explicit recap consent',async()=>{
 const f=fixture(),b={...payload(),user_phone_number:null,interaction_transcript:[],final_agent_variables:{},end_datetime:'2026-11-03T12:01:00Z'};
 const r=await f.service.complete('route-a','Bearer '+credential,b);expect(r.outcome).toBe('enquired');expect(f.state().events[0]?.report.callerPhone).toBeNull();expect(f.state().events[0]?.report.customerName).toBeNull();
 const incomplete=fixture();await expect(incomplete.service.requestCallback('route-a','Bearer '+credential,{...payload(),interaction_transcript:[]})).rejects.toThrow();expect(incomplete.query).not.toHaveBeenCalled();
});
it('returns no saved receipt when commit fails and keeps raw media disabled',async()=>{
 const f=fixture({commitFails:true});await expect(f.service.requestCallback('route-a','Bearer '+credential,payload())).rejects.toThrow();expect(f.state().events).toHaveLength(0);
 const safe=fixture();await safe.service.complete('route-a','Bearer '+credential,{...payload(),recording_url:'https://example.test/private.wav'});expect(safe.state().events[0]?.report.transcript).toBeUndefined();expect(safe.state().events[0]?.report.recordingReference).toBeNull();
});
it('refuses missing, numeric or inherited binding identifiers instead of coercing them to strings',()=>{
 for(const change of [{appId:undefined},{deploymentId:123},{ownerUserId:undefined}])expect(()=>buildInboundServiceBinding({...profile,...change} as never)).toThrow();
});
it('rejects non-primitive agent phone values instead of accepting regex coercion',()=>{
 for(const agentPhoneNumber of [[profile.agentPhoneNumber],new String(profile.agentPhoneNumber)])expect(()=>buildInboundServiceBinding({...profile,agentPhoneNumber} as never)).toThrow();
});
it('honors a first-turn withdrawal at completion and does not revive a saved callback',async()=>{
 const f=fixture();await f.service.requestCallback('route-a','Bearer '+credential,payload());
 const withdrawal={...payload(),end_datetime:'2026-11-03T12:02:00Z',interaction_transcript:[{role:'user',en_text:"Please don't call me."}]};
 expect((await f.service.complete('route-a','Bearer '+credential,withdrawal)).outcome).not.toBe('callback_requested');
 expect((await f.service.requestCallback('route-a','Bearer '+credential,payload())).action).toBe('callback_withdrawn');
});
it('admits an explicit first-turn withdrawal without requiring a preceding agent recap',async()=>{
 const f=fixture();const r=await f.service.requestCallback('route-a','Bearer '+credential,{...payload(),interaction_transcript:[{role:'user',en_text:"Please don't call me."}]});
 expect(r.action).toBe('callback_withdrawn');expect(r.callbackRequestId).toBeNull();
});
it('reuses the versioned test-only routes with authentication, private receipts and bounded bodies',async()=>{
 const f=fixture(),app=Fastify({logger:false});await app.register(async child=>phoneInboundWorkflowRoutes(child,f.service),{prefix:'/api/v1'});
 try{
  const denied=await app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/callback/route-a',payload:payload()});expect(denied.statusCode).toBe(403);expect(f.query).not.toHaveBeenCalled();
  const saved=await app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/callback/route-a',headers:{authorization:'Bearer '+credential},payload:payload()});expect(saved.statusCode).toBe(200);expect(saved.json().action).toBe('callback_requested');expect(saved.body).not.toContain('Ram');expect(saved.headers['cache-control']).toBe('no-store');
  const oversized=await app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/completion/route-a',headers:{authorization:'Bearer '+credential},payload:{...payload(),extra:'x'.repeat(65536)}});expect(oversized.statusCode).toBe(413);
 }finally{await app.close();}
});
it('retains production guards and sanitized endpoint failures',async()=>{
 const original=process.env.NODE_ENV;try{process.env.NODE_ENV='production';expect(()=>fixture()).toThrow('test-only');}finally{process.env.NODE_ENV=original;}
 const f=fixture({commitFails:true}),app=Fastify({logger:false});await app.register(async child=>phoneInboundWorkflowRoutes(child,f.service),{prefix:'/api/v1'});
 try{const r=await app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/callback/route-a',headers:{authorization:'Bearer '+credential},payload:payload()});expect(r.statusCode).toBe(503);expect(r.json()).toEqual({saved:false,code:'PHONE_INBOUND_REQUEST_NOT_CONFIRMED'});}finally{await app.close();}
});
