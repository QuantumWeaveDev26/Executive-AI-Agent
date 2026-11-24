import {lstat,readFile} from 'node:fs/promises';
import {createSarvamCallProvider} from './phone-sarvam-calls.js';
import {loadSarvamRuntime,type SarvamRuntimeFiles,type SarvamRuntimeReason} from './phone-sarvam-runtime.js';
import type {PhoneCallProvider} from './phone-plivo.js';

/**
 * Startup wiring for the persistent phone schema and Sarvam live calling (Step 110).
 *
 * Off unless explicitly enabled. THAARA_PHONE_DURABLE=approved uses the installed 110a-c tables with calling still disabled.
 * THAARA_PHONE_LIVE_CALLING=approved adds live dialing only when every runtime check passes; a refusal leaves calling
 * disabled rather than stopping the API, so other integrations stay up. buildApp accepts a live provider outside tests
 * only when it was created here. Results carry reason codes only, never values.
 */
export type PhoneStartupStatus='off'|'durable'|'live'|'refused';
export interface PhoneStartupOptions{durableContacts:true;durableCalls:true;
 liveCalling?:{provider:PhoneCallProvider;dailyCallLimit?:number;unlimitedDailyCalls?:boolean;sarvamWebhook:{webhookSecret:()=>Promise<string>}}}
export interface PhoneStartup{status:PhoneStartupStatus;reasons:(SarvamRuntimeReason|'durable_not_approved')[];phoneCalling?:PhoneStartupOptions;phoneOwnerCalendarReview?:true}

const runtimeLoaded=new WeakSet<object>();
export const isRuntimeLoadedPhoneProvider=(provider:object)=>runtimeLoaded.has(provider);

export const nodeSarvamRuntimeFiles:SarvamRuntimeFiles={
 readText:path=>readFile(path,'utf8'),
 // lstat: a symlink is not a verified private file, so it reports null and is refused.
 mode:async path=>{const info=await lstat(path);return info.isFile()?info.mode:null;}
};

export async function createPhoneStartup(env:Record<string,string|undefined>,files:SarvamRuntimeFiles=nodeSarvamRuntimeFiles,fetchImpl:typeof fetch=fetch):Promise<PhoneStartup>{
 const durable=env.THAARA_PHONE_DURABLE==='approved',live=env.THAARA_PHONE_LIVE_CALLING==='approved';
 const ownerReview=env.THAARA_PHONE_OWNER_CALENDAR_REVIEW==='approved';
 if(!durable)return live||ownerReview?{status:'refused',reasons:['durable_not_approved']}:{status:'off',reasons:[]};
 const base={durableContacts:true,durableCalls:true} as const;
 const reviewOptions=ownerReview?{phoneOwnerCalendarReview:true as const}:{};
 if(!live)return {status:'durable',reasons:[],phoneCalling:base,...reviewOptions};
 const runtime=await loadSarvamRuntime(env,files);
 if(runtime.status!=='ready')return {status:'refused',reasons:runtime.status==='refused'?runtime.reasons:[],phoneCalling:base,...reviewOptions};
 const provider=createSarvamCallProvider({...runtime.providerOptions,fetch:fetchImpl,liveCallingEnabled:true});
 runtimeLoaded.add(provider);
 return {status:'live',reasons:[],phoneCalling:{...base,liveCalling:{provider,dailyCallLimit:runtime.dailyCallLimit,unlimitedDailyCalls:runtime.dailyCallLimit===undefined,sarvamWebhook:{webhookSecret:runtime.webhookSecret}}},...reviewOptions};
}
