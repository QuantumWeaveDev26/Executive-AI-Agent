export type VoiceLanguage='auto'|'en-IN'|'kn-IN'|'hi-IN';
export type VoiceState='idle'|'requesting'|'listening'|'interrupted'|'transcribing'|'thinking'|'speaking'|'error';
export interface PlaybackTelemetry{
 messageId:string;
 language:VoiceLanguage;
 expectedChunks:number;
 decodedChunks:number;
 expectedDurationMs:number;
 playedDurationMs:number;
 startedAt:number;
 endedAt:number;
 completed:boolean;
 cancelledReason:string|null;
}
export class ChatVoiceScope{
 private version=0;private abort=new AbortController();
 constructor(public conversationId:string|null){}
 invalidate(){this.version++;this.abort.abort();this.abort=new AbortController();}
 select(id:string|null){if(id!==this.conversationId){this.invalidate();this.conversationId=id;}}
 capture(){const version=this.version,signal=this.abort.signal;return{signal,isCurrent:()=>this.version===version&&!signal.aborted};}
}
interface Ports{
 transcribe:(blob:Blob,language:VoiceLanguage,signal:AbortSignal)=>Promise<string>;
 speak:(messageId:string,language:VoiceLanguage,chunk:number,signal:AbortSignal)=>Promise<{audio:string;chunkCount:number}>;
 onTranscript:(text:string)=>void;onState:(state:VoiceState,message?:string)=>void;
 onOutputLevel?:(rms:number)=>void;
 onPlaybackTelemetry?:(telemetry:PlaybackTelemetry)=>void;
 getMedia?:()=>Promise<MediaStream>;makeRecorder?:(stream:MediaStream)=>MediaRecorder;makeAudio?:(url:string)=>HTMLAudioElement;
 context?:{signal:AbortSignal;isCurrent:()=>boolean};
}
/** One browser turn; cancellation fences late microphone, transcription and synthesis results. */
export class ChatVoiceController{
 private generation=0;private abort=new AbortController();private stream?:MediaStream;private recorder?:MediaRecorder;
 private audio?:HTMLAudioElement;private url?:string;private timer?:ReturnType<typeof setTimeout>;private prefetchTimer?:ReturnType<typeof setTimeout>;private drainTimer?:ReturnType<typeof setTimeout>;private finishAudio?:()=>void;
 private playbackCtx?:AudioContext;private activeSource?:AudioBufferSourceNode;private levelRaf?:ReturnType<typeof setInterval>;
 private scopeAbort=()=>this.cancel('scope_abort');
 public isAudioPlaying=false;
 public currentOutputRms=0;
 public lastPlayback:PlaybackTelemetry|null=null;
 private lastCancelReason:string|null=null;
 constructor(private ports:Ports){ports.context?.signal.addEventListener('abort',this.scopeAbort,{once:true});}
 dispose(){
  this.cancel();
  this.ports.context?.signal.removeEventListener('abort',this.scopeAbort);
  if(this.playbackCtx){void this.playbackCtx.close().catch(()=>{});this.playbackCtx=undefined;}
 }
 /** Call synchronously inside a user click gesture so browser autoplay never blocks TTS playback. */
 unlockAudio(){
  if(this.ports.makeAudio||typeof AudioContext==='undefined')return;
  try{
   if(!this.playbackCtx||this.playbackCtx.state==='closed')this.playbackCtx=new AudioContext();
   if(this.playbackCtx.state==='suspended')void this.playbackCtx.resume().catch(()=>{});
  }catch{}
 }
 private current(){return this.ports.context?.isCurrent()??true;}
 private stopWebAudio(){
  if(this.levelRaf){clearInterval(this.levelRaf);this.levelRaf=undefined;}
  clearTimeout(this.drainTimer);this.drainTimer=undefined;
  if(this.activeSource){
   try{this.activeSource.onended=null;this.activeSource.stop();}catch{}
   try{this.activeSource.disconnect();}catch{}
   this.activeSource=undefined;
  }
  this.isAudioPlaying=false;
  this.currentOutputRms=0;
  this.ports.onOutputLevel?.(0);
 }
 cancel(reason='user_or_session_cancel'){
  this.lastCancelReason=reason;
  this.generation++;this.abort.abort();this.abort=new AbortController();clearTimeout(this.timer);clearTimeout(this.prefetchTimer);clearTimeout(this.drainTimer);this.prefetchTimer=undefined;this.drainTimer=undefined;
  if(this.recorder?.state==='recording')this.recorder.stop();this.recorder=undefined;
  this.stream?.getTracks().forEach(t=>t.stop());this.stream=undefined;
  this.stopWebAudio();
  this.audio?.pause();if(this.audio)this.audio.src='';this.audio=undefined;this.isAudioPlaying=false;this.finishAudio?.();this.finishAudio=undefined;
  if(this.url)URL.revokeObjectURL(this.url);this.url=undefined;this.ports.onState('idle');
 }
 async start(language:VoiceLanguage){
  this.cancel();if(!this.current())return;const turn=this.generation;this.ports.onState('requesting');
  try{
   const stream=await(this.ports.getMedia?.()??navigator.mediaDevices.getUserMedia({audio:true}));
   if(turn!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}this.stream=stream;
   const create=this.ports.makeRecorder??((s:MediaStream)=>{
    const type=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
    return new MediaRecorder(s,type?{mimeType:type}:undefined);
   });
   const recorder=create(stream);this.recorder=recorder;const chunks:Blob[]=[];let size=0;
   recorder.ondataavailable=e=>{if(turn!==this.generation)return;size+=e.data.size;if(size>1_000_000){this.cancel();this.ports.onState('error','Recording too large. Please use a shorter message.');return;}if(e.data.size)chunks.push(e.data);};
   recorder.onerror=()=>{if(turn===this.generation){this.cancel();this.ports.onState('error','Microphone recording failed. Please try again.');}};
   recorder.onstop=()=>{
    stream.getTracks().forEach(t=>t.stop());if(turn!==this.generation)return;
    clearTimeout(this.timer);this.recorder=undefined;this.stream=undefined;
    void this.transcribeClip(new Blob(chunks,{type:recorder.mimeType.split(';')[0]||'audio/webm'}),language);
   };
   recorder.start(250);this.timer=setTimeout(()=>this.stopRecording(),25000);this.ports.onState('listening');
  }catch{if(turn===this.generation){this.cancel();this.ports.onState('error','Microphone unavailable. Allow microphone access and try again.');}}
 }
 stopRecording(){if(this.recorder?.state==='recording')this.recorder.stop();}
 async transcribeClip(blob:Blob,language:VoiceLanguage){
  const turn=this.generation;this.ports.onState('transcribing');
  try{if(!this.current()||blob.size<12||blob.size>1_000_000)throw Error();const text=await this.ports.transcribe(blob,language,this.abort.signal);if(turn!==this.generation||!this.current())return;this.ports.onTranscript(text);this.ports.onState('idle','Review the transcript, then use Send.');}
  catch{if(turn===this.generation)this.ports.onState('error','Transcription unavailable. Please try again or type your message.');}
 }
 private async playDecodedBuffer(bytes:Uint8Array,turn:number,signal:AbortSignal):Promise<{played:boolean;durationMs:number}>{
  if(this.ports.makeAudio||typeof AudioContext==='undefined')return{played:false,durationMs:0};
  try{
   if(!this.playbackCtx||this.playbackCtx.state==='closed')this.playbackCtx=new AudioContext();
   if(this.playbackCtx.state==='suspended')await this.playbackCtx.resume();
   if(turn!==this.generation||!this.current())return{played:true,durationMs:0};
   const copy=new ArrayBuffer(bytes.byteLength);
   new Uint8Array(copy).set(bytes);
   const decoded=await this.playbackCtx.decodeAudioData(copy);
   const durationMs=Math.round(decoded.duration*1000);
   if(turn!==this.generation||!this.current())return{played:true,durationMs};
   const source=this.playbackCtx.createBufferSource();
   source.buffer=decoded;
   const analyser=this.playbackCtx.createAnalyser();
   analyser.fftSize=256;
   const data=new Float32Array(analyser.fftSize);
   source.connect(analyser);
   analyser.connect(this.playbackCtx.destination);
   this.activeSource=source;
   this.isAudioPlaying=true;
   this.levelRaf=setInterval(()=>{
    if(turn!==this.generation||!this.activeSource)return;
    analyser.getFloatTimeDomainData(data);
    let sum=0;for(let i=0;i<data.length;i++)sum+=data[i]*data[i];
    const rms=Math.sqrt(sum/data.length);
    this.currentOutputRms=rms;
    this.ports.onOutputLevel?.(rms);
   },33);
   await new Promise<void>(resolve=>{
    this.finishAudio=resolve;
    source.onended=()=>{
     if(turn!==this.generation||signal.aborted||!this.current()){resolve();return;}
     const ctxAny=this.playbackCtx as (AudioContext&{outputLatency?:number})|undefined;
     const hwSec=(ctxAny?.outputLatency??0)+(ctxAny?.baseLatency??0);
     const drainMs=Math.min(180,Math.max(45,Math.round(hwSec*1000)+35));
     this.drainTimer=setTimeout(resolve,drainMs);
    };
    source.start(0);
   });
   this.stopWebAudio();
   this.finishAudio=undefined;
   return{played:true,durationMs};
  }catch{
   this.stopWebAudio();
   return{played:false,durationMs:0};
  }
 }
 async play(messageId:string,language:VoiceLanguage){
  this.cancel('new_playback_start');if(!this.current())return;
  this.lastCancelReason=null;
  const turn=this.generation,signal=this.abort.signal;this.ports.onState('speaking');
  const telemetry:PlaybackTelemetry={
   messageId,language,expectedChunks:1,decodedChunks:0,expectedDurationMs:0,playedDurationMs:0,
   startedAt:Date.now(),endedAt:0,completed:false,cancelledReason:null
  };
  this.lastPlayback=telemetry;
  try{
   let count=1;
   let nextFetch:Promise<{audio:string;chunkCount:number}>|undefined=this.ports.speak(messageId,language,0,signal);
   for(let chunk=0;chunk<count;chunk++){
    const result=await(nextFetch??this.ports.speak(messageId,language,chunk,signal));
    nextFetch=undefined;
    if(turn!==this.generation||!this.current()){
     telemetry.endedAt=Date.now();telemetry.cancelledReason=this.lastCancelReason??'cancelled_before_decode';
     this.ports.onPlaybackTelemetry?.({...telemetry});
     return;
    }
    if(!Number.isInteger(result.chunkCount)||result.chunkCount<1||result.chunkCount>8)throw Error();
    count=result.chunkCount;
    telemetry.expectedChunks=count;
    if(chunk+1<count){
     const nextChunk=chunk+1;
     this.prefetchTimer=setTimeout(()=>{
      this.prefetchTimer=undefined;
      if(turn===this.generation&&this.current()&&!signal.aborted){
       nextFetch=this.ports.speak(messageId,language,nextChunk,signal);
       nextFetch.catch(()=>{});
      }
     },150);
    }
    const raw=atob(result.audio);
    const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    const chunkStart=Date.now();
    const webRes=await this.playDecodedBuffer(bytes,turn,signal);
    if(webRes.played){
     telemetry.decodedChunks++;
     telemetry.expectedDurationMs+=webRes.durationMs;
     telemetry.playedDurationMs+=Math.max(0,Date.now()-chunkStart);
    }
    if(turn!==this.generation||!this.current()){
     telemetry.endedAt=Date.now();telemetry.cancelledReason=this.lastCancelReason??'interrupted_during_playback';
     this.ports.onPlaybackTelemetry?.({...telemetry});
     return;
    }
    if(!webRes.played){
     this.url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
     const audio=(this.ports.makeAudio??(url=>new Audio(url)))(this.url);this.audio=audio;this.isAudioPlaying=true;
     const elStart=Date.now();
     await new Promise<void>((resolve,reject)=>{this.finishAudio=resolve;audio.onended=()=>resolve();audio.onerror=()=>reject(Error());void audio.play().catch(reject);});
     this.isAudioPlaying=false;
     telemetry.decodedChunks++;
     telemetry.playedDurationMs+=Math.max(0,Date.now()-elStart);
     if(turn!==this.generation){
      telemetry.endedAt=Date.now();telemetry.cancelledReason=this.lastCancelReason??'interrupted_during_audio_element';
      this.ports.onPlaybackTelemetry?.({...telemetry});
      return;
     }
     this.finishAudio=undefined;if(this.url)URL.revokeObjectURL(this.url);this.url=undefined;this.audio=undefined;
    }
    clearTimeout(this.prefetchTimer);this.prefetchTimer=undefined;
    if(turn!==this.generation){
     telemetry.endedAt=Date.now();telemetry.cancelledReason=this.lastCancelReason??'interrupted_between_chunks';
     this.ports.onPlaybackTelemetry?.({...telemetry});
     return;
    }
   }
   telemetry.completed=telemetry.decodedChunks===count;
   telemetry.endedAt=Date.now();
   this.ports.onPlaybackTelemetry?.({...telemetry});
   this.ports.onState('idle');
   return true;
  }catch{
   telemetry.endedAt=Date.now();
   telemetry.cancelledReason=this.lastCancelReason??'playback_error';
   this.ports.onPlaybackTelemetry?.({...telemetry});
   if(turn===this.generation){this.cancel('playback_error');this.ports.onState('error','Spoken response unavailable. You can read the response in Chat.');}
  }
 }
}
