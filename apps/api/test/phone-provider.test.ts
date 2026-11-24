import {describe,expect,it,vi} from 'vitest';
import {createPlivoCallProvider,type PlivoProviderOptions} from '../src/services/phone-plivo.js';
import {createPhoneCallbackAdmission,createMemoryNonceStore,createRedisNonceStore,type PhoneCallbackRequest,type PhoneCallbackVerifier} from '../src/services/phone-callback-admission.js';

// Synthetic values only. No network: every fetch is a vi.fn() fake.
const SECRET='synthetic-token-0123456789abcdef';
const callId='aaaaaaaa-1111-4111-8111-111111111111',requestUuid='bbbbbbbb-2222-4222-8222-222222222222',callUuid='cccccccc-3333-4333-8333-333333333333';
const ok=(body:unknown,status=201,headers:Record<string,string>={})=>vi.fn(async()=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers}));
const provider=(over:Partial<PlivoProviderOptions>={})=>createPlivoCallProvider({liveCallingEnabled:true,credentials:{resolve:async()=>({authId:'MAZSYNTHETIC01',authToken:SECRET})},
 fromNumber:'+919000000001',callbackOrigin:'https://thaara.example.com',fetch:ok({api_id:'x',message:'call fired',request_uuid:requestUuid}) as unknown as typeof fetch,...over});
const dispatch={callId,to:'+919000000002',maxDurationSeconds:120};

describe('Plivo call provider (mocked network)',()=>{
 it('does nothing at all unless live calling is explicitly enabled',async()=>{
  const f=ok({});const resolve=vi.fn();
  const p=createPlivoCallProvider({liveCallingEnabled:false,credentials:{resolve},fromNumber:'+919000000001',callbackOrigin:'https://thaara.example.com',fetch:f as unknown as typeof fetch});
  expect(await p.dispatch(dispatch)).toEqual({status:'not_configured'});
  expect(p.liveCallingEnabled).toBe(false);expect(f).not.toHaveBeenCalled();expect(resolve).not.toHaveBeenCalled();
 });

 it('sends one fixed-endpoint request with pinned callbacks and reports only an unverified acknowledgement',async()=>{
  const f=ok({api_id:'x',message:'call fired',request_uuid:requestUuid});
  expect(await provider({fetch:f as unknown as typeof fetch}).dispatch(dispatch)).toEqual({status:'unverified',providerRequestId:requestUuid});
  expect(f).toHaveBeenCalledTimes(1);
  const [url,init]=f.mock.calls[0] as unknown as [string,RequestInit];
  expect(url).toBe('https://api.plivo.com/v1/Account/MAZSYNTHETIC01/Call/');
  expect(init).toMatchObject({method:'POST',redirect:'error'});
  expect(JSON.parse(String(init.body))).toEqual({from:'+919000000001',to:'+919000000002',answer_url:`https://thaara.example.com/api/v1/connectors/phone/plivo/calls/${callId}/answer`,answer_method:'POST',
   ring_url:`https://thaara.example.com/api/v1/connectors/phone/plivo/calls/${callId}/ring`,ring_method:'POST',hangup_url:`https://thaara.example.com/api/v1/connectors/phone/plivo/calls/${callId}/hangup`,hangup_method:'POST',time_limit:120,hangup_on_ring:30});
  expect(String(init.body)).not.toContain(SECRET);
 });

 it('classifies failures truthfully, never retries and never leaks the secret',async()=>{
  const cases:[ReturnType<typeof vi.fn>,string][]=[
   [ok({error:`bad ${SECRET}`},400),'failed'],[ok({error:'auth'},401),'failed'],[ok('oops',503),'unknown'],
   [ok({message:'call fired'},201),'unknown'],[ok({message:'queued',request_uuid:requestUuid}),'unknown'],[ok({message:'call fired',request_uuid:[requestUuid,requestUuid]}),'unknown'],
   [ok('not json',201),'unknown'],[ok('x'.repeat(9000),201),'unknown'],[ok({},201,{'content-length':'999999'}),'unknown'],
   [vi.fn(async()=>{throw new Error(`network ${SECRET}`);}),'unknown'],
  ];
  for(const [f,status] of cases){
   const r=await provider({fetch:f as unknown as typeof fetch}).dispatch(dispatch);
   expect(r.status).toBe(status);expect(JSON.stringify(r)).not.toContain(SECRET);expect(f).toHaveBeenCalledTimes(1);
  }
  expect(await provider({credentials:{resolve:async()=>{throw new Error(SECRET);}}}).dispatch(dispatch)).toEqual({status:'not_configured'});
  expect(await provider({credentials:{resolve:async()=>({authId:'MAZSYNTHETIC01',authToken:'short'})}}).dispatch(dispatch)).toEqual({status:'not_configured'});
  for(const bad of [{...dispatch,to:'+14155550100'},{...dispatch,to:'+919000000001'},{...dispatch,to:'+919000000002<+919000000003'},{...dispatch,maxDurationSeconds:3600}]){
   const f=ok({});expect(await provider({fetch:f as unknown as typeof fetch}).dispatch(bad)).toEqual({status:'failed',code:'PHONE_DISPATCH_INPUT'});expect(f).not.toHaveBeenCalled();
  }
 });
});

describe('Plivo callback admission (official-SDK verifier injected; synthetic requests only)',()=>{
 const origin='https://thaara.example.com';
 const bindings={find:async(id:string)=>id===callId?{callId,providerRequestId:requestUuid,providerCallId:null}:null};
 const request=(over:Partial<PhoneCallbackRequest>={},form:Record<string,unknown>={}):PhoneCallbackRequest=>({method:'POST',hook:'ring',callId,url:`${origin}/api/v1/connectors/phone/plivo/calls/${callId}/ring`,
  headers:{'x-plivo-signature-v3':'sig','x-plivo-signature-v3-nonce':'nonce-'+Math.random().toString(36).slice(2,12)},form:{RequestUUID:requestUuid,CallUUID:callUuid,CallStatus:'ringing',...form},...over});
 const admission=(verifier?:PhoneCallbackVerifier)=>createPhoneCallbackAdmission({callbackOrigin:origin,verifier,nonces:createMemoryNonceStore(),bindings});

 it('refuses everything as not configured until the official verifier is installed',async()=>{
  expect(await admission()(request())).toEqual({status:'not_configured'});
 });

 it('accepts a verified, fresh, correctly bound callback and passes the exact signed inputs to the verifier',async()=>{
  const verifier=vi.fn(()=>true);
  const r=await admission(verifier)(request());
  expect(r).toMatchObject({status:'accepted',callId,hook:'ring',state:'ringing',providerCallId:callUuid});
  expect(verifier).toHaveBeenCalledWith(expect.objectContaining({method:'POST',url:`${origin}/api/v1/connectors/phone/plivo/calls/${callId}/ring`,signature:'sig',params:{RequestUUID:requestUuid,CallUUID:callUuid,CallStatus:'ringing'}}));
  const a=admission(()=>true);
  expect(await a(request({hook:'answer',url:`${origin}/api/v1/connectors/phone/plivo/calls/${callId}/answer`},{CallStatus:'in-progress'}))).toMatchObject({state:'answered'});
  for(const [status,state] of [['completed','completed'],['busy','busy'],['no-answer','no_answer'],['timeout','no_answer'],['failed','failed'],['cancel','cancelled']])
   expect(await a(request({hook:'hangup',url:`${origin}/api/v1/connectors/phone/plivo/calls/${callId}/hangup`},{CallStatus:status}))).toMatchObject({status:'accepted',state});
 });

 it('rejects bad signatures, replays, wrong URLs, foreign bindings, odd shapes and unknown statuses',async()=>{
  const a=admission(()=>true);
  expect(await admission(()=>false)(request())).toEqual({status:'rejected',reason:'signature'});
  expect(await admission(()=>{throw new Error('boom');})(request())).toEqual({status:'rejected',reason:'signature'});
  expect(await a(request({headers:{}}))).toEqual({status:'rejected',reason:'signature'});
  const once=request();expect((await a(once)).status).toBe('accepted');expect(await a(once)).toEqual({status:'rejected',reason:'replay'});
  expect(await a(request({url:`https://evil.example.com/api/v1/connectors/phone/plivo/calls/${callId}/ring`}))).toEqual({status:'rejected',reason:'url'});
  expect(await a(request({url:`${origin}/api/v1/connectors/phone/plivo/calls/${callId}/ring?x=1`}))).toEqual({status:'rejected',reason:'url'});
  expect(await a(request({},{RequestUUID:'dddddddd-4444-4444-8444-444444444444'}))).toEqual({status:'rejected',reason:'binding'});
  const other='eeeeeeee-5555-4555-8555-555555555555';
  expect(await a(request({callId:other,url:`${origin}/api/v1/connectors/phone/plivo/calls/${other}/ring`}))).toEqual({status:'rejected',reason:'binding'});
  expect(await a(request({},{CallStatus:'in-progress'}))).toEqual({status:'rejected',reason:'status'});
  expect(await a(request({},{CallStatus:'answered'}))).toEqual({status:'rejected',reason:'status'});
  expect(await a(request({},{CallStatus:['ringing']}))).toEqual({status:'rejected',reason:'shape'});
  expect(await a(request({method:'GET'}))).toEqual({status:'rejected',reason:'route'});
  expect(await a(request({hook:'transcript'}))).toEqual({status:'rejected',reason:'route'});
  const locked=createPhoneCallbackAdmission({callbackOrigin:origin,verifier:()=>true,nonces:createMemoryNonceStore(),bindings:{find:async()=>({callId,providerRequestId:requestUuid,providerCallId:'ffffffff-6666-4666-8666-666666666666'})}});
  expect(await locked(request())).toEqual({status:'rejected',reason:'binding'});
 });

 it('only spends a nonce after the signature is valid, and expires nonces',async()=>{
  let t=0;const nonces=createMemoryNonceStore(()=>t);let valid=false;
  const a=createPhoneCallbackAdmission({callbackOrigin:origin,verifier:()=>valid,nonces,bindings});
  const r=request();
  expect((await a(r)).status).toBe('rejected');valid=true;
  expect((await a(r)).status).toBe('accepted');
  expect((await a(r)).status).toBe('rejected');t+=11*60*1000;
  expect((await a(r)).status).toBe('accepted');
 });
});

describe('shared Redis nonce store (fake clients; no Redis dependency)',()=>{
 function fakeRedis(){
  const keys=new Map<string,number>();let t=0;
  const set=(key:string,ttl:number)=>{for(const [k,e] of keys)if(e<=t)keys.delete(k);if(keys.has(key))return null;keys.set(key,t+ttl);return 'OK';};
  return {keys,advance:(ms:number)=>{t+=ms;},
   node:{set:vi.fn(async(key:string,_v:string,o:{condition:'NX';expiration:{type:'PX';value:number}})=>o.condition==='NX'&&o.expiration.type==='PX'?set(key,o.expiration.value):null)},
   io:{set:vi.fn(async(key:string,_v:string,_px:'PX',ttl:number,_nx:'NX')=>set(key,ttl))}};
 }
 it('is first-writer-wins across instances, hashes nonces into keys and expires them',async()=>{
  for(const kind of ['node-redis','ioredis'] as const){
   const r=fakeRedis();
   const a=kind==='node-redis'?createRedisNonceStore({kind,client:r.node}):createRedisNonceStore({kind,client:r.io});
   const b=kind==='node-redis'?createRedisNonceStore({kind,client:r.node}):createRedisNonceStore({kind,client:r.io});
   expect(await a.remember('nonce-abc12345',600000)).toBe(true);
   expect(await b.remember('nonce-abc12345',600000)).toBe(false);
   expect([...r.keys.keys()][0]).toMatch(/^thaara:phone:callback-nonce:[a-f0-9]{64}$/);
   expect([...r.keys.keys()][0]).not.toContain('nonce-abc12345');
   r.advance(600001);expect(await b.remember('nonce-abc12345',600000)).toBe(true);
  }
 });
 it('fails closed on Redis errors and refuses odd inputs without calling Redis',async()=>{
  const broken=createRedisNonceStore({kind:'node-redis',client:{set:async()=>{throw new Error('ECONNREFUSED');}}});
  expect(await broken.remember('nonce-abc12345',600000)).toBe(false);
  const r=fakeRedis(),s=createRedisNonceStore({kind:'node-redis',client:r.node});
  for(const [n,ttl] of [['',600000],['x'.repeat(300),600000],['ok-nonce-1',10],['ok-nonce-1',86_400_001]] as const)expect(await s.remember(n,ttl)).toBe(false);
  expect(r.node.set).not.toHaveBeenCalled();
  const a=createPhoneCallbackAdmission({callbackOrigin:'https://thaara.example.com',verifier:()=>true,nonces:broken,bindings:{find:async()=>null}});
  expect((await a({method:'POST',hook:'ring',callId:'aaaaaaaa-1111-4111-8111-111111111111',url:'https://thaara.example.com/api/v1/connectors/phone/plivo/calls/aaaaaaaa-1111-4111-8111-111111111111/ring',headers:{'x-plivo-signature-v3':'s','x-plivo-signature-v3-nonce':'nonce-abc12345'},form:{CallStatus:'ringing'}})).status).toBe('rejected');
 });
});
