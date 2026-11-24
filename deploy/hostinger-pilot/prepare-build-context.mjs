import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const packages=['config','contracts','db','observability','policy'];
const fixed=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.base.json','tsconfig.json','apps/api/package.json','apps/api/tsconfig.json','scripts/step74-runtime-guard.mjs',...packages.flatMap(p=>[`packages/${p}/package.json`,`packages/${p}/tsconfig.json`]),...['pilot-config.mjs','pilot-start.mjs','stage-built.mjs','prepare-build-context.mjs'].map(p=>'deploy/hostinger-pilot/'+p)];
const digest=data=>createHash('sha256').update(data).digest('hex');
function sourceFiles(root,dir){
 const result=[];
 for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
  const relative=dir+'/'+e.name;
  if(e.isSymbolicLink())throw Error('Build context cannot follow source links');
  if(e.isDirectory())result.push(...sourceFiles(root,relative));
  else if(e.isFile()&&/\.(ts|sql)$/.test(e.name))result.push(relative);
 }
 return result;
}
export function buildInputs(root){
 const paths=[...fixed,...sourceFiles(root,'apps/api/src'),...packages.flatMap(p=>sourceFiles(root,`packages/${p}/src`))].sort();
 for(const p of paths)if(!fs.lstatSync(path.join(root,p)).isFile())throw Error('Build input is not a regular file');
 return paths;
}
export function verifyBuildContext(root,installedDependencies=false){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'build-context-manifest.json'),'utf8'));
 if(!Array.isArray(manifest))throw Error('Invalid build context manifest');
 const actual=[];
 const walk=dir=>{for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){if(installedDependencies&&e.name==='node_modules')continue;const p=dir?dir+'/'+e.name:e.name;if(e.isSymbolicLink())throw Error('Build context contains a link');if(e.isDirectory())walk(p);else if(e.isFile()&&p!=='build-context-manifest.json')actual.push(p);}};walk('');
 const names=manifest.map(x=>x.path);
 if(new Set(names).size!==names.length||JSON.stringify([...names].sort())!==JSON.stringify(actual.sort()))throw Error('Unexpected build context files');
 for(const item of manifest)if(item.path.includes('..')||path.isAbsolute(item.path)||digest(fs.readFileSync(path.join(root,item.path)))!==item.sha256)throw Error('Build context checksum mismatch');
 return manifest.length;
}
export function prepareBuildContext(root){
 const target=path.join(root,'node_modules/.cache/hostinger-pilot/context-'+randomUUID());fs.mkdirSync(target,{recursive:true});
 const manifest=[];
 for(const name of buildInputs(root)){
  const data=fs.readFileSync(path.join(root,name)),destination=path.join(target,name);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,data);manifest.push({path:name,sha256:digest(data)});
 }
 fs.writeFileSync(path.join(target,'build-context-manifest.json'),JSON.stringify(manifest,null,2));verifyBuildContext(target);return target;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){console.log(prepareBuildContext(fileURLToPath(new URL('../../',import.meta.url))));}
