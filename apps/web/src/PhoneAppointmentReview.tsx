import {useEffect,useMemo,useState} from 'react';
import {CalendarMutationChatCard} from './CalendarMutationCard';
import {canUserDecideApproval} from './api';
import {createPhoneAppointmentReview,type AppointmentOwner,type PhoneAppointmentReviewState} from './phone-appointment-review';

export function PhoneAppointmentReview(p:{id:string;direction:'inbound'|'outbound';owner:AppointmentOwner;customerName:string|null;requestedTime:string|null;consentConfirmed:boolean;initialState?:PhoneAppointmentReviewState}){
 const controller=useMemo(()=>createPhoneAppointmentReview({id:p.id,direction:p.direction,owner:p.owner}),[p.id,p.direction,p.owner.role,p.owner.userId,p.owner.workspaceId]);
 const [state,setState]=useState(p.initialState??controller.snapshot()),[start,setStart]=useState(''),[end,setEnd]=useState(''),[inputError,setInputError]=useState<string|null>(null);
 useEffect(()=>{setState(p.initialState??controller.snapshot());const unsubscribe=controller.subscribe(setState);
  if(!p.initialState&&p.owner.role==='owner'&&p.owner.userId&&p.owner.workspaceId&&(p.direction==='outbound'||p.consentConfirmed))void controller.restore();
  return unsubscribe;
 },[controller,p.consentConfirmed]);
 if(p.owner.role!=='owner'||!p.owner.userId||!p.owner.workspaceId)return <p>Only the signed-in owner can review appointment requests.</p>;
 if(p.direction==='inbound'&&!p.consentConfirmed)return <p>Recorded caller consent is required before preparing an appointment.</p>;
 const prepare=()=>{
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(end)){setInputError('Choose a start and end time in IST.');return;}
  const a=new Date(start+':00+05:30'),b=new Date(end+':00+05:30');
  if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime())||a.getTime()<=Date.now()||b<=a){setInputError('Choose a future appointment with an end after its start.');return;}
  setInputError(null);void controller.prepare({startAt:a.toISOString(),endAt:b.toISOString(),timeZone:'Asia/Kolkata'});
 };
 const decision=state.approval?canUserDecideApproval(p.owner.role,p.owner.userId,state.approval):{canDecide:false};
 const confirmed=state.response?.appointmentConfirmed===true;
 return <section aria-label="Appointment review">
  <h3>Review &amp; Approve appointment</h3>
  <p><strong>Customer:</strong> {p.customerName??'Not recorded'}</p><p><strong>Requested time:</strong> {p.requestedTime??'Not recorded — choose a proposed time below'}</p>
  <p role="status">{confirmed?'Appointment confirmed.':state.response?.status==='slot_unavailable'?'That time is unavailable. Appointment not confirmed.':state.response?.status==='approval_pending'?(state.approval?.status==='approved'?'Calendar approval recorded. Check booking status; appointment not confirmed.':'Awaiting Calendar approval. Appointment not confirmed.'):state.response?.saved===false?'The Calendar proposal was not saved. Appointment not confirmed.':state.response?.saved?'Request saved. Appointment not confirmed.':'Appointment not confirmed.'}</p>
  {!state.plan&&!confirmed&&<div>
   <label>Appointment start (IST)<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)} disabled={state.busy}/></label>
   <label>Appointment end (IST)<input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)} disabled={state.busy}/></label>
   <button className="btn btn-primary" type="button" disabled={state.busy||!!state.error} onClick={prepare}>{state.busy?'Checking…':'Prepare Calendar review'}</button>
   <p>This checks availability and prepares the existing Calendar approval. It does not book immediately.</p>
  </div>}
  {state.plan&&state.plan.status!=='completed'&&state.approval&&<CalendarMutationChatCard plan={state.plan} approval={state.approval} canDecide={decision.canDecide&&!state.error&&!state.approvalAttempted} decideReason={state.approvalAttempted?'An approval was already submitted. Check booking status; do not approve again.':decision.reason} deciding={state.busy} refreshing={state.busy} onConfirm={()=>void controller.decide('approved')} onCancel={()=>void controller.decide('rejected')} onRefresh={()=>void controller.refresh()}/>}
  {state.response&&<button className="btn btn-secondary" type="button" disabled={state.busy} onClick={()=>void controller.refresh()}>Check booking status</button>}
  {confirmed&&<p>Verified Calendar event: {state.response?.eventId}</p>}
  {(state.error||inputError)&&<p role="alert">{state.error??inputError}</p>}
  {state.error&&<button className="btn btn-secondary" type="button" disabled={state.busy} onClick={()=>void controller.restore()}>Reload saved review</button>}
 </section>;
}
