/** G.711 mu-law <-> 16-bit PCM and simple 8 kHz <-> 16 kHz resampling for the phone audio path. No dependencies. */
const BIAS=0x84,CLIP=32635;

export function mulawToPcm16(input:Uint8Array):Int16Array{
 const out=new Int16Array(input.length);
 for(let i=0;i<input.length;i++){
  const u=~input[i]!&0xff,sign=u&0x80,exponent=(u>>4)&0x07,mantissa=u&0x0f;
  const magnitude=(((mantissa<<3)+BIAS)<<exponent)-BIAS;
  out[i]=sign?-magnitude:magnitude;
 }
 return out;
}

export function pcm16ToMulaw(input:Int16Array):Uint8Array{
 const out=new Uint8Array(input.length);
 for(let i=0;i<input.length;i++){
  let s=input[i]!;const sign=s<0?0x80:0;
  if(sign)s=-s;
  if(s>CLIP)s=CLIP;
  s+=BIAS;
  let exponent=7;for(let mask=0x4000;(s&mask)===0&&exponent>0;mask>>=1)exponent--;
  const mantissa=(s>>(exponent+3))&0x0f;
  out[i]=~(sign|(exponent<<4)|mantissa)&0xff;
 }
 return out;
}

/** Linear-interpolation 2x upsample (8 kHz -> 16 kHz). Adequate for speech recognition input. */
export function upsample2x(input:Int16Array):Int16Array{
 const out=new Int16Array(input.length*2);
 for(let i=0;i<input.length;i++){const a=input[i]!,b=i+1<input.length?input[i+1]!:a;out[2*i]=a;out[2*i+1]=(a+b)>>1;}
 return out;
}

/** Resample any rate to a target rate by linear interpolation (used for test recordings, not the live path). */
export function resample(input:Int16Array,from:number,to:number):Int16Array{
 if(from===to)return input.slice();
 const length=Math.max(1,Math.floor(input.length*to/from)),out=new Int16Array(length);
 for(let i=0;i<length;i++){const pos=i*from/to,j=Math.floor(pos),f=pos-j,a=input[j]??0,b=input[j+1]??a;out[i]=Math.round(a+(b-a)*f);}
 return out;
}

export const pcm16ToBytes=(pcm:Int16Array)=>{const b=new Uint8Array(pcm.length*2),v=new DataView(b.buffer);pcm.forEach((s,i)=>v.setInt16(i*2,s,true));return b;};
export const bytesToPcm16=(b:Uint8Array)=>{const v=new DataView(b.buffer,b.byteOffset,b.byteLength),out=new Int16Array(Math.floor(b.byteLength/2));for(let i=0;i<out.length;i++)out[i]=v.getInt16(i*2,true);return out;};

/** Minimal WAV reader: PCM 16-bit, any channel count (mixed to mono). */
export function readWavPcm16(file:Uint8Array):{sampleRate:number;pcm:Int16Array}{
 const v=new DataView(file.buffer,file.byteOffset,file.byteLength),tag=(o:number)=>String.fromCharCode(file[o]!,file[o+1]!,file[o+2]!,file[o+3]!);
 if(file.byteLength<44||tag(0)!=='RIFF'||tag(8)!=='WAVE')throw new Error('Not a WAV file');
 let offset=12,format=0,channels=0,rate=0,bits=0;
 while(offset+8<=file.byteLength){
  const id=tag(offset),size=v.getUint32(offset+4,true),body=offset+8;
  if(id==='fmt '){format=v.getUint16(body,true);channels=v.getUint16(body+2,true);rate=v.getUint32(body+4,true);bits=v.getUint16(body+14,true);}
  if(id==='data'){
   if(format!==1||bits!==16||channels<1)throw new Error('Only 16-bit PCM WAV is supported');
   const frames=Math.floor(Math.min(size,file.byteLength-body)/(2*channels)),pcm=new Int16Array(frames);
   for(let i=0;i<frames;i++){let sum=0;for(let c=0;c<channels;c++)sum+=v.getInt16(body+(i*channels+c)*2,true);pcm[i]=Math.round(sum/channels);}
   return {sampleRate:rate,pcm};
  }
  offset=body+size+(size%2);
 }
 throw new Error('WAV has no data chunk');
}

export function writeWavPcm16(pcm:Int16Array,sampleRate:number):Uint8Array{
 const data=pcm16ToBytes(pcm),out=new Uint8Array(44+data.byteLength),v=new DataView(out.buffer),w=(o:number,s:string)=>{for(let i=0;i<4;i++)out[o+i]=s.charCodeAt(i);};
 w(0,'RIFF');v.setUint32(4,36+data.byteLength,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
 v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,data.byteLength,true);out.set(data,44);
 return out;
}
