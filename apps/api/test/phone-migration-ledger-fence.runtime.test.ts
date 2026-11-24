import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {inboundRuntimeConfig,INBOUND_LEDGER_WRITE_FENCE_CACHE_PATH as cache,INBOUND_LEDGER_WRITE_FENCE_MANIFEST_PATH as manifestPath} from '../../../scripts/phone-inbound-runtime-config.mjs';
import {inspectInboundUnpublishedFixture} from '../../../scripts/phone-inbound-runtime-guard.mjs';
import {withFreshPhoneFixtureSession} from '../../../scripts/phone-fixture-session.mjs';
const enabled=process.env.THAARA_PHONE113_VALIDATION_PLAN==='ledger-write-fence';
const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|COMSPEC|PATHEXT|DOCKER_CONFIG)$/i.test(k)));
const docker=(endpoint:string,args:string[])=>execFileSync('docker',['--host',endpoint,...args],{env:safeEnv,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,windowsHide:true}).trim();
const config=enabled?inboundRuntimeConfig(process.env,fs.readFileSync(cache+'/fixture.json'),(p:any)=>{inspectInboundUnpublishedFixture((a:string[])=>docker(p.dockerEndpoint,a),p);return true;},{validationPlan:'ledger-write-fence'}):null;
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const candidate='docs/migrations/phone-schema-migrations-write-fence.review.sql';
type Client={query:(sql:string,params?:unknown[])=>Promise<{rows:any[]}>};
function inputs(){
 const bytes=fs.readFileSync(manifestPath);expect(sha(bytes)).toBe(process.env.THAARA_PHONE_LEDGER_MANIFEST_SHA256);
 const manifest=JSON.parse(bytes.toString());expect(manifest.plan).toBe('ledger-write-fence');const sources=new Map<string,string>();
 for(const [path,hash]of Object.entries(manifest.files)){const value=fs.readFileSync(path);expect(sha(value)).toBe(hash);sources.set(path,value.toString('utf8'));}return sources;
}
async function session(number:number,work:(c:Client)=>Promise<void>){
 if(!config)throw Error('LEDGER_FIXTURE_NOT_APPROVED');
 try{
  const {Pool}=createRequire(new URL('../../../packages/db/package.json',import.meta.url))('pg');
  await withFreshPhoneFixtureSession({verify:()=>{inputs();inspectInboundUnpublishedFixture((a:string[])=>docker(config.proof.dockerEndpoint,a),config.proof);},createPool:()=>new Pool({connectionString:config.admin,max:1,connectionTimeoutMillis:5000,statement_timeout:30000,query_timeout:45000})},work);
 }catch(error){
  const code=(error as {code?:unknown})?.code;
  try{fs.writeFileSync(cache+'/failure.json',JSON.stringify({caseNumber:number,sqlState:typeof code==='string'&&/^[0-9A-Z]{5}$/.test(code)?code:null,category:'ledger_validation_failed'}),{flag:'wx',mode:0o600});}catch{/* Preserve the first diagnostic. */}
  throw Error('LEDGER_VALIDATION_CASE_'+number+'_FAILED');
 }
}
async function refuse(c:Client,sql:string,expected:string){let code;try{await c.query(sql);}catch(e){code=(e as {code?:unknown}).code;}finally{await c.query('ROLLBACK');}expect(code).toBe(expected);}
async function approve(c:Client){await c.query("SELECT set_config('thaara.phone_ledger_write_fence_approved','separately-reviewed-ledger-write-fence-v1',false)");}
async function snapshot(c:Client){const r=await c.query("SELECT jsonb_build_object('owner',relowner,'acl',relacl,'memberships',(SELECT COALESCE(jsonb_agg(jsonb_build_array(roleid,member,grantor,admin_option,inherit_option,set_option) ORDER BY roleid,member,grantor),'[]'::jsonb) FROM pg_catalog.pg_auth_members),'rows',(SELECT count(*) FROM public.schema_migrations)) AS value FROM pg_catalog.pg_class WHERE oid='public.schema_migrations'::regclass");return sha(JSON.stringify(r.rows[0].value));}
describe.skipIf(!config)('ledger write fence — four approved disposable PostgreSQL cases only',()=>{
 it('01 confirms original application mutation grants and fixture baseline without retaining test rows',async()=>session(1,async c=>{
  const row=(await c.query("SELECT current_database() AS db,current_user AS actor,(SELECT count(*)::int FROM public.schema_migrations) AS rows,has_table_privilege('thaara_app','public.schema_migrations','INSERT') AS can_insert,has_table_privilege('thaara_app','public.schema_migrations','UPDATE') AS can_update,has_table_privilege('thaara_app','public.schema_migrations','DELETE') AS can_delete")).rows[0];
  expect(row).toEqual({db:'thaara_vps_pilot',actor:'postgres',rows:12,can_insert:true,can_update:true,can_delete:true});
 }));
 it('02 refuses missing approval and wrong effective operator without privilege changes',async()=>session(2,async c=>{
  const sql=inputs().get(candidate)!,before=await snapshot(c);await refuse(c,sql,'P0001');expect(await snapshot(c)).toBe(before);
  await approve(c);await c.query('SET ROLE thaara_app');try{await refuse(c,sql,'P0001');}finally{await c.query('RESET ROLE');}expect(await snapshot(c)).toBe(before);
 }));
 it('03 applies only the permission correction, denies app mutations and preserves SELECT/operator migration writes',async()=>session(3,async c=>{
  const sql=inputs().get(candidate)!;await approve(c);await c.query(sql);
  const rights=(await c.query("SELECT r.role_name,p.privilege,has_table_privilege(r.role_name,'public.schema_migrations',p.privilege) AS allowed FROM (VALUES('thaara_app'),('thaara_worker')) r(role_name) CROSS JOIN (VALUES('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege)")).rows;expect(rights).toHaveLength(12);expect(rights.every(r=>r.allowed===false)).toBe(true);
  await c.query('BEGIN; SET LOCAL ROLE thaara_app');expect((await c.query('SELECT count(*)::int AS count FROM public.schema_migrations')).rows[0].count).toBe(12);await c.query('ROLLBACK');
  for(const mutation of ["INSERT INTO public.schema_migrations(version,name,checksum) VALUES('phone-ledger-probe','synthetic','synthetic')","UPDATE public.schema_migrations SET checksum='synthetic' WHERE false",'DELETE FROM public.schema_migrations WHERE false']){await c.query('BEGIN; SET LOCAL ROLE thaara_app');await refuse(c,mutation,'42501');}
  await c.query("BEGIN; INSERT INTO public.schema_migrations(version,name,checksum) VALUES('phone-ledger-probe','synthetic','synthetic'); ROLLBACK;");expect((await c.query('SELECT count(*)::int AS count FROM public.schema_migrations')).rows[0].count).toBe(12);
 }));
 it('04 rejects SET-only residual authority and rolls back the attempted application revocation atomically',async()=>session(4,async c=>{
  await c.query('CREATE ROLE phone_ledger_fixture_writer NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION');
  await c.query('GRANT UPDATE ON public.schema_migrations TO phone_ledger_fixture_writer, thaara_app');
  await c.query('GRANT phone_ledger_fixture_writer TO thaara_app WITH INHERIT FALSE, SET TRUE');
  const paths=(await c.query("SELECT pg_has_role('thaara_app','phone_ledger_fixture_writer','SET') AS can_set,pg_has_role('thaara_app','phone_ledger_fixture_writer','USAGE') AS can_inherit")).rows[0];expect(paths).toEqual({can_set:true,can_inherit:false});
  const sql=inputs().get(candidate)!,before=await snapshot(c);await approve(c);await refuse(c,sql,'P0001');expect(await snapshot(c)).toBe(before);
  expect((await c.query("SELECT has_table_privilege('thaara_app','public.schema_migrations','UPDATE') AS allowed")).rows[0].allowed).toBe(true);
 }));
});
