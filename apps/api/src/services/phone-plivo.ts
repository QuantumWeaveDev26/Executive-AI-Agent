import type {PhoneCallingLanguage} from '@thaara/contracts';
import type {PhoneProviderReadResult,PhoneProviderResultRequest} from './phone-sarvam-results.js';
/** Plivo wire adapter. Network access only through an injected fetch, credentials only through an injected resolver. */
export interface PlivoCallInput{authId:string;from:string;to:string;callbackOrigin:string;callId:string;maxDurationSeconds:number}
export const PLIVO_CALLBACK_HOOKS=['answer','ring','hangup'] as const;
export type PlivoCallbackHook=typeof PLIVO_CALLBACK_HOOKS[number];
export function plivoCallbackUrl(callbackOrigin:string,callId:string,hook:PlivoCallbackHook){return `${new URL(callbackOrigin).origin}/api/v1/connectors/phone/plivo/calls/${callId}/${hook}`;}
export function buildPlivoCallRequest(input:PlivoCallInput){
 const {authId,from,to,callId,maxDurationSeconds}=input;
 const origin=new URL(input.callbackOrigin);
 if(!/^[A-Za-z0-9_]{8,64}$/.test(authId)||!/^\+91[6-9][0-9]{9}$/.test(from)||!/^\+91[6-9][0-9]{9}$/.test(to)||from===to||!/^[a-zA-Z0-9_-]{1,128}$/.test(callId)
 ||!Number.isSafeInteger(maxDurationSeconds)||maxDurationSeconds<30||maxDurationSeconds>300
 ||origin.protocol!=='https:'||origin.username||origin.password||origin.port||origin.search||origin.hash||origin.pathname!=='/'
 ||!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(origin.hostname)||origin.hostname.endsWith('.localhost')||origin.hostname.endsWith('.local')||origin.hostname.endsWith('.internal'))throw Error('Plivo configuration denied');
 const url=(hook:PlivoCallbackHook)=>plivoCallbackUrl(origin.origin,callId,hook);
 return {url:`https://api.plivo.com/v1/Account/${authId}/Call/`,method:'POST' as const,body:{from,to,answer_url:url('answer'),answer_method:'POST',ring_url:url('ring'),ring_method:'POST',hangup_url:url('hangup'),hangup_method:'POST',time_limit:maxDurationSeconds,hangup_on_ring:30}};
}
export const disabledPlivoAdapter={name:'plivo',liveCallingEnabled:false as const,async dispatch():Promise<never>{throw Error('Real phone calling is disabled; provider and execution admission are not configured');}};

/** Managed-secret resolver (deployment secret manager). Values never enter config, logs, errors or audit. */
export interface PhoneProviderCredentials{resolve():Promise<{authId:string;authToken:string}>}
/** Everything comes from the approved draft and the re-verified contact; nothing from the browser or the model. */
export interface PhoneDispatchRequest{callId:string;to:string;recipientName?:string;maxDurationSeconds:number;purpose?:string;language?:PhoneCallingLanguage;aiDisclosure?:string}
/**
 * A provider acknowledgement is not a call outcome. `unverified` means Plivo accepted the request; only verified callbacks
 * may advance the call. `unknown` (timeout/5xx/network) must not be retried automatically: the call may already be ringing.
 */
export type PhoneDispatchOutcome=
 {status:'unverified';providerRequestId:string}|
 {status:'failed';code:string}|
 {status:'unknown';code:string}|
 {status:'not_configured'};
export interface PhoneCallProvider{readonly name:string;readonly liveCallingEnabled:boolean;readonly configurationFingerprint?:string;readonly enforcedMaxDurationSeconds?:number;dispatch(request:PhoneDispatchRequest):Promise<PhoneDispatchOutcome>;readResult?(request:PhoneProviderResultRequest):Promise<PhoneProviderReadResult>}
export interface PlivoProviderOptions{
 /** Must be literally true to touch the network. Nothing in the default application sets it. */
 liveCallingEnabled:boolean;
 credentials:PhoneProviderCredentials;
 fromNumber:string;
 callbackOrigin:string;
 fetch:typeof fetch;
 timeoutMs?:number;
}
const MAX_RESPONSE_BYTES=8192;

export function createPlivoCallProvider(options:PlivoProviderOptions):PhoneCallProvider{
 const timeoutMs=Math.min(Math.max(options.timeoutMs??10000,1000),15000);
 return {name:'plivo',liveCallingEnabled:options.liveCallingEnabled===true,async dispatch(request){
  if(options.liveCallingEnabled!==true)return {status:'not_configured'};
  let creds:{authId:string;authToken:string};
  try{creds=await options.credentials.resolve();}catch{return {status:'not_configured'};}
  if(!creds||typeof creds.authToken!=='string'||creds.authToken.length<16||creds.authToken.length>256)return {status:'not_configured'};
  let wire:ReturnType<typeof buildPlivoCallRequest>;
  try{wire=buildPlivoCallRequest({authId:creds.authId,from:options.fromNumber,to:request.to,callbackOrigin:options.callbackOrigin,callId:request.callId,maxDurationSeconds:request.maxDurationSeconds});}
  catch{return {status:'failed',code:'PHONE_DISPATCH_INPUT'};}
  let res:Response;
  try{
   res=await options.fetch(wire.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),
    headers:{authorization:'Basic '+Buffer.from(`${creds.authId}:${creds.authToken}`).toString('base64'),'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify(wire.body)});
  }catch{return {status:'unknown',code:'PHONE_DISPATCH_NETWORK'};}
  const declared=Number(res.headers.get('content-length')??'0');
  if(declared>MAX_RESPONSE_BYTES)return {status:'unknown',code:'PHONE_DISPATCH_RESPONSE'};
  let text='';try{text=await res.text();}catch{return {status:'unknown',code:'PHONE_DISPATCH_RESPONSE'};}
  if(text.length>MAX_RESPONSE_BYTES)return {status:'unknown',code:'PHONE_DISPATCH_RESPONSE'};
  // Only the HTTP status and fixed codes leave this function; provider text can echo request details.
  if(res.status>=500)return {status:'unknown',code:`PHONE_DISPATCH_HTTP_${res.status}`};
  if(res.status<200||res.status>=300)return {status:'failed',code:`PHONE_DISPATCH_HTTP_${res.status}`};
  let body:unknown;try{body=JSON.parse(text);}catch{return {status:'unknown',code:'PHONE_DISPATCH_RESPONSE'};}
  const b=body as Record<string,unknown>;
  const id=b&&typeof b==='object'?(Array.isArray(b.request_uuid)?b.request_uuid[0]:b.request_uuid):undefined;
  if(b?.message!=='call fired'||typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)||(Array.isArray(b.request_uuid)&&b.request_uuid.length!==1))return {status:'unknown',code:'PHONE_DISPATCH_RESPONSE'};
  return {status:'unverified',providerRequestId:id.toLowerCase()};
 }};
}
