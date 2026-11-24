import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,it,expect,vi} from 'vitest';
import {createPhoneAppointmentReview,preparePhoneAppointment,readPhoneAppointmentReview,readPhoneAppointmentStatus,type PhoneAppointmentReviewApi} from '../src/phone-appointment-review';
import {PhoneAppointmentReview} from '../src/PhoneAppointmentReview';
const id='a'.repeat(64),planId='11111111-1111-4111-8111-111111111111',approvalId='22222222-2222-4222-8222-222222222222';
const owner={role:'owner',userId:'owner',workspaceId:'workspace'};
const slot={startAt:'2090-11-05T09:00:00Z',endAt:'2090-11-05T09:30:00Z',timeZone:'Asia/Kolkata'};
const params={...slot,summary:'Customer appointment',connectedCalendar:'owner@example.test',attendees:[],sendUpdates:'none',origin:'thaara_ui'};
const pending={saved:true as const,requestId:id,status:'approval_pending' as const,appointmentConfirmed:false as const,calendarApproval:{planId,approvalId}};
function fixture(){
 const plan:any={id:planId,workspace_id:owner.workspaceId,created_by_user_id:owner.userId,status:'awaiting_approval',metadata:{phoneInboundRequestId:id,phoneSlot:slot},steps:[{id:'step',plan_id:planId,action_name:'calendar.events.create',parameters:params,status:'awaiting_approval'}],receipts:[]};
 const approval:any={id:approvalId,workspaceId:owner.workspaceId,requesterUserId:owner.userId,actionName:'calendar.events.create',actionParams:params,status:'pending',expiresAt:'2099-01-01T00:00:00Z',riskLevel:'medium'};
 const api={prepare:vi.fn(async()=>pending),status:vi.fn(async()=>pending as any),plan:vi.fn(async()=>plan),approvals:vi.fn(async()=>[approval]),decide:vi.fn(async()=>({...approval,status:'approved'}))};
 const controller=createPhoneAppointmentReview({direction:'inbound',id,owner,api:api as PhoneAppointmentReviewApi});
 return {api,plan,approval,controller};
}
afterEach(()=>vi.unstubAllGlobals());
it('checks existing appointments with an authenticated GET and rejects a different confirmed slot',async()=>{
 const confirmed={saved:true,requestId:id,status:'appointment_confirmed',appointmentConfirmed:true,eventId:'calendar-event',...slot};
 const fetcher=vi.fn(async()=>({ok:true,status:200,json:async()=>confirmed}));vi.stubGlobal('fetch',fetcher);
 await expect(readPhoneAppointmentStatus('inbound',id,slot)).resolves.toEqual(confirmed);
 expect(fetcher.mock.calls[0][0]).toBe('/api/v1/connectors/phone/inbound/reports/'+id+'/appointment-status');
 const options=(fetcher.mock.calls[0] as any)[1];expect(options.method??'GET').toBe('GET');expect(options.credentials).toBe('include');expect(options.body).toBeUndefined();
 fetcher.mockResolvedValueOnce({ok:true,status:200,json:async()=>({...confirmed,endAt:'2090-11-05T10:00:00Z'})});
 await expect(readPhoneAppointmentStatus('inbound',id,slot)).rejects.toThrow('verified');
});
it('refresh and approval read status without posting a second proposal',async()=>{
 const f=fixture();await f.controller.prepare(slot);await f.controller.refresh();await f.controller.decide('approved');
 expect(f.api.prepare).toHaveBeenCalledTimes(1);expect(f.api.status).toHaveBeenCalledTimes(2);expect(f.api.decide).toHaveBeenCalledTimes(1);
});
it('restores a historical confirmed event and clears confirmation after failed verification',async()=>{
 const f=fixture(),historical={...slot,startAt:'2020-01-01T09:00:00Z',endAt:'2020-01-01T09:30:00Z'};
 f.plan.metadata.phoneSlot=historical;f.plan.steps[0].parameters={...params,...historical};f.approval.actionParams=f.plan.steps[0].parameters;
 f.api.status.mockResolvedValue({saved:true,requestId:id,status:'appointment_confirmed',appointmentConfirmed:true,eventId:'existing-event',...historical});
 const controller=createPhoneAppointmentReview({direction:'inbound',id,owner,api:{...f.api,restore:async()=>({slot:historical,calendarApproval:{planId,approvalId}})}});
 await controller.restore();expect(controller.snapshot().response?.appointmentConfirmed).toBe(true);expect(f.api.prepare).not.toHaveBeenCalled();
 f.api.status.mockRejectedValueOnce(Error('unavailable'));await controller.refresh();
 expect(controller.snapshot().response).toBeUndefined();expect(controller.snapshot().error).toContain('no appointment is confirmed');
});
it('uses the authenticated outbound GET for saved reviews without preparing a new proposal',async()=>{
 const callId='33333333-3333-4333-8333-333333333333',fetcher=vi.fn(async()=>({ok:true,status:200,json:async()=>({status:'not_prepared',slot:null,calendarApproval:null})}));vi.stubGlobal('fetch',fetcher);
 await expect(readPhoneAppointmentReview(callId,'outbound')).resolves.toBeNull();
 expect(fetcher.mock.calls[0][0]).toBe('/api/v1/connectors/phone/ai/calls/'+callId+'/appointment-review');
 expect((fetcher.mock.calls[0] as any)[1].credentials).toBe('include');
 await expect(readPhoneAppointmentReview(id,'outbound')).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
});
it('restores an outbound Calendar approval without preparing another proposal or deciding it',async()=>{
 const f=fixture(),callId='33333333-3333-4333-8333-333333333333';
 f.plan.metadata={phoneOutboundCallId:callId,phoneSlot:slot};
 const restore=vi.fn(async()=>({slot,calendarApproval:{planId,approvalId}}));
 const controller=createPhoneAppointmentReview({direction:'outbound',id:callId,owner,api:{...f.api,restore} as PhoneAppointmentReviewApi});
 await controller.restore();expect(restore).toHaveBeenCalledWith(callId,'outbound');expect(controller.snapshot().approval?.id).toBe(approvalId);
 expect(f.api.prepare).not.toHaveBeenCalled();expect(f.api.decide).not.toHaveBeenCalled();
});
it('prepares a review without deciding, then uses existing Calendar approval once on double taps',async()=>{
 const f=fixture();await f.controller.prepare(slot);expect(f.controller.snapshot().approval?.id).toBe(approvalId);expect(f.api.decide).not.toHaveBeenCalled();
 await Promise.all([f.controller.decide('approved'),f.controller.decide('approved')]);expect(f.api.decide).toHaveBeenCalledTimes(1);expect(f.api.decide).toHaveBeenCalledWith(approvalId,'approved');
 await f.controller.decide('approved');expect(f.api.decide).toHaveBeenCalledTimes(1);
});
it('never retries an uncertain approval automatically',async()=>{
 const f=fixture();await f.controller.prepare(slot);f.api.decide.mockRejectedValueOnce(Error('network'));
 await f.controller.decide('approved');await f.controller.decide('approved');expect(f.api.decide).toHaveBeenCalledTimes(1);expect(f.controller.snapshot().error).toContain('Check');
 await f.controller.refresh();const html=renderToStaticMarkup(<PhoneAppointmentReview id={id} direction="inbound" owner={owner} customerName="Ram" requestedTime={null} consentConfirmed initialState={f.controller.snapshot()}/>);
 expect(html).not.toContain('data-testid="calendar-mutation-chat-confirm"');expect(html).toContain('An approval was already submitted');
});
it('restores an existing approval without a proposal POST or an automatic approval',async()=>{
 const f=fixture(),restore=vi.fn(async()=>({slot,calendarApproval:{planId,approvalId}}));
 const controller=createPhoneAppointmentReview({direction:'inbound',id,owner,api:{...f.api,restore}});await controller.restore();
 expect(controller.snapshot().approval?.id).toBe(approvalId);expect(restore).toHaveBeenCalledOnce();expect(f.api.prepare).not.toHaveBeenCalled();expect(f.api.decide).not.toHaveBeenCalled();
});
it('blocks non-owners and mismatched request, workspace, requester, action or slot bindings',async()=>{
 const f=fixture(),member=createPhoneAppointmentReview({direction:'inbound',id,owner:{...owner,role:'member'},api:f.api});await member.prepare(slot);expect(f.api.prepare).not.toHaveBeenCalled();
 for(const change of [{workspace_id:'foreign'},{created_by_user_id:'foreign'},{metadata:{phoneInboundRequestId:'foreign',phoneSlot:slot}},{steps:[{...f.plan.steps[0],action_name:'gmail.messages.send_new'}]}]){
  const x=fixture();x.api.plan.mockResolvedValueOnce({...x.plan,...change});await x.controller.prepare(slot);await x.controller.decide('approved');expect(x.api.decide).not.toHaveBeenCalled();expect(x.controller.snapshot().error).toBeTruthy();
 }
 const x=fixture();x.api.approvals.mockResolvedValueOnce([{...x.approval,actionParams:{...params,endAt:'2090-11-05T10:00:00Z'}}]);await x.controller.prepare(slot);await x.controller.decide('approved');expect(x.api.decide).not.toHaveBeenCalled();
});
it('requires backend verified event readback before showing a confirmed booking',async()=>{
 const f=fixture();await f.controller.prepare(slot);
 f.plan.status='completed';f.plan.receipts=[{status:'verified'}];await f.controller.refresh();
 expect(f.controller.snapshot().response?.appointmentConfirmed).toBe(false);
 const html=renderToStaticMarkup(<PhoneAppointmentReview id={id} direction="inbound" owner={owner} customerName="Ram" requestedTime="Tomorrow afternoon" consentConfirmed initialState={f.controller.snapshot()}/>);
 expect(html).not.toContain('Meeting scheduled');expect(html).not.toContain('Appointment confirmed');expect(html).toContain('not confirmed');
});
it('shows the existing Calendar card, request name/time and escapes customer input',async()=>{
 const f=fixture();await f.controller.prepare(slot);
 const html=renderToStaticMarkup(<PhoneAppointmentReview id={id} direction="inbound" owner={owner} customerName="<script>Ram</script>" requestedTime="Tomorrow afternoon" consentConfirmed initialState={f.controller.snapshot()}/>);
 expect(html).toContain('calendar-mutation-chat-card');expect(html).toContain('Approve &amp; Schedule');expect(html).toContain('Tomorrow afternoon');expect(html).not.toContain('<script>');
 expect(renderToStaticMarkup(<PhoneAppointmentReview id={id} direction="inbound" owner={{...owner,role:'member'}} customerName="Private Ram" requestedTime="Private time" consentConfirmed/>)).not.toContain('Private');
});
it('does not offer proposal creation without recorded consent',()=>{
 const html=renderToStaticMarkup(<PhoneAppointmentReview id={id} direction="inbound" owner={owner} customerName="Ram" requestedTime={null} consentConfirmed={false}/>);
 expect(html).not.toContain('Prepare Calendar review');expect(html).toContain('consent');
});
it('uses authenticated/CSRF API transport and does not accept a forged confirmation',async()=>{
 vi.stubGlobal('document',{cookie:'thaara_csrf=synthetic-csrf'});const fetcher=vi.fn(async()=>({ok:true,status:200,json:async()=>pending}));vi.stubGlobal('fetch',fetcher);
 await expect(preparePhoneAppointment('inbound',id,slot)).resolves.toEqual(pending);
 expect(fetcher.mock.calls[0][0]).toBe('/api/v1/connectors/phone/inbound/reports/'+id+'/appointment-proposal');
 const options=(fetcher.mock.calls[0] as any)[1];expect(options.credentials).toBe('include');expect(options.headers.get('x-csrf-token')).toBe('synthetic-csrf');expect(JSON.parse(options.body)).toEqual({slot});
 fetcher.mockResolvedValueOnce({ok:true,status:200,json:async()=>({...pending,appointmentConfirmed:true})});await expect(preparePhoneAppointment('inbound',id,slot)).rejects.toThrow();
 fetcher.mockResolvedValueOnce({ok:false,status:403,json:async()=>({})});await expect(preparePhoneAppointment('inbound',id,slot)).rejects.toThrow();
});
