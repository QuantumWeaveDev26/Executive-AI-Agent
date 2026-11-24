// Builds the one-time psql bundle for the fresh thaara_vps_pilot database.
// Contains no secret values: the thaara_app password is read inside the pilot
// PostgreSQL container from /run/secrets/api_password. Never retargets 1083/1085.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const PILOT_DATABASE='thaara_vps_pilot';
export const BASE_SCHEMA_SHA='29498d7da36994347371a77f0e93467c7898db6c01b0223db6916499fb2d59a2';
export const WHATSAPP_BASE_SHA='4ad4e53f5d1c30b6a2806728359b79ab47695399c79db354bcac1d479d18228e';
export const CALLBACK_REVIEW_SHA='0bee4ba36c23ec620bae3074efe637c6ee8355cf0de4ad5df78135525ed1c774';
export const PILOT_CALLBACK_SHA='6e2ce3c528b9daa1474a123a8842e0f9f4ad8b6043aae1171102b767cfbe7599';
const BODY_MARKER='\nCREATE TABLE public.whatsapp_n8n_relay_principals';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const deny=m=>{throw Error('Pilot DB bundle denied: '+m);};
export const callbackBody=sql=>{const i=sql.indexOf(BODY_MARKER);if(i<0)deny('callback body marker missing');return sql.slice(i);};
// Same checksum rule as packages/db Migrator.computeChecksum, so a later migrator run skips these.
const migratorChecksum=sql=>crypto.createHash('sha256').update(sql.trim()).digest('hex');
const literal=s=>"'"+s.replaceAll("'","''")+"'";

export function buildPilotDbBundle(root){
  const read=p=>fs.readFileSync(path.join(root,p),'utf8');
  const dir=path.join(root,'packages/db/src/migrations');
  const names=fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort();
  const migrations=names.map(name=>({name,version:name.split('_')[0]||name,sql:fs.readFileSync(path.join(dir,name),'utf8')}));
  const manifest=migrations.map(m=>[m.name,sha(m.sql)]);
  if(manifest.length!==12||sha(JSON.stringify(manifest))!==BASE_SCHEMA_SHA)deny('base schema manifest mismatch');
  const base=read('docs/migrations/1083-whatsapp-durable.review.sql');
  const review=read('docs/migrations/1085-whatsapp-callback-principal.review.sql');
  const pilot=read('docs/migrations/1089-pilot-callback-principal.review.sql');
  if(sha(base)!==WHATSAPP_BASE_SHA)deny('1083 checksum mismatch');
  if(sha(review)!==CALLBACK_REVIEW_SHA)deny('1085 checksum mismatch');
  if(sha(pilot)!==PILOT_CALLBACK_SHA)deny('1089 checksum mismatch');
  if(callbackBody(pilot)!==callbackBody(review))deny('1089 body differs from reviewed 1085');
  const parts=[
`-- THAARA V2 private VPS pilot: one-time fresh install for ${PILOT_DATABASE}. Synthetic/test data only.
-- Run only with: psql -X -q -v ON_ERROR_STOP=1 -o /dev/null -U postgres -d ${PILOT_DATABASE}
\\set ON_ERROR_STOP on
DO $pilot$ BEGIN
  IF current_database() <> '${PILOT_DATABASE}' OR current_user <> 'postgres'
    OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('thaara_app','thaara_admin','thaara_worker','thaara_whatsapp_audit_guard')) THEN
    RAISE EXCEPTION 'Pilot install requires the exact fresh pilot database; never overwrite or adopt';
  END IF;
END $pilot$;
CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );`];
  for(const m of migrations)parts.push(`BEGIN;\n${m.sql}\n;\nINSERT INTO schema_migrations (version, name, checksum) VALUES (${literal(m.version)}, ${literal(m.name)}, ${literal(migratorChecksum(m.sql))});\nCOMMIT;`);
  parts.push(
`\\set pilot_app_password \`cat /run/secrets/api_password\`
SELECT set_config('thaara.pilot_app_password', :'pilot_app_password', false);
\\unset pilot_app_password
DO $pilot$ BEGIN
  IF current_setting('thaara.pilot_app_password') !~ '^[A-Za-z0-9_-]+$'
    OR length(current_setting('thaara.pilot_app_password')) NOT BETWEEN 32 AND 256 THEN
    RAISE EXCEPTION 'Pilot application credential is missing or invalid';
  END IF;
  EXECUTE format('ALTER ROLE thaara_app LOGIN PASSWORD %L', current_setting('thaara.pilot_app_password'));
  PERFORM set_config('thaara.pilot_app_password', '', false);
END $pilot$;
SELECT set_config('thaara.step1083_review_approved','yes',false), set_config('thaara.step1083_target_database',current_database(),false);`,
    base,
`SELECT set_config('thaara.step1083_review_approved','',false), set_config('thaara.step1083_target_database','',false);
SELECT set_config('thaara.step1089_pilot_approved','yes',false), set_config('thaara.step1089_base_sha',${literal(WHATSAPP_BASE_SHA)},false);`,
    pilot,
`SELECT set_config('thaara.step1089_pilot_approved','',false), set_config('thaara.step1089_base_sha','',false);
DO $pilot$ BEGIN
  IF (SELECT count(*) FROM schema_migrations) <> ${migrations.length}
    OR to_regclass('public.whatsapp_n8n_relay_principals') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='thaara_app' AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication)
    OR pg_has_role('thaara_app','thaara_admin','MEMBER') OR pg_has_role('thaara_app','thaara_worker','MEMBER')
    OR pg_has_role('thaara_app','thaara_whatsapp_audit_guard','MEMBER') THEN
    RAISE EXCEPTION 'Pilot install postcondition failed';
  END IF;
END $pilot$;`);
  const sql=parts.join('\n')+'\n';
  return {sql,sha256:sha(sql),migrations:migrations.map(m=>({version:m.version,name:m.name,checksum:migratorChecksum(m.sql)}))};
}
