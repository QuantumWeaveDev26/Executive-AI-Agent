// Local-only acceptance for the pilot DB bundle. Owner-approved local test (27 Oct 2026).
// Creates two throwaway tmpfs PostgreSQL containers on an internal network with no host ports,
// removes them afterwards, and never touches existing containers, volumes or the VPS.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPilotDbBundle } from '../deploy/hostinger-pilot/pilot-db-bundle.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const image='postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea';
const run=crypto.randomBytes(4).toString('hex');
const net=`thaara-step1089-${run}`,pilotName=`thaara-step1089-pilot-${run}`,refName=`thaara-step1089-ref-${run}`;
const docker=(args,opts={})=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:60000,...opts}).trim();
const psql=(container,db,input,extra=[],env)=>spawnSync('docker',['exec','-i',...(env?['-e','PGPASSWORD']:[]),container,'psql','-X','-q','-v','ON_ERROR_STOP=1',...extra,'-d',db],{input,encoding:'utf8',env:env?{...process.env,...env}:process.env,timeout:120000});
const secret=()=>crypto.randomBytes(32).toString('base64url');
const results=[];const check=(name,ok,detail='')=>{results.push({name,ok:!!ok,detail});if(!ok)throw Error('FAILED: '+name+(detail?' — '+detail:''));};
if(process.argv[2]!=='--approved')throw Error('Local approval flag required');
const secrets=fs.mkdtempSync(path.join(os.tmpdir(),'thaara-step1089-secrets-'));
const created=[];
try{
  const adminPassword=secret(),appPassword=secret();
  fs.writeFileSync(path.join(secrets,'api_password'),appPassword+'\n');
  docker(['network','create','--internal','--label','thaara.step=1089',net]);created.push(['network',net]);
  const start=(name,db)=>{docker(['run','-d','--name',name,'--label','thaara.step=1089','--network',net,'--read-only',
    '--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=536870912','--tmpfs','/var/run/postgresql:rw,noexec,nosuid,size=16777216','--tmpfs','/tmp:rw,noexec,nosuid,size=33554432',
    '--memory','384m','--cpus','0.5','--shm-size','64m','-v',`${secrets}:/run/secrets:ro`,'-e','POSTGRES_PASSWORD','-e','POSTGRES_DB',image],{env:{...process.env,POSTGRES_PASSWORD:adminPassword,POSTGRES_DB:db}});created.push(['container',name]);};
  start(pilotName,'thaara_vps_pilot');start(refName,'thaara_step1085_test');
  const ready=async name=>{for(let i=0;i<150;i++){const r=spawnSync('docker',['exec',name,'psql','-X','-U','postgres','-d','postgres','-tAc','SELECT 1'],{encoding:'utf8'});if(r.status===0&&r.stdout.trim()==='1')return;await new Promise(r=>setTimeout(r,400));}throw Error('not ready '+name);};
  await ready(pilotName);await ready(refName);
  // The official image restarts once after init; wait for the final server.
  await new Promise(r=>setTimeout(r,2500));await ready(pilotName);await ready(refName);
  const bundle=buildPilotDbBundle(root);
  const quiet=['-o','/dev/null','-U','postgres'];

  // 1. Wrong database is refused before any change.
  docker(['exec',pilotName,'psql','-X','-q','-U','postgres','-d','postgres','-c','CREATE DATABASE thaara_wrong_target']);
  let r=psql(pilotName,'thaara_wrong_target',bundle.sql,quiet);
  check('wrong database refused',r.status!==0&&/exact fresh pilot database/.test(r.stderr));
  check('wrong database left unchanged',docker(['exec',pilotName,'psql','-X','-U','postgres','-d','thaara_wrong_target','-tAc',"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'"])==='0');

  // 2. Fresh pilot install succeeds without printing anything.
  r=psql(pilotName,'thaara_vps_pilot',bundle.sql,quiet);
  check('pilot install succeeded',r.status===0,r.stderr.split('\n').filter(l=>/ERROR/.test(l)).slice(0,2).join(' | '));
  check('install output contains no secret',!r.stdout.includes(appPassword)&&!r.stderr.includes(appPassword));

  // 3. Re-running is refused (never overwrite or adopt).
  r=psql(pilotName,'thaara_vps_pilot',bundle.sql,quiet);
  check('re-run refused',r.status!==0&&/exact fresh pilot database/.test(r.stderr));

  // 4. From another container (as the API connects), the exact pilot-start admission passes with password auth.
  const admission=`SELECT current_database() AS db,current_user AS actor,
   (SELECT count(*)::int FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication) AS restricted,
   pg_has_role(current_user,'thaara_admin','MEMBER') OR pg_has_role(current_user,'thaara_worker','MEMBER') OR pg_has_role(current_user,'thaara_whatsapp_audit_guard','MEMBER') AS elevated,
   to_regclass('public.whatsapp_n8n_relay_principals') IS NOT NULL AS schema_ready`;
  r=psql(refName,'thaara_vps_pilot',admission,['-h',pilotName,'-U','thaara_app','-tA','-F','|'],{PGPASSWORD:appPassword});
  check('app login + pilot-start admission',r.status===0&&r.stdout.trim()==='thaara_vps_pilot|thaara_app|1|f|t',r.stdout.trim());
  r=psql(refName,'thaara_vps_pilot','SELECT 1',['-h',pilotName,'-U','thaara_app','-tA'],{PGPASSWORD:'wrong-'+appPassword});
  check('wrong app password rejected',r.status!==0);
  r=psql(refName,'thaara_vps_pilot','CREATE TABLE public.pilot_ddl_probe(x int)',['-h',pilotName,'-U','thaara_app'],{PGPASSWORD:appPassword});
  check('app role cannot run DDL',r.status!==0);
  r=psql(refName,'thaara_vps_pilot','SELECT count(*) FROM public.whatsapp_n8n_connections',['-h',pilotName,'-U','thaara_app','-tA'],{PGPASSWORD:appPassword});
  check('RLS fail-closed without workspace scope',r.status===0&&r.stdout.trim()==='0',r.stdout.trim());

  // 5. Migration ledger matches the existing migrator checksums.
  const ledger=docker(['exec',pilotName,'psql','-X','-U','postgres','-d','thaara_vps_pilot','-tA','-F','|','-c','SELECT version,name,checksum FROM schema_migrations ORDER BY version']);
  check('migration ledger matches migrator',ledger===bundle.migrations.map(m=>`${m.version}|${m.name}|${m.checksum}`).join('\n'));

  // 6. Reference install through the original reviewed path (raw files, original 1083/1085 guards).
  const dir=path.join(root,'packages/db/src/migrations');
  const ref=['CREATE TABLE IF NOT EXISTS schema_migrations (\n        version TEXT PRIMARY KEY,\n        name TEXT NOT NULL,\n        checksum TEXT NOT NULL,\n        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n      );'];
  for(const m of bundle.migrations)ref.push('BEGIN;\n'+fs.readFileSync(path.join(dir,m.name),'utf8')+'\n;\nCOMMIT;');
  ref.push("SELECT set_config('thaara.step1083_review_approved','yes',false),set_config('thaara.step1083_target_database',current_database(),false);");
  ref.push(fs.readFileSync(path.join(root,'docs/migrations/1083-whatsapp-durable.review.sql'),'utf8'));
  ref.push("SELECT set_config('thaara.step1085_review_approved','yes',false),set_config('thaara.step1085_base_sha','4ad4e53f5d1c30b6a2806728359b79ab47695399c79db354bcac1d479d18228e',false);");
  ref.push(fs.readFileSync(path.join(root,'docs/migrations/1085-whatsapp-callback-principal.review.sql'),'utf8'));
  r=psql(refName,'thaara_step1085_test',ref.join('\n'),quiet);
  check('reference install succeeded',r.status===0,r.stderr.split('\n').filter(l=>/ERROR/.test(l)).slice(0,2).join(' | '));
  const dump=(c,db)=>docker(['exec',c,'pg_dump','-U','postgres','-d',db,'--schema-only'],{maxBuffer:64*1024*1024}).split(/\r?\n/).filter(l=>!/^\\(un)?restrict /.test(l)).join('\n');
  const a=dump(pilotName,'thaara_vps_pilot'),b=dump(refName,'thaara_step1085_test');
  const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
  check('schema identical to reviewed path',a===b,`pilot ${sha(a).slice(0,12)} vs reference ${sha(b).slice(0,12)}`);
  const roles=c=>docker(['exec',c,'psql','-X','-U','postgres','-d','postgres','-tA','-c',"SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolbypassrls FROM pg_roles WHERE rolname LIKE 'thaara%' ORDER BY 1"]);
  check('role attributes identical (pilot app login enabled)',roles(pilotName).replace('thaara_app|f|t|f|f|t|f','thaara_app|f|t|f|f|?|f')===roles(refName).replace(/thaara_app\|f\|t\|f\|f\|[tf]\|f/,'thaara_app|f|t|f|f|?|f'));
  const evidence={date:new Date().toISOString(),scope:'local throwaway containers only; not VPS',image,bundleSha256:bundle.sha256,schemaSha256:sha(a),schemaBytes:a.length,checks:results};
  fs.mkdirSync(path.join(root,'node_modules/.cache/step1089'),{recursive:true});
  fs.writeFileSync(path.join(root,'node_modules/.cache/step1089/evidence.json'),JSON.stringify(evidence,null,1));
  console.log(JSON.stringify({passed:results.length,failed:0,bundleSha256:bundle.sha256,schemaSha256:evidence.schemaSha256}));
}catch(e){console.error(String(e.message||e).replaceAll(/[A-Za-z0-9_-]{43}/g,'[redacted]'));console.error(JSON.stringify({passed:results.filter(x=>x.ok).length,failedCheck:results.find(x=>!x.ok)?.name}));process.exitCode=1;}
finally{
  for(const [kind,name] of created.reverse())spawnSync('docker',kind==='container'?['rm','-f',name]:['network','rm',name],{encoding:'utf8'});
  fs.rmSync(secrets,{recursive:true,force:true});
  const left=spawnSync('docker',['ps','-a','--filter','label=thaara.step=1089','--format','{{.Names}}'],{encoding:'utf8'}).stdout.trim();
  console.log('cleanup:',left?'LEFTOVER '+left:'all throwaway containers/network removed; temp secrets deleted');
}
