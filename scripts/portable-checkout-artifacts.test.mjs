import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const git=(mode,...args)=>execFileSync('git',['-c','core.bare=false','-c','core.autocrlf='+mode,'-C',root,...args],{windowsHide:true,maxBuffer:8388608});
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const release of ['bulk-auto-followup-consolidated-20261124','bulk-consent-ui-20261124'])test(release+' preserves pinned overlay bytes through Windows checkout conversion',()=>{
 const prefix='deploy/releases/'+release+'/',manifest=JSON.parse(readFileSync(path.join(root,prefix,'manifest.json'),'utf8'));
 const entry=manifest.files.find(x=>x.source==='preserved-runtime'&&x.path.endsWith('.js'));
 assert.ok(entry);const name=prefix+'overlay/'+entry.path;
 for(const mode of ['true','input'])assert.equal(sha(git(mode,'cat-file','--filters','--path='+name,'HEAD:'+name)),entry.sha256,'Checkout conversion changed '+name+' with autocrlf='+mode);
});
test('all core migration source bytes remain identical to pinned release SQL on each checkout mode',()=>{
 const manifest=JSON.parse(readFileSync(path.join(root,'deploy/releases/bulk-consent-ui-20261124/manifest.json'),'utf8'));
 const migrations=manifest.files.filter(x=>x.path.startsWith('packages/db/dist/migrations/')&&x.path.endsWith('.sql'));
 assert.equal(migrations.length,12);
 for(const entry of migrations){const name=entry.path.replace('/dist/','/src/');for(const mode of ['true','input'])assert.equal(sha(git(mode,'cat-file','--filters','--path='+name,'HEAD:'+name)),entry.sha256,'Migration bytes changed: '+name+' with autocrlf='+mode);}
});
