import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {inboundRuntimeConfig,INBOUND_HOSTED_GATE_CACHE_PATH} from '../../../scripts/phone-inbound-runtime-config.mjs';
import {inspectInboundUnpublishedFixture} from '../../../scripts/phone-inbound-runtime-guard.mjs';
import {withFreshPhoneFixtureSession} from '../../../scripts/phone-fixture-session.mjs';

// OFF unless a separately pinned, one-use fixture runner supplies the explicit plan and proof.
const enabled=process.env.THAARA_PHONE113_VALIDATION_PLAN==='hosted-gates';
const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|COMSPEC|PATHEXT|DOCKER_CONFIG)$/i.test(k)));
const docker=(endpoint:string,args:string[])=>execFileSync('docker',['--host',endpoint,...args],{env:safeEnv,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,windowsHide:true}).trim();
const config=enabled?inboundRuntimeConfig(process.env,readFileSync(INBOUND_HOSTED_GATE_CACHE_PATH+'/fixture.json'),(p:any)=>{inspectInboundUnpublishedFixture((args:string[])=>docker(p.dockerEndpoint,args),p);return true;},{validationPlan:'hosted-gates'}):null;
type Client={query:(sql:string,params?:unknown[])=>Promise<{rows:any[]}>};
const sql112=readFileSync(new URL('../../../docs/migrations/112h-phone-inbound-events.hosted-review.sql',import.meta.url),'utf8');
const sql113=readFileSync(new URL('../../../docs/migrations/113h-phone-inbound-principals.hosted-review.sql',import.meta.url),'utf8');
async function session(work:(client:Client)=>Promise<void>,database:'thaara_vps_pilot'|'postgres'='thaara_vps_pilot'){
 if(!config)throw Error('HOSTED_GATE_FIXTURE_NOT_APPROVED');
 const {Pool}=createRequire(new URL('../../../packages/db/package.json',import.meta.url))('pg');
 const url=new URL(config.admin);url.pathname='/'+database;
 await withFreshPhoneFixtureSession({verify:()=>{inspectInboundUnpublishedFixture((args:string[])=>docker(config.proof.dockerEndpoint,args),config.proof);},createPool:()=>new Pool({connectionString:url.href,max:1,connectionTimeoutMillis:5000,statement_timeout:30000,query_timeout:45000})},work);
}
async function approve(c:Client,step:112|113){await c.query(`SELECT set_config('thaara.step${step}_hosted_install_approved','owner-approved-inbound-hosted-install-v1',false)`);}
async function refuse(c:Client,sql:string){
 let code:unknown;try{await c.query(sql);}catch(e){code=(e as {code?:unknown}).code;}finally{await c.query('ROLLBACK');}
 expect(code).toBe('P0001');
}
async function snapshot(c:Client){
 const r=await c.query(`SELECT jsonb_build_object(
 'tables',(SELECT COALESCE(jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.relacl) ORDER BY c.relname),'[]') FROM pg_catalog.pg_class c WHERE c.relnamespace='public'::regnamespace),
 'policies',(SELECT COALESCE(jsonb_agg(jsonb_build_array(p.polname,p.polrelid,p.polroles,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polrelid,p.polname),'[]') FROM pg_catalog.pg_policy p WHERE p.polrelid IN(SELECT oid FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace)),
 'roles',(SELECT COALESCE(jsonb_agg(jsonb_build_array(rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,rolinherit) ORDER BY rolname),'[]') FROM pg_catalog.pg_roles WHERE rolname IN('thaara_app','thaara_worker','thaara_phone_ingest','thaara_phone_guard')),
 'functions',(SELECT COALESCE(jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,p.proowner,p.proacl) ORDER BY p.oid),'[]') FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace)
 ) AS value`);
 return createHash('sha256').update(JSON.stringify(r.rows[0].value)).digest('hex');
}
describe.skipIf(!config)('hosted install gates — nine separately approved isolated PostgreSQL cases',()=>{
 it('01 missing approval refuses112h without catalog changes',async()=>session(async c=>{
  const before=await snapshot(c);await refuse(c,sql112);expect(await snapshot(c)).toBe(before);
 }),30000);
 it('02 wrong database refuses112h before DDL even with approval',async()=>session(async c=>{
  const before=await snapshot(c);await approve(c,112);await refuse(c,sql112);expect(await snapshot(c)).toBe(before);
 },'postgres'),30000);
 it('03 substituted installer role refuses112h without catalog changes',async()=>session(async c=>{
  const before=await snapshot(c);await approve(c,112);await c.query('SET ROLE thaara_app');
  try{await refuse(c,sql112);}finally{await c.query('RESET ROLE');}expect(await snapshot(c)).toBe(before);
 }),30000);
 it('04 unsafe base role or disabled RLS refuses112h and preserves baseline after fixture restoration',async()=>session(async c=>{
  const before=await snapshot(c);await approve(c,112);
  await c.query('ALTER ROLE thaara_worker BYPASSRLS');try{await refuse(c,sql112);}finally{await c.query('ALTER ROLE thaara_worker NOBYPASSRLS');}
  await c.query('ALTER TABLE public.memberships NO FORCE ROW LEVEL SECURITY');try{await refuse(c,sql112);}finally{await c.query('ALTER TABLE public.memberships FORCE ROW LEVEL SECURITY');}
  expect(await snapshot(c)).toBe(before);
 }),30000);
 it('05 approved112h creates the expected protected journal on the fresh target',async()=>session(async c=>{
  await approve(c,112);await c.query(sql112);
  const r=await c.query("SELECT relrowsecurity AND relforcerowsecurity AS guarded FROM pg_catalog.pg_class WHERE oid='public.phone_inbound_call_events'::regclass");expect(r.rows).toEqual([{guarded:true}]);
  const fields=await c.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='phone_inbound_call_events' ORDER BY ordinal_position");
  expect(fields.rows.map(r=>r.column_name)).toEqual(['workspace_id','owner_user_id','call_id','kind','event_id','source_digest','sequence','report','created_at']);
 }),30000);
 it('06 duplicate112h refuses adoption without catalog changes',async()=>session(async c=>{
  const before=await snapshot(c);await approve(c,112);await refuse(c,sql112);expect(await snapshot(c)).toBe(before);
 }),30000);
 it('07 missing113h approval and conflicting fixture policy refuse installation',async()=>session(async c=>{
  const before=await snapshot(c);await refuse(c,sql113);expect(await snapshot(c)).toBe(before);
  await c.query('CREATE POLICY phone_principal_fixture_collision ON public.memberships USING(false)');
  try{const collision=await snapshot(c);await approve(c,113);await refuse(c,sql113);expect(await snapshot(c)).toBe(collision);}
  finally{await c.query('DROP POLICY phone_principal_fixture_collision ON public.memberships');}
  expect(await snapshot(c)).toBe(before);
 }),30000);
 it('08 approved113h installs NOLOGIN restricted identities and exact function ownership after112h',async()=>session(async c=>{
  await approve(c,113);await c.query(sql113);
  const roles=await c.query("SELECT rolname,NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit AS guarded FROM pg_catalog.pg_roles WHERE rolname IN('thaara_phone_guard','thaara_phone_ingest') ORDER BY rolname");
  expect(roles.rows).toEqual([{rolname:'thaara_phone_guard',guarded:true},{rolname:'thaara_phone_ingest',guarded:true}]);
  const r=await c.query(`SELECT
   (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class WHERE oid='public.phone_inbound_principals'::regclass) AS rls,
   NOT has_schema_privilege('thaara_phone_guard','public','CREATE') AS no_schema_create,
   NOT has_function_privilege('thaara_app','public.phone_inbound_append_event(jsonb)','EXECUTE') AS app_denied,
   has_function_privilege('thaara_phone_ingest','public.phone_inbound_append_event(jsonb)','EXECUTE') AS ingest_allowed,
   (SELECT count(*)=3 AND bool_and(p.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='thaara_phone_guard')) FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN('phone_inbound_resolve_grant','phone_inbound_scope_matches','phone_inbound_append_event')) AS owned`);
  expect(r.rows).toEqual([{rls:true,no_schema_create:true,app_denied:true,ingest_allowed:true,owned:true}]);
 }),30000);
 it('09 duplicate113h refuses adoption without catalog changes',async()=>session(async c=>{
  const before=await snapshot(c);await approve(c,113);await refuse(c,sql113);expect(await snapshot(c)).toBe(before);
 }),30000);
});
