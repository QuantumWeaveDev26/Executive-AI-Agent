// Prepared runner only. Starting it with the explicit flag requires fresh owner approval for Step 110 infrastructure + SQL.
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {PHONE_RUNTIME as p,PHONE_SQL_PINS,assertPhoneRuntimeFixture,phoneRuntimeConfig,runPhoneRuntimeChild,inspectPhoneRuntimeFixture} from './phone-runtime-guard.mjs';
import {createBinaryRelay} from './step1084-loopback-proxy.mjs';
import {diagnosePhone110a,classifyPhoneFixtureError} from './phone-migration-diagnostic.mjs';
import {withFreshPhoneFixtureSession} from './phone-fixture-session.mjs';
const fail=()=>{throw Error('Phone disposable runner stopped');};
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const root=fileURLToPath(new URL('../',import.meta.url)),cache=new URL('../node_modules/.cache/phone110-runtime/',import.meta.url);
const migrations=new URL('../packages/db/src/migrations/',import.meta.url);
const basePin='29498d7da36994347371a77f0e93467c7898db6c01b0223db6916499fb2d59a2';
const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|COMSPEC|PATHEXT|DOCKER_CONFIG)$/i.test(k)));
const docker=(args,env=safeEnv)=>execFileSync('docker',args,{encoding:'utf8',env,stdio:['ignore','pipe','pipe'],timeout:30000,windowsHide:true}).trim();
const inputs=Object.entries(PHONE_SQL_PINS).map(([name,pin])=>{const data=fs.readFileSync(new URL('../docs/migrations/'+name,import.meta.url));if(sha(data)!==pin)fail();return {name,data:data.toString('utf8'),pin};});
const manifest=fs.readdirSync(migrations).filter(n=>n.endsWith('.sql')).sort().map(n=>[n,sha(fs.readFileSync(new URL(n,migrations)))]);
if(manifest.length!==12||sha(JSON.stringify(manifest))!==basePin)fail();
if(process.argv[2]==='--print-plan'){console.log(JSON.stringify({...p,baseSchemaSha:basePin,sqlPins:PHONE_SQL_PINS,temporaryStorageOnly:true,expectedTests:8}));process.exit(0);}
const diagnosticOnly=process.argv.slice(2).join(' ')==='--approved-diagnostic-phone110';
if(!diagnosticOnly&&process.argv.slice(2).join(' ')!=='--approved-isolated-phone110')fail();
let containerId,networkId,imageId,relay,stage='preflight';
const interrupted=new AbortController(),onSignal=()=>interrupted.abort();process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);
const verify=()=>{
 if(interrupted.signal.aborted)fail();
 const expected={containerId,networkId,imageId},inspection=inspectPhoneRuntimeFixture(docker,expected);
 fs.mkdirSync(cache,{recursive:true});fs.writeFileSync(new URL('isolation.json',cache),JSON.stringify({stage,expected,...inspection},null,2));
 assertPhoneRuntimeFixture(expected,inspection.facts,inspection.network);return inspection.facts;
};
try{
 const endpoint=JSON.parse(docker(['context','inspect','--format','{{json .Endpoints.docker.Host}}']));
 if(!['npipe:////./pipe/dockerDesktopLinuxEngine','npipe:////./pipe/docker_engine'].includes(endpoint))fail();
 await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(p.port,'127.0.0.1',()=>s.close(resolve));});
 if(interrupted.signal.aborted)fail();
 if(docker(['ps','-a','--format','{{.Names}}']).split(/\r?\n/).includes(p.container)||docker(['network','ls','--format','{{.Name}}']).split(/\r?\n/).includes(p.network))fail();
 imageId=docker(['image','inspect','--format','{{.Id}}',p.image]); // Never pull an unreviewed image.
 const secret=()=>crypto.randomBytes(32).toString('base64url'),adminPassword=secret(),appPassword=secret();
 networkId=docker(['network','create','--internal','--label','thaara.step=110-phone',p.network]);
 containerId=docker(['run','-d','--pull=never','--name',p.container,'--label','thaara.step=110-phone','--network',p.network,'--read-only',
  '--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=536870912','--tmpfs','/var/run/postgresql:rw,noexec,nosuid,size=16777216','--tmpfs','/tmp:rw,noexec,nosuid,size=33554432',
  '--memory','768m','--cpus','1','--shm-size','64m','-p',`127.0.0.1:${p.port}:5432`,'-e','POSTGRES_PASSWORD','-e','POSTGRES_DB',p.image],{...safeEnv,POSTGRES_PASSWORD:adminPassword,POSTGRES_DB:p.database});
 let ready=false;for(let i=0;i<60;i++){try{docker(['exec',containerId,'pg_isready','-U','postgres','-d',p.database]);ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}if(!ready)fail();
 const facts=verify();
 if(!facts.ActualPorts?.['5432/tcp']?.some(x=>x.HostIp==='127.0.0.1'&&x.HostPort===String(p.port))){
  relay=createBinaryRelay(()=>spawn('docker',['exec','-i',containerId,'nc','127.0.0.1','5432'],{env:safeEnv,stdio:['pipe','pipe','pipe'],windowsHide:true}));
  await new Promise((resolve,reject)=>{relay.once('error',reject);relay.listen(p.port,'127.0.0.1',resolve);});
 }
 const child={...safeEnv,NODE_ENV:'test',THAARA_PHONE_RUNTIME_APPROVED:'yes',THAARA_PHONE_TEST_ADMIN_URL:`postgresql://postgres:${adminPassword}@127.0.0.1:${p.port}/${p.database}`,THAARA_PHONE_TEST_APP_URL:`postgresql://thaara_app:${appPassword}@127.0.0.1:${p.port}/${p.database}`};
 const config=phoneRuntimeConfig(child);
 const {Migrator}=await import('../packages/db/dist/index.js');
 const {Pool}=createRequire(new URL('../packages/db/package.json',import.meta.url))('pg');
 const session={verify,createPool:()=>new Pool({connectionString:config.admin,max:1,connectionTimeoutMillis:5000,statement_timeout:30000,query_timeout:45000})};
 await withFreshPhoneFixtureSession(session,async admin=>{
 const target=(await admin.query("SELECT current_database() AS db,current_setting('server_version_num')::int AS version,to_regclass('public.workspaces') AS existing")).rows[0];
 if(target.db!==p.database||target.version<160000||target.version>=170000||target.existing)fail();
 stage='base-schema';const migrator=new Migrator(admin);await migrator.migrate(migrator.loadMigrationFiles(fileURLToPath(migrations)));
 await admin.query("SELECT set_config('phone110.app_password',$1,false)",[appPassword]);
 await admin.query("DO $$ BEGIN EXECUTE format('ALTER ROLE thaara_app LOGIN PASSWORD %L',current_setting('phone110.app_password')); END $$");
 });
 if(diagnosticOnly){
  stage=inputs[0].name;
  await withFreshPhoneFixtureSession(session,async(admin,getPoolCounts)=>{
  const diagnostic=await diagnosePhone110a(admin,inputs[0].data,{getPoolCounts});
  fs.writeFileSync(new URL('diagnostic.json',cache),JSON.stringify(diagnostic,null,2));console.log(JSON.stringify(diagnostic));
  if(diagnostic.status!=='applied')process.exitCode=1;
  });
  // Even success is not permission to apply 110b/110c or execute acceptance tests.
 }else{
 for(const input of inputs){stage=input.name;await withFreshPhoneFixtureSession(session,async admin=>{const step=input.name.slice(0,4);await admin.query(`SELECT set_config('thaara.step${step}_review_approved','yes',false),set_config('thaara.step${step}_target_database',current_database(),false)`);await admin.exec(input.data);});}
 stage='tests';verify();
 const proc=spawn(process.execPath,['node_modules/vitest/vitest.mjs','run','apps/api/test/phone-postgres.runtime.test.ts','--pool=threads','--silent','--reporter=json'],{cwd:root,env:child,stdio:['ignore','pipe','pipe'],windowsHide:true});
 const run=await runPhoneRuntimeChild(proc,{signal:interrupted.signal,timeoutMs:300000});
 const result=JSON.parse(run.output);const summary={passed:result.numPassedTests,failed:result.numFailedTests,skipped:result.numPendingTests,files:result.testResults?.length,success:result.success,sqlPins:PHONE_SQL_PINS,baseSchemaSha:basePin};
 fs.mkdirSync(cache,{recursive:true});fs.writeFileSync(new URL('results.json',cache),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 if(run.code!==0||result.numPassedTests!==8||result.numFailedTests||result.numPendingTests||!result.success)fail();stage='completed';
 }
}catch(error){console.error(JSON.stringify({stage,...classifyPhoneFixtureError(error)}));process.exitCode=1;}
finally{
 if(relay)await new Promise(r=>relay.close(r));
 try{
  if(containerId){if(!/^[a-f0-9]{64}$/.test(containerId)||docker(['inspect','--format','{{index .Config.Labels "thaara.step"}}',containerId])!=='110-phone')fail();docker(['rm','-f',containerId]);}
  if(networkId){const n=JSON.parse(docker(['network','inspect',networkId]))[0];if(n.Id!==networkId||n.Name!==p.network||n.Labels?.['thaara.step']!=='110-phone'||Object.keys(n.Containers??{}).length)fail();docker(['network','rm',networkId]);}
  console.log('Owned disposable fixture cleanup finished; no existing resources selected.');
 }catch{console.error('Owned fixture cleanup needs inspection; no fallback deletion attempted.');process.exitCode=1;}
 process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);
}
