import type {PhoneInboundReport} from '@thaara/contracts';
import {ForbiddenError,AppError} from '@thaara/observability';

export interface InboundOwnerScope {workspaceId:string;userId:string;role:string}
export type StoredInboundReport=PhoneInboundReport & {workspaceId:string;ownerUserId:string};
export interface InboundReportInput {
 id:string;occurredAt:string;callerPhone:string|null;customerName:string|null;business:string|null;
 serviceNeeded:string|null;enquirySummary:string|null;callbackInterest:'yes'|'no'|'unknown';
}
/** Internal adapter input only: not a webhook body and not authorization asserted by the provider/model. */
interface InboundSource extends InboundOwnerScope {direction:'inbound';authenticatedRoute:true}
/** Only a future policy-gated persistence adapter may supply its transactionally saved receipt. */
interface SavedCallbackReceipt {callId:string;workspaceId:string;ownerUserId:string;callbackPhone:string;requestId:string;durable:true;callerConfirmed:true;policyApproved:true}
const deny=()=>{throw new ForbiddenError('Inbound report context could not be verified.');};
const owner=(scope:InboundOwnerScope)=>{if(scope.role!=='owner'||!scope.workspaceId||!scope.userId)deny();};
const optional=(value:string|null)=>{
 if(value===null)return null;
 if(typeof value!=='string'||value.length>2000)deny();
 return value.trim()||null;
};
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
/** Pure normalization; no call, booking, persistence or authorization side effect. Live import remains unwired. */
export function makeInboundReport(input:InboundReportInput,source:InboundSource,saved?:SavedCallbackReceipt):StoredInboundReport{
 owner(source);
 if(source.direction!=='inbound'||source.authenticatedRoute!==true||!validId(input.id)
  ||!Number.isFinite(Date.parse(input.occurredAt))||!['yes','no','unknown'].includes(input.callbackInterest))deny();
 if(input.callerPhone!==null&&(typeof input.callerPhone!=='string'||!/^\+[1-9][0-9]{7,14}$/.test(input.callerPhone)))deny();
 if(saved&&(saved.callId!==input.id||saved.workspaceId!==source.workspaceId||saved.ownerUserId!==source.userId
  ||saved.callbackPhone!==input.callerPhone||!validId(saved.requestId)
  ||saved.durable!==true||saved.callerConfirmed!==true||saved.policyApproved!==true||input.callbackInterest!=='yes'))deny();
 return Object.freeze({id:input.id,occurredAt:new Date(input.occurredAt).toISOString(),
  workspaceId:source.workspaceId,ownerUserId:source.userId,
  maskedPhone:input.callerPhone?'•••• '+input.callerPhone.slice(-4):'Number unavailable',callerPhone:input.callerPhone,
  customerName:optional(input.customerName),business:optional(input.business),serviceNeeded:optional(input.serviceNeeded),enquirySummary:optional(input.enquirySummary),
  outcome:saved?'callback_requested':input.callbackInterest==='no'?'enquired':'needs_review',
  callbackRequestId:saved?.requestId??null,providerVerified:false,callbackConsent:saved?'confirmed':input.callbackInterest==='no'?'declined':'unknown'});
}
/** Reader must perform active-session membership validation and audited reads in its scoped transaction. */
export type PhoneInboundReportReader=(scope:InboundOwnerScope)=>Promise<StoredInboundReport[]>;
export async function readInboundReports(scope:InboundOwnerScope,reader?:PhoneInboundReportReader,id?:string){
 owner(scope);
 if(!reader)return id?{status:'not_configured' as const,report:null}:{status:'not_configured' as const,reports:[]};
 const rows=await reader(scope);
 if(rows.length>100)throw new AppError('Inbound reports exceed the supported page size.','PHONE_INBOUND_INVALID',502);
 for(const row of rows){
  if(row.workspaceId!==scope.workspaceId||row.ownerUserId!==scope.userId)deny();
  if(!validId(row.id)||!Number.isFinite(Date.parse(row.occurredAt))||!['enquired','callback_requested','booked_appointment','needs_review'].includes(row.outcome)||row.providerVerified!==false)deny();
  if(row.callerPhone!==null&&(typeof row.callerPhone!=='string'||!/^\+[1-9][0-9]{7,14}$/.test(row.callerPhone)))deny();
  if(row.maskedPhone!==(row.callerPhone?'•••• '+row.callerPhone.slice(-4):'Number unavailable'))deny();
  for(const field of ['customerName','business','serviceNeeded','enquirySummary'] as const)optional(row[field]);
  if(row.outcome==='callback_requested'&&(!validId(row.callbackRequestId)||!row.callerPhone))deny();
  if(!['callback_requested','booked_appointment'].includes(row.outcome)&&row.callbackRequestId!==null)deny();
  if(row.durationSeconds!==undefined&&row.durationSeconds!==null&&(!Number.isFinite(row.durationSeconds)||row.durationSeconds<0||row.durationSeconds>86400))deny();
  if(row.callStatus!==undefined&&!['ended','interrupted','failed','unknown'].includes(row.callStatus))deny();
  if(row.timestampSource!==undefined&&!['provider_started','provider_ended','received_at'].includes(row.timestampSource))deny();
  if(row.preferredContactTime!==undefined)optional(row.preferredContactTime);
  if(row.callbackConsent!==undefined&&!['confirmed','declined','unknown'].includes(row.callbackConsent))deny();
  if(row.callbackPreference!==undefined&&!['requested','declined','unknown'].includes(row.callbackPreference))deny();
  if(row.providerInteractionId!==undefined&&(typeof row.providerInteractionId!=='string'||row.providerInteractionId.length>256||/[\x00-\x1f]/.test(row.providerInteractionId)))deny();
  if(row.outcome==='booked_appointment'&&(!row.appointment||row.appointment.verification!=='verified'))deny();
  if(row.appointment){
   const a=row.appointment;
   if(row.outcome!=='booked_appointment'||a.verification!=='verified'||!a.eventId||a.eventId.length>256||!Number.isFinite(Date.parse(a.startsAt))||!Number.isFinite(Date.parse(a.endsAt))||Date.parse(a.endsAt)<=Date.parse(a.startsAt)||!a.timezone||a.timezone.length>64)deny();
  }
  if(row.transcript){
   if(!Array.isArray(row.transcript)||row.transcript.length>64||!row.transcriptExpiresAt||!Number.isFinite(Date.parse(row.transcriptExpiresAt))
    ||row.transcript.some(t=>!['agent','caller'].includes(t.speaker)||typeof t.text!=='string'||t.text.length>2000||!['provider_original','provider_english'].includes(t.languageBasis)))deny();
  }
  if(row.recordingReference&&(!row.recordingReference.noticeConfirmed||row.recordingReference.interactionId!==row.providerInteractionId||!Number.isFinite(Date.parse(row.recordingReference.expiresAt))))deny();
 }
 if(new Set(rows.map(r=>r.id)).size!==rows.length)deny();
 if(id){const row=rows.find(r=>r.id===id);if(!row)return {status:'not_found' as const,report:null};
  const {workspaceId:_,ownerUserId:__,...report}=row;
  // Expired material must never be served even before the separate physical purge worker is admitted.
  if(report.transcriptExpiresAt&&Date.parse(report.transcriptExpiresAt)<=Date.now()){delete report.transcript;delete report.transcriptExpiresAt;}
  if(report.recordingReference&&Date.parse(report.recordingReference.expiresAt)<=Date.now())report.recordingReference=null;
  return {status:'ready' as const,report};}
 return {status:'ready' as const,reports:rows.map(({id,occurredAt,maskedPhone,outcome,providerVerified,customerName,preferredContactTime})=>({id,occurredAt,maskedPhone,outcome,providerVerified,
  ...(outcome==='callback_requested'?{customerName,preferredContactTime:preferredContactTime??null}:{})}))};
}
