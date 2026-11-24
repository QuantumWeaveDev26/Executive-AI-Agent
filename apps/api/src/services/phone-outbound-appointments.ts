import {computeCanonicalParameterHash,isPhoneProviderCallId} from '@thaara/contracts';
import {PlanStepRepository,PlanStepApprovalBindingRepository,type AuthenticatedScope,type TransactionalDbClient} from '@thaara/db';
import {ForbiddenError} from '@thaara/observability';
import type {PhoneCallLedger} from './phone-calling.js';
import {createPhoneAppointmentCalendar,type PhoneAppointmentCalendar} from './phone-appointment-calendar.js';
import {authenticatePhoneAppointmentOwner,readPhoneAppointmentSlot} from './phone-appointment-owner.js';

const denied=()=>new ForbiddenError('Outbound appointment authorization was denied.');
const ownerCalendarServices=new WeakSet<object>();
export const isExistingOwnerCalendarReview=(service:object)=>ownerCalendarServices.has(service);
/** Owner-authenticated follow-up proposal, NOT a Sarvam tool grant. Unregistered/test-only until admission.
 * Durable storage is the existing governed Calendar plan for this actual proposal, not a substitute
 * journal for raw call data. Unavailable Calendar/storage returns saved:false. No event creation here. */
export function createOutboundAppointments(options:{db:TransactionalDbClient;calls:Pick<PhoneCallLedger,'load'|'durable'>;calendar:PhoneAppointmentCalendar;now?:()=>number;existingOwnerCalendarReview?:boolean}){
 const ownerReview=options.existingOwnerCalendarReview===true;
 if(process.env.NODE_ENV!=='test'&&!ownerReview)throw Error('Outbound appointments are test-only pending admission.');
 if(ownerReview&&options.calls.durable!==true)throw denied();
 const {db,calls,calendar}=options,now=options.now??Date.now;
 const propose=createPhoneAppointmentCalendar({db,calendar,direction:'outbound',savedBeforeProposal:false,includeOwnerReview:true,existingOwnerCalendarReview:ownerReview});
 async function ownedCall(input:AuthenticatedScope,callId:string){
  if(!calls.durable||!/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(callId))throw denied();
  const scope=await authenticatePhoneAppointmentOwner(db,input);
  const entry=await calls.load(scope,callId),record=entry?.record;
  if(!record||record.id!==callId||record.simulated!==false||record.state!=='completed'||!isPhoneProviderCallId(record.providerCallId))throw denied();
  const id=computeCanonicalParameterHash({workspaceId:scope.workspaceId,ownerUserId:scope.userId,callId,providerCallId:record.providerCallId,approvalId:record.approvalId,operation:'outbound.appointment_proposal.v1'});
  return {scope,record,id};
 }
 const service={
 async status(input:AuthenticatedScope,callId:string){
  const {scope,record,id}=await ownedCall(input,callId);
  const slot=await db.withScopedTransaction(scope,async tx=>{
   const found=await tx.query<{metadata:Record<string,unknown>}>(`SELECT metadata FROM plans WHERE workspace_id=$1 AND created_by_user_id=$2 AND metadata->>'phoneOutboundRequestId'=$3 ORDER BY created_at LIMIT 2`,[scope.workspaceId,scope.userId,id]);
   if(!found.rows.length)return null;
   if(found.rows.length!==1||found.rows[0]!.metadata.phoneOutboundCallId!==callId||found.rows[0]!.metadata.phoneCallDirection!=='outbound')throw denied();
   return readPhoneAppointmentSlot({slot:found.rows[0]!.metadata.phoneSlot},now(),false);
  });
  if(!slot)return {saved:false as const,appointmentConfirmed:false as const,status:'request_not_saved' as const};
  const result=await propose.readExisting(scope,{id,customerName:record.draft.recipient.displayName,business:null,serviceNeeded:null},slot,callId);
  if(!result.saved)return {saved:false as const,appointmentConfirmed:false as const,status:'request_not_saved' as const};
  return result;
 },
 async review(input:AuthenticatedScope,callId:string){
  const {scope,id}=await ownedCall(input,callId);
  return db.withScopedTransaction(scope,async tx=>{
   const found=await tx.query<{id:string;metadata:Record<string,unknown>}>(`SELECT id,metadata FROM plans WHERE workspace_id=$1 AND created_by_user_id=$2 AND metadata->>'phoneOutboundRequestId'=$3 ORDER BY created_at LIMIT 2`,[scope.workspaceId,scope.userId,id]);
   if(!found.rows.length)return {status:'not_prepared' as const,slot:null,calendarApproval:null};
   if(found.rows.length!==1)throw denied();const plan=found.rows[0]!;
   if(plan.metadata.phoneOutboundCallId!==callId||plan.metadata.phoneCallDirection!=='outbound')throw denied();
   const slot=readPhoneAppointmentSlot({slot:plan.metadata.phoneSlot},now(),false);
   const steps=await new PlanStepRepository(tx).listByPlanId(scope.workspaceId,plan.id);
   if(steps.length!==1||steps[0]!.action_name!=='calendar.events.create')throw denied();
   const binding=await new PlanStepApprovalBindingRepository(tx).findByStepId(scope.workspaceId,steps[0]!.id);
   if(!binding||binding.plan_id!==plan.id)throw denied();
   return {status:'ready' as const,slot,calendarApproval:{planId:plan.id,approvalId:binding.approval_request_id}};
  });
 },
 async request(input:AuthenticatedScope,callId:string,raw:unknown){
  const {scope,record,id}=await ownedCall(input,callId),slot=readPhoneAppointmentSlot(raw,now());
  try{
   const result=await propose(scope,{id,customerName:record.draft.recipient.displayName,business:null,serviceNeeded:null},slot,callId);
   if(!result.saved)return {saved:false as const,appointmentConfirmed:false as const,status:result.status==='slot_unavailable'?'slot_unavailable' as const:result.status==='needs_review'?'needs_review' as const:'request_not_saved' as const};
   return result;
  }catch(error){if(error instanceof ForbiddenError)throw error;return {saved:false as const,appointmentConfirmed:false as const,status:'request_not_saved' as const};}
 }};
 if(ownerReview)ownerCalendarServices.add(service);
 return service;
}
