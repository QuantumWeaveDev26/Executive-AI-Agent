import {loadEnvFile} from 'node:process';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {once} from 'node:events';
import assert from 'node:assert/strict';

// Read-only startup smoke check: starts/stops only its own child processes.
// No owner creation, provider calls, credentials printed, or database export.
loadEnvFile('.env.local-dev');
assert.equal(process.env.NODE_ENV,'development');
assert.equal(process.env.PORT,'3002');
assert.equal(process.env.HOST,'127.0.0.1');
for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','WORKER_DATABASE_URL']) {
 const url=new URL(process.env[key]);
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'15432');assert.equal(url.pathname,'/thaara_v2_local');
}
const redis=new URL(process.env.REDIS_URL);
assert.equal(redis.hostname,'127.0.0.1');assert.equal(redis.port,'16379');
for(const key of Object.keys(process.env)) {
 if(/(?:API_KEY|CLIENT_SECRET|ACCESS_TOKEN|REFRESH_TOKEN|WEBHOOK_SECRET)$/.test(key)&&process.env[key])throw Error('Use a clean terminal without provider credentials.');
 if(/^THAARA_.*(?:LIVE|SEND|ENABLED)/.test(key)&&process.env[key]==='true')throw Error('Live integrations must remain disabled.');
}
for(const port of [3002,5173]) {
 const socket=createServer();socket.listen(port,'127.0.0.1');await once(socket,'listening');await new Promise(r=>socket.close(r));
}
const children=[];const logs=new Map();
function start(path,args=[]) {
 const child=spawn(process.execPath,['--env-file=.env.local-dev',path,...args],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 children.push(child);logs.set(child,'');
 for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>logs.set(child,(logs.get(child)+chunk.toString()).slice(-24000)));
 return child;
}
try {
 const api=start('apps/api/dist/server.js');const worker=start('apps/worker/dist/worker.js');
 const web=start('apps/web/node_modules/vite/bin/vite.js',['apps/web','--config','apps/web/vite.config.ts','--host','127.0.0.1','--strictPort']);
 let health=false,workerReady=false,webReady=false;
 for(let attempt=0;attempt<100;attempt++) {
  if([api,worker,web].some(child=>child.exitCode!==null))throw Error('A local process exited before readiness; inspect the local entrypoint independently. No captured log values were printed.');
  try {const response=await fetch('http://127.0.0.1:3002/api/v1/health',{signal:AbortSignal.timeout(500)});health=response.ok&&(await response.json()).status==='ok';}catch{}
  workerReady=logs.get(worker).includes('Worker running and listening for jobs on Redis queue.');
  try {const response=await fetch('http://127.0.0.1:5173',{signal:AbortSignal.timeout(500)});webReady=response.ok&&(await response.text()).includes('id="root"');}catch{}
  if(health&&workerReady&&webReady)break;
  await delay(300);
 }
 assert.ok(health,'Local API health did not become ready.');assert.ok(workerReady,'Local worker did not become ready.');
 assert.ok(webReady,'Local frontend did not become ready.');
 assert.ok(logs.get(worker).includes('Worker role thaara_worker validated successfully.'));
 const docs=await fetch('http://127.0.0.1:3002/docs/json',{signal:AbortSignal.timeout(3000)});
 assert.equal(docs.status,200);
 const proxy=await fetch('http://127.0.0.1:5173/api/v1/health',{signal:AbortSignal.timeout(3000)});
 assert.equal(proxy.status,200);assert.equal((await proxy.json()).status,'ok');
 console.log(JSON.stringify({status:'passed',apiHealth:200,openApi:200,frontend:200,frontendApiProxy:200,workerReady:true,restrictedWorkerRoleVerified:true,providerRequestsMade:0,productionChanged:false}));
} finally {
 await Promise.all(children.map(async child=>{
  if(child.exitCode!==null)return;
  const closed=once(child,'close');child.kill('SIGTERM');await Promise.race([closed,delay(3000)]);
  if(child.exitCode===null){child.kill('SIGKILL');await closed;}
 }));
}
