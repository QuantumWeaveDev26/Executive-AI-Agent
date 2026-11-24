import {Value} from '@sinclair/typebox/value';
import {PhoneCallingDraftSchema,PhoneCallingReportSchema,PhoneCallingStateSchema,isPhoneProviderCallId,type PhoneCallingDraft,type PhoneCallingLanguage,type PhoneCallingRecord,type PhoneCallingReport} from '@thaara/contracts';
import {PhoneCallRepository,applyPhoneProviderEvent,appendPhoneProviderTranscript,type DbClient,type PhoneCallRow,type PhoneCallState,type PhoneDispatchResult,type TransactionalDbClient} from '@thaara/db';
import {ForbiddenError} from '@thaara/observability';
import type {PhoneCallLedger,PhoneLiveCallStore} from './phone-calling.js';

const corrupt=()=>new ForbiddenError('Phone call record failed validation.');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function toRecord(r:PhoneCallRow):PhoneCallingRecord{
 const simulated=r.mode==='simulation';
 const record:PhoneCallingRecord={id:r.callId,approvalId:r.approvalId,draft:r.draft as unknown as PhoneCallingDraft,state:r.state,createdAt:r.createdAt,updatedAt:r.updatedAt,
  providerCallId:simulated?null:r.providerCallId,verified:false,simulated,report:r.report as unknown as PhoneCallingReport,
  ...(simulated?{}:{dispatchStatus:r.dispatchStatus as Exclude<PhoneCallRow['dispatchStatus'],'not_applicable'>})};
 // Stored rows are re-validated on the way out; a row that no longer matches the contract is never shown as a call.
 // (Parts are checked individually: TypeBox Value.Check has no built-in 'uuid' format.)
 if(!UUID.test(record.id)||!UUID.test(record.approvalId)||!Value.Check(PhoneCallingDraftSchema,record.draft)||record.draft.mode!==r.mode||!Value.Check(PhoneCallingStateSchema,record.state)
  ||!Value.Check(PhoneCallingReportSchema,record.report)||record.report.simulated!==simulated||(record.providerCallId!==null&&!isPhoneProviderCallId(record.providerCallId))
  ||(!simulated&&r.dispatchStatus==='not_applicable'))throw corrupt();
 return record;
}

/**
 * Durable ledger on the reviewed 110a/110b(/110c) schema (opt-in; the default app never wires it). The database enforces the
 * one-use approval claim, the exact approved draft, legal state transitions, the append-only event log and the live outbox.
 */
export function createPostgresPhoneCallLedger(db:TransactionalDbClient):PhoneCallLedger&PhoneLiveCallStore{
 const calls=new PhoneCallRepository(db);
 return {
  durable:true,
  async claim(scope,record,draftHash,options={}){
   const {call}=await calls.claim(scope,{callId:record.id,approvalId:record.approvalId,draft:record.draft,draftHash,report:record.report as unknown as Record<string,unknown>},options);
   return toRecord(call);
  },
  async list(scope){return (await calls.list(scope)).map(toRecord);},
  async load(scope,callId){
   const found=await calls.load(scope,callId);if(!found)return null;
   return {record:toRecord(found.call),providerRequestId:found.call.providerRequestId,events:new Map(found.events.map(e=>[e.eventId,e.eventHash])),sequence:found.call.eventSequence,
    turns:found.events.filter(e=>e.kind==='recipient_final'&&e.text!==null).map(e=>({id:e.eventId,text:e.text!}))};
  },
  async append(scope,entry,event,eventHash,next){
   const row=await calls.appendEvent(scope,entry.record.id,{eventId:event.eventId,sequence:event.sequence,kind:event.kind,state:event.kind==='state'?event.state!:null,text:event.kind==='recipient_final'?event.text!:null,eventHash},
    {state:next.state,report:next.report as unknown as Record<string,unknown>});
   return toRecord(row);
  },
  async claimDispatch(scope,callId){const row=await calls.claimDispatch(scope,callId);return row?toRecord(row):null;},
  async recordDispatch(scope,callId,result:PhoneDispatchResult){return toRecord(await calls.recordDispatch(scope,callId,result));}
 };
}

/** Session-free callback side: only the two reviewed SECURITY DEFINER functions. */
export function createPostgresPhoneCallbackStore(db:DbClient){
 return {
  async binding(callId:string){
   if(!UUID.test(callId))return null;
   const {rows}=await db.query<{provider_request_id:string|null;provider_call_id:string|null;language:string;ai_disclosure:string;purpose:string;max_duration_seconds:number;state:string;on_behalf_of:string|null}>('SELECT * FROM public.phone_provider_binding($1)',[callId]);
   const b=rows[0];
   if(!b?.provider_request_id||!['en-IN','kn-IN','kn-en'].includes(b.language))return null;
   return {callId,providerRequestId:b.provider_request_id,providerCallId:b.provider_call_id,language:b.language as PhoneCallingLanguage,aiDisclosure:b.ai_disclosure,...(b.on_behalf_of?{onBehalfOf:b.on_behalf_of}:{}),purpose:b.purpose,maxDurationSeconds:Number(b.max_duration_seconds),state:b.state as PhoneCallState};
  },
  apply:(e:{callId:string;providerRequestId:string;providerCallId:string;state:PhoneCallState;eventId:string;eventHash:string})=>applyPhoneProviderEvent(db,e),
  transcript:(e:{callId:string;providerCallId:string;eventId:string;text:string;eventHash:string;source:'verbatim'|'provider_english'})=>appendPhoneProviderTranscript(db,e)
 };
}
