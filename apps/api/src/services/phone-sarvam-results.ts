import {capturePhoneCallEvidence,type PhoneCallEvidence,isPhoneProviderCallId} from '@thaara/contracts';

export interface PhoneProviderReadResult {
 status:'available'|'pending'|'unavailable';
 outcome?:'completed'|'busy'|'no_answer'|'failed';
 responses:string[];
 conversation?:PhoneCallEvidence;
}
export interface PhoneProviderResultRequest {attemptId:string;createdAt:string}
interface Options {
 enabled:boolean;orgId:string;workspaceId:string;appId:string;appVersion:number;
 credentials:{resolve():Promise<{apiKey:string}>};fetch:typeof fetch;
}
const id=/^[A-Za-z0-9_.:-]{1,128}$/;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const unavailable=():PhoneProviderReadResult=>({status:'unavailable',responses:[]});
/** Read only; called by scoped service admission, never from model-selected URLs or IDs. No retry or dialing. */
export function createSarvamResultReader(o:Options){
 if(![o.orgId,o.workspaceId,o.appId].every(v=>id.test(v))||!Number.isSafeInteger(o.appVersion)||o.appVersion<0)throw Error('Sarvam result configuration denied');
 const base=`https://apps.sarvam.ai/api/analytics/v1/${[o.orgId,o.workspaceId,o.appId].map(encodeURIComponent).join('/')}`;
 return async(request:PhoneProviderResultRequest):Promise<PhoneProviderReadResult>=>{
  const created=Date.parse(request.createdAt);
  if(!o.enabled||!id.test(request.attemptId)||!Number.isFinite(created))return unavailable();
  try{
   const {apiKey}=await o.credentials.resolve();if(typeof apiKey!=='string'||apiKey.length<8)return unavailable();
   const signal=AbortSignal.timeout(10000);
   const get=async(url:string):Promise<unknown>=>{
    const response=await o.fetch(url,{method:'GET',redirect:'error',signal,headers:{'X-API-Key':apiKey,accept:'application/json'}});
    if(!response.ok||!response.body)throw Error('Provider read unavailable');
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
    try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>262144)throw Error('Provider read too large');chunks.push(part.value);}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
   };
   const query=new URLSearchParams({start_datetime:new Date(created-60000).toISOString(),end_datetime:new Date(created+86400000).toISOString(),limit:'2',
    filter_conditions:JSON.stringify([{field:'attempt_id',operator:'equals',value:request.attemptId}])});
   const data=await get(`${base}/attempts?${query}`);
   if(!object(data)||!Array.isArray(data.items))return unavailable();
   if(data.items.length===0)return {status:'pending',responses:[]};
   if(data.items.length!==1)return unavailable();
   const attempt=data.items[0];
   if(!object(attempt)||attempt.attempt_id!==request.attemptId||attempt.app_version!==o.appVersion||attempt.channel_direction!=='outbound')return unavailable();
   if(!attempt.end_datetime)return {status:'pending',responses:[]};
   const state=attempt.connectivity_status;
   if(state==='no_answer'||state==='busy'||state==='failed')return {status:'available',outcome:state,responses:[]};
   if(state!=='connected'||!isPhoneProviderCallId(attempt.interaction_id)||!/^\d{8}\//.test(attempt.interaction_id))return unavailable();
   const transcript=await get(`${base}/transcripts/${encodeURIComponent(attempt.interaction_id)}`);
   if(!object(transcript)||transcript.interaction_id!==attempt.interaction_id||!Array.isArray(transcript.messages)||transcript.messages.length>200)return unavailable();
   const responses:string[]=[];
   for(const message of transcript.messages){
    if(!object(message)||!['assistant','user'].includes(String(message.role))||typeof message.content!=='string')return unavailable();
    if(message.role==='user'&&message.content.trim())responses.push(message.content.trim().slice(0,1000));
   }
   // Original-language provider text; never claim a browser summary or a verified real-world outcome.
   return {status:'available',outcome:'completed',responses:responses.slice(0,12),conversation:capturePhoneCallEvidence(transcript.messages.map((m:Record<string,unknown>)=>({role:m.role,text:m.content})),'provider_transcript')};
  }catch{return unavailable();}
 };
}
