import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import {afterAll,beforeAll,describe,it,expect,vi} from 'vitest';
import {PostgresDatabase,WorkspaceRepository,UserRepository,MembershipRepository,SessionRepository,PhoneContactRepository,generateSessionToken,hashSessionToken,type AuthenticatedScope} from '@thaara/db';
import {loadConfig} from '@thaara/config';
import {Logger} from '@thaara/observability';
import {phoneRuntimeConfig} from '../../../scripts/phone-runtime-guard.mjs';
import {buildApp} from '../src/app.js';
import {generateCsrfToken} from '../src/crypto/csrf.js';
import {createSarvamCallProvider,sarvamWebhookToken} from '../src/services/phone-sarvam-calls.js';

// Deliberately excluded from normal verification. No API/provider credentials are accepted by the isolation guard.
const config=phoneRuntimeConfig(process.env);
const {Pool}=createRequire(new URL('../../../packages/db/package.json',import.meta.url))('pg');
const api='/api/v1/connectors/phone/ai',csrf=generateCsrfToken(),secret='synthetic-phone-runtime-webhook-secret-0123456789';
type Identity=AuthenticatedScope&{token:string};
describe('Step 110 isolated PostgreSQL acceptance — fake Sarvam only',()=>{
 let admin:PostgresDatabase,first:PostgresDatabase,second:PostgresDatabase;
 const apps:Awaited<ReturnType<typeof buildApp>>[]=[];
 const open=(url:string,max=1)=>new PostgresDatabase(new Pool({connectionString:url,max,connectionTimeoutMillis:5000}));
 beforeAll(async()=>{
  admin=open(config.admin);first=open(config.app);second=open(config.app);
  const target=(await admin.query("SELECT current_database() AS db,current_setting('server_version_num')::int AS version")).rows[0];
  expect(target.db).toBe('thaara_phone110_test');expect(target.version).toBeGreaterThanOrEqual(160000);expect(target.version).toBeLessThan(170000);
 });
 afterAll(async()=>{for(const a of apps)await a.close();await first?.close();await second?.close();await admin?.close();});
 async function identity(workspaceId?:string):Promise<Identity>{
  const workspace=workspaceId??(await new WorkspaceRepository(admin).create('Synthetic phone110 '+randomUUID())).id;
  const u=await new UserRepository(admin).create(randomUUID()+'@phone110.test','unused','Synthetic owner'),token=generateSessionToken();
  const scope={workspaceId:workspace,userId:u.id,role:'owner' as const,sessionTokenHash:hashSessionToken(token)};
  await admin.withScopedTransaction(scope,async tx=>{await new MembershipRepository(tx).create(workspace,u.id,'owner');await new SessionRepository(tx).create(u.id,workspace,token);});
  return {...scope,token};
 }
 const headers=(s:Identity)=>({cookie:`thaara_session=${s.token}; thaara_csrf=${csrf}`,'x-csrf-token':csrf});
 async function fixture(){
  const owner=await identity(),peer=await identity(owner.workspaceId),foreign=await identity();let attempts=0;
  await new PhoneContactRepository(admin).create(owner,'ram',{displayName:'Ram',aliases:[],phoneE164:'+919000000002',consent:{callingAllowed:true,reference:'synthetic-consent',source:'recipient_verbal',recordedAt:new Date(Date.now()-10000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()}});
  const fetch=vi.fn(async()=>new Response(JSON.stringify({attempt_id:'attempt_runtime_'+(++attempts)})));
  const make=async(db:PostgresDatabase)=>{
   const app=await buildApp({db,config:loadConfig({NODE_ENV:'test'}),logger:new Logger('error'),phoneCalling:{durableContacts:true,durableCalls:true,liveCalling:{dailyCallLimit:1,
    provider:createSarvamCallProvider({liveCallingEnabled:true,orgId:'synthetic_org',workspaceId:'synthetic_ws',appId:'synthetic_agent',appVersion:2,connectionId:'synthetic_connection',enforcedMaxDurationSeconds:300,
     agentPhoneNumber:'+918000000001',callbackOrigin:'https://phone.example.test',secrets:{resolve:async()=>({apiKey:'synthetic-no-network-key',webhookSecret:secret})},fetch:fetch as unknown as typeof globalThis.fetch}),sarvamWebhook:{webhookSecret:async()=>secret}}}});
   await app.ready();apps.push(app);return app;
  };
  const a=await make(first),b=await make(second);
  const prepare=async(purpose='Ask about the synthetic project.')=>{
   const r=await a.inject({method:'POST',url:api+'/drafts',headers:headers(owner),payload:{contactQuery:'Ram',purpose,language:'en-IN'}});
   expect(r.statusCode,r.body).toBe(200);expect(r.json().draft.maxDurationSeconds).toBe(300);return r.json().approvalId as string;
  };
  const confirm=(id:string,app=a)=>app.inject({method:'POST',url:api+'/calls/confirm',headers:headers(owner),payload:{approvalId:id}});
  return {owner,peer,foreign,a,b,fetch,prepare,confirm};
 }
 it('uses a restricted role and forced RLS on all three phone tables',async()=>{
  const role=(await first.query('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  expect(role).toMatchObject({current_user:'thaara_app',rolsuper:false,rolbypassrls:false});
  const rows=(await admin.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('public.phone_contacts'::regclass,'public.phone_calls'::regclass,'public.phone_call_events'::regclass)")).rows;
  expect(rows).toHaveLength(3);for(const r of rows)expect(r).toEqual({relrowsecurity:true,relforcerowsecurity:true});
 });
 it('isolates contacts and calls from same-workspace peers and foreign workspaces',async()=>{
  const f=await fixture();
  const placed=await f.confirm(await f.prepare());expect(placed.statusCode).toBe(200);const callId=placed.json().id;
  const owned=(await f.a.inject({method:'GET',url:api+'/calls',headers:headers(f.owner)})).json().calls;
  expect(owned.some((c:{id:string})=>c.id===callId)).toBe(true);
  expect((await f.a.inject({method:'GET',url:api+'/contacts',headers:headers(f.owner)})).json().contacts).toHaveLength(1);
  for(const s of [f.peer,f.foreign]){
   expect((await f.a.inject({method:'GET',url:api+'/contacts',headers:headers(s)})).json().contacts).toHaveLength(0);
   const rows=await first.withScopedTransaction(s,tx=>tx.query('SELECT call_id FROM public.phone_calls'));
   expect(rows.rows).toHaveLength(0);
   expect((await f.a.inject({method:'GET',url:api+'/calls',headers:headers(s)})).json().calls).toHaveLength(0);
   expect((await f.a.inject({method:'POST',url:api+`/calls/${callId}/result`,headers:headers(s)})).statusCode).toBe(403);
  }
 });
 it('fences two independent services competing for the last daily slot and never redials a replay',async()=>{
  const f=await fixture(),one=await f.prepare('First question'),two=await f.prepare('Second question');
  const results=await Promise.all([f.confirm(one,f.a),f.confirm(two,f.b)]);
  expect(results.map(r=>r.statusCode).sort()).toEqual([200,429]);expect(f.fetch).toHaveBeenCalledTimes(1);
  const won=results.find(r=>r.statusCode===200)!.json();
  expect((await f.confirm(won.approvalId,f.b)).json().id).toBe(won.id);expect(f.fetch).toHaveBeenCalledTimes(1);
 });
 it('persists across fresh connection pools and restores a slot only after the rolling window',async()=>{
  const f=await fixture(),id=await f.prepare(),placed=await f.confirm(id);expect(placed.statusCode).toBe(200);
  const restarted=open(config.app);
  try{
   const rows=await restarted.withScopedTransaction(f.owner,tx=>tx.query('SELECT call_id FROM public.phone_calls WHERE approval_id=$1',[id]));
   expect(rows.rows[0].call_id).toBe(placed.json().id);
  }finally{await restarted.close();}
  const next=await f.prepare('Another question');expect((await f.confirm(next)).statusCode).toBe(429);
  // Synthetic clock fixture only, in the dedicated disposable database. Never a runtime limit-reset mechanism.
  await admin.withScopedTransaction(f.owner,async tx=>{await tx.query('SET LOCAL session_replication_role=replica');await tx.query("UPDATE public.phone_calls SET created_at=clock_timestamp()-interval '25 hours' WHERE call_id=$1",[placed.json().id]);});
  expect((await f.confirm(next)).statusCode).toBe(200);expect(f.fetch).toHaveBeenCalledTimes(2);
 });
 it('rechecks archived contacts before approval and never dispatches',async()=>{
  const f=await fixture(),id=await f.prepare();
  expect((await f.a.inject({method:'POST',url:api+'/contacts/ram/archive',headers:headers(f.owner),payload:{expectedRevision:1}})).statusCode).toBe(200);
  expect((await f.confirm(id)).statusCode).toBe(403);expect(f.fetch).not.toHaveBeenCalled();
 });
 it('rolls back a claim when its audit insert fails, with zero provider requests',async()=>{
  const f=await fixture(),id=await f.prepare();
  await admin.exec("CREATE FUNCTION public.phone110_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='phone.ai.call_claimed' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER phone110_test_audit_failure BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.phone110_test_audit_failure();");
  try{expect((await f.confirm(id)).statusCode).toBeGreaterThanOrEqual(400);expect(f.fetch).not.toHaveBeenCalled();}
  finally{await admin.exec('DROP TRIGGER phone110_test_audit_failure ON public.audit_events; DROP FUNCTION public.phone110_test_audit_failure();');}
  expect((await admin.query('SELECT count(*)::int AS n FROM public.phone_calls WHERE workspace_id=$1',[f.owner.workspaceId])).rows[0].n).toBe(0);
 });
 it('correlates date/slash provider callbacks and preserves unverified recipient evidence',async()=>{
  const f=await fixture(),id=await f.prepare(),r=await f.confirm(id);expect(r.statusCode).toBe(200);const call=r.json();
  const attempt=(await admin.query('SELECT provider_request_id FROM public.phone_calls WHERE call_id=$1',[call.id])).rows[0].provider_request_id;
  const url=`/api/v1/connectors/phone/sarvam/calls/${call.id}/${sarvamWebhookToken(secret,call.id)}`;
  const payload={attempt_id:attempt,status:'connected',interaction_id:'20261030/'+randomUUID(),duration:23,webhook_config:{metadata:{thaara_call_id:call.id}},interaction_transcript:[{role:'agent',en_text:'Hello'},{role:'user',en_text:'Five minutes is fine.'}]};
  expect((await f.a.inject({method:'POST',url,payload:{...payload,attempt_id:'foreign_attempt'}})).statusCode).toBe(403);
  expect((await f.a.inject({method:'POST',url,payload})).statusCode).toBe(200);expect((await f.a.inject({method:'POST',url,payload})).statusCode).toBe(200);
  const done=(await f.a.inject({method:'GET',url:api+'/calls',headers:headers(f.owner)})).json().calls.find((c:{id:string})=>c.id===call.id);
  expect(done).toMatchObject({state:'completed',verified:false,providerCallId:payload.interaction_id,report:{quotedResponses:['Five minutes is fine.'],verified:false}});
  expect(f.fetch).toHaveBeenCalledTimes(1);
 });
 it('refuses migration execution without its explicit review acknowledgement',async()=>{
  const sql=fs.readFileSync(new URL('../../../docs/migrations/110c-phone-live-mode.review.sql',import.meta.url),'utf8');
  try{await expect(admin.exec(sql)).rejects.toThrow(/explicit approval/);}finally{await admin.query('ROLLBACK');}
  expect((await admin.query("SELECT to_regclass('public.phone_calls') AS table_name")).rows[0].table_name).toBe('phone_calls');
 });
});
