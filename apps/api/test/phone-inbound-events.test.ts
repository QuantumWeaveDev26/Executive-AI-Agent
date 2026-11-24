import {describe,it,expect} from 'vitest';
import {projectInboundEvents,type InboundCallEvent} from '../src/services/phone-inbound-events.js';
import {makeInboundReport} from '../src/services/phone-inbound-reports.js';
const scope={workspaceId:'workspace-a',userId:'owner-a',role:'owner'};
const id='a'.repeat(64),interaction='20261103/synthetic';
const report=(kind:string)=>({...makeInboundReport({id,occurredAt:'2026-11-03T12:00:00Z',callerPhone:'+919000000001',customerName:kind==='callback_requested'?'Ram':null,business:'Retail',serviceNeeded:'Automation',enquirySummary:kind==='call_completed'?'Asked about services and requested follow-up':null,callbackInterest:'unknown'},
 {...scope,direction:'inbound',authenticatedRoute:true}),providerInteractionId:interaction,
 callStatus:kind==='call_completed'?'ended' as const:'unknown' as const,
 outcome:kind==='callback_requested'?'callback_requested' as const:'enquired' as const,
 callbackRequestId:kind==='callback_requested'?'callback-'+id:null,
 callbackConsent:kind==='callback_requested'?'confirmed' as const:kind==='callback_withdrawn'?'declined' as const:'unknown' as const});
const event=(kind:InboundCallEvent['kind'],sequence:number):InboundCallEvent=>({eventId:kind+'-'+id,callId:id,kind,sourceDigest:'0'.repeat(64),sequence,report:report(kind)});
describe('immutable inbound event reconciliation',()=>{
 it('keeps one callback request when a later completion has no repeated customer details',()=>{
  const r=projectInboundEvents(scope,[event('callback_requested',1),event('call_completed',2)]);
  expect(r.id).toBe(id);expect(r.outcome).toBe('callback_requested');expect(r.customerName).toBe('Ram');expect(r.callStatus).toBe('ended');expect(r.enquirySummary).toContain('services');
 });
 it('reconciles completion arriving first without losing its final call state',()=>{
  const r=projectInboundEvents(scope,[event('call_completed',1),event('callback_requested',2)]);
  expect(r.outcome).toBe('callback_requested');expect(r.callStatus).toBe('ended');
 });
 it('withdrawal dominates late/duplicate callback confirmation in every arrival order',()=>{
  for(const events of [[event('callback_requested',1),event('callback_withdrawn',2),event('call_completed',3)],[event('call_completed',1),event('callback_withdrawn',2),event('callback_requested',3)]]){
   const r=projectInboundEvents(scope,events);expect(r.outcome).toBe('needs_review');expect(r.callbackRequestId).toBeNull();expect(r.callbackConsent).toBe('declined');
  }
 });
 it('rejects foreign scopes, mismatched caller binding and duplicate journal sequence',()=>{
  expect(()=>projectInboundEvents({...scope,workspaceId:'other'},[event('call_completed',1)])).toThrow();
  expect(()=>projectInboundEvents(scope,[event('call_completed',1),{...event('callback_requested',2),report:{...report('callback_requested'),callerPhone:'+919000000002',maskedPhone:'•••• 0002'}}])).toThrow();
  expect(()=>projectInboundEvents(scope,[event('call_completed',1),event('callback_requested',1)])).toThrow();
 });
 it('never changes a verified Calendar event into an automatic cancellation on withdrawal',()=>{
  const completion=event('call_completed',2);completion.report={...completion.report,outcome:'booked_appointment',appointment:{eventId:'verified-event',startsAt:'2026-11-04T10:00:00Z',endsAt:'2026-11-04T10:30:00Z',timezone:'Asia/Kolkata',verification:'verified'}};
  const r=projectInboundEvents(scope,[event('callback_withdrawn',1),completion]);expect(r.outcome).toBe('booked_appointment');expect(r.callbackConsent).toBe('declined');expect(r.appointment?.eventId).toBe('verified-event');
 });
 it('does not mutate input snapshots and keeps enquiry-only calls as enquiries',()=>{
  const events=[event('call_completed',1)],before=JSON.stringify(events);expect(projectInboundEvents(scope,events).outcome).toBe('enquired');expect(JSON.stringify(events)).toBe(before);
 });
});
