import {PhoneInboundReportSchema} from '@thaara/contracts';
import type {DbClient} from '@thaara/db';
import {ForbiddenError} from '@thaara/observability';
import {createInboundPrincipalGate,type InboundPrincipalOperation,type InboundPrincipalScope} from './phone-inbound-principal.js';
import {readInboundReports,type StoredInboundReport} from './phone-inbound-reports.js';
import {projectInboundEvents,type InboundCallEvent,type InboundEventInput,type InboundEventReceipt} from './phone-inbound-events.js';
type Gate=ReturnType<typeof createInboundPrincipalGate<DbClient>>;
const deny=()=>{throw new ForbiddenError('Inbound report save could not be verified.');};
const reportKeys=new Set([...Object.keys(PhoneInboundReportSchema.properties),'workspaceId','ownerUserId']);

/** Dedicated typed service policy: only inbound callback/completion report writes, no owner-role impersonation. */
class InboundReportPolicyGateway{
 async admit(scope:Readonly<InboundPrincipalScope>,event:InboundEventInput){
  if(scope.authKind!=='phone_inbound'||!['callback','completion'].includes(scope.operation)
   ||Object.keys(event).sort().join(',')!=='callId,eventId,kind,report,sourceDigest'
   ||!event.report||Object.keys(event.report).some(key=>!reportKeys.has(key))
   ||(scope.operation==='callback'?!['callback_requested','callback_withdrawn'].includes(event.kind):event.kind!=='call_completed')
   ||event.report.appointment!=null||event.report.outcome==='booked_appointment'||event.report.transcript!==undefined
   ||event.report.transcriptExpiresAt!==undefined||event.report.recordingReference!=null)deny();
  // Owner-shaped scope is for the existing PURE report validator/reducer only; never a DB authentication scope.
  const validation={workspaceId:scope.workspaceId,userId:scope.ownerUserId,role:'owner'};
  await readInboundReports(validation,async()=>[event.report]);
  projectInboundEvents(validation,[{...event,sequence:1}]);
  return validation;
 }
}

/** TEST-ONLY composition. A public saved receipt is returned only after gate.run's transaction has committed. */
export function createInboundPrincipalJournal(gate:Gate){
 if(process.env.NODE_ENV!=='test')throw new Error('Inbound principal journal is test-only pending schema and production admission review.');
 const run=gate.run.bind(gate),policy=new InboundReportPolicyGateway();
 async function receive(routeId:string,authorization:string|undefined,operation:InboundPrincipalOperation,
  prepare:(scope:Readonly<InboundPrincipalScope>)=>Promise<{event:InboundEventInput;matchesCommitted?:(report:StoredInboundReport)=>boolean;
   afterAppend?:(tx:DbClient,report:StoredInboundReport)=>Promise<void>}>):Promise<InboundEventReceipt>{
  const staged=await run(routeId,authorization,operation,async(scope,tx)=>{
   // Trusted backend preparation only, AFTER grant authentication and within this same transaction.
   const prepared=await prepare(scope),event=structuredClone(prepared.event);
   const validation=await policy.admit(scope,event);
   const result=await tx.query<{receipt:{saved:boolean;events:InboundCallEvent[];duplicate:boolean}}>(
    'SELECT public.phone_inbound_append_event($1::jsonb) AS receipt',[JSON.stringify(event)]);
   const receipt=result.rows[0]?.receipt;
   if(result.rows.length!==1||receipt?.saved!==true||typeof receipt.duplicate!=='boolean'||!Array.isArray(receipt.events)||!receipt.events.length||receipt.events.length>3)return deny();
   const history=structuredClone(receipt.events);
   for(const e of history){
    if(e.callId!==event.callId)return deny();
    // All history must satisfy the same report boundary, but earlier phases need their own operation.
    await policy.admit({...scope,operation:e.kind==='call_completed'?'completion':'callback'},
     {eventId:e.eventId,callId:e.callId,kind:e.kind,sourceDigest:e.sourceDigest,report:e.report});
   }
   const saved=history.find(e=>e.eventId===event.eventId);
   if(!saved||saved.kind!==event.kind||saved.sourceDigest!==event.sourceDigest||saved.report.providerInteractionId!==event.report.providerInteractionId
    ||prepared.matchesCommitted&&!prepared.matchesCommitted(saved.report))return deny();
   const report=projectInboundEvents(validation,history);
   await prepared.afterAppend?.(tx,report);
   return {event:saved,report,revision:history.length,duplicate:receipt.duplicate};
  });
  return {saved:true,...staged};
 }
 return {appendPrepared:receive,append(routeId:string,authorization:string|undefined,operation:InboundPrincipalOperation,input:InboundEventInput){
  const event=structuredClone(input);return receive(routeId,authorization,operation,async()=>({event}));
 }};
}
