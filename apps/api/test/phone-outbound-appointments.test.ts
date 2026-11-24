import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import {defaultPolicyGateway} from '@thaara/policy';
import {phoneContactsDatabase} from './helpers/phone-contacts-fixture.js';
import {createOutboundAppointments} from '../src/services/phone-outbound-appointments.js';
import {phoneOutboundAppointmentRoutes} from '../src/routes/phone-outbound-appointments.js';
import {approvalRoutes} from '../src/routes/approvals.js';
import {waitForChatPlanBackgroundExecution} from '../src/services/chat-automation-orchestrator.js';
import {GoogleCalendarFoundation,GoogleCalendarVault,SyntheticGoogleCalendarProvider,GOOGLE_CALENDAR_LIVE_SCOPES} from '../src/services/google-calendar.js';
import {buildApp} from '../src/app.js';
import {loadConfig} from '@thaara/config';
import {Logger} from '@thaara/observability';
import {generateCsrfToken} from '../src/crypto/csrf.js';
import {createPhoneAppointmentCalendar} from '../src/services/phone-appointment-calendar.js';

let identities:Awaited<ReturnType<typeof phoneContactsDatabase>>;
beforeAll(async()=>{identities=await phoneContactsDatabase();});
afterAll(async()=>{await identities?.db.close();});
const slot={startAt:'2090-11-05T09:00:00Z',endAt:'2090-11-05T09:30:00Z',timeZone:'Asia/Kolkata'};
function fixture(){
 const callId=randomUUID(),record={id:callId,approvalId:randomUUID(),draft:{recipient:{displayName:'Ram'},purpose:'Ask about website completion'},state:'completed',simulated:false,providerCallId:'20261105/synthetic-call'};
 const calls={durable:true,load:vi.fn(async()=>({record}))};
 const calendar={writeReadiness:vi.fn(async()=>({ready:true,connectedCalendar:'owner@example.test'})),findConflicts:vi.fn(async()=>[] as unknown[]),listEvents:vi.fn(async()=>({events:[],nextPageToken:undefined as string|undefined})),readEvent:vi.fn()};
 const service=createOutboundAppointments({db:identities.db,calls:calls as any,calendar:calendar as any});
 return {callId,record,calls,calendar,service};
}
it('reads historical proposal status without creating another proposal, and refuses foreign identity',async()=>{
 const f=fixture();expect(await f.service.status(identities.owner,f.callId)).toEqual({saved:false,status:'request_not_saved',appointmentConfirmed:false});
 expect(f.calendar.writeReadiness).not.toHaveBeenCalled();
 const prepared=await f.service.request(identities.owner,f.callId,{slot});
 const historical=createOutboundAppointments({db:identities.db,calls:f.calls as any,calendar:f.calendar as any,now:()=>Date.parse('2091-01-01T00:00:00Z')});
 expect(await historical.status(identities.owner,f.callId)).toMatchObject({status:'approval_pending',calendarApproval:(prepared as any).calendarApproval,appointmentConfirmed:false});
 expect(f.calendar.findConflicts).toHaveBeenCalledTimes(1);
 await expect(historical.status({...identities.owner,sessionTokenHash:identities.foreign.sessionTokenHash},f.callId)).rejects.toThrow();
 const rows=await identities.db.withScopedTransaction(identities.owner,tx=>tx.query(`SELECT id FROM plans WHERE metadata->>'phoneOutboundCallId'=$1`,[f.callId]));expect(rows.rows).toHaveLength(1);
});
it('restores only the exact owner and outbound call proposal without creating another proposal or booking',async()=>{
 const f=fixture();
 expect(await f.service.review(identities.owner,f.callId)).toEqual({status:'not_prepared',slot:null,calendarApproval:null});
 const prepared=await f.service.request(identities.owner,f.callId,{slot});
 expect(await f.service.review(identities.owner,f.callId)).toMatchObject({status:'ready',slot,calendarApproval:(prepared as any).calendarApproval});
 await expect(f.service.review({...identities.owner,sessionTokenHash:identities.foreign.sessionTokenHash},f.callId)).rejects.toThrow();
 expect(f.calendar.findConflicts).toHaveBeenCalledTimes(1);expect(f.calendar.readEvent).not.toHaveBeenCalled();
});
it('connects the existing outbound appointment workflow through real application authentication and CSRF, with production still refused',async()=>{
 const f=fixture(),csrf=generateCsrfToken(),headers={cookie:`thaara_session=${identities.owner.token}; thaara_csrf=${csrf}`,'x-csrf-token':csrf};
 const app=await buildApp({db:identities.db,config:loadConfig({NODE_ENV:'test'}),logger:new Logger('error'),phoneAppointments:{outbound:f.service}});
 const base='/api/v1/connectors/phone/ai/calls/'+f.callId;
 try{
  expect((await app.inject({method:'GET',url:base+'/appointment-review'})).statusCode).toBe(401);
  expect((await app.inject({method:'GET',url:base+'/appointment-review',headers})).json()).toEqual({status:'not_prepared',slot:null,calendarApproval:null});
  expect((await app.inject({method:'POST',url:base+'/appointment-request',headers:{cookie:headers.cookie},payload:{slot}})).statusCode).toBe(403);
  const prepared=await app.inject({method:'POST',url:base+'/appointment-request',headers,payload:{slot}});
  expect(prepared.statusCode,prepared.body).toBe(200);expect(prepared.json()).toMatchObject({saved:true,status:'approval_pending',appointmentConfirmed:false});
  const restored=await app.inject({method:'GET',url:base+'/appointment-review',headers});
  expect(restored.statusCode,restored.body).toBe(200);expect(restored.json()).toMatchObject({status:'ready',slot,calendarApproval:prepared.json().calendarApproval});
  expect(restored.headers['cache-control']).toBe('no-store');
  expect((await app.inject({method:'GET',url:base+'/appointment-status'})).statusCode).toBe(401);
  const status=await app.inject({method:'GET',url:base+'/appointment-status',headers});expect(status.statusCode,status.body).toBe(200);expect(status.json()).toMatchObject({status:'approval_pending',appointmentConfirmed:false});
  await expect(buildApp({config:{...loadConfig({NODE_ENV:'test'}),NODE_ENV:'production'} as any,phoneAppointments:{outbound:f.service}})).rejects.toThrow('test-only');
 }finally{await app.close();}
});
it('prepares an owner-approved Calendar proposal for the exact durable outbound call, never a booking',async()=>{
 const f=fixture(),r=await f.service.request(identities.owner,f.callId,{slot});
 expect(r).toMatchObject({saved:true,status:'approval_pending',appointmentConfirmed:false});
 const result=await identities.db.withScopedTransaction(identities.owner,tx=>tx.query(`SELECT status,metadata FROM plans WHERE metadata->>'phoneOutboundCallId'=$1`,[f.callId]));
 expect(result.rows).toHaveLength(1);expect(result.rows[0].status).toBe('awaiting_approval');
 expect(result.rows[0].metadata.phoneCallDirection).toBe('outbound');
 expect(JSON.stringify(r)).not.toContain('owner@example.test');
});
it('admits only the explicit existing-owner Calendar path in production without inbound journal access',async()=>{
 const f=fixture();
 const absent=await identities.db.query("SELECT to_regclass('public.phone_inbound_call_events') AS journal,to_regclass('public.phone_inbound_principals') AS principals");
 expect(absent.rows[0]).toEqual({journal:null,principals:null});
 vi.stubEnv('NODE_ENV','production');
 try{
  const service=createOutboundAppointments({db:identities.db,calls:f.calls as any,calendar:f.calendar as any,existingOwnerCalendarReview:true});
  const response=await service.request(identities.owner,f.callId,{slot});
  expect(response).toMatchObject({saved:true,status:'approval_pending',appointmentConfirmed:false});
  await expect(service.request(identities.member,f.callId,{slot})).rejects.toThrow();
  expect(()=>createOutboundAppointments({db:identities.db,calls:{...f.calls,durable:false} as any,calendar:f.calendar as any,existingOwnerCalendarReview:true})).toThrow();
  const app=Fastify({logger:false});app.decorate('requireAuth',async(req:any,reply:any)=>{if(req.headers['x-test-owner']!=='yes')return reply.code(401).send({error:'Unauthorized'});req.scope=identities.owner;});
  await app.register(async v=>phoneOutboundAppointmentRoutes(v,service),{prefix:'/api/v1'});
  try{expect((await app.inject({method:'GET',url:`/api/v1/connectors/phone/ai/calls/${f.callId}/appointment-status`})).statusCode).toBe(401);}finally{await app.close();}
 }finally{vi.unstubAllEnvs();}
});
it('does not let a legacy or caller-forged service bypass the production route gate',async()=>{
 const f=fixture();vi.stubEnv('NODE_ENV','production');
 try{for(const service of [f.service,{...f.service,existingOwnerCalendarReview:true}]){
  const app=Fastify({logger:false});await expect(phoneOutboundAppointmentRoutes(app,service)).rejects.toThrow('admission');await app.close();
 }}finally{vi.unstubAllEnvs();}
});
it('keeps the existing-owner application switch off by default and requires existing durable calls',async()=>{
 await expect(buildApp({db:identities.db,config:loadConfig({NODE_ENV:'test'}),logger:new Logger('error'),phoneOwnerCalendarReview:true})).rejects.toThrow('durable');
 const app=await buildApp({db:identities.db,config:loadConfig({NODE_ENV:'test'}),logger:new Logger('error'),phoneCalling:{durableContacts:true,durableCalls:true},phoneOwnerCalendarReview:true});
 try{expect((await app.inject({method:'GET',url:'/api/v1/connectors/phone/ai/calls/'+randomUUID()+'/appointment-review'})).statusCode).toBe(401);}finally{await app.close();}
 const off=await buildApp({db:identities.db,config:loadConfig({NODE_ENV:'test'}),logger:new Logger('error')});
 try{expect((await off.inject({method:'GET',url:'/api/v1/connectors/phone/ai/calls/'+randomUUID()+'/appointment-review'})).statusCode).toBe(404);}finally{await off.close();}
});
it('keeps inbound admission blocked and rejects missing production Calendar configuration',async()=>{
 const f=fixture();vi.stubEnv('NODE_ENV','production');
 try{
  expect(()=>createPhoneAppointmentCalendar({db:identities.db,calendar:f.calendar as any,direction:'inbound',savedBeforeProposal:true,includeOwnerReview:true,existingOwnerCalendarReview:true})).toThrow('test-only');
  await expect(buildApp({db:identities.db,config:{...loadConfig({NODE_ENV:'test'}),NODE_ENV:'production'} as any,phoneCalling:{durableContacts:true,durableCalls:true},phoneOwnerCalendarReview:true})).rejects.toThrow('live Calendar');
 }finally{vi.unstubAllEnvs();}
});
it('deduplicates proposals and refuses changed slot replay',async()=>{
 const f=fixture(),first=await f.service.request(identities.owner,f.callId,{slot});
 expect(await f.service.request(identities.owner,f.callId,{slot})).toEqual(first);
 await expect(f.service.request(identities.owner,f.callId,{slot:{...slot,endAt:'2090-11-05T10:00:00Z'}})).rejects.toThrow();
 const rows=await identities.db.withScopedTransaction(identities.owner,tx=>tx.query(`SELECT id FROM plans WHERE metadata->>'phoneOutboundCallId'=$1`,[f.callId]));expect(rows.rows).toHaveLength(1);
});
it('keeps a committed proposal saved when later Calendar access is unavailable',async()=>{
 const f=fixture();await f.service.request(identities.owner,f.callId,{slot});
 f.calendar.writeReadiness.mockResolvedValueOnce({ready:false} as any);
 expect(await f.service.request(identities.owner,f.callId,{slot})).toMatchObject({saved:true,status:'needs_review',appointmentConfirmed:false});
});
it('denies member, foreign session, spoofed identity, unknown call and non-durable storage before Calendar',async()=>{
 const f=fixture();
 for(const scope of [identities.member,{...identities.owner,sessionTokenHash:identities.foreign.sessionTokenHash}])await expect(f.service.request(scope,f.callId,{slot})).rejects.toThrow();
 f.calls.load.mockResolvedValueOnce(null as any);await expect(f.service.request(identities.owner,f.callId,{slot})).rejects.toThrow();
 f.calls.durable=false;await expect(f.service.request(identities.owner,f.callId,{slot})).rejects.toThrow();
 expect(f.calendar.writeReadiness).not.toHaveBeenCalled();
});
it('rejects fabricated authority, missing call binding, simulations and failed calls',async()=>{
 const f=fixture();
 await expect(f.service.request(identities.owner,f.callId,{slot,approved:true})).rejects.toThrow();
 f.record.id=randomUUID();await expect(f.service.request(identities.owner,f.callId,{slot})).rejects.toThrow();f.record.id=f.callId;
 f.record.simulated=true;await expect(f.service.request(identities.owner,f.callId,{slot})).rejects.toThrow();f.record.simulated=false;
 f.record.state='failed';await expect(f.service.request(identities.owner,f.callId,{slot})).rejects.toThrow();
 expect(f.calendar.writeReadiness).not.toHaveBeenCalled();
});
it('does not report saved on unavailable Calendar, busy slots or failed proposal storage',async()=>{
 const f=fixture();f.calendar.writeReadiness.mockResolvedValueOnce({ready:false} as any);
 expect(await f.service.request(identities.owner,f.callId,{slot})).toMatchObject({saved:false,appointmentConfirmed:false});
 f.calendar.findConflicts.mockResolvedValueOnce([{}]);expect(await f.service.request(identities.owner,f.callId,{slot})).toMatchObject({saved:false,status:'slot_unavailable'});
 const failing=createOutboundAppointments({db:{...identities.db,withAuthenticatedScope:identities.db.withAuthenticatedScope.bind(identities.db),withScopedTransaction:async()=>{throw Error('PRIVATE storage error');}} as any,calls:f.calls as any,calendar:f.calendar as any});
 expect(await failing.request(identities.owner,f.callId,{slot})).toMatchObject({saved:false,appointmentConfirmed:false});
});
it('rejects invalid or past slots and refuses production construction',async()=>{
 const f=fixture();for(const bad of [{...slot,endAt:slot.startAt},{...slot,startAt:'2020-01-01T00:00:00Z',endAt:'2020-01-01T00:30:00Z'},{...slot,timeZone:'Invalid/Zone'}])await expect(f.service.request(identities.owner,f.callId,{slot:bad})).rejects.toThrow();
 vi.stubEnv('NODE_ENV','production');try{expect(()=>createOutboundAppointments({} as any)).toThrow('test-only');}finally{vi.unstubAllEnvs();}
});
it('requires owner authentication at HTTP ingress and rejects authority fields before AJV strips them',async()=>{
 const f=fixture(),app=Fastify({logger:false});
 app.decorate('requireAuth',async(req:any,reply:any)=>{if(req.headers['x-test-owner']!=='yes')return reply.code(401).send({error:'Unauthorized'});req.scope=identities.owner;});
 await app.register(async v=>phoneOutboundAppointmentRoutes(v,f.service),{prefix:'/api/v1'});
 try{
  const url='/api/v1/connectors/phone/ai/calls/'+f.callId+'/appointment-request';
  expect((await app.inject({method:'POST',url,payload:{slot}})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url,headers:{'x-test-owner':'yes'},payload:{slot,workspaceId:'forged'}})).statusCode).toBe(400);
  const response=await app.inject({method:'POST',url,headers:{'x-test-owner':'yes'},payload:{slot}});
  expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({status:'approval_pending',appointmentConfirmed:false});
  expect(response.headers['cache-control']).toBe('no-store');
 }finally{await app.close();}
});
it('creates one synthetic event only after the existing owner approval/PolicyGateway flow, then verifies exact readback',async()=>{
 const f=fixture(),records:any[]=[],secrets=new Map<string,string>();let creates=0;
 const vault=new GoogleCalendarVault(randomBytes(32),{get:k=>secrets.get(k),set:(k,v)=>{secrets.set(k,v);},take:k=>{const v=secrets.get(k);secrets.delete(k);return v;},delete:k=>{secrets.delete(k);}});
 const provider=new SyntheticGoogleCalendarProvider(new Map([['outbound-token',records]]),new Map([['code',{accessToken:'outbound-token',refreshToken:'synthetic-refresh',scope:GOOGLE_CALENDAR_LIVE_SCOPES,expiresIn:3600}]]));
 const foundation=new GoogleCalendarFoundation({provider:{mode:'mock',exchange:provider.exchange.bind(provider),listEvents:provider.listEvents.bind(provider),readEvent:provider.readEvent.bind(provider),getPrimaryCalendar:async()=>({id:'owner@example.test'}),
  createEvent:async input=>{creates++;records.push({id:'outbound-event-'+f.callId,calendarId:'primary',summary:input.summary,startAt:input.startAt,endAt:input.endAt,timeZone:input.timeZone,allDay:false,status:'confirmed',attendees:[]});return {id:records[0].id,status:'confirmed'};}},vault,clientId:'synthetic-client',redirectUri:'https://example.test/calendar/callback',allowWriteScope:true,policyGateway:defaultPolicyGateway,audit:async()=>{}});
 const started=await foundation.start(identities.owner);await foundation.complete(identities.owner,{state:new URL(started.authorizationUrl).searchParams.get('state')!,code:'code'});
 const service=createOutboundAppointments({db:identities.db,calls:f.calls as any,calendar:foundation});
 const app=Fastify({logger:false});app.decorate('requireAuth',async(req:any,reply:any)=>{if(req.headers['x-test-owner']!=='yes')return reply.code(401).send({error:'Unauthorized'});req.scope=identities.owner;});
 await app.register(async v=>approvalRoutes(v,{db:identities.db,googleCalendar:foundation}),{prefix:'/api/v1'});
 try{
  expect(await service.request(identities.owner,f.callId,{slot})).toMatchObject({status:'approval_pending',appointmentConfirmed:false});expect(creates).toBe(0);
  const p=await identities.db.withScopedTransaction(identities.owner,tx=>tx.query(`SELECT p.id,b.approval_request_id FROM plans p JOIN plan_steps s ON s.plan_id=p.id JOIN plan_step_approval_bindings b ON b.step_id=s.id WHERE p.workspace_id=$1 AND p.created_by_user_id=$2 AND p.metadata->>'phoneOutboundCallId'=$3`,[identities.owner.workspaceId,identities.owner.userId,f.callId]));
  const plan=p.rows[0],url='/api/v1/approvals/'+plan.approval_request_id+'/decide';
  expect((await app.inject({method:'POST',url,payload:{status:'approved'}})).statusCode).toBe(401);expect(creates).toBe(0);
  expect((await app.inject({method:'POST',url,headers:{'x-test-owner':'yes'},payload:{status:'approved'}})).statusCode).toBe(200);
  await waitForChatPlanBackgroundExecution(plan.id);
  const duplicateApproval=await app.inject({method:'POST',url,headers:{'x-test-owner':'yes'},payload:{status:'approved'}});expect([200,409]).toContain(duplicateApproval.statusCode);
  await waitForChatPlanBackgroundExecution(plan.id);expect(creates).toBe(1);
  expect(await service.request(identities.owner,f.callId,{slot})).toMatchObject({saved:true,status:'appointment_confirmed',appointmentConfirmed:true,eventId:records[0].id});
  const historic=createOutboundAppointments({db:identities.db,calls:f.calls as any,calendar:foundation,now:()=>Date.parse('2091-01-01T00:00:00Z')});
  expect(await historic.status(identities.owner,f.callId)).toMatchObject({status:'appointment_confirmed',appointmentConfirmed:true,eventId:records[0].id});expect(creates).toBe(1);
  expect(creates).toBe(1);await service.request(identities.owner,f.callId,{slot});expect(creates).toBe(1);
  records[0].status='cancelled';expect(await service.request(identities.owner,f.callId,{slot})).toMatchObject({status:'needs_review',appointmentConfirmed:false});expect(creates).toBe(1);
  expect(await historic.status(identities.owner,f.callId)).toMatchObject({status:'needs_review',appointmentConfirmed:false});expect(creates).toBe(1);
 }finally{await app.close();}
});
