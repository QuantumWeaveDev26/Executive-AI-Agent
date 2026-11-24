import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!['--built-root','--output'].includes(args[i])||!args[i+1])throw Error('Use --built-root PATH --output NEW_DIRECTORY');options[args[i]]=args[i+1];}
if(!options['--output'])throw Error('An explicit new output directory is required');
const built=path.resolve(options['--built-root']||'.'),output=path.resolve(options['--output']);
const release=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../deploy/releases/bulk-auto-followup-consolidated-20261124');
const manifest=JSON.parse(await fs.readFile(path.join(release,'manifest.json'),'utf8'));
const inside=(base,name)=>{if(path.isAbsolute(name)||name.split(/[\\/]/).some(x=>x==='..'||x===''))throw Error('Invalid manifest path');const p=path.resolve(base,name);if(!p.startsWith(base+path.sep))throw Error('Path escape refused');return p;};
try{await fs.lstat(output);throw Error('Output already exists; choose a new directory');}catch(e){if(e.code!=='ENOENT')throw e;}
if(output===built||output===release||built.startsWith(output+path.sep)||release.startsWith(output+path.sep))throw Error('Output overlaps source');
const seen=new Set(),verified=[];
for(const item of manifest.files){
 if(seen.has(item.path)||!['source-build','preserved-runtime'].includes(item.source))throw Error('Invalid or duplicate manifest entry');seen.add(item.path);
 const base=item.source==='source-build'?built:path.join(release,'overlay'),source=inside(base,item.path),relative=path.relative(base,source).split(path.sep);let parent=base;
 for(const part of relative){parent=path.join(parent,part);const stat=await fs.lstat(parent);if(stat.isSymbolicLink())throw Error('Symlink refused');}
 const data=await fs.readFile(source);if(data.length!==item.bytes||crypto.createHash('sha256').update(data).digest('hex')!==item.sha256)throw Error('Release checksum mismatch: '+item.path);
 verified.push({name:item.path,data});
}
await fs.mkdir(output,{recursive:false,mode:0o700});
for(const item of verified){const dest=inside(output,item.name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,item.data,{flag:'wx',mode:0o600});}
console.log(JSON.stringify({status:'verified_release_staged',release:manifest.release,files:verified.length,productionChanged:false,servicesStarted:false}));
