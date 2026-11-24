// NEW opt-in fixture transport. No execution without exact approval-mode/hash and an unused NEW marker.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {executionFiles,readInboundLocalFile,readInboundExecutionInputs} from './phone-inbound-runtime-manifest.mjs';
import {INBOUND_RUNTIME} from './phone-inbound-runtime-guard.mjs';
import {INBOUND_HOSTED_GATE_CACHE_PATH,INBOUND_HOSTED_GATE_FIXTURE} from './phone-inbound-runtime-config.mjs';
import {createInboundRuntimePorts} from './phone-inbound-postgres-runtime.mjs';
import {runInboundRuntimeLifecycle} from './phone-inbound-runtime-lifecycle.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifestPath='docs/integrations/phone/PHONE113_HOSTED_GATE_VALIDATION_V1.review.json';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const deny=()=>{throw Error('INBOUND_OWNED_RELAY_REVIEW_DENIED');};
const shape=Object.freeze({reviewOnly:true,purpose:'hosted-install-gate-validation',transport:'owned-exec-loopback',dockerPublication:'none',validationPlan:'hosted-gates',fixture:INBOUND_HOSTED_GATE_FIXTURE,expectedTests:9});
export function ownedRelayCommand(args){
 if(args.length===1&&args[0]==='--prepare-review')return {mode:args[0],pin:null};
 if(args.length!==3||!['--preflight-only','--approved-hosted-gates'].includes(args[0])||args[1]!=='--manifest-sha256'||! /^[a-f0-9]{64}$/.test(args[2]??''))deny();
 return {mode:args[0],pin:args[2]};
}
export function verifyOwnedRelayManifest(m,files,read){
 if(!m||Object.keys(m).sort().join(',')!=='dockerPublication,expectedTests,files,fixture,purpose,reviewOnly,transport,validationPlan'||m.reviewOnly!==true||m.purpose!==shape.purpose||m.validationPlan!=='hosted-gates'||m.transport!==shape.transport||m.dockerPublication!=='none'||m.expectedTests!==9
  ||JSON.stringify(m.fixture)!==JSON.stringify(INBOUND_HOSTED_GATE_FIXTURE)||!m.files||typeof m.files!=='object'||Array.isArray(m.files)||JSON.stringify(Object.keys(m.files).sort())!==JSON.stringify([...files].sort()))deny();
 for(const p of files)if(!/^[a-f0-9]{64}$/.test(m.files[p])||hash(read(p))!==m.files[p])deny();
}
export function ownedRelayFiles(){return [...new Set([...executionFiles(root),
 'scripts/phone-inbound-hosted-gates.review.mjs','scripts/phone-inbound-hosted-gates.review.test.ts','scripts/phone-inbound-fixture-relay.mjs','scripts/phone-inbound-fixture-relay.test.ts',
 'apps/api/test/phone-inbound-hosted-gates.runtime.test.ts',
 'scripts/phone-inbound-hosted-install-review.mjs','scripts/phone-inbound-hosted-install-review.test.ts',
 'docs/migrations/112h-phone-inbound-events.hosted-review.sql','docs/migrations/113h-phone-inbound-principals.hosted-review.sql',
 'docs/integrations/phone/INBOUND_HOSTED_INSTALL_REVIEW_2026-11-04.json',
 'node_modules/.cache/phone113-owned-relay-v2/used.json','node_modules/.cache/phone113-owned-relay-v2/result.json',
 'node_modules/.cache/phone-inbound-host-inventory-v1.used.json','node_modules/.cache/phone-inbound-host-inventory-v1.result.json','node_modules/.cache/phone-inbound-host-inventory-v1.cleanup.json',
 'scripts/phone-inbound-preflight-diagnostics.mjs','scripts/phone-inbound-preflight-diagnostics.test.ts',
 'node_modules/.cache/phone113-owned-relay-v1/used.json','node_modules/.cache/phone113-owned-relay-v1/result.json',
 'node_modules/.cache/phone113-preflight-readonly-v1.used.json','node_modules/.cache/phone113-preflight-readonly-v1.result.json',
 'node_modules/.cache/phone113-connection-diagnostic-20261104.json','node_modules/.cache/phone113-reviewed-access-check-20261104.json',
 'scripts/step1084-loopback-proxy.mjs','scripts/step1084-loopback-proxy.test.ts','scripts/phone-fixture-session.mjs','scripts/phone-fixture-session.test.ts',
 'docs/integrations/phone/PHONE113_POSTGRES_ACCEPTANCE.review.json','docs/integrations/phone/PHONE113_ISOLATION_DIAGNOSTIC_V1.review.json',
 'node_modules/.cache/phone113-runtime/used.json','node_modules/.cache/phone113-runtime/result.json',
 'node_modules/.cache/phone113-isolation-diagnostic-v1/used.json','node_modules/.cache/phone113-isolation-diagnostic-v1/result.json'
])].sort();}
function containedDirectory(path,create=false){
 const base=fs.realpathSync(root),parent=fs.realpathSync(dirname(path)),parentRel=relative(base,parent);
 if(isAbsolute(parentRel)||parentRel==='..'||parentRel.startsWith('../')||parentRel.startsWith('..\\'))deny();
 if(create&&!fs.existsSync(path))fs.mkdirSync(path);
 const actual=fs.realpathSync(path),rel=relative(base,actual);if(isAbsolute(rel)||rel==='..'||rel.startsWith('../')||rel.startsWith('..\\')||!fs.lstatSync(path).isDirectory())deny();
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const {mode,pin}=ownedRelayCommand(process.argv.slice(2)),read=p=>readInboundLocalFile(root,p);
  if(mode==='--prepare-review'){
   readInboundExecutionInputs(root);containedDirectory(dirname(resolve(root,manifestPath)));
   fs.writeFileSync(resolve(root,manifestPath),JSON.stringify({...shape,files:Object.fromEntries(ownedRelayFiles().map(p=>[p,hash(read(p))]))},null,2)+'\n',{flag:'wx'});
  }
  const verifySources=()=>{const bytes=read(manifestPath);if(pin&&hash(bytes)!==pin)deny();verifyOwnedRelayManifest(JSON.parse(bytes),ownedRelayFiles(),read);return hash(bytes);};
  const manifestSha256=verifySources();
  if(mode!=='--approved-hosted-gates')console.log(JSON.stringify({status:'owned_relay_sources_verified',pinnedFiles:ownedRelayFiles().length,manifestSha256,infrastructureTouched:false,sqlExecuted:false}));
  else{
   const inputs=readInboundExecutionInputs(root),cache=resolve(root,INBOUND_HOSTED_GATE_CACHE_PATH);containedDirectory(cache,true);
   for(const name of ['used.json','fixture.json','result.json'])if(fs.existsSync(resolve(cache,name)))deny();
   const runId=crypto.randomBytes(16).toString('hex');fs.writeFileSync(resolve(cache,'used.json'),JSON.stringify({runId,manifestSha256,startedAt:new Date().toISOString(),transport:'owned-exec-loopback'}),{flag:'wx',mode:0o600});
   const controller=new AbortController(),abort=()=>controller.abort();process.on('SIGINT',abort);process.on('SIGTERM',abort);
   const ports=createInboundRuntimePorts({verifySources,inputs,transport:'owned-exec-loopback',validationPlan:'hosted-gates'});let result;
   try{result=await runInboundRuntimeLifecycle(ports,{runId,signal:controller.signal,validationPlan:'hosted-gates'});}
   finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
   result.transport=ports.transportEvidence();
   if(result.status==='passed'&&(result.transport.admission?.loopbackVerified!==true||result.transport.shutdown?.listenerClosed!==true||result.transport.shutdown?.childrenClosed!==true||result.transport.shutdown?.socketsClosed!==true||result.transport.supervisor?.faultReason!==null))result.status='stopped';
   fs.writeFileSync(resolve(cache,'result.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;
  }
 }catch{console.error('INBOUND_OWNED_RELAY_PREFLIGHT_OR_EXECUTION_STOPPED');process.exitCode=1;}
}
