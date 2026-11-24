import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import Fastify from 'fastify';
import {createHash,randomBytes} from 'node:crypto';
import {defaultPolicyGateway} from '@thaara/policy';
import {GoogleCalendarFoundation,GoogleCalendarVault,SyntheticGoogleCalendarProvider,GOOGLE_CALENDAR_LIVE_SCOPES} from '../src/services/google-calendar.js';
import {approvalRoutes} from '../src/routes/approvals.js';
import {waitForChatPlanBackgroundExecution} from '../src/services/chat-automation-orchestrator.js';
import type {InboundCallEvent,InboundEventInput} from '../src/services/phone-inbound-events.js';
import {phoneContactsDatabase} from './helpers/phone-contacts-fixture.js';
import {createInboundAppointments,buildAppointmentBinding} from '../src/services/phone-inbound-appointments.js';
import {phoneInboundAppointmentRoutes} from '../src/routes/phone-inbound-appointments.js';
import {PhoneAppointmentResponseSchema} from '@thaara/contracts';
import {Value} from '@sinclair/typebox/value';
import {createPhoneAppointmentCalendarReceiptReader} from '../src/services/phone-appointment-calendar.js';
import {createInboundJournalReportFeed} from '../src/services/phone-inbound-journal-feed.js';
import {createPhoneAppointmentIntegration} from '../src/services/phone-appointment-integration.js';

let identities:Awaited<ReturnType<typeof phoneContactsDatabase>>;
beforeAll(async()=>{identities=await phoneContactsDatabase();});
afterAll(async()=>{await identities?.db.close();});
const token='synthetic-appointment-service-token-0000000000';
let sequence=0;
async function fixture(flags:{revoked?:boolean;failSave?:boolean;conflict?:boolean;ownerUnavailable?:boolean;ownerHash?:string;realCalendar?:boolean}={}){
 const interactionId='20261104/appointment-'+(++sequence),owner=identities.owner;
 const profile={routeId:'appt-'+sequence,workspaceId:owner.workspaceId,ownerUserId:owner.userId,principalId:'p-'+sequence,revision:1,appId:'agent',appVersion:5,deploymentId:'inbound',agentPhoneNumber:'+918000000001',maxCallLengthSeconds:300 as const};
 let events:InboundCallEvent[]=[];
 const transactions={withGrant:async(_r:unknown,work:any)=>{
  const staged=structuredClone(events);
  const result=await work({...buildAppointmentBinding(profile,interactionId),tokenHash:createHash('sha256').update(token).digest('hex'),activeOwner:true,revokedAt:flags.revoked?'2026-11-04T00:00:00Z':null,expiresAt:'2099-01-01T00:00:00Z',operations:['callback','completion']},
   {query:async(_sql:string,args:string[])=>{const e=JSON.parse(args[0]!) as InboundEventInput,old=staged.find(x=>x.eventId===e.eventId);if(old&&old.sourceDigest!==e.sourceDigest)throw Error('conflict');if(!old)staged.push({...e,sequence:staged.length+1});return {rows:[{receipt:{saved:true,events:staged,duplicate:!!old}}]};}});
  if(flags.failSave)throw Error('PRIVATE save failure');events=staged;return result;
 }};
 const calendar={writeReadiness:vi.fn(async()=>({ready:true,connectedCalendar:'owner@example.test'})),findConflicts:vi.fn(async()=>flags.conflict?[{summary:'PRIVATE event'}]:[]),listEvents:vi.fn(async()=>({events:[],nextPageToken:undefined as string|undefined})),readEvent:vi.fn()};
 const resolveOwnerSession=vi.fn(async()=>flags.ownerUnavailable?null:flags.ownerHash??owner.sessionTokenHash);
 let records:any[]=[],providerCreates=0;
 const store=new Map<string,string>(),vault=new GoogleCalendarVault(randomBytes(32),{get:k=>store.get(k),set:(k,v)=>{store.set(k,v);},take:k=>{const v=store.get(k);store.delete(k);return v;},delete:k=>{store.delete(k);}});
 const synthetic=new SyntheticGoogleCalendarProvider(new Map([['synthetic-calendar-token',records]]),new Map([['code',{accessToken:'synthetic-calendar-token',refreshToken:'synthetic-refresh',scope:GOOGLE_CALENDAR_LIVE_SCOPES,expiresIn:3600}]]));
 const foundation=new GoogleCalendarFoundation({provider:{mode:'mock',exchange:synthetic.exchange.bind(synthetic),listEvents:synthetic.listEvents.bind(synthetic),readEvent:synthetic.readEvent.bind(synthetic),getPrimaryCalendar:async()=>({id:'owner@example.test'}),
  createEvent:async input=>{providerCreates++;records.push({id:'event-'+sequence,calendarId:'primary',summary:input.summary,startAt:input.startAt,endAt:input.endAt,timeZone:input.timeZone,allDay:false,status:'confirmed',attendees:[]});return {id:records.at(-1).id,status:'confirmed'};}},
  vault,clientId:'synthetic-client',redirectUri:'https://example.test/calendar/callback',allowWriteScope:true,policyGateway:defaultPolicyGateway,audit:async()=>{}});
 if(flags.realCalendar){const start=await foundation.start(owner);await foundation.complete(owner,{state:new URL(start.authorizationUrl).searchParams.get('state')!,code:'code'});}
 const service=createInboundAppointments({profile,interactionId,transactions,db:identities.db,calendar:flags.realCalendar?foundation:calendar as any,resolveProposalOwnerSession:resolveOwnerSession});
 const body={payload:{app_id:'agent',app_version:5,deployment_id:'inbound',interaction_id:interactionId,user_phone_number:'+919000000001',agent_phone_number:profile.agentPhoneNumber,duration:20,start_datetime:'2026-11-04T00:00:00Z',end_datetime:null,
  final_agent_variables:{customer_name:'Ram',business_type:'Retail',requested_service:'Automation',callback_preference:'yes'},interaction_transcript:[{role:'agent',en_text:'Would you like our team to contact you at +919000000001 and discuss a solution for your business?'},{role:'user',en_text:'Yes, please.'}]},
  slot:{startAt:'2090-11-05T09:00:00Z',endAt:'2090-11-05T09:30:00Z',timeZone:'Asia/Kolkata'}};
 const app=Fastify({logger:false});app.decorate('requireAuth',async(req:any,reply:any)=>{if(req.headers['x-test-owner']!=='yes')return reply.code(401).send({error:'Unauthorized'});req.scope=owner;});
 await app.register(async v=>{await phoneInboundAppointmentRoutes(v,service);await approvalRoutes(v,{db:identities.db,googleCalendar:foundation});},{prefix:'/api/v1'});
 const post=(value:unknown=body,authorization='Bearer '+token)=>app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/appointment-requests/'+profile.routeId,headers:{authorization},payload:value as any});
 return {app,service,post,body,profile,transactions,calendar,foundation,resolveOwnerSession,events:()=>events,providerCreates:()=>providerCreates,records};
}
it('composed request capture saves before owner review and never borrows an owner Calendar session',async()=>{
 const f=await fixture();try{
  const integrated=createPhoneAppointmentIntegration({db:identities.db,calendar:f.calendar as any,calls:{durable:true,load:vi.fn()},inbound:{profile:f.profile,interactionId:f.body.payload.interaction_id,transactions:f.transactions as any}});
  const r=await integrated.phoneAppointments!.inbound!.request(f.profile.routeId,'Bearer '+token,f.body);
  expect(r).toMatchObject({saved:true,status:'request_saved',appointmentConfirmed:false});expect(f.events()).toHaveLength(1);expect(f.resolveOwnerSession).not.toHaveBeenCalled();expect(f.calendar.writeReadiness).not.toHaveBeenCalled();
  const plans=await identities.db.withScopedTransaction(identities.owner,tx=>tx.query(`SELECT id FROM plans WHERE metadata->>'phoneInboundRequestId'=$1`,[r.requestId]));expect(plans.rows).toHaveLength(0);
 }finally{await f.app.close();}
});
it('saves the request before preparing a real governed approval, without confirming a booking',async()=>{
 const f=await fixture();try{const r=await f.post();expect(r.statusCode).toBe(200);expect(r.json()).toMatchObject({saved:true,status:'approval_pending',appointmentConfirmed:false});expect(f.events()).toHaveLength(1);
 expect(r.body).not.toContain('owner@example.test');expect(r.body).not.toContain('Ram');
 expect(r.json()).not.toHaveProperty('calendarApproval');
 const plans=await identities.db.withScopedTransaction(identities.owner,tx=>tx.query('SELECT status FROM plans WHERE metadata->>\'phoneInboundRequestId\'=$1',[r.json().requestId]));expect(plans.rows[0].status).toBe('awaiting_approval');
 }finally{await f.app.close();}
});
it('saves an explicitly consented appointment request through the authenticated endpoint before owner approval',async()=>{
 const f=await fixture();try{
  f.body.payload.interaction_transcript[0]!.en_text='May I save your appointment request and ask our team to contact you at +919000000001?';
  const r=await f.post();expect(r.statusCode).toBe(200);
  expect(r.json()).toMatchObject({saved:true,status:'approval_pending',appointmentConfirmed:false});
  expect(f.events()).toHaveLength(1);expect(f.events()[0]!.report.outcome).toBe('callback_requested');
  const plans=await identities.db.withScopedTransaction(identities.owner,tx=>tx.query('SELECT status FROM plans WHERE metadata->>\'phoneInboundRequestId\'=$1',[r.json().requestId]));
  expect(plans.rows).toHaveLength(1);expect(plans.rows[0].status).toBe('awaiting_approval');
 }finally{await f.app.close();}
});
it('deduplicates concurrent proposals and repeated deliveries',async()=>{
 const f=await fixture();try{const first=await f.post();const responses=await Promise.all([f.post(),f.post()]);for(const r of responses)expect(r.json().requestId).toBe(first.json().requestId);
 const result=await identities.db.withScopedTransaction(identities.owner,tx=>tx.query('SELECT count(*)::int AS n FROM plans WHERE metadata->>\'phoneInboundRequestId\'=$1',[first.json().requestId]));expect(result.rows[0].n).toBe(1);expect(f.events()).toHaveLength(1);
 }finally{await f.app.close();}
});
it('saves an unavailable-slot request without creating a proposal or exposing calendar details',async()=>{
 const f=await fixture({conflict:true});try{const r=await f.post();expect(r.json()).toMatchObject({saved:true,status:'slot_unavailable',appointmentConfirmed:false});expect(r.body).not.toContain('PRIVATE');expect(f.events()).toHaveLength(1);}finally{await f.app.close();}
});
it('retains a saved request if owner Calendar authority is unavailable',async()=>{
 const f=await fixture({ownerUnavailable:true});try{expect((await f.post()).json()).toMatchObject({saved:true,status:'request_saved',appointmentConfirmed:false});expect(f.calendar.findConflicts).not.toHaveBeenCalled();}finally{await f.app.close();}
});
it('rejects wrong authentication, revocation and another call before Calendar access',async()=>{
 for(const flags of [{},{revoked:true}]){const f=await fixture(flags);try{const body=flags.revoked?f.body:{...f.body,payload:{...f.body.payload,interaction_id:'20261104/other'}};expect((await f.post(body)).statusCode).toBe(403);expect((await f.post(f.body,'Bearer bad')).statusCode).toBe(403);expect(f.events()).toHaveLength(0);expect(f.resolveOwnerSession).not.toHaveBeenCalled();}finally{await f.app.close();}}
});
it('does not acknowledge a failed save or call Calendar',async()=>{
 const f=await fixture({failSave:true});try{const r=await f.post();expect(r.statusCode).toBe(503);expect(r.json().saved).toBe(false);expect(r.body).not.toContain('PRIVATE');expect(f.calendar.findConflicts).not.toHaveBeenCalled();}finally{await f.app.close();}
});
it('rejects invalid slots and caller-supplied authority',async()=>{
 const f=await fixture();try{for(const body of [{...f.body,workspaceId:'foreign'},{...f.body,slot:{...f.body.slot,endAt:f.body.slot.startAt}},{...f.body,slot:{...f.body.slot,timeZone:'Invalid/Zone'}}]){expect((await f.post(body)).statusCode).toBe(400);}expect(f.events()).toHaveLength(0);}finally{await f.app.close();}
});
it('creates exactly one event through existing owner approval and PolicyGateway, then verifies readback',async()=>{
 const f=await fixture({realCalendar:true});try{
  const first=await f.post();expect(first.json().status).toBe('approval_pending');expect(f.providerCreates()).toBe(0);
  const feed=createInboundJournalReportFeed({repository:{list:async()=>[f.events()[0]!.report],read:async()=>f.events()[0]!.report},verifyAppointment:createPhoneAppointmentCalendarReceiptReader({db:identities.db,calendar:f.foundation})});
  expect((await feed.detail(identities.owner,first.json().requestId)).report?.outcome).toBe('callback_requested');expect(f.providerCreates()).toBe(0);
  const pending=await identities.db.withScopedTransaction(identities.owner,tx=>tx.query(`SELECT p.id AS plan_id,b.approval_request_id FROM plans p JOIN plan_steps s ON s.plan_id=p.id JOIN plan_step_approval_bindings b ON b.step_id=s.id WHERE p.workspace_id=$1 AND p.created_by_user_id=$2 AND p.metadata->>'phoneInboundRequestId'=$3`,[identities.owner.workspaceId,identities.owner.userId,first.json().requestId]));
  const row=pending.rows[0];expect(row).toBeTruthy();
  const denied=await f.app.inject({method:'POST',url:'/api/v1/approvals/'+row.approval_request_id+'/decide',payload:{status:'approved'}});expect(denied.statusCode).toBe(401);expect(f.providerCreates()).toBe(0);
  const approval=await f.app.inject({method:'POST',url:'/api/v1/approvals/'+row.approval_request_id+'/decide',headers:{'x-test-owner':'yes'},payload:{status:'approved'}});expect(approval.statusCode).toBe(200);
  await waitForChatPlanBackgroundExecution(row.plan_id);
  const result=await f.post();expect(result.json()).toMatchObject({saved:true,status:'appointment_confirmed',appointmentConfirmed:true,eventId:f.records[0]?.id});expect(f.providerCreates()).toBe(1);
  expect((await feed.detail(identities.owner,first.json().requestId)).report).toMatchObject({outcome:'booked_appointment',appointment:{eventId:f.records[0]?.id,verification:'verified'}});
  expect((await feed.list(identities.owner)).reports[0]?.outcome).toBe('booked_appointment');expect(f.providerCreates()).toBe(1);
  expect((await f.post()).json().appointmentConfirmed).toBe(true);expect(f.providerCreates()).toBe(1);
  f.records[0].status='cancelled';expect((await f.post()).json()).toMatchObject({appointmentConfirmed:false,status:'needs_review'});expect(f.providerCreates()).toBe(1);
  expect((await feed.detail(identities.owner,first.json().requestId)).report?.outcome).toBe('callback_requested');expect(f.providerCreates()).toBe(1);
 }finally{await f.app.close();}
});
it('never converts a different owner or member session into the configured owner',async()=>{
 for(const ownerHash of [identities.foreign.sessionTokenHash,identities.member.sessionTokenHash]){
  const f=await fixture({ownerHash});try{expect((await f.post()).json()).toMatchObject({saved:true,status:'request_saved'});expect(f.calendar.findConflicts).not.toHaveBeenCalled();}finally{await f.app.close();}
 }
});
it('keeps the request saved when Calendar fails, without a false booking or raw error',async()=>{
 const f=await fixture();try{f.calendar.findConflicts.mockRejectedValueOnce(Error('PRIVATE Calendar error'));const r=await f.post();expect(r.json()).toMatchObject({saved:true,status:'request_saved',appointmentConfirmed:false});expect(r.body).not.toContain('PRIVATE');expect(f.events()).toHaveLength(1);}finally{await f.app.close();}
});
it('does not treat all-day busy events or incomplete Calendar pages as an available slot',async()=>{
 for(const kind of ['all-day','partial']){const f=await fixture();try{
  f.calendar.listEvents.mockResolvedValueOnce(kind==='partial'?{events:[],nextPageToken:'more'}:{events:[{allDay:true,status:'confirmed',startAt:f.body.slot.startAt,endAt:f.body.slot.endAt}] as any,nextPageToken:undefined});
  const r=await f.post();expect(r.json()).toMatchObject({saved:true,appointmentConfirmed:false,status:kind==='partial'?'needs_review':'slot_unavailable'});
 }finally{await f.app.close();}}
});
it('requires an event and exact slot on confirmed responses and forbids events on pending responses',()=>{
 const base={saved:true,requestId:'a'.repeat(64)};
 expect(Value.Check(PhoneAppointmentResponseSchema,{...base,status:'appointment_confirmed',appointmentConfirmed:true})).toBe(false);
 expect(Value.Check(PhoneAppointmentResponseSchema,{...base,status:'approval_pending',appointmentConfirmed:false,eventId:'forged'})).toBe(false);
});
it('refuses production construction before touching any integration port',()=>{
 vi.stubEnv('NODE_ENV','production');try{expect(()=>createInboundAppointments({} as any)).toThrow('test-only');}finally{vi.unstubAllEnvs();}
});
