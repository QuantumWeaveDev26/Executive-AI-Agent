import {computeCanonicalParameterHash,type PhoneAppointmentSlot,type GoogleCalendarCreateEventInput} from '@thaara/contracts';
import {ApprovalRepository,PlanRepository,PlanStepRepository,PlanStepApprovalBindingRepository,ReceiptRepository,type AuthenticatedScope,type TransactionalDbClient,type DbClient} from '@thaara/db';
import {ForbiddenError} from '@thaara/observability';
import {createGovernedCalendarMutation} from './calendar-mutation-governance.js';
import {GOOGLE_CALENDAR_CREATE_EVENT_ACTION,type GoogleCalendarFoundation} from './google-calendar.js';
import type {StoredInboundReport} from './phone-inbound-reports.js';
import {authenticatePhoneAppointmentOwner,readPhoneAppointmentSlot} from './phone-appointment-owner.js';
import type {InboundCalendarReceipt} from './phone-sarvam-inbound-normalize.js';
const denied=()=>new ForbiddenError('Phone appointment authorization was denied.');
const sameScope=(a:AuthenticatedScope,b:AuthenticatedScope)=>a.workspaceId===b.workspaceId&&a.userId===b.userId&&a.sessionTokenHash===b.sessionTokenHash;
export type PhoneAppointmentCalendar=Pick<GoogleCalendarFoundation,'writeReadiness'|'findConflicts'|'listEvents'|'readEvent'>;
/** Shared Calendar proposal/readback only. This never grants authority, approves or creates an event. */
export function createPhoneAppointmentCalendar(options:{db:TransactionalDbClient;calendar:PhoneAppointmentCalendar;direction:'inbound'|'outbound';savedBeforeProposal:boolean;includeOwnerReview?:boolean;existingOwnerCalendarReview?:boolean}){
 // This exception is only the existing owner-created Calendar proposal for a durable outbound call.
 // It never admits the new inbound journal, provider tools, or service-role impersonation.
 const ownerReview=options.existingOwnerCalendarReview===true&&options.direction==='outbound'&&options.savedBeforeProposal===false&&options.includeOwnerReview===true;
 if(process.env.NODE_ENV!=='test'&&!ownerReview)throw Error('Phone appointment Calendar bridge is test-only pending admission.');
 const {db,calendar,direction,savedBeforeProposal}=options;
 const requestKey=direction==='inbound'?'phoneInboundRequestId':'phoneOutboundRequestId';
 const interactionKey=direction==='inbound'?'phoneInteractionId':'phoneOutboundCallId';
 const reply=(id:string,status:'request_saved'|'approval_pending'|'slot_unavailable'|'appointment_confirmed'|'needs_review',proposalSaved=false)=>({saved:proposalSaved||status==='approval_pending'||status==='appointment_confirmed'||savedBeforeProposal,requestId:id,status,appointmentConfirmed:status==='appointment_confirmed'});
 async function proposal(scope:AuthenticatedScope,report:Pick<StoredInboundReport,'id'|'customerName'|'business'|'serviceNeeded'>,slot:PhoneAppointmentSlot,interactionId:string,existingOnly=false){
  return db.withScopedTransaction(scope,async tx=>{
   // Same scoped transaction encloses duplicate lookup AND existing governance helper writes.
   await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`phone-appointment:${scope.workspaceId}:${scope.userId}:${report.id}`]);
   const found=await tx.query<{id:string}>(`SELECT id FROM plans WHERE workspace_id=$1 AND created_by_user_id=$2 AND metadata->>'${requestKey}'=$3 ORDER BY created_at LIMIT 2`,[scope.workspaceId,scope.userId,report.id]);
   if(found.rows.length>1)throw denied();
   // Dashboard reads must never create a plan if a proposal disappeared or did not exist.
   if(existingOnly&&!found.rows.length)return reply(report.id,'request_saved');
   const readiness=await calendar.writeReadiness(scope,'create').catch(()=>null);
   if(!readiness?.ready||!readiness.connectedCalendar)return reply(report.id,found.rows.length?'needs_review':'request_saved',!!found.rows.length);
   if(!found.rows.length){
    const conflicts=await calendar.findConflicts(scope,slot);
    if(conflicts.length)return reply(report.id,'slot_unavailable');
    // The existing convenience conflict check excludes all-day events and reads one page.
    // Reuse its underlying connector to fail closed on omitted busy events or incomplete results.
    const listed=await calendar.listEvents(scope,{windowStart:slot.startAt,windowEnd:slot.endAt,timeZone:slot.timeZone,includeCancelled:false,limit:50});
    if(listed.nextPageToken)return reply(report.id,'needs_review');
    if(listed.events.some(e=>e.status!=='cancelled'&&Date.parse(e.startAt)<Date.parse(slot.endAt)&&Date.parse(e.endAt)>Date.parse(slot.startAt)))return reply(report.id,'slot_unavailable');
    const params:GoogleCalendarCreateEventInput={connectedCalendar:readiness.connectedCalendar!,summary:'Customer appointment',
     description:`Customer: ${report.customerName??'Not recorded'}\nBusiness: ${report.business??'Not recorded'}\nRequired solution: ${report.serviceNeeded??'Not recorded'}\nCall request: ${report.id}`,
     ...slot,attendees:[],sendUpdates:'none',origin:'thaara_ui'};
    const scopedDb:TransactionalDbClient={query:tx.query.bind(tx),withAuthenticatedScope:async()=>{throw denied();},
     withScopedTransaction:async<T>(requested:AuthenticatedScope,work:(client:DbClient)=>Promise<T>)=>{if(!sameScope(scope,requested))throw denied();return work(tx);}};
    const created=await createGovernedCalendarMutation(scopedDb,scope,{actionName:GOOGLE_CALENDAR_CREATE_EVENT_ACTION,params:params as unknown as Record<string,unknown>,title:direction==='inbound'?'Inbound appointment request':'Outbound appointment request',description:'Owner approval required',
     metadata:{[requestKey]:report.id,[interactionKey]:interactionId,...(direction==='outbound'?{phoneCallDirection:'outbound'}:{}),phoneSlot:slot,conversationId:'phone-appointment:'+report.id},
     auditAction:'phone.appointment.proposal_prepared',auditPayload:{requestId:report.id}});
    return {...reply(report.id,'approval_pending'),...(options.includeOwnerReview?{calendarApproval:{planId:created.planId,approvalId:created.approvalId}}:{})};
   }
   const plan=await new PlanRepository(tx).findById(scope.workspaceId,found.rows[0]!.id);
   if(!plan||plan.created_by_user_id!==scope.userId||plan.metadata[interactionKey]!==interactionId
    ||computeCanonicalParameterHash(plan.metadata.phoneSlot as Record<string,unknown>)!==computeCanonicalParameterHash(slot))throw denied();
   const steps=await new PlanStepRepository(tx).listByPlanId(scope.workspaceId,plan.id);
   if(steps.length!==1||steps[0]!.action_name!==GOOGLE_CALENDAR_CREATE_EVENT_ACTION)throw denied();
   const step=steps[0]!,approvalBinding=await new PlanStepApprovalBindingRepository(tx).findByStepId(scope.workspaceId,step.id);
   if(!approvalBinding)throw denied();
   const approval=await new ApprovalRepository(tx).findById(scope.workspaceId,approvalBinding.approval_request_id);
   const receipt=await new ReceiptRepository(tx).findByStepId(scope.workspaceId,step.id);
   if(!approval||approval.requester_user_id!==scope.userId||approval.action_name!==GOOGLE_CALENDAR_CREATE_EVENT_ACTION
    ||approvalBinding.plan_id!==plan.id||approvalBinding.parameter_hash!==step.parameter_hash
    ||computeCanonicalParameterHash(step.parameters)!==step.parameter_hash
    ||computeCanonicalParameterHash(approval.action_params)!==step.parameter_hash)throw denied();
   if(approval.status==='rejected'||approval.status==='expired'||['failed','cancelled'].includes(plan.status))return reply(report.id,'needs_review',true);
   const pending=()=>({...reply(report.id,'approval_pending'),...(options.includeOwnerReview?{calendarApproval:{planId:plan.id,approvalId:approval.id}}:{})});
   if(approval.status!=='approved')return pending();
   if(!receipt)return pending();
   const proof=receipt.proof;
   if(receipt.status!=='verified'||receipt.action_name!==GOOGLE_CALENDAR_CREATE_EVENT_ACTION||!receipt.verified_at
    ||proof.operation!=='create'||proof.status!=='event_created'||typeof proof.providerEventId!=='string'||!proof.providerEventId
    ||proof.startAt!==slot.startAt||proof.endAt!==slot.endAt||proof.timeZone!==slot.timeZone||proof.connectedCalendar!==readiness.connectedCalendar)return reply(report.id,'needs_review',true);
   // Existing executor/PolicyGateway must have created the receipt. Do not create events or approve here.
   const event=await calendar.readEvent(scope,proof.providerEventId).catch(()=>null);
   if(!event)return reply(report.id,'needs_review',true);
   if(event.id!==proof.providerEventId||event.status!=='confirmed'||event.startAt!==slot.startAt||event.endAt!==slot.endAt
    ||event.timeZone!==slot.timeZone||(event.calendarId!=='primary'&&event.calendarId!==readiness.connectedCalendar))return reply(report.id,'needs_review',true);
   return {...reply(report.id,'appointment_confirmed'),eventId:event.id,...slot};
  });
 }
 return Object.assign(proposal,{readExisting:(scope:AuthenticatedScope,report:Pick<StoredInboundReport,'id'|'customerName'|'business'|'serviceNeeded'>,slot:PhoneAppointmentSlot,interactionId:string)=>proposal(scope,report,slot,interactionId,true)});
}

/** Joins an already saved Phone request to the existing Calendar verification path. No proposal/event creation. */
export function createPhoneAppointmentCalendarReceiptReader(options:{db:TransactionalDbClient;calendar:PhoneAppointmentCalendar;now?:()=>number}){
 if(process.env.NODE_ENV!=='test')throw Error('Phone appointment receipt reader is test-only pending admission.');
 const read=createPhoneAppointmentCalendar({...options,direction:'inbound',savedBeforeProposal:true}).readExisting;
 return async(input:AuthenticatedScope,report:Readonly<StoredInboundReport>):Promise<InboundCalendarReceipt|null>=>{
  const scope=await authenticatePhoneAppointmentOwner(options.db,input);
  if(report.workspaceId!==scope.workspaceId||report.ownerUserId!==scope.userId||!/^[a-f0-9]{64}$/.test(report.id)
   ||report.callbackConsent!=='confirmed'||!report.callbackRequestId||!report.callerPhone||!/^\+[1-9][0-9]{7,14}$/.test(report.callerPhone)
   ||!report.providerInteractionId||!/^\d{8}\/[A-Za-z0-9_.:-]{1,200}$/.test(report.providerInteractionId))throw denied();
  const saved=await options.db.withScopedTransaction(scope,async tx=>{
   const found=await tx.query<{metadata:Record<string,unknown>}>(`SELECT metadata FROM plans WHERE workspace_id=$1 AND created_by_user_id=$2 AND metadata->>'phoneInboundRequestId'=$3 ORDER BY created_at LIMIT 2`,[scope.workspaceId,scope.userId,report.id]);
   if(!found.rows.length)return null;if(found.rows.length!==1||found.rows[0]!.metadata.phoneInteractionId!==report.providerInteractionId)throw denied();
   return readPhoneAppointmentSlot({slot:found.rows[0]!.metadata.phoneSlot},(options.now??Date.now)(),false);
  });
  if(!saved)return null;
  const result=await read(scope,report,saved,report.providerInteractionId);
  if(!result.appointmentConfirmed||!('eventId'in result))return null;
  return {workspaceId:scope.workspaceId,ownerUserId:scope.userId,interactionId:report.providerInteractionId,callerPhone:report.callerPhone,
   eventId:result.eventId,startsAt:result.startAt,endsAt:result.endAt,timezone:result.timeZone,verified:true};
 };
}
