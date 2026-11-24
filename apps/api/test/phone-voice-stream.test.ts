import {createHmac} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PhoneContactRepository,ApprovalRepository} from '@thaara/db';
import {loadConfig} from '@thaara/config';
import {Logger} from '@thaara/observability';
import {buildApp} from '../src/app.js';
import {generateCsrfToken} from '../src/crypto/csrf.js';
import {createPlivoCallProvider} from '../src/services/phone-plivo.js';
import {createPlivoSdkVerifier} from '../src/services/phone-plivo-verifier.js';
import {createMemoryNonceStore} from '../src/services/phone-callback-admission.js';
import {CLOSINGS} from '../src/services/phone-voice.js';
import {phoneContactsDatabase} from './helpers/phone-contacts-fixture.js';

// Synthetic token, fake Plivo network, fake speech engines, in-process WebSocket, in-memory database.
const TOKEN='synthetic-auth-token-0123456789',origin='https://thaara.example.com',callUuid='cccccccc-3333-4333-8333-333333333333';
const credentials={resolve:async()=>({authId:'MAZSYNTHETIC01',authToken:TOKEN})};
const signPost=(url:string,params:Record<string,string>,nonce:string)=>createHmac('sha256',TOKEN).update(url+'?'+Object.keys(params).sort().map(k=>k+params[k]).join('')+'.'+nonce).digest('base64');
const signGet=(url:string,nonce:string)=>createHmac('sha256',TOKEN).update(url+'.'+nonce).digest('base64');
const nonce=()=>'n'+Math.random().toString(36).slice(2,14);

describe('Step 110 voice stream WebSocket end to end',()=>{
 let f:Awaited<ReturnType<typeof phoneContactsDatabase>>,app:Awaited<ReturnType<typeof buildApp>>;
 const csrf=generateCsrfToken(),base='/api/v1/connectors/phone/ai';
 const headers=()=>({cookie:`thaara_session=${f.owner.token}; thaara_csrf=${csrf}`,'x-csrf-token':csrf});
 const sttListeners:((t:{id:string;text:string;final:boolean})=>void)[]=[];
 let callId='',disclosure='';
 beforeAll(async()=>{
  f=await phoneContactsDatabase({live:true});
  await new PhoneContactRepository(f.db).create(f.owner,'ram',{displayName:'Ram',aliases:[],phoneE164:'+919000000002',consent:{callingAllowed:true,reference:'consent-1',source:'recipient_verbal',recordedAt:new Date(Date.now()-86400000).toISOString(),expiresAt:new Date(Date.now()+86400000*30).toISOString()}});
  const plivo=vi.fn(async()=>new Response(JSON.stringify({api_id:'x',message:'call fired',request_uuid:'bbbbbbbb-2222-4222-8222-000000000001'}),{status:201}));
  const provider=createPlivoCallProvider({liveCallingEnabled:true,credentials,fromNumber:'+919000000001',callbackOrigin:origin,fetch:plivo as unknown as typeof fetch});
  const replies=[{text:'Thank you, I will pass that on.',endCall:true}];
  app=await buildApp({db:f.db,config:loadConfig({NODE_ENV:'test'}),logger:new Logger('error'),phoneCalling:{durableContacts:true,durableCalls:true,liveCalling:{provider,callbacks:{
   callbackOrigin:origin,verifier:createPlivoSdkVerifier(credentials),nonces:createMemoryNonceStore(),
   voice:{createEngines:()=>({dialogue:{propose:async()=>replies.shift()??{text:'Bye.',endCall:true}},tts:{synthesize:async t=>({audio:new TextEncoder().encode(t),durationMs:5})},
    stt:{push:()=>{},close:()=>{},onTranscript:l=>{sttListeners.push(l);}}})}}}}});
  await app.ready();
  const p=(await app.inject({method:'POST',url:base+'/drafts',headers:headers(),payload:{contactQuery:'Ram',purpose:'Can you attend tomorrow?',language:'en-IN'}})).json();
  disclosure=p.draft.aiDisclosure;
  await f.db.withScopedTransaction(f.owner,tx=>new ApprovalRepository(tx).transitionStatus(f.owner.workspaceId,p.approvalId,'pending','approved',f.owner.userId));
  callId=(await app.inject({method:'POST',url:base+'/calls',headers:headers(),payload:{approvalId:p.approvalId}})).json().id;
 },60000);
 afterAll(async()=>{await app?.close();await f?.db.close();});

 const callback=async(hook:string,params:Record<string,string>)=>{
  const path=`/api/v1/connectors/phone/plivo/calls/${callId}/${hook}`,n=nonce();
  return app.inject({method:'POST',url:path,headers:{'content-type':'application/x-www-form-urlencoded','x-plivo-signature-v3':signPost(origin+path,params,n),'x-plivo-signature-v3-nonce':n},payload:new URLSearchParams(params).toString()});
 };
 const streamPath=()=>`/api/v1/connectors/phone/plivo/calls/${callId}/stream`;
 const upgrade=(over:{signature?:string}={})=>{const n=nonce();return app.injectWS(streamPath(),{headers:{'x-plivo-signature-v3':over.signature??signGet(origin+streamPath(),n),'x-plivo-signature-v3-nonce':n}});};

 it('refuses a stream before the call is answered or without a valid signature',async()=>{
  await expect(upgrade()).rejects.toThrow();
  const ids={RequestUUID:'bbbbbbbb-2222-4222-8222-000000000001',CallUUID:callUuid};
  expect((await callback('ring',{...ids,CallStatus:'ringing'})).statusCode).toBe(200);
  const answer=await callback('answer',{...ids,CallStatus:'in-progress'});
  expect(answer.body).toContain('<Stream bidirectional="true"');expect(answer.body).toContain(`wss://thaara.example.com${streamPath()}`);
  await expect(upgrade({signature:'forged'})).rejects.toThrow();
 });

 it('speaks the AI disclosure first, records the recipient’s final words as evidence, and closes after the goodbye',async()=>{
  const ws=await upgrade();
  const received:Record<string,unknown>[]=[];ws.on('message',(d:Buffer)=>received.push(JSON.parse(d.toString())));
  const closed=new Promise<number>(r=>ws.on('close',(code:number)=>r(code)));
  ws.send(JSON.stringify({event:'start',start:{streamId:'stream-1',callId:callUuid}}));
  const spoken=()=>received.filter(m=>m.event==='playAudio').map(m=>Buffer.from(String((m.media as {payload:string}).payload),'base64').toString());
  await vi.waitFor(()=>expect(spoken().slice(0,2)).toEqual([disclosure,'Can you attend tomorrow?']));
  sttListeners.at(-1)!({id:'t1',text:'Yes, I can attend at 11.',final:true});
  expect(await closed).toBe(1000);
  expect(spoken().slice(-2)).toEqual(['Thank you, I will pass that on.',CLOSINGS['en-IN']]);
  expect((await callback('hangup',{RequestUUID:'bbbbbbbb-2222-4222-8222-000000000001',CallUUID:callUuid,CallStatus:'completed'})).statusCode).toBe(200);
  const call=(await app.inject({method:'GET',url:base+'/calls',headers:headers()})).json().calls.find((c:{id:string})=>c.id===callId);
  expect(call).toMatchObject({state:'completed',simulated:false,report:{quotedResponses:['Yes, I can attend at 11.'],evidenceIds:['stt-t1'],simulated:false}});
  expect(call.report.text).toContain('No agreement or attendance is inferred');
  const audit=await f.db.withScopedTransaction(f.owner,tx=>tx.query<{action:string;payload:unknown}>("SELECT action,payload FROM audit_events WHERE target_type='phone_call' AND target_id=$1",[callId]));
  expect(audit.rows.map(r=>r.action)).toContain('phone.ai.provider_transcript');
  expect(JSON.stringify(audit.rows)).not.toContain('attend at 11');
 });

 it('refuses a second stream once the call has ended, and the database refuses transcripts for unbound calls',async()=>{
  await expect(upgrade()).rejects.toThrow();
  await expect(f.db.query("SELECT public.append_phone_provider_transcript($1,$2,'stt-x','Hi',$3,'verbatim')",[callId,'dddddddd-4444-4444-8444-444444444444','a'.repeat(64)])).rejects.toThrow(/binding denied/);
  expect((await f.db.query<{result:string}>("SELECT public.append_phone_provider_transcript($1,$2,'stt-late','Late words',$3,'verbatim') AS result",[callId,callUuid,'b'.repeat(64)])).rows[0]!.result).toBe('ignored');
 });
});
