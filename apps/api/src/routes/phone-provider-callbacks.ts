import type {FastifyInstance} from 'fastify';
import '@fastify/websocket';
import {computeCanonicalParameterHash,type PhoneCallingLanguage,type PhoneCallingState} from '@thaara/contracts';
import type {PhoneCallbackAdmissionOptions,PhoneCallbackRequest} from '../services/phone-callback-admission.js';
import {createPhoneCallbackAdmission} from '../services/phone-callback-admission.js';
import {PlivoAudioBridge,admitPlivoStreamUpgrade,plivoStreamAnswerXml,type PhoneStreamingSpeechToText} from '../services/phone-audio-bridge.js';
import {PhoneVoiceSession,type PhoneDialogueEngine,type PhoneTextToSpeech,type PhoneVoiceBudgets} from '../services/phone-voice.js';
import type {PhoneStructuredCompletion} from '../services/phone-structured-callback-store.js';

export interface PhoneCallbackBindingView{callId:string;providerRequestId:string;providerCallId:string|null;language:PhoneCallingLanguage;aiDisclosure:string;onBehalfOf?:string;purpose:string;maxDurationSeconds:number;state:PhoneCallingState}
export interface PhoneCallbackStore{
 /** Optional only after separate structured-report SQL/runtime admission; absent in current production store. */
 completeReport?(event:PhoneStructuredCompletion):Promise<'applied'|'duplicate'|'ignored'>;
 binding(callId:string):Promise<PhoneCallbackBindingView|null>;
 apply(e:{callId:string;providerRequestId:string;providerCallId:string;state:PhoneCallingState;eventId:string;eventHash:string}):Promise<'applied'|'duplicate'|'ignored'>;
 transcript(e:{callId:string;providerCallId:string;eventId:string;text:string;eventHash:string;source:'verbatim'|'provider_english'}):Promise<'applied'|'duplicate'|'ignored'>;
}
/** Speech engines for one call. Created per call; nothing is shared between calls. */
export interface PhoneVoiceEngines{dialogue:PhoneDialogueEngine;tts:PhoneTextToSpeech;stt:PhoneStreamingSpeechToText}
export interface PhoneVoiceRuntimeOptions{createEngines(language:PhoneCallingLanguage):PhoneVoiceEngines;budgets?:Partial<PhoneVoiceBudgets>}
export interface PhoneProviderCallbackOptions extends Omit<PhoneCallbackAdmissionOptions,'bindings'>{store:PhoneCallbackStore;voice?:PhoneVoiceRuntimeOptions}

const xml=(s:string)=>s.replace(/[<>&'"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]!));
/**
 * Answer response without a voice runtime: the fixed AI disclosure and the exact approved question, then hang up.
 * One-way; the report therefore never claims a reply. Text comes from the approved draft only.
 */
export function plivoAnswerXml(b:{aiDisclosure:string;purpose:string}){
 return `<?xml version="1.0" encoding="UTF-8"?><Response><Speak>${xml(b.aiDisclosure)}</Speak><Speak>${xml(b.purpose)}</Speak><Hangup/></Response>`;
}
const streamPath=(callId:string)=>`/api/v1/connectors/phone/plivo/calls/${callId}/stream`;

/** Public, session-free provider callbacks. Every request passes signature/URL/nonce/binding admission before touching data. */
export async function phoneProviderCallbackRoutes(app:FastifyInstance,options:PhoneProviderCallbackOptions){
 const origin=new URL(options.callbackOrigin).origin;
 const admit=createPhoneCallbackAdmission({...options,bindings:{find:async id=>{const b=await options.store.binding(id);return b&&{callId:b.callId,providerRequestId:b.providerRequestId,providerCallId:b.providerCallId};}}});
 await app.register(async scoped=>{
  // Form bodies only in this scope. Repeated keys become arrays, which admission rejects as malformed.
  scoped.addContentTypeParser('application/x-www-form-urlencoded',{parseAs:'string',bodyLimit:16384},(_req,body,done)=>{
   const form:Record<string,string|string[]>={};
   for(const [k,v] of new URLSearchParams(String(body))){const old=form[k];form[k]=old===undefined?v:([] as string[]).concat(old,v);}
   done(null,form);
  });
  scoped.post<{Params:{callId:string;hook:string}}>('/connectors/phone/plivo/calls/:callId/:hook',{bodyLimit:16384},async(request,reply)=>{
   reply.header('Cache-Control','no-store');
   // The exact URL Plivo signed: pinned origin + received path and query (admission rejects anything but the pinned path).
   const input:PhoneCallbackRequest={method:request.method,hook:request.params.hook,callId:request.params.callId,url:`${origin}${request.url}`,headers:request.headers,form:(request.body??{}) as Record<string,unknown>};
   const result=await admit(input);
   if(result.status==='not_configured')return reply.code(503).send();
   // Rejections carry no detail to the caller; the reason is for our logs only.
   if(result.status==='rejected'){request.log.warn({reason:result.reason},'phone callback rejected');return reply.code(403).send();}
   const binding=(await options.store.binding(result.callId))!;
   const event={eventId:result.eventId,state:result.state,providerCallId:result.providerCallId};
   await options.store.apply({callId:result.callId,providerRequestId:binding.providerRequestId,providerCallId:result.providerCallId,state:result.state,eventId:result.eventId,eventHash:computeCanonicalParameterHash(event)});
   if(result.hook==='answer'){
    const xmlBody=options.voice?plivoStreamAnswerXml(`wss://${new URL(origin).host}${streamPath(result.callId)}`):plivoAnswerXml(binding);
    return reply.code(200).type('application/xml').send(xmlBody);
   }
   return reply.code(200).send();
  });

  if(!options.voice)return;
  const voice=options.voice;
  // The WebSocket plugin is registered once at the app root (buildApp) only when a voice runtime is configured.
  if(!scoped.websocketServer)throw new Error('Voice streaming requires the WebSocket plugin to be registered by buildApp.');
  scoped.get<{Params:{callId:string}}>('/connectors/phone/plivo/calls/:callId/stream',{websocket:true,
   // Refuse before the upgrade: signed GET for this exact path, fresh nonce, and an answered live call with a known provider id.
   preValidation:async(request,reply)=>{
    const decision=await admitPlivoStreamUpgrade({callId:request.params.callId,url:`${origin}${request.url}`,headers:request.headers},{streamOrigin:origin,verifier:options.verifier,nonces:options.nonces});
    if(decision!=='accepted'){request.log.warn({decision},'phone stream rejected');return reply.code(decision==='not_configured'?503:403).send();}
    const b=await options.store.binding(request.params.callId);
    if(!b||!b.providerCallId||b.state!=='answered'){request.log.warn({decision:'binding'},'phone stream rejected');return reply.code(403).send();}
   }},
  async(socket,request)=>{
   const b=await options.store.binding(request.params.callId);
   if(!b||!b.providerCallId){socket.close(1008,'binding');return;}
   const providerCallId=b.providerCallId,engines=voice.createEngines(b.language);
   // Final words are persisted as evidence BEFORE the session hears them; if that fails the call ends rather than run unrecorded.
   let bridge!:PlivoAudioBridge;
   const recordedStt:PhoneStreamingSpeechToText={push:a=>engines.stt.push(a),close:()=>engines.stt.close(),onTranscript:listener=>engines.stt.onTranscript(async t=>{
    if(t.final){
     try{await options.store.transcript({callId:b.callId,providerCallId,eventId:`stt-${t.id}`,text:t.text,source:'verbatim',eventHash:computeCanonicalParameterHash({id:t.id,text:t.text})});}
     catch{request.log.warn('phone transcript not recorded; ending call');await bridge.disconnected();return;}
    }
    listener(t);
   })};
   bridge=new PlivoAudioBridge({providerCallId},{send:t=>socket.send(t),close:(code,reason)=>socket.close(code,reason)},recordedStt);
   const session=new PhoneVoiceSession({language:b.language,purpose:b.purpose,maxDurationSeconds:b.maxDurationSeconds,aiDisclosure:b.aiDisclosure,onBehalfOf:b.onBehalfOf},{dialogue:engines.dialogue,tts:engines.tts,sink:bridge.sink},voice.budgets);
   bridge.attach(session);
   socket.on('message',(data:Buffer,isBinary:boolean)=>{void bridge.receive(isBinary?null:data.toString('utf8'));});
   socket.on('close',()=>{void bridge.disconnected();});
  });
 });
}
