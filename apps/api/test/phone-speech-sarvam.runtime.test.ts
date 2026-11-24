import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe,expect,it} from 'vitest';
import type {PhoneCallingLanguage} from '@thaara/contracts';
import {createSarvamStreamingStt,createSarvamTts} from '../src/services/phone-sarvam.js';
import {mulawToPcm16,pcm16ToMulaw,readWavPcm16,resample,writeWavPcm16} from '../src/services/phone-audio-codec.js';
import {charErrorRate,wordErrorRate} from '../src/services/phone-speech-metrics.js';

/**
 * Owner-run Sarvam speech test. SENDS THE OWNER'S RECORDINGS AND SAMPLE TEXT TO SARVAM. Runs only when both are set:
 *   THAARA_SPEECH_TEST_DIR=<folder outside the repository>   THAARA_SPEECH_TEST_APPROVED=yes
 * The folder holds keys.env (SARVAM_API_KEY=...), manifest.json and the WAV recordings; results go to <folder>/output.
 * The key is read from the file at run time and never printed. No phone call is made.
 */
const dir=process.env.THAARA_SPEECH_TEST_DIR,approved=process.env.THAARA_SPEECH_TEST_APPROVED==='yes';
const LANGS=new Set(['en-IN','kn-IN','kn-en']);
type Manifest={phrases:{file:string;language:PhoneCallingLanguage;expected:string}[];ttsSamples:{language:PhoneCallingLanguage;text:string}[];speaker?:string;speakers?:string[]};

function loadKey(folder:string){
 const line=fs.readFileSync(path.join(folder,'keys.env'),'utf8').split(/\r?\n/).find(l=>l.startsWith('SARVAM_API_KEY='));
 const key=line?.slice('SARVAM_API_KEY='.length).trim();
 if(!key)throw new Error('keys.env has no SARVAM_API_KEY');
 return key;
}
function loadManifest(folder:string):Manifest{
 const m=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8')) as Manifest;
 if(!Array.isArray(m.phrases)||m.phrases.length>50||!Array.isArray(m.ttsSamples)||m.ttsSamples.length>20)throw new Error('manifest: phrases (<=50) and ttsSamples (<=20) arrays required');
 for(const p of m.phrases)if(!/^[\w.-]{1,100}\.wav$/i.test(p.file)||!LANGS.has(p.language)||typeof p.expected!=='string'||!p.expected.trim())throw new Error(`manifest phrase invalid: ${p.file}`);
 for(const s of m.ttsSamples)if(!LANGS.has(s.language)||typeof s.text!=='string'||!s.text.trim()||s.text.length>300)throw new Error('manifest tts sample invalid');
 return m;
}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

describe.skipIf(!dir||!approved)('Sarvam speech test (owner-approved, sends recordings to Sarvam)',()=>{
 it('measures transcription accuracy/latency on phone-quality audio and saves TTS samples',async()=>{
  const folder=path.resolve(dir!),out=path.join(folder,'output');
  const repoRoot=path.resolve(fileURLToPath(new URL('../../../',import.meta.url)));
  if((folder+path.sep).toLowerCase().startsWith((repoRoot+path.sep).toLowerCase()))throw new Error('Keep the speech test folder OUTSIDE the repository.');
  const key=loadKey(folder),manifest=loadManifest(folder),credentials={resolve:async()=>({apiKey:key})};
  fs.mkdirSync(out,{recursive:true});
  const report:{generatedAt:string;stt:unknown[];tts:unknown[]}={generatedAt:new Date().toISOString(),stt:[],tts:[]};

  for(const p of manifest.phrases){
   const row:Record<string,unknown>={file:p.file,language:p.language,expected:p.expected};
   try{
    const wav=readWavPcm16(new Uint8Array(fs.readFileSync(path.join(folder,p.file))));
    // Same path as a real call: 8 kHz mu-law in, Thaara decodes/upsamples before Sarvam.
    const mulaw=pcm16ToMulaw(resample(wav.pcm,wav.sampleRate,8000));
    let errorCode:string|null=null;const finals:{text:string;at:number}[]=[];
    const stt=createSarvamStreamingStt({language:p.language,credentials,onError:c=>{errorCode=c;}});
    stt.onTranscript(t=>{if(t.final)finals.push({text:t.text,at:Date.now()});});
    const connectStart=Date.now();await stt.ready;row.connectMs=Date.now()-connectStart;
    for(let i=0;i<mulaw.length;i+=160){stt.push(mulaw.subarray(i,i+160));await sleep(20);}
    const audioEnd=Date.now();
    // Trailing silence helps the end-of-speech detector, then wait up to 8 s for the final result.
    for(let i=0;i<40;i++){stt.push(new Uint8Array(160).fill(0xff));await sleep(20);}
    for(let waited=0;waited<8000&&!finals.some(f=>f.at>=audioEnd);waited+=100)await sleep(100);
    stt.close();
    const actual=finals.map(f=>f.text).join(' ');
    Object.assign(row,{actual,wer:Number(wordErrorRate(p.expected,actual).toFixed(3)),cer:Number(charErrorRate(p.expected,actual).toFixed(3)),
     finalLatencyMs:finals.length?Math.max(0,finals[finals.length-1]!.at-audioEnd):null,audioSeconds:Number((mulaw.length/8000).toFixed(2)),error:errorCode});
   }catch(e){row.error=(e as Error).message.slice(0,200);}
   report.stt.push(row);
  }

  // Optional voice comparison: "speakers": ["kavya","kavitha",...] renders every sample in each voice (max 4).
  const speakers=(Array.isArray(manifest.speakers)&&manifest.speakers.length?manifest.speakers:[manifest.speaker]).slice(0,4);
  for(const speaker of speakers)for(const [i,s] of manifest.ttsSamples.entries()){
   const tts=createSarvamTts({credentials,speaker});
   const row:Record<string,unknown>={speaker:speaker??'default',language:s.language,text:s.text};
   try{
    const started=Date.now();
    const r=await tts.synthesize(s.text,s.language,AbortSignal.timeout(15000));
    const file=`tts-${speaker??'default'}-${String(i+1).padStart(2,'0')}-${s.language}.wav`;
    fs.writeFileSync(path.join(out,file),writeWavPcm16(mulawToPcm16(r.audio),8000));
    Object.assign(row,{file,synthesisMs:Date.now()-started,audioSeconds:Number((r.audio.byteLength/8000).toFixed(2)),contentType:tts.lastContentType});
   }catch(e){Object.assign(row,{error:(e as Error).message.slice(0,200),contentType:tts.lastContentType});}
   report.tts.push(row);
  }
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.table((report.stt as Record<string,unknown>[]).map(r=>({file:r.file,lang:r.language,wer:r.wer,cer:r.cer,latencyMs:r.finalLatencyMs,error:r.error})));
  console.table((report.tts as Record<string,unknown>[]).map(r=>({voice:r.speaker,lang:r.language,file:r.file,ms:r.synthesisMs,type:r.contentType,error:r.error})));
  expect(report.stt.length+report.tts.length).toBeGreaterThan(0);
 },20*60*1000);
});
