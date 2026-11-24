// Separate, one-use approval: metadata/availability only; never invoke lifecycle/resource/SQL ports.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ownedRelayFiles} from './phone-inbound-owned-relay.review.mjs';
import {readInboundLocalFile} from './phone-inbound-runtime-manifest.mjs';
import {createInboundRuntimePorts} from './phone-inbound-postgres-runtime.mjs';
import {readPreflightDiagnostic} from './phone-inbound-preflight-diagnostics.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest='docs/integrations/phone/PHONE113_PREFLIGHT_READONLY_V1.review.json';
const receipt='node_modules/.cache/phone113-preflight-readonly-v1';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const deny=()=>{throw Error('INBOUND_READONLY_PREFLIGHT_DENIED');};
const files=()=>[...new Set([...ownedRelayFiles(),'scripts/phone-inbound-preflight-diagnostics.mjs','scripts/phone-inbound-preflight-diagnostics.test.ts','scripts/phone-inbound-preflight-readonly.review.mjs','scripts/phone-inbound-preflight-readonly.review.test.ts'])].sort();
function safeParent(path){const base=fs.realpathSync(root),parent=fs.realpathSync(dirname(resolve(root,path))),r=relative(base,parent);if(isAbsolute(r)||r==='..'||r.startsWith('../')||r.startsWith('..\\'))deny();}
export function readOnlyPreflightCommand(args){
 if(args.length===1&&args[0]==='--prepare-review')return {mode:args[0],pin:null};
 if(args.length!==3||!['--verify-sources-only','--approved-readonly-preflight'].includes(args[0])||args[1]!=='--manifest-sha256'||! /^[a-f0-9]{64}$/.test(args[2]??''))deny();
 return {mode:args[0],pin:args[2]};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const {mode,pin}=readOnlyPreflightCommand(process.argv.slice(2)),read=p=>readInboundLocalFile(root,p);
  if(mode==='--prepare-review'){safeParent(manifest);fs.writeFileSync(resolve(root,manifest),JSON.stringify({reviewOnly:true,purpose:'local-readonly-preflight',files:Object.fromEntries(files().map(p=>[p,hash(read(p))]))},null,2)+'\n',{flag:'wx'});}
  const verifySources=()=>{const bytes=read(manifest),m=JSON.parse(bytes);if(pin&&hash(bytes)!==pin)deny();if(Object.keys(m).sort().join(',')!=='files,purpose,reviewOnly'||m.reviewOnly!==true||m.purpose!=='local-readonly-preflight'||JSON.stringify(Object.keys(m.files??{}).sort())!==JSON.stringify(files()))deny();for(const p of files())if(hash(read(p))!==m.files[p])deny();return hash(bytes);};
  const manifestSha256=verifySources();
  if(mode!=='--approved-readonly-preflight')console.log(JSON.stringify({status:'sources_verified',manifestSha256,pinnedFiles:files().length,operationsExecuted:false}));
  else{
   const used=receipt+'.used.json',resultPath=receipt+'.result.json';safeParent(used);safeParent(resultPath);
   if(fs.existsSync(resolve(root,used))||fs.existsSync(resolve(root,resultPath)))deny();
   fs.writeFileSync(resolve(root,used),JSON.stringify({manifestSha256,startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
   let result;try{
    const ports=createInboundRuntimePorts({verifySources,inputs:{},transport:'owned-exec-loopback'}),p=await ports.preflight();
    result={status:'passed',sourceIntegrity:p.reviewIntegrity===true,localEngine:p.localEngine===true,portAvailable:p.portAvailable===true,resourceNamesAvailable:p.existingResources===false,imageIdentityValid:/^sha256:[a-f0-9]{64}$/.test(p.imageId),diagnostic:null};
   }catch(error){result={status:'stopped',diagnostic:readPreflightDiagnostic(error)};}
   // No resource creation/removal, SQL, provider or relay method is called.
   fs.writeFileSync(resolve(root,resultPath),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;
  }
 }catch{console.error('INBOUND_READONLY_PREFLIGHT_DENIED');process.exitCode=1;}
}
