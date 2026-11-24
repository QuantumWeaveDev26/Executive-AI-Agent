import {request,getPlanWithSteps,listApprovals,decideApproval,canUserDecideApproval,type PlanWithStepsItem,type ApprovalRequestItem} from './api';
export interface AppointmentSlot{startAt:string;endAt:string;timeZone:string}
export interface AppointmentOwner{role:string;userId:string;workspaceId:string}
export interface PhoneAppointmentResponse{
 saved:boolean;requestId?:string;status:'request_saved'|'approval_pending'|'slot_unavailable'|'appointment_confirmed'|'needs_review'|'request_not_saved';appointmentConfirmed:boolean;
 calendarApproval?:{planId:string;approvalId:string};eventId?:string;startAt?:string;endAt?:string;timeZone?:string;
}
export interface PhoneAppointmentReviewState{busy:boolean;error:string|null;approvalAttempted?:boolean;slot?:AppointmentSlot;response?:PhoneAppointmentResponse;plan?:PlanWithStepsItem;approval?:ApprovalRequestItem}
export interface PhoneAppointmentReviewApi{
 prepare:(direction:'inbound'|'outbound',id:string,slot:AppointmentSlot)=>Promise<PhoneAppointmentResponse>;
 plan:typeof getPlanWithSteps;approvals:typeof listApprovals;decide:typeof decideApproval;
 restore?:(id:string,direction?:'inbound'|'outbound')=>Promise<{slot:AppointmentSlot;calendarApproval:{planId:string;approvalId:string}}|null>;
 status?:(direction:'inbound'|'outbound',id:string,slot:AppointmentSlot)=>Promise<PhoneAppointmentResponse>;
}
const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
const hash=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const equalSlot=(a:Record<string,unknown>,b:AppointmentSlot)=>a.startAt===b.startAt&&a.endAt===b.endAt&&a.timeZone===b.timeZone;
const canonical=(v:unknown):string=>JSON.stringify(v,(_k,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);
export async function preparePhoneAppointment(direction:'inbound'|'outbound',id:string,slot:AppointmentSlot):Promise<PhoneAppointmentResponse>{
 if(direction!=='inbound'&&direction!=='outbound'||!(direction==='inbound'?hash(id):uuid(id)))throw Error('Invalid appointment request.');
 const base=direction==='inbound'?`/api/v1/connectors/phone/inbound/reports/${id}/appointment-proposal`:`/api/v1/connectors/phone/ai/calls/${id}/appointment-request`;
 const value=await request<PhoneAppointmentResponse>(base,{method:'POST',cache:'no-store',body:JSON.stringify({slot})});
 return validateAppointmentResponse(value,direction,id,slot);
}
function validateAppointmentResponse(value:PhoneAppointmentResponse,direction:'inbound'|'outbound',id:string,slot:AppointmentSlot){
 const allowed=['saved','requestId','status','appointmentConfirmed','calendarApproval','eventId','startAt','endAt','timeZone'];
 if(!value||Object.keys(value).some(k=>!allowed.includes(k))||typeof value.saved!=='boolean'||typeof value.appointmentConfirmed!=='boolean'
  ||!['request_saved','approval_pending','slot_unavailable','appointment_confirmed','needs_review','request_not_saved'].includes(value.status)
  ||value.saved&&(!hash(value.requestId)||direction==='inbound'&&value.requestId!==id)
  ||value.appointmentConfirmed!==(value.status==='appointment_confirmed'))throw Error('Appointment response could not be verified. No booking is confirmed.');
 if(value.calendarApproval&&(!uuid(value.calendarApproval.planId)||!uuid(value.calendarApproval.approvalId)||Object.keys(value.calendarApproval).sort().join(',')!=='approvalId,planId'))throw Error('Calendar approval could not be verified.');
 if(value.status==='approval_pending'&&(!value.saved||!value.calendarApproval))throw Error('Saved request has no verified Calendar approval.');
 if(value.appointmentConfirmed){if(!value.saved||typeof value.eventId!=='string'||!value.eventId||value.eventId.length>256||!equalSlot(value as unknown as Record<string,unknown>,slot))throw Error('Calendar event could not be verified.');}
 else if(['eventId','startAt','endAt','timeZone'].some(k=>k in value))throw Error('Unconfirmed request contains an unexpected booking.');
 return value;
}
/** Reads an existing booking and its Calendar evidence; never submits another appointment proposal. */
export async function readPhoneAppointmentStatus(direction:'inbound'|'outbound',id:string,slot:AppointmentSlot):Promise<PhoneAppointmentResponse>{
 if(direction!=='inbound'&&direction!=='outbound'||!(direction==='inbound'?hash(id):uuid(id)))throw Error('Invalid appointment request.');
 const url=direction==='inbound'?`/api/v1/connectors/phone/inbound/reports/${id}/appointment-status`:`/api/v1/connectors/phone/ai/calls/${id}/appointment-status`;
 return validateAppointmentResponse(await request<PhoneAppointmentResponse>(url,{cache:'no-store'}),direction,id,slot);
}
export async function readPhoneAppointmentReview(id:string,direction:'inbound'|'outbound'='inbound'){
 if(direction!=='inbound'&&direction!=='outbound'||!(direction==='inbound'?hash(id):uuid(id)))throw Error('Invalid appointment request.');
 const url=direction==='inbound'?`/api/v1/connectors/phone/inbound/reports/${id}/appointment-review`:`/api/v1/connectors/phone/ai/calls/${id}/appointment-review`;
 const r=await request<{status:string;slot:AppointmentSlot|null;calendarApproval:{planId:string;approvalId:string}|null}>(url,{cache:'no-store'});
 if(!r||Object.keys(r).sort().join(',')!=='calendarApproval,slot,status')throw Error('Saved Calendar review could not be verified.');
 if(r.status==='not_prepared'&&r.slot===null&&r.calendarApproval===null)return null;
 if(r.status!=='ready'||!r.slot||Object.keys(r.slot).sort().join(',')!=='endAt,startAt,timeZone'||!Number.isFinite(Date.parse(r.slot.startAt))||!Number.isFinite(Date.parse(r.slot.endAt))||Date.parse(r.slot.endAt)<=Date.parse(r.slot.startAt)
  ||typeof r.slot.timeZone!=='string'||!r.calendarApproval||!uuid(r.calendarApproval.planId)||!uuid(r.calendarApproval.approvalId)||Object.keys(r.calendarApproval).sort().join(',')!=='approvalId,planId')throw Error('Saved Calendar review could not be verified.');
 return {slot:r.slot,calendarApproval:r.calendarApproval};
}
const defaultApi:PhoneAppointmentReviewApi={prepare:preparePhoneAppointment,plan:getPlanWithSteps,approvals:listApprovals,decide:decideApproval,restore:readPhoneAppointmentReview,status:readPhoneAppointmentStatus};
/** UI orchestration only. All authority/one-use execution remains in the existing server Calendar workflow. */
export function createPhoneAppointmentReview(options:{direction:'inbound'|'outbound';id:string;owner:AppointmentOwner;api?:PhoneAppointmentReviewApi}){
 const {direction,id}=options,owner=Object.freeze({...options.owner}),api=options.api??defaultApi;
 let state:PhoneAppointmentReviewState={busy:false,error:null},closed=false;
 const listeners=new Set<(s:PhoneAppointmentReviewState)=>void>(),attempted=new Set<string>();
 const update=(patch:Partial<PhoneAppointmentReviewState>)=>{if(closed)return;state={...state,...patch};for(const listener of listeners)listener(structuredClone(state));};
 const authorized=()=>owner.role==='owner'&&!!owner.userId&&!!owner.workspaceId;
 async function context(response:PhoneAppointmentResponse,slot:AppointmentSlot){
  update({response,plan:undefined,approval:undefined});
  if(response.status!=='approval_pending')return;
  const handles=response.calendarApproval;if(!handles)throw Error('Calendar approval is unavailable.');
  const [plan,approvals]=await Promise.all([api.plan(handles.planId),api.approvals()]);
  if(!Array.isArray(approvals))throw Error('Calendar approval could not be verified.');
  const matches=approvals.filter(a=>a.id===handles.approvalId),approval=matches[0],step=plan.steps?.[0];
  const key=direction==='inbound'?'phoneInboundRequestId':'phoneOutboundCallId';
  if(plan.id!==handles.planId||plan.workspace_id!==owner.workspaceId||plan.created_by_user_id!==owner.userId||plan.metadata?.[key]!==id
   ||!equalSlot((plan.metadata.phoneSlot??{}) as Record<string,unknown>,slot)||plan.steps.length!==1||step?.action_name!=='calendar.events.create'
   ||step.plan_id!==plan.id||!equalSlot(step.parameters,slot)||matches.length!==1||!approval||approval.workspaceId!==owner.workspaceId
   ||approval.requesterUserId!==owner.userId||approval.actionName!=='calendar.events.create'||canonical(step.parameters)!==canonical(approval.actionParams))throw Error('Calendar approval does not match this owner and call request.');
  update({plan,approval,approvalAttempted:attempted.has(approval.id)});
 }
 const load=async(slot:AppointmentSlot)=>context(await api.prepare(direction,id,slot),slot);
 const readStatus=async(slot:AppointmentSlot)=>{
  // Production UI uses the GET status path. Older injected local fixtures may omit this optional port.
  if(!api.status)throw Error('Read-only appointment status is unavailable.');
  return context(await api.status(direction,id,slot),slot);
 };
 return {
  snapshot:()=>structuredClone(state),subscribe:(listener:(s:PhoneAppointmentReviewState)=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},dispose:()=>{closed=true;listeners.clear();},
  async restore(){
   if(state.busy||closed||!authorized()||!api.restore)return;update({busy:true,error:null});
   try{const saved=await api.restore(id,direction);if(saved){update({slot:saved.slot});await context({saved:true,requestId:id,status:'approval_pending',appointmentConfirmed:false,calendarApproval:saved.calendarApproval},saved.slot);if(api.status)await readStatus(saved.slot);}else{update({slot:undefined,response:undefined,plan:undefined,approval:undefined});}}
   catch{update({response:undefined,plan:undefined,approval:undefined,error:'Saved Calendar review is unavailable. Check the request before preparing another proposal. No appointment is confirmed.'});}finally{update({busy:false});}
  },
  async prepare(slot:AppointmentSlot){
   if(state.busy||closed)return;if(!authorized()){update({error:'Only the signed-in owner can review appointments.'});return;}
   update({busy:true,error:null,slot:structuredClone(slot)});
   try{await load(slot);}catch{update({plan:undefined,approval:undefined,error:'Could not verify the Calendar review. Check the saved request before trying again. No appointment is confirmed.'});}finally{update({busy:false});}
  },
  async refresh(){if(state.busy||closed||!authorized()||!state.slot)return;update({busy:true,error:null});try{await readStatus(state.slot);}catch{update({plan:undefined,approval:undefined,response:undefined,error:'Check the saved request. Calendar status could not be verified; no appointment is confirmed.'});}finally{update({busy:false});}},
  async decide(decision:'approved'|'rejected'){
   const approval=state.approval;if(state.busy||closed||!authorized()||!approval||!state.slot||attempted.has(approval.id)||!canUserDecideApproval(owner.role,owner.userId,approval).canDecide)return;
   attempted.add(approval.id);update({busy:true,error:null,approvalAttempted:true});
   try{await api.decide(approval.id,decision);await readStatus(state.slot);}catch{update({response:undefined,error:'Check Calendar status before taking another action. The approval outcome is unknown; Thaara will not retry it automatically.'});}finally{update({busy:false});}
  }
 };
}
