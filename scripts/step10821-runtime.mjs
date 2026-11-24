// Owner-approved disposable fixture only. Fresh credentials exist only in process memory.
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { assertMediaFixture, MEDIA_CONTAINER, MEDIA_NETWORK, MEDIA_DATABASE } from './step10821-runtime-guard.mjs';
import { getIsolatedRuntimeConfig } from './step74-runtime-guard.mjs';
import { createBinaryRelay } from './step1084-loopback-proxy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = new URL('../node_modules/.cache/step10821/', import.meta.url);
const image = 'postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea';
const durableSha = '4ad4e53f5d1c30b6a2806728359b79ab47695399c79db354bcac1d479d18228e';
const baseSchemaSha = '29498d7da36994347371a77f0e93467c7898db6c01b0223db6916499fb2d59a2';
const mediaSha = '9334165b784997400318c884acb78bd53ad2f3d499e832b602896097ecb11404';
const fail = () => { throw Error('Step10821 isolated runner stopped'); };
// No inherited DB/provider configuration, Docker host override or Node injection.
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|COMSPEC|PATHEXT|DOCKER_CONFIG)$/i.test(key)));
const docker = (args, env = safeEnv) => execFileSync('docker', args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, windowsHide: true }).trim();
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const secret = () => crypto.randomBytes(32).toString('base64url');
let expected, relay, admin, networkId, containerId;
let stage = 'approval-and-pins';
function verify() {
  const fields = { Id: '.Id', Image: '.Image', Name: '.Name', Labels: '.Config.Labels', State: '.State', ReadOnly: '.HostConfig.ReadonlyRootfs', Restarts: '.RestartCount', Mounts: '.Mounts', Tmpfs: '.HostConfig.Tmpfs', Binds: '.HostConfig.Binds', Ports: '.HostConfig.PortBindings', ActualPorts: '.NetworkSettings.Ports', Networks: '.NetworkSettings.Networks' };
  const format = '{' + Object.entries(fields).map(([k, v]) => JSON.stringify(k) + ':{{json ' + v + '}}').join(',') + '}';
  const facts = JSON.parse(docker(['inspect', '--format', format, expected.ContainerId]));
  const network = JSON.parse(docker(['network', 'inspect', expected.NetworkId]))[0];
  assertMediaFixture(expected, facts, network);
  return facts;
}
try {
  if (process.argv.slice(2).join(' ') !== '--approved-isolated-media') fail();
  const durable = fs.readFileSync(new URL('../docs/migrations/1083-whatsapp-durable.review.sql', import.meta.url));
  const media = fs.readFileSync(new URL('../docs/migrations/10821-whatsapp-media.review.sql', import.meta.url));
  if (sha(durable) !== durableSha || sha(media) !== mediaSha) fail();
  const migrationsDir = new URL('../packages/db/src/migrations/', import.meta.url);
  const manifest = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort().map(name => [name, sha(fs.readFileSync(new URL(name, migrationsDir)))]);
  if (manifest.length !== 12 || sha(JSON.stringify(manifest)) !== baseSchemaSha) fail();
  fs.mkdirSync(cache, { recursive: true });
  stage = 'local-docker-preflight';
  const endpoint = JSON.parse(docker(['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']));
  if (!['npipe:////./pipe/dockerDesktopLinuxEngine', 'npipe:////./pipe/docker_engine'].includes(endpoint)) fail();
  await new Promise((resolve, reject) => { const port = net.createServer(); port.once('error', reject); port.listen(15432, '127.0.0.1', () => port.close(resolve)); });
  if (docker(['ps', '-a', '--format', '{{.Names}}']).split(/\r?\n/).includes(MEDIA_CONTAINER)) fail();
  if (docker(['network', 'ls', '--format', '{{.Name}}']).split(/\r?\n/).includes(MEDIA_NETWORK)) fail();
  const imageId = docker(['image', 'inspect', '--format', '{{.Id}}', image]);
  const adminPassword = secret(), appPassword = secret(), workerPassword = secret();
  stage = 'create-owned-fixture';
  networkId = docker(['network', 'create', '--internal', '--label', 'thaara.step=10821', MEDIA_NETWORK]);
  containerId = docker(['run', '-d', '--name', MEDIA_CONTAINER, '--label', 'thaara.step=10821', '--network', networkId, '--read-only',
    '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=536870912', '--tmpfs', '/var/run/postgresql:rw,noexec,nosuid,size=16777216', '--tmpfs', '/tmp:rw,noexec,nosuid,size=33554432',
    '--memory', '768m', '--cpus', '1', '--shm-size', '64m', '-p', '127.0.0.1:15432:5432', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB', image],
    { ...safeEnv, POSTGRES_PASSWORD: adminPassword, POSTGRES_DB: MEDIA_DATABASE });
  expected = { ContainerId: containerId, ImageId: imageId, NetworkId: networkId, BaseSha: baseSchemaSha, DurableSha: durableSha, MediaSha: mediaSha };
  fs.writeFileSync(new URL('identity.json', cache), JSON.stringify(expected));
  const facts = verify();
  stage = 'fixture-readiness';
  let ready = false;
  for (let i = 0; i < 60; i++) { try { docker(['exec', containerId, 'pg_isready', '-U', 'postgres', '-d', MEDIA_DATABASE]); ready = true; break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  if (!ready) fail();
  if (!facts.ActualPorts?.['5432/tcp']?.some(p => p.HostIp === '127.0.0.1' && p.HostPort === '15432')) {
    relay = createBinaryRelay(() => spawn('docker', ['exec', '-i', containerId, 'nc', '127.0.0.1', '5432'], { env: safeEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }));
    await new Promise((resolve, reject) => { relay.once('error', reject); relay.listen(15432, '127.0.0.1', resolve); });
  }
  const child = { ...safeEnv, NODE_ENV: 'test', THAARA_TEST_MODE: 'step74', THAARA_STEP10821_RUNTIME_APPROVED: 'yes' };
  for (const [alias, role, password] of [['DATABASE_URL', 'thaara_app', appPassword], ['MIGRATION_DATABASE_URL', 'postgres', adminPassword], ['BOOTSTRAP_DATABASE_URL', 'postgres', adminPassword], ['WORKER_DATABASE_URL', 'thaara_worker_user', workerPassword]]) child['THAARA_TEST_' + alias] = `postgresql://${role}:${password}@127.0.0.1:15432/${MEDIA_DATABASE}`;
  child.THAARA_TEST_REDIS_URL = `redis://:${secret()}@127.0.0.1:16379/0`; // Guard-only; no Redis process or connection.
  const config = getIsolatedRuntimeConfig(child);
  const { PostgresDatabase, Migrator } = await import('../packages/db/dist/index.js');
  const { Pool } = createRequire(new URL('../packages/db/package.json', import.meta.url))('pg');
  admin = new PostgresDatabase(new Pool({ connectionString: config.migrationUrl, max: 1, connectionTimeoutMillis: 5000 }));
  verify();
  if ((await admin.query('SELECT current_database() AS db')).rows[0]?.db !== MEDIA_DATABASE) fail();
  if ((await admin.query("SELECT to_regclass('public.workspaces') AS existing")).rows[0]?.existing) fail();
  stage = 'approved-base-schema';
  const migrator = new Migrator(admin);
  await migrator.migrate(migrator.loadMigrationFiles(fileURLToPath(migrationsDir)));
  await admin.query("SELECT set_config('step10821.app_password',$1,false)", [appPassword]);
  await admin.query("DO $$ BEGIN EXECUTE format('ALTER ROLE thaara_app LOGIN PASSWORD %L',current_setting('step10821.app_password')); END $$");
  verify();
  await admin.query("SELECT set_config('thaara.step1083_review_approved','yes',false),set_config('thaara.step1083_target_database',current_database(),false)");
  await admin.exec(durable.toString('utf8'));
  stage = 'approved-media-schema';
  verify(); await admin.exec(media.toString('utf8'));
  await admin.close(); admin = undefined;
  stage = 'seven-runtime-tests'; verify();
  const run = await new Promise((resolve, reject) => {
    const test = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'apps/api/test/whatsapp-media.runtime.test.ts', '--silent', '--reporter=json'], { cwd: root, env: child, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '', errors = '';
    test.stdout.on('data', chunk => { output += chunk; }); test.stderr.on('data', chunk => { errors += chunk; });
    test.once('error', reject); test.once('exit', code => resolve({ code, output, errors }));
  });
  let sanitized = run.output;
  for (const password of [adminPassword, appPassword, workerPassword]) sanitized = sanitized.split(password).join('[REDACTED]');
  sanitized = sanitized.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/g, '[REDACTED_DB_URL]');
  fs.writeFileSync(new URL('runtime.json', cache), sanitized);
  const result = JSON.parse(sanitized);
  console.log(JSON.stringify({ stage, passed: result.numPassedTests, failed: result.numFailedTests, success: result.success }));
  if (run.code !== 0 || result.numPassedTests !== 7 || result.numFailedTests !== 0 || !result.success) fail();
  stage = 'completed';
} catch {
  console.error('Step10821 stopped at ' + stage + '. Raw credentials, SQL errors and connection strings suppressed.'); process.exitCode = 1;
} finally {
  await admin?.close().catch(() => {});
  if (relay) await new Promise(resolve => relay.close(resolve));
  // IDs come only from successful creation in this process. Never select by a reused name.
  try {
    if (containerId) {
      const label = docker(['inspect', '--format', '{{index .Config.Labels "thaara.step"}}', containerId]);
      if (label !== '10821' || !/^[a-f0-9]{64}$/.test(containerId)) fail();
      docker(['rm', '-f', containerId]);
    }
    if (networkId) {
      const network = JSON.parse(docker(['network', 'inspect', networkId]))[0];
      if (network.Id !== networkId || network.Name !== MEDIA_NETWORK || network.Labels?.['thaara.step'] !== '10821' || Object.keys(network.Containers || {}).length) fail();
      docker(['network', 'rm', networkId]);
    }
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(new URL('cleanup.json', cache), JSON.stringify({ stage, removedOwnedContainer: Boolean(containerId), removedOwnedNetwork: Boolean(networkId), existingResourcesTargeted: false }));
    console.log('Step10821 owned fixture cleanup finished; no existing resources selected.');
  } catch { console.error('Owned fixture cleanup needs inspection; no fallback cleanup attempted.'); process.exitCode = 1; }
}
