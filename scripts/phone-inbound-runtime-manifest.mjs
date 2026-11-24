import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {INBOUND_REVIEW_FILES,verifyInboundReview} from './phone-inbound-release-preflight.mjs';
import {INBOUND_RUNTIME} from './phone-inbound-runtime-guard.mjs';
import {deriveInboundRuntimeSql,INBOUND_SQL_SOURCES} from './phone-inbound-runtime-sql.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('INBOUND_EXECUTION_MANIFEST_DENIED');};
export function readInboundLocalFile(root,path){
 const base=fs.realpathSync(root),target=resolve(base,path);if(!fs.lstatSync(target).isFile())fail();
 const actual=fs.realpathSync(target),rel=relative(base,actual);if(isAbsolute(rel)||rel==='..'||rel.startsWith('../')||rel.startsWith('..\\'))fail();return fs.readFileSync(actual);
}
export function executionFiles(root){
 const walk=p=>fs.readdirSync(resolve(root,p),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p+'/'+e.name):[p+'/'+e.name]);
 const dependencies=['db','contracts','observability','config','policy'].flatMap(p=>[...walk('packages/'+p+'/src'),...walk('packages/'+p+'/dist'),'packages/'+p+'/package.json']).filter(p=>/\.(js|ts|json)$/.test(p));
 return [...new Set([...INBOUND_REVIEW_FILES,...dependencies,
  ...['guard','guard.test','config','config.test','lifecycle','lifecycle.test','sql','sql.test','manifest','manifest.test','child','child.test','ports.test'].map(n=>'scripts/phone-inbound-runtime-'+n+(n.endsWith('.test')?'.ts':'.mjs')),
  'scripts/phone-inbound-postgres-runtime.mjs','apps/api/test/phone-inbound-postgres.runtime.test.ts','apps/api/src/services/phone-inbound-event-store.ts',
  'scripts/phone-runtime-guard.mjs',
  INBOUND_SQL_SOURCES[112].candidate,INBOUND_SQL_SOURCES[113].candidate,
  'docs/integrations/phone/INBOUND_RELEASE_REVIEW_2026-11-04.json'
 ])].sort();
}
const shape={reviewOnly:true,environment:'one-new-isolated-local-postgres16-only',expectedTests:9,fixture:INBOUND_RUNTIME};
export function verifyInboundExecutionManifest(m,files,read){
 if(!m||Object.keys(m).sort().join(',')!=='environment,expectedTests,files,fixture,reviewOnly'||m.reviewOnly!==true||m.environment!==shape.environment||m.expectedTests!==9
  ||JSON.stringify(m.fixture)!==JSON.stringify(INBOUND_RUNTIME)||!m.files||typeof m.files!=='object'||Array.isArray(m.files)
  ||JSON.stringify(Object.keys(m.files).sort())!==JSON.stringify([...files].sort()))fail();
 for(const p of files)if(!/^[a-f0-9]{64}$/.test(m.files[p])||hash(read(p))!==m.files[p])fail();
}
export function readInboundExecutionInputs(root){
 const read=p=>readInboundLocalFile(root,p),names=fs.readdirSync(resolve(root,'packages/db/src/migrations')).filter(n=>n.endsWith('.sql'));
 verifyInboundReview(JSON.parse(read('docs/integrations/phone/INBOUND_RELEASE_REVIEW_2026-11-04.json')),read,names);
 const base=INBOUND_REVIEW_FILES.filter(p=>p.startsWith('packages/db/src/migrations/')).sort().map(path=>{const name=path.split('/').pop(),sql=read(path).toString('utf8');return {name,version:name.slice(0,4),sql,checksum:hash(sql.trim())};});
 const candidates=[112,113].map(step=>{const e=INBOUND_SQL_SOURCES[step],candidate=read(e.candidate).toString('utf8');if(candidate!==deriveInboundRuntimeSql(step,read(e.path).toString('utf8')))fail();return candidate;});
 return {base,journal:candidates[0],principal:candidates[1]};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3||!['--prepare','--check'].includes(process.argv[2]))fail();
  const root=fileURLToPath(new URL('../',import.meta.url)),path=resolve(root,'docs/integrations/phone/PHONE113_POSTGRES_ACCEPTANCE.review.json');
  readInboundExecutionInputs(root);const files=executionFiles(root),read=p=>readInboundLocalFile(root,p);
  if(process.argv[2]==='--prepare')fs.writeFileSync(path,JSON.stringify({...shape,files:Object.fromEntries(files.map(p=>[p,hash(read(p))]))},null,2)+'\n',{flag:'wx'});
  const bytes=fs.readFileSync(path);verifyInboundExecutionManifest(JSON.parse(bytes),files,read);console.log(JSON.stringify({status:'execution_sources_reviewed_only',pinnedFiles:files.length,manifestSha256:hash(bytes),databaseStarted:false}));
 }catch{console.error('INBOUND_EXECUTION_MANIFEST_STOPPED');process.exitCode=1;}
}
