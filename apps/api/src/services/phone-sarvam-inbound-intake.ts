import {timingSafeEqual} from 'node:crypto';
import {Type} from '@sinclair/typebox';
import {computeCanonicalParameterHash} from '@thaara/contracts';
import type {AuthenticatedScope} from '@thaara/db';
import {ActionRegistry,PolicyGateway} from '@thaara/policy';
import {AppError,ForbiddenError} from '@thaara/observability';
import {readInboundReports,type StoredInboundReport} from './phone-inbound-reports.js';
interface Profile extends AuthenticatedScope{routeId:string;appId:string;appVersion:number;deploymentId:string;agentPhoneNumber:string;intakeApproved:true}
import {normalizeSarvamInboundPayload,type InboundCalendarReceipt as CalendarReceipt} from './phone-sarvam-inbound-normalize.js';
interface Options{
 profile:Profile;resolveSecret:()=>Promise<string>;
 store:{saveNormalized(scope:AuthenticatedScope,eventId:string,report:StoredInboundReport,sourceDigest?:string):Promise<StoredInboundReport>};
 /** Trusted backend ledger lookup ONLY. No provider field may populate this receipt. Never creates an event. */
 lookupVerifiedAppointment?:(interactionId:string)=>Promise<CalendarReceipt|null>;
 now?:()=>number;
 /** Opt-in review settings; actual purge/storage/access infrastructure remains a production gate. */
 retention?:{days:number;callerNoticeVerified:(interactionId:string)=>Promise<boolean>;recordingAvailable?:(interactionId:string)=>Promise<boolean>};
}
const fail=()=>{throw new ForbiddenError('Inbound delivery could not be authenticated or validated.');};
const phone=(value:unknown)=>{if(value==null||value==='')return null;if(typeof value!=='string'||!/^\+[1-9][0-9]{7,14}$/.test(value))return fail();return value;};
function gateway(){
 const registry=new ActionRegistry();
 // Private intake-only catalog. Never registered in the model/global action catalog or production startup.
 registry.register({metadata:{name:'phone.inbound.store_admitted_report',actionClass:'write',risk:'low',approvalMode:'none',
  idempotencyRequired:true,timeoutMs:10000,retryPolicy:{maxRetries:0,backoffMs:0,exponential:false},requiredRole:'owner',auditRequired:true,
  capabilityScope:'external_connector',schemaIdentifier:'phone.inbound.store_admitted_report.v1'},
  inputSchema:Type.Object({routeId:Type.String({minLength:1,maxLength:128}),reportId:Type.String({pattern:'^[a-f0-9]{64}$'}),payloadHash:Type.String({pattern:'^[a-f0-9]{64}$'})},{additionalProperties:false})});
 return new PolicyGateway({registry});
}
/** LOCAL TEST-ONLY intake. No production constructor/registration path until runtime-principal and release review. */
export function createSarvamInboundIntake(options:Options){
 if(process.env.NODE_ENV!=='test')throw new Error('Sarvam inbound intake is test-only pending production admission.');
 const profile=Object.freeze(structuredClone(options.profile)),resolveSecret=options.resolveSecret,save=options.store.saveNormalized.bind(options.store),
  lookup=options.lookupVerifiedAppointment,now=options.now??Date.now,retention=options.retention?Object.freeze({...options.retention}):undefined,policy=gateway();
 if(profile.intakeApproved!==true||profile.role!=='owner'||!profile.sessionTokenHash||!profile.workspaceId||!profile.userId||!/^[A-Za-z0-9_-]{1,128}$/.test(profile.routeId)
  ||!profile.appId||!profile.deploymentId||!Number.isInteger(profile.appVersion)||profile.appVersion<1||!phone(profile.agentPhoneNumber))fail();
 if(retention&&(!Number.isInteger(retention.days)||retention.days<1||retention.days>30))fail();
 return {async ingest(routeId:string,authorization:string|undefined,payload:unknown):Promise<StoredInboundReport>{
  if(routeId!==profile.routeId||!authorization||!/^Bearer [A-Za-z0-9_-]{32,256}$/.test(authorization))fail();
  let secret:string;try{secret=await resolveSecret();}catch{throw new AppError('Inbound authentication is unavailable.','PHONE_INBOUND_NOT_CONFIGURED',503);}
  if(!/^[A-Za-z0-9_-]{32,256}$/.test(secret))fail();
  const expected=Buffer.from(secret),given=Buffer.from(authorization!.slice(7));
  if(given.length!==expected.length||!timingSafeEqual(given,expected))fail();
  const normalized=await normalizeSarvamInboundPayload({routeId:profile.routeId,workspaceId:profile.workspaceId,ownerUserId:profile.userId,
   appId:profile.appId,appVersion:profile.appVersion,deploymentId:profile.deploymentId,agentPhoneNumber:profile.agentPhoneNumber},payload,
   {lookupVerifiedAppointment:lookup,retention,now});
  const {id,report,sourceDigest}=normalized;
  const decision=policy.evaluate(profile,{actionName:'phone.inbound.store_admitted_report',parameters:{routeId,reportId:id,payloadHash:computeCanonicalParameterHash(report)},idempotencyKey:'phone-inbound:'+id});
  if(!decision.allowed)fail();
  const committed=await save(profile,id,report,sourceDigest);
  await readInboundReports(profile,async()=>[committed]);
  if(!normalized.matchesCommitted(committed))fail();
  return committed;
 }};
}
