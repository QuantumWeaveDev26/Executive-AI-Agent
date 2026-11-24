// Explicit approval only. No .env, old credential cache, existing database or existing-volume use.
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import { execFileSync,spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { CALLBACK_CONTAINER,CALLBACK_NETWORK,CALLBACK_DATABASE,getCallbackRuntimeConfig,verifyCallbackFixture } from './step1085-runtime-guard.mjs';
import { createBinaryRelay } from './step1084-loopback-proxy.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const cache=new URL('../node_modules/.cache/step1085/',import.meta.url);
const image='postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea';
const baseSha='4ad4e53f5d1c30b6a2806728359b79ab47695399c79db354bcac1d479d18228e';
const baseSchemaSha='29498d7da36994347371a77f0e93467c7898db6c01b0223db6916499fb2d59a2';
// Must match the reviewed artifact before any infrastructure or SQL action.
const callbackSha='0bee4ba36c23ec620bae3074efe637c6ee8355cf0de4ad5df78135525ed1c774';
const fail=()=>{throw Error('Step1085 approved isolated runner stopped; no fallback target.');};
const docker=(args,env=process.env)=>execFileSync('docker',args,{encoding:'utf8',env,stdio:['ignore','pipe','pipe'],timeout:20000}).trim();
let relay,admin;
try{
  const mode=process.argv[2];if(!['initialize','test'].includes(mode)||process.argv[3]!=='--approved'||process.argv.length!==4)fail();
  const adminPassword=process.env.THAARA_1085_ADMIN_PASSWORD,appPassword=process.env.THAARA_1085_APP_PASSWORD;
  if(!/^[A-Za-z0-9_-]{32,256}$/.test(adminPassword||'')||!/^[A-Za-z0-9_-]{32,256}$/.test(appPassword||'')||adminPassword===appPassword)fail();
  const base=fs.readFileSync(new URL('../docs/migrations/1083-whatsapp-durable.review.sql',import.meta.url),'utf8');
  const callback=fs.readFileSync(new URL('../docs/migrations/1085-whatsapp-callback-principal.review.sql',import.meta.url),'utf8');
  const sha=s=>crypto.createHash('sha256').update(s).digest('hex');if(sha(base)!==baseSha||sha(callback)!==callbackSha)fail();
  const migrationsDir=new URL('../packages/db/src/migrations/',import.meta.url);
  const manifest=fs.readdirSync(migrationsDir).filter(f=>f.endsWith('.sql')).sort().map(name=>[name,sha(fs.readFileSync(new URL(name,migrationsDir)))]);
  if(manifest.length!==12||sha(JSON.stringify(manifest))!==baseSchemaSha)fail();
  const child={...process.env,NODE_ENV:'test',THAARA_STEP1085_RUNTIME_APPROVED:'yes',THAARA_STEP1083_RUNTIME_APPROVED:'yes'};
  for(const key of Object.keys(child))if(/^(PG|TASK004_|THAARA_TEST_)/.test(key)||['DATABASE_URL','MIGRATION_DATABASE_URL','BOOTSTRAP_DATABASE_URL','WORKER_DATABASE_URL','REDIS_URL','NODE_OPTIONS','NODE_PATH','THAARA_1085_ADMIN_PASSWORD','THAARA_1085_APP_PASSWORD'].includes(key))delete child[key];
  child.THAARA_STEP1085_ADMIN_URL=`postgresql://postgres:${encodeURIComponent(adminPassword)}@127.0.0.1:15433/${CALLBACK_DATABASE}`;
  child.THAARA_STEP1085_APP_URL=`postgresql://thaara_app:${encodeURIComponent(appPassword)}@127.0.0.1:15433/${CALLBACK_DATABASE}`;
  const config=getCallbackRuntimeConfig(child);
  const identityPath=new URL('identity.json',cache);
  if(mode==='initialize'&&!fs.existsSync(identityPath)){
    await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(15433,'127.0.0.1',()=>server.close(resolve));});
    const names=docker(['ps','-a','--format','{{.Names}}']).split(/\r?\n/);if(names.includes(CALLBACK_CONTAINER))fail();
    if(docker(['network','ls','--format','{{.Name}}']).split(/\r?\n/).includes(CALLBACK_NETWORK))fail();
    const imageId=docker(['image','inspect','--format','{{.Id}}',image]);
    const networkId=docker(['network','create','--internal','--label','thaara.step=1085',CALLBACK_NETWORK]);
    const id=docker(['run','-d','--name',CALLBACK_CONTAINER,'--label','thaara.step=1085','--network',CALLBACK_NETWORK,'--read-only',
      '--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=536870912','--tmpfs','/var/run/postgresql:rw,noexec,nosuid,size=16777216','--tmpfs','/tmp:rw,noexec,nosuid,size=33554432',
      '--memory','768m','--cpus','1','--shm-size','64m','-p','127.0.0.1:15433:5432','-e','POSTGRES_PASSWORD','-e','POSTGRES_DB',image],{...process.env,POSTGRES_PASSWORD:adminPassword,POSTGRES_DB:CALLBACK_DATABASE});
    fs.writeFileSync(identityPath,JSON.stringify({ContainerId:id,ImageId:imageId,NetworkId:networkId,BaseSha:baseSha,CallbackSha:callbackSha}));
  }
  const verified=verifyCallbackFixture();if(verified.expected.BaseSha!==baseSha||verified.expected.CallbackSha!==callbackSha)fail();
  let ready=false;for(let i=0;i<50;i++){try{docker(['exec',verified.expected.ContainerId,'pg_isready','-U','postgres','-d',CALLBACK_DATABASE]);ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}if(!ready)fail();
  if(!verified.facts.ActualPorts?.['5432/tcp']?.some(p=>p.HostIp==='127.0.0.1'&&p.HostPort==='15433')){
    relay=createBinaryRelay(()=>spawn('docker',['exec','-i',verified.expected.ContainerId,'nc','127.0.0.1','5432'],{stdio:['pipe','pipe','pipe'],windowsHide:true}));
    await new Promise((resolve,reject)=>{relay.once('error',reject);relay.listen(15433,'127.0.0.1',resolve);});
  }
  const {PostgresDatabase,Migrator}=await import('../packages/db/dist/index.js');
  const {Pool}=createRequire(new URL('../packages/db/package.json',import.meta.url))('pg');
  admin=new PostgresDatabase(new Pool({connectionString:config.migrationUrl,max:1,connectionTimeoutMillis:5000}));
  if((await admin.query('SELECT current_database() AS db')).rows[0]?.db!==CALLBACK_DATABASE)fail();
  if(mode==='initialize'){
    const tables=await admin.query("SELECT to_regclass('public.whatsapp_n8n_relay_principals') AS principals,to_regclass('public.whatsapp_n8n_connections') AS connections");
    if(tables.rows[0].principals)fail();
    const migrator=new Migrator(admin);await migrator.migrate(migrator.loadMigrationFiles(fileURLToPath(migrationsDir)));
    await admin.query("SELECT set_config('step1085.app_password',$1,false)",[appPassword]);
    await admin.query("DO $$ BEGIN EXECUTE format('ALTER ROLE thaara_app LOGIN PASSWORD %L',current_setting('step1085.app_password')); END $$");
    if(!tables.rows[0].connections){await admin.query("SELECT set_config('thaara.step1083_review_approved','yes',false),set_config('thaara.step1083_target_database',current_database(),false)");await admin.exec(base);}
    verifyCallbackFixture();
    await admin.query("SELECT set_config('thaara.step1085_review_approved','yes',false),set_config('thaara.step1085_base_sha',$1,false)",[baseSha]);
    await admin.exec(callback);
    console.log('Step1085 isolated schema initialized. No provider/activation or existing resource changes.');
  }
  verifyCallbackFixture();await admin.close();admin=undefined;
  const code=await new Promise((resolve,reject)=>{const test=spawn(process.execPath,['node_modules/vitest/vitest.mjs','run','apps/api/test/whatsapp-durable.runtime.test.ts','apps/api/test/whatsapp-callback.runtime.test.ts','--silent'],{cwd:root,env:child,stdio:'inherit',windowsHide:true});test.once('error',reject);test.once('exit',resolve);});
  if(code!==0)fail();console.log('Step1085 runtime suite completed; original services/volumes were never targeted.');
}catch{console.error('Step1085 stopped. No credentials or raw database errors are logged. Inspect the authorized fixture through safe metadata only.');process.exitCode=1;}
finally{await admin?.close().catch(()=>{});if(relay)await new Promise(resolve=>relay.close(resolve));}
