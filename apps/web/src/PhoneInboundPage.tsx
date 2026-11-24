import {useEffect,useRef,useState} from 'react';
import {PhoneCallbackReports} from './PhoneCallbackReports';
import {PhoneAppointmentReview} from './PhoneAppointmentReview';
import {
  PhoneCallRecordingPlayer,
  PhoneCallTranscriptPanel,
  PhoneIncomingIcon,
  PhoneStatusBadge,
  formatShortDateTime,
  formatMaskedPhone,
  formatCallSecondaryLine,
  type CallMediaMetadata
} from './PhoneCallMediaOptions';

type Outcome='enquired'|'callback_requested'|'booked_appointment'|'needs_review';
interface Summary{
 id:string;occurredAt:string;maskedPhone:string;outcome:Outcome;providerVerified:false;
 customerName?:string|null;preferredContactTime?:string|null;
 direction?:'inbound';durationSeconds?:number|null;callStatus?:string;enquirySummary?:string|null;
 recordingAvailable?:boolean;transcriptAvailable?:boolean;
}
interface Detail extends Summary{
 callerPhone:string|null;customerName:string|null;business:string|null;serviceNeeded:string|null;enquirySummary:string|null;callbackRequestId:string|null;
 providerInteractionId?:string;timestampSource?:string;durationSeconds?:number|null;callStatus?:string;preferredContactTime?:string|null;callbackPreference?:string;callbackConsent?:string;
 appointment?:{eventId:string;startsAt:string;endsAt:string;timezone:string;verification:'verified'}|null;
 transcript?:{speaker:'agent'|'caller';text:string;languageBasis:'provider_original'|'provider_english'}[];transcriptExpiresAt?:string;
 recordingReference?:{interactionId:string;expiresAt:string;noticeConfirmed:true}|null;
 recordingAvailable?:boolean;callbackNotificationStatus?:string|null;
}
interface State{
 status:'loading'|'ready'|'not_configured';
 reports:Summary[];
 detail:Detail|null;
 activeOption:{id:string;tab:'recording'|'transcript'}|null;
 error:string|null;
 busy:boolean;
}
const label=(status:Outcome)=>({enquired:'Enquired',callback_requested:'Callback requested',booked_appointment:'Booked appointment',needs_review:'Needs review'})[status];
const callStatusLabel=(s?:string)=>s?({ended:'Completed',interrupted:'Interrupted',failed:'Failed',no_answer:'No answer',busy:'Busy',unknown:'Unknown'}[s]??s):null;
const validSummary=(r:Summary)=>r&&/^[A-Za-z0-9_-]{1,128}$/.test(r.id)&&Number.isFinite(Date.parse(r.occurredAt))
 &&typeof r.maskedPhone==='string'&&(/^(?:•••• [0-9]{4}|Number unavailable)$/.test(r.maskedPhone))
 &&['enquired','callback_requested','booked_appointment','needs_review'].includes(r.outcome)&&r.providerVerified===false
 &&['customerName','preferredContactTime','enquirySummary'].every(k=>r[k as keyof Summary]===undefined||r[k as keyof Summary]===null||typeof r[k as keyof Summary]==='string'&&String(r[k as keyof Summary]).length<=2000);
const validDetails=(r:Detail)=>{
 if(r.providerInteractionId!==undefined&&(typeof r.providerInteractionId!=='string'||r.providerInteractionId.length>256))return false;
 if(r.durationSeconds!==undefined&&r.durationSeconds!==null&&(!Number.isFinite(r.durationSeconds)||r.durationSeconds<0||r.durationSeconds>86400))return false;
 if(r.callStatus!==undefined&&!['ended','interrupted','failed','no_answer','busy','unknown'].includes(r.callStatus))return false;
 if(r.preferredContactTime!==undefined&&r.preferredContactTime!==null&&(typeof r.preferredContactTime!=='string'||r.preferredContactTime.length>2000))return false;
 if(r.callbackPreference!==undefined&&!['requested','declined','unknown'].includes(r.callbackPreference))return false;
 if(r.callbackConsent!==undefined&&!['confirmed','declined','unknown'].includes(r.callbackConsent))return false;
 if(r.outcome==='booked_appointment'&&!r.appointment)return false;
 if(r.appointment&&(!r.appointment.eventId||r.appointment.verification!=='verified'||!Number.isFinite(Date.parse(r.appointment.startsAt))||!Number.isFinite(Date.parse(r.appointment.endsAt))||Date.parse(r.appointment.endsAt)<=Date.parse(r.appointment.startsAt)))return false;
 if(r.transcript&&(!Array.isArray(r.transcript)||r.transcript.length>200||!r.transcriptExpiresAt||!Number.isFinite(Date.parse(r.transcriptExpiresAt))||r.transcript.some(t=>!['agent','caller'].includes(t.speaker)||typeof t.text!=='string'||t.text.length>2000||!['provider_original','provider_english'].includes(t.languageBasis))))return false;
 if(r.recordingReference&&(!r.recordingReference.noticeConfirmed||r.recordingReference.interactionId!==r.providerInteractionId||!Number.isFinite(Date.parse(r.recordingReference.expiresAt))))return false;
 return true;
};

async function get(path:string,signal:AbortSignal){
 const primary=await fetch('/api/v1/connectors/phone/call-history/inbound'+path,{credentials:'include',cache:'no-store',signal});
 if(primary.status===404&&path===''){
  const legacy=await fetch('/api/v1/connectors/phone/inbound/reports'+path,{credentials:'include',cache:'no-store',signal});
  if(!legacy.ok)throw Error(legacy.status===403?'Only the workspace owner can view inbound customer reports.':'Inbound reports could not be loaded.');
  return legacy.json();
 }
 if(!primary.ok)throw Error(primary.status===403?'Only the workspace owner can view inbound customer reports.':'Inbound reports could not be loaded.');
 return primary.json();
}

function buildInboundMediaMetadata(r:Summary,detail:Detail|null):CallMediaMetadata{
 const d=detail?.id===r.id?detail:null;
 const unexpiredTx=d?.transcript&&d.transcriptExpiresAt&&Date.parse(d.transcriptExpiresAt)>Date.now()?d.transcript:[];
 const recAvail=Boolean(d?.recordingAvailable??r.recordingAvailable??(d?.recordingReference&&Date.parse(d.recordingReference.expiresAt)>Date.now()));
 const cbStatus=d?.outcome==='callback_requested'?'Callback requested (confirmed)':d?.outcome==='needs_review'&&d?.callbackPreference==='requested'?'Needs review':null;
 return {
  direction:'inbound',
  callId:r.id,
  recordingAvailable:recAvail,
  customerName:d?.customerName??r.customerName??null,
  phoneNumber:d?.callerPhone??(r.maskedPhone!=='Number unavailable'?r.maskedPhone:null),
  business:d?.business??null,
  interestedService:d?.serviceNeeded??null,
  requirements:d?.enquirySummary??r.enquirySummary??null,
  preferredCallbackTime:d?.preferredContactTime??r.preferredContactTime??null,
  callDate:`${new Date(d?.occurredAt??r.occurredAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST`,
  durationSeconds:d?.durationSeconds??r.durationSeconds??null,
  outcome:`${label(d?.outcome??r.outcome)}${callStatusLabel(d?.callStatus??r.callStatus)?` (${callStatusLabel(d?.callStatus??r.callStatus)})`:''}`,
  callbackStatus:cbStatus,
  summary:d?.enquirySummary??r.enquirySummary??null,
  transcript:unexpiredTx.map(t=>({speaker:t.speaker==='agent'?'thaara' as const:'customer' as const,text:t.text}))
 };
}

export function PhoneInboundPage({initialState,role,ownerIdentity}:{initialState?:Partial<State>;role:string;ownerIdentity?:{userId:string;workspaceId:string}}){
 const [state,setState]=useState<State>({status:'loading',reports:[],detail:null,activeOption:null,error:null,busy:false,...initialState});
 const request=useRef<AbortController|null>(null);
 const load=async()=>{
  request.current?.abort();const controller=new AbortController();request.current=controller;
  setState(s=>({...s,status:'loading',error:null,detail:null,activeOption:null,busy:false}));
  try{
   const data=await get('',controller.signal);
   if(!['ready','not_configured'].includes(data.status)||!Array.isArray(data.reports)||data.reports.length>100||!data.reports.every(validSummary)
    ||data.status==='not_configured'&&data.reports.length)throw Error('Invalid inbound report response.');
   if(!controller.signal.aborted)setState(s=>({...s,status:data.status,reports:data.reports}));
  }catch(error){if(!controller.signal.aborted)setState(s=>({...s,status:'ready',reports:[],error:error instanceof Error?error.message:'Inbound reports unavailable.'}));}
 };
 useEffect(()=>{
  if(role!=='owner'){request.current?.abort();setState({status:'ready',reports:[],detail:null,activeOption:null,error:null,busy:false});}
  else if(!initialState)void load();
  return()=>request.current?.abort();
 },[initialState,role]);
 const details=async(id:string,keepOption?:{id:string;tab:'recording'|'transcript'}|null)=>{
  request.current?.abort();const controller=new AbortController();request.current=controller;
  setState(s=>({...s,busy:true,error:null,detail:s.detail?.id===id?s.detail:null,...(keepOption!==undefined?{activeOption:keepOption}:{})}));
  try{
   const data=await get('/'+encodeURIComponent(id),controller.signal),r=data.report as Detail;
   if(data.status!=='ready'||!validSummary(r)||!validDetails(r)||r.id!==id
    ||!['customerName','business','serviceNeeded','enquirySummary','callbackRequestId'].every(k=>r[k as keyof Detail]===null||typeof r[k as keyof Detail]==='string'&&String(r[k as keyof Detail]).length<=2000)
    ||r.callerPhone!==null&&!/^\+[1-9][0-9]{7,14}$/.test(r.callerPhone))throw Error('This inbound report could not be verified. Refresh the list.');
   if(!controller.signal.aborted)setState(s=>({...s,detail:r,busy:false}));
  }catch(error){if(!controller.signal.aborted)setState(s=>({...s,busy:false,error:error instanceof Error?error.message:'Details unavailable.'}));}
 };
 const toggleOption=(r:Summary,tab:'recording'|'transcript')=>{
  const isSame=state.activeOption?.id===r.id&&state.activeOption.tab===tab;
  if(isSame){setState(s=>({...s,activeOption:null}));return;}
  const nextOpt={id:r.id,tab};
  if(state.detail?.id===r.id){setState(s=>({...s,activeOption:nextOpt}));}
  else{void details(r.id,nextOpt);}
 };
 const d=state.detail;
 if(role!=='owner')return <section className="integration-card"><h2>Inbound calls</h2><p>Only the workspace owner can view inbound customer reports.</p></section>;
 return <section className="integration-card" aria-labelledby="inbound-calls-title">
  <h2 id="inbound-calls-title" className="integration-title">Inbound calls</h2>
  <PhoneCallbackReports key={(ownerIdentity?.workspaceId ?? '') + ':' + (ownerIdentity?.userId ?? '')} direction="inbound" />
  <p className="integration-muted">Customer enquiries and requests for your team to call back.</p>
  <button className="btn btn-secondary" type="button" disabled={state.status==='loading'||state.busy} onClick={()=>void load()}>Refresh</button>
  {state.error&&<p role="alert" className="error-banner">{state.error}</p>}
  {state.status==='loading'&&<p>Loading inbound calls…</p>}
  {state.status==='not_configured'&&<p>Inbound call reports are not connected yet. Incoming calls may work in Sarvam; their reports are not yet being saved here.</p>}
  {state.status==='ready'&&!state.error&&<>
   <p>{state.reports.length} calls shown · {state.reports.filter(r=>r.outcome==='callback_requested').length} callbacks requested · {state.reports.filter(r=>r.outcome==='enquired').length} enquiries · {state.reports.filter(r=>r.outcome==='booked_appointment').length} appointments · {state.reports.filter(r=>r.outcome==='needs_review').length} need review</p>
   {!state.reports.length&&<p>No saved inbound reports.</p>}
   <ul className="phone-contact-list">{state.reports.map(r=>{
    const opt=state.activeOption?.id===r.id?state.activeOption.tab:null;
    const isDetailsOpen=d?.id===r.id&&!opt;
    const mediaMeta=buildInboundMediaMetadata(r,d);
    const hasLiveRec=Boolean(d?.id===r.id&&(d.recordingAvailable||(d.recordingReference&&Date.parse(d.recordingReference.expiresAt)>Date.now())));
    const rAny=r as (Summary & {business?:string|null;serviceNeeded?:string|null});
    const secLine=formatCallSecondaryLine({
     business:(d?.id===r.id?d.business:undefined)??rAny.business,
     interestedService:(d?.id===r.id?d.serviceNeeded:undefined)??rAny.serviceNeeded,
     durationSeconds:r.durationSeconds
    });
    const closeAll=()=>setState(s=>({...s,activeOption:null,detail:null}));

    return <li className="phone-history-row phone-history-card" key={r.id}>
     <div className="phone-card-top">
      <div className="phone-card-icon-wrap">
       <PhoneIncomingIcon />
      </div>
      <div className="phone-card-content">
       <div className="phone-card-header-row">
        <span className="phone-card-name">{r.customerName||r.maskedPhone}</span>
        <PhoneStatusBadge status={label(r.outcome)} />
       </div>
       <div className="phone-card-subline" title={r.maskedPhone}>
        <span>{formatMaskedPhone(r.maskedPhone)}</span>
        <span className="sr-only" style={{display:'none'}}>{r.maskedPhone}</span>
        <span> · </span>
        <span>{formatShortDateTime(r.occurredAt)}</span>
       </div>
       {secLine&&<div className="phone-card-secondary">{secLine}</div>}
      </div>
     </div>
     <hr className="phone-card-divider" />
     <div className="phone-card-actions">
      <button
       className={`btn btn-secondary phone-pill-btn${opt==='recording'?' active':''}`}
       type="button"
       disabled={state.busy}
       aria-expanded={opt==='recording'}
       aria-label="Call Recording"
       data-testid="phone-option-recording"
       onClick={()=>toggleOption(r,'recording')}
      >
       <span aria-hidden="true" style={{marginRight:'4px'}}>▶</span>
       <span>Recording</span>
       <span className="sr-only" style={{display:'none'}}>Call Recording</span>
      </button>
      <button
       className={`btn btn-secondary phone-pill-btn${opt==='transcript'?' active':''}`}
       type="button"
       disabled={state.busy}
       aria-expanded={opt==='transcript'}
       aria-label="Transcript"
       data-testid="phone-option-transcript"
       onClick={()=>toggleOption(r,'transcript')}
      >
       <span aria-hidden="true" style={{marginRight:'4px'}}>📄</span>
       <span>Transcript</span>
      </button>
      <button
       className={`btn btn-secondary phone-pill-btn${isDetailsOpen?' active':''}`}
       type="button"
       disabled={state.busy}
       aria-expanded={isDetailsOpen}
       data-testid="phone-history-details"
       onClick={()=>isDetailsOpen?setState(s=>({...s,detail:null})):void details(r.id,null)}
      >
       <span>{isDetailsOpen?'Close Details':'Details'}</span>
       <span className="sr-only" style={{display:'none'}}>Details</span>
      </button>
     </div>
     {opt==='recording'&&<PhoneCallRecordingPlayer direction="inbound" callId={r.id} recordingAvailable={mediaMeta.recordingAvailable} onClose={closeAll}/>}
     {opt==='transcript'&&<PhoneCallTranscriptPanel metadata={mediaMeta} loading={state.busy&&d?.id!==r.id} onClose={closeAll}/>}
     {isDetailsOpen&&<div className="phone-history-details">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
       <h4 style={{margin:0}}>Call details</h4>
       <button type="button" className="btn btn-secondary" onClick={()=>setState(s=>({...s,detail:null}))} style={{padding:'3px 10px',fontSize:'0.8rem'}}>Close</button>
      </div>
      <p><strong>Direction:</strong> Inbound</p>
      <p><strong>Status:</strong> {label(d.outcome)}</p>
      <p><strong>Customer name:</strong> {d.customerName??'Not recorded'}</p>
      <p><strong>Contact number:</strong> {d.callerPhone??'Not recorded'}</p>
      <p><strong>Business:</strong> {d.business??'Not recorded'}</p>
      <p><strong>Service required:</strong> {d.serviceNeeded??'Not recorded'}</p>
      <p><strong>Enquiry report:</strong> {d.enquirySummary??'Not recorded'}</p>
      <p><strong>Call ID:</strong> {d.providerInteractionId??'Not recorded'}</p>
      {d.timestampSource==='received_at'&&<p>Call time was unavailable; the displayed time is when the report was received.</p>}
      <p><strong>Duration:</strong> {d.durationSeconds==null?'Not recorded':`${d.durationSeconds} seconds`}</p>
      <p><strong>Call status:</strong> {d.callStatus??'Not recorded'}</p>
      <p><strong>Callback preference:</strong> {d.callbackPreference??'Not recorded'}</p>
      <p><strong>Contact consent:</strong> {d.callbackConsent??'Not recorded'}</p>
      <p><strong>Preferred contact time:</strong> {d.preferredContactTime??'Not recorded'}</p>
      {d.outcome==='callback_requested'&&/^[a-f0-9]{64}$/.test(d.id)&&<PhoneAppointmentReview key={d.id} id={d.id} direction="inbound" owner={{role,userId:ownerIdentity?.userId??'',workspaceId:ownerIdentity?.workspaceId??''}} customerName={d.customerName} requestedTime={d.preferredContactTime??null} consentConfirmed={d.callbackConsent==='confirmed'&&!!d.callbackRequestId&&!!d.callerPhone}/>}
      {d.appointment&&<div><strong>Verified appointment</strong><p>{new Date(d.appointment.startsAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} – {new Date(d.appointment.endsAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST</p><p>Calendar event: {d.appointment.eventId}</p></div>}
      {d.transcript&&d.transcriptExpiresAt&&Date.parse(d.transcriptExpiresAt)>Date.now()&&<details><summary>Call transcript</summary>{d.transcript.map((t,i)=><p key={i}><strong>{t.speaker==='caller'?'Customer':'Thaara'}:</strong> {t.text} {t.languageBasis==='provider_english'&&<small>(Provider English rendering)</small>}</p>)}</details>}
      {hasLiveRec?<PhoneCallRecordingPlayer direction="inbound" callId={d.id} recordingAvailable={true} onClose={closeAll}/>:<p><strong>Recording:</strong> Not retained or unavailable</p>}
      <p className="integration-muted">Provider-reported conversation; not independently verified. A callback request does not place a call automatically.</p>
     </div>}
    </li>;})}</ul>
  </>}
 </section>;
}
