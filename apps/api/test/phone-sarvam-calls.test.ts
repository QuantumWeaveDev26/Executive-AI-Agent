import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PhoneContactRepository,ApprovalRepository} from '@thaara/db';
import {loadConfig} from '@thaara/config';
import {Logger} from '@thaara/observability';
import {buildApp} from '../src/app.js';
import {generateCsrfToken} from '../src/crypto/csrf.js';
import {admitSarvamWebhook,createSarvamCallProvider,sarvamWebhookToken,type SarvamCallProviderOptions} from '../src/services/phone-sarvam-calls.js';
import {AI_DISCLOSURES} from '../src/services/phone-conversation.js';
import {phoneContactsDatabase} from './helpers/phone-contacts-fixture.js';

// Synthetic ids and keys, fake Sarvam network, in-memory database. No real call is placed.
const API_KEY='synthetic-sarvam-api-key',SECRET='synthetic-webhook-secret-0123456789abcdef';
const callId='aaaaaaaa-1111-4111-8111-111111111111';
const base=(over:Partial<SarvamCallProviderOptions>={}):SarvamCallProviderOptions=>({liveCallingEnabled:true,secrets:{resolve:async()=>({apiKey:API_KEY,webhookSecret:SECRET})},
 orgId:'org_synthetic',workspaceId:'ws_synthetic',appId:'app_thaara',appVersion:3,connectionId:'conn_1',enforcedMaxDurationSeconds:300,agentPhoneNumber:'+918000000001',callbackOrigin:'https://thaara.example.com',
 fetch:vi.fn(async()=>new Response(JSON.stringify({attempt_id:'att_123'}),{status:200})) as unknown as typeof fetch,...over});
const request={callId,to:'+919000000002',recipientName:'Ram',maxDurationSeconds:300,purpose:'Can you attend tomorrow at 11?',language:'kn-en' as const,aiDisclosure:AI_DISCLOSURES['kn-en']};
it('preserves Sarvam agent/user speaker attribution and leaves unknown speakers uncertain',async()=>{
 const decision=await admitSarvamWebhook({callId,token:sarvamWebhookToken(SECRET,callId),body:{attempt_id:'att_123',status:'connected',interaction_id:'20261106/fixture',webhook_config:{metadata:{thaara_call_id:callId}},interaction_transcript:[{role:'agent',en_text:'When will it be ready?'},{role:'user',en_text:'Sunday afternoon.'},{role:'other',en_text:'Unattributed speech.'}]}},{webhookSecret:async()=>SECRET,binding:async()=>({providerRequestId:'att_123'})});
 expect(decision.status).toBe('accepted');if(decision.status!=='accepted')throw Error('fixture rejected');
 expect(decision.conversation.turns.map(t=>t.speaker)).toEqual(['thaara','customer','unknown']);
 expect(decision.conversation.turns[2]?.attribution).toBe('uncertain');
 expect(decision.recipientLines.map(t=>t.text)).toEqual(['Sunday afternoon.']);
 expect(decision.conversation.turns.every(t=>t.source==='provider_english_translation')).toBe(true);
});

describe('Sarvam Voice Agents call provider (fake network)',()=>{
 it('binds the five-minute cap and refuses a shorter requested maximum without a provider request',async()=>{
  const fetch=vi.fn(),p=createSarvamCallProvider(base({fetch:fetch as unknown as typeof globalThis.fetch}));
  expect(await p.dispatch({...request,maxDurationSeconds:120})).toMatchObject({status:'failed'});expect(fetch).not.toHaveBeenCalled();
  expect(p.configurationFingerprint).not.toBe(createSarvamCallProvider(base({enforcedMaxDurationSeconds:120})).configurationFingerprint);
  expect(()=>createSarvamCallProvider(base({enforcedMaxDurationSeconds:301}))).toThrow();
 });
 it('does nothing unless live calling is explicitly enabled',async()=>{
  const f=vi.fn();const p=createSarvamCallProvider(base({liveCallingEnabled:false,fetch:f as unknown as typeof fetch}));
  expect(await p.dispatch(request)).toEqual({status:'not_configured'});expect(f).not.toHaveBeenCalled();
 });
 it('sends one request whose first line is the approved AI disclosure and whose webhook is a per-call secret URL',async()=>{
  const f=vi.fn(async()=>new Response(JSON.stringify({attempt_id:'att_123'}),{status:200}));
  expect(await createSarvamCallProvider(base({fetch:f as unknown as typeof fetch})).dispatch(request)).toEqual({status:'unverified',providerRequestId:'att_123'});
  const [url,init]=f.mock.calls[0] as unknown as [string,RequestInit];
  expect(url).toBe('https://apps.sarvam.ai/api/outbounds/v1/orgs/org_synthetic/workspaces/ws_synthetic/outbounds');
  expect(init).toMatchObject({method:'POST',redirect:'error'});expect((init.headers as Record<string,string>)['X-API-Key']).toBe(API_KEY);
  const body=JSON.parse(String(init.body));
  expect(body).toEqual({app_config:{app_id:'app_thaara',app_version:3,connection_config:{connection_id:'conn_1',agent_phone_number:'+918000000001'},
   agent_variables:{call_purpose:'Can you attend tomorrow at 11?',user_name:'Ram'},
   app_overrides:{initial_bot_message:AI_DISCLOSURES['kn-en'],initial_language_name:'Kannada'}},
   user_config:{user_phone_number:'+919000000002'},
   webhook_config:{url:`https://thaara.example.com/api/v1/connectors/phone/sarvam/calls/${callId}/${sarvamWebhookToken(SECRET,callId)}`,metadata:{thaara_call_id:callId}}});
  expect(String(init.body)).not.toContain(API_KEY);expect(String(init.body)).not.toContain(SECRET);
 });
 it('classifies outcomes truthfully, never retries, and validates input and configuration',async()=>{
  for(const [res,status] of [[new Response('{"detail":[]}',{status:422}),'failed'],[new Response('x',{status:401}),'failed'],[new Response('down',{status:503}),'unknown'],
   [new Response('not json',{status:200}),'unknown'],[new Response(JSON.stringify({attempt_id:'bad id!'}),{status:200}),'unknown']] as const){
   const f=vi.fn(async()=>res);expect((await createSarvamCallProvider(base({fetch:f as unknown as typeof fetch})).dispatch(request)).status).toBe(status);expect(f).toHaveBeenCalledTimes(1);
  }
  expect((await createSarvamCallProvider(base({fetch:vi.fn(async()=>{throw new Error(API_KEY);}) as unknown as typeof fetch})).dispatch(request))).toEqual({status:'unknown',code:'PHONE_DISPATCH_NETWORK'});
  for(const bad of [{...request,to:'+14155550100'},{...request,to:'+918000000001'},{...request,aiDisclosure:undefined},{...request,recipientName:undefined},{...request,purpose:'x'.repeat(10001)}]){
   const f=vi.fn();expect(await createSarvamCallProvider(base({fetch:f as unknown as typeof fetch})).dispatch(bad)).toEqual({status:'failed',code:'PHONE_DISPATCH_INPUT'});expect(f).not.toHaveBeenCalled();
  }
  const longFetch=vi.fn(async()=>new Response(JSON.stringify({attempt_id:'att_long'}),{status:200}));
  expect(await createSarvamCallProvider(base({fetch:longFetch as unknown as typeof fetch})).dispatch({...request,purpose:'x'.repeat(9904)})).toEqual({status:'unverified',providerRequestId:'att_long'});
  expect(longFetch).toHaveBeenCalledTimes(1);
  expect(await createSarvamCallProvider(base({secrets:{resolve:async()=>({apiKey:API_KEY,webhookSecret:'short'})}})).dispatch(request)).toEqual({status:'not_configured'});
  for(const over of [{agentPhoneNumber:'8000000001'},{callbackOrigin:'http://thaara.example.com'},{orgId:'a/b'}])expect(()=>createSarvamCallProvider(base(over))).toThrow(/configuration denied/);
 });
});

describe('Sarvam webhook admission',()=>{
 const token=sarvamWebhookToken(SECRET,callId);
 const payload=(over:object={})=>({attempt_id:'att_123',status:'connected',interaction_id:'int_9',duration:42,interaction_transcript:[{role:'agent',en_text:'Hello, I am Thaara.'},{role:'user',en_text:'Yes, I can come at 11.'},{role:'user',en_text:' '}],webhook_config:{url:'x',metadata:{thaara_call_id:callId}},...over});
 const o={webhookSecret:async()=>SECRET,binding:async(id:string)=>id===callId?{providerRequestId:'att_123'}:null};
 it('supports documented date/slash interaction ids while refusing path-like or oversized ids',async()=>{
  const id='20261030/9f1c2a7e-4b3d-4e8a-a1f0-6c2d9b7e5a14';
  expect(await admitSarvamWebhook({callId,token,body:payload({interaction_id:id})},o)).toMatchObject({status:'accepted',providerCallId:id});
  for(const bad of ['20261030/../x','20261030/..','20261030/a/b','20261030/a?secret=x','https://evil.test/a','20261030/'+ 'x'.repeat(129)])
   expect(await admitSarvamWebhook({callId,token,body:payload({interaction_id:bad})},o)).toMatchObject({status:'rejected'});
 });
 it('accepts only the right token, shape and attempt, and quotes only the recipient',async()=>{
  expect(await admitSarvamWebhook({callId,token,body:payload()},{...o,webhookSecret:undefined})).toEqual({status:'not_configured'});
  const ok=await admitSarvamWebhook({callId,token,body:payload()},o);
  expect(ok).toMatchObject({status:'accepted',providerCallId:'int_9',states:['ringing','answered','completed']});
  expect(ok.status==='accepted'&&ok.recipientLines.map(l=>l.text)).toEqual(['Yes, I can come at 11.']);
  expect(await admitSarvamWebhook({callId,token:'0'.repeat(64),body:payload()},o)).toEqual({status:'rejected',reason:'token'});
  expect(await admitSarvamWebhook({callId,token:sarvamWebhookToken('another-secret-0123456789abcdefghij',callId),body:payload()},o)).toEqual({status:'rejected',reason:'token'});
  expect(await admitSarvamWebhook({callId,token,body:payload({attempt_id:'att_999'})},o)).toEqual({status:'rejected',reason:'binding'});
  expect(await admitSarvamWebhook({callId,token,body:payload({status:'answered'})},o)).toEqual({status:'rejected',reason:'shape'});
  expect(await admitSarvamWebhook({callId,token,body:payload({webhook_config:{url:'x',metadata:{thaara_call_id:'other'}}})},o)).toEqual({status:'rejected',reason:'shape'});
  expect(await admitSarvamWebhook({callId,token,body:payload({status:'no_answer',interaction_transcript:[{role:'user',en_text:'hi'}]})},o)).toMatchObject({states:['ringing','no_answer'],recipientLines:[]});
  expect(await admitSarvamWebhook({callId,token,body:payload({status:'failed',interaction_id:null})},o)).toMatchObject({states:['failed'],providerCallId:'att_123'});
 });
});

describe('Chat-style request -> approval -> Sarvam call -> report (in-memory database, fake Sarvam)',()=>{
 let f:Awaited<ReturnType<typeof phoneContactsDatabase>>,app:Awaited<ReturnType<typeof buildApp>>;
 const csrf=generateCsrfToken(),api='/api/v1/connectors/phone/ai';
 const headers=()=>({cookie:`thaara_session=${f.owner.token}; thaara_csrf=${csrf}`,'x-csrf-token':csrf});
 let attempt=0;const sarvam=vi.fn(async()=>new Response(JSON.stringify({attempt_id:`att_${++attempt}`}),{status:200}));
 const logger=new Logger('error'), logInfo=vi.spyOn(logger,'info');
 const reportVoice={speak:vi.fn(async()=>new Uint8Array([82,73,70,70]))};
 beforeAll(async()=>{
  f=await phoneContactsDatabase({live:true});
  const consent={callingAllowed:true,reference:'consent-1',source:'recipient_verbal' as const,recordedAt:new Date(Date.now()-86400000).toISOString(),expiresAt:new Date(Date.now()+86400000*30).toISOString()};
  await new PhoneContactRepository(f.db).create(f.owner,'ram',{displayName:'Ram',aliases:[],phoneE164:'+919000000002',consent});
  await new PhoneContactRepository(f.db).create(f.owner,'sita',{displayName:'Sita',aliases:[],phoneE164:'+919000000003',consent});
  app=await buildApp({db:f.db,config:loadConfig({NODE_ENV:'test'}),logger,phoneCalling:{durableContacts:true,durableCalls:true,reportVoice,
   liveCalling:{provider:createSarvamCallProvider(base({fetch:sarvam as unknown as typeof fetch})),sarvamWebhook:{webhookSecret:async()=>SECRET}}}});
  await app.ready();
 },60000);
 afterAll(async()=>{await app?.close();await f?.db.close();});
 const place=async(name:string)=>{
  const chat=await app.inject({method:'POST',url:'/api/v1/conversations',headers:headers(),payload:{title:'Phone'}});
  const stream=await app.inject({method:'POST',url:`/api/v1/conversations/${chat.json().id}/stream`,headers:headers(),payload:{content:`Hey Thaara, call ${name} and ask whether they can attend tomorrow at 11.`,idempotency_key:`chat-${name}-1`}});
  expect(stream.body).toContain('a LIVE');expect(stream.body).toContain('phone.ai.calls.request');
  const req=(await app.inject({method:'GET',url:api+'/requests',headers:headers()})).json().requests.find((q:{draft:{recipient:{displayName:string}}})=>q.draft.recipient.displayName===name);
  await f.db.withScopedTransaction(f.owner,tx=>new ApprovalRepository(tx).transitionStatus(f.owner.workspaceId,req.approvalId,'pending','approved',f.owner.userId));
  return (await app.inject({method:'POST',url:api+'/calls',headers:headers(),payload:{approvalId:req.approvalId}})).json();
 };
 const webhook=(id:string,body:object,token=sarvamWebhookToken(SECRET,id))=>app.inject({method:'POST',url:`/api/v1/connectors/phone/sarvam/calls/${id}/${token}`,payload:body});
 const callNow=async(id:string)=>(await app.inject({method:'GET',url:api+'/calls',headers:headers()})).json().calls.find((c:{id:string})=>c.id===id);
 it('prepares the five-minute maximum and refuses an unenforceable shorter approval',async()=>{
  const payload={contactQuery:'Ram',purpose:'Ask about project progress.',language:'en-IN'};
  const p=await app.inject({method:'POST',url:api+'/drafts',headers:headers(),payload});
  expect(p.statusCode).toBe(200);expect(p.json().draft.maxDurationSeconds).toBe(300);
  expect((await app.inject({method:'POST',url:api+'/drafts',headers:headers(),payload:{...payload,maxDurationSeconds:120}})).statusCode).toBe(400);
 });

 it('turns the Chat command into one approved Sarvam call and a truthful report of what the person said',async()=>{
  const call=await place('Ram');
  expect(call).toMatchObject({state:'queued',dispatchStatus:'unverified',simulated:false});
  expect(sarvam).toHaveBeenCalledTimes(1);
  const sent=JSON.parse(String((sarvam.mock.calls[0] as unknown as [string,RequestInit])[1].body));
  expect(sent.user_config.user_phone_number).toBe('+919000000002');expect(sent.app_config.app_overrides.initial_bot_message).toBe(call.draft.aiDisclosure);
  const body={attempt_id:'att_1',status:'connected',interaction_id:'20261030/int_ram',duration:40,webhook_config:{url:'x',metadata:{thaara_call_id:call.id}},
   interaction_transcript:[{role:'agent',en_text:'Hello, I am Thaara, an AI assistant.'},{role:'user',en_text:'Yes, I can attend at 11.'},{role:'agent',en_text:'Thank you.'},{role:'user',en_text:'Please share the location.'}]};
  expect((await webhook(call.id,body)).statusCode).toBe(200);
  const done=await callNow(call.id);
  expect(done).toMatchObject({state:'completed',providerCallId:'20261030/int_ram',report:{quotedResponses:['Yes, I can attend at 11.','Please share the location.'],simulated:false,verified:false}});
  expect(done.report.text).toContain('rendered in English by the call provider');expect(done.report.text).toContain('No agreement or attendance is inferred');
  expect(done.report.text).not.toContain('Hello, I am Thaara');
  // Webhook retries are harmless.
  expect((await webhook(call.id,body)).statusCode).toBe(200);
  expect((await callNow(call.id)).report.quotedResponses).toHaveLength(2);
  // Replaying the approval never calls Sarvam again.
  expect(sarvam).toHaveBeenCalledTimes(1);
 });

 it('refuses forged webhooks and records unanswered calls honestly',async()=>{
  const call=await place('Sita');
  const ok={attempt_id:'att_2',status:'no_answer',interaction_id:null,duration:null,webhook_config:{url:'x',metadata:{thaara_call_id:call.id}},interaction_transcript:null};
  expect((await webhook(call.id,ok,'0'.repeat(64))).statusCode).toBe(403);
  expect((await webhook(call.id,{...ok,attempt_id:'att_1'})).statusCode).toBe(403);
  expect((await webhook(call.id,{...ok,status:'connected',interaction_transcript:[{role:'user',en_text:'I agree to everything.'}],attempt_id:'att_x'})).statusCode).toBe(403);
  expect((await callNow(call.id)).state).toBe('queued');
  expect((await webhook(call.id,ok)).statusCode).toBe(200);
  expect(await callNow(call.id)).toMatchObject({state:'no_answer',report:{quotedResponses:[]}});
  expect((await app.inject({method:'POST',url:'/api/v1/connectors/phone/sarvam/calls/not-a-uuid/abc',payload:ok})).statusCode).toBe(403);
 });
 it('never logs the capability token, including rejected webhook URLs',async()=>{
  logInfo.mockClear();
  await webhook(callId,{},'e'.repeat(64));
  expect(JSON.stringify(logInfo.mock.calls)).not.toContain('e'.repeat(64));
 });
 it('confirms only the owner request and dispatches once under concurrent confirmations',async()=>{
  const prepared=await app.inject({method:'POST',url:api+'/drafts',headers:headers(),payload:{contactQuery:'Ram',purpose:'Ask about Friday.',language:'en-IN'}});
  const p=prepared.json();expect(prepared.statusCode).toBe(200);
  expect(p.draft.onBehalfOf).toBeTruthy();expect(p.draft.aiDisclosure).toContain(p.draft.onBehalfOf);
  const before=sarvam.mock.calls.length;
  for(const identity of [f.member,f.viewer,f.foreign]) {
   const h={cookie:`thaara_session=${identity.token}; thaara_csrf=${csrf}`,'x-csrf-token':csrf};
   expect((await app.inject({method:'POST',url:api+'/calls/confirm',headers:h,payload:{approvalId:p.approvalId}})).statusCode).toBe(403);
  }
  const pending=await f.db.withScopedTransaction(f.owner,tx=>new ApprovalRepository(tx).findById(f.owner.workspaceId,p.approvalId));
  expect(pending?.status).toBe('pending');
  expect(sarvam.mock.calls).toHaveLength(before);
  expect((await app.inject({method:'POST',url:api+'/calls/confirm',headers:{cookie:`thaara_session=${f.owner.token}`},payload:{approvalId:p.approvalId}})).statusCode).toBe(403);
  const confirmations=await Promise.all([1,2].map(()=>app.inject({method:'POST',url:api+'/calls/confirm',headers:headers(),payload:{approvalId:p.approvalId}})));
  expect(confirmations.map(r=>r.statusCode)).toEqual([200,200]);
  expect(confirmations[0]!.json().id).toBe(confirmations[1]!.json().id);
  expect(sarvam.mock.calls.length-before).toBe(1);
  const id=confirmations[0]!.json().id;
  expect((await app.inject({method:'POST',url:api+`/calls/${id}/speech`,headers:headers()})).statusCode).toBe(403);
 });
 it('speaks a completed owned report only, with provider uncertainty and translation disclosure',async()=>{
  const ram=(await app.inject({method:'GET',url:api+'/calls',headers:headers()})).json().calls.find((c:{state:string})=>c.state==='completed');
  expect((await app.inject({method:'POST',url:api+`/calls/${ram.id}/speech`,headers:headers()})).statusCode).toBe(200);
  expect(reportVoice.speak.mock.calls.at(-1)?.[0]).toContain('unverified');
  expect(reportVoice.speak.mock.calls.at(-1)?.[0]).toContain('English version');
  const n=reportVoice.speak.mock.calls.length;
  const h={cookie:`thaara_session=${f.foreign.token}; thaara_csrf=${csrf}`,'x-csrf-token':csrf};
  expect((await app.inject({method:'POST',url:api+`/calls/${ram.id}/speech`,headers:h})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:api+`/calls/${callId}/speech`,headers:headers()})).statusCode).toBe(403);
  expect(reportVoice.speak.mock.calls).toHaveLength(n);
 });
 it('refuses an old pending approval after the selected agent version changes',async()=>{
  const p=(await app.inject({method:'POST',url:api+'/drafts',headers:headers(),payload:{contactQuery:'Ram',purpose:'Ask about Monday.',language:'en-IN'}})).json();
  const fetch=vi.fn();
  const changed=await buildApp({db:f.db,config:loadConfig({NODE_ENV:'test'}),logger:new Logger('error'),phoneCalling:{durableContacts:true,durableCalls:true,
   liveCalling:{provider:createSarvamCallProvider(base({appVersion:4,fetch:fetch as unknown as typeof globalThis.fetch}))}}});
  try{
   expect((await changed.inject({method:'POST',url:api+'/calls/confirm',headers:headers(),payload:{approvalId:p.approvalId}})).statusCode).toBe(403);
   expect(fetch).not.toHaveBeenCalled();
   const approval=await f.db.withScopedTransaction(f.owner,tx=>new ApprovalRepository(tx).findById(f.owner.workspaceId,p.approvalId));
   expect(approval?.status).toBe('pending');
  }finally{await changed.close();}
 });
 it.each(['knowledgeSha256','policySha256','acceptanceEvidenceSha256'] as const)('refuses an old approval when reviewed %s changes',async key=>{
  const binding={reviewOnly:false as const,providerAcceptanceVerified:true as const,direction:'outbound' as const,appVersion:3,inboundAppVersion:2,
   maxDurationSeconds:300 as const,knowledgeBaseId:'synthetic-kb',knowledgeVersion:'qw-company-kb-v1' as const,
   knowledgeSha256:'a'.repeat(64),policyVersion:'qw-route-policy-v1' as const,policySha256:'b'.repeat(64),commonPolicySha256:'c'.repeat(64),acceptanceEvidenceSha256:'d'.repeat(64)};
  const fetch=vi.fn();
  const make=(companyKnowledge:typeof binding)=>buildApp({db:f.db,config:loadConfig({NODE_ENV:'test'}),logger:new Logger('error'),
   phoneCalling:{durableContacts:true,durableCalls:true,liveCalling:{provider:createSarvamCallProvider(base({companyKnowledge,fetch:fetch as unknown as typeof globalThis.fetch}))}}});
  const original=await make(binding),changed=await make({...binding,[key]:'e'.repeat(64)});
  try{
   const draft=(await original.inject({method:'POST',url:api+'/drafts',headers:headers(),payload:{contactQuery:'Ram',purpose:'Ask about the website.',language:'en-IN'}})).json();
   expect(draft.approvalId).toBeTruthy();
   expect((await changed.inject({method:'POST',url:api+'/calls/confirm',headers:headers(),payload:{approvalId:draft.approvalId}})).statusCode).toBe(403);
   expect(fetch).not.toHaveBeenCalled();
   const approval=await f.db.withScopedTransaction(f.owner,tx=>new ApprovalRepository(tx).findById(f.owner.workspaceId,draft.approvalId));
   expect(approval?.status).toBe('pending');
  }finally{await original.close();await changed.close();}
 });
 it('reads provider evidence only for an owned stored attempt, with CSRF and no redial',async()=>{
  const calls=(await app.inject({method:'GET',url:api+'/calls',headers:headers()})).json().calls;
  const ram=calls.find((c:{state:string})=>c.state==='completed');
  const before=sarvam.mock.calls.length;
  const url=api+`/calls/${ram.id}/result`;
  for(const identity of [f.member,f.viewer,f.foreign]){
   const h={cookie:`thaara_session=${identity.token}; thaara_csrf=${csrf}`,'x-csrf-token':csrf};
   expect((await app.inject({method:'POST',url,headers:h})).statusCode).toBe(403);
  }
  expect((await app.inject({method:'POST',url,headers:{cookie:`thaara_session=${f.owner.token}`}})).statusCode).toBe(403);
  expect(sarvam).toHaveBeenCalledTimes(before);
  sarvam.mockImplementationOnce(async()=>new Response(JSON.stringify({items:[{attempt_id:'att_1',app_version:3,channel_direction:'outbound',connectivity_status:'connected',interaction_id:'20261030/int_ram',end_datetime:'2026-10-30T01:00:00'}]})));
  sarvam.mockImplementationOnce(async()=>new Response(JSON.stringify({interaction_id:'20261030/int_ram',messages:[{role:'assistant',content:'Can you attend?'},{role:'user',content:'Yes, at eleven.'}]})));
  const response=await app.inject({method:'POST',url,headers:headers()});
  expect(response.statusCode,response.body).toBe(200);
  expect(response.json()).toMatchObject({callId:ram.id,status:'available',outcome:'completed',responses:['Yes, at eleven.'],verified:false,source:'provider_api'});
  const methods=sarvam.mock.calls.slice(before).map(args=>(args as unknown as [string,RequestInit])[1].method);
  expect(methods).toEqual(['GET','GET']);
 });
});

describe('daily live call limit (enforced in the claim transaction)',()=>{
 let f:Awaited<ReturnType<typeof phoneContactsDatabase>>,app:Awaited<ReturnType<typeof buildApp>>;
 const csrf=generateCsrfToken(),api='/api/v1/connectors/phone/ai';
 const headers=()=>({cookie:`thaara_session=${f.owner.token}; thaara_csrf=${csrf}`,'x-csrf-token':csrf});
 let n=0;const sarvam=vi.fn(async()=>new Response(JSON.stringify({attempt_id:`att_limit_${++n}`}),{status:200}));
 beforeAll(async()=>{
  f=await phoneContactsDatabase({live:true});
  const consent={callingAllowed:true,reference:'consent-1',source:'recipient_verbal' as const,recordedAt:new Date(Date.now()-86400000).toISOString(),expiresAt:new Date(Date.now()+86400000*30).toISOString()};
  for(const [id,name,phone] of [['a','Asha','+919000000011'],['b','Bala','+919000000012'],['c','Chitra','+919000000013']] as const)await new PhoneContactRepository(f.db).create(f.owner,id,{displayName:name,aliases:[],phoneE164:phone,consent});
  app=await buildApp({db:f.db,config:loadConfig({NODE_ENV:'test'}),logger:new Logger('error'),phoneCalling:{durableContacts:true,durableCalls:true,
   liveCalling:{provider:createSarvamCallProvider(base({fetch:sarvam as unknown as typeof fetch})),dailyCallLimit:1,sarvamWebhook:{webhookSecret:async()=>SECRET}}}});
  await app.ready();
 },60000);
 afterAll(async()=>{await app?.close();await f?.db.close();});
 const draft=async(name:string)=>(await app.inject({method:'POST',url:api+'/drafts',headers:headers(),payload:{contactQuery:name,purpose:'Quick check?',language:'en-IN'}})).json().approvalId as string;
 it('places at most the configured number of calls per 24 hours, even with parallel confirmations',async()=>{
  const [a,b]=await Promise.all([draft('Asha'),draft('Bala')]);
  const results=await Promise.all([a,b].map(id=>app.inject({method:'POST',url:api+'/calls/confirm',headers:headers(),payload:{approvalId:id}})));
  expect(results.map(r=>r.statusCode).sort()).toEqual([200,429]);
  expect(results.find(r=>r.statusCode===429)!.json().error.message).toContain('daily call limit');
  expect(sarvam).toHaveBeenCalledTimes(1);
  const c=await draft('Chitra');
  expect((await app.inject({method:'POST',url:api+'/calls/confirm',headers:headers(),payload:{approvalId:c}})).statusCode).toBe(429);
  expect(sarvam).toHaveBeenCalledTimes(1);
 });
 it('rejects an unsafe limit configuration',async()=>{
  await expect(buildApp({db:f.db,config:loadConfig({NODE_ENV:'test'}),logger:new Logger('error'),phoneCalling:{durableContacts:true,durableCalls:true,
   liveCalling:{provider:createSarvamCallProvider(base({fetch:sarvam as unknown as typeof fetch})),dailyCallLimit:50}}})).rejects.toThrow(/1-20/);
 });
});
