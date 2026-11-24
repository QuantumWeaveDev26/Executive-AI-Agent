// PREPARATION ONLY unless a new exact owner-approved checksum and one-use flag are supplied.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {executionFiles,readInboundLocalFile} from './phone-inbound-runtime-manifest.mjs';
import {INBOUND_HOSTED_GATE_FIXTURE,INBOUND_F03_REFERENCE_CACHE_PATH} from './phone-inbound-runtime-config.mjs';
import {createInboundRuntimePorts} from './phone-inbound-postgres-runtime.mjs';
import {runInboundRuntimeLifecycle} from './phone-inbound-runtime-lifecycle.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export const F03_REFERENCE_MANIFEST='docs/integrations/phone/PHONE_F03_REFERENCE_V3.review.json';
const contractPath='docs/integrations/phone/F03_EFFECTIVE_SOURCE_CONTRACT_2026-11-04.json';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const deny=()=>{throw Error('F03_REFERENCE_REVIEW_DENIED');};
const shape={reviewOnly:true,productionAdmission:false,plan:'f03-reference-capture',expectedChecks:3,fixture:INBOUND_HOSTED_GATE_FIXTURE,sql114Included:false,extensionProvenanceRequired:true};
export function referenceCommand(args){
 if(args.length===1&&args[0]==='--prepare-review')return {mode:args[0],pin:null};
 if(args.length!==3||!['--preflight-only','--approved-isolated-f03-reference'].includes(args[0])||args[1]!=='--manifest-sha256'||! /^[a-f0-9]{64}$/.test(args[2]??''))deny();
 return {mode:args[0],pin:args[2]};
}
export function referenceInputs(read,names){
 const contract=JSON.parse(read(contractPath));
 if(contract.sources?.length!==14||contract.statementCount!==864||contract.expectedCatalog!==null||contract.productionAdmission!==false)deny();
 const snapshot=new Map();
 for(const source of contract.sources){const bytes=Buffer.from(read(source.path));if(sha(bytes)!==source.sha256)deny();snapshot.set(source.path,bytes.toString('utf8'));}
 const base=contract.sources.filter(s=>s.path.startsWith('packages/db/src/migrations/')).sort((a,b)=>a.path.localeCompare(b.path));
 if(base.length!==12||JSON.stringify(base.map(s=>s.path.split('/').at(-1)).sort())!==JSON.stringify([...names].sort()))deny();
 return {base:base.map(s=>{const name=s.path.split('/').at(-1),sql=snapshot.get(s.path);return {name,version:name.slice(0,4),sql,checksum:sha(sql.trim())};})};
}
export function referenceExecutionClosure(read,roots){
 const files=new Set();
 const visit=p=>{
  if(files.has(p))return;files.add(p);const source=read(p).toString('utf8');
  for(const m of source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g)){
   const path=relative(root,resolve(root,dirname(p),m[1])).replaceAll('\\','/');
   if(isAbsolute(path)||path==='..'||path.startsWith('../')||path.startsWith('.agents/')||! /\.(mjs|js|ts|json)$/.test(path))deny();visit(path);
  }
 };roots.forEach(visit);return [...files].sort();
}
export function sanitizeReferenceFailure(phase,error){
 if(!['environment','install112','catalog112','install113','catalog113'].includes(phase))deny();
 const code=error?.code;const sqlState=typeof code==='string'&&/^[0-9A-Z]{5}$/.test(code)?code:null;
 return {phase,sqlState,category:sqlState?'postgresql_error':'validation_or_transport_error'};
}
export function referenceFiles(){
 const contract=JSON.parse(readInboundLocalFile(root,contractPath));
 const closure=referenceExecutionClosure(p=>readInboundLocalFile(root,p),['scripts/phone-f03-reference.review.mjs','apps/api/test/phone-f03-reference.runtime.test.ts']);
 return [...new Set([...executionFiles(root),...closure,...contract.sources.map(s=>s.path),contractPath,
 'scripts/phone-f03-reference.review.mjs','scripts/phone-f03-reference.review.test.ts',
 'apps/api/test/phone-f03-reference.runtime.test.ts','docs/integrations/phone/F03_PG16_CATALOG_QUERY.review.sql',
 'docs/integrations/phone/F03_PG16_EXTENSION_PROVENANCE.review.sql',
 'scripts/phone-schema-dependency-evidence.test.ts','docs/integrations/phone/F03_MIGRATOR_BOOTSTRAP.review.json'
 ])].sort();
}
export function verifyReferenceManifest(manifest,files,read){
 if(!manifest||Object.keys(manifest).sort().join(',')!==[...Object.keys(shape),'files'].sort().join(','))deny();
 for(const [k,v]of Object.entries(shape))if(JSON.stringify(manifest[k])!==JSON.stringify(v))deny();
 if(!manifest.files||JSON.stringify(Object.keys(manifest.files).sort())!==JSON.stringify([...files].sort()))deny();
 for(const p of files)if(!/^[a-f0-9]{64}$/.test(manifest.files[p])||sha(read(p))!==manifest.files[p])deny();
 return true;
}
function cacheDirectory(){
 const path=resolve(root,INBOUND_F03_REFERENCE_CACHE_PATH),base=fs.realpathSync(root),parent=fs.realpathSync(dirname(path));
 if(parent!==resolve(base,'node_modules/.cache'))deny();
 if(!fs.existsSync(path))fs.mkdirSync(path,{mode:0o700});
 if(fs.lstatSync(path).isSymbolicLink()||fs.realpathSync(path)!==resolve(base,INBOUND_F03_REFERENCE_CACHE_PATH)||fs.readdirSync(path).length)deny();
 const rel=relative(base,path);if(isAbsolute(rel)||rel.startsWith('..'))deny();return path;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const {mode,pin}=referenceCommand(process.argv.slice(2)),read=p=>readInboundLocalFile(root,p),files=referenceFiles();
  const names=fs.readdirSync(resolve(root,'packages/db/src/migrations')).filter(n=>n.endsWith('.sql'));
  const inputs=referenceInputs(read,names);
  if(mode==='--prepare-review')fs.writeFileSync(resolve(root,F03_REFERENCE_MANIFEST),JSON.stringify({...shape,files:Object.fromEntries(files.map(p=>[p,sha(read(p))]))},null,2)+'\n',{flag:'wx'});
  const verifySources=()=>{const bytes=read(F03_REFERENCE_MANIFEST);if(pin&&sha(bytes)!==pin)deny();verifyReferenceManifest(JSON.parse(bytes),files,read);return sha(bytes);};
  const manifestSha256=verifySources();
  if(mode!=='--approved-isolated-f03-reference')console.log(JSON.stringify({status:'reference_sources_verified_only',manifestSha256,pinnedFiles:files.length,sqlExecuted:false,infrastructureTouched:false}));
  else{
   const cache=cacheDirectory(),runId=crypto.randomBytes(16).toString('hex');
   fs.writeFileSync(resolve(cache,'used.json'),JSON.stringify({runId,manifestSha256}),{flag:'wx',mode:0o600});
   const controller=new AbortController(),abort=()=>controller.abort();process.on('SIGINT',abort);process.on('SIGTERM',abort);
   const ports=createInboundRuntimePorts({verifySources,inputs,transport:'owned-exec-loopback',validationPlan:shape.plan,referenceManifestSha256:manifestSha256});let result;
   try{result=await runInboundRuntimeLifecycle(ports,{runId,signal:controller.signal,validationPlan:shape.plan});}
   finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
   result.transport=ports.transportEvidence();
   if(result.status==='passed'&&(result.transport.admission?.loopbackVerified!==true||result.transport.shutdown?.listenerClosed!==true||result.transport.shutdown?.childrenClosed!==true||result.transport.shutdown?.socketsClosed!==true||result.transport.supervisor?.faultReason!==null))result.status='stopped';
   result.productionAdmission=false;result.expectedCatalogApproved=false;
   fs.writeFileSync(resolve(cache,'result.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;
  }
 }catch{console.error('F03_REFERENCE_PREFLIGHT_OR_EXECUTION_STOPPED');process.exitCode=1;}
}
