// Explicit, approved initialization only. Never invokes a runtime/recovery suite.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { childEnvironment, getIsolatedRuntimeConfig, withoutCommandOutput } from './step74-runtime-guard.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cache=path.join(root,'node_modules/.cache/step74');
const definitions=fs.readFileSync(path.join(cache,'.env.step74'),'utf8').trim().split(/\r?\n/);
const fileEnv=Object.fromEntries(definitions.map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
for(const [key,value]of Object.entries(fileEnv)) {
  if(process.env[key]!==undefined&&process.env[key]!==value)throw Error('[Step 74 isolation] Conflicting inherited '+key);
}
const env=childEnvironment({...process.env,...fileEnv});
const config=getIsolatedRuntimeConfig(env);
const docker=args=>withoutCommandOutput(()=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000}));
const inspect=names=>JSON.parse(docker(['inspect',...names]));
const devNames=['thaara-v2-postgres','thaara-v2-redis'];
const snapshot=c=>({id:c.Id,image:c.Image,started:c.State.StartedAt,restarts:c.RestartCount,running:c.State.Running,mounts:c.Mounts,bindings:c.HostConfig.PortBindings});
const devBefore=inspect(devNames).map(snapshot);
const devHash=()=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'.env'))).digest('hex');
const initialDevHash=fs.readFileSync(path.join(cache,'development-env.sha256'),'utf8');
if(devHash()!==initialDevHash)throw Error('[Step 74 isolation] Development .env changed');
const tests=inspect(['thaara-step74-test-postgres-1','thaara-step74-test-redis-1']);
for(const c of tests) {
 const labels=c.Config.Labels,service=labels['com.docker.compose.service'];
 const published=Object.values(c.NetworkSettings.Ports).filter(Boolean).flat();
 if(labels['com.docker.compose.project']!=='thaara-step74-test'||labels['thaara.purpose']!=='step74-disposable-test'||
   !c.State.Running||c.State.Health?.Status!=='healthy'||c.Mounts.some(m=>m.Type!=='tmpfs')||
   !Object.hasOwn(c.HostConfig.Tmpfs||{},service==='postgres'?'/var/lib/postgresql/data':'/data')||
   Object.keys(c.NetworkSettings.Networks).join(',')!=='thaara-step74-test-bridge'||
   published.length!==1||published[0].HostIp!=='127.0.0.1'||
   published[0].HostPort!==(service==='postgres'?'15432':service==='redis'?'16379':'invalid'))
   throw Error('[Step 74 isolation] Container ownership, storage or binding mismatch');
 if(service==='postgres'&&(!c.Config.Env.includes('POSTGRES_DB='+config.databaseName)||
    !c.Config.Env.includes('POSTGRES_PASSWORD='+decodeURIComponent(new URL(config.migrationUrl).password))))
   throw Error('[Step 74 isolation] PostgreSQL identity/credential mismatch');
 if(service==='redis'&&!c.Config.Env.includes('THAARA_STEP74_REDIS_PASSWORD='+decodeURIComponent(new URL(config.redisUrl).password)))
   throw Error('[Step 74 isolation] Redis credential mismatch');
}
const network=JSON.parse(docker(['network','inspect','thaara-step74-test-bridge']))[0];
if(network.Labels?.['com.docker.compose.project']!=='thaara-step74-test'||
 JSON.stringify(Object.keys(network.Containers||{}).sort())!==JSON.stringify(tests.map(c=>c.Id).sort()))
 throw Error('[Step 74 isolation] Test bridge has unexpected ownership/members');
const mode=process.argv[2];
if(!['check','initialize-approved'].includes(mode)||process.argv.length!==3)throw Error('Use check or initialize-approved');
if(mode==='check') {
 console.log('Test container identities, settings and development snapshot verified. No database connections or mutations.');
} else {
 await initialize();
}
async function initialize() {
 const dbRequire=createRequire(path.join(root,'packages/db/package.json'));
 const workerRequire=createRequire(path.join(root,'apps/worker/package.json'));
 const {Client}=dbRequire('pg');
 const Redis=workerRequire('ioredis').Redis;
 const sql=fs.readdirSync(path.join(root,'packages/db/src/migrations')).filter(n=>n.endsWith('.sql')).sort();
 for(const name of sql) {
  if(!fs.readFileSync(path.join(root,'packages/db/src/migrations',name)).equals(fs.readFileSync(path.join(root,'packages/db/dist/migrations',name))))
    throw Error('[Step 74 isolation] Built migration copy differs from existing source');
 }
 if(execFileSync('git',['diff','--name-only','HEAD','--','packages/db/src/migrations'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim())
   throw Error('[Step 74 isolation] Existing migrations modified');
 const admin=new Client({connectionString:config.migrationUrl,connectionTimeoutMillis:5000});
 await admin.connect();
 try {
  const identity=(await admin.query('SELECT current_database() AS db,current_user AS actor')).rows[0];
  if(identity.db!==config.databaseName||identity.actor!=='postgres')throw Error('[Step 74 isolation] Database identity mismatch');
  for(const key of ['EPHEMERAL_APP_SECRET','THAARA_DB_ADMIN_PASSWORD','THAARA_DB_WORKER_PASSWORD','THAARA_DB_SEEDER_PASSWORD'])
    if(!/^[a-f0-9]{64}$/.test(env[key]||''))throw Error('[Step 74 isolation] Missing isolated role credential');
  for(const entry of ['packages/db/dist/cli/migrate.js','packages/db/dist/cli/provision-role.js','packages/db/scripts/bootstrap-runtime-identities.ts'])
    runChild(entry);
  const migrations=(await admin.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(r=>r.version);
  if(migrations.length!==sql.length||migrations.some((version,i)=>!sql[i].startsWith(version+'_')))
    throw Error('[Step 74 isolation] Migration ledger incomplete');
  const roles=(await admin.query("SELECT rolname,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=ANY($1)",[
    ['thaara_app','thaara_admin_user','thaara_worker_user','thaara_seeder_user']])).rows;
  if(roles.length!==4||roles.some(r=>r.rolsuper||r.rolbypassrls||r.rolcreaterole||r.rolcreatedb))
    throw Error('[Step 74 isolation] Unsafe runtime role attributes');
  for(const [role,url]of [['thaara_app',config.appUrl],['thaara_worker_user',config.workerUrl]]) {
    const client=new Client({connectionString:url,connectionTimeoutMillis:5000});
    try{await client.connect();const row=(await client.query('SELECT current_database() AS db,current_user AS actor')).rows[0];
      if(row.db!==config.databaseName||row.actor!==role)throw Error('[Step 74 isolation] Runtime login mismatch');
    }finally{await client.end();}
  }
  const redis=new Redis(config.redisUrl,{lazyConnect:true,maxRetriesPerRequest:1,connectTimeout:3000,retryStrategy:()=>null});
  try{await redis.connect();if(await redis.ping()!=='PONG')throw Error('Redis connectivity failed');}
  finally{redis.disconnect();}
  if(devHash()!==initialDevHash||JSON.stringify(devBefore)!==JSON.stringify(inspect(devNames).map(snapshot)))
    throw Error('[Step 74 isolation] Development snapshot changed');
  const summary={database:config.databaseName,postgres:'127.0.0.1:15432',redis:'127.0.0.1:16379',
    migrations:migrations.length,roles:roles.map(r=>r.rolname).sort(),runtimeLoginsVerified:true,redisPing:'PONG',
    developmentUnchanged:true,reliabilityTestsRun:false};
  fs.writeFileSync(path.join(cache,'initialization-result.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary));
 }finally{await admin.end();}
}
function runChild(entry) {
 const result=spawnSync(process.execPath,['--import',new URL('./step74-child-guard.mjs',import.meta.url).href,path.join(root,entry)],
   {cwd:root,env,encoding:'utf8',timeout:90000});
 if(result.status!==0) {
  let output=(result.stderr||result.stdout||'Child failed').slice(-1500);
  output=output.replace(/(?:postgres(?:ql)?|redis):\/\/\S+/g,'[REDACTED URL]');
  for(const [key,value]of Object.entries(env))if(/PASSWORD|SECRET/.test(key)&&value)output=output.split(value).join('[REDACTED]');
  throw Error('Guarded initialization child failed ('+path.basename(entry)+'): '+output);
 }
 console.log('Guarded child completed: '+path.basename(entry));
}
