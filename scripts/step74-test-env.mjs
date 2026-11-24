import { getIsolatedRuntimeConfig } from './step74-runtime-guard.mjs';
// Preparation/validation only: no connections, container creation, migrations or test execution.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const envPath=path.join(root,'node_modules/.cache/step74/.env.step74');
const database='thaara_step74_test';
const pgKeys=['DATABASE_URL','MIGRATION_DATABASE_URL','BOOTSTRAP_DATABASE_URL','WORKER_DATABASE_URL'];
function eq(actual,expected,label='Isolated settings mismatch') { if(actual!==expected)throw Error(label); }
function validate(s) {
  for(const key of [...pgKeys,'REDIS_URL']) {
    let u;try{u=new URL(s[key]);}catch{throw Error('Invalid isolated URL: '+key);}
    const redis=key==='REDIS_URL';
    eq(u.protocol,redis?'redis:':'postgresql:',key);
    eq(u.hostname,'127.0.0.1',key);
    eq(u.port,redis?'16379':'15432',key+': development/default ports forbidden');
    eq(u.pathname,redis?'/0':'/'+database,key);
    eq(u.search,'',key);eq(u.hash,'',key);
    if(!/^[a-f0-9]{64}$/.test(u.password))throw Error('Invalid isolated credential format: '+key);
    eq(u.username,key==='DATABASE_URL'?'thaara_app':key==='WORKER_DATABASE_URL'?'thaara_worker_user':redis?'':'postgres',key);
  }
  eq(new URL(s.MIGRATION_DATABASE_URL).password,s.THAARA_STEP74_PG_PASSWORD);
  eq(new URL(s.BOOTSTRAP_DATABASE_URL).password,s.THAARA_STEP74_PG_PASSWORD);
  eq(new URL(s.DATABASE_URL).password,s.EPHEMERAL_APP_SECRET);
  eq(new URL(s.WORKER_DATABASE_URL).password,s.THAARA_DB_WORKER_PASSWORD);
  eq(new URL(s.REDIS_URL).password,s.THAARA_STEP74_REDIS_PASSWORD);
  eq(s.ALLOW_OFFLINE_RUNTIME_SKIP,'false');
  eq(new Set([s.THAARA_STEP74_PG_PASSWORD,s.THAARA_STEP74_REDIS_PASSWORD,s.EPHEMERAL_APP_SECRET,s.THAARA_DB_WORKER_PASSWORD]).size,4);
}
const action=process.argv[2];
if(!['prepare','check'].includes(action)||process.argv.length!==3)
  throw Error('Usage: node scripts/step74-test-env.mjs prepare|check. Container/migration/test actions are deliberately unsupported.');
if(action==='prepare'&&!fs.existsSync(envPath)) {
  const random=()=>crypto.randomBytes(32).toString('hex');
  const admin=random(),app=random(),worker=random(),redis=random();
  const pg=(user,password)=>'postgresql://'+user+':'+password+'@127.0.0.1:15432/'+database;
  const s={THAARA_STEP74_PG_PASSWORD:admin,THAARA_STEP74_REDIS_PASSWORD:redis,
    DATABASE_URL:pg('thaara_app',app),MIGRATION_DATABASE_URL:pg('postgres',admin),
    BOOTSTRAP_DATABASE_URL:pg('postgres',admin),WORKER_DATABASE_URL:pg('thaara_worker_user',worker),
    REDIS_URL:'redis://:'+redis+'@127.0.0.1:16379/0',
    EPHEMERAL_APP_SECRET:app,THAARA_DB_WORKER_PASSWORD:worker,ALLOW_OFFLINE_RUNTIME_SKIP:'false'};
  validate(s);fs.mkdirSync(path.dirname(envPath),{recursive:true});
  fs.writeFileSync(envPath,Object.entries(s).map(([k,v])=>k+'='+v).join('\n')+'\n',{flag:'wx',mode:0o600});
}
const s=Object.fromEntries(fs.readFileSync(envPath,'utf8').trim().split(/\r?\n/).map(line=>{
  const i=line.indexOf('=');if(i<1)throw Error('Malformed isolated setting');return [line.slice(0,i),line.slice(i+1)];
}));
validate(s);
let extended=false;
for(const alias of [...pgKeys,'REDIS_URL']) {
  const key='THAARA_TEST_'+alias;
  if(s[key]===undefined){s[key]=s[alias];extended=true;}
}
if(s.THAARA_TEST_MODE===undefined){s.THAARA_TEST_MODE='step74';extended=true;}
for(const key of ['THAARA_DB_ADMIN_PASSWORD','THAARA_DB_SEEDER_PASSWORD']) {
  if(!s[key]){s[key]=crypto.randomBytes(32).toString('hex');extended=true;}
}
getIsolatedRuntimeConfig(s);
if(extended)fs.writeFileSync(envPath,Object.entries(s).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600});
for(const [k,v]of Object.entries(s))
  if(process.env[k]!==undefined&&process.env[k]!==v)throw Error('Conflicting inherited variable: '+k);
for(const key of [...pgKeys,'REDIS_URL']) {
  const bad=new URL(s[key]);bad.port=key==='REDIS_URL'?'6379':'5432';
  assert.throws(()=>validate({...s,[key]:bad.href}));
}
console.log('Settings valid; five development-port rejection checks passed. No connections or containers started.');
console.log('Credentials are ignored in node_modules/.cache/step74/.env.step74; development .env untouched.');
