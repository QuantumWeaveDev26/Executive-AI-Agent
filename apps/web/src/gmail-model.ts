import { ApiRequestError } from './api';
import { GmailStatus,GmailMessage,GmailSearchResult,GmailOAuthStartResult,GmailPreparedSend,GmailSendOutcome,getGmailStatus,startGmailOAuth,searchGmail,readGmailMessage,disconnectGmail,gmailError,
 prepareGmailNewEmail,prepareGmailReplyEmail,cancelGmailSend,gmailSendOutcomeFromPlan,gmailSendError,canStatusSend } from './gmail-api';
import { decideApproval,getPlanWithSteps } from './api';
import { isValidRecipientEmail,normalizeRecipientEmail } from './integration-ui';
export type MailError=ReturnType<typeof gmailError>;
export interface MailRow {id:string;subject?:string;from?:string;to?:string;date?:string;snippet?:string;isUnread?:boolean;unavailable?:boolean;}
export interface GmailComposeInput {to:string;cc?:string;subject:string;bodyText:string;}
export type GmailComposeMode='new'|'reply'|'reply_all'|'forward';
/** Gmail-like folders. "all" is All Mail (everything except Spam and Trash). */
export type GmailMailbox='inbox'|'all'|'sent';
export type GmailComposeStage='editing'|'preparing'|'review'|'sending'|'done';
export interface GmailSendResult {kind:GmailSendOutcome['kind'];to:string;message:string;providerMessageId?:string;}
export interface GmailState {status:GmailStatus|null;rows:MailRow[];preview:GmailMessage|null;selectedId:string|null;query:string;nextPageToken?:string;
 canPrevPage?:boolean;pageNumber?:number;mailbox?:GmailMailbox;loadingMore?:boolean;
 connectionLoading:boolean;connecting?:boolean;listLoading:boolean;previewLoading:boolean;disconnecting:boolean;searched:boolean;unauthorized:boolean;
 connectionError:MailError|null;listError:MailError|null;previewError:MailError|null;
 composeOpen?:boolean;composeMode?:GmailComposeMode;replySourceMessage?:GmailMessage|null;composeDraft?:GmailComposeInput;composeError?:string|null;composeNeedsReconnect?:boolean;
 composeStage?:GmailComposeStage;pendingSend?:GmailPreparedSend|null;sendResult?:GmailSendResult|null;}
const emptyCompose=():GmailComposeInput=>({to:'',cc:'',subject:'',bodyText:''});
export const initialGmailState=(role:string):GmailState=>({status:null,rows:[],preview:null,selectedId:null,query:'in:inbox',
 canPrevPage:false,pageNumber:1,mailbox:'inbox',loadingMore:false,
 connectionLoading:false,connecting:false,listLoading:false,previewLoading:false,disconnecting:false,searched:false,unauthorized:!['owner','admin','member'].includes(role),connectionError:null,listError:null,previewError:null,
 composeOpen:false,composeMode:'new',replySourceMessage:null,composeDraft:emptyCompose(),composeError:null,composeNeedsReconnect:false,composeStage:'editing',pendingSend:null,sendResult:null});
export const canReadGmail=(state:GmailState)=>!state.unauthorized&&(state.status?.mode==='mock'||state.status?.mode==='live')&&state.status.configured&&state.status.connected&&state.status.status==='connected';
export const canDisconnectGmail=(state:GmailState)=>!state.unauthorized&&(state.status?.mode==='mock'||state.status?.mode==='live')&&state.status.configured&&['connected','reconnect_required'].includes(state.status.status);
export const canConnectGmail=(state:GmailState)=>!state.unauthorized&&state.status?.mode==='live'&&state.status.configured&&!state.status.connected&&['disconnected','reconnect_required'].includes(state.status.status);
/** Sending requires a LIVE connection that granted gmail.send and a verified account address. */
export const canSendGmail=(state:GmailState)=>!state.unauthorized&&canReadGmail(state)&&canStatusSend(state.status);
/** Connected and readable, but sending permission is missing: offer a Reconnect action. */
export const needsSendReconnect=(state:GmailState)=>!state.unauthorized&&canReadGmail(state)&&state.status?.mode==='live'&&!canStatusSend(state.status);

const LOCATION_OPERATOR=/(^|\s)-?(?:in|label):/i;
/**
 * Builds the query sent to Gmail's own search. What the user typed is passed through unchanged
 * (Gmail operators such as from:, to:, subject:, has:, newer_than: keep working); only the selected
 * folder is added when the user did not already choose one with in: or label:.
 */
export function buildGmailProviderQuery(raw:string,mailbox:GmailMailbox='inbox'):string{
 const typed=raw.trim();
 if(!typed||typed==='in:inbox'&&mailbox!=='inbox'){
  return mailbox==='sent'?'in:sent':mailbox==='all'?'in:anywhere -in:spam -in:trash':'in:inbox';
 }
 if(LOCATION_OPERATOR.test(typed))return typed.slice(0,1000);
 const prefix=mailbox==='inbox'?'in:inbox ':mailbox==='sent'?'in:sent ':'';
 return `${prefix}${typed}`.slice(0,1000);
}
/** Returns the address when a search is just one email address (optionally from:/to:/cc:). */
export function searchedEmailAddress(query:string):string|null{
 const match=query.trim().match(/^(?:(?:from|to|cc|bcc):)?\s*<?([^\s<>@]+@[^\s<>@]+\.[^\s<>@]{2,})>?$/i);
 return match?.[1]??null;
}

/** Extracts validated bare email addresses from a header field (never from body text). */
export function extractHeaderEmails(header:string|undefined|null):string[]{
 if(!header||typeof header!=='string')return [];
 const matches=header.match(/[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]{2,}/g)??[];
 const seen=new Set<string>();
 const list:string[]=[];
 for(const raw of matches){
  if(!isValidRecipientEmail(raw))continue;
  const addr=normalizeRecipientEmail(raw);
  const key=addr.toLowerCase();
  if(!seen.has(key)){seen.add(key);list.push(addr);}
 }
 return list;
}

export function deriveReplyDraft(msg:GmailMessage,connectedEmail?:string|null,replyAll=false):GmailComposeInput{
 const selfKey=(connectedEmail??'').trim().toLowerCase();
 const replyToList=extractHeaderEmails(msg.replyTo);
 const fromList=extractHeaderEmails(msg.from);
 const toList=extractHeaderEmails(msg.to);
 const ccList=extractHeaderEmails(msg.cc);
 const primaryPool=replyToList.length>0?replyToList:fromList;
 const rawSubj=(msg.subject??'').replace(/[\r\n]+/g,' ').trim();
 const subject=rawSubj?(/^re:/i.test(rawSubj)?rawSubj:`Re: ${rawSubj}`):'Re: (no subject)';
 if(!replyAll){
  const to=primaryPool.find(a=>a.toLowerCase()!==selfKey)??toList.find(a=>a.toLowerCase()!==selfKey)??primaryPool[0]??toList[0]??'';
  return {to,cc:'',subject,bodyText:''};
 }
 const unique:string[]=[];
 const seen=new Set<string>();
 for(const addr of [...primaryPool,...fromList,...toList,...ccList]){
  const key=addr.toLowerCase();
  if((selfKey&&key===selfKey)||seen.has(key))continue;
  seen.add(key);unique.push(addr);
 }
 const [primary,...rest]=unique.length>0?unique:[primaryPool[0]??toList[0]??''];
 return {to:primary??'',cc:rest.join(', '),subject,bodyText:''};
}

export function deriveForwardDraft(msg:GmailMessage):GmailComposeInput{
 const rawSubj=(msg.subject??'').replace(/[\r\n]+/g,' ').trim();
 const subject=rawSubj?(/^fwd?:/i.test(rawSubj)?rawSubj:`Fwd: ${rawSubj}`):'Fwd: (no subject)';
 const quoted=[
  '',
  '---------- Forwarded message ---------',
  ...(msg.from?[`From: ${msg.from}`]:[]),
  ...(msg.date?[`Date: ${msg.date}`]:[]),
  ...(msg.subject?[`Subject: ${msg.subject}`]:[]),
  ...(msg.to?[`To: ${msg.to}`]:[]),
  '',
  msg.bodyText||msg.snippet||''
 ].join('\n');
 return {to:'',cc:'',subject,bodyText:quoted};
}

interface MailApi {
 status(signal?:AbortSignal):Promise<GmailStatus>;
 startOAuth?(signal?:AbortSignal):Promise<GmailOAuthStartResult>;
 search(query:string,pageToken?:string,signal?:AbortSignal):Promise<GmailSearchResult>;
 read(id:string,signal?:AbortSignal):Promise<GmailMessage>;
 disconnect(signal?:AbortSignal):Promise<GmailStatus>;
 prepareSend?(input:{to:string;subject?:string;bodyText:string},signal?:AbortSignal):Promise<GmailPreparedSend>;
 prepareReply?(input:{sourceMessageId:string;to?:string;cc?:string;subject?:string;bodyText:string;replyAll?:boolean},signal?:AbortSignal):Promise<GmailPreparedSend>;
 approveSend?(prepared:GmailPreparedSend):Promise<void>;
 sendOutcome?(prepared:GmailPreparedSend,signal?:AbortSignal):Promise<GmailSendOutcome>;
 cancelSend?(prepared:GmailPreparedSend):Promise<void>;
}
const defaultApi:MailApi={
 status:(signal)=>getGmailStatus(signal,{allowLiveMode:true}),
 startOAuth:(signal)=>startGmailOAuth(signal,{allowLiveMode:true}),
 search:(query,pageToken,signal)=>searchGmail(query,pageToken,signal,{allowLiveMode:true}),
 read:(id,signal)=>readGmailMessage(id,signal,{allowLiveMode:true}),
 disconnect:(signal)=>disconnectGmail(signal,{allowLiveMode:true}),
 prepareSend:(input,signal)=>prepareGmailNewEmail(input,signal),
 prepareReply:(input,signal)=>prepareGmailReplyEmail(input,signal),
 approveSend:async(prepared)=>{await decideApproval(prepared.approvalId,'approved');},
 sendOutcome:async(prepared,signal)=>gmailSendOutcomeFromPlan(await getPlanWithSteps(prepared.planId,signal),prepared.to),
 cancelSend:(prepared)=>cancelGmailSend(prepared)
};
export function sendResultMessage(outcome:GmailSendOutcome):string{
 switch(outcome.kind){
  case 'sent':return `Email sent to ${outcome.to}.`;
  case 'unverified':return "We couldn't confirm whether Gmail sent this email. Please check your Gmail Sent folder before trying again. Thaara will not retry automatically.";
  case 'cancelled':return 'No email was sent.';
  case 'pending':return 'Your email was approved and is still being sent. Refresh Gmail in a moment and check your Sent folder.';
  default:{
   const hint=outcome.reason==='GMAIL_SEND_SCOPE_REQUIRED'?' Reconnect Gmail and allow sending.':outcome.reason==='GMAIL_ACCOUNT_MISMATCH'?' Your connected Gmail account changed.':'';
   return `Email could not be sent. Please try again.${hint}`;
  }
 }
}
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export function createGmailModel(role:string,publish:(state:GmailState)=>void,api:MailApi=defaultApi,options:{outcomePollMs?:number}={}){
 let state=initialGmailState(role),disposed=false,epoch=0,listVersion=0,previewVersion=0,abort=new AbortController();
 let pageHistory:Array<string|undefined>=[];
 let currentPageToken:string|undefined=undefined;
 const pollMs=options.outcomePollMs??400;
 const allowed=['owner','admin','member'].includes(role);
 const emit=(next:Partial<GmailState>)=>{if(!disposed){state={...state,...next};publish(state);}};
 const reset=()=>{epoch++;listVersion++;previewVersion++;pageHistory=[];currentPageToken=undefined;abort.abort();abort=new AbortController();};
 const clear:Partial<GmailState>={rows:[],preview:null,selectedId:null,nextPageToken:undefined,canPrevPage:false,pageNumber:1,loadingMore:false,listLoading:false,previewLoading:false,searched:false,listError:null,previewError:null};
 const clearCompose:Partial<GmailState>={composeOpen:false,composeMode:'new',replySourceMessage:null,composeDraft:emptyCompose(),composeError:null,composeNeedsReconnect:false,composeStage:'editing',pendingSend:null,sendResult:null};
 const failClosed=(error:unknown)=>{
  const kind=gmailError(error);
  if(kind==='unauthorized'||kind==='reconnect'){reset();emit({...clear,...clearCompose,status:null,connectionLoading:false,connecting:false,disconnecting:false,unauthorized:kind==='unauthorized',connectionError:kind});return true;}
  return false;
 };
 async function runSearch(query:string,pageToken?:string,preservePageHistory=false,append=false){
  if(!allowed||!canReadGmail(state)||state.connectionLoading||state.disconnecting||disposed)return;
  query=query.trim()||'in:inbox';
  if(!preservePageHistory){pageHistory=[];currentPageToken=pageToken;}
  const current=epoch,version=++listVersion;
  if(!append)previewVersion++;
  const canPrevPage=pageHistory.length>0;
  const pageNumber=pageHistory.length+1;
  if(append){
   emit({loadingMore:true,listError:null});
  }else{
   emit({...clear,canPrevPage,pageNumber,listLoading:true,query,searched:true});
  }
  try{
   const found=await api.search(buildGmailProviderQuery(query,state.mailbox??'inbox'),pageToken,abort.signal);
   if(disposed||current!==epoch||version!==listVersion)return;
   const reads=await Promise.allSettled(found.messages.map(m=>api.read(m.id,abort.signal)));
   if(disposed||current!==epoch||version!==listVersion)return;
   const denial=reads.find(r=>r.status==='rejected'&&['unauthorized','reconnect'].includes(gmailError(r.reason)));
   if(denial?.status==='rejected'){failClosed(denial.reason);return;}
   // Gmail's own search is authoritative: every provider match is shown (newest first, as Gmail returns them).
   const fetchedRows=reads.map((result,i):MailRow=>result.status==='fulfilled'?{id:result.value.id,subject:result.value.subject,from:result.value.from,...(result.value.to!==undefined?{to:result.value.to}:{}),date:result.value.date,snippet:result.value.snippet,isUnread:result.value.isUnread}:{id:found.messages[i]!.id,unavailable:true});
   if(append){
    const seen=new Set(state.rows.map(r=>r.id));
    const merged=[...state.rows,...fetchedRows.filter(r=>!seen.has(r.id))];
    emit({rows:merged,nextPageToken:found.nextPageToken,canPrevPage,pageNumber,loadingMore:false,listLoading:false});
   }else{
    emit({rows:fetchedRows,nextPageToken:found.nextPageToken,canPrevPage,pageNumber,loadingMore:false,listLoading:false});
   }
  }catch(error){if(!disposed&&current===epoch&&version===listVersion&&!failClosed(error))emit({loadingMore:false,listLoading:false,listError:gmailError(error)});}
 }
 async function search(query:string,pageToken?:string){
  const typed=query.trim();
  // Like Gmail, a typed search looks through All Mail unless the user picked a folder.
  if(typed==='in:inbox')emit({mailbox:'inbox'});
  else if(typed&&state.mailbox==='inbox'&&!LOCATION_OPERATOR.test(typed))emit({mailbox:'all'});
  await runSearch(query,pageToken,false,false);
 }
 async function backToInbox(){
  if(disposed||!allowed)return;
  emit({mailbox:'inbox'});
  await runSearch('in:inbox',undefined,false,false);
 }
 async function setMailbox(mailbox:GmailMailbox){
  if(disposed||!allowed)return;
  emit({mailbox});
  const typed=state.query.trim();
  await runSearch(typed==='in:inbox'?'':typed,undefined,false,false);
 }
 /** Infinite scroll / next page: appends deduplicated messages while keeping selection & preview stable. */
 async function loadMore(){
  if(!state.nextPageToken||state.listLoading||state.loadingMore)return;
  const targetToken=state.nextPageToken;
  pageHistory=[...pageHistory,currentPageToken];
  currentPageToken=targetToken;
  await runSearch(state.query,targetToken,true,true);
 }
 async function next(){
  await loadMore();
 }
 async function prev(){
  if(pageHistory.length===0||state.listLoading||state.loadingMore)return;
  const nextHistory=[...pageHistory];
  const targetToken=nextHistory.pop();
  pageHistory=nextHistory;
  currentPageToken=targetToken;
  await runSearch(state.query,targetToken,true,false);
 }
 async function loadStatus(queryOverride?:string){
  if(disposed||!allowed||state.disconnecting)return;
  const activeQuery=(queryOverride!==undefined?queryOverride:state.query).trim()||'in:inbox';
  reset();const current=epoch;
  emit({...clear,query:activeQuery,status:null,connectionLoading:true,connecting:false,connectionError:null,unauthorized:false});
  try{const status=await api.status(abort.signal);if(disposed||current!==epoch)return;
   emit({status,connectionLoading:false});if(canReadGmail(state))await runSearch(activeQuery);
   else emit(clearCompose);
  }catch(error){if(!disposed&&current===epoch&&!failClosed(error))emit({connectionLoading:false,connectionError:gmailError(error)});}
 }
 async function select(id:string){
  if(disposed||!canReadGmail(state)||state.listLoading||!state.rows.some(m=>m.id===id))return;
  const current=epoch,list=listVersion,version=++previewVersion;emit({preview:null,selectedId:id,previewLoading:true,previewError:null});
  try{const preview=await api.read(id,abort.signal);if(!disposed&&current===epoch&&list===listVersion&&version===previewVersion)emit({preview,previewLoading:false});}
  catch(error){if(!disposed&&current===epoch&&list===listVersion&&version===previewVersion&&!failClosed(error))emit({previewLoading:false,previewError:gmailError(error)});}
 }
 async function connect():Promise<string|null>{
  if(disposed||!allowed||!canConnectGmail(state)||state.connecting||state.disconnecting||!api.startOAuth)return null;
  const current=epoch;emit({connecting:true,connectionError:null});
  try{
   const started=await api.startOAuth(abort.signal);
   if(disposed||current!==epoch)return null;
   emit({connecting:false});
   return started.authorizationUrl;
  }catch(error){
   if(!disposed&&current===epoch&&!failClosed(error))emit({connecting:false,connectionError:gmailError(error)});
   return null;
  }
 }
 async function disconnect(){
  if(disposed||!allowed||!canDisconnectGmail(state)||state.disconnecting)return;reset();const current=epoch;
  emit({...clear,...clearCompose,status:null,connectionLoading:false,connecting:false,disconnecting:true,connectionError:null});
  try{const status=await api.disconnect(abort.signal);if(!disposed&&current===epoch)emit({status,disconnecting:false});}
  catch(error){if(!disposed&&current===epoch&&!failClosed(error))emit({disconnecting:false,connectionError:gmailError(error)});}
 }
 /** Disconnect, then start Google consent again so the user can allow sending. Returns the Google URL. */
 async function reconnect():Promise<string|null>{
  if(disposed||!allowed)return null;
  if(canDisconnectGmail(state))await disconnect();
  return connect();
 }
 function openCompose(initial?:Partial<GmailComposeInput>,mode:GmailComposeMode='new',sourceMessage:GmailMessage|null=null){
  if(disposed||!allowed||!canReadGmail(state))return;
  if(state.composeStage==='preparing'||state.composeStage==='sending')return;
  const currentDraft=state.composeStage==='done'||mode!==state.composeMode?emptyCompose():(state.composeDraft??emptyCompose());
  emit({
   composeOpen:true,
   composeMode:mode,
   replySourceMessage:sourceMessage,
   composeError:null,
   composeNeedsReconnect:false,
   composeStage:state.composeStage==='review'&&mode===state.composeMode?'review':'editing',
   sendResult:null,
   composeDraft:{
    to:initial?.to!==undefined?initial.to:currentDraft.to,
    cc:initial?.cc!==undefined?initial.cc:(currentDraft.cc??''),
    subject:initial?.subject!==undefined?initial.subject:currentDraft.subject,
    bodyText:initial?.bodyText!==undefined?initial.bodyText:currentDraft.bodyText
   }
  });
 }
 function startReply(targetMessage?:GmailMessage|null){
  const msg=targetMessage??state.preview;
  if(!msg)return;
  const draft=deriveReplyDraft(msg,state.status?.connectedEmail,false);
  openCompose(draft,'reply',msg);
 }
 function startReplyAll(targetMessage?:GmailMessage|null){
  const msg=targetMessage??state.preview;
  if(!msg)return;
  const draft=deriveReplyDraft(msg,state.status?.connectedEmail,true);
  openCompose(draft,'reply_all',msg);
 }
 function startForward(targetMessage?:GmailMessage|null){
  const msg=targetMessage??state.preview;
  if(!msg)return;
  const draft=deriveForwardDraft(msg);
  openCompose(draft,'forward',msg);
 }
 function closeCompose(){
  if(disposed)return;
  if(state.composeStage==='review'){void cancelSend();return;}
  emit({composeOpen:false,composeError:null});
 }
 function updateCompose(patch:Partial<GmailComposeInput>){
  if(disposed||!allowed)return;
  if(state.composeStage&&state.composeStage!=='editing'&&state.composeStage!=='done')return;
  const currentDraft=state.composeStage==='done'?emptyCompose():(state.composeDraft??emptyCompose());
  emit({composeOpen:true,composeError:null,composeNeedsReconnect:false,composeStage:'editing',sendResult:null,composeDraft:{...currentDraft,...patch}});
 }
 /** Send Email / Reply: validates, then asks the server to prepare the email for the user's own Approve & Send. */
 async function prepareSend():Promise<GmailPreparedSend|null>{
  if(disposed||!allowed||!canReadGmail(state)||state.composeStage==='preparing'||state.composeStage==='sending')return null;
  const draft=state.composeDraft??emptyCompose();
  if(!isValidRecipientEmail(draft.to)){
   emit({composeError:'Enter a valid email address, for example name@example.com.'});
   return null;
  }
  const bodyText=draft.bodyText.trim();
  if(!bodyText){emit({composeError:'Please write a message before sending.'});return null;}
  const mode=state.composeMode??'new';
  const isReplyMode=(mode==='reply'||mode==='reply_all')&&Boolean(state.replySourceMessage);
  if(!canSendGmail(state)||(isReplyMode?!api.prepareReply&&!api.prepareSend:!api.prepareSend)){
   emit({composeError:'Gmail sending is not allowed yet. Reconnect Gmail and allow sending.',composeNeedsReconnect:true});
   return null;
  }
  const current=epoch;
  emit({composeStage:'preparing',composeError:null,composeNeedsReconnect:false});
  try{
   const normalizedTo=normalizeRecipientEmail(draft.to);
   const normalizedCc=(draft.cc??'').trim();
   const prepared=isReplyMode&&api.prepareReply&&state.replySourceMessage
    ?await api.prepareReply({
      sourceMessageId:state.replySourceMessage.id,
      to:normalizedTo,
      ...(normalizedCc?{cc:normalizedCc}:{}),
      subject:draft.subject.trim(),
      bodyText:bodyText.slice(0,50000),
      replyAll:mode==='reply_all'
     },abort.signal)
    :await api.prepareSend!({to:normalizedTo,subject:draft.subject.trim(),bodyText:bodyText.slice(0,50000)},abort.signal);
   if(disposed||current!==epoch)return null;
   emit({composeStage:'review',pendingSend:prepared});
   return prepared;
  }catch(error){
   if(disposed||current!==epoch)return null;
   const explained=gmailSendError(error);
   emit({composeStage:'editing',composeError:explained.message,composeNeedsReconnect:explained.reconnect});
   return null;
  }
 }
 /** Approve & Send (Confirm & Send): the user's explicit approval. Thaara never retries an uncertain send. */
 async function confirmSend():Promise<GmailSendResult|null>{
  const prepared=state.pendingSend;
  if(disposed||!allowed||state.composeStage!=='review'||!prepared||!api.approveSend||!api.sendOutcome)return null;
  const current=epoch;
  emit({composeStage:'sending',composeError:null});
  let outcome:GmailSendOutcome;
  try{
   await api.approveSend(prepared);
  }catch(error){
   if(disposed||current!==epoch)return null;
   // A clear rejection (403/404/409) means nothing ran. A network/server error could hide a send, so it is unverified.
   const definite=error instanceof ApiRequestError&&error.status>=400&&error.status<500;
   outcome={kind:definite?'failed':'unverified',to:prepared.to};
   const result={kind:outcome.kind,to:prepared.to,message:sendResultMessage(outcome)};
   emit({composeStage:'done',sendResult:result,pendingSend:null});
   return result;
  }
  outcome={kind:'pending',to:prepared.to};
  for(let attempt=0;attempt<5;attempt++){
   try{outcome=await api.sendOutcome(prepared,abort.signal);}
   catch{outcome={kind:'unverified',to:prepared.to};break;}
   if(disposed||current!==epoch)return null;
   if(outcome.kind!=='pending')break;
   await wait(pollMs);
  }
  if(disposed||current!==epoch)return null;
  const result:GmailSendResult={kind:outcome.kind,to:outcome.to||prepared.to,message:sendResultMessage(outcome),
   ...(outcome.providerMessageId?{providerMessageId:outcome.providerMessageId}:{})};
  emit({composeStage:'done',sendResult:result,pendingSend:null,...(outcome.kind==='sent'?{composeDraft:emptyCompose(),composeMode:'new',replySourceMessage:null}:{})});
  return result;
 }
 /** Cancel in review: rejects the waiting approval so this exact email can never be sent. */
 async function cancelSend(){
  const prepared=state.pendingSend;
  if(disposed||state.composeStage!=='review'||!prepared)return;
  const current=epoch;
  emit({composeStage:'sending'});
  try{await api.cancelSend?.(prepared);}catch{/* an un-decided approval simply expires; it can never be sent without Confirm */}
  if(disposed||current!==epoch)return;
  emit({composeStage:'done',pendingSend:null,sendResult:{kind:'cancelled',to:prepared.to,message:'No email was sent.'}});
 }
 /** Edit: withdraw the prepared email and return to the editor with the same text. */
 async function editAgain(){
  const prepared=state.pendingSend;
  if(disposed||state.composeStage!=='review'||!prepared)return;
  const current=epoch;
  try{await api.cancelSend?.(prepared);}catch{/* see cancelSend */}
  if(disposed||current!==epoch)return;
  emit({composeStage:'editing',pendingSend:null,composeOpen:true});
 }
 function discardDraft(){
  if(disposed)return;
  if(state.composeStage==='review'&&state.pendingSend){const prepared=state.pendingSend;void api.cancelSend?.(prepared).catch(()=>undefined);}
  emit(clearCompose);
 }
 return {loadStatus,search,backToInbox,setMailbox,select,connect,disconnect,reconnect,loadMore,next,prev,openCompose,startReply,startReplyAll,startForward,closeCompose,updateCompose,prepareSend,confirmSend,cancelSend,editAgain,discardDraft,getState:()=>state,
  dispose:()=>{disposed=true;reset();}};
}
