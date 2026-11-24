import {PlanStepRepository,PlanStepApprovalBindingRepository,type AuthenticatedScope,type TransactionalDbClient} from '@thaara/db';
import {AppError,ForbiddenError} from '@thaara/observability';
import type {PhoneInboundEventRepository} from './phone-inbound-event-store.js';
import {readInboundReports} from './phone-inbound-reports.js';
import {createPhoneAppointmentCalendar,type PhoneAppointmentCalendar} from './phone-appointment-calendar.js';
import {authenticatePhoneAppointmentOwner,readPhoneAppointmentSlot} from './phone-appointment-owner.js';

/** Signed-in owner reviews an already committed consent-backed request. Sarvam gets no owner session.
 * This does not install request capture, bypass 112h/113h admission or grant in-call Calendar access. */
export function createInboundAppointmentOwnerReview(options:{db:TransactionalDbClient;repository:Pick<PhoneInboundEventRepository,'read'>;calendar:PhoneAppointmentCalendar;now?:()=>number}){
 if(process.env.NODE_ENV!=='test')throw Error('Inbound appointment owner review is test-only pending admission.');
 const {db,repository,calendar}=options,now=options.now??Date.now;
 const propose=createPhoneAppointmentCalendar({db,calendar,direction:'inbound',savedBeforeProposal:true,includeOwnerReview:true});
 const denied=()=>new ForbiddenError('Inbound appointment request could not be verified.');
 async function savedRequest(input:AuthenticatedScope,reportId:string){
  const scope=await authenticatePhoneAppointmentOwner(db,input);
  if(typeof reportId!=='string'||!/^[a-f0-9]{64}$/.test(reportId))throw denied();
  let row;try{row=structuredClone(await repository.read(scope,reportId));}catch{throw new AppError('Inbound appointment review is unavailable.','PHONE_APPOINTMENT_REVIEW_UNAVAILABLE',503);}
  if(!row||row.id!==reportId)throw denied();
  await readInboundReports(scope,async()=>[row]);
  if(row.callbackConsent!=='confirmed'||row.outcome!=='callback_requested'||!row.callbackRequestId||!row.callerPhone
   ||typeof row.providerInteractionId!=='string'||!/^\d{8}\/[A-Za-z0-9_.:-]{1,200}$/.test(row.providerInteractionId))throw denied();
  return {scope,row};
 }
 return {
 async status(input:AuthenticatedScope,reportId:string){
  const {scope,row}=await savedRequest(input,reportId);
  const slot=await db.withScopedTransaction(scope,async tx=>{
   const found=await tx.query<{metadata:Record<string,unknown>}>(`SELECT metadata FROM plans WHERE workspace_id=$1 AND created_by_user_id=$2 AND metadata->>'phoneInboundRequestId'=$3 ORDER BY created_at LIMIT 2`,[scope.workspaceId,scope.userId,reportId]);
   if(!found.rows.length)return null;
   if(found.rows.length!==1||found.rows[0]!.metadata.phoneInteractionId!==row.providerInteractionId)throw denied();
   return readPhoneAppointmentSlot({slot:found.rows[0]!.metadata.phoneSlot},now(),false);
  });
  if(!slot)return {saved:true as const,requestId:row.id,status:'request_saved' as const,appointmentConfirmed:false as const};
  // Historical slots are valid for readback. Never create a missing proposal during a status check.
  return propose.readExisting(scope,row,slot,row.providerInteractionId!);
 },
 async review(input:AuthenticatedScope,reportId:string){
  const {scope,row}=await savedRequest(input,reportId);
  return db.withScopedTransaction(scope,async tx=>{
   const found=await tx.query<{id:string;metadata:Record<string,unknown>}>(`SELECT id,metadata FROM plans WHERE workspace_id=$1 AND created_by_user_id=$2 AND metadata->>'phoneInboundRequestId'=$3 ORDER BY created_at LIMIT 2`,[scope.workspaceId,scope.userId,reportId]);
   if(!found.rows.length)return {status:'not_prepared' as const,slot:null,calendarApproval:null};
   if(found.rows.length!==1)throw denied();const plan=found.rows[0]!;
   if(plan.metadata.phoneInteractionId!==row.providerInteractionId)throw denied();
   // Historical approved slots may be past; this GET cannot propose, approve or create anything.
   const slot=readPhoneAppointmentSlot({slot:plan.metadata.phoneSlot},now(),false);
   const steps=await new PlanStepRepository(tx).listByPlanId(scope.workspaceId,plan.id);
   if(steps.length!==1||steps[0]!.action_name!=='calendar.events.create')throw denied();
   const binding=await new PlanStepApprovalBindingRepository(tx).findByStepId(scope.workspaceId,steps[0]!.id);
   if(!binding||binding.plan_id!==plan.id)throw denied();
   return {status:'ready' as const,slot,calendarApproval:{planId:plan.id,approvalId:binding.approval_request_id}};
  });
 },
 async request(input:AuthenticatedScope,reportId:string,body:unknown){
  const {scope,row}=await savedRequest(input,reportId),slot=readPhoneAppointmentSlot(body,now());
  try{return await propose(scope,row,slot,row.providerInteractionId!);}catch(error){
   if(error instanceof ForbiddenError)throw error;
   // The existing request is still durable; failed proposal creation never removes or confirms it.
   return {saved:true as const,requestId:row.id,status:'request_saved' as const,appointmentConfirmed:false as const};
  }
 }};
}
