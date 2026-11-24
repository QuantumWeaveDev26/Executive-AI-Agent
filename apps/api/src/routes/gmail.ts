
import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
 GmailStatusSchema,GmailStartSchema,GmailEmptySchema,GmailCallbackSchema,GmailSearchSchema,
 GmailSearchResponseSchema,GmailMessageSchema,GmailMessageIdSchema,GmailCallback,GmailSearch,
 GmailPrepareNewEmail,GmailPrepareNewEmailSchema,GmailPrepareReplyEmail,GmailPrepareReplyEmailSchema,
 GmailPreparedSendSchema,GmailSendNewInput,GmailSendReplyInput
} from '@thaara/contracts';
import { TransactionalDbClient,AuthenticatedScope,AuditEventRepository } from '@thaara/db';
import { AppError,ForbiddenError } from '@thaara/observability';
import { PolicyGateway } from '@thaara/policy';
import { LocalConnectorDiagnosticReader } from './connector-diagnostics.js';
import { GMAIL_SEND_NEW_ACTION,GMAIL_SEND_REPLY_ACTION,GmailFoundation,GmailOptions,GmailSendReadinessReason } from '../services/gmail.js';
import {
 createGovernedGmailSend,
 deriveGmailReplyRecipients,
 extractAllGmailAddresses,
 normalizeGmailRecipient as normalizeRecipient,
 normalizeReplySubjectHeader
} from '../services/gmail-send-governance.js';

export async function gmailRoutes(app:FastifyInstance,options:{
 db:TransactionalDbClient;policyGateway:PolicyGateway;gmail?:GmailOptions;
}):Promise<LocalConnectorDiagnosticReader&{service:GmailFoundation}> {
 async function scoped(scope:AuthenticatedScope,action?:string,payload:Record<string,unknown>={}) {
  await options.db.withScopedTransaction(scope,async tx=>{
   // Refresh authorization both before provider work and before releasing its result.
   const {rows}=await tx.query<{workspace_id:string;user_id:string;role:string}>(
    'SELECT workspace_id,user_id,role FROM public.resolve_session_scope($1)',[scope.sessionTokenHash]);
   const current=rows[0];
   if(!current||current.workspace_id!==scope.workspaceId||current.user_id!==scope.userId||current.role!==scope.role)
    throw new ForbiddenError('Active matching workspace membership is required.');
   if(action)await new AuditEventRepository(tx).create(scope.workspaceId,action,'gmail_connection',payload,scope.userId);
  });
 }
 const service=new GmailFoundation({...options.gmail,policyGateway:options.policyGateway,
  audit:(scope,action,payload)=>scoped(scope,action,payload)});
 const preHandler=[async (_request:unknown,reply:import('fastify').FastifyReply)=>{
  reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer');
 },app.requireAuth];
 const tags=['Gmail'];
 app.get('/connectors/gmail/status',{preHandler,schema:{tags,response:{200:GmailStatusSchema}}},async request=>{
  await scoped(request.scope!);return service.status(request.scope!);
 });
 app.post('/connectors/gmail/oauth/start',{preHandler,schema:{tags,body:GmailEmptySchema,response:{200:GmailStartSchema}}},
  async request=>service.start(request.scope!));
 app.get<{Querystring:GmailCallback}>('/connectors/gmail/oauth/callback',{
  preHandler,schema:{tags,querystring:GmailCallbackSchema,response:{200:GmailStatusSchema}}
 },async request=>service.complete(request.scope!,request.query));
 app.delete('/connectors/gmail/connection',{preHandler,schema:{tags,response:{200:GmailStatusSchema}}},
  async request=>{await scoped(request.scope!);return service.disconnect(request.scope!);});
 app.post<{Body:GmailSearch}>('/connectors/gmail/messages/search',{
  preHandler,schema:{tags,body:GmailSearchSchema,response:{200:GmailSearchResponseSchema}}
 },async request=>service.search(request.scope!,request.body));
 app.get<{Params:{messageId:string}}>('/connectors/gmail/messages/:messageId',{
  preHandler,schema:{tags,params:Type.Object({messageId:GmailMessageIdSchema},{additionalProperties:false}),response:{200:GmailMessageSchema}}
 },async request=>service.read(request.scope!,request.params.messageId));
 // Step 106: prepares (never sends) a brand-new email. Sending happens only after the requesting user
 // explicitly approves the bound approval request; the governed adapter then calls Gmail messages.send.
 app.post<{Body:GmailPrepareNewEmail}>('/connectors/gmail/messages/send-new',{
  preHandler,schema:{tags,body:GmailPrepareNewEmailSchema,response:{200:GmailPreparedSendSchema}}
 },async request=>{
  const scope=request.scope!;
  await scoped(scope);
  const to=normalizeRecipient(request.body.to);
  if(!to)throw new AppError('Enter a valid email address, for example name@example.com.','GMAIL_INVALID_RECIPIENT',400);
  const bodyText=request.body.bodyText.replace(/\r\n/g,'\n').trim();
  if(!bodyText)throw new AppError('Please write a message before sending.','GMAIL_EMPTY_MESSAGE',400);
  const subject=(request.body.subject??'').replace(/[\r\n]+/g,' ').trim().slice(0,998);
  const readiness=await service.sendReadiness(scope,'new');
  if(!readiness.ready||!readiness.connectedEmail)throw readinessError(readiness.reason);
  const params:GmailSendNewInput={connectedEmail:readiness.connectedEmail,to,...(subject?{subject}:{}),bodyText:bodyText.slice(0,50000)};
  const created=await createGovernedGmailSend(options.db,scope,{
   actionName:GMAIL_SEND_NEW_ACTION,
   params:params as unknown as Record<string,unknown>,
   title:`Email to ${to}`,
   description:'Approval-gated new Gmail email from the Gmail composer',
   metadata:{origin:'gmail_composer',conversationId:null,connectedEmail:readiness.connectedEmail,to,...(subject?{subject}:{})},
   auditAction:'gmail.messages.send_new_prepared',
   auditPayload:{to,connectedEmail:readiness.connectedEmail,origin:'gmail_composer'}
  });
  return {planId:created.planId,approvalId:created.approvalId,status:'awaiting_approval' as const,
   from:readiness.connectedEmail,to,...(subject?{subject}:{}),bodyText:params.bodyText,expiresAt:created.expiresAt};
 });
 // Step 106.3: prepares (never sends) a threaded Gmail Reply or Reply All from the inbox view.
 app.post<{Body:GmailPrepareReplyEmail}>('/connectors/gmail/messages/send-reply',{
  preHandler,schema:{tags,body:GmailPrepareReplyEmailSchema,response:{200:GmailPreparedSendSchema}}
 },async request=>{
  const scope=request.scope!;
  await scoped(scope);
  const bodyText=request.body.bodyText.replace(/\r\n/g,'\n').trim();
  if(!bodyText)throw new AppError('Please write a message before sending.','GMAIL_EMPTY_MESSAGE',400);
  const readiness=await service.sendReadiness(scope,'reply');
  if(!readiness.ready||!readiness.connectedEmail)throw readinessError(readiness.reason);
  const source=await service.read(scope,request.body.sourceMessageId);
  const threadId=source.threadId??source.id;
  const replyAll=Boolean(request.body.replyAll);
  const derived=deriveGmailReplyRecipients(source,readiness.connectedEmail,replyAll);
  const explicitToAddrs=request.body.to?extractAllGmailAddresses(request.body.to):[];
  if(request.body.to&&explicitToAddrs.length===0){
   throw new AppError('Enter a valid email address, for example name@example.com.','GMAIL_INVALID_RECIPIENT',400);
  }
  const to=explicitToAddrs[0]??derived.to;
  if(!to)throw new AppError('Enter a valid email address, for example name@example.com.','GMAIL_INVALID_RECIPIENT',400);
  const extraFromTo=explicitToAddrs.slice(1);
  const rawCc=request.body.cc!==undefined?request.body.cc:derived.cc;
  const ccList=[...extraFromTo,...extractAllGmailAddresses(rawCc)].filter(
   (addr,idx,arr)=>addr.toLowerCase()!==to.toLowerCase()&&
    (!replyAll||addr.toLowerCase()!==readiness.connectedEmail!.toLowerCase())&&
    arr.findIndex(a=>a.toLowerCase()===addr.toLowerCase())===idx
  );
  const cc=ccList.length>0?ccList.join(', ').slice(0,2000):undefined;
  const subject=request.body.subject?.replace(/[\r\n]+/g,' ').trim()
   ?normalizeReplySubjectHeader(request.body.subject)
   :normalizeReplySubjectHeader(source.subject);
  const inReplyTo=source.messageIdHeader?.replace(/[\r\n]+/g,' ').trim();
  const references=[source.referencesHeader,source.messageIdHeader]
   .filter((v):v is string=>Boolean(v&&v.trim()))
   .join(' ')
   .replace(/[\r\n]+/g,' ')
   .trim()
   .slice(0,4096)||undefined;
  const params:GmailSendReplyInput={
   sourceMessageId:source.id,
   threadId,
   connectedEmail:readiness.connectedEmail,
   to,
   ...(cc?{cc}:{}),
   subject,
   ...(inReplyTo?{inReplyTo}:{}),
   ...(references?{references}:{}),
   bodyText:bodyText.slice(0,50000)
  };
  const created=await createGovernedGmailSend(options.db,scope,{
   actionName:GMAIL_SEND_REPLY_ACTION,
   params:params as unknown as Record<string,unknown>,
   title:`Reply to ${to}: ${subject}`,
   description:replyAll?'Approval-gated Gmail reply-all from the Gmail inbox':'Approval-gated Gmail reply from the Gmail inbox',
   metadata:{
    origin:'gmail_composer',
    conversationId:null,
    connectedEmail:readiness.connectedEmail,
    sourceMessageId:source.id,
    threadId,
    to,
    ...(cc?{cc}:{}),
    subject,
    replyAll
   },
   auditAction:'gmail.messages.send_reply_prepared',
   auditPayload:{sourceMessageId:source.id,threadId,to,...(cc?{cc}:{}),connectedEmail:readiness.connectedEmail,replyAll,origin:'gmail_composer'}
  });
  return {
   planId:created.planId,
   approvalId:created.approvalId,
   status:'awaiting_approval' as const,
   from:readiness.connectedEmail,
   to,
   ...(cc?{cc}:{}),
   subject,
   bodyText:params.bodyText,
   threadId,
   sourceMessageId:source.id,
   expiresAt:created.expiresAt
  };
 });
 return {connectorName:'gmail',connectionScope:'user',storageKind:options.gmail?.vault?'ephemeral_encrypted_mock':'unavailable',kmsStatus:'not_configured',
  service,
  read:async scope=>{
   const value=await service.status(scope);
   return {connectionState:value.status==='connected'?'connected_mock':value.status,storageStatus:value.configured?'readable':options.gmail?.vault?'not_checked':'not_configured'};
  }};
}

/** Plain-language, non-secret errors for a connection that cannot send yet. */
export function readinessError(reason:GmailSendReadinessReason):AppError {
 switch(reason) {
  case 'not_configured':return new AppError('Gmail sending is not set up in this environment.','GMAIL_NOT_CONFIGURED',503);
  case 'disconnected':return new AppError('Gmail is not connected. Please connect Gmail first.','GMAIL_DISCONNECTED',409);
  case 'reconnect_required':return new AppError('Your Gmail connection expired. Please reconnect Gmail.','GMAIL_RECONNECT_REQUIRED',409);
  case 'send_permission_missing':return new AppError('Gmail sending is not allowed yet. Please reconnect Gmail and allow sending.','GMAIL_SEND_SCOPE_REQUIRED',409);
  default:return new AppError('We could not confirm which Gmail account is connected. Please reconnect Gmail.','GMAIL_ACCOUNT_UNVERIFIED',409);
 }
}