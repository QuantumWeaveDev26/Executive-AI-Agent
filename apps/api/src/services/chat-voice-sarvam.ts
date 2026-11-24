export type ChatVoiceSpokenLanguage='en-IN'|'kn-IN'|'hi-IN';
export type ChatVoiceLanguage='auto'|ChatVoiceSpokenLanguage;
export interface ChatSpeech {
 readonly configured:boolean;
 transcribe(audio:Uint8Array,mime:string,language:ChatVoiceLanguage,signal?:AbortSignal):Promise<string>;
 transcribeWithLanguage?(audio:Uint8Array,mime:string,language:ChatVoiceLanguage,signal?:AbortSignal):Promise<{transcript:string;detectedLanguage:ChatVoiceSpokenLanguage}>;
 speak(text:string,language:ChatVoiceLanguage,signal?:AbortSignal):Promise<string>;
}
const spokenLanguages:readonly ChatVoiceSpokenLanguage[]=['en-IN','kn-IN','hi-IN'];
const languages:readonly ChatVoiceLanguage[]=['auto','en-IN','kn-IN','hi-IN'];
const unavailable=()=>Error('Speech service unavailable. Please try again.');
export function resolveSpeakLanguage(text:string,requested:ChatVoiceLanguage):ChatVoiceSpokenLanguage{
 const fallback:ChatVoiceSpokenLanguage=requested==='auto'?'en-IN':requested;
 const kn=(text.match(/[\u0C80-\u0CFF]/g)??[]).length,hi=(text.match(/[\u0900-\u097F]/g)??[]).length;
 if(kn>=2&&kn>hi)return 'kn-IN';
 if(hi>=2&&hi>kn)return 'hi-IN';
 return fallback;
}
const UNSUPPORTED_VOICE_SCRIPT_RE=/[\u0600-\u06FF\u0980-\u0BFF\u0C00-\u0C7F\u0D00-\u0DFF]/g;
const SUPPORTED_VOICE_SCRIPT_RE=/[A-Za-z0-9\u0900-\u097F\u0C80-\u0CFF]/g;
const NON_LEXICAL_VOICE_NOISE_RE=/^(?:h+m+|u+h+|u+m+|m+h*m+|a+h+|o+h+|eh+|ம்+)[.?!,।…\s]*$/iu;
/** Filters ambient breath/murmur noise and unsupported-script auto-STT hallucinations while keeping short real replies intact. */
export function sanitizeChatVoiceTranscript(rawTranscript:string,requested:ChatVoiceLanguage,providerLanguageCode?:unknown):{transcript:string;detectedLanguage:ChatVoiceSpokenLanguage}{
 const fallback:ChatVoiceSpokenLanguage=requested==='auto'?'en-IN':requested;
 const trimmed=rawTranscript.trim();
 if(!trimmed||NON_LEXICAL_VOICE_NOISE_RE.test(trimmed))return{transcript:'',detectedLanguage:fallback};
 if(requested==='auto'){
  const unsupported=(trimmed.match(UNSUPPORTED_VOICE_SCRIPT_RE)??[]).length;
  const supported=(trimmed.match(SUPPORTED_VOICE_SCRIPT_RE)??[]).length;
  if(unsupported>0&&(supported===0||unsupported>supported))return{transcript:'',detectedLanguage:fallback};
 }
 const rawDetected=typeof providerLanguageCode==='string'&&(spokenLanguages as readonly string[]).includes(providerLanguageCode)?(providerLanguageCode as ChatVoiceSpokenLanguage):undefined;
 return{transcript:trimmed,detectedLanguage:rawDetected??resolveSpeakLanguage(trimmed,requested)};
}
export function decodeVoiceBase64(value:string,max=1_000_000):Buffer{
 if(typeof value!=='string'||value.length>Math.ceil(max/3)*4||!value||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw unavailable();
 const bytes=Buffer.from(value,'base64');if(bytes.length>max||bytes.length<12||bytes.toString('base64')!==value)throw unavailable();return bytes;
}
function wav(bytes:Uint8Array){return Buffer.from(bytes.subarray(0,4)).toString()==='RIFF'&&Buffer.from(bytes.subarray(8,12)).toString()==='WAVE';}
export function validateVoiceWave(audio:Uint8Array){
 const b=Buffer.from(audio);
 if(b.length<46||b.length>800044||!wav(b)||b.readUInt32LE(4)!==b.length-8||b.toString('ascii',12,16)!=='fmt '||b.readUInt32LE(16)!==16||b.readUInt16LE(20)!==1||b.readUInt16LE(22)!==1||b.readUInt32LE(24)!==16000||b.readUInt32LE(28)!==32000||b.readUInt16LE(32)!==2||b.readUInt16LE(34)!==16||b.toString('ascii',36,40)!=='data'||b.readUInt32LE(40)!==b.length-44||(b.length-44)%2!==0)throw unavailable();
}
async function boundedJson(response:Response,max:number){
 if(!response.ok||!response.body)throw unavailable();const reader=response.body.getReader();let size=0;const parts:Uint8Array[]=[];
 try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>max){await reader.cancel();throw unavailable();}parts.push(item.value);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
 finally{reader.releaseLock();}
}
/** Browser speech only. Fixed provider URLs, server-only key, no phone agent or tool execution. */
export function createSarvamChatSpeech(options:{enabled:boolean;key:()=>string|Promise<string>;fetch?:typeof fetch}):ChatSpeech{
 const network=options.fetch??globalThis.fetch;
 const check=()=>{if(!options.enabled)throw Error('Voice is not configured.');};
 async function call(path:string,body:string|FormData,signal:AbortSignal|undefined,json=false){
  check();const key=await options.key();if(typeof key!=='string'||!key.trim())throw Error('Voice is not configured.');
  const abort=AbortSignal.any([AbortSignal.timeout(20000),...(signal?[signal]:[])]);
  try{return await boundedJson(await network('https://api.sarvam.ai/'+path,{method:'POST',redirect:'error',headers:{'api-subscription-key':key,...(json?{'Content-Type':'application/json'}:{})},body,signal:abort}),path==='text-to-speech'?5_600_000:100_000);}
  catch{throw unavailable();}
 }
 async function runTranscribe(audio:Uint8Array,mime:string,language:ChatVoiceLanguage,signal?:AbortSignal):Promise<{transcript:string;detectedLanguage:ChatVoiceSpokenLanguage}>{
  check();if(!languages.includes(language)||audio.length<12||audio.length>1_000_000||!['audio/webm','audio/ogg','audio/mp4','audio/wav'].includes(mime))throw unavailable();
  if(mime!=='audio/wav')throw unavailable();validateVoiceWave(audio);
  const providerLang=language==='auto'?'unknown':language;
  const form=new FormData();form.set('file',new Blob([Uint8Array.from(audio)],{type:mime}),'speech.'+mime.split('/')[1]);form.set('model','saaras:v3');form.set('language_code',providerLang);form.set('mode','transcribe');
  const result=await call('speech-to-text',form,signal);
  if(typeof result?.transcript!=='string'||result.transcript.length>16000)throw unavailable();
  return sanitizeChatVoiceTranscript(result.transcript,language,result?.language_code);
 }
 return Object.freeze({configured:options.enabled,
  async transcribe(audio:Uint8Array,mime:string,language:ChatVoiceLanguage,signal?:AbortSignal){
   return(await runTranscribe(audio,mime,language,signal)).transcript;
  },
  transcribeWithLanguage:runTranscribe,
  async speak(text:string,language:ChatVoiceLanguage,signal?:AbortSignal){
   check();if(!languages.includes(language)||typeof text!=='string'||!text.trim()||text.length>2500)throw unavailable();
   const effectiveLanguage=resolveSpeakLanguage(text,language);
   const result=await call('text-to-speech',JSON.stringify({text,language_code:effectiveLanguage,model:'bulbul:v4-flash',speaker:'chaitra_kn_conversation',pace:1,speech_sample_rate:22050,output_audio_codec:'wav'}),signal,true);
   if(!Array.isArray(result?.audios)||result.audios.length!==1)throw unavailable();const bytes=decodeVoiceBase64(result.audios[0],4_000_000);if(bytes.length<44||!wav(bytes))throw unavailable();return result.audios[0];
  }
 });
}
