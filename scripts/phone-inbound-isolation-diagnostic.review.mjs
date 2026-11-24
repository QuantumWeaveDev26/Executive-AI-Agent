// New diagnostic scope only. Never reuses a consumed gate or grants schema/test capabilities.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {executionFiles,readInboundLocalFile} from './phone-inbound-runtime-manifest.mjs';
import {INBOUND_RUNTIME} from './phone-inbound-runtime-guard.mjs';
import {createInboundRuntimePorts} from './phone-inbound-postgres-runtime.mjs';
import {runInboundRuntimeLifecycle} from './phone-inbound-runtime-lifecycle.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const deny=()=>{throw Error('INBOUND_ISOLATION_DIAGNOSTIC_DENIED');};
const shape=Object.freeze({reviewOnly:true,purpose:'isolation-diagnostic-only',schemaExecution:false,acceptanceTests:false,fixture:INBOUND_RUNTIME});
export function verifyIsolationDiagnosticManifest(m,files,read){
 if(!m||Object.keys(m).sort().join(',')!=='acceptanceTests,files,fixture,purpose,reviewOnly,schemaExecution'||m.reviewOnly!==true||m.purpose!==shape.purpose||m.schemaExecution!==false||m.acceptanceTests!==false
  ||JSON.stringify(m.fixture)!==JSON.stringify(INBOUND_RUNTIME)||!m.files||typeof m.files!=='object'||Array.isArray(m.files)||JSON.stringify(Object.keys(m.files).sort())!==JSON.stringify([...files].sort()))deny();
 for(const p of files)if(!/^[a-f0-9]{64}$/.test(m.files[p])||hash(read(p))!==m.files[p])deny();
}
/** Capability restriction is separate from the lifecycle branch: no SQL/test member is even read. */
export function runInboundIsolationOnly(ports,{runId,signal}){
 const names=['preflight','createNetwork','createContainer','waitReady','verifyIsolation','closeConnections','inspectOwnedContainer','removeContainer','inspectOwnedNetwork','removeNetwork','verifyRemoval'];
 const restricted=Object.freeze(Object.fromEntries(names.map(k=>[k,ports[k].bind(ports)])));
 return runInboundRuntimeLifecycle(restricted,{runId,signal,isolationOnly:true});
}
const root=fileURLToPath(new URL('../',import.meta.url));
const manifestPath='docs/integrations/phone/PHONE113_ISOLATION_DIAGNOSTIC_V1.review.json';
const files=()=>[...executionFiles(root),'scripts/phone-inbound-isolation-diagnostic.review.mjs','scripts/phone-inbound-isolation-diagnostic.review.test.ts',
 'docs/integrations/phone/PHONE113_POSTGRES_ACCEPTANCE.review.json','node_modules/.cache/phone113-runtime/used.json','node_modules/.cache/phone113-runtime/result.json'].sort();
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const mode=process.argv[2],preparing=mode==='--prepare-review';
  if(preparing?process.argv.length!==3:process.argv.length!==5||process.argv[3]!=='--manifest-sha256'||!['--preflight-only','--approved-isolation-diagnostic'].includes(mode)||! /^[a-f0-9]{64}$/.test(process.argv[4]??''))deny();
  const read=p=>readInboundLocalFile(root,p);
  if(preparing){const snapshot={...shape,files:Object.fromEntries(files().map(p=>[p,hash(read(p))]))};fs.writeFileSync(resolve(root,manifestPath),JSON.stringify(snapshot,null,2)+'\n',{flag:'wx'});}
  const verifySources=()=>{const bytes=read(manifestPath);if(!preparing&&hash(bytes)!==process.argv[4])deny();verifyIsolationDiagnosticManifest(JSON.parse(bytes),files(),read);return hash(bytes);};
  const manifestSha256=verifySources();
  if(preparing||mode==='--preflight-only')console.log(JSON.stringify({status:'diagnostic_sources_verified',pinnedFiles:files().length,manifestSha256,infrastructureTouched:false,sqlExecuted:false}));
  else{
   const cache=resolve(root,'node_modules/.cache/phone113-isolation-diagnostic-v1');fs.mkdirSync(cache,{recursive:true});
   const rel=relative(fs.realpathSync(root),fs.realpathSync(cache));if(isAbsolute(rel)||rel==='..'||rel.startsWith('../')||rel.startsWith('..\\')||!fs.lstatSync(cache).isDirectory())deny();
   for(const name of ['used.json','result.json'])if(fs.existsSync(resolve(cache,name)))deny();
   const runId=crypto.randomBytes(16).toString('hex');fs.writeFileSync(resolve(cache,'used.json'),JSON.stringify({runId,manifestSha256,startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
   const controller=new AbortController(),abort=()=>controller.abort();process.on('SIGINT',abort);process.on('SIGTERM',abort);
   let result;try{result=await runInboundIsolationOnly(createInboundRuntimePorts({verifySources,inputs:undefined}),{runId,signal:controller.signal});}
   finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
   fs.writeFileSync(resolve(cache,'result.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;
  }
 }catch{console.error('INBOUND_ISOLATION_DIAGNOSTIC_STOPPED');process.exitCode=1;}
}
