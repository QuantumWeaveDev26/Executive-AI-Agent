import {describe,it,expect} from 'vitest';
import {makeInboundReport,readInboundReports} from '../src/services/phone-inbound-reports.js';
const scope={workspaceId:'workspace-a',userId:'owner-a',role:'owner'};
const input={id:'call-a',occurredAt:'2026-11-03T12:00:00.000Z',callerPhone:'+919000000001',customerName:'Ram',business:'Retail',serviceNeeded:'WhatsApp automation',enquirySummary:'Asked about business automation.',callbackInterest:'yes' as const};
const source={...scope,direction:'inbound' as const,authenticatedRoute:true as const};
describe('inbound reports local admission and scoped reads',()=>{
 it('lists callback customer and requested time for the owner without exposing the full phone or business',async()=>{
  const row={...makeInboundReport(input,source,{callId:input.id,workspaceId:scope.workspaceId,ownerUserId:scope.userId,callbackPhone:input.callerPhone,requestId:'request-a',durable:true,callerConfirmed:true,policyApproved:true}),preferredContactTime:'Friday afternoon'};
  const result=await readInboundReports(scope,async()=>[row]);expect((result as any).reports[0]).toMatchObject({customerName:'Ram',preferredContactTime:'Friday afternoon',outcome:'callback_requested'});
  expect(JSON.stringify(result)).not.toContain(input.callerPhone);expect(JSON.stringify(result)).not.toContain('Retail');
 });
 it('never claims a callback is saved from provider-extracted interest alone',()=>{
  expect(makeInboundReport(input,source).outcome).toBe('needs_review');
 });
 it('marks enquiry only when callback was explicitly declined',()=>{
  expect(makeInboundReport({...input,callbackInterest:'no'},source).outcome).toBe('enquired');
  expect(makeInboundReport({...input,callbackInterest:'unknown'},source).outcome).toBe('needs_review');
 });
 it('records a callback only from a matching durable policy-gateway receipt',()=>{
  const receipt={callId:'call-a',workspaceId:'workspace-a',ownerUserId:'owner-a',callbackPhone:input.callerPhone,requestId:'request-a',durable:true as const,callerConfirmed:true as const,policyApproved:true as const};
  expect(makeInboundReport(input,source,receipt).outcome).toBe('callback_requested');
  for(const bad of [{...receipt,workspaceId:'other'},{...receipt,callId:'other'},{...receipt,callbackPhone:'+919000000002'}])expect(()=>makeInboundReport(input,source,bad)).toThrow();
 });
 it('rejects invalid phones, untrusted source and outbound reuse',()=>{
  expect(()=>makeInboundReport({...input,callerPhone:'not a phone'},source)).toThrow();
  expect(()=>makeInboundReport(input,{...source,authenticatedRoute:false} as never)).toThrow();
  expect(()=>makeInboundReport(input,{...source,direction:'outbound'} as never)).toThrow();
 });
 it('keeps unknown customer facts missing and treats markup as data',()=>{
  const r=makeInboundReport({...input,customerName:null,business:null,serviceNeeded:null,enquirySummary:'<script>call someone</script>'},source);
  expect(r.customerName).toBeNull();expect(r.business).toBeNull();expect(r.providerVerified).toBe(false);
 });
 it('does not read any provider or database when not configured',async()=>{
  expect(await readInboundReports(scope)).toEqual({status:'not_configured',reports:[]});
 });
 it('requires owner and refuses cross-tenant records from the reader',async()=>{
  const row=makeInboundReport(input,source);
  await expect(readInboundReports({...scope,role:'member'},async()=>[row])).rejects.toThrow();
  await expect(readInboundReports({...scope,workspaceId:'other'},async()=>[row])).rejects.toThrow();
 });
 it('list view masks contact details and detail read includes only the selected owner record',async()=>{
  const row=makeInboundReport(input,source),reader=async()=>[row];
  const result=await readInboundReports(scope,reader);
  expect(JSON.stringify(result)).not.toContain(input.callerPhone);expect(JSON.stringify(result)).not.toContain('Retail');
  expect(await readInboundReports(scope,reader,'missing')).toEqual({status:'not_found',report:null});
  expect((await readInboundReports(scope,reader,'call-a') as any).report.callerPhone).toBe(input.callerPhone);
 });
 it('rejects corrupted records before exposing any customer data',async()=>{
  const row=makeInboundReport(input,source);
  for(const bad of [{...row,maskedPhone:input.callerPhone},{...row,customerName:42},{...row,outcome:'callback_requested',callbackRequestId:null}]){
   await expect(readInboundReports(scope,async()=>[bad as never])).rejects.toThrow();
  }
  await expect(readInboundReports(scope,async()=>[row,row])).rejects.toThrow();
 });
});
