import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
// Executes only inside the image builder. No SQL, credentials or networking.
const target='/out/apps/api';
if(process.platform!=='linux'||!fs.existsSync('/src/pnpm-lock.yaml'))throw Error('Linux image builder required');
function ensureBuilt(source,destination){
 if(!fs.existsSync(destination)){fs.cpSync(source,destination,{recursive:true});return;}
 // pnpm can already have copied/hardlinked these files. Never copy a hardlink
 // onto itself; verify it is the current compiled output instead.
 for(const entry of fs.readdirSync(source,{withFileTypes:true})){
  const from=path.join(source,entry.name),to=path.join(destination,entry.name);
  if(entry.isDirectory())ensureBuilt(from,to);
  else if(!entry.isFile()||!fs.existsSync(to)||createHash('sha256').update(fs.readFileSync(from)).digest('hex')!==createHash('sha256').update(fs.readFileSync(to)).digest('hex'))throw Error('Staged compiled output mismatch');
 }
}
ensureBuilt('/src/apps/api/dist',target+'/dist');
for(const name of ['config','contracts','db','observability','policy']){
 const destination=fs.realpathSync(`${target}/node_modules/@thaara/${name}`);
 if(!destination.startsWith('/out/'))throw Error('Nonportable workspace package');
 ensureBuilt(`/src/packages/${name}/dist`,path.join(destination,'dist'));
}
// Existing test-only factory is imported by app.ts, with a repository-relative
// pure guard dependency. Preserve that layout; do not weaken/remove its guard.
fs.mkdirSync('/out/scripts',{recursive:true});
fs.copyFileSync('/src/scripts/step74-runtime-guard.mjs','/out/scripts/step74-runtime-guard.mjs');
for(const file of ['pilot-config.mjs','pilot-start.mjs'])fs.copyFileSync('/src/deploy/hostinger-pilot/'+file,target+'/'+file);
