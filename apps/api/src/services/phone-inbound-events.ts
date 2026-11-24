import {ConflictError,ForbiddenError} from '@thaara/observability';
import type {InboundOwnerScope,StoredInboundReport} from './phone-inbound-reports.js';
export type InboundEventKind='callback_requested'|'callback_withdrawn'|'call_completed';
export interface InboundEventInput{eventId:string;callId:string;kind:InboundEventKind;sourceDigest:string;report:StoredInboundReport}
export interface InboundCallEvent extends InboundEventInput{sequence:number}
export interface InboundEventReceipt{saved:true;event:InboundCallEvent;report:StoredInboundReport;revision:number;duplicate:boolean}
const invalid=()=>{throw new ForbiddenError('Inbound event context could not be verified.');};

/** Pure projection, not authentication or a Calendar action. Normalized event snapshots remain immutable. */
export function projectInboundEvents(scope:InboundOwnerScope,input:readonly InboundCallEvent[]):StoredInboundReport{
 if(scope.role!=='owner'||!scope.workspaceId||!scope.userId||!input.length||input.length>3)invalid();
 const events=input.map(e=>structuredClone(e)).sort((a,b)=>a.sequence-b.sequence),first=events[0]!;
 const kinds=new Set<string>(),ids=new Set<string>();let callerPhone:string|null=null;
 for(let i=0;i<events.length;i++){
  const e=events[i]!,r=e.report;
  if(!['callback_requested','callback_withdrawn','call_completed'].includes(e.kind)||kinds.has(e.kind)||ids.has(e.eventId)
   ||e.sequence!==i+1||!/^[a-f0-9]{64}$/.test(e.sourceDigest)||!/^[a-f0-9]{64}$/.test(e.callId)
   ||e.eventId!==e.kind+'-'+e.callId||e.callId!==first.callId||r.id!==e.callId
   ||r.workspaceId!==scope.workspaceId||r.ownerUserId!==scope.userId||r.providerInteractionId!==first.report.providerInteractionId||!r.providerInteractionId||r.providerVerified!==false)invalid();
  if(r.callerPhone){if(callerPhone&&callerPhone!==r.callerPhone)throw new ConflictError('Inbound caller binding changed.');callerPhone=r.callerPhone;}
  if(e.kind==='callback_requested'&&(r.outcome!=='callback_requested'||r.callbackConsent!=='confirmed'||!r.callerPhone||!r.callbackRequestId))invalid();
  if(e.kind==='callback_withdrawn'&&r.callbackConsent!=='declined')invalid();
  if(r.outcome==='booked_appointment'&&(!r.appointment||r.appointment.verification!=='verified'))invalid();
  kinds.add(e.kind);ids.add(e.eventId);
 }
 const callback=events.find(e=>e.kind==='callback_requested')?.report,
  completion=events.find(e=>e.kind==='call_completed')?.report,
  withdrawn=events.some(e=>e.kind==='callback_withdrawn'||e.report.callbackConsent==='declined');
 const base=structuredClone(completion??callback??first.report);
 if(callback){
  // A completion may omit variables collected earlier; never erase a saved customer's supplied details.
  for(const key of ['customerName','business','serviceNeeded','preferredContactTime'] as const)if(base[key]==null)base[key]=callback[key]??null;
  if(!base.callerPhone){base.callerPhone=callback.callerPhone;base.maskedPhone=callback.maskedPhone;}
 }
 if(withdrawn){
  base.callbackRequestId=null;base.callbackConsent='declined';base.callbackPreference='declined';
  // A verified Calendar event still exists; reporting must not silently cancel it or claim it disappeared.
  base.outcome=base.appointment?'booked_appointment':'needs_review';
 }else if(callback){
  base.callbackRequestId=callback.callbackRequestId;base.callbackConsent='confirmed';base.callbackPreference='requested';
  base.outcome=base.appointment?'booked_appointment':'callback_requested';
 }
 return Object.freeze(base);
}
