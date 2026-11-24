import {describe,expect,it,vi} from 'vitest';
import {createSarvamStreamingStt,createSarvamTts,createSarvamReportVoice,type WebSocketLike} from '../src/services/phone-sarvam.js';
import {mulawToPcm16,pcm16ToMulaw,readWavPcm16,resample,upsample2x,writeWavPcm16} from '../src/services/phone-audio-codec.js';
import {charErrorRate,normalizeSpeech,wordErrorRate} from '../src/services/phone-speech-metrics.js';

// Fake WebSocket only: nothing leaves the process. Key is synthetic.
const KEY='synthetic-sarvam-key-0123';
class FakeSocket implements WebSocketLike{
 readyState=0;sent:Record<string,unknown>[]=[];closedWith:number|undefined;
 private l:Record<string,((e:{data?:unknown;code?:number})=>void)[]>={};
 constructor(readonly url:string,readonly headers:Record<string,string>){}
 addEventListener(t:string,f:(e:{data?:unknown;code?:number})=>void){(this.l[t]??=[]).push(f);}
 emit(t:string,e:{data?:unknown;code?:number}={}){for(const f of this.l[t]??[])f(e);}
 open(){this.readyState=1;this.emit('open');}
 server(m:unknown){this.emit('message',{data:JSON.stringify(m)});}
 send(d:string){this.sent.push(JSON.parse(d));this.onSend?.(JSON.parse(d));}
 onSend?:(m:Record<string,unknown>)=>void;
 close(code?:number){if(this.readyState===3)return;this.readyState=3;this.closedWith=code;this.emit('close',{code});}
}
const credentials={resolve:async()=>({apiKey:KEY})};

describe('owner report speech, fake Sarvam socket only',()=>{
 it('never connects for an already cancelled request',async()=>{
  const connect=vi.fn();const controller=new AbortController();controller.abort();
  await expect(createSarvamReportVoice({credentials,connect}).speak('Ram said no.','en-IN',controller.signal)).rejects.toThrow(/abort/i);
  expect(connect).not.toHaveBeenCalled();
 });
 it('returns browser WAV from bounded PCM and sends only the supplied report',async()=>{
  let socket!:FakeSocket;
  const voice=createSarvamReportVoice({credentials,connect:(url,headers)=>{
   socket=new FakeSocket(url,headers);socket.onSend=m=>{if(m.type==='flush'){
    socket.server({type:'audio',data:{audio:Buffer.from(new Uint8Array([1,0,2,0])).toString('base64'),content_type:'audio/pcm'}});
    socket.server({type:'event',data:{event_type:'final'}});
   }};queueMicrotask(()=>socket.open());return socket;
  }});
  const wav=await voice.speak('Provider report is unverified. Ram said no.','en-IN',AbortSignal.timeout(2000));
  expect(readWavPcm16(wav).sampleRate).toBe(22050);
  expect(socket.sent[1]).toEqual({type:'text',data:{text:'Provider report is unverified. Ram said no.'}});
  expect(socket.closedWith).toBe(1000);
 });
});

describe('phone audio codec and speech metrics',()=>{
 it('round-trips mu-law within G.711 quantisation and handles silence',()=>{
  const pcm=Int16Array.from([0,100,-100,1000,-1000,8000,-8000,32000,-32000]);
  const back=mulawToPcm16(pcm16ToMulaw(pcm));
  pcm.forEach((s,i)=>expect(Math.abs(back[i]!-s)).toBeLessThanOrEqual(Math.max(8,Math.abs(s)*0.07)));
  expect(pcm16ToMulaw(Int16Array.from([0]))[0]).toBe(0xff);
  expect(upsample2x(Int16Array.from([0,100])).length).toBe(4);
  expect(resample(new Int16Array(44100),44100,8000).length).toBe(8000);
 });
 it('reads and writes 16-bit PCM WAV and rejects other formats',()=>{
  const pcm=Int16Array.from([1,-2,3,-4]);const wav=writeWavPcm16(pcm,8000);
  expect(readWavPcm16(wav)).toEqual({sampleRate:8000,pcm});
  expect(()=>readWavPcm16(new Uint8Array(10))).toThrow();
  const bad=wav.slice();new DataView(bad.buffer).setUint16(34,8,true);expect(()=>readWavPcm16(bad)).toThrow(/16-bit/);
 });
 it('computes word and character error rates on normalised text, including Kannada',()=>{
  expect(normalizeSpeech('Yes, I CAN attend!')).toBe('yes i can attend');
  expect(wordErrorRate('yes I can attend','yes I can attend')).toBe(0);
  expect(wordErrorRate('yes I can attend','yes I cannot attend')).toBe(0.25);
  expect(charErrorRate('ನಾಳೆ ಬರುತ್ತೇನೆ','ನಾಳೆ ಬರುತ್ತೇನೆ')).toBe(0);
  expect(charErrorRate('ನಾಳೆ','ನಾಳ')).toBeGreaterThan(0);
 });
});

describe('Sarvam streaming speech-to-text adapter (fake socket)',()=>{
 function stt(language:'en-IN'|'kn-IN'|'kn-en'='kn-IN'){
  let socket!:FakeSocket;const onError=vi.fn();
  const s=createSarvamStreamingStt({language,credentials,onError,connect:(u,h)=>(socket=new FakeSocket(u,h))});
  return {s,socket:()=>socket,onError};
 }
 it('connects with the key only in the header and phone-path settings in the URL',async()=>{
  const h=stt('kn-en');await Promise.resolve();await Promise.resolve();
  const u=new URL(h.socket().url);
  expect(u.origin+u.pathname).toBe('wss://api.sarvam.ai/speech-to-text/ws');
  expect(Object.fromEntries(u.searchParams)).toEqual({'language-code':'kn-IN',model:'saaras:v4',mode:'codemix',sample_rate:'16000',input_audio_codec:'pcm_s16le',vad_signals:'true'});
  expect(h.socket().headers).toEqual({'Api-Subscription-Key':KEY});expect(h.socket().url).not.toContain(KEY);
  h.socket().open();await h.s.ready;
 });
 it('queues audio until open, converts mu-law 8 kHz to 16 kHz PCM, and emits only final text as evidence',async()=>{
  const h=stt();const seen:unknown[]=[];h.s.onTranscript(t=>seen.push(t));
  h.s.push(new Uint8Array(160).fill(0xff));
  await Promise.resolve();await Promise.resolve();
  expect(h.socket().sent).toEqual([]);
  h.socket().open();await h.s.ready;
  expect(h.socket().sent).toHaveLength(1);
  const audio=h.socket().sent[0]!.audio as {data:string;sample_rate:string;encoding:string};
  expect(audio).toMatchObject({sample_rate:'16000',encoding:'audio/wav'});
  expect(Buffer.from(audio.data,'base64').byteLength).toBe(640);
  h.socket().server({type:'events',data:{signal_type:'START_SPEECH'}});
  h.socket().server({type:'data',data:{request_id:'r',transcript:'  ನಾಳೆ ಬರುತ್ತೇನೆ ',metrics:{audio_duration:1,processing_latency:0.1}}});
  h.socket().server({type:'data',data:{request_id:'r',transcript:'   '}});
  h.socket().emit('message',{data:'not json'});
  expect(seen).toEqual([{id:'sv-1',text:'…',final:false},{id:'sv-1',text:'ನಾಳೆ ಬರುತ್ತೇನೆ',final:true}]);
  h.s.push(new Uint8Array(20000));expect(h.socket().sent).toHaveLength(1);
 });
 it('reports provider errors with a fixed code and closes',async()=>{
  const h=stt();await Promise.resolve();await Promise.resolve();h.socket().open();await h.s.ready;
  h.socket().server({type:'error',data:{error:`bad key ${KEY}`,code:'invalid_api_key'}});
  expect(h.onError).toHaveBeenCalledWith('SARVAM_STT_invalid_api_key');expect(h.socket().closedWith).toBe(1011);
  expect(JSON.stringify(h.onError.mock.calls)).not.toContain(KEY);
 });
});

describe('Sarvam text-to-speech adapter (fake socket)',()=>{
 function tts(reply:(s:FakeSocket,m:Record<string,unknown>)=>void){
  let socket!:FakeSocket;
  const t=createSarvamTts({credentials,connect:(u,h)=>{socket=new FakeSocket(u,h);socket.onSend=m=>reply(socket,m);queueMicrotask(()=>socket.open());return socket;}});
  return {t,socket:()=>socket};
 }
 const audioMsg=(bytes:Uint8Array,type='audio/x-mulaw')=>({type:'audio',data:{content_type:type,audio:Buffer.from(bytes).toString('base64')}});
 it('asks for mu-law 8 kHz Bulbul v3 audio, returns it unchanged, and keeps the key out of the URL',async()=>{
  const h=tts((s,m)=>{if(m.type==='flush'){s.server(audioMsg(new Uint8Array([1,2,3])));s.server(audioMsg(new Uint8Array([4])));s.server({type:'event',data:{event_type:'final'}});}});
  const r=await h.t.synthesize('Hello, I am Thaara, an AI assistant.','en-IN',AbortSignal.timeout(2000));
  expect([...r.audio]).toEqual([1,2,3,4]);expect(h.t.lastContentType).toBe('audio/x-mulaw');
  // Thaara's female voice by default, English slightly slower (owner feedback).
  expect(h.socket().sent[0]).toEqual({type:'config',data:{language_code:'en-IN',speaker:'kavya',model:'bulbul:v3',pace:0.9,speech_sample_rate:'8000',output_audio_codec:'mulaw'}});
  expect(h.socket().sent.slice(1)).toEqual([{type:'text',data:{text:'Hello, I am Thaara, an AI assistant.'}},{type:'flush'}]);
  expect(h.socket().url).toBe('wss://api.sarvam.ai/text-to-speech/ws?model=bulbul%3Av3&send_completion_event=true');
  expect(h.socket().headers).toEqual({'Api-Subscription-Key':KEY});
 });
 it('voices mixed-script Kanglish with the Kannada model, converts linear PCM, and refuses formats it cannot play',async()=>{
  const pcm=new Uint8Array(new Int16Array([0,1000,-1000]).buffer);
  const lin=tts((s,m)=>{if(m.type==='flush'){s.server(audioMsg(pcm,'audio/l16'));s.server({type:'event',data:{event_type:'final'}});}});
  const r=await lin.t.synthesize('ನಮಸ್ಕಾರ, ನಾನು ತಾರಾ, AI assistant.','kn-en',AbortSignal.timeout(2000));
  expect(r.audio.byteLength).toBe(3);expect(lin.socket().sent[0]!.data).toMatchObject({language_code:'kn-IN',pace:0.95,speaker:'kavya'});
  expect(()=>createSarvamTts({credentials,pace:{'en-IN':3}})).toThrow(/pace/);
  const mp3=tts((s,m)=>{if(m.type==='flush'){s.server(audioMsg(new Uint8Array([9]),'audio/mp3'));s.server({type:'event',data:{event_type:'final'}});}});
  await expect(mp3.t.synthesize('Hi','kn-IN',AbortSignal.timeout(2000))).rejects.toThrow(/unplayable format: audio\/mp3/);
  const err=tts((s,m)=>{if(m.type==='flush')s.server({type:'error',data:{message:'quota'}});});
  await expect(err.t.synthesize('Hi','en-IN',AbortSignal.timeout(2000))).rejects.toThrow(/Sarvam TTS error/);
  const slow=tts(()=>{});
  await expect(slow.t.synthesize('Hi','en-IN',AbortSignal.timeout(50))).rejects.toThrow(/aborted/);
  expect(()=>createSarvamTts({credentials,speaker:'Bad Name'})).toThrow();
  await expect(slow.t.synthesize('x'.repeat(2501),'en-IN',AbortSignal.timeout(50))).rejects.toThrow(/rejected/);
 });
});

describe('Node built-in WebSocket header support (local loopback server only)',()=>{
 it('sends the Api-Subscription-Key header on the upgrade request',async()=>{
  const {default:Fastify}=await import('fastify');const {default:websocket}=await import('@fastify/websocket');
  const {nodeWebSocketConnect}=await import('../src/services/phone-sarvam.js');
  const app=Fastify();await app.register(websocket);
  let seen:string|undefined;
  app.get('/probe',{websocket:true},(socket,req)=>{seen=req.headers['api-subscription-key'] as string;socket.close(1000,'ok');});
  await app.listen({host:'127.0.0.1',port:0});
  try{
   const port=(app.server.address() as {port:number}).port;
   const ws=nodeWebSocketConnect(`ws://127.0.0.1:${port}/probe`,{'Api-Subscription-Key':KEY});
   await new Promise<void>((resolve,reject)=>{
    ws.addEventListener('error',()=>reject(new Error(`Loopback websocket failed on ${process.version}`)));
    ws.addEventListener('close',()=>resolve());
   });
   expect(seen).toBe(KEY);
  }finally{await app.close();}
 });
});

describe('phone persona and fixed lines (from the Thaara personality specification)',()=>{
 it('keeps the AI identity, one short sentence and the mixed-script Kanglish rule in the dialogue instructions',async()=>{
  const {buildPhoneDialogueInstructions}=await import('../src/services/phone-persona.js');
  const p=buildPhoneDialogueInstructions('kn-en','Ask whether Ram can attend tomorrow.');
  expect(p).toContain('You are Thaara');expect(p).toContain('You are an AI');expect(p).toContain('Bengaluru');
  expect(p).toContain('ONE short spoken sentence');expect(p).toContain('Never claim to be a human');
  expect(p).toContain('Kannada words in Kannada script');expect(p).toContain('Ask whether Ram can attend tomorrow.');
  expect(buildPhoneDialogueInstructions('kn-IN','x')).toContain('Kannada script');
 });
 it('writes the Kanglish fixed lines in mixed script and keeps them honest about being an AI',async()=>{
  const {AI_DISCLOSURES}=await import('../src/services/phone-conversation.js');
  const {IDENTITY_ANSWERS,CLOSINGS}=await import('../src/services/phone-voice.js');
  for(const line of [AI_DISCLOSURES['kn-en'],IDENTITY_ANSWERS['kn-en'],CLOSINGS['kn-en']]){
   expect(line).toMatch(/[ಀ-೿]/);expect(line).not.toMatch(/\b(naanu|namaskara|maadu)\b/i);
  }
  for(const l of ['en-IN','kn-IN','kn-en'] as const){expect(AI_DISCLOSURES[l]).toMatch(/AI/);expect(IDENTITY_ANSWERS[l]).toMatch(/AI/);}
 });
});
