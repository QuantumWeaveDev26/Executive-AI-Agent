// Local-only acceptance for the Step 108.12 pilot seed. Throwaway tmpfs PostgreSQL bound to a
// random 127.0.0.1 port, installed from the approved pilot bundle, removed afterwards.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPilotDbBundle } from '../deploy/hostinger-pilot/pilot-db-bundle.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const image = 'postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea';
if (process.argv[2] !== '--approved') throw Error('Local approval flag required');
const name = 'thaara-step10812-' + crypto.randomBytes(4).toString('hex');
const secrets = fs.mkdtempSync(path.join(os.tmpdir(), 'thaara-step10812-secrets-'));
const docker = (args, env) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000, env: env ? { ...process.env, ...env } : process.env }).trim();
let code = 1;
try {
  const port = await new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const adminPassword = crypto.randomBytes(32).toString('base64url'), appPassword = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(path.join(secrets, 'api_password'), appPassword + '\n');
  docker(['run', '-d', '--name', name, '--label', 'thaara.step=10812', '--read-only', '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=536870912',
    '--tmpfs', '/var/run/postgresql:rw,noexec,nosuid,size=16777216', '--tmpfs', '/tmp:rw,noexec,nosuid,size=33554432', '--memory', '384m', '--shm-size', '64m',
    '-p', `127.0.0.1:${port}:5432`, '-v', `${secrets}:/run/secrets:ro`, '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB', image], { POSTGRES_PASSWORD: adminPassword, POSTGRES_DB: 'thaara_vps_pilot' });
  const ready = async () => { for (let i = 0; i < 150; i++) { const r = spawnSync('docker', ['exec', name, 'psql', '-X', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-tAc', 'SELECT 1'], { encoding: 'utf8' }); if (r.status === 0 && r.stdout.trim() === '1') return; await new Promise(r => setTimeout(r, 400)); } throw Error('not ready'); };
  await ready(); await new Promise(r => setTimeout(r, 2500)); await ready();
  const install = spawnSync('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-o', '/dev/null', '-U', 'postgres', '-d', 'thaara_vps_pilot'], { input: buildPilotDbBundle(root).sql, encoding: 'utf8' });
  if (install.status !== 0) throw Error('bundle install failed');
  const r = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'scripts/step10812-seed.runtime.test.ts'], { cwd: root, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, THAARA_STEP10812_ADMIN_URL: `postgresql://postgres:${adminPassword}@127.0.0.1:${port}/thaara_vps_pilot`, THAARA_STEP10812_APP_URL: `postgresql://thaara_app:${appPassword}@127.0.0.1:${port}/thaara_vps_pilot` } });
  code = r.status ?? 1;
} catch (e) { console.error(String(e.message || e).replaceAll(/[A-Za-z0-9_-]{43}/g, '[redacted]')); }
finally {
  spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' }); fs.rmSync(secrets, { recursive: true, force: true });
  const left = spawnSync('docker', ['ps', '-a', '--filter', 'label=thaara.step=10812', '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout.trim();
  console.log('cleanup:', left ? 'LEFTOVER ' + left : 'throwaway container removed; temp secrets deleted'); process.exitCode = code;
}
