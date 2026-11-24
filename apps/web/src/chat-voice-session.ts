/** Local energy VAD calibrated against room hum and playback echo. Browser echo cancellation is required. */
export class VoiceActivityDetector {
 private warmup=10;private noise=.002;private voiced=0;private silence=0;private active=false;private floor=.014;private playing=false;
 public lastRms=0;
 constructor(private endFrames=32){}
 setPlaybackActive(playing:boolean){this.playing=playing;this.floor=playing?.021:.014;}
 resetActive(){this.active=false;this.voiced=0;this.silence=0;}
 push(samples:Float32Array):'start'|'end'|null{
  let sum=0;for(const x of samples)sum+=x*x;const rms=Math.sqrt(sum/samples.length);
  this.lastRms=rms;
  if(this.warmup>0){this.warmup--;this.noise=Math.min(.006,this.noise*.9+rms*.1);return null;}
  const speech=rms>Math.max(this.floor,this.noise*(this.playing?3.6:3.0));
  if(!this.active){
   if(!speech&&!this.playing)this.noise=Math.min(.006,this.noise*.98+rms*.02);
   this.voiced=speech?this.voiced+1:0;
   if(this.voiced>=6){this.active=true;this.silence=0;return 'start';}
  }else{
   this.silence=speech?0:this.silence+1;
   if(this.silence>=this.endFrames){this.active=false;this.voiced=0;return 'end';}
  }
  return null;
 }
}
const PURE_STOP_RE=/^(?:(?:hey|hi|hii|hello)\s+)?(?:(?:thaara|thara|tara|ತಾರಾ|तारा)[,!.\s]+)?(?:please\s+)?(?:stop(?:\s+(?:speaking|talking|now|it|thaara|thara|tara))?|quiet|pause|hold\s+on|ನಿಲ್ಲಿಸು|ನಿಲ್ಲಿಸಿ|ರುಕೋ|रुको|बस\s+रोको|रोको|चुप\s+रहो)[,!.\s]*$/iu;
const BARGE_IN_LEAD_RE=/^(?:(?:hey|hi|hii|hello)[,!.\s]+)?(?:(?:thaara|thara|tara|ತಾರಾ|तारा)[,!.\s]+)?(?:please\s+)?(?:stop(?:\s+(?:speaking|talking|there|now))?|wait|hold\s+on|ನಿಲ್ಲಿಸು|ನಿಲ್ಲಿಸಿ|रुको|रोको)[,!.:;\s-]+(?:and\s+)?(.+)$/isu;
export function normalizeSpokenTurn(raw:string,interrupted:boolean):{stopOnly:boolean;command:string}{
 const trimmed=raw.trim();
 if(!trimmed)return{stopOnly:false,command:''};
 if(PURE_STOP_RE.test(trimmed))return{stopOnly:true,command:''};
 if(interrupted){
  const m=BARGE_IN_LEAD_RE.exec(trimmed);
  if(m?.[1]?.trim())return{stopOnly:false,command:m[1].trim()};
 }
 return{stopOnly:false,command:trimmed};
}
const USER_ANSWER_PRONOUN_RE=/\b(?:my|i'm|im|we|our|yes|yeah|no|not|okay|ok|sure)\b|(?:ನಾನು|ನನ್ನ|ನಾವು|ಹೌದು|ಇಲ್ಲ|मेरा|हम|हाँ|जी|नहीं)/iu;
/** Rejects attenuated loudspeaker bleed when Thaara's own spoken sentence leaks back into the microphone. */
export function isLikelySpeakerEcho(raw:string,assistantSpeakingText?:string):boolean{
 if(!assistantSpeakingText||!raw.trim())return false;
 if(PURE_STOP_RE.test(raw)||BARGE_IN_LEAD_RE.test(raw))return false;
 const tok=(s:string)=>(s.toLowerCase().match(/[a-z0-9\u0900-\u097F\u0C80-\u0CFF]+/gu)??[]);
 const uWords=tok(raw),aWords=tok(assistantSpeakingText);
 if(uWords.length<2||aWords.length===0)return false;
 if(uWords.length>=3&&aWords.join(' ').includes(uWords.join(' ')))return true;
 if(USER_ANSWER_PRONOUN_RE.test(raw))return false;
 const aSet=new Set(aWords);
 const hits=uWords.filter(w=>aSet.has(w)).length;
 return uWords.length===2?hits===2:hits/uWords.length>=.75;
}
export type DetectedVoiceLanguage='en-IN'|'kn-IN'|'hi-IN';
export type TranscribeTurnResult=string|{transcript:string;detectedLanguage?:DetectedVoiceLanguage};
export type SessionState='listening'|'interrupted'|'transcribing'|'thinking'|'speaking'|'error';
interface SessionPorts{
 interrupt:()=>void;
 transcribe:(clip:Blob,signal:AbortSignal)=>Promise<TranscribeTurnResult>;
 submit:(text:string,signal:AbortSignal)=>Promise<string|undefined>;
 speak:(messageId:string,detectedLanguage?:DetectedVoiceLanguage)=>Promise<void>;
 state:(state:SessionState,message?:string)=>void;
 onTurnTranscript?:(userText:string)=>void;
 getAssistantText?:()=>string|undefined;
}
/** Each utterance owns a generation. Late network or Chat results cannot resume old audio. */
export class VoiceSession{
 private turn=0;private abort=new AbortController();private closed=false;private busy=false;private turnInterrupted=false;
 private lastLanguage:DetectedVoiceLanguage='en-IN';
 constructor(private ports:SessionPorts){}
 beginSpeech(){
  if(this.closed)return;
  this.turnInterrupted=this.busy;
  this.turn++;this.abort.abort();this.abort=new AbortController();this.ports.interrupt();this.ports.state('interrupted','Listening · previous speech stopped.');
 }
 discardSpeech(){
  if(this.closed)return;
  this.busy=false;
  this.ports.state('listening');
 }
 async finishSpeech(clip:Blob){
  if(this.closed)return;const turn=this.turn,signal=this.abort.signal,wasInterrupted=this.turnInterrupted;
  const current=()=>!this.closed&&!signal.aborted&&turn===this.turn;
  try{
   this.busy=true;
   this.ports.state('transcribing');
   const sttRes=await this.ports.transcribe(clip,signal);
   if(!current())return;
   const raw=(typeof sttRes==='string'?sttRes:sttRes.transcript).trim();
   const detected=typeof sttRes==='object'&&sttRes?.detectedLanguage?sttRes.detectedLanguage:undefined;
   if(detected)this.lastLanguage=detected;
   const parsed=normalizeSpokenTurn(raw,wasInterrupted);
   if(parsed.stopOnly){this.busy=false;this.ports.state('listening','Stopped · Listening for your next instruction.');return;}
   if(!parsed.command||(wasInterrupted&&isLikelySpeakerEcho(parsed.command,this.ports.getAssistantText?.()))){this.busy=false;this.ports.state('listening');return;}
   this.ports.onTurnTranscript?.(parsed.command);
   this.ports.state('thinking');
   const id=await this.ports.submit(parsed.command,signal);
   if(!current())return;
   if(id){
    this.ports.state('speaking');
    if(detected)await this.ports.speak(id,this.lastLanguage);
    else await this.ports.speak(id);
   }
   if(current()){this.busy=false;this.ports.state('listening');}
  }catch{if(current()){this.busy=false;this.ports.state('error','Voice request failed. Try speaking again or use text.');}}
 }
 /** Non-destructively verifies audio captured during thinking/synthesis/short speaker bursts before interrupting. */
 async interruptIfSpoken(clip:Blob,assistantSpeakingText?:string){
  if(this.closed)return;
  if(!this.busy){this.beginSpeech();await this.finishSpeech(clip);return;}
  const probe=new AbortController();
  let raw='',detected:DetectedVoiceLanguage|undefined;
  try{
   const sttRes=await this.ports.transcribe(clip,probe.signal);
   if(this.closed)return;
   raw=(typeof sttRes==='string'?sttRes:sttRes.transcript).trim();
   detected=typeof sttRes==='object'&&sttRes?.detectedLanguage?sttRes.detectedLanguage:undefined;
  }catch{return;}
  const parsed=normalizeSpokenTurn(raw,true);
  if(!parsed.stopOnly&&(!parsed.command||isLikelySpeakerEcho(parsed.command,assistantSpeakingText)))return;
  if(this.closed)return;
  this.turn++;this.abort.abort();this.abort=new AbortController();this.ports.interrupt();
  if(detected)this.lastLanguage=detected;
  if(parsed.stopOnly){this.busy=false;this.ports.state('listening','Stopped · Listening for your next instruction.');return;}
  const turn=this.turn,signal=this.abort.signal;
  const current=()=>!this.closed&&!signal.aborted&&turn===this.turn;
  try{
   this.busy=true;
   this.ports.onTurnTranscript?.(parsed.command);
   this.ports.state('thinking');
   const id=await this.ports.submit(parsed.command,signal);
   if(!current())return;
   if(id){
    this.ports.state('speaking');
    if(detected)await this.ports.speak(id,this.lastLanguage);
    else await this.ports.speak(id);
   }
   if(current()){this.busy=false;this.ports.state('listening');}
  }catch{if(current()){this.busy=false;this.ports.state('error','Voice request failed. Try speaking again or use text.');}}
 }
 close(){if(this.closed)return;this.closed=true;this.busy=false;this.turn++;this.abort.abort();this.ports.interrupt();}
}
