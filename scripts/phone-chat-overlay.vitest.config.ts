import {defineConfig} from 'vitest/config';
import path from 'node:path';
import fs from 'node:fs';
const root=process.cwd(),source=path.join(root,'apps/api/src'),candidate=path.join(root,'node_modules/.cache/phone-chat-overlay-20261105/package/overlay');
const normalize=(p:string)=>p.replaceAll('\\','/');
export default defineConfig({
 plugins:[{name:'phone-live-baseline-only',enforce:'pre',async resolveId(id,importer){
  if(!importer)return null;
  const from=normalize(importer),src=normalize(source),out=normalize(candidate);
  if(from.startsWith(out+'/')){
   if(!id.startsWith('.'))return this.resolve(id,path.join(source,'app.ts'),{skipSelf:true});
   const relative=path.posix.normalize(path.posix.join(path.posix.dirname(from.slice(out.length+1)),id));
   const staged=path.join(candidate,relative);if(fs.existsSync(staged))return staged;
   const target=path.join(source,relative.replace(/\.js$/,'.ts'));if(fs.existsSync(target))return target;
  }
  if(id.startsWith('.')&&from.startsWith(src+'/')){
   const absolute=normalize(path.resolve(path.dirname(importer),id)).replace(/\.ts$/,'.js');
   const staged=path.join(candidate,absolute.slice(src.length+1));if(fs.existsSync(staged))return staged;
  }
  return null;
 }}],
 test:{globals:true,environment:'node',testTimeout:60000,hookTimeout:60000,fileParallelism:false,exclude:['**/node_modules/**','**/.agents/**']}
});
