
import { randomBytes,createHash,timingSafeEqual } from 'node:crypto';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import {
 GmailStatus,GmailSearch,GmailCallback,GmailMessage,GmailSearchResponse,
 GmailMessageSchema,GmailSearchResponseSchema,
 GmailSendReplyInput,GmailSendReplyInputSchema,GmailSendReplyReceipt,GmailSendReplyReceiptSchema,
 GmailSendNewInput,GmailSendNewInputSchema,GmailSendNewReceipt,GmailSendNewReceiptSchema,
 ApprovalRequest,computeCanonicalParameterHash
} from '@thaara/contracts';
import { AuthenticatedScope } from '@thaara/db';
import { PolicyGateway,ActionAdapter,ActionExecutionContext,ActionResult } from '@thaara/policy';
import { AppError,ForbiddenError } from '@thaara/observability';
import { GmailVault } from './gmail-vault.js';

export const GMAIL_READONLY='https://www.googleapis.com/auth/gmail.readonly';
export const GMAIL_SEND='https://www.googleapis.com/auth/gmail.send';
export const GMAIL_LIVE_SCOPES=`${GMAIL_READONLY} ${GMAIL_SEND}`;
export const GMAIL_SEND_REPLY_ACTION='gmail.messages.send_reply';
export const GMAIL_SEND_NEW_ACTION='gmail.messages.send_new';
export const GMAIL_SEND_ACTIONS=[GMAIL_SEND_REPLY_ACTION,GMAIL_SEND_NEW_ACTION] as const;
export function isGmailSendAction(name:unknown):name is (typeof GMAIL_SEND_ACTIONS)[number] {
 return name===GMAIL_SEND_REPLY_ACTION||name===GMAIL_SEND_NEW_ACTION;
}
export type GmailSendReadinessReason='ready'|'not_configured'|'disconnected'|'reconnect_required'|'send_permission_missing'|'account_unverified';
export interface GmailSendReadiness {ready:boolean;reason:GmailSendReadinessReason;connectedEmail:string|null;status:GmailStatus;}
export interface GmailTokens {accessToken:string;refreshToken?:string;scope:string;expiresIn:number;}
export interface GmailProvider {
 readonly mode:'mock'|'live';
 exchange(input:{code:string;codeVerifier:string;clientId:string;redirectUri:string}):Promise<GmailTokens>;
 refresh?(input:{refreshToken:string;clientId:string}):Promise<GmailTokens>;
 revoke?(input:{token:string}):Promise<void>;
 getProfile?(input:{accessToken:string}):Promise<{emailAddress?:string}>;
 search(input:{accessToken:string;query:string;limit:number;pageToken?:string}):Promise<unknown>;
 read(input:{accessToken:string;messageId:string}):Promise<unknown>;
 sendReply?(input:{
  accessToken:string;
  connectedEmail:string;
  to:string;
  cc?:string;
  subject:string;
  threadId:string;
  inReplyTo?:string;
  references?:string;
  bodyText:string;
 }):Promise<{id?:string;threadId?:string}>;
 sendNew?(input:{
  accessToken:string;
  connectedEmail:string;
  to:string;
  subject?:string;
  bodyText:string;
 }):Promise<{id?:string;threadId?:string}>;
}
export interface GmailOptions {
 provider?:GmailProvider;vault?:GmailVault;clientId?:string;redirectUri?:string;
 allowLocalhostRedirect?:boolean;
 allowSendScope?:boolean;
 now?:()=>number;
}
type Audit=(scope:AuthenticatedScope,action:string,payload:Record<string,unknown>)=>Promise<void>;
interface Pending {stateHash:string;sessionHash:string;verifier:string;expiresAt:number;epoch:string;}
interface Connection {tokens:GmailTokens;expiresAt:number;verifiedAt:string;epoch:string;connectedEmail?:string|null;}
const messageCheck=TypeCompiler.Compile(GmailMessageSchema);
const searchCheck=TypeCompiler.Compile(GmailSearchResponseSchema);
const sendReplyInputCheck=TypeCompiler.Compile(GmailSendReplyInputSchema);
const sendReplyReceiptCheck=TypeCompiler.Compile(GmailSendReplyReceiptSchema);
const sendNewInputCheck=TypeCompiler.Compile(GmailSendNewInputSchema);
const sendNewReceiptCheck=TypeCompiler.Compile(GmailSendNewReceiptSchema);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const equal=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const error=(code:string,message:string,status=409)=>new AppError(message,code,status);
function normalizeConnectedEmail(raw:unknown):string|null {
 if(typeof raw!=='string')return null;
 const trimmed=raw.trim();
 if(trimmed.length<3||trimmed.length>320||!/^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/.test(trimmed))return null;
 return trimmed;
}
function parseGrantedScopes(rawScope:string|undefined,allowSend:boolean):string[]|null {
 if(typeof rawScope!=='string'||!rawScope.trim())return null;
 const tokens=rawScope.trim().split(/\s+/).filter(Boolean);
 if(tokens.length===0)return null;
 const allowed=allowSend?new Set([GMAIL_READONLY,GMAIL_SEND]):new Set([GMAIL_READONLY]);
 const seen=new Set<string>();
 for(const t of tokens) {
  if(!allowed.has(t)||seen.has(t))return null;
  seen.add(t);
 }
 if(!seen.has(GMAIL_READONLY))return null;
 const ordered:string[]=[GMAIL_READONLY];
 if(seen.has(GMAIL_SEND))ordered.push(GMAIL_SEND);
 return ordered;
}
export class GmailFoundation {
 private readonly now:()=>number;
 private readonly ready:boolean;
 constructor(private options:GmailOptions&{policyGateway:PolicyGateway;audit:Audit}) {
  this.now=options.now??Date.now;
  this.ready=Boolean(options.provider&&options.vault&&options.clientId&&options.redirectUri);
  if(this.ready) {
   const uri=new URL(options.redirectUri!);
   const isAllowedLocal=Boolean(options.allowLocalhostRedirect&&uri.protocol==='http:'&&(uri.hostname==='localhost'||uri.hostname==='127.0.0.1'));
   if((uri.protocol!=='https:'&&!isAllowedLocal)||uri.username||uri.password||uri.search||uri.hash||(options.provider!.mode!=='mock'&&options.provider!.mode!=='live'))
    throw new Error('Gmail foundation requires a fixed HTTPS callback and valid provider.');
  }
 }
 private get activeMode():'mock'|'live' {
  return this.options.provider?.mode==='live'?'live':'mock';
 }
 private get supportsSendScope():boolean {
  return this.activeMode==='live'||Boolean(this.options.allowSendScope)||
   typeof this.options.provider?.sendReply==='function'||typeof this.options.provider?.sendNew==='function';
 }
 private authorize(
  scope:AuthenticatedScope,
  actionName:string,
  parameters:Record<string,unknown>={},
  approvedRequest?:ApprovalRequest,
  idempotencyKey?:string
 ) {
  if(!scope.sessionTokenHash||!scope.workspaceId||!scope.userId)throw new ForbiddenError();
  const result=this.options.policyGateway.evaluate(
   scope,
   {actionName,parameters,...(idempotencyKey?{idempotencyKey}:{})},
   approvedRequest,
   scope.userId
  );
  if(!result.allowed)throw new ForbiddenError('Gmail action denied by policy.');
 }
 private configured() {
  if(!this.ready)throw error('GMAIL_NOT_CONFIGURED','Gmail integration is not configured.',503);
 }
 private epoch(scope:AuthenticatedScope):string {
  let value=this.options.vault!.get<string>(scope,'epoch');
  if(!value){value=randomBytes(32).toString('base64url');this.options.vault!.set(scope,'epoch',value);}
  return value;
 }
 private unchanged(scope:AuthenticatedScope,epoch:string) {
  if(this.epoch(scope)!==epoch)throw error('GMAIL_CONNECTION_CHANGED','Gmail connection changed during the request.');
 }
 private async resolveProfileEmail(accessToken:string):Promise<string|null> {
  const provider=this.options.provider;
  if(!provider||typeof provider.getProfile!=='function')return null;
  try {
   const profile=await provider.getProfile({accessToken});
   return normalizeConnectedEmail(profile?.emailAddress);
  } catch {
   return null;
  }
 }
 private async tryRefresh(scope:AuthenticatedScope,connection:Connection):Promise<Connection|undefined> {
  const provider=this.options.provider;
  if(!provider||provider.mode!=='live'||typeof provider.refresh!=='function'||!connection.tokens.refreshToken)return undefined;
  try {
   const refreshed=await provider.refresh({refreshToken:connection.tokens.refreshToken,clientId:this.options.clientId!});
   if(!refreshed||typeof refreshed.accessToken!=='string'||!refreshed.accessToken||refreshed.accessToken.length>16384||
    !Number.isFinite(refreshed.expiresIn)||refreshed.expiresIn<=0||refreshed.expiresIn>86400)return undefined;
   this.unchanged(scope,connection.epoch);
   const connectedEmail=normalizeConnectedEmail(connection.connectedEmail)??(await this.resolveProfileEmail(refreshed.accessToken));
   this.unchanged(scope,connection.epoch);
   const grantedScopes=parseGrantedScopes(refreshed.scope||connection.tokens.scope,true)??parseGrantedScopes(connection.tokens.scope,true)??[GMAIL_READONLY];
   const updated:Connection={
    tokens:{
     accessToken:refreshed.accessToken,
     refreshToken:refreshed.refreshToken??connection.tokens.refreshToken,
     scope:grantedScopes.join(' '),
     expiresIn:refreshed.expiresIn
    },
    expiresAt:this.now()+refreshed.expiresIn*1000,
    verifiedAt:new Date(this.now()).toISOString(),
    epoch:connection.epoch,
    ...(connectedEmail?{connectedEmail}:{})
   };
   this.options.vault!.set(scope,'connection',updated);
   await this.options.audit(scope,'gmail.oauth.refreshed',{mode:this.activeMode});
   return updated;
  } catch {
   return undefined;
  }
 }
 async status(scope:AuthenticatedScope):Promise<GmailStatus> {
  this.authorize(scope,'gmail.connection.status');
  let connection=this.ready?this.options.vault!.get<Connection>(scope,'connection'):undefined;
  if(connection&&connection.expiresAt<=this.now()) {
   const refreshed=await this.tryRefresh(scope,connection);
   if(refreshed)connection=refreshed;
  }
  const connected=Boolean(connection&&connection.expiresAt>this.now());
  if(connected&&connection&&!normalizeConnectedEmail(connection.connectedEmail)&&typeof this.options.provider?.getProfile==='function') {
   const resolved=await this.resolveProfileEmail(connection.tokens.accessToken);
   if(resolved&&this.epoch(scope)===connection.epoch) {
    connection={...connection,connectedEmail:resolved};
    this.options.vault!.set(scope,'connection',connection);
   }
  }
  const connectedEmail=connected?normalizeConnectedEmail(connection?.connectedEmail):null;
  const grantedScopes=connection?(parseGrantedScopes(connection.tokens.scope,true)??[GMAIL_READONLY]):[];
  return {connectorName:'gmail',status:!this.ready?'not_configured':!connection?'disconnected':connected?'connected':'reconnect_required',
   configured:this.ready,connected,mode:this.ready?this.activeMode:'disabled',
   scopes:grantedScopes,lastVerifiedAt:connection?.verifiedAt??null,
   ...(connectedEmail?{connectedEmail}:{})};
 }
 async start(scope:AuthenticatedScope) {
  this.authorize(scope,'gmail.connection.start');this.configured();
  const epoch=this.epoch(scope);
  const mode=this.activeMode;
  await this.options.audit(scope,'gmail.oauth.requested',{mode});
  this.unchanged(scope,epoch);
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
  const expiresAt=this.now()+300000;
  this.options.vault!.set(scope,'pending',{stateHash:hash(state),sessionHash:scope.sessionTokenHash,verifier,expiresAt,epoch});
  const requestedScope=this.supportsSendScope?GMAIL_LIVE_SCOPES:GMAIL_READONLY;
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:this.options.clientId!,redirect_uri:this.options.redirectUri!,
   response_type:'code',scope:requestedScope,access_type:'offline',prompt:'consent',include_granted_scopes:'false',
   state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
  return {authorizationUrl:url.href,expiresAt:new Date(expiresAt).toISOString(),mode};
 }
 async complete(scope:AuthenticatedScope,input:GmailCallback):Promise<GmailStatus> {
  this.authorize(scope,'gmail.connection.complete',input);this.configured();
  const mode=this.activeMode;
  const pending=this.options.vault!.get<Pending>(scope,'pending');
  if(!pending||pending.expiresAt<=this.now()||!equal(pending.stateHash,hash(input.state))||
   !equal(pending.sessionHash,scope.sessionTokenHash))
   throw error('GMAIL_OAUTH_INVALID','Gmail OAuth state is invalid or expired.',400);
  // No await between validation and atomic consumption: the code can be exchanged only once.
  this.options.vault!.take(scope,'pending');this.unchanged(scope,pending.epoch);
  if(input.error) {
   await this.options.audit(scope,'gmail.oauth.denied',{mode});
   throw error('GMAIL_OAUTH_DENIED','Gmail consent was not granted.',400);
  }
  if(!input.code)throw error('GMAIL_OAUTH_INVALID','Gmail authorization code is required.',400);
  await this.options.audit(scope,'gmail.oauth.exchange_requested',{mode});
  this.unchanged(scope,pending.epoch);
  const tokens=await this.providerCall(()=>this.options.provider!.exchange({
   code:input.code!,codeVerifier:pending.verifier,clientId:this.options.clientId!,redirectUri:this.options.redirectUri!}));
  const grantedScopes=tokens?parseGrantedScopes(tokens.scope,this.supportsSendScope):null;
  if(!tokens||typeof tokens.accessToken!=='string'||!tokens.accessToken||tokens.accessToken.length>16384||
   (tokens.refreshToken!==undefined&&(typeof tokens.refreshToken!=='string'||!tokens.refreshToken||tokens.refreshToken.length>16384))||
   !grantedScopes||!Number.isFinite(tokens.expiresIn)||tokens.expiresIn<=0||tokens.expiresIn>86400)
   throw error('GMAIL_PROVIDER_INVALID','Gmail provider returned an invalid authorization result.',502);
  await this.options.audit(scope,'gmail.oauth.authorized',{mode,scopes:grantedScopes});
  this.unchanged(scope,pending.epoch);
  const connectedEmail=typeof this.options.provider?.getProfile==='function'?await this.resolveProfileEmail(tokens.accessToken):null;
  this.unchanged(scope,pending.epoch);
  const epoch=randomBytes(32).toString('base64url');
  this.options.vault!.set(scope,'epoch',epoch);
  // Only approved token fields are ever persisted, and only as authenticated ciphertext.
  this.options.vault!.set(scope,'connection',{tokens:{accessToken:tokens.accessToken,refreshToken:tokens.refreshToken,
   scope:grantedScopes.join(' '),expiresIn:tokens.expiresIn},expiresAt:this.now()+tokens.expiresIn*1000,
   verifiedAt:new Date(this.now()).toISOString(),epoch,...(connectedEmail?{connectedEmail}:{})});
  return this.status(scope);
 }
 async disconnect(scope:AuthenticatedScope):Promise<GmailStatus> {
  this.authorize(scope,'gmail.connection.disconnect');
  if(!this.ready)return this.status(scope);
  const mode=this.activeMode;
  const previous=this.options.vault!.get<Connection>(scope,'connection');
  // Local forgetting is immediate and fail-closed even when audit persistence is unavailable.
  this.options.vault!.set(scope,'epoch',randomBytes(32).toString('base64url'));
  this.options.vault!.delete(scope,'connection');this.options.vault!.delete(scope,'pending');
  if(mode==='live'&&previous&&typeof this.options.provider?.revoke==='function') {
   try {await this.options.provider.revoke({token:previous.tokens.refreshToken??previous.tokens.accessToken});} catch { /* best-effort provider revoke */ }
  }
  await this.options.audit(scope,'gmail.connection.disconnected',{mode,localOnly:mode==='mock'});
  return this.status(scope);
 }
 private async connection(scope:AuthenticatedScope):Promise<Connection> {
  this.configured();let connection=this.options.vault!.get<Connection>(scope,'connection');
  if(!connection)throw error('GMAIL_DISCONNECTED','Gmail is disconnected.');
  if(connection.expiresAt<=this.now()) {
   const refreshed=await this.tryRefresh(scope,connection);
   if(!refreshed)throw error('GMAIL_RECONNECT_REQUIRED','Gmail connection requires authorization.');
   connection=refreshed;
  }
  this.unchanged(scope,connection.epoch);return connection;
 }
 private async providerCall<T>(operation:()=>Promise<T>):Promise<T> {
  try{return await operation();}
  catch {throw error('GMAIL_PROVIDER_ERROR','Gmail provider request failed.',502);}
 }
 async search(scope:AuthenticatedScope,input:GmailSearch):Promise<GmailSearchResponse> {
  this.authorize(scope,'gmail.messages.search',input);const connection=await this.connection(scope);
  const mode=this.activeMode;
  await this.options.audit(scope,'gmail.messages.search_requested',{mode});
  this.unchanged(scope,connection.epoch);
  const raw=await this.providerCall(()=>this.options.provider!.search({accessToken:connection.tokens.accessToken,
   query:input.query,limit:input.limit??20,pageToken:input.pageToken}));
  const source=raw as Record<string,unknown>|null;
  const result={messages:Array.isArray(source?.messages)?source.messages.map((m:Record<string,unknown>)=>({id:m?.id,threadId:m?.threadId})):undefined,
   nextPageToken:source?.nextPageToken,untrusted:true as const,mode};
  if(!searchCheck.Check(result)||result.messages.length>(input.limit??20))
   throw error('GMAIL_PROVIDER_INVALID','Gmail provider returned an invalid search result.',502);
  await this.options.audit(scope,'gmail.messages.search_completed',{mode,count:result.messages.length});
  this.unchanged(scope,connection.epoch);return result;
 }
 async read(scope:AuthenticatedScope,messageId:string):Promise<GmailMessage> {
  this.authorize(scope,'gmail.messages.read',{messageId});const connection=await this.connection(scope);
  const mode=this.activeMode;
  await this.options.audit(scope,'gmail.messages.read_requested',{mode});this.unchanged(scope,connection.epoch);
  const raw=await this.providerCall(()=>this.options.provider!.read({accessToken:connection.tokens.accessToken,messageId}));
  const source=raw as Record<string,unknown>|null;
  const result={id:source?.id,threadId:source?.threadId,subject:source?.subject,from:source?.from,to:source?.to,
   ...(source?.cc!==undefined?{cc:source.cc}:{}),
   ...(source?.replyTo!==undefined?{replyTo:source.replyTo}:{}),
   ...(source?.messageIdHeader!==undefined?{messageIdHeader:source.messageIdHeader}:{}),
   ...(source?.referencesHeader!==undefined?{referencesHeader:source.referencesHeader}:{}),
   date:source?.date,snippet:source?.snippet,bodyText:source?.bodyText,
   ...(source?.isUnread!==undefined?{isUnread:source.isUnread}:{}),
   untrusted:true as const,mode};
  if(!messageCheck.Check(result)||result.id!==messageId)
   throw error('GMAIL_PROVIDER_INVALID','Gmail provider returned an invalid message.',502);
  await this.options.audit(scope,'gmail.messages.read_completed',{mode});
  this.unchanged(scope,connection.epoch);return result;
 }
 async sendReply(
  scope:AuthenticatedScope,
  input:GmailSendReplyInput,
  approvedRequest:ApprovalRequest,
  idempotencyKey:string
 ):Promise<GmailSendReplyReceipt> {
  if(!sendReplyInputCheck.Check(input)) {
   throw error('GMAIL_REPLY_INVALID_INPUT','Gmail reply parameters failed validation.',400);
  }
  if(!approvedRequest||approvedRequest.workspaceId!==scope.workspaceId||approvedRequest.requesterUserId!==scope.userId||
   approvedRequest.actionName!==GMAIL_SEND_REPLY_ACTION) {
   throw new ForbiddenError('Gmail reply approval is bound to a different user or workspace.');
  }
  const canonicalHash=computeCanonicalParameterHash(input as unknown as Record<string,unknown>);
  const approvedHash=computeCanonicalParameterHash(approvedRequest.actionParams??{});
  if(approvedHash!==canonicalHash||approvedRequest.status!=='approved') {
   throw new ForbiddenError('Gmail reply approval does not match the exact reply payload or is not approved.');
  }
  this.authorize(scope,'gmail.messages.send_reply',input as unknown as Record<string,unknown>,approvedRequest,idempotencyKey);
  let connection=await this.connection(scope);
  const mode=this.activeMode;
  const grantedScopes=parseGrantedScopes(connection.tokens.scope,true)??[];
  if(!grantedScopes.includes(GMAIL_SEND)) {
   await this.options.audit(scope,'gmail.messages.send_reply_denied_scope',{mode,scopes:grantedScopes});
   throw error(
    'GMAIL_SEND_SCOPE_REQUIRED',
    'Your Gmail connection only has read-only access. Please disconnect and reconnect Gmail to grant send permission (gmail.send).',
    403
   );
  }
  if(!normalizeConnectedEmail(connection.connectedEmail)&&typeof this.options.provider?.getProfile==='function') {
   const resolved=await this.resolveProfileEmail(connection.tokens.accessToken);
   if(resolved&&this.epoch(scope)===connection.epoch) {
    connection={...connection,connectedEmail:resolved};
    this.options.vault!.set(scope,'connection',connection);
   }
  }
  const connectedEmail=normalizeConnectedEmail(connection.connectedEmail);
  if(!connectedEmail||connectedEmail.toLowerCase()!==input.connectedEmail.toLowerCase()) {
   await this.options.audit(scope,'gmail.messages.send_reply_denied_account',{
    mode,
    expectedEmail:input.connectedEmail,
    actualEmail:connectedEmail
   });
   throw error(
    'GMAIL_ACCOUNT_MISMATCH',
    'Connected Gmail account changed since this reply was prepared. Please prepare a new reply.',
    409
   );
  }
  if(typeof this.options.provider?.sendReply!=='function') {
   throw error('GMAIL_SEND_NOT_SUPPORTED','Gmail provider does not support sending replies.',503);
  }
  // One approval can produce at most one provider send attempt, whatever idempotency key is presented.
  const lockKey=`reply_lock:${approvedRequest.id}`;
  const existingLock=this.options.vault!.get<{status:string;receipt?:GmailSendReplyReceipt}>(scope,lockKey);
  if(existingLock) {
   throw error(
    'GMAIL_REPLY_ALREADY_PROCESSED',
    'This Gmail reply approval has already been processed and cannot be sent again.',
    409
   );
  }
  this.options.vault!.set(scope,lockKey,{status:'in_flight',startedAt:new Date(this.now()).toISOString()});
  await this.options.audit(scope,'gmail.messages.send_reply_requested',{
   mode,
   approvalId:approvedRequest.id,
   sourceMessageId:input.sourceMessageId,
   threadId:input.threadId,
   to:input.to,
   ...(input.cc?{cc:input.cc}:{}),
   connectedEmail
  });
  this.unchanged(scope,connection.epoch);
  try {
   const raw=await this.options.provider.sendReply({
    accessToken:connection.tokens.accessToken,
    connectedEmail,
    to:input.to,
    ...(input.cc?{cc:input.cc}:{}),
    subject:input.subject,
    threadId:input.threadId,
    ...(input.inReplyTo?{inReplyTo:input.inReplyTo}:{}),
    ...(input.references?{references:input.references}:{}),
    bodyText:input.bodyText
   });
   const providerMessageId=typeof raw?.id==='string'&&raw.id.trim()?raw.id.trim():undefined;
   const providerThreadId=typeof raw?.threadId==='string'&&raw.threadId.trim()?raw.threadId.trim():input.threadId;
   if(!providerMessageId) {
    this.options.vault!.set(scope,lockKey,{status:'unverified'});
    await this.options.audit(scope,'gmail.messages.send_reply_unverified',{
     mode,
     approvalId:approvedRequest.id,
     reason:'missing_provider_message_id'
    });
    throw error(
     'GMAIL_SEND_UNVERIFIED',
     'Gmail returned an ambiguous response without a message ID. Automatic retry is blocked to prevent duplicate sending.',
     502
    );
   }
   const receipt:GmailSendReplyReceipt={
    connectorName:'gmail',
    mode,
    status:'accepted_by_gmail',
    providerMessageId,
    providerThreadId,
    sourceMessageId:input.sourceMessageId,
    to:input.to,
    ...(input.cc?{cc:input.cc}:{}),
    subject:input.subject,
    connectedEmail,
    acceptedAt:new Date(this.now()).toISOString(),
    note:'Gmail accepted the reply for sending (messages.send). This confirms provider submission, not final recipient inbox delivery.'
   };
   if(!sendReplyReceiptCheck.Check(receipt)) {
    throw error('GMAIL_SEND_UNVERIFIED','Gmail reply receipt failed schema verification.',502);
   }
   this.options.vault!.set(scope,lockKey,{status:'completed',receipt});
   await this.options.audit(scope,'gmail.messages.send_reply_completed',{
    mode,
    approvalId:approvedRequest.id,
    providerMessageId,
    providerThreadId,
    status:receipt.status
   });
   return receipt;
  } catch(err) {
   if(err instanceof AppError&&err.code==='GMAIL_SEND_UNVERIFIED') {
    throw err;
   }
   const statusHint=(err as {statusCode?:number;uncertain?:boolean})?.statusCode;
   const uncertain=Boolean((err as {uncertain?:boolean})?.uncertain)||(statusHint!==undefined&&statusHint>=500);
   if(uncertain) {
    this.options.vault!.set(scope,lockKey,{status:'unverified'});
    await this.options.audit(scope,'gmail.messages.send_reply_unverified',{
     mode,
     approvalId:approvedRequest.id,
     reason:err instanceof Error?err.message:'provider_uncertain_outcome'
    });
    throw error(
     'GMAIL_SEND_UNVERIFIED',
     'Gmail send outcome could not be verified due to a network or server error. Automatic retry is disabled to prevent duplicate sending.',
     502
    );
   }
   this.options.vault!.set(scope,lockKey,{status:'failed'});
   await this.options.audit(scope,'gmail.messages.send_reply_failed',{
    mode,
    approvalId:approvedRequest.id,
    reason:err instanceof Error?err.message:'provider_rejected'
   });
   throw error(
    'GMAIL_SEND_FAILED',
    err instanceof AppError?err.message:'Gmail rejected the reply send request.',
    err instanceof AppError?err.statusCode:502
   );
  }
 }
 /**
  * Reports whether the authenticated user's own Gmail connection can send email right now.
  * Never contacts the provider beyond the normal status/refresh path and never exposes tokens.
  */
 async sendReadiness(scope:AuthenticatedScope,kind:'new'|'reply'='new'):Promise<GmailSendReadiness> {
  const status=await this.status(scope);
  const providerSupports=kind==='new'
   ?typeof this.options.provider?.sendNew==='function'
   :typeof this.options.provider?.sendReply==='function';
  if(!status.configured||status.status==='not_configured'||!providerSupports)
   return {ready:false,reason:'not_configured',connectedEmail:null,status};
  if(status.status==='disconnected')return {ready:false,reason:'disconnected',connectedEmail:null,status};
  if(status.status==='reconnect_required')return {ready:false,reason:'reconnect_required',connectedEmail:null,status};
  const connectedEmail=normalizeConnectedEmail(status.connectedEmail);
  if(!status.scopes.includes(GMAIL_SEND))return {ready:false,reason:'send_permission_missing',connectedEmail,status};
  if(!connectedEmail)return {ready:false,reason:'account_unverified',connectedEmail:null,status};
  return {ready:true,reason:'ready',connectedEmail,status};
 }
 /**
  * Sends a brand-new standalone email only for an explicitly approved, exactly matching payload.
  * Binding: same workspace, same requesting user, same action, same canonical parameter hash,
  * same connected Gmail account, gmail.send granted, and at most one provider attempt per approval.
  */
 async sendNew(
  scope:AuthenticatedScope,
  input:GmailSendNewInput,
  approvedRequest:ApprovalRequest,
  idempotencyKey:string
 ):Promise<GmailSendNewReceipt> {
  if(!sendNewInputCheck.Check(input)) {
   throw error('GMAIL_SEND_INVALID_INPUT','Email details failed validation.',400);
  }
  if(!approvedRequest||approvedRequest.workspaceId!==scope.workspaceId||approvedRequest.requesterUserId!==scope.userId||
   approvedRequest.actionName!==GMAIL_SEND_NEW_ACTION) {
   throw new ForbiddenError('Email approval is bound to a different user, workspace or action.');
  }
  const canonicalHash=computeCanonicalParameterHash(input as unknown as Record<string,unknown>);
  const approvedHash=computeCanonicalParameterHash(approvedRequest.actionParams??{});
  if(approvedHash!==canonicalHash||approvedRequest.status!=='approved') {
   throw new ForbiddenError('Email approval does not match the exact email or is not approved.');
  }
  this.authorize(scope,GMAIL_SEND_NEW_ACTION,input as unknown as Record<string,unknown>,approvedRequest,idempotencyKey);
  let connection=await this.connection(scope);
  const mode=this.activeMode;
  const grantedScopes=parseGrantedScopes(connection.tokens.scope,true)??[];
  if(!grantedScopes.includes(GMAIL_SEND)) {
   await this.options.audit(scope,'gmail.messages.send_new_denied_scope',{mode,scopes:grantedScopes});
   throw error('GMAIL_SEND_SCOPE_REQUIRED','Gmail sending is not allowed yet. Please reconnect Gmail and allow sending.',403);
  }
  if(!normalizeConnectedEmail(connection.connectedEmail)&&typeof this.options.provider?.getProfile==='function') {
   const resolved=await this.resolveProfileEmail(connection.tokens.accessToken);
   if(resolved&&this.epoch(scope)===connection.epoch) {
    connection={...connection,connectedEmail:resolved};
    this.options.vault!.set(scope,'connection',connection);
   }
  }
  const connectedEmail=normalizeConnectedEmail(connection.connectedEmail);
  if(!connectedEmail||connectedEmail.toLowerCase()!==input.connectedEmail.toLowerCase()) {
   await this.options.audit(scope,'gmail.messages.send_new_denied_account',{mode,expectedEmail:input.connectedEmail,actualEmail:connectedEmail});
   throw error('GMAIL_ACCOUNT_MISMATCH','Your connected Gmail account changed after this email was prepared. Please prepare it again.',409);
  }
  if(typeof this.options.provider?.sendNew!=='function') {
   throw error('GMAIL_SEND_NOT_SUPPORTED','Gmail provider does not support sending new emails.',503);
  }
  const lockKey=`send_new_lock:${approvedRequest.id}`;
  if(this.options.vault!.get<{status:string}>(scope,lockKey)) {
   throw error('GMAIL_SEND_ALREADY_PROCESSED','This approved email was already processed and cannot be sent again.',409);
  }
  this.options.vault!.set(scope,lockKey,{status:'in_flight',startedAt:new Date(this.now()).toISOString()});
  await this.options.audit(scope,'gmail.messages.send_new_requested',{
   mode,approvalId:approvedRequest.id,to:input.to,hasSubject:Boolean(input.subject),connectedEmail
  });
  this.unchanged(scope,connection.epoch);
  try {
   const raw=await this.options.provider.sendNew({
    accessToken:connection.tokens.accessToken,
    connectedEmail,
    to:input.to,
    ...(input.subject?{subject:input.subject}:{}),
    bodyText:input.bodyText
   });
   const providerMessageId=typeof raw?.id==='string'&&raw.id.trim()?raw.id.trim():undefined;
   const providerThreadId=typeof raw?.threadId==='string'&&raw.threadId.trim()?raw.threadId.trim():undefined;
   if(!providerMessageId) {
    this.options.vault!.set(scope,lockKey,{status:'unverified'});
    await this.options.audit(scope,'gmail.messages.send_new_unverified',{mode,approvalId:approvedRequest.id,reason:'missing_provider_message_id'});
    throw error('GMAIL_SEND_UNVERIFIED','Gmail did not confirm this email. Automatic retry is blocked to prevent a duplicate email.',502);
   }
   const receipt:GmailSendNewReceipt={
    connectorName:'gmail',
    mode,
    status:'accepted_by_gmail',
    providerMessageId,
    ...(providerThreadId?{providerThreadId}:{}),
    to:input.to,
    ...(input.subject?{subject:input.subject}:{}),
    connectedEmail,
    acceptedAt:new Date(this.now()).toISOString(),
    note:'Gmail accepted the email for sending (messages.send). This confirms provider submission, not final recipient inbox delivery.'
   };
   if(!sendNewReceiptCheck.Check(receipt)) {
    this.options.vault!.set(scope,lockKey,{status:'unverified'});
    throw error('GMAIL_SEND_UNVERIFIED','Gmail send receipt failed verification.',502);
   }
   this.options.vault!.set(scope,lockKey,{status:'completed'});
   await this.options.audit(scope,'gmail.messages.send_new_completed',{
    mode,approvalId:approvedRequest.id,providerMessageId,providerThreadId:providerThreadId??null,status:receipt.status
   });
   return receipt;
  } catch(err) {
   if(err instanceof AppError&&err.code==='GMAIL_SEND_UNVERIFIED')throw err;
   const statusHint=(err as {statusCode?:number})?.statusCode;
   const uncertain=Boolean((err as {uncertain?:boolean})?.uncertain)||(statusHint!==undefined&&statusHint>=500);
   if(uncertain) {
    this.options.vault!.set(scope,lockKey,{status:'unverified'});
    await this.options.audit(scope,'gmail.messages.send_new_unverified',{
     mode,approvalId:approvedRequest.id,reason:err instanceof Error?err.message:'provider_uncertain_outcome'
    });
    throw error('GMAIL_SEND_UNVERIFIED','We could not confirm whether Gmail sent this email. Automatic retry is disabled to prevent a duplicate email.',502);
   }
   this.options.vault!.set(scope,lockKey,{status:'failed'});
   await this.options.audit(scope,'gmail.messages.send_new_failed',{
    mode,approvalId:approvedRequest.id,reason:err instanceof Error?err.message:'provider_rejected'
   });
   throw error('GMAIL_SEND_FAILED',err instanceof AppError?err.message:'Gmail rejected the email.',err instanceof AppError?err.statusCode:502);
  }
 }
 createNewSendAdapter():ActionAdapter {
  const foundation=this;
  return {
   name:GMAIL_SEND_NEW_ACTION,
   idempotencySupport:'none',
   async execute(context:ActionExecutionContext):Promise<ActionResult> {
    const scope=context.scope as AuthenticatedScope|undefined;
    const approvedRequest=context.approvedRequest as ApprovalRequest|undefined;
    if(!scope||!approvedRequest) {
     return {success:false,status:'failed',verificationMethod:'policy_gateway_context_check',
      proof:{error:'Missing authenticated user scope or approved request context'},
      error:'Missing authenticated user scope or approved request context'};
    }
    try {
     const receipt=await foundation.sendNew(scope,context.parameters as unknown as GmailSendNewInput,approvedRequest,context.idempotencyKey);
     return {success:true,status:'verified',verificationMethod:'gmail_api_messages_send_receipt',proof:receipt as unknown as Record<string,unknown>};
    } catch(err) {
     if(err instanceof AppError&&err.code==='GMAIL_NOT_CONFIGURED') {
      return {success:false,status:'not_configured',verificationMethod:'gmail_configuration_check',proof:{code:err.code,message:err.message},error:err.message};
     }
     if(err instanceof AppError&&err.code==='GMAIL_SEND_UNVERIFIED') {
      return {success:false,status:'unverified',verificationMethod:'gmail_api_messages_send_uncertain',
       proof:{code:err.code,message:err.message,idempotencyKey:context.idempotencyKey},error:err.message};
     }
     const message=err instanceof Error?err.message:'Gmail send failed.';
     const code=err instanceof AppError?err.code:'GMAIL_SEND_FAILED';
     return {success:false,status:'failed',verificationMethod:'gmail_api_messages_send_error',
      proof:{code,message,idempotencyKey:context.idempotencyKey},error:message};
    }
   }
  };
 }
 /** Adapters for every governed Gmail send action, for in-process plan execution. */
 createSendAdapters():Array<[string,ActionAdapter]> {
  return [[GMAIL_SEND_REPLY_ACTION,this.createReplySendAdapter()],[GMAIL_SEND_NEW_ACTION,this.createNewSendAdapter()]];
 }
 createReplySendAdapter():ActionAdapter {
  const foundation=this;
  return {
   name:'gmail.messages.send_reply',
   idempotencySupport:'none',
   async execute(context:ActionExecutionContext):Promise<ActionResult> {
    const scope=context.scope as AuthenticatedScope|undefined;
    const approvedRequest=context.approvedRequest as ApprovalRequest|undefined;
    if(!scope||!approvedRequest) {
     return {
      success:false,
      status:'failed',
      verificationMethod:'policy_gateway_context_check',
      proof:{error:'Missing authenticated user scope or approved request context'},
      error:'Missing authenticated user scope or approved request context'
     };
    }
    try {
     const receipt=await foundation.sendReply(
      scope,
      context.parameters as unknown as GmailSendReplyInput,
      approvedRequest,
      context.idempotencyKey
     );
     return {
      success:true,
      status:'verified',
      verificationMethod:'gmail_api_messages_send_receipt',
      proof:receipt as unknown as Record<string,unknown>
     };
    } catch(err) {
     if(err instanceof AppError&&err.code==='GMAIL_NOT_CONFIGURED') {
      return {
       success:false,
       status:'not_configured',
       verificationMethod:'gmail_configuration_check',
       proof:{code:err.code,message:err.message},
       error:err.message
      };
     }
     if(err instanceof AppError&&err.code==='GMAIL_SEND_UNVERIFIED') {
      return {
       success:false,
       status:'unverified',
       verificationMethod:'gmail_api_messages_send_uncertain',
       proof:{code:err.code,message:err.message,idempotencyKey:context.idempotencyKey},
       error:err.message
      };
     }
     const message=err instanceof Error?err.message:'Gmail reply send failed.';
     const code=err instanceof AppError?err.code:'GMAIL_SEND_FAILED';
     return {
      success:false,
      status:'failed',
      verificationMethod:'gmail_api_messages_send_error',
      proof:{code,message,idempotencyKey:context.idempotencyKey},
      error:message
     };
    }
   }
  };
 }
}
