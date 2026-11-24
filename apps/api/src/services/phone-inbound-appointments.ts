import {Value} from '@sinclair/typebox/value';
import {computeCanonicalParameterHash,PhoneAppointmentRequestSchema,type PhoneAppointmentRequest} from '@thaara/contracts';
import type {AuthenticatedScope,TransactionalDbClient,DbClient} from '@thaara/db';
import {AppError,ForbiddenError} from '@thaara/observability';
import {createInboundPrincipalGate,type InboundPrincipalTransactions} from './phone-inbound-principal.js';
import {createInboundPrincipalJournal} from './phone-inbound-principal-journal.js';
import {buildInboundServiceBinding,type SarvamInboundServiceProfile} from './phone-sarvam-inbound-service.js';
import {normalizeSarvamInboundPayload} from './phone-sarvam-inbound-normalize.js';
import {createPhoneAppointmentCalendar} from './phone-appointment-calendar.js';
import {parseStrictRfc3339,validateIanaTimeZone,type GoogleCalendarFoundation} from './google-calendar.js';
import type {InboundEventInput} from './phone-inbound-events.js';

const denied=()=>new ForbiddenError('Inbound appointment authorization was denied.');
const invalid=()=>new AppError('Appointment details are invalid.','PHONE_APPOINTMENT_INVALID',400);
/** A distinct expiring/revocable grant must be provisioned for this exact call; never reuse a generic report grant. */
export function buildAppointmentBinding(profile:SarvamInboundServiceProfile,interactionId:string){
 if(!/^[0-9]{8}\/[A-Za-z0-9_.:-]{1,200}$/.test(interactionId))throw invalid();
 const base=buildInboundServiceBinding(profile);
 return Object.freeze({...base,profileFingerprint:computeCanonicalParameterHash({base:base.profileFingerprint,interactionId,operation:'appointment_request.v1'})});
}
type Calendar=Pick<GoogleCalendarFoundation,'writeReadiness'|'findConflicts'|'listEvents'|'readEvent'>;
export interface InboundAppointmentOptions {
 profile:SarvamInboundServiceProfile;interactionId:string;transactions:InboundPrincipalTransactions<DbClient>;
 db:TransactionalDbClient;calendar:Calendar;now?:()=>number;
 /** Trusted server-only integration port. Must return an actual existing owner session hash ONLY after
  * separate owner delegation for availability/proposal preparation. Never resolves from provider input.
  * This module independently authenticates it against the DB. No production resolver is installed. */
 resolveProposalOwnerSession:()=>Promise<string|null>;
}

/** LOCAL TEST-ONLY composition; no startup registration, live delegation, migrations or new Calendar executor. */
export function createInboundAppointments(options:InboundAppointmentOptions){
 if(process.env.NODE_ENV!=='test')throw Error('Inbound appointments are test-only pending database and runtime admission.');
 const profile=Object.freeze(structuredClone(options.profile)),interactionId=options.interactionId,binding=buildAppointmentBinding(profile,interactionId);
 const journal=createInboundPrincipalJournal(createInboundPrincipalGate({profile:binding,transactions:options.transactions,now:options.now}));
 const db=options.db,resolveSession=options.resolveProposalOwnerSession;
 const propose=createPhoneAppointmentCalendar({db,calendar:options.calendar,direction:'inbound',savedBeforeProposal:true});
 const reply=(id:string,status:'request_saved'|'approval_pending'|'slot_unavailable'|'appointment_confirmed'|'needs_review')=>({saved:true as const,requestId:id,status,appointmentConfirmed:status==='appointment_confirmed'});

 async function ownerSession():Promise<AuthenticatedScope|null>{
  const hash=await resolveSession();if(!hash)return null;
  return db.withAuthenticatedScope(hash,async(_tx)=>{
   // Derive identity from this exact live session; membership visibility is not session identity.
   const r=await _tx.query<{workspace_id:string;user_id:string;role:string}>(
    `SELECT workspace_id,user_id,role FROM public.resolve_session_scope($1)`,[hash]);
   if(r.rows.length!==1||r.rows[0]!.workspace_id!==profile.workspaceId||r.rows[0]!.user_id!==profile.ownerUserId||r.rows[0]!.role!=='owner')return null;
   return Object.freeze({workspaceId:profile.workspaceId,userId:profile.ownerUserId,role:'owner',sessionTokenHash:hash});
  });
 }

 return {async request(routeId:string,authorization:string|undefined,raw:unknown){
  if(!Value.Check(PhoneAppointmentRequestSchema,raw))throw invalid();
  const body=structuredClone(raw) as PhoneAppointmentRequest,slot=body.slot;
  try{validateIanaTimeZone(slot.timeZone);const start=parseStrictRfc3339(slot.startAt,'startAt'),end=parseStrictRfc3339(slot.endAt,'endAt');
   if(end<=start||end-start>24*60*60*1000)throw invalid();}catch{throw invalid();}
  const receipt=await journal.appendPrepared(routeId,authorization,'callback',async()=>{
   // Authentication and call-scoped grant were validated before reading/normalizing call data.
   if(body.payload.interaction_id!==interactionId)throw denied();
   const payload=body.payload;
   const vars=payload.final_agent_variables&&typeof payload.final_agent_variables==='object'&&!Array.isArray(payload.final_agent_variables)?payload.final_agent_variables as Record<string,unknown>:{};
   payload.final_agent_variables={...vars,preferred_contact_time:`${slot.startAt} – ${slot.endAt} (${slot.timeZone})`};
   const normalized=await normalizeSarvamInboundPayload(profile,payload,{now:options.now});
   const report=normalized.report;
   if(report.callbackConsent!=='confirmed'||report.outcome!=='callback_requested'||!report.callerPhone)throw denied();
   const event:InboundEventInput={eventId:'callback_requested-'+report.id,callId:report.id,kind:'callback_requested',report,sourceDigest:normalized.sourceDigest};
   return {event,matchesCommitted:normalized.matchesCommitted};
  });
  if(receipt.report.callbackConsent!=='confirmed'||!receipt.report.callbackRequestId)return reply(receipt.report.id,'needs_review');
  // Calendar failure cannot rewrite a committed request into "not saved". No retry/automatic booking.
  try{const scope=await ownerSession();return scope?await propose(scope,receipt.report,slot,interactionId):reply(receipt.report.id,'request_saved');}catch{return reply(receipt.report.id,'request_saved');}
 }};
}
