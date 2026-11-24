import type {Static} from '@sinclair/typebox';
import type {PhoneInboundListSchema,PhoneInboundDetailSchema} from '@thaara/contracts';
import {PhoneInboundReportSchema,PhoneInboundAppointmentSchema} from '@thaara/contracts';
import type {AuthenticatedScope} from '@thaara/db';
import {AppError,ForbiddenError} from '@thaara/observability';
import type {PhoneInboundEventRepository} from './phone-inbound-event-store.js';
import {readInboundReports,type StoredInboundReport} from './phone-inbound-reports.js';
import type {InboundCalendarReceipt} from './phone-sarvam-inbound-normalize.js';

const forbidden=()=>new ForbiddenError('An active owner session is required to read inbound reports.');
const unavailable=()=>new AppError('Inbound reports could not be verified.','PHONE_INBOUND_FEED_UNAVAILABLE',503);
const reportKeys=[...Object.keys(PhoneInboundReportSchema.properties),'workspaceId','ownerUserId'];
function knownKeys(value:unknown,keys:readonly string[]){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw unavailable();
}
function checkStoredRow(row:StoredInboundReport){
 knownKeys(row,reportKeys);
 if(row.appointment!=null)knownKeys(row.appointment,Object.keys(PhoneInboundAppointmentSchema.properties));
 if(row.recordingReference!=null)knownKeys(row.recordingReference,['interactionId','expiresAt','noticeConfirmed']);
 if(row.transcript!==undefined){if(!Array.isArray(row.transcript))throw unavailable();for(const turn of row.transcript)knownKeys(turn,['speaker','text','languageBasis']);}
}
function capture(scope:AuthenticatedScope):Readonly<AuthenticatedScope>{
 try{
  if(!scope||scope.role!=='owner'||[scope.workspaceId,scope.userId,scope.sessionTokenHash].some(v=>typeof v!=='string'||!v||v.length>256))throw forbidden();
  return Object.freeze({workspaceId:scope.workspaceId,userId:scope.userId,role:'owner',sessionTokenHash:scope.sessionTokenHash});
 }catch{throw forbidden();}
}
export interface InboundJournalFeedOptions {
 repository:Pick<PhoneInboundEventRepository,'list'|'read'>;
 /** Trusted read-only confirmed-receipt ledger; never provider/model assertions or a Calendar mutation. */
 verifyAppointment?:(scope:Readonly<AuthenticatedScope>,report:Readonly<StoredInboundReport>)=>Promise<InboundCalendarReceipt|null>;
}
/** LOCAL TEST-ONLY owner read composition. Does not register routes, create bookings or authenticate service writes. */
export function createInboundJournalReportFeed(options:InboundJournalFeedOptions){
 if(process.env.NODE_ENV!=='test')throw Error('Inbound journal feed is test-only pending production admission.');
 const list=options.repository.list.bind(options.repository),read=options.repository.read.bind(options.repository),verify=options.verifyAppointment;
 const guarded=async<T>(work:()=>Promise<T>):Promise<T>=>{try{return await work();}catch(error){if(error instanceof ForbiddenError)throw forbidden();throw unavailable();}};
 async function appointments(scope:Readonly<AuthenticatedScope>,rows:StoredInboundReport[]){
  for(const row of rows){
   const pending=row.outcome==='callback_requested'&&row.callbackConsent==='confirmed'&&!!row.callbackRequestId&&!!row.callerPhone;
   if(row.outcome!=='booked_appointment'&&!row.appointment&&!pending)continue;
   if(pending&&!verify)continue;
   if(!verify||(!pending&&!row.appointment)||!row.callerPhone||!row.providerInteractionId)throw unavailable();
   let receipt:InboundCalendarReceipt|null;
   try{receipt=structuredClone(await verify(scope,structuredClone(row)));}catch{if(pending)continue;throw unavailable();}
   if(pending&&!receipt)continue;
   if(pending){
    // Read-only join against an independently verified durable Calendar receipt. Never rewrite the call journal
    // or treat caller/model claims, an approval alone, or a provider acknowledgement as a booking.
    if(!receipt||receipt.verified!==true||receipt.workspaceId!==scope.workspaceId||receipt.ownerUserId!==scope.userId||receipt.interactionId!==row.providerInteractionId||receipt.callerPhone!==row.callerPhone)throw unavailable();
    row.appointment={eventId:receipt.eventId,startsAt:receipt.startsAt,endsAt:receipt.endsAt,timezone:receipt.timezone,verification:'verified'};
    row.outcome='booked_appointment';
   }
   const a=row.appointment!;
   if(!receipt||receipt.verified!==true||receipt.workspaceId!==scope.workspaceId||receipt.ownerUserId!==scope.userId||receipt.interactionId!==row.providerInteractionId
    ||receipt.callerPhone!==row.callerPhone||receipt.eventId!==a.eventId||receipt.startsAt!==a.startsAt||receipt.endsAt!==a.endsAt||receipt.timezone!==a.timezone)throw unavailable();
  }
 }
 return Object.freeze({
  async list(scope:AuthenticatedScope):Promise<Static<typeof PhoneInboundListSchema>>{
   const owner=capture(scope);return guarded(async()=>{
    const rows=structuredClone(await list(owner));if(!Array.isArray(rows)||rows.length>100)throw unavailable();for(const row of rows)checkStoredRow(row);
    const view=await readInboundReports(owner,async()=>rows);
    if(!('reports'in view)||!Array.isArray(view.reports))throw unavailable();
    await appointments(owner,rows);
    const enriched=await readInboundReports(owner,async()=>rows);
    if(!('reports'in enriched)||!Array.isArray(enriched.reports))throw unavailable();return {status:'ready',reports:enriched.reports};
   });
  },
  async detail(scope:AuthenticatedScope,id:string):Promise<Static<typeof PhoneInboundDetailSchema>>{
   const owner=capture(scope);if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw forbidden();
   return guarded(async()=>{
    const row=structuredClone(await read(owner,id));if(row===null)return {status:'not_found',report:null};
    if(!row||row.id!==id)throw unavailable();
    checkStoredRow(row);
    const view=await readInboundReports(owner,async()=>[row],id);
    if(!('report'in view)||view.status!=='ready'||!view.report)throw unavailable();
    await appointments(owner,[row]);
    const enriched=await readInboundReports(owner,async()=>[row],id);
    if(!('report'in enriched)||enriched.status!=='ready'||!enriched.report)throw unavailable();return {status:'ready',report:enriched.report};
   });
  }
 });
}
export type InboundJournalReportFeed=ReturnType<typeof createInboundJournalReportFeed>;
