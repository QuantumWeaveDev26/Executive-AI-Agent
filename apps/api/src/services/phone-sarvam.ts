import type {PhoneCallingLanguage} from '@thaara/contracts';
import type {PhoneTranscript,PhoneTextToSpeech} from './phone-voice.js';
import type {PhoneStreamingSpeechToText} from './phone-audio-bridge.js';
import {bytesToPcm16,mulawToPcm16,pcm16ToBytes,pcm16ToMulaw,upsample2x,writeWavPcm16} from './phone-audio-codec.js';

/**
 * Sarvam speech engines (wire shapes from docs.sarvam.ai API reference, read 29 Oct 2026):
 * STT  wss://api.sarvam.ai/speech-to-text/ws  (Saaras v4; header Api-Subscription-Key; audio {audio:{data,sample_rate,encoding}};
 *      server {type:'data'|'events'|'error', data:{...}}). No mu-law input: phone audio is decoded and upsampled to 16 kHz PCM.
 *      This GA endpoint returns final transcripts; START_SPEECH events are used only to interrupt playback, never as evidence.
 * TTS  wss://api.sarvam.ai/text-to-speech/ws  (Bulbul; {type:'config'|'text'|'flush'}; server {type:'audio'|'event'|'error'}).
 *      The docs conflict on whether mu-law is really produced, so the returned content type is checked and anything we cannot
 *      turn into mu-law 8 kHz is refused.
 * The key comes from an injected resolver; it is never logged, put in URLs, or included in errors.
 */
export interface SarvamCredentials{resolve():Promise<{apiKey:string}>}
export interface WebSocketLike{
 readonly readyState:number;
 send(data:string):void;close(code?:number,reason?:string):void;
 addEventListener(type:'open'|'message'|'close'|'error',listener:(e:{data?:unknown;code?:number})=>void):void;
}
export type SarvamConnect=(url:string,headers:Record<string,string>)=>WebSocketLike;
/** Node's built-in WebSocket (undici) accepts {headers}; confirmed against Sarvam on the first approved test run. */
export const nodeWebSocketConnect:SarvamConnect=(url,headers)=>new (globalThis as unknown as {WebSocket:new(u:string,o:unknown)=>WebSocketLike}).WebSocket(url,{headers});

const STT_URL='wss://api.sarvam.ai/speech-to-text/ws',TTS_URL='wss://api.sarvam.ai/text-to-speech/ws';
const OPEN=1,MAX_TRANSCRIPT=1000,MAX_TTS_BYTES=2_000_000;
const sttLanguage:Record<PhoneCallingLanguage,{code:string;mode:string}>={'en-IN':{code:'en-IN',mode:'transcribe'},'kn-IN':{code:'kn-IN',mode:'transcribe'},'kn-en':{code:'kn-IN',mode:'codemix'}};
// Kanglish lines are mixed script (Kannada words in Kannada, English words in English); Sarvam recommends native script for
// Indic words, so they are voiced with the Kannada model, which also says the English words.
const ttsLanguage:Record<PhoneCallingLanguage,string>={'en-IN':'en-IN','kn-IN':'kn-IN','kn-en':'kn-IN'};
/**
 * Thaara's phone voice: female, per the Thaara personality specification (warm, calm young Bengaluru professional).
 * Sarvam does not document speaker genders; the default is chosen by the owner from comparison samples.
 * English is slightly slower than default after owner feedback (29 Oct 2026: "English is a little fast").
 */
export const THAARA_PHONE_VOICE={speaker:'kavya',pace:{'en-IN':0.9,'kn-IN':1,'kn-en':0.95} as Record<PhoneCallingLanguage,number>};
const text=(d:unknown)=>typeof d==='string'?d:d instanceof ArrayBuffer?new TextDecoder().decode(d):ArrayBuffer.isView(d)?new TextDecoder().decode(d as Uint8Array):'';
const parse=(d:unknown):Record<string,unknown>|null=>{const s=text(d);if(!s||s.length>200_000)return null;try{const v=JSON.parse(s);return v&&typeof v==='object'&&!Array.isArray(v)?v:null;}catch{return null;}};

export interface SarvamSttOptions{language:PhoneCallingLanguage;credentials:SarvamCredentials;connect?:SarvamConnect;model?:'saaras:v4'|'saaras:v3';onError?:(code:string)=>void}

/** One STT connection per call. push() takes mu-law 8 kHz frames straight from the Plivo stream. */
export function createSarvamStreamingStt(o:SarvamSttOptions):PhoneStreamingSpeechToText&{ready:Promise<void>}{
 const listeners:((t:PhoneTranscript)=>void)[]=[],queue:string[]=[];
 let ws:WebSocketLike|null=null,closed=false,seq=0;
 const emit=(t:PhoneTranscript)=>{for(const l of listeners)l(t);};
 const fail=(code:string)=>{o.onError?.(code);if(!closed){closed=true;try{ws?.close(1011,'stt error');}catch{/* ignore */}}};
 const ready=(async()=>{
  const {apiKey}=await o.credentials.resolve();
  if(typeof apiKey!=='string'||apiKey.length<8)throw new Error('Sarvam key not configured');
  const l=sttLanguage[o.language];
  const q=new URLSearchParams({'language-code':l.code,model:o.model??'saaras:v4',mode:l.mode,sample_rate:'16000',input_audio_codec:'pcm_s16le',vad_signals:'true'});
  const socket=(o.connect??nodeWebSocketConnect)(`${STT_URL}?${q}`,{'Api-Subscription-Key':apiKey});
  ws=socket;
  socket.addEventListener('message',e=>{
   const m=parse(e.data),d=m?.data as Record<string,unknown>|undefined;
   if(!m||!d)return;
   if(m.type==='data'&&typeof d.transcript==='string'){
    const t=d.transcript.trim().slice(0,MAX_TRANSCRIPT);
    if(t)emit({id:`sv-${++seq}`,text:t,final:true});
   }else if(m.type==='events'&&d.signal_type==='START_SPEECH'){
    // Barge-in only: the placeholder text never becomes evidence (only final transcripts are recorded).
    emit({id:`sv-${seq+1}`,text:'…',final:false});
   }else if(m.type==='error'){fail(typeof d.code==='string'&&/^[\w.-]{1,64}$/.test(d.code)?`SARVAM_STT_${d.code}`:'SARVAM_STT_ERROR');}
  });
  socket.addEventListener('close',()=>{closed=true;});
  socket.addEventListener('error',()=>fail('SARVAM_STT_CONNECTION'));
  await new Promise<void>((resolve,reject)=>{socket.addEventListener('open',()=>resolve());socket.addEventListener('close',()=>reject(new Error('Sarvam STT connection closed')));});
  for(const f of queue.splice(0))socket.send(f);
 })();
 ready.catch(()=>fail('SARVAM_STT_CONNECT'));
 return {ready,
  push(mulaw){
   if(closed||!(mulaw instanceof Uint8Array)||!mulaw.byteLength||mulaw.byteLength>16384)return;
   const frame=JSON.stringify({audio:{data:Buffer.from(pcm16ToBytes(upsample2x(mulawToPcm16(mulaw)))).toString('base64'),sample_rate:'16000',encoding:'audio/wav'}});
   if(ws&&ws.readyState===OPEN)ws.send(frame);else if(queue.length<200)queue.push(frame);
  },
  close(){if(!closed){closed=true;try{ws?.close(1000,'done');}catch{/* ignore */}}},
  onTranscript(l){listeners.push(l);}
 };
}

export interface SarvamTtsOptions{credentials:SarvamCredentials;connect?:SarvamConnect;model?:'bulbul:v3'|'bulbul:v2';speaker?:string;pace?:Partial<Record<PhoneCallingLanguage,number>>}

/** Returns mu-law 8 kHz audio for the phone. One request at a time per instance; each call opens its own short connection. */
export function createSarvamTts(o:SarvamTtsOptions):PhoneTextToSpeech&{lastContentType:string|null}{
 const state={lastContentType:null as string|null};
 const speaker=o.speaker??THAARA_PHONE_VOICE.speaker;
 if(!/^[a-z][a-z0-9_]{1,63}$/.test(speaker))throw new Error('Invalid Sarvam speaker');
 const paces={...THAARA_PHONE_VOICE.pace,...o.pace};
 if(Object.values(paces).some(p=>typeof p!=='number'||!(p>=0.5&&p<=2)))throw new Error('Invalid Sarvam pace');
 return Object.assign(state,{async synthesize(t:string,language:PhoneCallingLanguage,signal:AbortSignal){
  if(typeof t!=='string'||!t.trim()||t.length>2500)throw new Error('TTS text rejected');
  const {apiKey}=await o.credentials.resolve();
  if(typeof apiKey!=='string'||apiKey.length<8)throw new Error('Sarvam key not configured');
  const ws=(o.connect??nodeWebSocketConnect)(`${TTS_URL}?${new URLSearchParams({model:o.model??'bulbul:v3',send_completion_event:'true'})}`,{'Api-Subscription-Key':apiKey});
  const chunks:Uint8Array[]=[];let bytes=0,contentType:string|null=null;
  const started=Date.now();
  try{
   await new Promise<void>((resolve,reject)=>{
    const stop=(e:Error)=>{reject(e);try{ws.close(1000,'stop');}catch{/* ignore */}};
    signal.addEventListener('abort',()=>stop(new Error('TTS aborted')));
    ws.addEventListener('error',()=>stop(new Error('Sarvam TTS connection error')));
    ws.addEventListener('close',()=>stop(new Error('Sarvam TTS closed early')));
    ws.addEventListener('open',()=>{
     ws.send(JSON.stringify({type:'config',data:{language_code:ttsLanguage[language],speaker,model:o.model??'bulbul:v3',pace:paces[language],speech_sample_rate:'8000',output_audio_codec:'mulaw'}}));
     ws.send(JSON.stringify({type:'text',data:{text:t}}));
     ws.send(JSON.stringify({type:'flush'}));
    });
    ws.addEventListener('message',e=>{
     const m=parse(e.data),d=m?.data as Record<string,unknown>|undefined;
     if(!m||!d)return;
     if(m.type==='audio'&&typeof d.audio==='string'){
      contentType=typeof d.content_type==='string'?d.content_type.toLowerCase():contentType;
      const b=new Uint8Array(Buffer.from(d.audio,'base64'));bytes+=b.byteLength;
      if(bytes>MAX_TTS_BYTES){stop(new Error('TTS audio too large'));return;}
      chunks.push(b);
     }else if(m.type==='event'&&d.event_type==='final'){resolve();try{ws.close(1000,'done');}catch{/* ignore */}}
     else if(m.type==='error')stop(new Error('Sarvam TTS error'));
    });
   });
  }finally{state.lastContentType=contentType;}
  const all=new Uint8Array(bytes);let off=0;for(const c of chunks){all.set(c,off);off+=c.byteLength;}
  // Only formats we can play on the phone: mu-law as-is, 16-bit linear PCM converted to mu-law. Anything else is refused.
  const ct=contentType??'';
  let audio:Uint8Array;
  if(/mulaw|mu-law|basic|pcmu/.test(ct))audio=all;
  else if(/l16|linear16|pcm/.test(ct))audio=pcm16ToMulaw(bytesToPcm16(all));
  else throw new Error(`Sarvam TTS returned an unplayable format: ${ct.slice(0,40)||'unknown'}`);
  if(!audio.byteLength)throw new Error('Sarvam TTS returned no audio');
  return {audio,durationMs:Math.round(audio.byteLength/8),synthesisMs:Date.now()-started} as {audio:Uint8Array;durationMs:number};
 }});
}

/**
 * Thaara's voice for reading a call report to the owner in the browser (not the phone line): same speaker and pace, 22.05 kHz
 * 16-bit PCM wrapped as WAV. Only the report sentence is sent to Sarvam; no recording or phone number.
 */
export function createSarvamReportVoice(o:SarvamTtsOptions){
 const speaker=o.speaker??THAARA_PHONE_VOICE.speaker,paces={...THAARA_PHONE_VOICE.pace,...o.pace};
 if(!/^[a-z][a-z0-9_]{1,63}$/.test(speaker))throw new Error('Invalid Sarvam speaker');
 return {async speak(t:string,language:PhoneCallingLanguage,signal:AbortSignal):Promise<Uint8Array>{
  if(typeof t!=='string'||!t.trim()||t.length>1500)throw new Error('Report text rejected');
  if(signal.aborted)throw new Error('Report voice aborted');
  const {apiKey}=await o.credentials.resolve();
  if(signal.aborted)throw new Error('Report voice aborted');
  if(typeof apiKey!=='string'||apiKey.length<8)throw new Error('Sarvam key not configured');
  const ws=(o.connect??nodeWebSocketConnect)(`${TTS_URL}?${new URLSearchParams({model:o.model??'bulbul:v3',send_completion_event:'true'})}`,{'Api-Subscription-Key':apiKey});
  const chunks:Uint8Array[]=[];let bytes=0,contentType='';
  await new Promise<void>((resolve,reject)=>{
   const stop=(e:Error)=>{reject(e);try{ws.close(1000,'stop');}catch{/* ignore */}};
   signal.addEventListener('abort',()=>stop(new Error('Report voice aborted')));
   ws.addEventListener('error',()=>stop(new Error('Sarvam report voice connection error')));
   ws.addEventListener('close',()=>stop(new Error('Sarvam report voice closed early')));
   ws.addEventListener('open',()=>{
    ws.send(JSON.stringify({type:'config',data:{language_code:ttsLanguage[language],speaker,model:o.model??'bulbul:v3',pace:paces[language],speech_sample_rate:'22050',output_audio_codec:'linear16'}}));
    ws.send(JSON.stringify({type:'text',data:{text:t}}));ws.send(JSON.stringify({type:'flush'}));
   });
   ws.addEventListener('message',e=>{
    const m=parse(e.data),d=m?.data as Record<string,unknown>|undefined;if(!m||!d)return;
    if(m.type==='audio'&&typeof d.audio==='string'){contentType=typeof d.content_type==='string'?d.content_type.toLowerCase():contentType;const b=new Uint8Array(Buffer.from(d.audio,'base64'));bytes+=b.byteLength;if(bytes>MAX_TTS_BYTES*4){stop(new Error('Report audio too large'));return;}chunks.push(b);}
    else if(m.type==='event'&&d.event_type==='final'){resolve();try{ws.close(1000,'done');}catch{/* ignore */}}
    else if(m.type==='error')stop(new Error('Sarvam report voice error'));
   });
  });
  const all=new Uint8Array(bytes);let off=0;for(const c of chunks){all.set(c,off);off+=c.byteLength;}
  if(!all.byteLength)throw new Error('Sarvam returned no report audio');
  if(/wav/.test(contentType))return all;
  if(/l16|linear16|pcm/.test(contentType))return writeWavPcm16(bytesToPcm16(all),22050);
  throw new Error(`Sarvam report voice returned an unplayable format: ${contentType.slice(0,40)||'unknown'}`);
 }};
}
