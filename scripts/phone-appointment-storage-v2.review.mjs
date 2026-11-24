// Preparation and source-only preflight do not execute Docker, SQL or a provider operation.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readInboundLocalFile} from './phone-inbound-runtime-manifest.mjs';
import {INBOUND_APPOINTMENT_V2_CACHE_PATH,INBOUND_HOSTED_GATE_FIXTURE} from './phone-inbound-runtime-config.mjs';
import {createInboundRuntimePorts} from './phone-inbound-postgres-runtime.mjs';
import {runInboundRuntimeLifecycle} from './phone-inbound-runtime-lifecycle.mjs';
import {appointmentStorageFiles as originalFiles} from './phone-appointment-storage.review.mjs';
import {makeInboundReview,verifyInboundReview,INBOUND_REVIEW_FILES} from './phone-inbound-release-preflight.mjs';
import {deriveInboundRuntimeSql,INBOUND_SQL_SOURCES} from './phone-inbound-runtime-sql.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export const APPOINTMENT_MANIFEST='docs/integrations/phone/PHONE_APPOINTMENT_STORAGE_V2.review.json';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const deny=()=>{throw Error('PHONE_APPOINTMENT_STORAGE_REVIEW_DENIED');};
const shape=Object.freeze({reviewOnly:true,purpose:'appointment-journal-postgres-acceptance',validationPlan:'appointment-storage-v2',transport:'owned-exec-loopback',dockerPublication:'none',expectedTests:5,plannedSkippedTests:4,historicalPassedCases:[1,2,3,4],fixture:INBOUND_HOSTED_GATE_FIXTURE});
export function appointmentStorageCommand(args){
 if(args.length===1&&args[0]==='--prepare-review')return {mode:args[0],pin:null};
 if(args.length!==3||!['--preflight-only','--approved-appointment-storage-v2'].includes(args[0])||args[1]!=='--manifest-sha256'||!/^[a-f0-9]{64}$/.test(args[2]??''))deny();
 return {mode:args[0],pin:args[2]};
}
export const INPUT_REVIEW='docs/integrations/phone/PHONE_APPOINTMENT_STORAGE_V2_INPUT.review.json';
const history={
 'node_modules/.cache/phone-appointment-storage-v1/used.json':'6421fbedd579226ed687b894d75f49f277ff6f4b01b8877e44d1cdb5b534287d',
 'node_modules/.cache/phone-appointment-storage-v1/result.json':'d9ff43487ba0aeab6079994fc13536dfd7b96aa713cb82f8eb054e98a2ae2215',
 'docs/integrations/phone/PHONE_APPOINTMENT_STORAGE_V1.review.json':'c681a4a8af96fea19b9005aa0cdf32f67e6f46414df63884d7d5ebacab3e55d7'
};
export function verifyHistoricalEvidence(read){
 for(const [p,pin]of Object.entries(history))if(sha(read(p))!==pin)deny();
 const r=JSON.parse(read('node_modules/.cache/phone-appointment-storage-v1/result.json'));
 if(r.status!=='stopped'||r.cleanup?.verified!==true||r.tests?.passed!==4||r.tests?.failed!==1||JSON.stringify(r.tests?.failedCaseNumbers)!=='[5]')deny();
 const c=JSON.parse(read('node_modules/.cache/phone-appointment-storage-v1/cleanup-independent.json'));
 if(['containerAbsent','networkAbsent','destroyEventVerified','portFree','relayClosed'].some(k=>c[k]!==true)||c.activeChildren!==0||c.activeSockets!==0)deny();
}
export function readV2Inputs(read,names){
 verifyInboundReview(JSON.parse(read(INPUT_REVIEW)),read,names);
 const base=INBOUND_REVIEW_FILES.filter(p=>p.startsWith('packages/db/src/migrations/')).sort().map(path=>{const name=path.split('/').pop(),sql=read(path).toString('utf8');return {name,version:name.slice(0,4),sql,checksum:sha(sql.trim())};});
 const candidates=[112,113].map(step=>{const e=INBOUND_SQL_SOURCES[step],candidate=read(e.candidate).toString('utf8');if(candidate!==deriveInboundRuntimeSql(step,read(e.path).toString('utf8')))deny();return candidate;});
 return {base,journal:candidates[0],principal:candidates[1]};
}
export function appointmentStorageFiles(){return [...new Set([...originalFiles(),INPUT_REVIEW,...Object.keys(history),
 'node_modules/.cache/phone-appointment-storage-v1/cleanup-independent.json',
 'scripts/phone-appointment-storage-v2.review.mjs','scripts/phone-appointment-storage-v2.review.test.ts',
 'scripts/phone-appointment-assertions.mjs','scripts/phone-appointment-assertions.test.ts',
 'apps/api/test/phone-inbound-appointment-case5.test.ts','apps/api/test/phone-inbound-principal-postgres.test.ts'
 ])].sort();}
export function verifyAppointmentStorageManifest(m,files,read){
 if(!m||Object.keys(m).sort().join(',')!==[...Object.keys(shape),'files'].sort().join(','))deny();
 for(const [key,value]of Object.entries(shape))if(JSON.stringify(m[key])!==JSON.stringify(value))deny();
 if(!m.files||typeof m.files!=='object'||Array.isArray(m.files)||JSON.stringify(Object.keys(m.files).sort())!==JSON.stringify([...files].sort()))deny();
 for(const p of files)if(!/^[a-f0-9]{64}$/.test(m.files[p])||sha(read(p))!==m.files[p])deny();
}
function directory(path,create=false){
 const base=fs.realpathSync(root),parent=fs.realpathSync(dirname(path)),rel=relative(base,parent);
 if(isAbsolute(rel)||rel==='..'||rel.startsWith('../')||rel.startsWith('..\\'))deny();
 if(create&&!fs.existsSync(path))fs.mkdirSync(path);
 const actual=relative(base,fs.realpathSync(path));if(isAbsolute(actual)||actual==='..'||actual.startsWith('../')||actual.startsWith('..\\')||!fs.lstatSync(path).isDirectory())deny();
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const {mode,pin}=appointmentStorageCommand(process.argv.slice(2)),read=p=>readInboundLocalFile(root,p);
  const names=fs.readdirSync(resolve(root,'packages/db/src/migrations')).filter(n=>n.endsWith('.sql'));
  if(mode==='--prepare-review'){
   verifyHistoricalEvidence(read);directory(dirname(resolve(root,APPOINTMENT_MANIFEST)));
   fs.writeFileSync(resolve(root,INPUT_REVIEW),JSON.stringify(makeInboundReview(read),null,2)+'\n',{flag:'wx'});
   readV2Inputs(read,names);
   fs.writeFileSync(resolve(root,APPOINTMENT_MANIFEST),JSON.stringify({...shape,files:Object.fromEntries(appointmentStorageFiles().map(p=>[p,sha(read(p))]))},null,2)+'\n',{flag:'wx'});
  }
  const verifySources=()=>{const bytes=read(APPOINTMENT_MANIFEST);if(pin&&sha(bytes)!==pin)deny();verifyAppointmentStorageManifest(JSON.parse(bytes),appointmentStorageFiles(),read);return sha(bytes);};
  const manifestSha256=verifySources();verifyHistoricalEvidence(read);readV2Inputs(read,names);
  if(mode!=='--approved-appointment-storage-v2')console.log(JSON.stringify({status:'appointment_sources_verified',manifestSha256,pinnedFiles:appointmentStorageFiles().length,infrastructureTouched:false,sqlExecuted:false}));
  else{
   const inputs=readV2Inputs(read,names),cache=resolve(root,INBOUND_APPOINTMENT_V2_CACHE_PATH);directory(cache,true);
   for(const n of ['used.json','fixture.json','result.json'])if(fs.existsSync(resolve(cache,n)))deny();
   const runId=crypto.randomBytes(16).toString('hex');fs.writeFileSync(resolve(cache,'used.json'),JSON.stringify({runId,manifestSha256,startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
   const controller=new AbortController(),abort=()=>controller.abort();process.on('SIGINT',abort);process.on('SIGTERM',abort);
   const ports=createInboundRuntimePorts({verifySources,inputs,transport:'owned-exec-loopback',validationPlan:'appointment-storage-v2'});let result;
   try{result=await runInboundRuntimeLifecycle(ports,{runId,signal:controller.signal,validationPlan:'appointment-storage-v2'});}
   finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
   result.transport=ports.transportEvidence();
   if(result.status==='passed'&&(result.transport.admission?.loopbackVerified!==true||result.transport.shutdown?.listenerClosed!==true||result.transport.shutdown?.childrenClosed!==true||result.transport.shutdown?.socketsClosed!==true||result.transport.supervisor?.faultReason!==null))result.status='stopped';
   fs.writeFileSync(resolve(cache,'result.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;
  }
 }catch{console.error('PHONE_APPOINTMENT_STORAGE_PREFLIGHT_OR_EXECUTION_STOPPED');process.exitCode=1;}
}
