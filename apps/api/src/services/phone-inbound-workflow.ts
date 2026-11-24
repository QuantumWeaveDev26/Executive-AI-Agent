import type {AuthenticatedScope} from '@thaara/db';
import type {PhoneInboundCallbackReceipt,PhoneInboundCompletionReceipt} from '@thaara/contracts';
import {ForbiddenError} from '@thaara/observability';
import {createSarvamInboundIntake} from './phone-sarvam-inbound-intake.js';
import {readInboundReports} from './phone-inbound-reports.js';
import type {InboundEventInput,InboundEventReceipt,InboundEventKind} from './phone-inbound-events.js';
type IntakeOptions=Parameters<typeof createSarvamInboundIntake>[0];
export interface InboundCallEventStore{append(scope:AuthenticatedScope,event:InboundEventInput):Promise<InboundEventReceipt>}
type Options=Omit<IntakeOptions,'store'> & {journal:InboundCallEventStore};
const reject=()=>{throw new ForbiddenError('Callback consent or committed receipt could not be verified.');};
/** LOCAL ONLY. Reuses existing auth/parser/private PolicyGateway. No production route, dialing or Calendar creation. */
export function createInboundCallWorkflow(options:Options){
 if(process.env.NODE_ENV!=='test')throw new Error('Inbound call workflow is test-only pending production admission.');
 const profile=Object.freeze(structuredClone(options.profile)),append=options.journal.append.bind(options.journal),
  base={profile,resolveSecret:options.resolveSecret,now:options.now,retention:options.retention?Object.freeze({...options.retention}):undefined},lookup=options.lookupVerifiedAppointment;
 async function receive(phase:'callback'|'completion',routeId:string,authorization:string|undefined,payload:unknown){
  // Per-request receipt box: concurrent requests must not share receipt state.
  const committed:{receipt?:InboundEventReceipt}={};
  const intake=createSarvamInboundIntake({...base,lookupVerifiedAppointment:phase==='completion'?lookup:undefined,
   store:{async saveNormalized(scope,_eventId,report,sourceDigest){
    if(!sourceDigest)return reject();
    let kind:InboundEventKind='call_completed';
    if(phase==='callback'){
     if(report.callbackConsent==='declined')kind='callback_withdrawn';
     else if(report.callbackConsent==='confirmed'&&report.outcome==='callback_requested'&&report.callbackRequestId&&report.callerPhone)kind='callback_requested';
     else return reject();
    }
    const event:InboundEventInput={eventId:kind+'-'+report.id,callId:report.id,kind,sourceDigest,report};
    const receipt=await append(scope,Object.freeze(structuredClone(event)));
    if(receipt.saved!==true||receipt.event.eventId!==event.eventId||receipt.event.callId!==event.callId||receipt.event.kind!==kind
     ||receipt.event.sourceDigest!==sourceDigest||!Number.isInteger(receipt.revision)||receipt.revision<1||receipt.revision>3
     ||!Number.isInteger(receipt.event.sequence)||receipt.event.sequence<1||receipt.event.sequence>receipt.revision
     ||receipt.report.id!==report.id||receipt.report.providerInteractionId!==report.providerInteractionId)return reject();
    await readInboundReports(profile,async()=>[receipt.report]);
    committed.receipt=structuredClone(receipt);
    // This exact normalized EVENT snapshot was committed. The separately folded call view may now differ.
    return receipt.event.report;
   }}});
  await intake.ingest(routeId,authorization,payload);
  if(!committed.receipt)return reject();
  return committed.receipt.report;
 }
 return {
  async requestCallback(routeId:string,authorization:string|undefined,payload:unknown):Promise<PhoneInboundCallbackReceipt>{
   const report=await receive('callback',routeId,authorization,payload),active=report.callbackConsent==='confirmed'&&!!report.callbackRequestId;
   return {saved:true,reportId:report.id,callbackRequestId:active?report.callbackRequestId:null,
    action:active?'callback_requested':report.callbackConsent==='declined'?'callback_withdrawn':'needs_review',outcome:report.outcome};
  },
  async complete(routeId:string,authorization:string|undefined,payload:unknown):Promise<PhoneInboundCompletionReceipt>{
   const report=await receive('completion',routeId,authorization,payload);return {saved:true,reportId:report.id,outcome:report.outcome};
  }
 };
}
