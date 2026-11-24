import {computeCanonicalParameterHash,type PhoneInboundCallbackReceipt,type PhoneInboundCompletionReceipt} from '@thaara/contracts';
import type {DbClient} from '@thaara/db';
import {ForbiddenError} from '@thaara/observability';
import {createInboundPrincipalGate,type InboundPrincipalBinding,type InboundPrincipalTransactions,type InboundPrincipalOperation} from './phone-inbound-principal.js';
import {createInboundPrincipalJournal} from './phone-inbound-principal-journal.js';
import {normalizeSarvamInboundPayload,type SarvamInboundPayloadBinding} from './phone-sarvam-inbound-normalize.js';
import type {InboundEventKind} from './phone-inbound-events.js';
import type {CallbackRequest} from './phone-callback-notification.js';
import {projectSarvamCallbackCompletion} from './phone-sarvam-callback-completion.js';
export interface SarvamInboundServiceProfile extends SarvamInboundPayloadBinding{principalId:string;revision:number;maxCallLengthSeconds:300}
const deny=()=>{throw new ForbiddenError('Inbound service request could not be confirmed.');};
/** Server-only canonical binding. Provider payloads and model text cannot choose any of these values. */
export function buildInboundServiceBinding(input:SarvamInboundServiceProfile):InboundPrincipalBinding{
 if(!input||typeof input!=='object'||Array.isArray(input))return deny();
 const p=structuredClone(input),keys=['routeId','workspaceId','ownerUserId','principalId','revision','appId','appVersion','deploymentId','agentPhoneNumber','maxCallLengthSeconds'];
 if(Object.keys(p).sort().join(',')!==keys.sort().join(',')||p.maxCallLengthSeconds!==300
  ||!Number.isSafeInteger(p.revision)||p.revision<1||!Number.isSafeInteger(p.appVersion)||p.appVersion<1
  ||typeof p.agentPhoneNumber!=='string'||!/^\+[1-9][0-9]{7,14}$/.test(p.agentPhoneNumber)
  ||['routeId','workspaceId','ownerUserId','principalId'].some(k=>typeof p[k as keyof typeof p]!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(p[k as keyof typeof p] as string))
  ||['appId','deploymentId'].some(k=>typeof p[k as keyof typeof p]!=='string'||!/^[-A-Za-z0-9_.:]{1,128}$/.test(p[k as keyof typeof p] as string)))return deny();
 const profileFingerprint=computeCanonicalParameterHash({...p,policy:'phone.inbound.service.v1',direction:'inbound',callbackMeaning:'human_team_request',consentPolicy:'explicit-recap.v1',mediaRetention:'off',calendarBooking:'disabled'});
 return Object.freeze({routeId:p.routeId,workspaceId:p.workspaceId,ownerUserId:p.ownerUserId,principalId:p.principalId,revision:p.revision,profileFingerprint});
}

/** LOCAL TEST-ONLY full payload composition. No production route, provider call, owner session or secret file. */
export function createSarvamInboundService(options:{profile:SarvamInboundServiceProfile;transactions:InboundPrincipalTransactions<DbClient>;now?:()=>number;
 saveCallbackInPrincipalTransaction?:(tx:DbClient,request:CallbackRequest)=>Promise<void>}){
 if(process.env.NODE_ENV!=='test')throw Error('Inbound service is test-only pending production admission review.');
 const profile=Object.freeze(structuredClone(options.profile)),binding=buildInboundServiceBinding(profile),now=options.now??Date.now;
 const journal=createInboundPrincipalJournal(createInboundPrincipalGate({profile:binding,transactions:options.transactions,now}));
 async function receive(operation:InboundPrincipalOperation,routeId:string,authorization:string|undefined,payload:unknown){
  return journal.appendPrepared(routeId,authorization,operation,async()=>{
   const snapshot=structuredClone(payload);
   const normalized=await normalizeSarvamInboundPayload(profile,snapshot,{now});
   // Completion imports consent-backed callbacks too; it is not a reconciliation-only capability.
   // Neither operation authorizes dialing or Calendar writes. Keep actual observed duration unchanged.
   const report=normalized.report;let kind:InboundEventKind='call_completed';
   if(operation==='callback'){
    if(report.callbackConsent==='declined')kind='callback_withdrawn';
    else if(report.callbackConsent==='confirmed'&&report.outcome==='callback_requested'&&report.callbackRequestId&&report.callerPhone)kind='callback_requested';
    else return deny();
   }
   const persist=options.saveCallbackInPrincipalTransaction;
   const callback=operation==='completion'&&persist&&report.callStatus==='ended'&&projectSarvamCallbackCompletion({
    workspaceId:binding.workspaceId,userId:binding.ownerUserId,callId:report.id,direction:'inbound',verifiedNumber:report.callerPhone,
    occurredAt:report.occurredAt,
   },snapshot);
   return {event:{eventId:kind+'-'+report.id,callId:report.id,kind,sourceDigest:normalized.sourceDigest,report},matchesCommitted:normalized.matchesCommitted,
    afterAppend:callback&&persist?async(tx:DbClient,committed:typeof report)=>{
     if(committed.callbackConsent!=='declined')await persist(tx,callback);
    }:undefined};
  });
 }
 return {
  async requestCallback(routeId:string,authorization:string|undefined,payload:unknown):Promise<PhoneInboundCallbackReceipt>{
   const {report}=await receive('callback',routeId,authorization,payload),active=report.callbackConsent==='confirmed'&&!!report.callbackRequestId;
   return {saved:true,reportId:report.id,callbackRequestId:active?report.callbackRequestId:null,
    action:active?'callback_requested':report.callbackConsent==='declined'?'callback_withdrawn':'needs_review',outcome:report.outcome};
  },
  async complete(routeId:string,authorization:string|undefined,payload:unknown):Promise<PhoneInboundCompletionReceipt>{
   const {report}=await receive('completion',routeId,authorization,payload);return {saved:true,reportId:report.id,outcome:report.outcome};
  }
 };
}
