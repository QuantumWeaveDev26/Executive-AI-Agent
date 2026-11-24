// Dedicated, non-migrating API runtime suite. No development targets or provider calls.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync,execFileSync} from 'node:child_process';
import {childEnvironment,getIsolatedRuntimeConfig} from './step74-runtime-guard.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),approved=args.length===1&&args[0]==='--temporary-function-grants-approved';
if(args.length&&!approved)throw Error('Only --temporary-function-grants-approved is accepted; obtain explicit approval first.');
execFileSync(process.execPath,['scripts/step74-initialize.mjs','check'],{cwd:root,stdio:'pipe'});
const cache=path.join(root,'node_modules/.cache/step82');fs.mkdirSync(cache,{recursive:true});
const definitions=fs.readFileSync(path.join(root,'node_modules/.cache/step74/.env.step74'),'utf8').trim().split(/\r?\n/);
const file=Object.fromEntries(definitions.map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
for(const [key,value]of Object.entries(file))if(process.env[key]!==undefined&&process.env[key]!==value)throw Error('Conflicting test environment');
const env=childEnvironment({...process.env,...file}),isolated=getIsolatedRuntimeConfig(env);
const require=createRequire(path.join(root,'packages/db/package.json'));
const {Client}=require('pg'),admin=new Client({connectionString:isolated.migrationUrl});
const functions=['public.read_workspace_connector_connection(text)','public.commit_workspace_connector_connection(text,bigint,text,text,text,jsonb)'];
const privileges=()=>admin.query("SELECT has_function_privilege('thaara_app',$1,'EXECUTE') AS read,has_function_privilege('thaara_app',$2,'EXECUTE') AS commit",functions);
let restore=[];
try{
 await admin.connect();const {rows}=await admin.query('SELECT current_database() AS db,current_user AS actor');
 if(rows[0]?.db!=='thaara_step74_test'||rows[0]?.actor!=='postgres')throw Error('Unsafe database identity');
 const initial=(await privileges()).rows[0];
 if(typeof initial?.read!=='boolean'||typeof initial?.commit!=='boolean')throw Error('Unknown permission baseline');
 const missing=functions.filter((_fn,i)=>!(i===0?initial.read:initial.commit));
 if(missing.length&&!approved)throw Error('Connector EXECUTE permissions are absent; explicit test-only grant approval is required.');
 // Register all restorations before granting, including an interrupted/ambiguous grant result.
 restore=missing;
 for(const fn of missing)await admin.query('GRANT EXECUTE ON FUNCTION '+fn+' TO thaara_app');
 const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','apps/api/test/n8n-durable-api.runtime.test.ts'],{cwd:root,env,stdio:'pipe',encoding:'utf8',timeout:180000});
 fs.writeFileSync(path.join(cache,'runtime.log'),(result.stdout??'')+(result.stderr??''));
 process.exitCode=result.status??1;
 console.log('Step82 runtime exit: '+process.exitCode+'; details: node_modules/.cache/step82/runtime.log');
}catch{
 process.exitCode=1;console.error('Step82 isolated runtime failed. Check verified test prerequisites and test-only permission approval.');
}finally{
 try{
  for(const fn of restore)await admin.query('REVOKE EXECUTE ON FUNCTION '+fn+' FROM thaara_app');
  if(restore.length){
   const final=(await privileges()).rows[0];
   if(restore.some(fn=>fn===functions[0]?final.read:final.commit))throw Error('Restoration failed');
   console.log('Temporary test-only EXECUTE permissions restored to their original state.');
  }
 }finally{await admin.end();}
}
