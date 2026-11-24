/* Emits mono 16k PCM frames (320 samples = 20ms); resamples if hardware AudioContext rate !== 16000; never monitors mic to speakers. */
class ThaaraVoiceProcessor extends AudioWorkletProcessor {
 constructor(){
  super();
  this.frame=new Float32Array(320);
  this.offset=0;
  this.srcPos=0;
  this.prevSample=0;
  this.hasPrev=false;
 }
 pushSample(s){
  this.frame[this.offset++]=s;
  if(this.offset===320){
   this.port.postMessage(this.frame,[this.frame.buffer]);
   this.frame=new Float32Array(320);
   this.offset=0;
  }
 }
 process(inputs,outputs){
  const input=inputs[0]?.[0];
  const rate=typeof sampleRate==='number'&&sampleRate>0?sampleRate:16000;
  if(input&&input.length>0){
   if(rate===16000){
    for(const sample of input)this.pushSample(sample);
   }else{
    const step=rate/16000;
    const n=input.length;
    if(!this.hasPrev){this.prevSample=input[0];this.hasPrev=true;}
    while(this.srcPos<n){
     const idx=Math.floor(this.srcPos);
     const frac=this.srcPos-idx;
     const s0=idx===0?this.prevSample:input[idx-1];
     const s1=input[idx];
     this.pushSample(s0+(s1-s0)*frac);
     this.srcPos+=step;
    }
    this.srcPos-=n;
    this.prevSample=input[n-1];
   }
  }
  // Read first: browsers may provide an in-place input/output buffer.
  for(const output of outputs)for(const channel of output)channel.fill(0);
  return true;
 }
}
registerProcessor('thaara-voice-v1',ThaaraVoiceProcessor);
