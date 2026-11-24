// Preparation and source-only preflight do not execute Docker, SQL or a provider operation.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {executionFiles,readInboundLocalFile,readInboundExecutionInputs} from './phone-inbound-runtime-manifest.mjs';
import {INBOUND_APPOINTMENT_CACHE_PATH,INBOUND_HOSTED_GATE_FIXTURE} from './phone-inbound-runtime-config.mjs';
import {createInboundRuntimePorts} from './phone-inbound-postgres-runtime.mjs';
import {runInboundRuntimeLifecycle} from './phone-inbound-runtime-lifecycle.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export const APPOINTMENT_MANIFEST='docs/integrations/phone/PHONE_APPOINTMENT_STORAGE_V1.review.json';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const deny=()=>{throw Error('PHONE_APPOINTMENT_STORAGE_REVIEW_DENIED');};
const shape=Object.freeze({reviewOnly:true,purpose:'appointment-journal-postgres-acceptance',validationPlan:'appointment-storage',transport:'owned-exec-loopback',dockerPublication:'none',expectedTests:9,fixture:INBOUND_HOSTED_GATE_FIXTURE});
export function appointmentStorageCommand(args){
 if(args.length===1&&args[0]==='--prepare-review')return {mode:args[0],pin:null};
 if(args.length!==3||!['--preflight-only','--approved-appointment-storage'].includes(args[0])||args[1]!=='--manifest-sha256'||!/^[a-f0-9]{64}$/.test(args[2]??''))deny();
 return {mode:args[0],pin:args[2]};
}
// The TS import closure pins the actual endpoint transaction path and its reused Calendar dependencies.
function sourceClosure(start){
 const files=new Set();
 const visit=p=>{
  if(files.has(p))return;files.add(p);
  const source=readInboundLocalFile(root,p).toString('utf8');
  for(const match of source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g)){
   let full=resolve(root,dirname(p),match[1]);
   if(full.endsWith('.js')&&fs.existsSync(full.slice(0,-3)+'.ts'))full=full.slice(0,-3)+'.ts';
   const rel=relative(root,full).replaceAll('\\','/');
   if(isAbsolute(rel)||rel.startsWith('../')||rel.includes('/.agents/')||!fs.existsSync(full))deny();
   if(/\.(ts|mjs|json)$/.test(full))visit(rel);else deny();
  }
 };
 start.forEach(visit);return [...files];
}
export function appointmentStorageFiles(){return [...new Set([...executionFiles(root),...sourceClosure([
 'apps/api/test/phone-inbound-appointment-storage.runtime.test.ts','apps/api/src/routes/phone-inbound-appointments.ts'
 ]),'scripts/phone-appointment-storage.review.mjs','scripts/phone-appointment-storage.review.test.ts',
 'scripts/phone-inbound-fixture-relay.mjs','scripts/phone-inbound-fixture-relay.test.ts',
 'scripts/phone-inbound-preflight-diagnostics.mjs','scripts/phone-inbound-preflight-diagnostics.test.ts',
 'scripts/step1084-loopback-proxy.mjs','scripts/step1084-loopback-proxy.test.ts','scripts/phone-fixture-session.mjs','scripts/phone-fixture-session.test.ts',
 'docs/migrations/112h-phone-inbound-events.hosted-review.sql','docs/migrations/113h-phone-inbound-principals.hosted-review.sql',
 'pnpm-lock.yaml','vitest.config.ts'
 ])].sort();}
export function verifyAppointmentStorageManifest(m,files,read){
 if(!m||Object.keys(m).sort().join(',')!=='dockerPublication,expectedTests,files,fixture,purpose,reviewOnly,transport,validationPlan')deny();
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
  if(mode==='--prepare-review'){
   readInboundExecutionInputs(root);directory(dirname(resolve(root,APPOINTMENT_MANIFEST)));
   fs.writeFileSync(resolve(root,APPOINTMENT_MANIFEST),JSON.stringify({...shape,files:Object.fromEntries(appointmentStorageFiles().map(p=>[p,sha(read(p))]))},null,2)+'\n',{flag:'wx'});
  }
  const verifySources=()=>{const bytes=read(APPOINTMENT_MANIFEST);if(pin&&sha(bytes)!==pin)deny();verifyAppointmentStorageManifest(JSON.parse(bytes),appointmentStorageFiles(),read);return sha(bytes);};
  const manifestSha256=verifySources();
  if(mode!=='--approved-appointment-storage')console.log(JSON.stringify({status:'appointment_sources_verified',manifestSha256,pinnedFiles:appointmentStorageFiles().length,infrastructureTouched:false,sqlExecuted:false}));
  else{
   const inputs=readInboundExecutionInputs(root),cache=resolve(root,INBOUND_APPOINTMENT_CACHE_PATH);directory(cache,true);
   for(const n of ['used.json','fixture.json','result.json'])if(fs.existsSync(resolve(cache,n)))deny();
   const runId=crypto.randomBytes(16).toString('hex');fs.writeFileSync(resolve(cache,'used.json'),JSON.stringify({runId,manifestSha256,startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
   const controller=new AbortController(),abort=()=>controller.abort();process.on('SIGINT',abort);process.on('SIGTERM',abort);
   const ports=createInboundRuntimePorts({verifySources,inputs,transport:'owned-exec-loopback',validationPlan:'appointment-storage'});let result;
   try{result=await runInboundRuntimeLifecycle(ports,{runId,signal:controller.signal,validationPlan:'appointment-storage'});}
   finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
   result.transport=ports.transportEvidence();
   if(result.status==='passed'&&(result.transport.admission?.loopbackVerified!==true||result.transport.shutdown?.listenerClosed!==true||result.transport.shutdown?.childrenClosed!==true||result.transport.shutdown?.socketsClosed!==true||result.transport.supervisor?.faultReason!==null))result.status='stopped';
   fs.writeFileSync(resolve(cache,'result.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;
  }
 }catch{console.error('PHONE_APPOINTMENT_STORAGE_PREFLIGHT_OR_EXECUTION_STOPPED');process.exitCode=1;}
}
