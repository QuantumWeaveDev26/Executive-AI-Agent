import {Value} from '@sinclair/typebox/value';
import {PhoneOutboundAppointmentRequestSchema,type PhoneOutboundAppointmentRequest} from '@thaara/contracts';
import type {AuthenticatedScope,TransactionalDbClient} from '@thaara/db';
import {AppError,ForbiddenError} from '@thaara/observability';
import {parseStrictRfc3339,validateIanaTimeZone} from './google-calendar.js';

/** Exact currently authenticated owner, never an owner session selected or delegated by a provider. */
export async function authenticatePhoneAppointmentOwner(db:TransactionalDbClient,input:AuthenticatedScope):Promise<Readonly<AuthenticatedScope>>{
 const denied=()=>new ForbiddenError('Phone appointment owner authorization was denied.');
 if(!input||input.role!=='owner'||[input.workspaceId,input.userId,input.sessionTokenHash].some(v=>typeof v!=='string'||!v||v.length>256))throw denied();
 const scope=Object.freeze({workspaceId:input.workspaceId,userId:input.userId,role:'owner' as const,sessionTokenHash:input.sessionTokenHash});
 const valid=await db.withAuthenticatedScope(scope.sessionTokenHash,async tx=>{
  const r=await tx.query<{workspace_id:string;user_id:string;role:string}>('SELECT workspace_id,user_id,role FROM public.resolve_session_scope($1)',[scope.sessionTokenHash]);
  const s=r.rows[0];return r.rows.length===1&&s?.workspace_id===scope.workspaceId&&s.user_id===scope.userId&&s.role==='owner';
 });
 if(!valid)throw denied();return scope;
}
/** Same strict owner-side slot body for either direction; it contains no identity, grants or approval. */
export function readPhoneAppointmentSlot(raw:unknown,now:number,requireFuture=true){
 const invalid=()=>new AppError('Appointment details are invalid.','PHONE_APPOINTMENT_INVALID',400);
 if(!Value.Check(PhoneOutboundAppointmentRequestSchema,raw))throw invalid();
 const {slot}=structuredClone(raw) as PhoneOutboundAppointmentRequest;
 try{validateIanaTimeZone(slot.timeZone);const start=parseStrictRfc3339(slot.startAt,'startAt'),end=parseStrictRfc3339(slot.endAt,'endAt');
  if(!Number.isFinite(now)||requireFuture&&start<=now||end<=start||end-start>86400000)throw invalid();
 }catch{throw invalid();}return slot;
}
