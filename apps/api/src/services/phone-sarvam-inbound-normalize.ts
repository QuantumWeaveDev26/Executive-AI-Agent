import {createHash} from 'node:crypto';
import {computeCanonicalParameterHash} from '@thaara/contracts';
import {ForbiddenError} from '@thaara/observability';
import {makeInboundReport,readInboundReports,type StoredInboundReport} from './phone-inbound-reports.js';
export interface SarvamInboundPayloadBinding{routeId:string;workspaceId:string;ownerUserId:string;appId:string;appVersion:number;deploymentId:string;agentPhoneNumber:string}
export interface InboundCalendarReceipt{interactionId:string;workspaceId:string;ownerUserId:string;callerPhone:string;eventId:string;startsAt:string;endsAt:string;timezone:string;verified:true}
export interface SarvamInboundNormalizationOptions{
 lookupVerifiedAppointment?:(interactionId:string)=>Promise<InboundCalendarReceipt|null>;
 now?:()=>number;
 retention?:{days:number;callerNoticeVerified:(interactionId:string)=>Promise<boolean>;recordingAvailable?:(interactionId:string)=>Promise<boolean>};
}
const fail=()=>{throw new ForbiddenError('Inbound delivery could not be authenticated or validated.');};
const text=(value:unknown):string|null=>{
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||value.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))return fail();
 return value.trim()||null;
};
const phone=(value:unknown)=>{if(value==null||value==='')return null;if(typeof value!=='string'||!/^\+[1-9][0-9]{7,14}$/.test(value))return fail();return value;};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
/** Require one unambiguous full recap number, not a substring of a different destination. */
const recapsCaller=(spoken:string,caller:string)=>{
 const candidates=[...spoken.matchAll(/\+?[0-9](?:[0-9 ()-]*[0-9])?/g)];
 const full=candidates.filter(m=>m[0].replace(/[^0-9]/g,'').length>=8);
 if(full.some(m=>/^\s*(?:ext(?:ension)?(?:\b|(?=\d))|x\s*\d|[#.]\s*\d)/iu.test(spoken.slice(m.index!+m[0].length))))return false;
 const numbers=new Set(full.map(m=>m[0].replace(/[^0-9]/g,'')));
 return numbers.size===1&&numbers.has(caller.slice(1));
};
/** Normalization only. Caller must authenticate first. No scope/authorization, SQL, provider or Calendar mutation. */
export async function normalizeSarvamInboundPayload(binding:SarvamInboundPayloadBinding,payload:unknown,options:SarvamInboundNormalizationOptions={}){
 // Owner-shaped fields are ONLY for existing pure report shape validation; never an authenticated DB session.
 const profile={...structuredClone(binding),userId:binding.ownerUserId,role:'owner'};
 const now=options.now??Date.now,lookup=options.lookupVerifiedAppointment,retention=options.retention;
 if(retention&&(!Number.isInteger(retention.days)||retention.days<1||retention.days>30))fail();
  const b=object(structuredClone(payload));
  if(Buffer.byteLength(JSON.stringify(b),'utf8')>65536||b.app_id!==profile.appId||b.app_version!==profile.appVersion||b.deployment_id!==profile.deploymentId||b.agent_phone_number!==profile.agentPhoneNumber)fail();
  const interaction=text(b.interaction_id);if(!interaction||!/^[0-9]{8}\/[A-Za-z0-9_.:-]{1,200}$/.test(interaction))fail();
  const caller=phone(b.user_phone_number),vars={...object(b.output_agent_variables),...object(b.final_agent_variables)};
  const timestamp=(v:unknown)=>{if(v==null)return null;if(typeof v!=='string'||!/Z$/.test(v)||!Number.isFinite(Date.parse(v)))return fail();return new Date(v).toISOString();};
  const start=timestamp(b.start_datetime),end=timestamp(b.end_datetime);
  if(start&&end&&Date.parse(end)<Date.parse(start))fail();
  const duration=b.duration==null?null:b.duration;if(duration!==null&&(typeof duration!=='number'||!Number.isFinite(duration)||duration<0||duration>86400))fail();
  const raw=b.interaction_transcript??[];if(!Array.isArray(raw)||raw.length>64)fail();
  const turns=(raw as unknown[]).map(value=>{const t=object(value);if(t.role!=='agent'&&t.role!=='user')return fail();return {speaker:t.role==='agent'?'agent' as const:'caller' as const,text:text(t.indic_text)??text(t.en_text)??'',english:text(t.en_text)??'',languageBasis:t.indic_text?'provider_original' as const:'provider_english' as const};});
  let consent=false,declined=false;
  const affirmative=/^(yes(?:,? please)?|yes please contact me|ಹೌದು|ಹೌದು ದಯವಿಟ್ಟು|हाँ|हां|जी हाँ|जी हां)[.!।\s]*$/iu;
  const negative=/^(no(?:,? thanks)?|ಬೇಡ|ಇಲ್ಲ|नहीं|नही)[.!।\s]*$/iu;
  const withdrawal=/(?:do not|don't|don’t).*?(?:call|contact)|stop (?:calling|contacting)|cancel.*callback|ಸಂಪರ್ಕಿಸಬೇಡಿ|ಕರೆ ಮಾಡಬೇಡಿ|कॉल मत|संपर्क मत|मुझे कॉल नहीं/iu;
  for(let i=0;i<turns.length;i++){
   const previous=turns[i-1],current=turns[i]!;
   if(current.speaker==='caller'&&(withdrawal.test(current.text)||withdrawal.test(current.english)||consent&&(negative.test(current.text)||negative.test(current.english)))){
    consent=false;declined=true;continue;
   }
   if(previous?.speaker!=='agent'||current.speaker!=='caller')continue;
   const spoken=previous.english+' '+previous.text;
   const callbackOffer=/our team.*contact you.*discuss a solution for your business|ತಂಡ.*ಸಂಪರ್ಕ|टीम.*संपर्क/iu.test(spoken);
   // Saving an appointment REQUEST is consent to team follow-up, never Calendar authority.
   const appointmentOffer=/\b(?:may|can|shall) I (?:save|record) your appointment request and (?:ask|have) our team (?:to )?contact you\b/iu.test(spoken);
   const offer=callbackOffer||appointmentOffer;
   if(!offer)continue;
   if(negative.test(current.text)||negative.test(current.english)){declined=true;consent=false;}
   else if(caller&&recapsCaller(spoken,caller)&&(affirmative.test(current.text)||affirmative.test(current.english))){consent=true;declined=false;}
  }
  const preference=text(vars.callback_preference)?.toLowerCase();
  const wantsCallback=!declined&&(consent||['yes','requested','callback requested'].includes(preference??''));
  const id=digest(profile.routeId+'\n'+interaction);
  let report:StoredInboundReport={...makeInboundReport({id,occurredAt:start??end??new Date(now()).toISOString(),callerPhone:caller,
   customerName:text(vars.customer_name),business:text(vars.business_type),serviceNeeded:text(vars.requested_service),enquirySummary:text(vars.enquiry_summary),
   callbackInterest:consent||wantsCallback?'yes':end?'no':'unknown'},
   {...profile,direction:'inbound',authenticatedRoute:true}),
   providerInteractionId:interaction!,timestampSource:start?'provider_started':end?'provider_ended':'received_at',durationSeconds:duration as number|null,callStatus:end?'ended':'unknown',preferredContactTime:text(vars.preferred_contact_time),
   callbackConsent:consent?'confirmed':declined?'declined':'unknown',callbackPreference:wantsCallback?'requested':declined||preference==='no'?'declined':'unknown',appointment:null,recordingReference:null};
  if(consent&&caller)report={...report,outcome:'callback_requested',callbackRequestId:'callback-'+id};
  // A claimed provider booking is deliberately ignored. Only this backend-owned lookup can admit a verified event.
  let appointment:InboundCalendarReceipt|null=null;try{appointment=await lookup?.(interaction!)??null;}catch{appointment=null;}
  if(appointment){
   if(appointment.verified!==true||appointment.interactionId!==interaction||appointment.workspaceId!==profile.workspaceId||appointment.ownerUserId!==profile.userId
    ||!caller||appointment.callerPhone!==caller||!appointment.eventId||!Number.isFinite(Date.parse(appointment.startsAt))||!Number.isFinite(Date.parse(appointment.endsAt))
    ||Date.parse(appointment.endsAt)<=Date.parse(appointment.startsAt)||!appointment.timezone)fail();
   report={...report,outcome:'booked_appointment',appointment:{eventId:appointment.eventId,startsAt:appointment.startsAt,endsAt:appointment.endsAt,timezone:appointment.timezone,verification:'verified'}};
  }
  let notice=false,recordingAvailable=false;
  if(retention&&(await retention.callerNoticeVerified(interaction!))===true){
   notice=true;
   const expiresAt=new Date(now()+retention.days*86400000).toISOString();
   report={...report,transcript:turns.map(({speaker,text,languageBasis})=>({speaker,text,languageBasis})),transcriptExpiresAt:expiresAt};
   if((await retention.recordingAvailable?.(interaction!))===true){recordingAvailable=true;report.recordingReference={interactionId:interaction!,expiresAt,noticeConfirmed:true};}
  }
  await readInboundReports(profile,async()=>[report]);
  const sourceDigest=computeCanonicalParameterHash({payload:b,appointment,retentionDays:retention?.days??0,notice,recordingAvailable});
  const compare=(r:StoredInboundReport)=>{
   const copy=structuredClone(r) as unknown as Record<string,unknown>;
   if(!start&&!end)delete copy.occurredAt;
   delete copy.transcriptExpiresAt;
   if(copy.recordingReference)copy.recordingReference={interactionId:r.recordingReference!.interactionId,noticeConfirmed:true};
   return computeCanonicalParameterHash(copy);
  };
 return {id,report:Object.freeze(report),sourceDigest,matchesCommitted:(committed:StoredInboundReport)=>compare(committed)===compare(report)};
}
