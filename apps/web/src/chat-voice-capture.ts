import {VoiceActivityDetector} from './chat-voice-session';
import {encodeVoiceWave} from './chat-voice-wave';

export interface VoiceCaptureHandle {
 ():void;
 setMuted:(muted:boolean)=>void;
}

export interface VoiceCaptureExtras {
 onDiscard?:()=>void;
 onLevel?:(rms:number)=>void;
 isProcessing?:()=>boolean;
 onVerifyInterruptClip?:(wave:Blob)=>void;
 getOutputRms?:()=>number;
}

/** Persistent capture has its own lifetime, independent of individual STT/TTS requests. */
export async function startVoiceCapture(
 signal:AbortSignal,
 onStart:()=>void,
 onClip:(wave:Blob)=>void,
 onError:(message:string)=>void,
 isPlaybackActive?:()=>boolean,
 extras?:VoiceCaptureExtras
):Promise<VoiceCaptureHandle>{
 let stream:MediaStream|undefined,context:AudioContext|undefined,source:MediaStreamAudioSourceNode|undefined,node:AudioWorkletNode|undefined;
 let timer:ReturnType<typeof setTimeout>|undefined;let stopped=false;let muted=false;let frameTick=0;
 const setMuted=(next:boolean)=>{
  muted=next;
  stream?.getAudioTracks().forEach(t=>{if('enabled' in t)t.enabled=!next;});
  if(next)extras?.onLevel?.(0);
 };
 const stopCore=()=>{
  if(stopped)return;
  stopped=true;clearTimeout(timer);signal.removeEventListener('abort',stopCore);
  node?.disconnect();if(node)node.port.onmessage=null;source?.disconnect();
  stream?.getTracks().forEach(t=>t.stop());
  void context?.close().catch(()=>{});
 };
 const handle=Object.assign(stopCore,{setMuted});
 signal.addEventListener('abort',stopCore,{once:true});
 try{
  if(signal.aborted)throw Error();
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});
  if(stopped){stream.getTracks().forEach(t=>t.stop());return handle;}
  // Fail closed rather than feed the agent's speaker output back as new commands.
  if(stream.getAudioTracks()[0]?.getSettings().echoCancellation!==true)throw Error('echo');
  try{context=new AudioContext({sampleRate:16000});}catch{context=new AudioContext();}
  await context.audioWorklet.addModule('/assets/chat-voice-processor-v1.js');if(stopped)return handle;
  await context.resume();if(stopped)return handle;
  source=context.createMediaStreamSource(stream);node=new AudioWorkletNode(context,'thaara-voice-v1');
  const vad=new VoiceActivityDetector(46);let pre:Float32Array[]=[],frames:Float32Array[]=[],active=false,discard=false,started=false,voicedFrames=0,utteranceMode:'listen'|'process'|'play'='listen',wasBusy=false;
  node.port.onmessage=e=>{
   if(stopped||signal.aborted)return;
   const frame=e.data as Float32Array;if(!(frame instanceof Float32Array)||frame.length!==320)return;
   if(muted){
    if(active){active=false;frames=[];pre=[];voicedFrames=0;vad.resetActive();if(started){started=false;extras?.onDiscard?.();}}
    return;
   }
   const playing=Boolean(isPlaybackActive?.()),processing=!playing&&Boolean(extras?.isProcessing?.());
   const nowBusy=playing||processing;
   if(wasBusy&&!nowBusy&&active&&!started){
    // Playback/processing ended without a confirmed barge-in: clear residual speaker/room gate so Listening starts fresh
    vad.resetActive();active=false;frames=[];voicedFrames=0;utteranceMode='listen';
   }
   wasBusy=nowBusy;
   const outRms=playing?(extras?.getOutputRms?.()??0):0;
   const bargeFloor=Math.max(.045,outRms*.75);
   vad.setPlaybackActive(playing||processing);
   const event=vad.push(frame);
   if((++frameTick&1)===0)extras?.onLevel?.(vad.lastRms);
   if(!active){pre.push(frame);if(pre.length>20)pre.shift();}
   if(event==='start'){
    active=true;discard=false;frames=pre;pre=[];
    utteranceMode=playing?'play':processing?'process':'listen';
    voicedFrames=utteranceMode==='play'?(vad.lastRms>bargeFloor?1:0):6;
    if(utteranceMode==='listen'){started=true;onStart();}else{started=false;}
   }else if(active&&!discard){
    frames.push(frame);
    const frameFloor=utteranceMode==='play'?bargeFloor:utteranceMode==='process'?.024:.014;
    if(vad.lastRms>frameFloor)voicedFrames++;
    if(!started&&utteranceMode==='play'&&voicedFrames>=24){started=true;onStart();}
   }
   if(active&&frames.length>1250){frames=[];discard=true;started=false;onError('Please use a shorter instruction (under 25 seconds).');}
   if(event==='end'){
    active=false;
    if(!discard&&frames.length){
     const pcm=()=>encodeVoiceWave((()=>{const out=new Float32Array(frames.length*320);frames.forEach((f,i)=>out.set(f,i*320));return out;})());
     if(utteranceMode==='listen'){
      if(voicedFrames>=7){if(!started){started=true;onStart();}onClip(pcm());}
      else if(started){extras?.onDiscard?.();}
     }else if(utteranceMode==='process'){
      if(voicedFrames>=14){
       if(extras?.onVerifyInterruptClip)extras.onVerifyInterruptClip(pcm());
       else{onStart();onClip(pcm());}
      }
     }else{
      if(started&&voicedFrames>=24){onClip(pcm());}
      else if(!started&&voicedFrames>=14&&extras?.onVerifyInterruptClip){extras.onVerifyInterruptClip(pcm());}
      else if(started){extras?.onDiscard?.();}
     }
    }else if(!discard&&started){
     extras?.onDiscard?.();
    }
    frames=[];voicedFrames=0;started=false;
   }
  };
  source.connect(node);node.connect(context.destination);
  timer=setTimeout(()=>{stopCore();onError('Voice session paused after inactivity. Tap the voice button to continue.');},1800000);
  stream.getTracks().forEach(track=>track.addEventListener('ended',()=>{if(!stopped){stopCore();onError('Microphone disconnected. Tap the voice button to reconnect.');}},{once:true}));
  return handle;
 }catch(error){
  stopCore();
  if(!signal.aborted){
   onError(error instanceof Error&&error.message==='echo'
    ?'Browser echo cancellation is required for hands-free voice on this audio device.'
    :'Microphone access is required for voice mode. Please allow microphone permission in your browser.');
  }
  return handle;
 }
}
