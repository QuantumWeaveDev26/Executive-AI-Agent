// Local checksum preparation/check ONLY. No SQL, imports of database constructors, network or execution gates.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,relative} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),mode=process.argv[2];
if(process.argv.length!==3||!['--write','--check'].includes(mode))throw Error('Use --write or --check');
const digest=path=>createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex');
const walk=path=>readdirSync(resolve(root,path),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path+'/'+e.name):[path+'/'+e.name]);
const explicit=['scripts/prepare-phone-inbound-event-acceptance.mjs','scripts/phone-inbound-event-memory.review.ps1','vitest.config.ts','pnpm-lock.yaml',
 'package.json','pnpm-workspace.yaml','apps/api/package.json','apps/api/tsconfig.json',
 'apps/api/test/phone-inbound-event-acceptance.test.ts','apps/api/src/services/phone-inbound-event-store.ts','apps/api/src/services/phone-inbound-reports.ts','apps/api/src/services/phone-inbound-events.ts',
 'docs/migrations/112-phone-inbound-events.review.sql'];
const base=walk('packages/db/src/migrations').filter(p=>p.endsWith('.sql')).sort();
if(base.length!==12)throw Error('PHONE112_BASE_MIGRATION_SET_CHANGED');
const workspacePackages=['db','contracts','observability','config'];
const runtime=workspacePackages.flatMap(name=>['packages/'+name+'/package.json',...walk('packages/'+name+'/dist').filter(p=>p.endsWith('.js'))]);
const paths=[...new Set([...explicit,...base,...runtime])].sort();
const manifest={reviewOnly:true,executionAuthorized:false,environment:'new-in-memory-PGlite-only',baseMigrationCount:base.length,
 acceptanceTests:8,realPostgresMultiConnectionTest:false,providerRequests:0,files:Object.fromEntries(paths.map(p=>[p,digest(p)]))};
const path=resolve(root,'docs/integrations/phone/PHONE112_IN_MEMORY_APPROVAL.review.json'),text=JSON.stringify(manifest,null,2)+'\n';
if(mode==='--write')writeFileSync(path,text);else if(readFileSync(path,'utf8')!==text)throw Error('PHONE112_APPROVAL_ARTIFACT_MISMATCH');
console.log(JSON.stringify({status:mode==='--write'?'prepared_not_authorized':'verified',manifest:relative(root,path),pinnedFiles:paths.length,sqlExecuted:false,providerRequests:0}));
