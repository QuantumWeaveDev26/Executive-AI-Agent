import { ApiRequestError,PlanWithStepsItem,decideApproval,request } from './api';
export const GMAIL_PAGE_SIZE=10;
export const GMAIL_READONLY_SCOPE='https://www.googleapis.com/auth/gmail.readonly';
export const GMAIL_SEND_SCOPE='https://www.googleapis.com/auth/gmail.send';
export interface GmailStatus {connectorName:'gmail';status:'not_configured'|'disconnected'|'connected'|'reconnect_required';configured:boolean;connected:boolean;mode:'disabled'|'mock'|'live';scopes:string[];lastVerifiedAt:string|null;connectedEmail?:string|null;}
export interface GmailMessage {id:string;threadId?:string;subject?:string;from?:string;replyTo?:string;to?:string;cc?:string;date?:string;snippet?:string;bodyText?:string;isUnread?:boolean;untrusted:true;mode:'mock'|'live';}
export interface GmailSearchResult {messages:{id:string;threadId?:string}[];nextPageToken?:string;untrusted:true;mode:'mock'|'live';}
export interface GmailOAuthStartResult {authorizationUrl:string;expiresAt:string;mode:'mock'|'live';}
export interface GmailApiOptions {allowLiveMode?:boolean;}
/** An email or reply that is prepared on the server and waiting for the user's explicit approval. */
export interface GmailPreparedSend {planId:string;approvalId:string;status:'awaiting_approval';from:string;to:string;cc?:string;subject?:string;bodyText:string;threadId?:string;sourceMessageId?:string;expiresAt:string;}
export type GmailSendOutcomeKind='sent'|'failed'|'unverified'|'cancelled'|'pending';
export interface GmailSendOutcome {kind:GmailSendOutcomeKind;to:string;providerMessageId?:string;providerThreadId?:string;reason?:string;}
const base='/api/v1/connectors/gmail';
const invalid=()=>new ApiRequestError(502,'Gmail data is unavailable.');
const idValid=(id:unknown):id is string=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,256}$/.test(id);
const uuidValid=(id:unknown):id is string=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const emailValid=(email:unknown):email is string=>typeof email==='string'&&email.length>=3&&email.length<=320&&/^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/.test(email.trim());
const KNOWN_SCOPES=new Set([GMAIL_READONLY_SCOPE,GMAIL_SEND_SCOPE]);
function status(value:GmailStatus,options?:GmailApiOptions):GmailStatus {
 const allowedModes=options?.allowLiveMode?['disabled','mock','live']:['disabled','mock'];
 if(!value||value.connectorName!=='gmail'||!['not_configured','disconnected','connected','reconnect_required'].includes(value.status)||
  !allowedModes.includes(value.mode)||typeof value.connected!=='boolean'||typeof value.configured!=='boolean')throw invalid();
 const connectedEmail=value.connected&&emailValid(value.connectedEmail)?value.connectedEmail.trim():undefined;
 return {connectorName:'gmail',status:value.status,configured:value.configured,connected:value.connected,mode:value.mode,
  // Only the two Gmail scopes Thaara knows about are kept; anything else is dropped.
  scopes:Array.isArray(value.scopes)?[...new Set(value.scopes.filter(v=>typeof v==='string'&&KNOWN_SCOPES.has(v)))]:[],
  lastVerifiedAt:typeof value.lastVerifiedAt==='string'&&!Number.isNaN(Date.parse(value.lastVerifiedAt))?value.lastVerifiedAt:null,
  ...(connectedEmail?{connectedEmail}:{})};
}
/** True only for a LIVE, connected account that granted gmail.send and has a verified address. */
export function canStatusSend(value:GmailStatus|null|undefined):boolean {
 return Boolean(value&&value.mode==='live'&&value.connected&&value.status==='connected'&&value.scopes.includes(GMAIL_SEND_SCOPE)&&value.connectedEmail);
}
export async function getGmailStatus(signal?:AbortSignal,options?:GmailApiOptions){return status(await request<GmailStatus>(base+'/status',{signal}),options);}
export async function startGmailOAuth(signal?:AbortSignal,options?:GmailApiOptions):Promise<GmailOAuthStartResult>{
 const allowedModes=options?.allowLiveMode?['mock','live']:['mock'];
 const value=await request<GmailOAuthStartResult>(base+'/oauth/start',{method:'POST',body:'{}',signal});
 if(!value||typeof value.authorizationUrl!=='string'||!value.authorizationUrl.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')||
  typeof value.expiresAt!=='string'||Number.isNaN(Date.parse(value.expiresAt))||!allowedModes.includes(value.mode))throw invalid();
 return {authorizationUrl:value.authorizationUrl,expiresAt:value.expiresAt,mode:value.mode};
}
export async function searchGmail(query:string,pageToken?:string,signal?:AbortSignal,options?:GmailApiOptions):Promise<GmailSearchResult>{
 query=query.trim()||'in:inbox';
 if(query.length>1000||(pageToken!==undefined&&(!pageToken||pageToken.length>2048)))throw new ApiRequestError(400,'Invalid mail search.');
 const allowedModes=options?.allowLiveMode?['mock','live']:['mock'];
 const value=await request<GmailSearchResult>(base+'/messages/search',{method:'POST',signal,body:JSON.stringify({query,limit:GMAIL_PAGE_SIZE,...(pageToken?{pageToken}:{})})});
 if(!value||!allowedModes.includes(value.mode)||value.untrusted!==true||!Array.isArray(value.messages)||value.messages.length>GMAIL_PAGE_SIZE||
  value.messages.some(m=>!m||!idValid(m.id))||
  (value.nextPageToken!==undefined&&(typeof value.nextPageToken!=='string'||!value.nextPageToken||value.nextPageToken.length>2048)))throw invalid();
 return {messages:[...new Set(value.messages.map(m=>m.id))].map(id=>({id})),nextPageToken:value.nextPageToken,mode:value.mode,untrusted:true};
}
export async function readGmailMessage(id:string,signal?:AbortSignal,options?:GmailApiOptions):Promise<GmailMessage>{
 if(!idValid(id))throw new ApiRequestError(400,'Invalid message selection.');
 const allowedModes=options?.allowLiveMode?['mock','live']:['mock'];
 const value=await request<GmailMessage>(base+'/messages/'+encodeURIComponent(id),{signal});
 if(!value||value.id!==id||!allowedModes.includes(value.mode)||value.untrusted!==true)throw invalid();
 const result:GmailMessage={id,...(idValid(value.threadId)?{threadId:value.threadId}:{}),mode:value.mode,untrusted:true};
 for(const field of ['subject','from','replyTo','to','cc','date','snippet','bodyText'] as const){
  const text=value[field];if(text!==undefined){if(typeof text!=='string'||text.length>(field==='bodyText'?100000:field==='date'?256:4096))throw invalid();result[field]=text;}
 }
 if(value.isUnread!==undefined){if(typeof value.isUnread!=='boolean')throw invalid();result.isUnread=value.isUnread;}
 return result;
}
export async function disconnectGmail(signal?:AbortSignal,options?:GmailApiOptions){
 const value=status(await request<GmailStatus>(base+'/connection',{method:'DELETE',body:'{}',signal}),options);
 if(value.connected||!['disconnected','not_configured'].includes(value.status))throw invalid();return value;
}
export function gmailError(error:unknown):'unauthorized'|'reconnect'|'invalid_search'|'unavailable'{
 if(error instanceof ApiRequestError){if([401,403].includes(error.status))return 'unauthorized';if([409,503].includes(error.status))return 'reconnect';if(error.status===400)return 'invalid_search';}
 return 'unavailable';
}

/* ------------------------------ Step 106 & 106.3: governed new email & reply ------------------------------ */

/** Asks the server to prepare (not send) a new email. The server binds the connected sender account. */
export async function prepareGmailNewEmail(input:{to:string;subject?:string;bodyText:string},signal?:AbortSignal):Promise<GmailPreparedSend>{
 const subject=(input.subject??'').trim();
 const value=await request<GmailPreparedSend>(base+'/messages/send-new',{method:'POST',signal,
  body:JSON.stringify({to:input.to.trim(),...(subject?{subject}:{}),bodyText:input.bodyText})});
 if(!value||!uuidValid(value.planId)||!uuidValid(value.approvalId)||value.status!=='awaiting_approval'||!emailValid(value.from)||!emailValid(value.to)||
  typeof value.bodyText!=='string'||!value.bodyText||(value.subject!==undefined&&typeof value.subject!=='string'))throw invalid();
 return {planId:value.planId,approvalId:value.approvalId,status:'awaiting_approval',from:value.from,to:value.to,
  ...(value.subject?{subject:value.subject}:{}),bodyText:value.bodyText,expiresAt:String(value.expiresAt)};
}

/** Asks the server to prepare (not send) a threaded Gmail Reply or Reply All bound to sourceMessageId. */
export async function prepareGmailReplyEmail(
 input:{sourceMessageId:string;to?:string;cc?:string;subject?:string;bodyText:string;replyAll?:boolean},
 signal?:AbortSignal
):Promise<GmailPreparedSend>{
 const subject=(input.subject??'').trim();
 const to=(input.to??'').trim();
 const cc=(input.cc??'').trim();
 const value=await request<GmailPreparedSend>(base+'/messages/send-reply',{method:'POST',signal,
  body:JSON.stringify({
   sourceMessageId:input.sourceMessageId,
   ...(to?{to}:{}),
   ...(cc?{cc}:{}),
   ...(subject?{subject}:{}),
   bodyText:input.bodyText,
   ...(input.replyAll?{replyAll:true}:{})
  })});
 if(!value||!uuidValid(value.planId)||!uuidValid(value.approvalId)||value.status!=='awaiting_approval'||!emailValid(value.from)||!emailValid(value.to)||
  typeof value.bodyText!=='string'||!value.bodyText||(value.subject!==undefined&&typeof value.subject!=='string'))throw invalid();
 return {
  planId:value.planId,
  approvalId:value.approvalId,
  status:'awaiting_approval',
  from:value.from,
  to:value.to,
  ...(typeof value.cc==='string'&&value.cc?{cc:value.cc}:{}),
  ...(value.subject?{subject:value.subject}:{}),
  bodyText:value.bodyText,
  ...(typeof value.threadId==='string'&&value.threadId?{threadId:value.threadId}:{}),
  ...(typeof value.sourceMessageId==='string'&&value.sourceMessageId?{sourceMessageId:value.sourceMessageId}:{}),
  expiresAt:String(value.expiresAt)
 };
}

/**
 * Maps a governed send plan to a simple, truthful outcome. "sent" requires a verified receipt with
 * Gmail's accepted_by_gmail status and a provider message ID; anything ambiguous stays "unverified".
 */
export function gmailSendOutcomeFromPlan(plan:PlanWithStepsItem,fallbackTo=''):GmailSendOutcome{
 const step=plan.steps.find(s=>s.action_name==='gmail.messages.send_new'||s.action_name==='gmail.messages.send_reply');
 const to=typeof step?.parameters?.to==='string'?step.parameters.to:fallbackTo;
 if(!step)return {kind:'failed',to};
 const receipt=plan.receipts.find(r=>r.plan_step_id===step.id);
 const proof=(receipt?.proof??{}) as Record<string,unknown>;
 if(step.status==='verified'&&receipt?.status==='verified'&&proof.status==='accepted_by_gmail'&&typeof proof.providerMessageId==='string'){
  return {kind:'sent',to:typeof proof.to==='string'?proof.to:to,providerMessageId:proof.providerMessageId,
   ...(typeof proof.providerThreadId==='string'?{providerThreadId:proof.providerThreadId}:{})};
 }
 if(step.status==='unverified'||receipt?.status==='unverified'||step.status==='verified'||receipt?.status==='verified')return {kind:'unverified',to};
 if(step.status==='cancelled'||plan.status==='cancelled'||receipt?.verification_method==='approval_gateway'||receipt?.verification_method==='user_cancellation')return {kind:'cancelled',to};
 if(['failed','not_configured'].includes(step.status)||receipt?.status==='failed'||receipt?.status==='not_configured'){
  return {kind:'failed',to,...(typeof proof.code==='string'?{reason:proof.code}:{})};
 }
 return {kind:'pending',to};
}

export async function cancelGmailSend(prepared:Pick<GmailPreparedSend,'approvalId'>):Promise<void>{
 await decideApproval(prepared.approvalId,'rejected');
}

/** Plain-language explanation for errors while preparing an email; reconnect means show a Reconnect action. */
export function gmailSendError(error:unknown):{message:string;reconnect:boolean}{
 if(error instanceof ApiRequestError){
  switch(error.code){
   case 'GMAIL_SEND_SCOPE_REQUIRED':return {message:'Gmail sending is not allowed yet. Reconnect Gmail and allow sending.',reconnect:true};
   case 'GMAIL_DISCONNECTED':return {message:'Gmail is not connected. Please connect Gmail first.',reconnect:true};
   case 'GMAIL_RECONNECT_REQUIRED':
   case 'GMAIL_ACCOUNT_UNVERIFIED':return {message:'Please reconnect Gmail and try again.',reconnect:true};
   case 'GMAIL_INVALID_RECIPIENT':return {message:'Enter a valid email address, for example name@example.com.',reconnect:false};
   case 'GMAIL_EMPTY_MESSAGE':return {message:'Please write a message before sending.',reconnect:false};
   case 'GMAIL_NOT_CONFIGURED':return {message:'Gmail sending is not set up in this environment.',reconnect:false};
   default:break;
  }
  if(error.status===401)return {message:'Your session ended. Please sign in again.',reconnect:false};
 }
 return {message:'Email could not be sent. Please try again.',reconnect:false};
}
