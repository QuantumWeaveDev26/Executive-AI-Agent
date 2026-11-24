import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,chmodSync,statSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./setup-local.mjs',import.meta.url));
test('generates an isolated local configuration, hides secrets and refuses overwrite',()=>{
 const dir=mkdtempSync(join(tmpdir(),'thaara-local-'));
 try {
  const run=()=>spawnSync(process.execPath,[script],{cwd:dir,encoding:'utf8'});
  const first=run();assert.equal(first.status,0,first.stderr);
  const file=join(dir,'.env.local-dev');const before=readFileSync(file,'utf8');
  assert.match(before,/PORT=3002/);assert.match(before,/@127\.0\.0\.1:15432\/thaara_v2_local/);
  assert.match(before,/REDIS_URL=redis:\/\/127\.0\.0\.1:16379/);
  assert.match(before,/WORKER_DATABASE_URL=postgresql:\/\/thaara_worker_user:/);
  const session=before.match(/^SESSION_SECRET=(.+)$/m)[1];
  assert.match(session,/^[a-f0-9]{64}$/);assert.ok(!first.stdout.includes(session));
  assert.ok(!before.includes('76.13.217.50'));assert.ok(!before.includes('API_KEY='));
  if(process.platform!=='win32')assert.equal(statSync(file).mode&0o777,0o600);
  assert.notEqual(run().status,0);assert.equal(readFileSync(file,'utf8'),before);
 } finally {if(existsSync(join(dir,'.env.local-dev')))chmodSync(join(dir,'.env.local-dev'),0o600);rmSync(dir,{recursive:true,force:true});}
});
