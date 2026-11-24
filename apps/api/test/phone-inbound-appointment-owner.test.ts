import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import Fastify from 'fastify';
import {phoneContactsDatabase} from './helpers/phone-contacts-fixture.js';
import {makeInboundReport} from '../src/services/phone-inbound-reports.js';
import {createInboundAppointmentOwnerReview} from '../src/services/phone-inbound-appointment-owner.js';
import {phoneInboundAppointmentOwnerRoutes} from '../src/routes/phone-inbound-appointment-owner.js';
import {createPhoneAppointmentCalendarReceiptReader} from '../src/services/phone-appointment-calendar.js';

let identities:Awaited<ReturnType<typeof phoneContactsDatabase>>;
beforeAll(async()=>{identities=await phoneContactsDatabase();});
afterAll(async()=>{await identities?.db.close();});
const slot={startAt:'2090-11-05T09:00:00Z',endAt:'2090-11-05T09:30:00Z',timeZone:'Asia/Kolkata'};
let counter=0;
function fixture(){
 const id=(++counter).toString(16).padStart(64,'0'),owner=identities.owner;
 const row={...makeInboundReport({id,occurredAt:'2026-11-05T00:00:00Z',callerPhone:'+919000000001',customerName:'Ram',business:'Retail',serviceNeeded:'Automation',enquirySummary:'Requested a discussion',callbackInterest:'yes'},
  {...owner,direction:'inbound',authenticatedRoute:true}),outcome:'callback_requested',callbackConsent:'confirmed',callbackRequestId:'callback-'+id,providerInteractionId:'20261105/owner-review-'+counter};
 const repository={read:vi.fn(async()=>structuredClone(row))};
 const calendar={writeReadiness:vi.fn(async()=>({ready:true,connectedCalendar:'owner@example.test'})),findConflicts:vi.fn(async()=>[]),listEvents:vi.fn(async()=>({events:[]})),readEvent:vi.fn()};
 const service=createInboundAppointmentOwnerReview({db:identities.db,repository:repository as any,calendar:calendar as any});
 return {id,row,repository,calendar,service};
}
it('reads historical appointment status without creating a missing plan or checking a new slot',async()=>{
 const f=fixture();expect(await f.service.status(identities.owner,f.id)).toMatchObject({saved:true,status:'request_saved',appointmentConfirmed:false});
 expect(f.calendar.writeReadiness).not.toHaveBeenCalled();
 const prepared=await f.service.request(identities.owner,f.id,{slot});
 const historical=createInboundAppointmentOwnerReview({db:identities.db,repository:f.repository as any,calendar:f.calendar as any,now:()=>Date.parse('2091-01-01T00:00:00Z')});
 expect(await historical.status(identities.owner,f.id)).toMatchObject({status:'approval_pending',calendarApproval:(prepared as any).calendarApproval,appointmentConfirmed:false});
 expect(f.calendar.findConflicts).toHaveBeenCalledTimes(1);
 await expect(historical.status(identities.member,f.id)).rejects.toThrow();
 f.calendar.writeReadiness.mockRejectedValueOnce(Error('private'));await expect(historical.status(identities.owner,f.id)).resolves.toMatchObject({saved:true,status:'needs_review',appointmentConfirmed:false});
});
it('reads only an existing verified Calendar outcome and never creates a proposal while loading the dashboard',async()=>{
 const f=fixture(),read=createPhoneAppointmentCalendarReceiptReader({db:identities.db,calendar:f.calendar as any});
 expect(await read(identities.owner,f.row as any)).toBeNull();expect(f.calendar.writeReadiness).not.toHaveBeenCalled();
 await f.service.request(identities.owner,f.id,{slot});f.calendar.findConflicts.mockClear();
 expect(await read(identities.owner,f.row as any)).toBeNull();expect(f.calendar.findConflicts).not.toHaveBeenCalled();expect(f.calendar.readEvent).not.toHaveBeenCalled();
 const plans=await identities.db.withScopedTransaction(identities.owner,tx=>tx.query(`SELECT id FROM plans WHERE metadata->>'phoneInboundRequestId'=$1`,[f.id]));expect(plans.rows).toHaveLength(1);
 await expect(read(identities.member,f.row as any)).rejects.toThrow();
 await expect(read(identities.owner,{...f.row,ownerUserId:identities.foreign.userId} as any)).rejects.toThrow();
});
it('prepares an approval from the saved inbound request using the current owner session, without provider delegation',async()=>{
 const f=fixture(),r=await f.service.request(identities.owner,f.id,{slot});
 expect(r).toMatchObject({saved:true,status:'approval_pending',appointmentConfirmed:false,requestId:f.id});
 expect(r).toHaveProperty('calendarApproval.planId');expect(r).toHaveProperty('calendarApproval.approvalId');
 const found=await identities.db.withScopedTransaction(identities.owner,tx=>tx.query(`SELECT metadata,status FROM plans WHERE metadata->>'phoneInboundRequestId'=$1`,[f.id]));
 expect(found.rows).toHaveLength(1);expect(found.rows[0].metadata.phoneInteractionId).toBe(f.row.providerInteractionId);expect(found.rows[0].status).toBe('awaiting_approval');
 expect(await f.service.request(identities.owner,f.id,{slot})).toEqual(r);
});
it('restores the same saved approval and slot with a read-only review, without creating another proposal',async()=>{
 const f=fixture();expect(await f.service.review(identities.owner,f.id)).toEqual({status:'not_prepared',slot:null,calendarApproval:null});expect(f.calendar.writeReadiness).not.toHaveBeenCalled();
 const prepared=await f.service.request(identities.owner,f.id,{slot});f.calendar.writeReadiness.mockClear();
 expect(await f.service.review(identities.owner,f.id)).toEqual({status:'ready',slot,calendarApproval:(prepared as any).calendarApproval});expect(f.calendar.writeReadiness).not.toHaveBeenCalled();
 await expect(f.service.review(identities.member,f.id)).rejects.toThrow();
});
it('rejects members and mismatched sessions before reading stored customer data',async()=>{
 const f=fixture();for(const scope of [identities.member,{...identities.owner,sessionTokenHash:identities.foreign.sessionTokenHash}])await expect(f.service.request(scope,f.id,{slot})).rejects.toThrow();
 expect(f.repository.read).not.toHaveBeenCalled();expect(f.calendar.writeReadiness).not.toHaveBeenCalled();
});
it('rejects missing, foreign, unconsented or incorrectly bound reports before Calendar access',async()=>{
 for(const change of [null,{ownerUserId:identities.foreign.userId},{workspaceId:identities.foreign.workspaceId},{id:'f'.repeat(64)},{callbackConsent:'unknown'},{callbackConsent:'declined'},{callerPhone:null},{providerInteractionId:'forged'}]){
  const f=fixture();f.repository.read.mockResolvedValueOnce(change===null?null as any:{...f.row,...change} as any);
  await expect(f.service.request(identities.owner,f.id,{slot})).rejects.toThrow();expect(f.calendar.writeReadiness).not.toHaveBeenCalled();
 }
});
it('keeps the durable request saved on Calendar/storage failure, never confirms or claims a new save',async()=>{
 const f=fixture();f.calendar.writeReadiness.mockRejectedValueOnce(Error('PRIVATE Calendar error'));
 expect(await f.service.request(identities.owner,f.id,{slot})).toMatchObject({saved:true,status:'request_saved',appointmentConfirmed:false});
 f.repository.read.mockRejectedValueOnce(Error('PRIVATE storage error'));
 await expect(f.service.request(identities.owner,f.id,{slot})).rejects.toThrow('Inbound appointment review is unavailable.');
});
it('HTTP route requires owner login, rejects forged authority and stays disabled in production',async()=>{
 const f=fixture(),app=Fastify({logger:false});app.decorate('requireAuth',async(req:any,reply:any)=>{if(req.headers['x-test-owner']!=='yes')return reply.code(401).send({error:'Unauthorized'});req.scope=identities.owner;});
 await app.register(async v=>phoneInboundAppointmentOwnerRoutes(v,f.service),{prefix:'/api/v1'});
 try{const url='/api/v1/connectors/phone/inbound/reports/'+f.id+'/appointment-proposal';
  expect((await app.inject({method:'POST',url,payload:{slot}})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url,headers:{'x-test-owner':'yes'},payload:{slot,ownerUserId:'forged'}})).statusCode).toBe(400);
  expect((await app.inject({method:'POST',url,headers:{'x-test-owner':'yes'},payload:{slot}})).json()).toMatchObject({status:'approval_pending',appointmentConfirmed:false});
  const again=await app.inject({method:'POST',url,headers:{'x-test-owner':'yes'},payload:{slot}});expect(again.json()).toHaveProperty('calendarApproval.planId');
  const reviewUrl='/api/v1/connectors/phone/inbound/reports/'+f.id+'/appointment-review';
  expect((await app.inject({method:'GET',url:reviewUrl})).statusCode).toBe(401);
  const restored=await app.inject({method:'GET',url:reviewUrl,headers:{'x-test-owner':'yes'}});expect(restored.statusCode).toBe(200);expect(restored.json()).toMatchObject({status:'ready',calendarApproval:again.json().calendarApproval});expect(restored.headers['cache-control']).toBe('no-store');
  const statusUrl='/api/v1/connectors/phone/inbound/reports/'+f.id+'/appointment-status';
  expect((await app.inject({method:'GET',url:statusUrl})).statusCode).toBe(401);
  const status=await app.inject({method:'GET',url:statusUrl,headers:{'x-test-owner':'yes'}});expect(status.statusCode,status.body).toBe(200);expect(status.json()).toMatchObject({status:'approval_pending',appointmentConfirmed:false});expect(status.headers['cache-control']).toBe('no-store');
 }finally{await app.close();}
 vi.stubEnv('NODE_ENV','production');try{expect(()=>createInboundAppointmentOwnerReview({} as any)).toThrow('test-only');}finally{vi.unstubAllEnvs();}
});
