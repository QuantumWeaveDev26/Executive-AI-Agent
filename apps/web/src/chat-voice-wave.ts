/** Canonical mono16kHz PCM WAV: server can verify duration without decoding compressed media. */
export function encodeVoiceWave(samples:Float32Array):Blob{
 if(!samples.length||samples.length>400000)throw Error('Voice recording exceeds25seconds.');
 const bytes=new ArrayBuffer(44+samples.length*2),v=new DataView(bytes);
 const text=(offset:number,s:string)=>{for(let i=0;i<s.length;i++)v.setUint8(offset+i,s.charCodeAt(i));};
 text(0,'RIFF');v.setUint32(4,bytes.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,samples.length*2,true);
 for(let i=0;i<samples.length;i++){const value=Math.max(-1,Math.min(1,samples[i]!));v.setInt16(44+i*2,value<0?value*32768:value*32767,true);}return new Blob([bytes],{type:'audio/wav'});
}
export async function toVoiceWave(blob:Blob):Promise<Blob>{
 const context=new AudioContext();
 try{
  const decoded=await context.decodeAudioData(await blob.arrayBuffer());if(!Number.isFinite(decoded.duration)||decoded.duration<=0||decoded.duration>25)throw Error('Recording too long.');
  const offline=new OfflineAudioContext(1,Math.ceil(decoded.duration*16000),16000),source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();
  return encodeVoiceWave((await offline.startRendering()).getChannelData(0));
 }finally{await context.close();}
}
