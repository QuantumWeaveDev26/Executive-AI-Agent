import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import type {SarvamCallProviderOptions,SarvamCallSecrets} from './phone-sarvam-calls.js';
import {parseSarvamKnowledgeBinding,type SarvamKnowledgeBinding} from './phone-sarvam-knowledge-binding.js';

/**
 * Secure runtime loading for Sarvam outbound calling (Step 110; called only from phone-pilot-startup.ts).
 *
 * Non-secret identifiers come from a reviewed profile file; the API key and webhook secret come from separate private files that
 * are re-read on use (so rotation needs no restart) and never enter logs, errors, reports or the repository. Live calling stays
 * off unless THAARA_PHONE_LIVE_CALLING=approved AND every check passes. Results carry reason codes only, never values.
 */
export type SarvamRuntimeReason=
 |'live_switch_off'|'profile_file_missing'|'profile_unreadable'|'profile_invalid'|'profile_not_runtime'|'duration_not_verified'
 |'duration_mismatch'|'variable_mapping_mismatch'|'api_key_file_missing'|'api_key_invalid'|'webhook_secret_file_missing'
 |'webhook_secret_invalid'|'secret_file_permissions'|'secret_file_not_absolute'|'callback_origin_invalid'|'daily_limit_invalid'|'knowledge_binding_invalid';

export interface SarvamRuntimeProfile{
 orgId:string;workspaceId:string;appId:string;appVersion:number;connectionId:string;agentPhoneNumber:string;
 maxCallLengthMinutes:number;fingerprint:string;companyKnowledge?:SarvamKnowledgeBinding;
}
export type SarvamRuntimeLoad=
 {status:'off';reasons:['live_switch_off']}|
 {status:'refused';reasons:SarvamRuntimeReason[]}|
 {status:'ready';profile:SarvamRuntimeProfile;dailyCallLimit:number|undefined;callbackOrigin:string;
  providerOptions:Omit<SarvamCallProviderOptions,'fetch'|'liveCallingEnabled'>;webhookSecret:()=>Promise<string>};

/** File access is injected so the loader is testable without touching the real filesystem. */
export interface SarvamRuntimeFiles{
 readText(path:string):Promise<string>;
 /** Verified POSIX mode bits; null means unverified and is refused for live credentials. */
 mode(path:string):Promise<number|null>;
}

const SAFE_ID=/^[A-Za-z0-9_.:-]{1,128}$/;
const EXPECTED_MAPPING={call_purpose:'approvedDraft.purpose',user_name:'approvedDraft.recipient.displayName'};
const MAX_SECRET_FILE_CHARS=4096;
const isAbsolute=(p:string)=>p.startsWith('/')||/^[A-Za-z]:[\\/]/.test(p);

/** Validates the non-secret profile. A review-only profile, or one whose provider-side duration is unverified, is refused. */
export function parseSarvamRuntimeProfile(raw:unknown):{profile:SarvamRuntimeProfile}|{reasons:SarvamRuntimeReason[]}{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return {reasons:['profile_invalid']};
 const p=raw as Record<string,unknown>,reasons:SarvamRuntimeReason[]=[];
 const ids=[p.orgId,p.workspaceId,p.appId,p.connectionId];
 if(!ids.every(v=>typeof v==='string'&&SAFE_ID.test(v))||!Number.isSafeInteger(p.appVersion)||(p.appVersion as number)<1
  ||typeof p.agentPhoneNumber!=='string'||!/^\+91[6-9][0-9]{9}$/.test(p.agentPhoneNumber))reasons.push('profile_invalid');
 if(p.reviewOnly!==false||p.runtimeProfile!==true)reasons.push('profile_not_runtime');
 const required=p.requiredMaxCallLengthMinutes,verified=p.verifiedMaxCallLengthMinutes;
 if(!Number.isSafeInteger(required)||(required as number)<1||(required as number)>60)reasons.push('profile_invalid');
 else if(verified===null||verified===undefined)reasons.push('duration_not_verified');
 else if(verified!==required)reasons.push('duration_mismatch');
 const m=p.variableMapping as Record<string,unknown>|undefined;
 if(!m||typeof m!=='object'||Object.keys(m).sort().join()!==Object.keys(EXPECTED_MAPPING).sort().join()
  ||Object.entries(EXPECTED_MAPPING).some(([k,v])=>m[k]!==v))reasons.push('variable_mapping_mismatch');
 let companyKnowledge:SarvamKnowledgeBinding|undefined;
 if(Object.prototype.hasOwnProperty.call(p,'companyKnowledge')){
  try{companyKnowledge=parseSarvamKnowledgeBinding(p.companyKnowledge,p.appVersion as number,(required as number)*60);}
  catch{reasons.push('knowledge_binding_invalid');}
 }
 if(reasons.length)return {reasons:[...new Set(reasons)]};
 const core={orgId:p.orgId,workspaceId:p.workspaceId,appId:p.appId,appVersion:p.appVersion,connectionId:p.connectionId,agentPhoneNumber:p.agentPhoneNumber,maxCallLengthMinutes:required,variableMapping:EXPECTED_MAPPING,
  ...(companyKnowledge?{companyKnowledge}:{})};
 return {profile:{orgId:p.orgId as string,workspaceId:p.workspaceId as string,appId:p.appId as string,appVersion:p.appVersion as number,
  connectionId:p.connectionId as string,agentPhoneNumber:p.agentPhoneNumber as string,maxCallLengthMinutes:required as number,
  fingerprint:createHash('sha256').update(JSON.stringify(core)).digest('hex'),...(companyKnowledge?{companyKnowledge}:{})}};
}

async function readSecret(files:SarvamRuntimeFiles,path:string|undefined,missing:SarvamRuntimeReason,invalid:SarvamRuntimeReason,minLength:number):Promise<{value?:string;reasons:SarvamRuntimeReason[]}>{
 if(!path)return {reasons:[missing]};
 if(!isAbsolute(path))return {reasons:['secret_file_not_absolute']};
 let mode:number|null;
 try{mode=await files.mode(path);}catch{return {reasons:[missing]};}
 // Only verified 0400/0600 is admissible. Unknown metadata must not become a live-mode bypass.
 if(!Number.isSafeInteger(mode)||mode===null||mode<0||mode>0o177777
  ||!([0o400,0o600].includes(mode&0o7777)))return {reasons:['secret_file_permissions']};
 let text:string;
 try{text=await files.readText(path);}catch{return {reasons:[missing]};}
 const value=text.trim();
 if(text.length>MAX_SECRET_FILE_CHARS||value.length<minLength||/\s/.test(value))return {reasons:[invalid]};
 return {value,reasons:[]};
}

export async function loadSarvamRuntime(env:Record<string,string|undefined>,files:SarvamRuntimeFiles):Promise<SarvamRuntimeLoad>{
 if(env.THAARA_PHONE_LIVE_CALLING!=='approved')return {status:'off',reasons:['live_switch_off']};
 const reasons:SarvamRuntimeReason[]=[];
 let profile:SarvamRuntimeProfile|undefined;
 const profilePath=env.THAARA_SARVAM_PROFILE_FILE;
 if(!profilePath)reasons.push('profile_file_missing');
 else{
  let raw:unknown;
  try{raw=JSON.parse(await files.readText(profilePath));}catch{reasons.push('profile_unreadable');}
  if(raw!==undefined){const parsed=parseSarvamRuntimeProfile(raw);if('profile' in parsed)profile=parsed.profile;else reasons.push(...parsed.reasons);}
 }
 const key=await readSecret(files,env.THAARA_SARVAM_API_KEY_FILE,'api_key_file_missing','api_key_invalid',8);
 const hook=await readSecret(files,env.THAARA_SARVAM_WEBHOOK_SECRET_FILE,'webhook_secret_file_missing','webhook_secret_invalid',32);
 reasons.push(...key.reasons,...hook.reasons);
 let callbackOrigin='';
 try{
  const u=new URL(env.THAARA_PHONE_CALLBACK_ORIGIN??'');
  const host=u.hostname.toLowerCase().replace(/\.$/,'');
  // Require DNS names rather than literals/local aliases; no lookup or provider call occurs here.
  if(u.protocol!=='https:'||u.pathname!=='/'||u.search||u.hash||u.username||u.password||u.port
   ||isIP(host.replace(/^\[|\]$/g,''))!==0||!host.includes('.')
   ||/(^|\.)(localhost|local|internal|localdomain|lan|home|arpa)$/.test(host))throw 0;
  callbackOrigin=u.origin;
 }catch{reasons.push('callback_origin_invalid');}
 const limitText=(env.THAARA_PHONE_DAILY_CALL_LIMIT??'5').trim();
 const isUnlimited=/^unlimited$/i.test(limitText);
 const dailyCallLimit=isUnlimited?undefined:Number(limitText);
 if(!isUnlimited&&(!/^\d{1,5}$/.test(limitText)||!Number.isSafeInteger(dailyCallLimit)||dailyCallLimit!<1||dailyCallLimit!>10000))reasons.push('daily_limit_invalid');
 if(reasons.length||!profile)return {status:'refused',reasons:[...new Set(reasons)]};
 const apiKeyPath=env.THAARA_SARVAM_API_KEY_FILE!,hookPath=env.THAARA_SARVAM_WEBHOOK_SECRET_FILE!;
 // Secrets are re-read and re-validated on every use; a missing/changed-to-invalid file fails closed.
 const fresh=async():Promise<SarvamCallSecrets>=>{
  const [k,h]=await Promise.all([readSecret(files,apiKeyPath,'api_key_file_missing','api_key_invalid',8),readSecret(files,hookPath,'webhook_secret_file_missing','webhook_secret_invalid',32)]);
  if(!k.value||!h.value)throw new Error('Sarvam secrets unavailable');
  return {apiKey:k.value,webhookSecret:h.value};
 };
 return {status:'ready',profile,dailyCallLimit,callbackOrigin,webhookSecret:async()=>(await fresh()).webhookSecret,
  providerOptions:{secrets:{resolve:fresh},orgId:profile.orgId,workspaceId:profile.workspaceId,appId:profile.appId,appVersion:profile.appVersion,
   connectionId:profile.connectionId,agentPhoneNumber:profile.agentPhoneNumber,enforcedMaxDurationSeconds:profile.maxCallLengthMinutes*60,callbackOrigin,
   ...(profile.companyKnowledge?{companyKnowledge:profile.companyKnowledge}:{})}};
}
