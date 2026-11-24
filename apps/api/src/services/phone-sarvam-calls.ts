import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import type {PhoneCallingLanguage,PhoneCallingState} from '@thaara/contracts';
import {capturePhoneCallEvidence,type PhoneCallEvidence,isPhoneProviderCallId} from '@thaara/contracts';
import type {PhoneCallProvider,PhoneDispatchOutcome} from './phone-plivo.js';
import {createSarvamResultReader} from './phone-sarvam-results.js';
import {parseSarvamKnowledgeBinding,type SarvamKnowledgeBinding} from './phone-sarvam-knowledge-binding.js';

/**
 * Sarvam Voice Agents as the calling provider (owner decision, 29 Oct 2026). Sarvam dials from the owner's Sarvam number and
 * runs the conversation with the owner-configured agent; Thaara keeps contacts, consent, approval, one call per approval and
 * the report. Wire shapes from docs.sarvam.ai (read 29 Oct 2026):
 *  POST https://apps.sarvam.ai/api/outbounds/v1/orgs/{org_id}/workspaces/{workspace_id}/outbounds, header X-API-Key,
 *  body {app_config:{app_id,app_version,connection_config:{connection_id,agent_phone_number},agent_variables,app_overrides},
 *  user_config:{user_phone_number}, webhook_config:{url,metadata}} -> 200 {attempt_id}.
 *  Webhook {attempt_id,status:'connected'|'no_answer'|'busy'|'failed',interaction_id,duration,failure_reason,
 *  interaction_transcript:[{role:'agent'|'user',en_text}],webhook_config:{url,metadata}}.
 * Sarvam documents NO webhook signature. Each call therefore gets its own unguessable webhook path (HMAC of the call id with a
 * server-only secret), the attempt id must match what we dispatched, and results are always labelled unverified.
 */
export interface SarvamCallSecrets{apiKey:string;webhookSecret:string}
export interface SarvamCallProviderOptions{
 /** Must be literally true to touch the network. Nothing in the default application sets it. */
 liveCallingEnabled:boolean;
 secrets:{resolve():Promise<SarvamCallSecrets>};
 orgId:string;workspaceId:string;appId:string;appVersion:number;connectionId:string;
 /** Exact provider-side cap for this pinned agent version, confirmed during setup; never a prompt variable. */
 enforcedMaxDurationSeconds:number;
 /** The owner's Sarvam number in E.164 (+91...). */
 agentPhoneNumber:string;
 callbackOrigin:string;
 fetch:typeof fetch;
 timeoutMs?:number;
 /** Optional reviewed shared-knowledge rollout. Absent preserves the existing version-only profile; invalid/present is refused. */
 companyKnowledge?:SarvamKnowledgeBinding;
}
const SAFE_ID=/^[A-Za-z0-9_.:-]{1,128}$/;
const LANGUAGE_NAME:Record<PhoneCallingLanguage,string>={'en-IN':'English','kn-IN':'Kannada','kn-en':'Kannada'};
const MAX_RESPONSE_CHARS=8192;

export function sarvamWebhookToken(webhookSecret:string,callId:string){return createHmac('sha256',webhookSecret).update('thaara-sarvam-webhook:'+callId).digest('hex');}
export function sarvamWebhookUrl(callbackOrigin:string,callId:string,token:string){return `${new URL(callbackOrigin).origin}/api/v1/connectors/phone/sarvam/calls/${callId}/${token}`;}

function checkOptions(o:SarvamCallProviderOptions){
 const origin=new URL(o.callbackOrigin);
 if(![o.orgId,o.workspaceId,o.appId,o.connectionId].every(v=>typeof v==='string'&&SAFE_ID.test(v))||!Number.isSafeInteger(o.appVersion)||o.appVersion<0
  ||!Number.isSafeInteger(o.enforcedMaxDurationSeconds)||o.enforcedMaxDurationSeconds<30||o.enforcedMaxDurationSeconds>300
  ||!/^\+91[6-9][0-9]{9}$/.test(o.agentPhoneNumber)||origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.username||origin.password
  ||/\.(localhost|local|internal)$/.test(origin.hostname))throw new Error('Sarvam calling configuration denied');
}

export function createSarvamCallProvider(o:SarvamCallProviderOptions):PhoneCallProvider{
 checkOptions(o);
 const timeoutMs=Math.min(Math.max(o.timeoutMs??10000,1000),15000);
 const companyKnowledge=Object.prototype.hasOwnProperty.call(o,'companyKnowledge')?
  parseSarvamKnowledgeBinding(o.companyKnowledge,o.appVersion,o.enforcedMaxDurationSeconds):undefined;
 // Fingerprint and dispatch must use the SAME detached configuration even across asynchronous credential reads.
 // Pin function identities, but still call the original resolver on every use so private-file rotation remains supported.
 o=Object.freeze({...o,secrets:Object.freeze({resolve:o.secrets.resolve.bind(o.secrets)}),
  ...(companyKnowledge?{companyKnowledge}:{})});
 const configurationParts:unknown[]=[o.orgId,o.workspaceId,o.appId,o.appVersion,o.connectionId,o.agentPhoneNumber,o.enforcedMaxDurationSeconds,'call_purpose:user_name:recipient:v1'];
 if(companyKnowledge)configurationParts.push('company-knowledge:v1',companyKnowledge);
 const configurationFingerprint=createHash('sha256').update(JSON.stringify(configurationParts)).digest('hex');
 return {name:'sarvam',configurationFingerprint,enforcedMaxDurationSeconds:o.enforcedMaxDurationSeconds,liveCallingEnabled:o.liveCallingEnabled===true,
  readResult:createSarvamResultReader({...o,enabled:o.liveCallingEnabled===true,credentials:{resolve:()=>o.secrets.resolve()}}),
  async dispatch(request):Promise<PhoneDispatchOutcome>{
  if(o.liveCallingEnabled!==true)return {status:'not_configured'};
  let secrets:SarvamCallSecrets;
  try{secrets=await o.secrets.resolve();}catch{return {status:'not_configured'};}
  if(!secrets||typeof secrets.apiKey!=='string'||secrets.apiKey.length<8||typeof secrets.webhookSecret!=='string'||secrets.webhookSecret.length<32)return {status:'not_configured'};
  if(!/^[0-9a-f-]{36}$/i.test(request.callId)||!/^\+91[6-9][0-9]{9}$/.test(request.to)||request.to===o.agentPhoneNumber||request.maxDurationSeconds!==o.enforcedMaxDurationSeconds
   ||!request.language||!request.aiDisclosure||!request.purpose||request.purpose.length>1000||request.aiDisclosure.length>300
   ||typeof request.recipientName!=='string'||!request.recipientName.trim()||request.recipientName.length>128)return {status:'failed',code:'PHONE_DISPATCH_INPUT'};
  const body={
   app_config:{app_id:o.appId,app_version:o.appVersion,connection_config:{connection_id:o.connectionId,agent_phone_number:o.agentPhoneNumber},
    // The agent's first line is always Thaara's approved AI disclosure; the approved purpose is the only task it is given.
    agent_variables:{call_purpose:request.purpose,user_name:request.recipientName},
    app_overrides:{initial_bot_message:request.aiDisclosure,initial_language_name:LANGUAGE_NAME[request.language]}},
   user_config:{user_phone_number:request.to},
   webhook_config:{url:sarvamWebhookUrl(o.callbackOrigin,request.callId,sarvamWebhookToken(secrets.webhookSecret,request.callId)),metadata:{thaara_call_id:request.callId}}
  };
  let res:Response;
  try{
   res=await o.fetch(`https://apps.sarvam.ai/api/outbounds/v1/orgs/${encodeURIComponent(o.orgId)}/workspaces/${encodeURIComponent(o.workspaceId)}/outbounds`,
    {method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{'X-API-Key':secrets.apiKey,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body)});
  }catch{return {status:'unknown',code:'PHONE_DISPATCH_NETWORK'};}
  let text='';try{text=await res.text();}catch{return {status:'unknown',code:'PHONE_DISPATCH_RESPONSE'};}
  if(text.length>MAX_RESPONSE_CHARS)return {status:'unknown',code:'PHONE_DISPATCH_RESPONSE'};
  if(res.status>=500)return {status:'unknown',code:`PHONE_DISPATCH_HTTP_${res.status}`};
  if(res.status<200||res.status>=300)return {status:'failed',code:`PHONE_DISPATCH_HTTP_${res.status}`};
  let parsed:unknown;try{parsed=JSON.parse(text);}catch{return {status:'unknown',code:'PHONE_DISPATCH_RESPONSE'};}
  const id=(parsed as {attempt_id?:unknown})?.attempt_id;
  if(typeof id!=='string'||!SAFE_ID.test(id))return {status:'unknown',code:'PHONE_DISPATCH_RESPONSE'};
  return {status:'unverified',providerRequestId:id};
 }};
}

export type SarvamWebhookDecision=
 {status:'accepted';callId:string;providerRequestId:string;providerCallId:string;states:PhoneCallingState[];recipientLines:{eventId:string;text:string}[];conversation:PhoneCallEvidence;eventIdBase:string}|
 {status:'rejected';reason:string}|{status:'not_configured'};

const STATES:Record<string,PhoneCallingState[]>={connected:['ringing','answered','completed'],no_answer:['ringing','no_answer'],busy:['ringing','busy'],failed:['failed']};

/** Checks the per-call capability token, the payload shape and the dispatch binding. Never trusts the payload for identity. */
export async function admitSarvamWebhook(input:{callId:string;token:string;body:unknown},options:{webhookSecret?:()=>Promise<string>;binding(callId:string):Promise<{providerRequestId:string}|null>}):Promise<SarvamWebhookDecision>{
 if(!options.webhookSecret)return {status:'not_configured'};
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.callId)||!/^[a-f0-9]{64}$/.test(input.token))return {status:'rejected',reason:'route'};
 let secret:string;try{secret=await options.webhookSecret();}catch{return {status:'not_configured'};}
 if(typeof secret!=='string'||secret.length<32)return {status:'not_configured'};
 const expected=Buffer.from(sarvamWebhookToken(secret,input.callId),'hex'),given=Buffer.from(input.token,'hex');
 if(expected.length!==given.length||!timingSafeEqual(expected,given))return {status:'rejected',reason:'token'};
 const b=input.body as Record<string,unknown>|null;
 if(!b||typeof b!=='object'||Array.isArray(b))return {status:'rejected',reason:'shape'};
 const attempt=b.attempt_id,status=b.status,interaction=b.interaction_id,meta=(b.webhook_config as {metadata?:Record<string,unknown>}|null|undefined)?.metadata;
 if(typeof attempt!=='string'||!SAFE_ID.test(attempt)||typeof status!=='string'||!STATES[status]||(interaction!=null&&!isPhoneProviderCallId(interaction))
  ||meta?.thaara_call_id!==input.callId)return {status:'rejected',reason:'shape'};
 const bound=await options.binding(input.callId);
 if(!bound||bound.providerRequestId!==attempt)return {status:'rejected',reason:'binding'};
 const transcript=Array.isArray(b.interaction_transcript)?b.interaction_transcript.slice(0,200):[];
 const base='sarvam-'+createHash('sha256').update(attempt).digest('hex').slice(0,20);
 // Only the recipient's turns are evidence; the agent's own lines are never quoted as what the person said.
 const recipientLines=status==='connected'?transcript.flatMap((t,i)=>{
  const turn=t as {role?:unknown;en_text?:unknown};
  if(turn?.role!=='user'||typeof turn.en_text!=='string'||!turn.en_text.trim())return [];
  return [{eventId:`${base}-u${i}`,text:turn.en_text.trim().slice(0,1000)}];
 }).slice(0,12):[];
 return {status:'accepted',callId:input.callId,providerRequestId:bound.providerRequestId,providerCallId:typeof interaction==='string'?interaction:attempt,states:STATES[status]!,recipientLines,conversation:capturePhoneCallEvidence(transcript.map(t=>{const v=t as {role?:unknown;en_text?:unknown};return {role:v?.role==='agent'?'assistant':v?.role,text:v?.en_text};}),'provider_english_translation'),eventIdBase:base};
}
