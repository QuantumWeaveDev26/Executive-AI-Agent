import type {PhoneCallingDraft,PhoneCallingLanguage,PhoneCallingReport} from '@thaara/contracts';
import {PhoneConversation} from './phone-conversation.js';

/**
 * Step 110 slice D: bounded voice loop. Engines are injected; none is chosen or wired yet.
 * - Speech-to-text delivers recipient transcripts (partial/final). Only FINAL text becomes evidence.
 * - The dialogue engine only PROPOSES the next short sentence. It sees recipient words as untrusted data and has no tools:
 *   it cannot dial, message, change the recipient/purpose, or end the AI disclosure.
 * - Fixed lines (AI disclosure, approved question, identity answer, closing) never come from the model.
 */
export interface PhoneTranscript{id:string;text:string;final:boolean}
export interface PhoneDialogueInput{language:PhoneCallingLanguage;purpose:string;recipientTurns:readonly string[];assistantTurns:readonly string[];remainingSeconds:number}
export interface PhoneDialogueEngine{propose(input:PhoneDialogueInput,signal:AbortSignal):Promise<unknown>}
export interface PhoneTextToSpeech{synthesize(text:string,language:PhoneCallingLanguage,signal:AbortSignal):Promise<{audio:Uint8Array;durationMs:number}>}
export interface PhoneAudioSink{play(audio:Uint8Array,generation:number):void;stop():void;hangup():void}
export interface PhoneVoiceBudgets{maxAssistantTurns:number;engineTimeoutMs:number;maxUtteranceChars:number;maxAudioBytes:number}
export type PhoneVoiceEndReason='model_closed'|'turn_budget'|'time_budget'|'engine_failure'|'output_rejected'|'evidence_limit'|'hangup';
export interface PhoneVoiceMetrics{modelCalls:number;modelRejections:number;ttsCalls:number;ttsChars:number;finalTranscripts:number;interruptions:number;maxResponseLatencyMs:number}

export const DEFAULT_VOICE_BUDGETS:PhoneVoiceBudgets={maxAssistantTurns:6,engineTimeoutMs:4000,maxUtteranceChars:300,maxAudioBytes:2_000_000};
export const IDENTITY_ANSWERS:Record<PhoneCallingLanguage,string>={
 'en-IN':'I am Thaara, an AI assistant, not a person.',
 'kn-IN':'ನಾನು ತಾರಾ, AI ಸಹಾಯಕಿ. ನಾನು ಮನುಷ್ಯಳಲ್ಲ.',
 'kn-en':'ನಾನು ತಾರಾ, AI assistant. ನಾನು real person ಅಲ್ಲ.'
};
export const CLOSINGS:Record<PhoneCallingLanguage,string>={
 'en-IN':'Thank you. I will pass this on. Have a good day.',
 'kn-IN':'ಧನ್ಯವಾದಗಳು. ನಾನು ಈ ಮಾಹಿತಿಯನ್ನು ತಿಳಿಸುತ್ತೇನೆ. ನಮಸ್ಕಾರ.',
 'kn-en':'Thank you! ನಾನು ಈ message pass on ಮಾಡ್ತೀನಿ. ನಮಸ್ಕಾರ.'
};
// Recipient asks whether they are talking to a person: always answered by the fixed line, never by the model.
const IDENTITY_QUESTION=/\b(are you (a |an )?(human|person|real|robot|bot|machine|ai)|is this (a |an )?(human|person|robot|bot|recording|ai))\b|ನೀವು (ಮನುಷ್ಯ|ರೋಬೋಟ್)|neevu (manushya|robot)/iu;

/** Model output gate: exactly {text, endCall?}; short single-line speech; no digit runs (no numbers read out), no links/markup, no human claims. */
export function acceptDialogueOutput(raw:unknown,maxChars:number):{text:string;endCall:boolean}|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const o=raw as Record<string,unknown>;
 if(Object.keys(o).some(k=>k!=='text'&&k!=='endCall')||typeof o.text!=='string'||(o.endCall!==undefined&&typeof o.endCall!=='boolean'))return null;
 const text=o.text.replace(/\s+/g,' ').trim();
 if(!text||text.length>maxChars||/[\u0000-\u001f\u007f<>{}[\]`]/.test(o.text.replace(/[\n\t]/g,' '))||/\d[\d\s-]{6,}\d/.test(text)||/(https?:|www\.|@)/i.test(text))return null;
 if(/\b(i am|i'm) (a |an )?(human|real person|person|not (an? )?(ai|bot|robot|assistant))\b/i.test(text))return null;
 return {text,endCall:o.endCall===true};
}

function withTimeout<T>(ms:number,work:(signal:AbortSignal)=>Promise<T>,cancel?:AbortSignal):Promise<T>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 let onAbort:(()=>void)|undefined;
 return Promise.race([
  work(controller.signal),
  new Promise<never>((_,reject)=>{
   if(cancel?.aborted){controller.abort();reject(new Error('turn aborted'));return;}
   onAbort=()=>{controller.abort();reject(new Error('turn aborted'));};
   cancel?.addEventListener('abort',onAbort,{once:true});
   timer=setTimeout(()=>{controller.abort();reject(new Error('engine timeout'));},ms);
  })
 ]).finally(()=>{clearTimeout(timer);if(onAbort)cancel?.removeEventListener('abort',onAbort);});
}

export class PhoneVoiceSession{
 private readonly conversation:PhoneConversation;
 private readonly budgets:PhoneVoiceBudgets;
 private readonly assistantTurns:string[]=[];
 private queue:Promise<void>=Promise.resolve();
 private startedAt=0;
 private speaking=false;
 private canInterrupt=false;
 private turnAbort:AbortController|null=null;
 ended:PhoneVoiceEndReason|null=null;
 readonly metrics:PhoneVoiceMetrics={modelCalls:0,modelRejections:0,ttsCalls:0,ttsChars:0,finalTranscripts:0,interruptions:0,maxResponseLatencyMs:0};
 constructor(private readonly draft:Pick<PhoneCallingDraft,'language'|'purpose'|'maxDurationSeconds'|'aiDisclosure'|'onBehalfOf'>,private readonly engines:{dialogue:PhoneDialogueEngine;tts:PhoneTextToSpeech;sink:PhoneAudioSink},budgets:Partial<PhoneVoiceBudgets>={},private readonly now:()=>number=Date.now){
  this.conversation=new PhoneConversation(draft.language,draft.purpose,draft.maxDurationSeconds,draft.onBehalfOf);
  if(draft.aiDisclosure!==this.conversation.opening())throw Error('AI disclosure mismatch');
  const b={...DEFAULT_VOICE_BUDGETS,...budgets};
  if(!(b.maxAssistantTurns>=1&&b.maxAssistantTurns<=12&&b.engineTimeoutMs>=500&&b.engineTimeoutMs<=10000&&b.maxUtteranceChars>=40&&b.maxUtteranceChars<=500&&b.maxAudioBytes>=1024&&b.maxAudioBytes<=5_000_000))throw Error('Invalid voice budgets');
  this.budgets=b;
 }
 private serial(work:()=>Promise<void>){this.queue=this.queue.then(work,work);return this.queue;}
 private remainingSeconds(){return Math.max(0,this.draft.maxDurationSeconds-Math.floor((this.now()-this.startedAt)/1000));}
 private bargeIn(){
  this.conversation.interrupt();this.metrics.interruptions++;this.canInterrupt=false;
  if(this.speaking){this.speaking=false;this.engines.sink.stop();}
  this.turnAbort?.abort();
 }
 private async say(text:string,generation=this.conversation.outputGeneration,cancel?:AbortSignal):Promise<boolean>{
  // After a hangup nothing is spoken; other endings still allow the fixed closing line.
  if(this.ended==='hangup')return false;
  if(cancel?.aborted||generation!==this.conversation.outputGeneration)return false;
  this.metrics.ttsCalls++;this.metrics.ttsChars+=text.length;
  const out=await withTimeout(this.budgets.engineTimeoutMs,s=>this.engines.tts.synthesize(text,this.draft.language,s),cancel);
  if(!(out?.audio instanceof Uint8Array)||out.audio.byteLength===0||out.audio.byteLength>this.budgets.maxAudioBytes)throw Error('tts output rejected');
  // Barge-in: audio synthesised for an older generation is discarded, never played over the recipient.
  if(cancel?.aborted||!this.conversation.acceptOutput(generation,text))return false;
  this.speaking=true;this.canInterrupt=true;this.engines.sink.play(out.audio,generation);return true;
 }
 private async finish(reason:PhoneVoiceEndReason){
  if(this.ended)return;
  this.ended=reason;this.canInterrupt=false;this.turnAbort?.abort();
  if(reason!=='hangup'){try{await this.say(CLOSINGS[this.draft.language]);}catch{/* closing is best effort; the call still ends */}}
  this.engines.sink.hangup();
 }
 /** Fixed opening: AI disclosure, then the exact approved question. Neither comes from the model. */
 start(){
  this.canInterrupt=true;
  return this.serial(async()=>{
   this.startedAt=this.now();
   const generation=this.conversation.outputGeneration,abort=new AbortController();this.turnAbort=abort;
   try{
    if(!await this.say(this.draft.aiDisclosure,generation,abort.signal))return;
    if(await this.say(this.conversation.approvedQuestion(),generation,abort.signal))this.assistantTurns.push(this.conversation.approvedQuestion());
   }catch{
    if(abort.signal.aborted||generation!==this.conversation.outputGeneration)return;
    await this.finish('engine_failure');
   }finally{if(this.turnAbort===abort)this.turnAbort=null;}
  });
 }
 /** Recipient speech. Partial or final speech while Thaara talks/synthesises interrupts; only final text is evidence and gets a reply. */
 transcript(t:PhoneTranscript){
  const hasText=typeof t.text==='string'&&t.text.trim().length>0;
  if(!this.ended&&hasText&&(this.speaking||this.canInterrupt||(this.turnAbort!==null&&!this.turnAbort.signal.aborted)))this.bargeIn();
  const turnGeneration=this.conversation.outputGeneration;
  if(!this.ended&&t.final&&hasText)this.canInterrupt=true;
  return this.serial(async()=>{
   if(this.ended||!t.final)return;
   const received=this.now();
   try{this.conversation.receive(t);}catch{await this.finish('evidence_limit');return;}
   this.metrics.finalTranscripts++;
   if(this.conversation.outputGeneration!==turnGeneration)return;
   if(this.remainingSeconds()<=5){await this.finish('time_budget');return;}
   const abort=new AbortController();this.turnAbort=abort;
   try{
    if(IDENTITY_QUESTION.test(t.text)){await this.reply(IDENTITY_ANSWERS[this.draft.language],received,turnGeneration,abort.signal);return;}
    if(this.assistantTurns.length>=this.budgets.maxAssistantTurns){await this.finish('turn_budget');return;}
    let raw:unknown;
    this.metrics.modelCalls++;
    try{raw=await withTimeout(this.budgets.engineTimeoutMs,s=>this.engines.dialogue.propose({language:this.draft.language,purpose:this.draft.purpose,recipientTurns:this.conversation.report('answered').quotedResponses,assistantTurns:[...this.assistantTurns],remainingSeconds:this.remainingSeconds()},s),abort.signal);}
    catch{
     if(abort.signal.aborted||this.conversation.outputGeneration!==turnGeneration)return;
     await this.finish('engine_failure');return;
    }
    if(abort.signal.aborted||this.conversation.outputGeneration!==turnGeneration)return;
    const accepted=acceptDialogueOutput(raw,this.budgets.maxUtteranceChars);
    if(!accepted){this.metrics.modelRejections++;await this.finish('output_rejected');return;}
    if(accepted.endCall){
     if(await this.reply(accepted.text,received,turnGeneration,abort.signal))await this.finish('model_closed');
     return;
    }
    await this.reply(accepted.text,received,turnGeneration,abort.signal);
   }finally{if(this.turnAbort===abort)this.turnAbort=null;}
  });
 }
 private async reply(text:string,receivedAt:number,generation:number,cancel:AbortSignal):Promise<boolean>{
  let spoken=false;
  try{spoken=await this.say(text,generation,cancel);}catch{
   if(cancel.aborted||this.conversation.outputGeneration!==generation)return false;
   await this.finish('engine_failure');return false;
  }
  if(!spoken)return false;
  this.assistantTurns.push(text);
  this.metrics.maxResponseLatencyMs=Math.max(this.metrics.maxResponseLatencyMs,this.now()-receivedAt);
  return true;
 }
 /** Playback finished (from the sink). */
 playbackDone(){this.speaking=false;if(!this.turnAbort)this.canInterrupt=false;}
 /** Recipient or network hung up. */
 hangup(){return this.serial(async()=>{await this.finish('hangup');});}
 /** Evidence-only report: recipient's final words, never the model's interpretation. */
 report(state:'completed'|'failed'|'cancelled'|'busy'|'no_answer'|'answered'):PhoneCallingReport{return this.conversation.report(state);}
}
