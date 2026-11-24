// OFF by default. Infrastructure is reachable only through the exact approved mode + pinned manifest + one-use marker.
import fs from 'node:fs';
import crypto from 'node:crypto';
import net from 'node:net';
import {execFileSync,spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve,relative,isAbsolute} from 'node:path';
import {INBOUND_RUNTIME as p,inspectInboundRuntimeFixture,inspectInboundUnpublishedFixture,assertInboundRuntimeFixture} from './phone-inbound-runtime-guard.mjs';
import {createOwnedInboundFixtureRelay} from './phone-inbound-fixture-relay.mjs';
import {INBOUND_RELAY_CACHE_PATH,INBOUND_HOSTED_GATE_CACHE_PATH,INBOUND_HOSTED_GATE_FIXTURE,INBOUND_APPOINTMENT_CACHE_PATH,INBOUND_APPOINTMENT_V2_CACHE_PATH,INBOUND_F03_REFERENCE_CACHE_PATH,INBOUND_LEDGER_WRITE_FENCE_CACHE_PATH} from './phone-inbound-runtime-config.mjs';
import {withFreshPhoneFixtureSession} from './phone-fixture-session.mjs';
import {preflightCheck,rejectPreflight} from './phone-inbound-preflight-diagnostics.mjs';
import {runInboundRuntimeLifecycle} from './phone-inbound-runtime-lifecycle.mjs';
import {collectInboundRuntimeChild} from './phone-inbound-runtime-child.mjs';
import {appointmentTestDiagnostics} from './phone-appointment-assertions.mjs';
import {verifyInboundExecutionManifest,readInboundExecutionInputs,readInboundLocalFile,executionFiles} from './phone-inbound-runtime-manifest.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),cache=resolve(root,'node_modules/.cache/phone113-runtime');
const INBOUND_RUNTIME_FOR_DEFAULT=p;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const deny=()=>{throw Error('INBOUND_RUNTIME_STOPPED');};
const safeEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|COMSPEC|PATHEXT|DOCKER_CONFIG)$/i.test(k)));
export async function freeInboundPort(){await new Promise((ok,no)=>{const server=net.createServer();server.once('error',no);server.listen(p.port,'127.0.0.1',()=>server.close(error=>error?no(error):ok()));});return true;}
export function createInboundRuntimePorts({verifySources,inputs,environment=safeEnv(),transport='direct',validationPlan='journal-acceptance',referenceManifestSha256}){
 if(!['journal-acceptance','hosted-gates','appointment-storage','appointment-storage-v2','f03-reference-capture','ledger-write-fence'].includes(validationPlan)||!['direct','owned-exec-loopback'].includes(transport))deny();
 const hostedGates=validationPlan!=='journal-acceptance';if(hostedGates&&transport!=='owned-exec-loopback')deny();
 if(['f03-reference-capture','ledger-write-fence'].includes(validationPlan)&&!/^[a-f0-9]{64}$/.test(referenceManifestSha256??''))deny();
 const p=hostedGates?INBOUND_HOSTED_GATE_FIXTURE:INBOUND_RUNTIME_FOR_DEFAULT;
 const privateTransport=transport==='owned-exec-loopback',runCache=validationPlan==='ledger-write-fence'?resolve(root,INBOUND_LEDGER_WRITE_FENCE_CACHE_PATH):validationPlan==='f03-reference-capture'?resolve(root,INBOUND_F03_REFERENCE_CACHE_PATH):validationPlan==='appointment-storage-v2'?resolve(root,INBOUND_APPOINTMENT_V2_CACHE_PATH):validationPlan==='appointment-storage'?resolve(root,INBOUND_APPOINTMENT_CACHE_PATH):hostedGates?resolve(root,INBOUND_HOSTED_GATE_CACHE_PATH):privateTransport?resolve(root,INBOUND_RELAY_CACHE_PATH):cache;
 let dockerEndpoint,relay,lastInspection,lastExpected,relayAdmissionProof=null,relayShutdownProof=null;
 const docker=(args,env=environment)=>{
  if(privateTransport&&!dockerEndpoint&&args[0]!=='context')deny();
  return execFileSync('docker',privateTransport&&dockerEndpoint?['--host',dockerEndpoint,...args]:args,{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,windowsHide:true}).trim();
 };
 const password=()=>crypto.randomBytes(32).toString('base64url');
 const secrets={admin:password(),app:password(),ingest:password()};const started=Math.floor(Date.now()/1000);
 let activePool,child,childSettled=true;
 const queryFields=(id,fields)=>Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,JSON.parse(docker(['inspect','--format','{{json '+field+'}}',id]))]));
 return {
  async preflight(){
   await preflightCheck('source_integrity',verifySources);
   const endpoint=await preflightCheck('context_metadata',()=>{
    const value=JSON.parse(docker(['context','inspect','--format','{{json .Endpoints.docker.Host}}']));
    if(!['npipe:////./pipe/dockerDesktopLinuxEngine','npipe:////./pipe/docker_engine'].includes(value))rejectPreflight();return value;
   });
   dockerEndpoint=endpoint;
   await preflightCheck('port_probe',freeInboundPort);
   await preflightCheck('container_inventory',()=>{if(docker(['ps','-a','--format','{{.Names}}']).split(/\r?\n/).includes(p.container))rejectPreflight();});
   await preflightCheck('network_inventory',()=>{if(docker(['network','ls','--format','{{.Name}}']).split(/\r?\n/).includes(p.network))rejectPreflight();});
   const imageId=await preflightCheck('image_metadata',()=>{const value=docker(['image','inspect','--format','{{.Id}}',p.image]);if(!/^sha256:[a-f0-9]{64}$/.test(value))rejectPreflight();return value;});
   return {reviewIntegrity:true,existingResources:false,portAvailable:true,localEngine:true,imageId};
  },
  async createNetwork(e){return docker(['network','create','--internal','--label','thaara.step=113-inbound','--label','thaara.run='+e.runId,p.network]);},
  async createContainer(e){return docker(['run','-d','--pull=never','--name',p.container,'--label','thaara.step=113-inbound','--label','thaara.run='+e.runId,'--network',p.network,'--read-only',
   '--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=536870912','--tmpfs','/var/run/postgresql:rw,noexec,nosuid,size=16777216','--tmpfs','/tmp:rw,noexec,nosuid,size=33554432',
   '--memory','768m','--cpus','1','--pids-limit','128','--shm-size','64m','--security-opt','no-new-privileges:true','--log-driver','none',...(privateTransport?[]:['-p','127.0.0.1:15436:5432']),'-e','POSTGRES_PASSWORD','-e','POSTGRES_DB',p.image],{...environment,POSTGRES_PASSWORD:secrets.admin,POSTGRES_DB:p.database});},
  async waitReady(e,signal){const deadline=Date.now()+15000;for(let n=0;n<60&&Date.now()<deadline;n++){if(signal?.aborted)deny();try{docker(['exec',e.containerId,'pg_isready','-h','127.0.0.1','-U','postgres','-d',p.database]);return;}catch{await new Promise(r=>setTimeout(r,250));}}deny();},
  async verifyIsolation(e){
   if(relay)await relay.waitForIdle();
   const inspection=privateTransport?inspectInboundUnpublishedFixture(docker,e):inspectInboundRuntimeFixture(docker,e);
   if(privateTransport){
    if(!relay){relay=createOwnedInboundFixtureRelay({expected:e,inspection,dockerEndpoint});await relay.start();}
    await relay.waitForIdle();relayAdmissionProof=relay.verify(inspection);
   }
   lastInspection=inspection;lastExpected={...e};return true;
  },
  async applySchemas(e,signal){
   const checkAbort=()=>{if(signal?.aborted)deny();};checkAbort();
   verifySources();const {Pool}=createRequire(new URL('../packages/db/package.json',import.meta.url))('pg');
   let migrationId='base:0001',observedCode=null;const applied=[];try{
    return await withFreshPhoneFixtureSession({verify:()=>{
     verifySources();if(!lastInspection||!lastExpected||['containerId','networkId','imageId','runId'].some(k=>e[k]!==lastExpected[k]))deny();
     if(privateTransport)relay.verify(lastInspection);else assertInboundRuntimeFixture(e,lastInspection.facts,lastInspection.network);
    },createPool:()=>{activePool=new Pool({host:'127.0.0.1',port:p.port,database:p.database,user:'postgres',password:secrets.admin,max:1,connectionTimeoutMillis:5000,statement_timeout:30000,query_timeout:45000});return activePool;}},async client=>{
    const target=(await client.query("SELECT current_database() AS db,current_setting('server_version_num')::int AS version,to_regclass('public.workspaces') AS existing")).rows[0];
    if(target.db!==p.database||target.version<160000||target.version>=170000||target.existing)deny();
    const {Migrator}=await import('../packages/db/dist/index.js');
    const tracked={query:async(...args)=>{checkAbort();try{return await client.query(...args);}catch(error){if(/^[0-9A-Z]{5}$/.test(error?.code??''))observedCode=error.code;throw error;}}};
    for(const migration of inputs.base){migrationId='base:'+migration.version;await new Migrator(tracked).migrate([migration]);applied.push(migrationId);}
    if(hostedGates)return applied;
    for(const [step,sql]of [[112,inputs.journal],[113,inputs.principal]]){
     migrationId=step+'r';
     checkAbort();
     await client.query(`SELECT set_config('thaara.step${step}_runtime_review_approved','isolated-runtime-only',false),set_config('thaara.step${step}_runtime_target_database',current_database(),false)`);
     await client.query(sql);
     applied.push(migrationId);
    }
    // Fixture-only LOGIN provisioning, preserving role privileges; passwords never enter command arguments or output.
    for(const [role,value]of [['thaara_app',secrets.app],['thaara_phone_ingest',secrets.ingest]]){
     migrationId='fixture_roles';
     checkAbort();
     await client.query("SELECT set_config('phone113.fixture_password',$1,false)",[value]);
     await client.query(`DO $$ BEGIN EXECUTE format('ALTER ROLE ${role} LOGIN PASSWORD %L',current_setting('phone113.fixture_password')); END $$`);
    }
    return applied;
    });
   }catch(error){throw Object.assign(Error('INBOUND_RUNTIME_SCHEMA_FAILED'),{migrationId,code:/^[0-9A-Z]{5}$/.test(error?.code??'')?error.code:observedCode});}
   finally{activePool=undefined;}
  },
  async runAcceptance(e,signal){
   verifySources();const proof=Buffer.from(JSON.stringify({...e,...(privateTransport?{transport,dockerEndpoint}:{}),...(hostedGates?{validationPlan}:{})}));fs.writeFileSync(resolve(runCache,'fixture.json'),proof,{flag:'wx',mode:0o600});
   const url=(role,secret)=>`postgresql://${role}:${secret}@127.0.0.1:${p.port}/${p.database}`;
   const env={...environment,NODE_ENV:'test',...(validationPlan==='ledger-write-fence'?{THAARA_PHONE_LEDGER_MANIFEST_SHA256:referenceManifestSha256}:{}),...(validationPlan==='f03-reference-capture'?{THAARA_PHONE_F03_MANIFEST_SHA256:referenceManifestSha256}:{}),...(hostedGates?{THAARA_PHONE113_VALIDATION_PLAN:validationPlan}:{}),...(privateTransport?{THAARA_PHONE113_RUNTIME_TRANSPORT:transport}:{}),THAARA_PHONE113_RUNTIME_APPROVED:'isolated-runtime-only',THAARA_PHONE113_PROOF_SHA:hash(proof),THAARA_PHONE113_ADMIN_URL:url('postgres',secrets.admin),THAARA_PHONE113_APP_URL:url('thaara_app',secrets.app),THAARA_PHONE113_INGEST_URL:url('thaara_phone_ingest',secrets.ingest)};
   const testFile=validationPlan==='ledger-write-fence'?'apps/api/test/phone-migration-ledger-fence.runtime.test.ts':validationPlan==='f03-reference-capture'?'apps/api/test/phone-f03-reference.runtime.test.ts':['appointment-storage','appointment-storage-v2'].includes(validationPlan)?'apps/api/test/phone-inbound-appointment-storage.runtime.test.ts':hostedGates?'apps/api/test/phone-inbound-hosted-gates.runtime.test.ts':'apps/api/test/phone-inbound-postgres.runtime.test.ts';
   child=spawn(process.execPath,['node_modules/vitest/vitest.mjs','run',testFile,'--exclude','**/.agents/worktrees/**','--pool=threads','--poolOptions.threads.singleThread','--bail=1','--silent','--reporter=json'],{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:true});childSettled=false;
   let collected;try{collected=await collectInboundRuntimeChild(child,{signal});childSettled=true;}catch(error){childSettled=error?.settled===true;throw Error('INBOUND_RUNTIME_CHILD_STOPPED');}
   const result=JSON.parse(collected.output);
   verifySources();if(result.testResults?.length!==1||result.testResults[0].assertionResults?.length!==(validationPlan==='ledger-write-fence'?4:validationPlan==='f03-reference-capture'?3:9))deny();
   const v2=validationPlan==='appointment-storage-v2',assertions=result.testResults[0].assertionResults;
   const selectionValid=!v2||(assertions.slice(0,4).every(a=>['skipped','pending','todo'].includes(a.status))&&assertions.slice(4).every(a=>a.status==='passed'));
   const diagnostics=['appointment-storage','appointment-storage-v2'].includes(validationPlan)?appointmentTestDiagnostics(result):{};
   if(v2)diagnostics.notExecutedCaseNumbers=diagnostics.notExecutedCaseNumbers.filter(n=>n>=5);
   return {success:collected.code===0&&result.success&&selectionValid,passed:result.numPassedTests,failed:result.numFailedTests,skipped:result.numPendingTests,...(hostedGates?{failedCaseNumbers:assertions.flatMap((a,i)=>a.status==='failed'?[i+1]:[])}:{}),...diagnostics};
  },
  async closeConnections(){if(activePool){await activePool.end();activePool=undefined;}if(relay)relayShutdownProof=await relay.close();if(!childSettled)deny();},
  transportEvidence(){return {mode:transport,admission:relayAdmissionProof,shutdown:relayShutdownProof,supervisor:relay?.diagnostic?.()??null};},
  async inspectOwnedContainer(e){return queryFields(e.containerId,{Id:'.Id',Image:'.Image',Name:'.Name',Labels:'.Config.Labels'});},
  async removeContainer(id){docker(['rm','-f',id]);},
  async inspectOwnedNetwork(e){return JSON.parse(docker(['network','inspect',e.networkId]))[0];},
  async removeNetwork(id){docker(['network','rm',id]);},
  async verifyRemoval(e){
   const containerAbsent=!e.containerId||docker(['ps','-a','--no-trunc','--filter','id='+e.containerId,'--format','{{.ID}}'])==='';
   const networkAbsent=!e.networkId||docker(['network','ls','--no-trunc','--filter','id='+e.networkId,'--format','{{.ID}}'])==='';
   const events=e.containerId?docker(['events','--since',String(started),'--until',String(Math.ceil(Date.now()/1000)),'--filter','container='+e.containerId,'--filter','event=destroy','--format','{{json .}}']).split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x)):[];
   const destroyEventVerified=!e.containerId||events.some(x=>x.Action==='destroy'&&(x.Actor?.ID??x.id)===e.containerId&&x.Actor?.Attributes?.['thaara.run']===e.runId);
   return {containerAbsent,networkAbsent,destroyEventVerified,portFree:await freeInboundPort()};
  }
 };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let result;try{
  const mode=process.argv[2],pin=process.argv[4];if(process.argv.length!==5||process.argv[3]!=='--manifest-sha256'||!['--preflight-only','--approved-isolated-inbound113'].includes(mode)||! /^[a-f0-9]{64}$/.test(pin??''))deny();
  const verifySources=()=>{const bytes=readInboundLocalFile(root,'docs/integrations/phone/PHONE113_POSTGRES_ACCEPTANCE.review.json');if(hash(bytes)!==pin)deny();verifyInboundExecutionManifest(JSON.parse(bytes),executionFiles(root),p=>readInboundLocalFile(root,p));};
  verifySources();if(mode==='--preflight-only'){console.log(JSON.stringify({status:'sources_verified',infrastructureTouched:false,sqlExecuted:false}));}
  else{
   const inputs=readInboundExecutionInputs(root),runId=crypto.randomBytes(16).toString('hex');
   fs.mkdirSync(cache,{recursive:true});const cacheRelative=relative(fs.realpathSync(root),fs.realpathSync(cache));
   if(isAbsolute(cacheRelative)||cacheRelative==='..'||cacheRelative.startsWith('../')||cacheRelative.startsWith('..\\')||!fs.lstatSync(cache).isDirectory())deny();
   for(const name of ['used.json','fixture.json','result.json'])if(fs.existsSync(resolve(cache,name)))deny();
   fs.writeFileSync(resolve(cache,'used.json'),JSON.stringify({runId,manifestSha256:pin,startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
   const controller=new AbortController(),abort=()=>controller.abort();process.on('SIGINT',abort);process.on('SIGTERM',abort);
   try{result=await runInboundRuntimeLifecycle(createInboundRuntimePorts({verifySources,inputs}),{runId,signal:controller.signal});}
   finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
   fs.writeFileSync(resolve(cache,'result.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;
  }
 }catch{console.error('INBOUND_RUNTIME_PREFLIGHT_OR_EXECUTION_STOPPED');process.exitCode=1;}
}
