import {createHash} from 'node:crypto';
import type {PhoneCallingState} from '@thaara/contracts';
import {PLIVO_CALLBACK_HOOKS,plivoCallbackUrl,type PlivoCallbackHook} from './phone-plivo.js';

/**
 * Signature check delegated to the provider's official SDK (Plivo: `plivo.validateV3Signature(method, url, nonce,
 * authToken, signature, params)`). Plivo's prose description is ambiguous, so this project never hand-rolls it:
 * without an injected verifier every callback is refused as not configured.
 */
export type PhoneCallbackVerifier=(input:{method:'POST'|'GET';url:string;nonce:string;signature:string;params:Record<string,string>})=>boolean|Promise<boolean>;
/** Returns false when the nonce was already seen inside its TTL. Must be shared/durable across instances in production. */
export interface PhoneCallbackNonceStore{remember(nonce:string,ttlMs:number):Promise<boolean>}
/** The call a callback claims to be about, as bound at dispatch time. */
export interface PhoneCallbackBinding{callId:string;providerRequestId:string;providerCallId:string|null}
export interface PhoneCallbackBindings{find(callId:string):Promise<PhoneCallbackBinding|null>}
export interface PhoneCallbackRequest{method:string;hook:string;callId:string;url:string;headers:Record<string,string|string[]|undefined>;form:Record<string,unknown>}
export type PhoneCallbackAdmission=
 {status:'accepted';callId:string;hook:PlivoCallbackHook;state:PhoneCallingState;providerCallId:string;eventId:string}|
 {status:'rejected';reason:string}|
 {status:'not_configured'};

/**
 * Plivo CallStatus → Thaara state, per hook. Unlisted values are refused rather than guessed.
 * Must be confirmed against a real sandbox callback before go-live (documentation pages were incomplete on 29 Oct 2026).
 */
const STATUS:Record<PlivoCallbackHook,Record<string,PhoneCallingState>>={
 ring:{ringing:'ringing'},
 answer:{'in-progress':'answered'},
 hangup:{completed:'completed',busy:'busy','no-answer':'no_answer',timeout:'no_answer',failed:'failed',cancel:'cancelled'},
};
const NONCE_TTL_MS=10*60*1000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const header=(h:PhoneCallbackRequest['headers'],name:string)=>{const v=h[name]??h[name.toLowerCase()];return typeof v==='string'?v:undefined;};

export interface PhoneCallbackAdmissionOptions{callbackOrigin:string;verifier?:PhoneCallbackVerifier;nonces:PhoneCallbackNonceStore;bindings:PhoneCallbackBindings}

/** Order matters: cheap shape checks, pinned URL, provider signature, then nonce (only after a valid signature), then call binding. */
export function createPhoneCallbackAdmission(options:PhoneCallbackAdmissionOptions){
 const reject=(reason:string):PhoneCallbackAdmission=>({status:'rejected',reason});
 return async function admit(request:PhoneCallbackRequest):Promise<PhoneCallbackAdmission>{
  if(!options.verifier)return {status:'not_configured'};
  if(request.method!=='POST'||!(PLIVO_CALLBACK_HOOKS as readonly string[]).includes(request.hook)||!UUID.test(request.callId))return reject('route');
  const hook=request.hook as PlivoCallbackHook;
  const entries=Object.entries(request.form??{});
  if(entries.length>60||entries.some(([k,v])=>!/^[A-Za-z0-9_]{1,64}$/.test(k)||typeof v!=='string'||v.length>512))return reject('shape');
  const params=Object.fromEntries(entries) as Record<string,string>;
  if(request.url!==plivoCallbackUrl(options.callbackOrigin,request.callId,hook))return reject('url');
  const signature=header(request.headers,'x-plivo-signature-v3'),nonce=header(request.headers,'x-plivo-signature-v3-nonce');
  if(!signature||signature.length>2048||!nonce||!/^[A-Za-z0-9_-]{8,100}$/.test(nonce))return reject('signature');
  let valid=false;
  try{valid=(await options.verifier({method:'POST',url:request.url,nonce,signature,params}))===true;}catch{valid=false;}
  if(!valid)return reject('signature');
  if(!(await options.nonces.remember(nonce,NONCE_TTL_MS)))return reject('replay');
  const bound=await options.bindings.find(request.callId);
  const requestUuid=params.RequestUUID?.toLowerCase(),callUuid=params.CallUUID?.toLowerCase();
  if(!bound||!requestUuid||requestUuid!==bound.providerRequestId||!callUuid||!UUID.test(callUuid)||(bound.providerCallId!==null&&bound.providerCallId!==callUuid))return reject('binding');
  const state=STATUS[hook][params.CallStatus??''];
  if(!state)return reject('status');
  // Verified provider facts only: state and identifiers. Speech, transcripts and outcomes come from a later, separate path.
  return {status:'accepted',callId:request.callId,hook,state,providerCallId:callUuid,eventId:`plivo-${hook}-${nonce}`};
 };
}

/**
 * Shared nonce store on Redis `SET key 1 NX PX ttl` (atomic first-writer-wins across instances). Structural client types
 * so no Redis library is a dependency here; the deployment passes its own client. Nonces are hashed into the key.
 * Fails closed: if Redis is unreachable the callback is refused (the provider retries), never accepted unchecked.
 */
export type NodeRedisLike={set(key:string,value:string,options:{condition:'NX';expiration:{type:'PX';value:number}}):Promise<string|null>};
export type IoRedisLike={set(key:string,value:string,px:'PX',ttl:number,nx:'NX'):Promise<string|null>};
export function createRedisNonceStore(client:{kind:'node-redis';client:NodeRedisLike}|{kind:'ioredis';client:IoRedisLike},prefix='thaara:phone:callback-nonce:'):PhoneCallbackNonceStore{
 return {async remember(nonce,ttlMs){
  if(typeof nonce!=='string'||!nonce||nonce.length>256||!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>86_400_000)return false;
  const key=prefix+createHash('sha256').update(nonce).digest('hex');
  try{
   const result=client.kind==='node-redis'?await client.client.set(key,'1',{condition:'NX',expiration:{type:'PX',value:ttlMs}}):await client.client.set(key,'1','PX',ttlMs,'NX');
   return result==='OK';
  }catch{return false;}
 }};
}

/** Process-local nonce store for tests/single instance only. Production must use createRedisNonceStore. */
export function createMemoryNonceStore(now:()=>number=Date.now,max=10000):PhoneCallbackNonceStore{
 const seen=new Map<string,number>();
 return {async remember(nonce,ttlMs){
  const t=now();for(const [k,exp] of seen)if(exp<=t)seen.delete(k);
  if(seen.has(nonce))return false;
  if(seen.size>=max)return false;
  seen.set(nonce,t+ttlMs);return true;
 }};
}
