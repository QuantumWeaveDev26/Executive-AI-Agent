import {createHmac} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PGliteDatabase,Migrator,PhoneContactRepository,ApprovalRepository} from '@thaara/db';
import {loadConfig} from '@thaara/config';
import {Logger} from '@thaara/observability';
import {buildApp} from '../src/app.js';
import {generateCsrfToken} from '../src/crypto/csrf.js';
import {createPlivoCallProvider} from '../src/services/phone-plivo.js';
import {createPlivoSdkVerifier} from '../src/services/phone-plivo-verifier.js';
import {createMemoryNonceStore} from '../src/services/phone-callback-admission.js';
import {phoneContactsDatabase,PHONE_LIVE_SQL,approve110c} from './helpers/phone-contacts-fixture.js';

// Synthetic credentials and a fake Plivo network only. Nothing leaves the process.
const TOKEN='synthetic-auth-token-0123456789';
const credentials={resolve:async()=>({authId:'MAZSYNTHETIC01',authToken:TOKEN})};
const origin='https://thaara.example.com';
const day=86400000;
/** Test-side signer reproducing what Plivo sends; production verification is the official SDK only. */
function sign(url:string,params:Record<string,string>,nonce:string,token=TOKEN){
 const base=url+'?'+Object.keys(params).sort().map(k=>k+params[k]).join('')+'.'+nonce;
 return createHmac('sha256',token).update(base).digest('base64');
}

describe('official Plivo SDK verifier',()=>{
 const url=`${origin}/api/v1/connectors/phone/plivo/calls/aaaaaaaa-1111-4111-8111-111111111111/ring`,params={CallStatus:'ringing',CallUUID:'c',RequestUUID:'r'};
 it('accepts a correctly signed callback and rejects wrong token, tampered params and resolver failure',async()=>{
  const v=createPlivoSdkVerifier(credentials);
  expect(await v({method:'POST',url,nonce:'nonce12345',signature:sign(url,params,'nonce12345'),params})).toBe(true);
  expect(await v({method:'POST',url,nonce:'nonce12345',signature:sign(url,params,'nonce12345','another-token-0123456789'),params})).toBe(false);
  expect(await v({method:'POST',url,nonce:'nonce12345',signature:sign(url,params,'nonce12345'),params:{...params,CallStatus:'completed'}})).toBe(false);
  expect(await createPlivoSdkVerifier({resolve:async()=>{throw new Error(TOKEN);}})({method:'POST',url,nonce:'n',signature:'x',params})).toBe(false);
  expect(await createPlivoSdkVerifier(credentials,()=>{throw new Error('sdk');})({method:'POST',url,nonce:'n',signature:'x',params})).toBe(false);
 });
});

describe('Step 110c review SQL guard (in-memory PGlite only)',()=>{
 it('refuses without approval, without 110b, and on a second application',async()=>{
  const db=new PGliteDatabase(),m=new Migrator(db);await m.migrate(m.loadMigrationFiles());
  await expect(db.exec(PHONE_LIVE_SQL)).rejects.toThrow(/explicit approval/);await db.exec('ROLLBACK;');
  await approve110c(db);await expect(db.exec(PHONE_LIVE_SQL)).rejects.toThrow(/110a and 110b/);await db.exec('ROLLBACK;');
  await db.close();
  const f=await phoneContactsDatabase({live:true});await f.db.exec('RESET ROLE;');
  await expect(f.db.exec(PHONE_LIVE_SQL)).rejects.toThrow(/already exist/);await f.db.exec('ROLLBACK;');
  await f.db.close();
 },60000);
});

describe('Step 110 live mode end to end (fake Plivo network, in-memory database)',()=>{
 let f:Awaited<ReturnType<typeof phoneContactsDatabase>>,app:Awaited<ReturnType<typeof buildApp>>;
 const csrf=generateCsrfToken(),base='/api/v1/connectors/phone/ai';
 const headers=()=>({cookie:`thaara_session=${f.owner.token}; thaara_csrf=${csrf}`,'x-csrf-token':csrf});
 let plivo:ReturnType<typeof vi.fn>;
 let nextResponse:()=>Response;
 let requestSeq=0;
 const requestUuid=(n:number)=>`bbbbbbbb-2222-4222-8222-${String(n).padStart(12,'0')}`;
 const callUuid='cccccccc-3333-4333-8333-333333333333';
 beforeAll(async()=>{
  f=await phoneContactsDatabase({live:true});
  const contacts=new PhoneContactRepository(f.db),consent={callingAllowed:true,reference:'consent-1',source:'recipient_verbal' as const,recordedAt:new Date(Date.now()-day).toISOString(),expiresAt:new Date(Date.now()+30*day).toISOString()};
  for(const [id,name,phone] of [['ram','Ram','+919000000002'],['sita','Sita','+919000000003'],['gita','Gita','+919000000004']] as const)await contacts.create(f.owner,id,{displayName:name,aliases:[],phoneE164:phone,consent});
  nextResponse=()=>new Response(JSON.stringify({api_id:'x',message:'call fired',request_uuid:requestUuid(++requestSeq)}),{status:201});
  plivo=vi.fn(async()=>nextResponse());
  const provider=createPlivoCallProvider({liveCallingEnabled:true,credentials,fromNumber:'+919000000001',callbackOrigin:origin,fetch:plivo as unknown as typeof fetch});
  app=await buildApp({db:f.db,config:loadConfig({NODE_ENV:'test'}),logger:new Logger('error'),phoneCalling:{durableContacts:true,durableCalls:true,
   liveCalling:{provider,dailyCallLimit:20,callbacks:{callbackOrigin:origin,verifier:createPlivoSdkVerifier(credentials),nonces:createMemoryNonceStore()}}}});
  await app.ready();
 },60000);
 afterAll(async()=>{await app?.close();await f?.db.close();});

 const prepareAndApprove=async(name:string)=>{
  const r=await app.inject({method:'POST',url:base+'/drafts',headers:headers(),payload:{contactQuery:name,purpose:'Can you attend tomorrow at 11?',language:'en-IN'}});
  expect(r.statusCode,r.body).toBe(200);
  const p=r.json();
  expect((await app.inject({method:'POST',url:base+'/calls',headers:headers(),payload:{approvalId:p.approvalId}})).statusCode).toBe(403);
  await f.db.withScopedTransaction(f.owner,tx=>new ApprovalRepository(tx).transitionStatus(f.owner.workspaceId,p.approvalId,'pending','approved',f.owner.userId));
  return p;
 };
 const callback=(callId:string,hook:string,params:Record<string,string>,over:{nonce?:string;signature?:string;url?:string}={})=>{
  const path=over.url??`/api/v1/connectors/phone/plivo/calls/${callId}/${hook}`,nonce=over.nonce??('n'+Math.random().toString(36).slice(2,14));
  return app.inject({method:'POST',url:path,headers:{'content-type':'application/x-www-form-urlencoded','x-plivo-signature-v3':over.signature??sign(origin+path,params,nonce),'x-plivo-signature-v3-nonce':nonce},payload:new URLSearchParams(params).toString()});
 };

 it('reports live mode truthfully and prepares live drafts that cannot dial before approval',async()=>{
  expect((await app.inject({method:'GET',url:base+'/status',headers:headers()})).json()).toMatchObject({status:'live_enabled',liveCallingEnabled:true,durableCallHistory:true,recordingEnabled:false});
  const r=await app.inject({method:'POST',url:base+'/drafts',headers:headers(),payload:{contactQuery:'Ram',purpose:'x',language:'en-IN'}});
  expect(r.json()).toMatchObject({liveCallingEnabled:true,draft:{mode:'live'}});
  expect(plivo).not.toHaveBeenCalled();
 });

 it('places exactly one call per approval, then follows verified callbacks to completion',async()=>{
  const p=await prepareAndApprove('Ram');
  const placed=await app.inject({method:'POST',url:base+'/calls',headers:headers(),payload:{approvalId:p.approvalId}});
  expect(placed.statusCode,placed.body).toBe(200);
  const call=placed.json();
  expect(call).toMatchObject({state:'queued',simulated:false,verified:false,dispatchStatus:'unverified',providerCallId:null,report:{simulated:false}});
  expect(plivo).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String((plivo.mock.calls[0] as unknown as [string,RequestInit])[1].body))).toMatchObject({to:'+919000000002',from:'+919000000001',time_limit:120});
  expect(placed.body).not.toContain('+919000000002');
  // Replay never dials again.
  expect((await app.inject({method:'POST',url:base+'/calls',headers:headers(),payload:{approvalId:p.approvalId}})).json().id).toBe(call.id);
  expect(plivo).toHaveBeenCalledTimes(1);

  const ids={RequestUUID:requestUuid(1),CallUUID:callUuid};
  expect((await callback(call.id,'ring',{...ids,CallStatus:'ringing'})).statusCode).toBe(200);
  const answer=await callback(call.id,'answer',{...ids,CallStatus:'in-progress'});
  expect(answer.statusCode).toBe(200);expect(answer.headers['content-type']).toContain('application/xml');
  expect(answer.body).toContain(call.draft.aiDisclosure);expect(answer.body).toContain('Can you attend tomorrow at 11?');expect(answer.body).toContain('<Hangup/>');
  expect((await callback(call.id,'hangup',{...ids,CallStatus:'completed'})).statusCode).toBe(200);
  const done=(await app.inject({method:'GET',url:base+'/calls',headers:headers()})).json().calls.find((c:{id:string})=>c.id===call.id);
  expect(done).toMatchObject({state:'completed',providerCallId:callUuid,simulated:false,report:{quotedResponses:[],simulated:false}});
  expect(done.report.text).toContain('No conversation outcome');
  // Late callbacks are acknowledged but never move a finished call.
  expect((await callback(call.id,'ring',{...ids,CallStatus:'ringing'})).statusCode).toBe(200);
  expect((await app.inject({method:'GET',url:base+'/calls',headers:headers()})).json().calls.find((c:{id:string})=>c.id===call.id).state).toBe('completed');
 });

 it('rejects forged, replayed, rebound and misrouted callbacks without changing anything',async()=>{
  const p=await prepareAndApprove('Sita');
  const call=(await app.inject({method:'POST',url:base+'/calls',headers:headers(),payload:{approvalId:p.approvalId}})).json();
  const ids={RequestUUID:requestUuid(requestSeq),CallUUID:'dddddddd-4444-4444-8444-444444444444'};
  expect((await callback(call.id,'ring',{...ids,CallStatus:'ringing'},{signature:'forged'})).statusCode).toBe(403);
  expect((await callback(call.id,'ring',{...ids,RequestUUID:requestUuid(1),CallStatus:'ringing'})).statusCode).toBe(403);
  expect((await callback(call.id,'ring',{...ids,CallStatus:'ringing'},{url:`/api/v1/connectors/phone/plivo/calls/${call.id}/ring?x=1`})).statusCode).toBe(403);
  expect((await callback(call.id,'transcript',{...ids,CallStatus:'ringing'})).statusCode).toBe(403);
  const fixedNonce='replaynonce01';
  expect((await callback(call.id,'ring',{...ids,CallStatus:'ringing'},{nonce:fixedNonce})).statusCode).toBe(200);
  expect((await callback(call.id,'ring',{...ids,CallStatus:'ringing'},{nonce:fixedNonce})).statusCode).toBe(403);
  expect((await callback(call.id,'answer',{...ids,CallUUID:callUuid,CallStatus:'in-progress'})).statusCode).toBe(403);
  const audit=await f.db.withScopedTransaction(f.owner,tx=>tx.query<{action:string}>("SELECT action FROM audit_events WHERE target_type='phone_call' AND target_id=$1 ORDER BY created_at",[call.id]));
  expect(audit.rows.map(r=>r.action)).toEqual(['phone.ai.call_claimed','phone.ai.dispatch_claimed','phone.ai.dispatch_recorded','phone.ai.provider_event']);
 });

 it('records refused and unknown provider outcomes truthfully and never retries',async()=>{
  nextResponse=()=>new Response(JSON.stringify({error:'invalid destination'}),{status:400});
  const refused=await prepareAndApprove('Gita');
  const failed=(await app.inject({method:'POST',url:base+'/calls',headers:headers(),payload:{approvalId:refused.approvalId}})).json();
  expect(failed).toMatchObject({state:'failed',dispatchStatus:'failed'});expect(failed.report.text).toContain('No call was placed');
  const before=plivo.mock.calls.length;
  nextResponse=()=>new Response('upstream down',{status:503});
  const unsure=await prepareAndApprove('Ram');
  const unknown=(await app.inject({method:'POST',url:base+'/calls',headers:headers(),payload:{approvalId:unsure.approvalId}})).json();
  expect(unknown).toMatchObject({state:'queued',dispatchStatus:'unknown'});
  await app.inject({method:'POST',url:base+'/calls',headers:headers(),payload:{approvalId:unsure.approvalId}});
  expect(plivo.mock.calls.length).toBe(before+1);
 });

 it('keeps provider fields out of reach of the app role and the public binding narrow',async()=>{
  const q=(sql:string,params:unknown[]=[])=>f.db.withScopedTransaction(f.owner,tx=>tx.query(sql,params));
  const calls=(await app.inject({method:'GET',url:base+'/calls',headers:headers()})).json().calls as {id:string;dispatchStatus:string}[];
  const anyCall=calls.find(c=>c.dispatchStatus==='unverified')!;
  // Calls whose provider outcome is unknown or refused expose no callback binding at all.
  for(const c of calls.filter(c=>c.dispatchStatus!=='unverified'))expect((await f.db.query('SELECT * FROM public.phone_provider_binding($1)',[c.id])).rows).toEqual([]);
  await expect(q("UPDATE public.phone_calls SET provider_call_id=$2 WHERE call_id=$1",[anyCall.id,callUuid])).rejects.toThrow();
  await expect(q("UPDATE public.phone_calls SET dispatch_status='pending' WHERE call_id=$1",[anyCall.id])).rejects.toThrow();
  await expect(q("SELECT public.apply_phone_provider_event($1,$2,$3,'ringing','forged-event',$4)",[anyCall.id,requestUuid(999),callUuid,'a'.repeat(64)])).rejects.toThrow(/binding denied/);
  const binding=await f.db.query<Record<string,unknown>>('SELECT * FROM public.phone_provider_binding($1)',[anyCall.id]);
  expect(Object.keys(binding.rows[0]??{}).sort()).toEqual(['ai_disclosure','language','max_duration_seconds','on_behalf_of','provider_call_id','provider_request_id','purpose','state']);
  expect(JSON.stringify(binding.rows)).not.toContain('+9190000');
 });

 it('lists only the owner’s open, unstarted requests so an approved live call can be started after a reload',async()=>{
  const r=await app.inject({method:'POST',url:base+'/drafts',headers:headers(),payload:{contactQuery:'Sita',purpose:'Reload test?',language:'en-IN'}});
  const p=r.json();
  const list=async()=>(await app.inject({method:'GET',url:base+'/requests',headers:headers()})).json().requests as {approvalId:string;status:string;draft:{mode:string}}[];
  expect((await list()).find(q=>q.approvalId===p.approvalId)).toMatchObject({status:'pending',draft:{mode:'live'}});
  await f.db.withScopedTransaction(f.owner,tx=>new ApprovalRepository(tx).transitionStatus(f.owner.workspaceId,p.approvalId,'pending','approved',f.owner.userId));
  expect((await list()).find(q=>q.approvalId===p.approvalId)?.status).toBe('approved');
  nextResponse=()=>new Response(JSON.stringify({api_id:'x',message:'call fired',request_uuid:requestUuid(++requestSeq)}),{status:201});
  expect((await app.inject({method:'POST',url:base+'/calls',headers:headers(),payload:{approvalId:p.approvalId}})).statusCode).toBe(200);
  expect((await list()).some(q=>q.approvalId===p.approvalId)).toBe(false);
  const other=await app.inject({method:'GET',url:base+'/requests',headers:{cookie:`thaara_session=${f.member.token}; thaara_csrf=${csrf}`}});
  expect(other.json().requests).toEqual([]);
  expect((await app.inject({method:'GET',url:base+'/requests'})).statusCode).toBe(401);
 });

 it('cannot be enabled outside the test environment',async()=>{
  const provider=createPlivoCallProvider({liveCallingEnabled:true,credentials,fromNumber:'+919000000001',callbackOrigin:origin,fetch:plivo as unknown as typeof fetch});
  await expect(buildApp({db:f.db,config:loadConfig({NODE_ENV:'development',SESSION_SECRET:'s'.repeat(40),CSRF_SECRET:'c'.repeat(40)}),logger:new Logger('error'),phoneCalling:{durableContacts:true,durableCalls:true,liveCalling:{provider}}})).rejects.toThrow(/not approved/);
 });
});
