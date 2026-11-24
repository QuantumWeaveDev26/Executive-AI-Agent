import type {PhoneCallbackNonceStore,PhoneCallbackVerifier} from './phone-callback-admission.js';
import type {PhoneAudioSink,PhoneTranscript,PhoneVoiceSession} from './phone-voice.js';

/**
 * Plivo bidirectional audio stream <-> PhoneVoiceSession. Transport-neutral: the WebSocket server (not installed yet) passes
 * raw text frames in and gets `send`/`close` back. Message shapes follow Plivo's audio-streaming guide (29 Oct 2026):
 * start.streamId, media.payload, playAudio{media:{contentType,sampleRate,payload}}, clearAudio{streamId}, playedStream,
 * clearedAudio, dtmf, stop. Fields the guide does not show (e.g. the start event's call id) are optional and, when present,
 * must match. Confirm against Plivo's Protocol Reference before go-live.
 */
export interface PhoneStreamingSpeechToText{push(audio:Uint8Array):void;close():void;onTranscript(listener:(t:PhoneTranscript)=>void):void}
export interface PhoneStreamTransport{send(text:string):void;close(code:number,reason:string):void}
export const PLIVO_STREAM_CONTENT_TYPE='audio/x-mulaw;rate=8000';
const MAX_FRAME_CHARS=65536,MAX_MEDIA_BYTES=16384,MAX_BAD_FRAMES=5;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Answer XML that hands the answered call to the bidirectional stream. The voice session speaks the AI disclosure first. */
export function plivoStreamAnswerXml(streamUrl:string){
 const u=new URL(streamUrl);
 if(u.protocol!=='wss:'||u.username||u.password||u.search||u.hash)throw Error('Stream URL denied');
 return `<?xml version="1.0" encoding="UTF-8"?><Response><Stream bidirectional="true" keepCallAlive="true" contentType="${PLIVO_STREAM_CONTENT_TYPE}">${u.href.replace(/&/g,'&amp;')}</Stream></Response>`;
}

/** WebSocket upgrade check: pinned wss URL for this call, provider signature (GET, no params), then single-use nonce. */
export async function admitPlivoStreamUpgrade(input:{callId:string;url:string;headers:Record<string,string|string[]|undefined>},options:{streamOrigin:string;verifier?:PhoneCallbackVerifier;nonces:PhoneCallbackNonceStore}):Promise<'accepted'|'rejected'|'not_configured'>{
 if(!options.verifier)return 'not_configured';
 if(!UUID.test(input.callId)||input.url!==`${new URL(options.streamOrigin).origin}/api/v1/connectors/phone/plivo/calls/${input.callId}/stream`)return 'rejected';
 const h=(n:string)=>{const v=input.headers[n];return typeof v==='string'?v:undefined;};
 const signature=h('x-plivo-signature-v3'),nonce=h('x-plivo-signature-v3-nonce');
 if(!signature||signature.length>2048||!nonce||!/^[A-Za-z0-9_-]{8,100}$/.test(nonce))return 'rejected';
 let ok=false;try{ok=(await options.verifier({method:'GET',url:input.url,nonce,signature,params:{}}))===true;}catch{ok=false;}
 if(!ok)return 'rejected';
 return (await options.nonces.remember(nonce,10*60*1000))?'accepted':'rejected';
}

export class PlivoAudioBridge{
 private streamId:string|null=null;
 private badFrames=0;
 private closed=false;
 readonly stats={mediaFrames:0,mediaBytes:0,played:0,cleared:0,ignored:0};
 private session!:PhoneVoiceSession;
 constructor(private readonly binding:{providerCallId:string},private readonly transport:PhoneStreamTransport,private readonly stt:PhoneStreamingSpeechToText){}
 /** The sink the voice session speaks through. Audio is mu-law 8 kHz, matching the Stream contentType. */
 readonly sink:PhoneAudioSink={
  play:(audio)=>{if(this.closed||!this.streamId)return;this.stats.played++;this.transport.send(JSON.stringify({event:'playAudio',media:{contentType:'audio/x-mulaw',sampleRate:8000,payload:Buffer.from(audio).toString('base64')}}));},
  stop:()=>{if(this.closed||!this.streamId)return;this.stats.cleared++;this.transport.send(JSON.stringify({event:'clearAudio',streamId:this.streamId}));},
  hangup:()=>this.close(1000,'call ended')
 };
 /** Wire the session after construction (the session needs this bridge's sink). Transcripts flow STT -> session. */
 attach(session:PhoneVoiceSession){this.session=session;this.stt.onTranscript(t=>{if(!this.closed)void session.transcript(t);});}
 private close(code:number,reason:string){if(this.closed)return;this.closed=true;try{this.stt.close();}catch{/* ignore */}this.transport.close(code,reason);}
 private bad(){if(++this.badFrames>=MAX_BAD_FRAMES)this.close(1008,'protocol');}
 /** One inbound text frame. Never throws; malformed frames count toward a close. */
 async receive(frame:unknown){
  if(this.closed)return;
  if(typeof frame!=='string'||frame.length>MAX_FRAME_CHARS){this.bad();return;}
  let m:Record<string,unknown>;try{const v=JSON.parse(frame);if(!v||typeof v!=='object'||Array.isArray(v))throw 0;m=v;}catch{this.bad();return;}
  const event=m.event;
  if(event==='start'){
   const s=m.start as Record<string,unknown>|undefined;
   const id=s?.streamId,callId=s?.callId;
   if(this.streamId||typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id)||(callId!==undefined&&(typeof callId!=='string'||callId.toLowerCase()!==this.binding.providerCallId))){this.close(1008,'binding');return;}
   this.streamId=id;
   await this.session.start();
   return;
  }
  if(!this.streamId){this.bad();return;}
  if(event==='media'){
   const payload=(m.media as Record<string,unknown>|undefined)?.payload;
   if(typeof payload!=='string'||payload.length>Math.ceil(MAX_MEDIA_BYTES*4/3)+4||!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)){this.bad();return;}
   const audio=new Uint8Array(Buffer.from(payload,'base64'));
   if(!audio.byteLength){this.bad();return;}
   this.stats.mediaFrames++;this.stats.mediaBytes+=audio.byteLength;
   this.stt.push(audio);return;
  }
  if(event==='playedStream'||event==='clearedAudio'){this.session.playbackDone();return;}
  // Keypad presses are ignored: no tone can trigger an action. Unknown events are counted, not acted on.
  if(event==='dtmf'){this.stats.ignored++;return;}
  if(event==='stop'){await this.session.hangup();this.close(1000,'stream stopped');return;}
  this.stats.ignored++;
 }
 /** Transport closed by the network. */
 async disconnected(){if(!this.closed&&this.session){await this.session.hangup();}this.close(1000,'disconnected');}
}
