// Review integrity ONLY: no environment credentials, database/Docker/SSH/provider operations or execution gate.
import {readFileSync,writeFileSync,readdirSync,realpathSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const baseNames=[
 '0001_initial_schema.sql','0002_rls_policies.sql','0003_plans_and_receipts.sql','0004_context_and_memory.sql',
 '0005_task003_runtime_fixes.sql','0006_task003_procedure_hardening.sql','0007_task003_token_bound_auxiliary_rls.sql',
 '0008_task003_assistant_stream_lifecycle.sql','0009_task003_privacy_purge_and_outbox_hardening.sql',
 '0010_task003_purge_recovery_after_claim.sql','0011_task003_purge_recovery_hardening.sql','0012_task004_governed_capabilities_and_personas.sql'
];
export const INBOUND_REVIEW_FILES=Object.freeze([
 ...baseNames.map(n=>'packages/db/src/migrations/'+n),
 'docs/migrations/112-phone-inbound-events.review.sql','docs/migrations/113-phone-inbound-principals.review.sql',
 ...['phone-inbound-principal','phone-inbound-principal-postgres','phone-inbound-principal-journal','phone-inbound-events',
  'phone-inbound-reports','phone-inbound-diagnostics','phone-inbound-ingress','phone-sarvam-inbound-normalize','phone-sarvam-inbound-service'].map(n=>'apps/api/src/services/'+n+'.ts'),
 'apps/api/src/routes/phone-inbound-workflow.ts','apps/api/test/phone-sarvam-inbound-service.test.ts',
 'apps/api/test/phone-inbound-ingress.test.ts','apps/api/test/phone-inbound-workflow-routes.test.ts',
 'scripts/phone-inbound-release-preflight.mjs','scripts/phone-inbound-release-preflight.test.ts',
 'docs/integrations/phone/INBOUND_PRODUCTION_AND_DATABASE_REVIEW_2026-11-04.md',
 'package.json','apps/api/package.json','packages/db/package.json','pnpm-lock.yaml','vitest.config.ts'
].sort());
const shape=Object.freeze({schemaVersion:1,reviewOnly:true,executionAllowed:false,productionReady:false});
const hash=data=>createHash('sha256').update(data).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=code=>{throw Error(code);};
export function makeInboundReview(read){
 return {...shape,files:Object.fromEntries(INBOUND_REVIEW_FILES.map(p=>[p,hash(read(p))]))};
}
export function verifyInboundReview(manifest,read,actualBaseNames){
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)
  ||!equal(Object.keys(manifest).sort(),[...Object.keys(shape),'files'].sort())
  ||Object.entries(shape).some(([k,v])=>manifest[k]!==v)
  ||!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files)
  ||!equal(Object.keys(manifest.files).sort(),INBOUND_REVIEW_FILES))fail('INBOUND_REVIEW_MANIFEST_INVALID');
 if(!Array.isArray(actualBaseNames)||!equal([...actualBaseNames].sort(),[...baseNames].sort()))fail('INBOUND_REVIEW_BASE_SET_CHANGED');
 for(const p of INBOUND_REVIEW_FILES){
  if(!/^[a-f0-9]{64}$/.test(manifest.files[p])||hash(read(p))!==manifest.files[p])fail('INBOUND_REVIEW_SOURCE_CHANGED');
 }
 return {status:'review_integrity_verified',pinnedFiles:INBOUND_REVIEW_FILES.length,executionAllowed:false,productionReady:false,sqlExecuted:false,providerRequests:0};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3||!['--prepare-review','--verify-review-only'].includes(process.argv[2]))fail('INBOUND_REVIEW_COMMAND_INVALID');
  const root=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),'..'));
  const inside=p=>{const rel=relative(root,p);if(rel==='..'||rel.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(rel))fail('INBOUND_REVIEW_PATH_DENIED');return p;};
  const read=p=>{const target=resolve(root,p);if(!lstatSync(target).isFile())fail('INBOUND_REVIEW_FILE_INVALID');return readFileSync(inside(realpathSync(target)));};
  const artifact='docs/integrations/phone/INBOUND_RELEASE_REVIEW_2026-11-04.json';
  if(process.argv[2]==='--prepare-review'){
   inside(realpathSync(dirname(resolve(root,artifact))));
   writeFileSync(resolve(root,artifact),JSON.stringify(makeInboundReview(read),null,2)+'\n',{flag:'wx'});
  }
  const manifest=JSON.parse(read(artifact).toString('utf8'));
  console.log(JSON.stringify(verifyInboundReview(manifest,read,readdirSync(inside(realpathSync(resolve(root,'packages/db/src/migrations')))).filter(n=>n.endsWith('.sql')))));
 }catch{
  console.error('INBOUND_REVIEW_PREFLIGHT_FAILED');process.exitCode=1;
 }
}
