// Source preparation is database-free. New SQL/infrastructure requires this separate pinned approval.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {executionFiles,readInboundLocalFile} from './phone-inbound-runtime-manifest.mjs';
import {referenceInputs,referenceExecutionClosure} from './phone-f03-reference.review.mjs';
import {INBOUND_HOSTED_GATE_FIXTURE,INBOUND_LEDGER_WRITE_FENCE_CACHE_PATH as cachePath,INBOUND_LEDGER_WRITE_FENCE_MANIFEST_PATH as manifestPath} from './phone-inbound-runtime-config.mjs';
import {createInboundRuntimePorts} from './phone-inbound-postgres-runtime.mjs';
import {runInboundRuntimeLifecycle} from './phone-inbound-runtime-lifecycle.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const deny=()=>{throw Error('PHONE_LEDGER_WRITE_FENCE_DENIED');};
const shape={reviewOnly:true,productionAdmission:false,plan:'ledger-write-fence',expectedChecks:4,fixture:INBOUND_HOSTED_GATE_FIXTURE,sqlCandidate:'docs/migrations/phone-schema-migrations-write-fence.review.sql'};
export function ledgerCommand(args){
 if(args.length===1&&args[0]==='--prepare-review')return {mode:args[0],pin:null};
 if(args.length!==3||!['--preflight-only','--approved-isolated-ledger-write-fence'].includes(args[0])||args[1]!=='--manifest-sha256'||! /^[a-f0-9]{64}$/.test(args[2]??''))deny();return {mode:args[0],pin:args[2]};
}
export function ledgerFiles(){
 const read=p=>readInboundLocalFile(root,p),contract=JSON.parse(read('docs/integrations/phone/F03_EFFECTIVE_SOURCE_CONTRACT_2026-11-04.json'));
 return [...new Set([...executionFiles(root),...referenceExecutionClosure(read,['scripts/phone-ledger-write-fence.review.mjs','apps/api/test/phone-migration-ledger-fence.runtime.test.ts']),
  ...contract.sources.map(s=>s.path),'docs/integrations/phone/F03_EFFECTIVE_SOURCE_CONTRACT_2026-11-04.json',shape.sqlCandidate,
  'scripts/phone-migration-ledger-fence.test.ts','scripts/phone-ledger-write-fence.review.test.ts'
 ])].sort();
}
export function verifyLedgerManifest(m,files,read){
 if(!m||Object.keys(m).sort().join(',')!==[...Object.keys(shape),'files'].sort().join(','))deny();
 for(const [k,v]of Object.entries(shape))if(JSON.stringify(m[k])!==JSON.stringify(v))deny();
 if(!m.files||JSON.stringify(Object.keys(m.files).sort())!==JSON.stringify([...files].sort()))deny();
 for(const p of files)if(!/^[a-f0-9]{64}$/.test(m.files[p])||sha(read(p))!==m.files[p])deny();return true;
}
function newCache(){
 const path=resolve(root,cachePath),base=fs.realpathSync(root);if(fs.realpathSync(dirname(path))!==resolve(base,'node_modules/.cache'))deny();
 if(!fs.existsSync(path))fs.mkdirSync(path,{mode:0o700});
 if(fs.lstatSync(path).isSymbolicLink()||fs.realpathSync(path)!==resolve(base,cachePath)||fs.readdirSync(path).length)deny();return path;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const {mode,pin}=ledgerCommand(process.argv.slice(2)),read=p=>readInboundLocalFile(root,p),files=ledgerFiles();
  const names=fs.readdirSync(resolve(root,'packages/db/src/migrations')).filter(n=>n.endsWith('.sql')),inputs=referenceInputs(read,names);
  if(mode==='--prepare-review')fs.writeFileSync(resolve(root,manifestPath),JSON.stringify({...shape,files:Object.fromEntries(files.map(p=>[p,sha(read(p))]))},null,2)+'\n',{flag:'wx'});
  const verifySources=()=>{const bytes=read(manifestPath);if(pin&&sha(bytes)!==pin)deny();verifyLedgerManifest(JSON.parse(bytes),files,read);return sha(bytes);};const manifestSha256=verifySources();
  if(mode!=='--approved-isolated-ledger-write-fence')console.log(JSON.stringify({status:'ledger_sources_verified_only',manifestSha256,pinnedFiles:files.length,sqlExecuted:false,infrastructureTouched:false}));
  else{
   const cache=newCache(),runId=crypto.randomBytes(16).toString('hex');fs.writeFileSync(resolve(cache,'used.json'),JSON.stringify({runId,manifestSha256}),{flag:'wx',mode:0o600});
   const controller=new AbortController(),abort=()=>controller.abort();process.on('SIGINT',abort);process.on('SIGTERM',abort);
   const ports=createInboundRuntimePorts({verifySources,inputs,transport:'owned-exec-loopback',validationPlan:shape.plan,referenceManifestSha256:manifestSha256});let result;
   try{result=await runInboundRuntimeLifecycle(ports,{runId,signal:controller.signal,validationPlan:shape.plan});}
   finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
   result.transport=ports.transportEvidence();
   if(result.status==='passed'&&(result.transport.admission?.loopbackVerified!==true||result.transport.shutdown?.listenerClosed!==true||result.transport.shutdown?.childrenClosed!==true||result.transport.shutdown?.socketsClosed!==true||result.transport.supervisor?.faultReason!==null))result.status='stopped';
   result.productionAdmission=false;result.productionSqlApplied=false;
   fs.writeFileSync(resolve(cache,'result.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;
  }
 }catch{console.error('PHONE_LEDGER_PREFLIGHT_OR_EXECUTION_STOPPED');process.exitCode=1;}
}
