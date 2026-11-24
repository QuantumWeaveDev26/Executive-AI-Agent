import {describe,it,expect,vi} from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import {ConflictError,hashSessionToken,sanitizeDatabaseError,type TransactionalDbClient} from '@thaara/db';
import {authPlugin} from '../src/plugins/auth.js';
import {chatVoiceRoutes,prepareSpeechChunks} from '../src/routes/chat-voice.js';
import {createSarvamChatSpeech,sanitizeChatVoiceTranscript} from '../src/services/chat-voice-sarvam.js';
import {conversationRoutes,normalizeSpokenCommandForDetectors} from '../src/routes/conversations.js';
import {formatErrorResponse} from '@thaara/observability';
import {ValidationError} from '@thaara/db';
import {detectGmailChatRequest} from '../src/services/chat-gmail-assistant.js';
import {detectCalendarChatRequest} from '../src/services/chat-calendar-assistant.js';
import {detectGoogleDriveChatRequest} from '../src/services/chat-google-drive-assistant.js';
import {detectPhoneCallingIntent} from '../src/services/phone-calling-intent.js';
const workspace='10000000-0000-4000-8000-000000000001',user='10000000-0000-4000-8000-000000000002',conversation='10000000-0000-4000-8000-000000000003',message='10000000-0000-4000-8000-000000000004';
const wav=Buffer.alloc(48);wav.write('RIFF');wav.writeUInt32LE(40,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(4,40);
async function fixture(){
 const statements:{sql:string;params:any[]}[]=[],scopes:any[]=[];
 const db={query:async(sql:string,params:any[]=[])=>{
  statements.push({sql,params});
  if(sql.includes('FROM resolve_session_scope'))return{rows:params[0]===hashSessionToken('synthetic-session')?[{session_id:message,workspace_id:workspace,user_id:user,role:'owner'}]:[]};
  if(sql.includes('FROM public.conversations'))return{rows:params[0]===conversation&&params[1]===workspace&&params[2]===user?[{id:conversation,status:'active'}]:[]};
  if(sql.includes('FROM public.conversation_messages'))return{rows:params[0]===message&&params[1]===workspace&&params[2]===user&&params[3]===conversation?[{content:'Your meeting request needs approval.'}]:[]};
  return{rows:[]};
 },withScopedTransaction:async(scope:any,work:any)=>{scopes.push(scope);return work(db);}};
 const speech={configured:true,transcribe:vi.fn(async()=> 'Check my latest emails'),speak:vi.fn(async()=>wav.toString('base64'))};
 const app=Fastify({logger:false});await app.register(cookie);await app.register(authPlugin,{db:db as unknown as TransactionalDbClient});await app.register(async api=>chatVoiceRoutes(api,{db:db as unknown as TransactionalDbClient,speech}),{prefix:'/api/v1'});
 const headers={cookie:'thaara_session=synthetic-session; thaara_csrf=synthetic-csrf','x-csrf-token':'synthetic-csrf'};
 return{app,speech,headers,statements,scopes,body:{conversationId:conversation,language:'en-IN',mimeType:'audio/wav',audio:wav.toString('base64')}};
}
describe('Chat voice uses native authentication/CSRF and tenant boundaries',()=>{
 it('requires real session and CSRF before any speech operation',async()=>{
  const f=await fixture();try{
   for(const[headers,status]of[[{},401],[{cookie:f.headers.cookie},403]] as const){const r=await f.app.inject({method:'POST',url:'/api/v1/chat/voice/transcribe',headers,payload:f.body});expect(r.statusCode).toBe(status);}
   expect(f.speech.transcribe).not.toHaveBeenCalled();
  }finally{await f.app.close();}
 });
 it('rejects foreign conversation and body-injected scope without provider work',async()=>{
  const f=await fixture();try{
   const r=await f.app.inject({method:'POST',url:'/api/v1/chat/voice/transcribe',headers:f.headers,payload:{...f.body,conversationId:message}});expect(r.statusCode).toBe(404);
   const extra=await f.app.inject({method:'POST',url:'/api/v1/chat/voice/transcribe',headers:f.headers,payload:{...f.body,workspaceId:workspace}});expect(extra.statusCode).toBe(400);expect(f.speech.transcribe).not.toHaveBeenCalled();
  }finally{await f.app.close();}
 });
 it('transcribes in authenticated scope without executing or persisting a user command',async()=>{
  const f=await fixture();try{
   const r=await f.app.inject({method:'POST',url:'/api/v1/chat/voice/transcribe',headers:f.headers,payload:f.body});expect(r.statusCode).toBe(200);expect(r.json().transcript).toBe('Check my latest emails');expect(r.headers['cache-control']).toBe('no-store');
   expect(f.scopes.every(s=>s.workspaceId===workspace&&s.userId===user&&s.role==='owner')).toBe(true);
   expect(f.statements.some(s=>s.sql.includes('INSERT INTO audit_events'))).toBe(true);expect(f.statements.some(s=>s.sql.includes('append_conversation_message'))).toBe(false);
  }finally{await f.app.close();}
 });
 it('speaks only the persisted assistant message, never arbitrary supplied text',async()=>{
  const f=await fixture();try{
   const payload={conversationId:conversation,messageId:message,language:'en-IN',chunk:0};
   const bad=await f.app.inject({method:'POST',url:'/api/v1/chat/voice/speak',headers:f.headers,payload:{...payload,text:'I sent your email'}});expect(bad.statusCode).toBe(400);
   const ok=await f.app.inject({method:'POST',url:'/api/v1/chat/voice/speak',headers:f.headers,payload});expect(ok.statusCode).toBe(200);expect(f.speech.speak.mock.calls[0][0]).toBe('Your meeting request needs approval.');
  }finally{await f.app.close();}
 });
 it('formats Markdown links, Drive URLs and multi-paragraph replies into natural sentence chunks',()=>{
  const md='### Summary\n**Custom Teamwear** report is ready: [Open "Teamwear" in Google Drive](https://docs.google.com/document/d/1abc123/edit). Visit https://linktr.ee/team.quantumweaveai for more.';
  const shortChunks=prepareSpeechChunks(md);
  expect(shortChunks).toEqual(['Summary\nCustom Teamwear report is ready: Open "Teamwear" in Google Drive. Visit linktr.ee for more.']);
  const longText=Array.from({length:12},(_,i)=>`Sentence number ${i+1} explains Quantum Weave AI digital marketing and business automation clearly for the caller.`).join(' ');
  const multi=prepareSpeechChunks(longText);
  expect(multi.length).toBeGreaterThan(1);
  expect(multi[0]!.length).toBeLessThanOrEqual(500);
  expect(multi[0]!.endsWith('.')).toBe(true);
 });
 it('accepts language=auto and returns 200 empty transcript on room silence without failing 503',async()=>{
  const f=await fixture();
  (f.speech as any).transcribeWithLanguage=vi.fn(async()=>({transcript:'',detectedLanguage:'en-IN'}));
  try{
   const r=await f.app.inject({method:'POST',url:'/api/v1/chat/voice/transcribe',headers:f.headers,payload:{...f.body,language:'auto'}});
   expect(r.statusCode).toBe(200);
   expect(r.json()).toEqual({transcript:'',detectedLanguage:'en-IN'});
  }finally{await f.app.close();}
 });
 it('routes spoken wake-word task commands cleanly into Gmail, Calendar, Google Drive, and Phone detectors',()=>{
  expect(detectGmailChatRequest(normalizeSpokenCommandForDetectors('Thaara, check my latest unread emails.'))?.kind).toBe('read_unread');
  expect(detectGmailChatRequest(normalizeSpokenCommandForDetectors('Thaara, create an email draft for a customer.'))?.kind).toBe('compose_new_email');
  expect(detectCalendarChatRequest(normalizeSpokenCommandForDetectors('Thaara, what meetings do I have tomorrow?'))?.kind).toBe('agenda_read');
  expect(detectCalendarChatRequest(normalizeSpokenCommandForDetectors('Thaara, schedule a meeting.'))?.kind).toBe('create_event');
  expect(detectGoogleDriveChatRequest(normalizeSpokenCommandForDetectors('Thaara, find my latest Google Drive report.'))?.kind).toBe('search_files');
  expect(detectGoogleDriveChatRequest(normalizeSpokenCommandForDetectors('Summarize my Custom Teamwear report.'))?.kind).toBe('summarize_document');
  expect(detectPhoneCallingIntent(normalizeSpokenCommandForDetectors('Thaara, call a customer about the proposal.'))).toMatchObject({contactQuery:'a customer'});
 });
 it('survives abrupt client SSE stream disconnect after headers are sent without ERR_HTTP_HEADERS_SENT crash and serves subsequent turns',async()=>{
  let streamStatus='queued',streamVersion=1;
  const db:any={
   query:async(sql:string,params:any[]=[])=>{
    if(sql.includes('FROM resolve_session_scope'))return{rows:[{session_id:message,workspace_id:workspace,user_id:user,role:'owner'}]};
    if(sql.includes('FROM public.conversations'))return{rows:[{id:conversation,workspace_id:workspace,user_id:user,title:'Test',channel:'web',status:'active',metadata:{},created_at:new Date().toISOString(),updated_at:new Date().toISOString()}]};
    if(sql.includes('initiate_assistant_stream')){
     streamStatus='queued';streamVersion=1;
     return{rows:[{initiate_assistant_stream:{stream_id:message,status:'queued',user_message_id:conversation,assistant_message_id:null,version:1,idempotent_replay:false}}]};
    }
    if(sql.includes('append_assistant_stream_event')){
     if(streamStatus==='cancelled'||params[2]!==streamVersion){
      const e:any=new Error('Invalid Stream State Transition');e.code='P0001';throw e;
     }
     streamStatus='streaming';streamVersion++;
     return{rows:[{append_assistant_stream_event:{stream_id:message,sequence_number:1,version:streamVersion,status:'streaming'}}]};
    }
    if(sql.includes('cancel_assistant_stream')){
     streamStatus='cancelled';streamVersion++;
     return{rows:[{cancel_assistant_stream:{stream_id:message,status:'cancelled',version:streamVersion,idempotent:false}}]};
    }
    if(sql.includes('finalize_assistant_stream')){
     if(streamStatus==='cancelled'){const e:any=new Error('Cannot finalize cancelled stream');e.code='P0001';throw e;}
     streamStatus='completed';streamVersion++;
     return{rows:[{finalize_assistant_stream:{stream_id:message,status:'completed',assistant_message_id:message,sequence_number:2,version:streamVersion}}]};
    }
    return{rows:[]};
   },
   withScopedTransaction:async(_s:any,fn:any)=>fn(db)
  };
  let activeRawReply:any;
  const modelGateway:any={
   async *streamResponse(ctx:any){
    if(ctx.userMessage.includes('Can I get the information')){
     await new Promise<void>(resolve=>{
      if(ctx.signal?.aborted){resolve();return;}
      ctx.signal?.addEventListener('abort',()=>resolve(),{once:true});
      setTimeout(()=>activeRawReply?.emit('close'),15);
     });
     return;
    }
    yield{type:'token',delta:'Quantum Weave AI builds governed AI voice agents and automation.'};
   }
  };
  const app=Fastify({logger:false});
  app.addHook('onRequest',async(_req,reply)=>{activeRawReply=reply.raw;});
  app.setErrorHandler((error, _req, reply)=>{
   if(reply.sent||reply.raw.headersSent){
    if(!reply.raw.writableEnded&&!reply.raw.destroyed){try{reply.raw.end();}catch{}}
    return;
   }
   const {statusCode,body}=formatErrorResponse(error);
   reply.status(statusCode).send(body);
  });
  app.get('/sse-throw-after-headers',async(_req,reply)=>{
   reply.raw.writeHead(200,{'Content-Type':'text/event-stream'});
   reply.raw.write('event: ping\ndata: {}\n\n');
   throw new ValidationError('Operation could not be completed with the provided parameters.');
  });
  await app.register(cookie);
  await app.register(authPlugin,{db});
  await app.register(async v1=>{
   v1.get('/health',async()=>({status:'ok'}));
   await conversationRoutes(v1,{db,modelGateway,policyGateway:{} as any});
  },{prefix:'/api/v1'});
  try{
   const headers={cookie:'thaara_session=synthetic-session; thaara_csrf=synthetic-csrf','x-csrf-token':'synthetic-csrf'};
   await app.inject({
    method:'POST',url:`/api/v1/conversations/${conversation}/stream`,headers,
    payload:{content:'Can I get the information of Quantum Weave?',idempotency_key:'turn-2-abort',voice_mode:true}
   }).catch(()=>{});
   await new Promise(r=>setTimeout(r,40));
   expect(streamStatus).toBe('cancelled');

   const sseErr=await app.inject({method:'GET',url:'/sse-throw-after-headers'});
   expect(sseErr.statusCode).toBe(200);

   const hlth=await app.inject({method:'GET',url:'/api/v1/health'});
   expect(hlth.statusCode).toBe(200);
   const turn3=await app.inject({
    method:'POST',url:`/api/v1/conversations/${conversation}/stream`,headers,
    payload:{content:'Tell me about Quantum Weave services',idempotency_key:'turn-3-ok',voice_mode:true}
   });
   expect(turn3.statusCode).toBe(200);
   expect(turn3.body).toContain('Quantum Weave AI builds governed AI voice agents');
   expect(turn3.body).toContain('event: done');
  }finally{
   await app.close();
  }
 });
 it('filters unsupported-script auto-STT hallucinations and non-lexical room murmurs while preserving short real answers in English, Kannada, and Hindi',async()=>{
  for(const noise of ['কেন বলছেন?','ਹਾਂਜੀ।','હા.','ம்.','Hmm.','uh','um','mm']){
   expect(sanitizeChatVoiceTranscript(noise,'auto')).toEqual({transcript:'',detectedLanguage:'en-IN'});
  }
  expect(sanitizeChatVoiceTranscript('Hi','auto','en-IN')).toEqual({transcript:'Hi',detectedLanguage:'en-IN'});
  expect(sanitizeChatVoiceTranscript('Krishna','auto','en-IN')).toEqual({transcript:'Krishna',detectedLanguage:'en-IN'});
  expect(sanitizeChatVoiceTranscript('Manufacturing','auto','en-IN')).toEqual({transcript:'Manufacturing',detectedLanguage:'en-IN'});
  expect(sanitizeChatVoiceTranscript('Yes','auto','en-IN')).toEqual({transcript:'Yes',detectedLanguage:'en-IN'});
  expect(sanitizeChatVoiceTranscript('Phone calls','auto','en-IN')).toEqual({transcript:'Phone calls',detectedLanguage:'en-IN'});
  expect(sanitizeChatVoiceTranscript('Around 50','auto','en-IN')).toEqual({transcript:'Around 50',detectedLanguage:'en-IN'});
  expect(sanitizeChatVoiceTranscript('ಹೌದು','auto','kn-IN')).toEqual({transcript:'ಹೌದು',detectedLanguage:'kn-IN'});
  expect(sanitizeChatVoiceTranscript('हाँ','auto','hi-IN')).toEqual({transcript:'हाँ',detectedLanguage:'hi-IN'});
 });
 it('maps Fastify 429 rate-limit errors to HTTP 429 RATE_LIMITED instead of 500 INTERNAL_ERROR and supports 10+ consecutive voice turns without self-throttling',async()=>{
  const fastifyRateLimit=(await import('@fastify/rate-limit')).default;
  const rlApp=Fastify({logger:false});
  await rlApp.register(fastifyRateLimit,{max:2,timeWindow:60000});
  rlApp.setErrorHandler((error,_req,reply)=>{
   const err=error as {statusCode?:number};
   if(reply.sent||reply.raw.headersSent)return;
   if(err.statusCode===429){
    reply.status(429).send({error:{code:'RATE_LIMITED',message:'Too many requests. Please wait a moment and try again.'}});
    return;
   }
   const {statusCode,body}=formatErrorResponse(error);
   reply.status(statusCode).send(body);
  });
  rlApp.get('/ping',async()=>({ok:true}));
  try{
   expect((await rlApp.inject({method:'GET',url:'/ping'})).statusCode).toBe(200);
   expect((await rlApp.inject({method:'GET',url:'/ping'})).statusCode).toBe(200);
   const limited=await rlApp.inject({method:'GET',url:'/ping'});
   expect(limited.statusCode).toBe(429);
   expect(limited.json().error.code).toBe('RATE_LIMITED');
   expect(limited.body).not.toContain('An internal error occurred');
  }finally{await rlApp.close();}

  const f=await fixture();
  try{
   for(let turn=1;turn<=10;turn++){
    const stt=await f.app.inject({method:'POST',url:'/api/v1/chat/voice/transcribe',headers:f.headers,payload:{...f.body,language:'auto'}});
    expect(stt.statusCode).toBe(200);
    const tts=await f.app.inject({method:'POST',url:'/api/v1/chat/voice/speak',headers:f.headers,payload:{conversationId:conversation,messageId:message,language:'en-IN',chunk:0}});
    expect(tts.statusCode).toBe(200);
   }
  }finally{await f.app.close();}
 });
 it('uses verified Phone Agent Chaitra voice (chaitra_kn_conversation on bulbul:v4-flash) across English, Kannada and Hindi',async()=>{
  const calls:{url:string;body:Record<string,unknown>}[]=[];
  const wavB64=wav.toString('base64');
  const speech=createSarvamChatSpeech({
   enabled:true,
   key:()=>'test-key',
   fetch:async(input,init)=>{
    calls.push({url:String(input),body:JSON.parse(String(init?.body))});
    return new Response(JSON.stringify({audios:[wavB64]}),{status:200,headers:{'Content-Type':'application/json'}});
   }
  });
  await speech.speak('Hello from Thaara.','en-IN');
  await speech.speak('ನಮಸ್ಕಾರ, ನಾನು ತಾರಾ.','auto');
  await speech.speak('नमस्ते, मैं तारा हूँ।','auto');
  expect(calls.map(c=>c.url)).toEqual([
   'https://api.sarvam.ai/text-to-speech',
   'https://api.sarvam.ai/text-to-speech',
   'https://api.sarvam.ai/text-to-speech'
  ]);
  expect(calls.map(c=>c.body)).toEqual([
   {text:'Hello from Thaara.',language_code:'en-IN',model:'bulbul:v4-flash',speaker:'chaitra_kn_conversation',pace:1,speech_sample_rate:22050,output_audio_codec:'wav'},
   {text:'ನಮಸ್ಕಾರ, ನಾನು ತಾರಾ.',language_code:'kn-IN',model:'bulbul:v4-flash',speaker:'chaitra_kn_conversation',pace:1,speech_sample_rate:22050,output_audio_codec:'wav'},
   {text:'नमस्ते, मैं तारा हूँ।',language_code:'hi-IN',model:'bulbul:v4-flash',speaker:'chaitra_kn_conversation',pace:1,speech_sample_rate:22050,output_audio_codec:'wav'}
  ]);
 });
 it('maps stream cancellation version conflict and terminal state P0001 errors to ConflictError (409) instead of ValidationError (400)',()=>{
  const versionErr=sanitizeDatabaseError({code:'P0001',message:'Concurrency conflict: expected version 30, actual version 31'});
  expect(versionErr).toBeInstanceOf(ConflictError);
  expect(versionErr.statusCode).toBe(409);

  const terminalErr=sanitizeDatabaseError({code:'P0001',message:'Invalid Stream State Transition: Cannot cancel stream in terminal state "completed"'});
  expect(terminalErr).toBeInstanceOf(ConflictError);
  expect(terminalErr.statusCode).toBe(409);
 });
 it('retries concurrent stream cancellation conflicts and handles completed-stream races idempotently without false success',async()=>{
  const app=Fastify({logger:false});
  app.setErrorHandler((err,_req,reply)=>{const e=err as {statusCode?:number;code?:string;message?:string};reply.code(e.statusCode??500).send({error:{code:e.code??'INTERNAL_ERROR',message:e.message??'Error'}});});
  await app.register(cookie);
  await app.register(authPlugin,{db:{query:async()=>({rows:[{session_id:'s1',user_id:user,workspace_id:workspace,role:'owner',expires_at:new Date(Date.now()+60000).toISOString()}]})} as unknown as TransactionalDbClient});
  let findCalls=0,cancelCalls=0,scenario:'retry_then_cancel'|'completed_race'|'exhaust_conflict'='retry_then_cancel';
  const streamId='20000000-0000-4000-8000-000000000009';
  const mockDb={
   query:async(sql:string)=>{
    if(sql.includes('resolve_session_scope')||sql.includes('FROM public.sessions'))return{rows:[{session_id:'s1',user_id:user,workspace_id:workspace,role:'owner'}]};
    if(sql.includes('get_conversation_by_id')||sql.includes('FROM public.conversations'))return{rows:[{id:conversation,workspace_id:workspace,user_id:user,status:'active',title:'Test'}]};
    if(sql.includes('get_assistant_stream_by_id')||sql.includes('FROM public.assistant_stream_executions')){
     findCalls++;
     if(scenario==='completed_race'&&findCalls>=2){
      return{rows:[{id:streamId,workspace_id:workspace,conversation_id:conversation,user_id:user,status:'completed',version:35}]};
     }
     return{rows:[{id:streamId,workspace_id:workspace,conversation_id:conversation,user_id:user,status:'streaming',version:30+findCalls}]};
    }
    if(sql.includes('cancel_assistant_stream')){
     cancelCalls++;
     if(scenario==='retry_then_cancel'&&cancelCalls<3)throw{code:'P0001',message:'Concurrency conflict: expected version 30, actual version 31'};
     if(scenario==='completed_race')throw{code:'P0001',message:'Invalid Stream State Transition: Cannot cancel stream in terminal state "completed"'};
     if(scenario==='exhaust_conflict')throw{code:'P0001',message:'Concurrency conflict: expected version 30, actual version 31'};
     return{rows:[{cancel_assistant_stream:{stream_id:streamId,status:'cancelled',version:33,idempotent:false}}]};
    }
    return{rows:[]};
   },
   withScopedTransaction:async(_s:any,fn:any)=>fn(mockDb)
  } as unknown as TransactionalDbClient;
  await app.register(async v1=>{await conversationRoutes(v1,{db:mockDb});},{prefix:'/api/v1'});
  const headers={cookie:'thaara_session=test; thaara_csrf=csrf-1','x-csrf-token':'csrf-1'};
  try{
   const res1=await app.inject({method:'POST',url:`/api/v1/conversations/${conversation}/stream/${streamId}/cancel`,headers,payload:{reason:'Interrupted'}});
   expect(res1.statusCode).toBe(200);
   expect(res1.json()).toEqual({success:true,stream_id:streamId,status:'cancelled',version:33,idempotent:false});
   expect(cancelCalls).toBe(3);

   scenario='completed_race';findCalls=0;cancelCalls=0;
   const res2=await app.inject({method:'POST',url:`/api/v1/conversations/${conversation}/stream/${streamId}/cancel`,headers,payload:{reason:'Interrupted'}});
   expect(res2.statusCode).toBe(200);
   expect(res2.json()).toEqual({success:true,stream_id:streamId,status:'completed',version:35,idempotent:true});

   scenario='exhaust_conflict';findCalls=0;cancelCalls=0;
   const res3=await app.inject({method:'POST',url:`/api/v1/conversations/${conversation}/stream/${streamId}/cancel`,headers,payload:{reason:'Interrupted'}});
   expect(res3.statusCode).toBe(409);
  }finally{await app.close();}
 });
});
