import {describe,it,expect,afterAll,beforeAll} from 'vitest';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import Fastify from 'fastify';
import {PostgresDatabase,WorkspaceRepository,UserRepository,MembershipRepository,SessionRepository,generateSessionToken,hashSessionToken,type AuthenticatedScope} from '@thaara/db';
import {inboundRuntimeConfig,INBOUND_APPOINTMENT_CACHE_PATH,INBOUND_APPOINTMENT_V2_CACHE_PATH} from '../../../scripts/phone-inbound-runtime-config.mjs';
import {inspectInboundUnpublishedFixture} from '../../../scripts/phone-inbound-runtime-guard.mjs';
import {withFreshPhoneFixtureSession} from '../../../scripts/phone-fixture-session.mjs';
import {createInboundPrincipalTransactions} from '../src/services/phone-inbound-principal-postgres.js';
import {createInboundAppointments,buildAppointmentBinding} from '../src/services/phone-inbound-appointments.js';
import {phoneInboundAppointmentRoutes} from '../src/routes/phone-inbound-appointments.js';
import {PhoneInboundEventRepository} from '../src/services/phone-inbound-event-store.js';
import {assertAppointmentDenial} from '../../../scripts/phone-appointment-assertions.mjs';

// Default is inert: no proof/credential reads, Docker command, SQL, listening socket or provider call.
const v2=process.env.THAARA_PHONE113_VALIDATION_PLAN==='appointment-storage-v2';
const enabled=v2||process.env.THAARA_PHONE113_VALIDATION_PLAN==='appointment-storage';
const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|COMSPEC|PATHEXT|DOCKER_CONFIG)$/i.test(k)));
const inspect=(proof:any)=>inspectInboundUnpublishedFixture((args:string[])=>execFileSync('docker',['--host',proof.dockerEndpoint,...args],{env:safeEnv,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,windowsHide:true}).trim(),proof);
const config=enabled?inboundRuntimeConfig(process.env,readFileSync((v2?INBOUND_APPOINTMENT_V2_CACHE_PATH:INBOUND_APPOINTMENT_CACHE_PATH)+'/fixture.json'),(proof:any)=>{inspect(proof);return true;},{validationPlan:v2?'appointment-storage-v2':'appointment-storage'}):null;
const {Pool}=createRequire(new URL('../../../packages/db/package.json',import.meta.url))('pg');

describe.skipIf(!config)('appointment storage — nine explicitly approved isolated PostgreSQL cases',()=>{
 let adminPool:any,appPool:any,ingestA:any,ingestB:any,admin:PostgresDatabase,appDb:PostgresDatabase,owner:AuthenticatedScope,foreign:AuthenticatedScope,member:AuthenticatedScope;
 const apps:ReturnType<typeof Fastify>[]=[];
 const open=(url:string,name:string)=>new Pool({connectionString:url,max:2,application_name:name,connectionTimeoutMillis:5000,query_timeout:5000,statement_timeout:3000,idle_in_transaction_session_timeout:5000});
 async function identity(name:string,workspaceId?:string,role:'owner'|'member'='owner'){
  const ws=workspaceId?{id:workspaceId}:await new WorkspaceRepository(admin).create(name),user=await new UserRepository(admin).create(name+'@example.test','unused',name),token=generateSessionToken();
  const scope={workspaceId:ws.id,userId:user.id,role,sessionTokenHash:hashSessionToken(token)};
  await admin.withScopedTransaction(scope,async tx=>{await new MembershipRepository(tx).create(ws.id,user.id,role);await new SessionRepository(tx).create(user.id,ws.id,token);});return scope;
 }
 async function seed(suffix:string){
  const interactionId='20261104/appt-'+suffix,credential=randomBytes(32).toString('base64url');
  const profile={routeId:'appointment-'+suffix,workspaceId:owner.workspaceId,ownerUserId:owner.userId,principalId:randomUUID(),revision:1,appId:'synthetic-agent',appVersion:5,deploymentId:'synthetic-inbound',agentPhoneNumber:'+918000000001',maxCallLengthSeconds:300 as const};
  const binding=buildAppointmentBinding(profile,interactionId);
  await admin.query(`INSERT INTO public.phone_inbound_principals(principal_id,workspace_id,owner_user_id,route_id,token_hash,profile_fingerprint,revision,operations,expires_at) VALUES($1,$2,$3,$4,$5,$6,1,ARRAY['callback'],clock_timestamp()+interval '1 hour')`,[profile.principalId,owner.workspaceId,owner.userId,profile.routeId,createHash('sha256').update(credential).digest('hex'),binding.profileFingerprint]);
  const body={payload:{app_id:profile.appId,app_version:5,deployment_id:profile.deploymentId,agent_phone_number:profile.agentPhoneNumber,user_phone_number:'+919000000001',interaction_id:interactionId,start_datetime:'2026-11-04T00:00:00Z',end_datetime:null,duration:20,final_agent_variables:{customer_name:'Synthetic customer',business_type:'Retail',requested_service:'Automation'},interaction_transcript:[{role:'agent',en_text:'Would you like our team to contact you at +919000000001 and discuss a solution for your business?'},{role:'user',en_text:'Yes, please.'}]},slot:{startAt:'2090-11-05T09:00:00Z',endAt:'2090-11-05T09:30:00Z',timeZone:'Asia/Kolkata'}};
  return {profile,interactionId,credential,body,id:createHash('sha256').update(profile.routeId+'\n'+interactionId).digest('hex')};
 }
 async function endpoint(call:Awaited<ReturnType<typeof seed>>,pool:any,failAfterWrite=false){
  const real=createInboundPrincipalTransactions({pool});
  const transactions=failAfterWrite?{withGrant:async<T>(request:any,work:any):Promise<T>=>real.withGrant(request,async(grant,tx)=>{await work(grant,tx);throw Error('Synthetic pre-commit failure');})}:real;
  const forbiddenProvider=async()=>{throw Error('Provider access is forbidden in storage acceptance');};
  const service=createInboundAppointments({...call,transactions,db:appDb,resolveProposalOwnerSession:async()=>null,
   calendar:{writeReadiness:forbiddenProvider,findConflicts:forbiddenProvider,listEvents:forbiddenProvider,readEvent:forbiddenProvider}});
  const app=Fastify({logger:false});apps.push(app);await app.register(async v=>phoneInboundAppointmentRoutes(v,service),{prefix:'/api/v1'});
  return {app,post:(body:unknown=call.body,auth='Bearer '+call.credential)=>app.inject({method:'POST',url:'/api/v1/connectors/phone/inbound/appointment-requests/'+call.profile.routeId,headers:{authorization:auth},payload:body as any})};
 }
 const count=async(id:string)=>{
  const r=await admin.query(`SELECT (SELECT count(*)::int FROM public.phone_inbound_call_events WHERE call_id=$1) AS records,(SELECT count(*)::int FROM public.audit_events WHERE target_id=$1 AND action='phone.inbound.event_saved') AS audits`,[id]);return r.rows[0];
 };
 afterAll(async()=>{for(const app of apps)await app.close();for(const pool of [ingestA,ingestB,appPool,adminPool])if(pool)await pool.end();});

 async function initializeFixture(){
  const sql112=readFileSync(new URL('../../../docs/migrations/112h-phone-inbound-events.hosted-review.sql',import.meta.url));
  const sql113=readFileSync(new URL('../../../docs/migrations/113h-phone-inbound-principals.hosted-review.sql',import.meta.url));
  expect(createHash('sha256').update(sql112).digest('hex')).toBe('064ac927a1e059e25f2026a0251fa06e15e5849b4d35641d106273a641049a9f');
  expect(createHash('sha256').update(sql113).digest('hex')).toBe('688922f79a552699028ce7e1cd450128a5156d585b13803e478f6412a3aee275');
  await withFreshPhoneFixtureSession({verify:()=>{inspect(config!.proof);},createPool:()=>new Pool({connectionString:config!.admin,max:1,connectionTimeoutMillis:5000,statement_timeout:30000,query_timeout:45000})},async(c:any)=>{
   const row=(await c.query("SELECT current_database() AS db,current_user AS actor,current_setting('server_version_num')::int AS version,to_regclass('public.phone_inbound_call_events') AS journal,to_regclass('public.phone_inbound_principals') AS principal")).rows[0];
   expect(row.db==='thaara_vps_pilot'&&row.actor==='postgres'&&row.version>=160000&&row.version<170000&&row.journal===null&&row.principal===null).toBe(true);
   for(const [step,sql]of [[112,sql112],[113,sql113]] as const){await c.query(`SELECT set_config('thaara.step${step}_hosted_install_approved','owner-approved-inbound-hosted-install-v1',false)`);await c.query(sql.toString('utf8'));}
   const protectedTables=(await c.query("SELECT count(*)::int AS n FROM pg_class WHERE oid IN('public.phone_inbound_call_events'::regclass,'public.phone_inbound_principals'::regclass) AND relrowsecurity AND relforcerowsecurity")).rows[0];expect(protectedTables.n).toBe(2);
   const role=(await c.query("SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit AND NOT rolcanlogin AS restricted FROM pg_roles WHERE rolname='thaara_phone_ingest'")).rows[0];expect(role.restricted).toBe(true);
   // New disposable roles only: temporary fixture passwords, never argv/output, no privilege changes.
   for(const [name,url]of [['thaara_app',config!.app],['thaara_phone_ingest',config!.ingest]]){
    await c.query("SELECT set_config('phone.fixture_password',$1,false)",[new URL(url).password]);
    await c.query(`DO $$ BEGIN EXECUTE format('ALTER ROLE ${name} LOGIN PASSWORD %L',current_setting('phone.fixture_password')); END $$`);
   }
  });
  // Close schema session before Docker inspection; do not revive the old idle-connection failure.
  inspect(config!.proof);
  adminPool=open(config!.admin,'appointment-admin');appPool=open(config!.app,'appointment-owner');ingestA=open(config!.ingest,'appointment-ingest-a');ingestB=open(config!.ingest,'appointment-ingest-b');
  admin=new PostgresDatabase(adminPool);appDb=new PostgresDatabase(appPool);
  owner=await identity('appointment-owner');foreign=await identity('appointment-foreign');member=await identity('appointment-member',owner.workspaceId,'member');
 }
 beforeAll(async()=>{if(v2)await initializeFixture();},60000);
 it.skipIf(v2)('01 installs unchanged112h/113h only after owned-fixture verification and checks restricted roles/RLS',initializeFixture,60000);
 it.skipIf(v2)('02 persists the endpoint request and slot with one committed audit and owner readback',async()=>{
  const call=await seed('persist'),http=await endpoint(call,ingestA),r=await http.post();expect(r.statusCode).toBe(200);expect(r.json()).toMatchObject({saved:true,status:'request_saved',appointmentConfirmed:false,requestId:call.id});
  expect(await count(call.id)).toEqual({records:1,audits:1});const saved=await new PhoneInboundEventRepository(appDb).read(owner,call.id);
  expect(saved).toMatchObject({customerName:'Synthetic customer',business:'Retail',serviceNeeded:'Automation',outcome:'callback_requested',appointment:null});expect(saved!.preferredContactTime).toContain(call.body.slot.startAt);
 });
 it.skipIf(v2)('03 deduplicates concurrent endpoint deliveries over separate backends and rejects conflicting repeats',async()=>{
  expect((await ingestA.query('SELECT pg_backend_pid() AS id')).rows[0].id).not.toBe((await ingestB.query('SELECT pg_backend_pid() AS id')).rows[0].id);
  const call=await seed('parallel'),a=await endpoint(call,ingestA),b=await endpoint(call,ingestB),responses=await Promise.all([a.post(),b.post()]);for(const r of responses)expect(r.json()).toMatchObject({saved:true,requestId:call.id});
  expect(await count(call.id)).toEqual({records:1,audits:1});expect((await a.post({...call.body,payload:{...call.body.payload,duration:21}})).statusCode).not.toBe(200);expect(await count(call.id)).toEqual({records:1,audits:1});
 });
 it.skipIf(v2)('04 rolls back journal insertion on synthetic audit failure; deliberate repaired-fixture resubmission saves once',async()=>{
  const call=await seed('audit-fail'),http=await endpoint(call,ingestA);
  await admin.query(`CREATE FUNCTION public.appointment_fixture_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='phone.inbound.event_saved' AND NEW.target_id='${call.id}' THEN RAISE EXCEPTION 'synthetic audit rejection'; END IF; RETURN NEW; END $$; CREATE TRIGGER appointment_fixture_audit BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.appointment_fixture_audit_fail();`);
  const failed=await http.post();expect(failed.statusCode).toBe(503);expect(failed.json().saved).toBe(false);expect(await count(call.id)).toEqual({records:0,audits:0});
  // Drop only the exact trigger/function created immediately above in this new owned fixture.
  await admin.query('DROP TRIGGER appointment_fixture_audit ON public.audit_events; DROP FUNCTION public.appointment_fixture_audit_fail();');
  expect((await http.post()).json().saved).toBe(true);expect(await count(call.id)).toEqual({records:1,audits:1});
 });
 it('05 rejects bad credentials, call mismatch, revoked and expired dedicated identities without writes',async()=>{
  const call=await seed('auth'),http=await endpoint(call,ingestA);
  assertAppointmentDenial(await http.post(call.body,'Bearer invalid'),'wrong_credentials');
  assertAppointmentDenial(await http.post({...call.body,payload:{...call.body.payload,interaction_id:'20261104/another-call'}}),'call_binding');
  await admin.query('UPDATE public.phone_inbound_principals SET revoked_at=clock_timestamp() WHERE principal_id=$1',[call.profile.principalId]);assertAppointmentDenial(await http.post(),'revoked_identity');
  await admin.query("UPDATE public.phone_inbound_principals SET revoked_at=NULL,expires_at=created_at+interval '1 millisecond' WHERE principal_id=$1",[call.profile.principalId]);assertAppointmentDenial(await http.post(),'expired_identity');expect(await count(call.id)).toEqual({records:0,audits:0});
 });
 it('06 enforces tenant/owner reads and denies direct ingest reads or guard escalation',async()=>{
  const call=await seed('scope'),http=await endpoint(call,ingestA);expect((await http.post()).json().saved).toBe(true);
  const repo=new PhoneInboundEventRepository(appDb);expect(await repo.read(foreign,call.id)).toBeNull();await expect(repo.read(member,call.id)).rejects.toThrow();
  for(const sql of ['SELECT * FROM public.phone_inbound_call_events','SELECT * FROM public.phone_inbound_principals','SELECT * FROM public.sessions','SET ROLE thaara_phone_guard'])await expect(ingestA.query(sql)).rejects.toThrow();
 });
 it('07 persists after endpoint and ingest pool recreation without a second record or audit',async()=>{
  const call=await seed('reconnect'),http=await endpoint(call,ingestA);expect((await http.post()).json().saved).toBe(true);await http.app.close();await ingestA.end();
  ingestA=open(config!.ingest,'appointment-ingest-reconnected');const recreated=await endpoint(call,ingestA);expect((await recreated.post()).json()).toMatchObject({saved:true,requestId:call.id});expect(await count(call.id)).toEqual({records:1,audits:1});
 });
 it('08 rolls back a real transaction after an injected pre-commit failure and recovers on explicit next submission',async()=>{
  const call=await seed('precommit'),failing=await endpoint(call,ingestA,true);expect((await failing.post()).json().saved).toBe(false);expect(await count(call.id)).toEqual({records:0,audits:0});
  const normal=await endpoint(call,ingestB);expect((await normal.post()).json().saved).toBe(true);expect(await count(call.id)).toEqual({records:1,audits:1});
 });
 it('09 rejects a demoted owner and missing caller consent without creating a request',async()=>{
  const call=await seed('owner-demotion'),http=await endpoint(call,ingestA);
  expect((await http.post({...call.body,payload:{...call.body.payload,interaction_transcript:[]}})).json().saved).toBe(false);
  await admin.query("UPDATE public.memberships SET role='member' WHERE workspace_id=$1 AND user_id=$2",[owner.workspaceId,owner.userId]);expect((await http.post()).json().saved).toBe(false);expect(await count(call.id)).toEqual({records:0,audits:0});
 });
});
