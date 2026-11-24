import {describe,expect,it,vi} from 'vitest';
import {AI_DISCLOSURES} from '../src/services/phone-conversation.js';
import {PhoneVoiceSession,CLOSINGS} from '../src/services/phone-voice.js';
import {PlivoAudioBridge,admitPlivoStreamUpgrade,plivoStreamAnswerXml,type PhoneStreamingSpeechToText} from '../src/services/phone-audio-bridge.js';
import {createMemoryNonceStore} from '../src/services/phone-callback-admission.js';

// Fake transport, speech-to-text, dialogue and text-to-speech. "Audio" is UTF-8 text so tests can read what was played.
const callUuid='cccccccc-3333-4333-8333-333333333333',callId='aaaaaaaa-1111-4111-8111-111111111111';
const b64=(s:string)=>Buffer.from(s).toString('base64');
function harness(replies:unknown[]=[{text:'Thank you, noted.',endCall:true}]){
 const sent:Record<string,unknown>[]=[];const transport={send:vi.fn((t:string)=>{sent.push(JSON.parse(t));}),close:vi.fn()};
 let listener:((t:{id:string;text:string;final:boolean})=>void)|null=null;
 const stt:PhoneStreamingSpeechToText&{pushed:Uint8Array[]}={pushed:[],push(a){this.pushed.push(a);},close:vi.fn(),onTranscript(l){listener=l;}};
 const bridge=new PlivoAudioBridge({providerCallId:callUuid},transport,stt);
 const queue=[...replies];
 const session=new PhoneVoiceSession({language:'en-IN',purpose:'Can you attend tomorrow?',maxDurationSeconds:120,aiDisclosure:AI_DISCLOSURES['en-IN']},
  {dialogue:{propose:async()=>queue.shift()??{text:'Bye.',endCall:true}},tts:{synthesize:async t=>({audio:new TextEncoder().encode(t),durationMs:10})},sink:bridge.sink});
 bridge.attach(session);
 const played=()=>sent.filter(m=>m.event==='playAudio').map(m=>Buffer.from(String((m.media as {payload:string}).payload),'base64').toString());
 return {bridge,session,transport,stt,sent,played,say:(t:{id:string;text:string;final:boolean})=>listener!(t)};
}
const start=(extra:object={})=>JSON.stringify({event:'start',start:{streamId:'stream-1',...extra}});

describe('Plivo audio stream bridge (fake engines and transport)',()=>{
 it('speaks the AI disclosure first over the stream and forwards caller audio to speech-to-text',async()=>{
  const h=harness();
  await h.bridge.receive(start({callId:callUuid}));
  expect(h.played()).toEqual([AI_DISCLOSURES['en-IN'],'Can you attend tomorrow?']);
  expect(h.sent[0]).toEqual({event:'playAudio',media:{contentType:'audio/x-mulaw',sampleRate:8000,payload:b64(AI_DISCLOSURES['en-IN'])}});
  await h.bridge.receive(JSON.stringify({event:'media',media:{payload:b64('caller-audio')}}));
  expect(Buffer.from(h.stt.pushed[0]!).toString()).toBe('caller-audio');
  expect(h.bridge.stats).toMatchObject({mediaFrames:1,mediaBytes:12});
 });

 it('runs a turn from transcripts, clears playback on barge-in, and closes after the goodbye',async()=>{
  const h=harness();await h.bridge.receive(start());
  h.say({id:'p1',text:'Yes I',final:false});
  expect(h.sent.at(-1)).toEqual({event:'clearAudio',streamId:'stream-1'});
  h.say({id:'p1',text:'Yes, I can attend.',final:true});
  await vi.waitFor(()=>expect(h.transport.close).toHaveBeenCalledWith(1000,'call ended'));
  expect(h.played().slice(-2)).toEqual(['Thank you, noted.',CLOSINGS['en-IN']]);
  expect(h.session.report('completed').quotedResponses).toEqual(['Yes, I can attend.']);
  expect(h.stt.close).toHaveBeenCalled();
 });

 it('refuses a stream bound to another call, plays nothing before start, and closes on repeated bad frames',async()=>{
  const wrong=harness();await wrong.bridge.receive(start({callId:'dddddddd-4444-4444-8444-444444444444'}));
  expect(wrong.transport.close).toHaveBeenCalledWith(1008,'binding');expect(wrong.played()).toEqual([]);
  const early=harness();await early.bridge.receive(JSON.stringify({event:'media',media:{payload:b64('x')}}));
  expect(early.stt.pushed).toEqual([]);
  const bad=harness();await bad.bridge.receive(start());
  for(const f of ['not json','[]',JSON.stringify({event:'media',media:{payload:'***'}}),JSON.stringify({event:'media',media:{payload:'A'.repeat(30000)}}),'x'.repeat(70000)])await bad.bridge.receive(f);
  expect(bad.transport.close).toHaveBeenCalledWith(1008,'protocol');
  const twice=harness();await twice.bridge.receive(start());await twice.bridge.receive(start());
  expect(twice.transport.close).toHaveBeenCalledWith(1008,'binding');
 });

 it('ignores keypad tones and unknown events, and ends the session when the stream stops',async()=>{
  const h=harness();await h.bridge.receive(start());
  await h.bridge.receive(JSON.stringify({event:'dtmf',dtmf:{digit:'1'}}));
  await h.bridge.receive(JSON.stringify({event:'surprise'}));
  expect(h.bridge.stats.ignored).toBe(2);
  const before=h.played().length;
  await h.bridge.receive(JSON.stringify({event:'stop'}));
  expect(h.session.ended).toBe('hangup');expect(h.played()).toHaveLength(before);
  expect(h.transport.close).toHaveBeenCalledTimes(1);expect(h.transport.close.mock.calls[0]![0]).toBe(1000);
 });
});

describe('stream answer XML and WebSocket upgrade admission',()=>{
 it('builds a bidirectional mu-law stream answer only for a clean wss URL',()=>{
  const x=plivoStreamAnswerXml(`wss://thaara.example.com/api/v1/connectors/phone/plivo/calls/${callId}/stream`);
  expect(x).toContain('bidirectional="true"');expect(x).toContain('contentType="audio/x-mulaw;rate=8000"');
  for(const bad of ['ws://thaara.example.com/s','wss://u:p@thaara.example.com/s','wss://thaara.example.com/s?token=1'])expect(()=>plivoStreamAnswerXml(bad)).toThrow();
 });
 it('requires the pinned URL, a valid GET signature and a fresh nonce',async()=>{
  const url=`https://thaara.example.com/api/v1/connectors/phone/plivo/calls/${callId}/stream`;
  const verifier=vi.fn(()=>true),nonces=createMemoryNonceStore(),o={streamOrigin:'https://thaara.example.com',verifier,nonces};
  const headers={'x-plivo-signature-v3':'sig','x-plivo-signature-v3-nonce':'nonce-stream-1'};
  expect(await admitPlivoStreamUpgrade({callId,url,headers},{...o,verifier:undefined})).toBe('not_configured');
  expect(await admitPlivoStreamUpgrade({callId,url,headers},o)).toBe('accepted');
  expect(verifier).toHaveBeenCalledWith(expect.objectContaining({method:'GET',url,params:{}}));
  expect(await admitPlivoStreamUpgrade({callId,url,headers},o)).toBe('rejected');
  expect(await admitPlivoStreamUpgrade({callId,url:url+'?x=1',headers:{...headers,'x-plivo-signature-v3-nonce':'nonce-stream-2'}},o)).toBe('rejected');
  expect(await admitPlivoStreamUpgrade({callId,url,headers:{'x-plivo-signature-v3-nonce':'nonce-stream-3'}},o)).toBe('rejected');
  expect(await admitPlivoStreamUpgrade({callId,url,headers:{...headers,'x-plivo-signature-v3-nonce':'nonce-stream-4'}},{...o,verifier:()=>false})).toBe('rejected');
 });
});
