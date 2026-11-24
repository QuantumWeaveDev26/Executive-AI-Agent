import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const script=fileURLToPath(new URL('./stage-exact-release.mjs',import.meta.url));
const sha=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'thaara-release-portable-test-'));
 const scripts=path.join(root,'scripts'),build=path.join(root,'build'),release=path.join(root,'deploy/releases/bulk-consent-ui-20261124');
 fs.mkdirSync(scripts,{recursive:true});fs.mkdirSync(build);fs.mkdirSync(path.join(release,'overlay'),{recursive:true});
 fs.copyFileSync(script,path.join(scripts,'stage-exact-release.mjs'));
 const built='export const built = 1;\n',overlay='export const preserved = 2;\n';
 fs.writeFileSync(path.join(build,'built.js'),built);fs.writeFileSync(path.join(release,'overlay','legacy.js'),overlay);
 fs.writeFileSync(path.join(release,'manifest.json'),JSON.stringify({release:'bulk-consent-ui-20261124',files:[{path:'built.js',source:'source-build',bytes:Buffer.byteLength(built),sha256:sha(built)},{path:'legacy.js',source:'preserved-runtime',bytes:Buffer.byteLength(overlay),sha256:sha(overlay)}]}));
 const output=path.join(root,'new-parent','nested','release');
 return {root,build,output,run:()=>spawnSync(process.execPath,[path.join(scripts,'stage-exact-release.mjs'),'--release','bulk-consent-ui-20261124','--built-root',build,'--output',output],{encoding:'utf8',windowsHide:true}),cleanup:()=>{
  const absolute=path.resolve(root),temp=path.resolve(os.tmpdir());assert.ok(absolute.startsWith(temp+path.sep)&&path.basename(absolute).startsWith('thaara-release-portable-test-'));assert.equal(fs.lstatSync(absolute).isSymbolicLink(),false);fs.rmSync(absolute,{recursive:true,force:true,maxRetries:3});
 }};
}
test('stages a verified release into a new nested output path on a fresh checkout',()=>{
 const f=fixture();try{const result=f.run();assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).files,2);assert.equal(fs.readFileSync(path.join(f.output,'legacy.js'),'utf8'),'export const preserved = 2;\n');}finally{f.cleanup();}
});
test('refuses a corrupted build before creating output directories',()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.build,'built.js'),'changed');const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/checksum mismatch/);assert.equal(fs.existsSync(path.join(f.root,'new-parent')),false);}finally{f.cleanup();}
});
test('preserves an existing output directory and its contents',()=>{
 const f=fixture();try{fs.mkdirSync(f.output,{recursive:true});fs.writeFileSync(path.join(f.output,'keep.txt'),'preserve');const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/Output already exists/);assert.equal(fs.readFileSync(path.join(f.output,'keep.txt'),'utf8'),'preserve');}finally{f.cleanup();}
});
