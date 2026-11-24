import {phoneRecipientMatches,normalizePhoneRecipient} from '@thaara/contracts';
import {createHash,randomUUID} from 'node:crypto';
import {Value} from '@sinclair/typebox/value';
import {PHONE_CALL_RESULT_READ_ACTION,type PhoneCallingProviderResult} from '@thaara/contracts';
import {PHONE_AI_CALL_ACTION,PHONE_REPORT_SPEECH_ACTION,PhoneCallingPrepareSchema,PhoneCallingDraftSchema,computeCanonicalParameterHash,type ApprovalRequest,type PhoneCallingDraft,type PhoneCallingLanguage,type PhoneCallingPrepare,type PhoneCallingPrepared,type PhoneCallingRecord,type PhoneCallingState} from '@thaara/contracts';
import type {AuthenticatedScope} from '@thaara/db';
import {AppError,ForbiddenError,ConflictError} from '@thaara/observability';
import {defaultPolicyGateway,type PolicyGateway} from '@thaara/policy';
import {maskPhoneCallNumber,sanitizePhoneMetadataText} from './phone.js';
import {PhoneConversation,buildAiDisclosure,safeOnBehalfOf} from './phone-conversation.js';
import type {PhoneCallProvider} from './phone-plivo.js';

export interface PhoneContact{workspaceId:string;userId:string;id:string;revision:number;displayName:string;aliases?:string[];phoneE164:string;consent:{reference:string;expiresAt:string;callingAllowed:boolean}}
/** Implementations must use tenant-scoped storage and receive scope explicitly; client payload is never a directory. */
export interface PhoneContactDirectory{list(scope:AuthenticatedScope):Promise<PhoneContact[]>}
export interface PhoneCallingStore{
 assertScope(scope:AuthenticatedScope):Promise<void>;
 createPrepared(scope:AuthenticatedScope,draft:PhoneCallingDraft,chatContext?:{conversationId:string}):Promise<{approvalId:string;planId:string;stepId:string}>;
 approval(scope:AuthenticatedScope,id:string):Promise<ApprovalRequest|null>;
 audit(scope:AuthenticatedScope,action:string,metadata:Record<string,unknown>):Promise<void>;
 /** The signed-in user's display name, for "calling on behalf of". */
 ownerName?(scope:AuthenticatedScope):Promise<string|null>;
 /** Marks the requester's own pending phone approval as approved (one-tap "Call now"). */
 confirmOwnRequest?(scope:AuthenticatedScope,approvalId:string):Promise<void>;
 /** The caller's own pending/approved, unexpired phone call approvals (newest first). */
 openRequests?(scope:AuthenticatedScope):Promise<{approvalId:string;status:'pending'|'approved';expiresAt:string;draft:unknown}[]>;
}
export type PhoneSimulationEvent={eventId:string;sequence:number;kind:'state'|'recipient_final'|'interruption';state?:PhoneCallingState;text?:string};
export interface PhoneCallLedgerEntry{record:PhoneCallingRecord;providerRequestId?:string|null;events:Map<string,string>;sequence:number;turns:{id:string;text:string}[]}
/** Call history storage. Implementations audit their own writes and must reject a replayed approval whose draft differs. */
export interface PhoneCallLedger{
 readonly durable:boolean;
 claim(scope:AuthenticatedScope,record:PhoneCallingRecord,draftHash:string,options?:{dailyLiveLimit?:number}):Promise<PhoneCallingRecord>;
 list(scope:AuthenticatedScope):Promise<PhoneCallingRecord[]>;
 load(scope:AuthenticatedScope,callId:string):Promise<PhoneCallLedgerEntry|null>;
 append(scope:AuthenticatedScope,entry:PhoneCallLedgerEntry,event:PhoneSimulationEvent,eventHash:string,next:PhoneCallingRecord):Promise<PhoneCallingRecord>;
}
/** Live outbox operations (durable ledger only). */
export interface PhoneLiveCallStore{
 bindCallbackNumber?(scope:AuthenticatedScope,callId:string,phoneE164:string,draftHash:string):Promise<void>;
 claimDispatch(scope:AuthenticatedScope,callId:string):Promise<PhoneCallingRecord|null>;
 recordDispatch(scope:AuthenticatedScope,callId:string,result:{status:'unverified';providerRequestId:string}|{status:'failed'|'unknown';code:string}):Promise<PhoneCallingRecord>;
}
/** Live calling: a provider that is itself switched on, plus the durable outbox. Never configured by default. */
/** dailyCallLimit: hard cap on new live calls per owner per rolling 24 h, enforced in the claim transaction (default 5 by owner decision 31 Oct 2026, max 20). */
export interface PhoneLiveCallingOptions{provider:PhoneCallProvider;store:PhoneLiveCallStore;dailyCallLimit?:number;unlimitedDailyCalls?:boolean}
export const DEFAULT_DAILY_CALL_LIMIT=5;
/** Reads a call report aloud to the owner in Thaara's voice (e.g. Sarvam Bulbul); returns WAV bytes. */
export interface PhoneReportVoice{speak(text:string,language:PhoneCallingLanguage,signal:AbortSignal):Promise<Uint8Array>}
export interface PhoneCallingOptions{recipientEligibility?:(scope:AuthenticatedScope,recipient:{phoneE164:string;purpose:string})=>Promise<boolean>;contacts?:PhoneContactDirectory;simulation?:boolean;calls?:PhoneCallLedger;live?:PhoneLiveCallingOptions;reportVoice?:PhoneReportVoice}
export const liveCallReport=(state:PhoneCallingState,detail?:string)=>{const text=`Live call. Call state: ${state}. ${detail??'No conversation outcome is recorded here.'}`;return {text,spokenText:text,quotedResponses:[],evidenceIds:[],verified:false as const,simulated:false};};
const transitions:Record<PhoneCallingState,PhoneCallingState[]>={queued:['ringing','failed','cancelled'],ringing:['answered','busy','no_answer','failed','cancelled'],answered:['completed','failed','cancelled'],completed:[],failed:[],cancelled:[],busy:[],no_answer:[]};
const deny=()=>new ForbiddenError('Phone calling operation denied.');
const binding=(c:PhoneContact)=>createHash('sha256').update(JSON.stringify([c.workspaceId,c.userId,c.id,c.revision,c.phoneE164,c.displayName,c.consent])).digest('hex');
const scopeKey=(s:AuthenticatedScope)=>JSON.stringify([s.workspaceId,s.userId]);
const cloneEntry=(e:PhoneCallLedgerEntry):PhoneCallLedgerEntry=>({record:structuredClone(e.record),events:new Map(e.events),sequence:e.sequence,turns:structuredClone(e.turns)});

/** Bounded, process-local ledger (default). Not durable: history is lost on restart. */
export class MemoryPhoneCallLedger implements PhoneCallLedger{
 readonly durable=false;
 private entries=new Map<string,PhoneCallLedgerEntry>();
 constructor(private readonly store:Pick<PhoneCallingStore,'audit'|'assertScope'>){}
 async claim(scope:AuthenticatedScope,record:PhoneCallingRecord,draftHash:string){
  const key=scopeKey(scope)+':'+record.approvalId,old=this.entries.get(key);
  if(old){if(computeCanonicalParameterHash(old.record.draft)!==draftHash)throw deny();return structuredClone(old.record);}
  if(this.entries.size>=1000||(await this.list(scope)).length>=100)throw deny();
  await this.store.audit(scope,'phone.ai.simulation_created',{callId:record.id,approvalId:record.approvalId});await this.store.assertScope(scope);
  this.entries.set(key,{record:structuredClone(record),events:new Map(),sequence:0,turns:[]});return structuredClone(record);
 }
 async list(scope:AuthenticatedScope){return [...this.entries.entries()].filter(([k])=>k.startsWith(scopeKey(scope)+':')).map(([,v])=>structuredClone(v.record)).reverse();}
 async load(scope:AuthenticatedScope,callId:string){const e=[...this.entries.entries()].find(([k,v])=>k.startsWith(scopeKey(scope)+':')&&v.record.id===callId);return e?cloneEntry(e[1]):null;}
 async append(scope:AuthenticatedScope,entry:PhoneCallLedgerEntry,event:PhoneSimulationEvent,eventHash:string,next:PhoneCallingRecord){
  const key=scopeKey(scope)+':'+entry.record.approvalId,current=this.entries.get(key);
  if(!current||current.sequence+1!==event.sequence)throw deny();
  await this.store.audit(scope,'phone.ai.simulation_event',{callId:next.id,eventId:event.eventId,state:next.state});await this.store.assertScope(scope);
  const turns=event.kind==='recipient_final'?[...current.turns,{id:event.eventId,text:event.text!}]:current.turns;
  this.entries.set(key,{record:structuredClone(next),events:new Map([...current.events,[event.eventId,eventHash]]),sequence:event.sequence,turns});
  return structuredClone(next);
 }
}

/** Preparation is durable through existing approval/plan storage. Call history uses the configured ledger (in-memory by default). */
export class PhoneCallingService{
 private locks=new Map<string,Promise<void>>();
 private readonly now:()=>number;
 private readonly policy:PolicyGateway;
 private readonly calls:PhoneCallLedger;
 private readonly campaignAuthorizedRecipients=new Map<string,number>();
 constructor(private readonly options:PhoneCallingOptions&{store:PhoneCallingStore;now?:()=>number;policy?:PolicyGateway}){
  this.now=options.now??Date.now;this.policy=options.policy??defaultPolicyGateway;this.calls=options.calls??new MemoryPhoneCallLedger(options.store);
  // Live calling needs a switched-on provider, a durable ledger and a contact directory; anything less is a configuration error.
  const limit=options.live?.dailyCallLimit;
  if(limit!==undefined&&!(Number.isSafeInteger(limit)&&limit>=1&&limit<=10000))throw new Error('Daily phone call limit must be 1-10000 or unlimited.');
  if(options.live&&(options.live.provider.liveCallingEnabled!==true||!this.calls.durable||!options.contacts))throw new Error('Live phone calling requires an enabled provider, durable call ledger and contacts.');
 }
 private get live(){return this.options.live&&this.options.live.provider.liveCallingEnabled===true?this.options.live:undefined;}
 private key(s:AuthenticatedScope){return scopeKey(s);}
 private async scope(s:AuthenticatedScope){if(!s.sessionTokenHash||!['owner','admin','member'].includes(s.role))throw deny();await this.options.store.assertScope(s);}
 private async locked<T>(key:string,work:()=>Promise<T>):Promise<T>{
  const before=this.locks.get(key)??Promise.resolve();let release!:()=>void;
  const after=new Promise<void>(r=>{release=r;});this.locks.set(key,after);
  await before;try{return await work();}finally{release();if(this.locks.get(key)===after)this.locks.delete(key);}
 }
 private async contacts(scope:AuthenticatedScope){
  if(!this.options.contacts)throw new AppError('Phone contacts are not configured. No call was made.','PHONE_CONTACTS_NOT_CONFIGURED',503);
  const contacts=structuredClone(await this.options.contacts.list(scope));
  if(!Array.isArray(contacts)||contacts.length>1000)throw deny();
  for(const c of contacts)if(c.workspaceId!==scope.workspaceId||c.userId!==scope.userId||!/^[a-zA-Z0-9_-]{1,128}$/.test(c.id)||!Number.isSafeInteger(c.revision)||c.revision<1||!/^\+91[6-9][0-9]{9}$/.test(c.phoneE164)||typeof c.displayName!=='string'||!c.displayName.trim()||c.displayName.length>128||c.aliases&&(!Array.isArray(c.aliases)||c.aliases.length>20||c.aliases.some(a=>typeof a!=='string'||a.length>128))||!c.consent||typeof c.consent.callingAllowed!=='boolean'||!/^[a-zA-Z0-9_-]{1,128}$/.test(c.consent.reference)||!Number.isFinite(Date.parse(c.consent.expiresAt)))throw deny();
  if(new Set(contacts.map(c=>c.id)).size!==contacts.length)throw deny();
  return contacts;
 }
 async status(scope:AuthenticatedScope){await this.scope(scope);return {status:this.live?'live_enabled' as const:this.options.simulation?'simulation_only' as const:'not_configured' as const,liveCallingEnabled:!!this.live,contactDirectoryConfigured:!!this.options.contacts,simulationEnabled:!!this.options.simulation,durableCallHistory:this.calls.durable,recordingEnabled:false as const,dailyCallLimit:this.live?(this.live.dailyCallLimit??null):null,unlimitedDailyCalls:Boolean(this.live&&this.live.dailyCallLimit===undefined),languages:['en-IN','kn-IN','kn-en'] as const,speechVerified:false as const};}
 async resolve(scope:AuthenticatedScope,query:string){
  await this.scope(scope);if(typeof query!=='string'||!query.trim()||query.length>128)throw deny();
  const matches=(await this.contacts(scope)).filter(c=>phoneRecipientMatches(c,query));
  if(matches.length>20)throw deny();
  return {status:matches.length===1?'matched':matches.length?'ambiguous':'not_found',candidates:matches.map(c=>({id:c.id,displayName:sanitizePhoneMetadataText(c.displayName,128),maskedPhone:maskPhoneCallNumber(c.phoneE164)}))};
 }
 async prepare(scope:AuthenticatedScope,input:PhoneCallingPrepare,chatContext?:{conversationId:string}):Promise<PhoneCallingPrepared>{
  await this.scope(scope);const request=structuredClone(input);
  if(!Value.Check(PhoneCallingPrepareSchema,request)||!request.contactQuery.trim()||!request.purpose.trim())throw deny();
  const allContacts=await this.contacts(scope);
  const matches=allContacts.filter(c=>phoneRecipientMatches(c,request.contactQuery));
  const selected=request.selectedContactId?allContacts.filter(c=>c.id===request.selectedContactId):matches;
  const number=normalizePhoneRecipient(request.contactQuery);
  const isNew=matches.length===0&&number!==null&&!request.selectedContactId;
  if(!isNew&&selected.length!==1)throw new ConflictError('Choose exactly one matching contact before preparing a call.');
  if(request.newRecipient&&!isNew)throw deny();
  if(isNew&&scope.role!=='owner')throw deny();
  const previewApprovalId=request.newRecipient?.previewApprovalId;
  if(previewApprovalId){
   const parent=await this.options.store.approval(scope,previewApprovalId);
   if(!parent||parent.requesterUserId!==scope.userId||parent.actionName!==PHONE_AI_CALL_ACTION||parent.status!=='pending'||!Number.isFinite(Date.parse(parent.expiresAt))||Date.parse(parent.expiresAt)<=this.now()||!Value.Check(PhoneCallingDraftSchema,parent.actionParams))throw deny();
   const original=parent.actionParams as PhoneCallingDraft;
   if(!original.newRecipient||original.newRecipient.phoneE164!==number||original.purpose!==sanitizePhoneMetadataText(request.purpose,1000)||original.language!==request.language||original.maxDurationSeconds!==(request.maxDurationSeconds??this.live?.provider.enforcedMaxDurationSeconds??120))throw deny();
  }
  const consentConfirmed=request.newRecipient?.consentConfirmed===true;
  const eligible=isNew&&consentConfirmed&&await this.newRecipientEligible(scope,number!,request.purpose);
  const contact:PhoneContact=isNew?{workspaceId:scope.workspaceId,userId:scope.userId,id:'onecall_'+randomUUID(),revision:1,displayName:request.newRecipient?.displayName??'New recipient',phoneE164:number!,consent:{reference:'onecall_'+randomUUID(),expiresAt:new Date(this.now()+900000).toISOString(),callingAllowed:eligible}}:selected[0]!;
  if(!isNew)this.consent(contact);
  const cap=this.live?.provider.enforcedMaxDurationSeconds;
  if(cap!==undefined&&request.maxDurationSeconds!==undefined&&request.maxDurationSeconds!==cap)
   throw new AppError('This agent enforces a different maximum call length. Prepare a request using its configured limit.','PHONE_DURATION_MISMATCH',400);
  // Who Thaara speaks for comes from the server-side account, never from the request.
  const onBehalfOf=safeOnBehalfOf(await this.options.store.ownerName?.(scope));
  const draft:PhoneCallingDraft={draftId:randomUUID(),...(isNew?{newRecipient:{...(previewApprovalId?{previewApprovalId}:{}),phoneE164:number!,consentConfirmed,eligibility:eligible?'eligible' as const:'unverified' as const}}:{}),contactId:contact.id,contactRevision:contact.revision,contactBindingHash:isNew?computeCanonicalParameterHash({workspaceId:scope.workspaceId,userId:scope.userId,phoneE164:number!,displayName:sanitizePhoneMetadataText(contact.displayName,128),purpose:sanitizePhoneMetadataText(request.purpose,1000),consentConfirmed}):binding(contact),recipient:{displayName:sanitizePhoneMetadataText(contact.displayName,128),maskedPhone:maskPhoneCallNumber(contact.phoneE164)},purpose:sanitizePhoneMetadataText(request.purpose,1000),language:request.language,maxDurationSeconds:request.maxDurationSeconds??cap??120,aiDisclosure:buildAiDisclosure(request.language,onBehalfOf),consentReference:contact.consent.reference,idempotencyKey:randomUUID(),mode:this.live?'live':'simulation',...(this.live?.provider.configurationFingerprint?{providerBindingHash:this.live.provider.configurationFingerprint}:{}),...(onBehalfOf?{onBehalfOf}:{})};
  if(!Value.Check(PhoneCallingDraftSchema,draft)||!draft.purpose.trim())throw deny();
  // No adapter is called by preparation. Approval binds all displayed details and the current contact fingerprint.
  await this.scope(scope);
  const result=await this.options.store.createPrepared(scope,structuredClone(draft),chatContext);
  return {draft,...result,status:'awaiting_approval',liveCallingEnabled:draft.mode==='live'};
 }
 /** Server-internal only: grants a short-lived eligibility lease for a consented unsaved bulk-campaign recipient. */
 authorizeCampaignRecipient(scope:AuthenticatedScope,phoneE164:string,ttlMs=60000):()=>void{
  const key=`${scope.workspaceId}:${scope.userId}:${phoneE164}`;
  this.campaignAuthorizedRecipients.set(key,this.now()+Math.max(5000,Math.min(ttlMs,300000)));
  return ()=>{this.campaignAuthorizedRecipients.delete(key);};
 }
 private async newRecipientEligible(scope:AuthenticatedScope,phoneE164:string,purpose:string){
  // Conservative local admission. Provider/legal eligibility must come from a server-owned resolver, never owner input.
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',hourCycle:'h23'}).format(this.now()));
  if(hour<9||hour>=20)return false;
  if(this.options.recipientEligibility){
   try{return await this.options.recipientEligibility(scope,{phoneE164,purpose})===true;}catch{return false;}
  }
  const key=`${scope.workspaceId}:${scope.userId}:${phoneE164}`;
  const exp=this.campaignAuthorizedRecipients.get(key)??0;
  return exp>this.now();
 }
 private async draftContact(scope:AuthenticatedScope,draft:PhoneCallingDraft,expiresAt:string):Promise<PhoneContact|undefined>{
  if(!draft.newRecipient)return (await this.contacts(scope)).find(c=>c.id===draft.contactId);
  const n=draft.newRecipient;
  if((await this.contacts(scope)).some(c=>c.phoneE164===n.phoneE164))throw deny();
  if(scope.role!=='owner'||!draft.contactId.startsWith('onecall_')||n.consentConfirmed!==true||n.eligibility!=='eligible'||!await this.newRecipientEligible(scope,n.phoneE164,draft.purpose))throw deny();
  // One-call identity only: no directory insert. Expiry is enforced by the existing approval, not a new contact record.
  return {workspaceId:scope.workspaceId,userId:scope.userId,id:draft.contactId,revision:draft.contactRevision,displayName:draft.recipient.displayName,phoneE164:n.phoneE164,consent:{reference:draft.consentReference,expiresAt,callingAllowed:true}};
 }
 private draftBinding(scope:AuthenticatedScope,c:PhoneContact,draft:PhoneCallingDraft){return draft.newRecipient?computeCanonicalParameterHash({workspaceId:scope.workspaceId,userId:scope.userId,phoneE164:c.phoneE164,displayName:c.displayName,purpose:draft.purpose,consentConfirmed:draft.newRecipient.consentConfirmed}):binding(c);}
 private consent(contact:PhoneContact){if(contact.consent.callingAllowed!==true||Date.parse(contact.consent.expiresAt)<=this.now())throw deny();}
 private async approved(scope:AuthenticatedScope,approvalId:string){
  await this.scope(scope);if(!/^[0-9a-f-]{36}$/i.test(approvalId))throw deny();
  const a=await this.options.store.approval(scope,approvalId);
  if(!a||!Number.isFinite(Date.parse(a.expiresAt))||Date.parse(a.expiresAt)<=this.now()||!Value.Check(PhoneCallingDraftSchema,a.actionParams))throw deny();
  const draft=structuredClone(a.actionParams) as PhoneCallingDraft;
  if(draft.providerBindingHash!==this.live?.provider.configurationFingerprint)throw deny();
  if(this.live?.provider.enforcedMaxDurationSeconds!==undefined&&draft.maxDurationSeconds!==this.live.provider.enforcedMaxDurationSeconds)throw deny();
  if(!this.policy.evaluate(scope,{actionName:PHONE_AI_CALL_ACTION,parameters:draft,idempotencyKey:draft.idempotencyKey},a,scope.userId).allowed)throw deny();
  const c=await this.draftContact(scope,draft,a.expiresAt);
  if(!c||c.revision!==draft.contactRevision||this.draftBinding(scope,c,draft)!==draft.contactBindingHash||draft.aiDisclosure!==buildAiDisclosure(draft.language,draft.onBehalfOf)||(draft.onBehalfOf!==undefined&&safeOnBehalfOf(draft.onBehalfOf)!==draft.onBehalfOf)||draft.recipient.maskedPhone!==maskPhoneCallNumber(c.phoneE164))throw deny();
  this.consent(c);return {draft,contact:c};
 }
 /**
  * One-tap "Call now" from Chat. The owner's click on a card showing the exact person, masked number, purpose and AI
  * introduction is the approval for that one call. Before approving, the pending request is re-checked against the current
  * contact and consent; placeCall then re-runs the full policy check and still dials at most once.
  */
 async confirmAndPlaceCall(scope:AuthenticatedScope,approvalId:string):Promise<PhoneCallingRecord>{
  if(!this.live)throw new AppError('Real phone calling is not enabled. No call was made.','PHONE_CALLING_DISABLED',503);
  if(!this.options.store.confirmOwnRequest)throw deny();
  await this.scope(scope);if(!/^[0-9a-f-]{36}$/i.test(approvalId))throw deny();
  const a=await this.options.store.approval(scope,approvalId);
  if(scope.role!=='owner'||!a||a.requesterUserId!==scope.userId||a.actionName!==PHONE_AI_CALL_ACTION||!['pending','approved'].includes(a.status)||!Number.isFinite(Date.parse(a.expiresAt))||Date.parse(a.expiresAt)<=this.now()||!Value.Check(PhoneCallingDraftSchema,a.actionParams))throw deny();
  const draft=structuredClone(a.actionParams) as PhoneCallingDraft;
  if(draft.providerBindingHash!==this.live?.provider.configurationFingerprint)throw deny();
  if(this.live?.provider.enforcedMaxDurationSeconds!==undefined&&draft.maxDurationSeconds!==this.live.provider.enforcedMaxDurationSeconds)throw deny();
  if(!this.policy.evaluate(scope,{actionName:PHONE_AI_CALL_ACTION,parameters:draft,idempotencyKey:draft.idempotencyKey},{...a,status:'approved',approverUserId:scope.userId},scope.userId).allowed)throw deny();
  const c=await this.draftContact(scope,draft,a.expiresAt);
  if(draft.mode!=='live'||!c||c.revision!==draft.contactRevision||this.draftBinding(scope,c,draft)!==draft.contactBindingHash||draft.aiDisclosure!==buildAiDisclosure(draft.language,draft.onBehalfOf))throw deny();
  this.consent(c);
  await this.options.store.confirmOwnRequest(scope,approvalId);
  return this.placeCall(scope,approvalId);
 }
 async simulate(scope:AuthenticatedScope,approvalId:string):Promise<PhoneCallingRecord>{
  if(!this.options.simulation)throw new AppError('Real calling is disabled; simulation is test-only.','PHONE_CALLING_DISABLED',503);
  return this.locked(this.key(scope),async()=>{
   const {draft}=await this.approved(scope,approvalId);
   if(draft.mode!=='simulation')throw deny();
   const now=new Date(this.now()).toISOString();
   const record:PhoneCallingRecord={id:randomUUID(),approvalId,draft,state:'queued',createdAt:now,updatedAt:now,providerCallId:null,verified:false,simulated:true,report:new PhoneConversation(draft.language,draft.purpose,draft.maxDurationSeconds).report('queued')};
   // The ledger enforces one call per approval; a replay returns the same call only for an identical draft.
   return this.calls.claim(scope,record,computeCanonicalParameterHash(draft));
  });
 }
 /**
  * Places ONE real call for an approved live draft. Claim (one per approval) -> outbox claim (once) -> single provider request.
  * A replay returns the existing call and never dials again. `unknown` provider outcomes are recorded, never retried.
  */
 async placeCall(scope:AuthenticatedScope,approvalId:string):Promise<PhoneCallingRecord>{
  const live=this.live;
  if(!live)throw new AppError('Real phone calling is not enabled. No call was made.','PHONE_CALLING_DISABLED',503);
  return this.locked(this.key(scope),async()=>{
   const {draft,contact}=await this.approved(scope,approvalId);
   if(draft.mode!=='live')throw deny();
   const now=new Date(this.now()).toISOString();
   const queued:PhoneCallingRecord={id:randomUUID(),approvalId,draft,state:'queued',createdAt:now,updatedAt:now,providerCallId:null,verified:false,simulated:false,report:liveCallReport('queued','Waiting to be placed.')};
   const unlimitedFromEnv=/^unlimited$/i.test((process.env.THAARA_PHONE_DAILY_CALL_LIMIT??'').trim());
   const claimOptions=live.unlimitedDailyCalls||(live.dailyCallLimit===undefined&&unlimitedFromEnv)?{}:{dailyLiveLimit:live.dailyCallLimit??DEFAULT_DAILY_CALL_LIMIT};
   const call=await this.calls.claim(scope,queued,computeCanonicalParameterHash(draft),claimOptions);
   const claimed=await live.store.claimDispatch(scope,call.id);
   if(!claimed)return call;
   let outcome:Awaited<ReturnType<PhoneCallProvider['dispatch']>>|undefined;
   try{await live.store.bindCallbackNumber?.(scope,call.id,contact.phoneE164,computeCanonicalParameterHash(draft));}
   catch{outcome={status:'failed',code:'PHONE_CALLBACK_NUMBER_BINDING_FAILED'};}
   // The number is read from the owner's contact (re-verified above against the approved fingerprint), never from the draft or browser.
   if(!outcome)outcome=await live.provider.dispatch({callId:call.id,to:contact.phoneE164,recipientName:draft.recipient.displayName,maxDurationSeconds:draft.maxDurationSeconds,purpose:draft.purpose,language:draft.language,aiDisclosure:draft.aiDisclosure});
   const result=outcome.status==='unverified'?outcome:outcome.status==='not_configured'?{status:'failed' as const,code:'PHONE_PROVIDER_NOT_CONFIGURED'}:outcome;
   const recorded=await live.store.recordDispatch(scope,call.id,result);
   if(result.status!=='failed')return recorded;
   const entry=await this.calls.load(scope,call.id);if(!entry)throw deny();
   const failed={...entry.record,state:'failed' as const,report:liveCallReport('failed',result.code==='PHONE_CALLBACK_NUMBER_BINDING_FAILED'
    ?'The callback number could not be saved. No call was placed.':'The provider refused the request. No call was placed.'),updatedAt:new Date(this.now()).toISOString()};
   const event={eventId:'dispatch-failed',sequence:entry.sequence+1,kind:'state' as const,state:'failed' as const};
   return this.calls.append(scope,entry,event,computeCanonicalParameterHash(event),failed);
  });
 }
 /** Open requests not yet used for a call. Drafts are re-validated; anything malformed is left out, never repaired. */
 async requests(scope:AuthenticatedScope){
  await this.scope(scope);
  const open=await this.options.store.openRequests?.(scope)??[];
  const used=new Set((await this.calls.list(scope)).map(c=>c.approvalId));
  const requests=open.filter(r=>!used.has(r.approvalId)&&Value.Check(PhoneCallingDraftSchema,r.draft)&&/^[0-9a-f-]{36}$/i.test(r.approvalId))
   .slice(0,20).map(r=>({approvalId:r.approvalId,status:r.status,expiresAt:r.expiresAt,draft:structuredClone(r.draft) as PhoneCallingDraft}));
  return {requests};
 }
 /** Owner-only: the spoken report for one of their calls, in Thaara's voice. 503 when no voice is configured. */
 async reportSpeech(scope:AuthenticatedScope,callId:string):Promise<Uint8Array>{
  if(!this.options.reportVoice)throw new AppError("Thaara's report voice is not configured.",'PHONE_REPORT_VOICE_NOT_CONFIGURED',503);
  await this.scope(scope);
  if(!this.policy.evaluate(scope,{actionName:PHONE_REPORT_SPEECH_ACTION,parameters:{callId}}).allowed)throw deny();
  const call=(await this.calls.list(scope)).find(c=>c.id===callId);if(!call)throw deny();
  if(transitions[call.state].length!==0)throw deny();
  await this.options.store.audit(scope,'phone.ai.report_speech_requested',{callId:call.id,simulated:call.simulated});
  await this.scope(scope);
  try{return await this.options.reportVoice.speak(spokenCallReport(call),'en-IN',AbortSignal.timeout(15000));}
  catch{throw new AppError("Thaara's voice is unavailable right now. The written report is unchanged.",'PHONE_REPORT_VOICE_FAILED',502);}
 }
 async history(scope:AuthenticatedScope){await this.scope(scope);return {calls:await this.calls.list(scope),durable:this.calls.durable,liveCallingEnabled:!!this.live};}
 /** Explicit owner readback of the stored attempt. Never dials or overwrites the callback ledger. */
 async providerResult(scope:AuthenticatedScope,callId:string):Promise<PhoneCallingProviderResult>{
  await this.scope(scope);
  if(!this.policy.evaluate(scope,{actionName:PHONE_CALL_RESULT_READ_ACTION,parameters:{callId}}).allowed)throw deny();
  const read=this.live?.provider.readResult;
  if(!read)throw new AppError('Provider result reading is not configured.','PHONE_RESULTS_NOT_CONFIGURED',503);
  const entry=await this.calls.load(scope,callId);
  if(!entry||entry.record.simulated||entry.record.draft.providerBindingHash!==this.live?.provider.configurationFingerprint)throw deny();
  const empty={callId,status:'unavailable' as const,responses:[],verified:false as const,source:'provider_api' as const};
  if(!entry.providerRequestId||entry.record.dispatchStatus!=='unverified')return empty;
  await this.options.store.audit(scope,'phone.ai.provider_result_requested',{callId});await this.scope(scope);
  const result=await read({attemptId:entry.providerRequestId,createdAt:entry.record.createdAt});
  await this.scope(scope);
  return {...result,callId,verified:false,source:'provider_api'};
 }
 async simulationEvent(scope:AuthenticatedScope,callId:string,event:PhoneSimulationEvent):Promise<PhoneCallingRecord>{
  if(!this.options.simulation)throw deny();
  return this.locked(this.key(scope),async()=>{
   await this.scope(scope);
   const old=typeof callId==='string'?await this.calls.load(scope,callId):null;if(!old||!old.record.simulated)throw deny();
   const e=structuredClone(event);
   if(!/^[a-zA-Z0-9_-]{1,128}$/.test(e.eventId)||!Number.isSafeInteger(e.sequence)||!['state','recipient_final','interruption'].includes(e.kind)||Object.keys(e).some(k=>!['eventId','sequence','kind','state','text'].includes(k)))throw deny();
   const hash=computeCanonicalParameterHash(e),previous=old.events.get(e.eventId);
   if(previous){if(previous!==hash)throw deny();return structuredClone(old.record);}
   if(e.sequence!==old.sequence+1||old.events.size>=100||transitions[old.record.state].length===0)throw deny();
   const next=cloneEntry(old);
   if(e.kind==='state'){
    if(!e.state||e.text!==undefined||!transitions[old.record.state].includes(e.state))throw deny();next.record.state=e.state;
   }else{
    if(old.record.state!=='answered'||e.state!==undefined)throw deny();
    if(e.kind==='interruption'){if(e.text!==undefined)throw deny();}
    else{if(typeof e.text!=='string')throw deny();const conversation=new PhoneConversation(next.record.draft.language,next.record.draft.purpose,next.record.draft.maxDurationSeconds);for(const t of next.turns)conversation.receive({...t,final:true});conversation.receive({id:e.eventId,text:e.text,final:true});next.turns.push({id:e.eventId,text:e.text});}
   }
   const conv=new PhoneConversation(next.record.draft.language,next.record.draft.purpose,next.record.draft.maxDurationSeconds);for(const t of next.turns)conv.receive({...t,final:true});
   next.record.report=conv.report(next.record.state);next.record.updatedAt=new Date(this.now()).toISOString();
   return this.calls.append(scope,old,e,hash,next.record);
  });
 }
}

/**
 * The sentence Thaara speaks to the owner about a call, built only from the stored report: the person's quoted words, or the
 * plain outcome. Never an interpretation or an inferred agreement.
 */
export function spokenCallReport(record:PhoneCallingRecord):string{
 const name=record.draft.recipient.displayName,quotes=record.report.quotedResponses;
 const rendered=/rendered in English by the call provider/.test(record.report.text);
 const prefix=record.simulated?'This was a test simulation. ':'Provider report is unverified. ';
 switch(record.state){
  case 'completed':return prefix+(quotes.length?`${name} said: ${quotes.join(' ')}${rendered?' This is the call service\'s English version of what was said.':''}`:`The call with ${name} ended, but no answer was recorded.`);
  case 'no_answer':return `${prefix}${name} did not answer.`;
  case 'busy':return `${prefix}${name}'s line was busy.`;
  case 'failed':return `${prefix}The call to ${name} could not be completed.`;
  case 'cancelled':return `${prefix}The call to ${name} was cancelled.`;
  default:return `${prefix}The call to ${name} is still in progress.`;
 }
}
