import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, 'node_modules', '.cache', 'step10831');
const pub = path.join(cache, 'publication');
const SQL_SHA = '756bc7c55251a0e9dc728dd8bcd37abfec60526f21fac4fe0a7110411b39c584';
const SQL_10833_SHA = '6346aac5bd59442b1b1d2788c6e759cb6598a85d8a55e995ba9be11b6b8c50b9';
const SQL_10833_ROLLBACK_SHA = '42aaf6d9f79fdaf7a884e89b936dd6efa146b53cb63c647b8461f0d00585d13e';

const files = {
  '10832-whatsapp-relay-principal-sync.review.sql': 'docs/migrations/10832-whatsapp-relay-principal-sync.review.sql',
  '10833-whatsapp-dynamic-customer-scale.review.sql': 'docs/migrations/10833-whatsapp-dynamic-customer-scale.review.sql',
  '10833-whatsapp-dynamic-customer-scale.rollback.sql': 'docs/migrations/10833-whatsapp-dynamic-customer-scale.rollback.sql',
  'Dockerfile': 'deploy/hostinger-pilot/Dockerfile.whatsapp-10831',
  'contracts/meta-whatsapp.js': 'packages/contracts/dist/meta-whatsapp.js',
  'contracts/meta-whatsapp.d.ts': 'packages/contracts/dist/meta-whatsapp.d.ts',
  'contracts/whatsapp-n8n.js': 'packages/contracts/dist/whatsapp-n8n.js',
  'contracts/whatsapp-n8n.d.ts': 'packages/contracts/dist/whatsapp-n8n.d.ts',
  'db/whatsapp-postgres.js': 'packages/db/dist/repositories/whatsapp-postgres.js',
  'db/whatsapp-postgres.d.ts': 'packages/db/dist/repositories/whatsapp-postgres.d.ts',
  'db/whatsapp-state.js': 'packages/db/dist/repositories/whatsapp-state.js',
  'db/whatsapp-state.d.ts': 'packages/db/dist/repositories/whatsapp-state.d.ts',
  'api-services/chat-whatsapp-assistant.js': 'apps/api/dist/services/chat-whatsapp-assistant.js',
  'api-services/chat-whatsapp-assistant.d.ts': 'apps/api/dist/services/chat-whatsapp-assistant.d.ts',
  'api-services/chat-whatsapp-read.js': 'apps/api/dist/services/chat-whatsapp-read.js',
  'api-services/chat-whatsapp-read.d.ts': 'apps/api/dist/services/chat-whatsapp-read.d.ts',
  'api-services/whatsapp-durable.js': 'apps/api/dist/services/whatsapp-durable.js',
  'api-services/whatsapp-durable.d.ts': 'apps/api/dist/services/whatsapp-durable.d.ts',
  'api-services/whatsapp-enquiries.js': 'apps/api/dist/services/whatsapp-enquiries.js',
  'api-services/whatsapp-enquiries.d.ts': 'apps/api/dist/services/whatsapp-enquiries.d.ts',
  'api-services/whatsapp-inbox.js': 'apps/api/dist/services/whatsapp-inbox.js',
  'api-services/whatsapp-inbox.d.ts': 'apps/api/dist/services/whatsapp-inbox.d.ts',
  'api-services/whatsapp-pilot-dispatch.js': 'apps/api/dist/services/whatsapp-pilot-dispatch.js',
  'api-services/whatsapp-pilot-dispatch.d.ts': 'apps/api/dist/services/whatsapp-pilot-dispatch.d.ts',
  'api-services/whatsapp-templates.js': 'apps/api/dist/services/whatsapp-templates.js',
  'api-services/whatsapp-templates.d.ts': 'apps/api/dist/services/whatsapp-templates.d.ts',
  'api-routes/whatsapp-inbox.js': 'apps/api/dist/routes/whatsapp-inbox.js',
  'api-routes/whatsapp-inbox.d.ts': 'apps/api/dist/routes/whatsapp-inbox.d.ts',
};

fs.rmSync(pub, { recursive: true, force: true });
fs.mkdirSync(pub, { recursive: true });

for (const [target, source] of Object.entries(files)) {
  const dest = path.join(pub, target);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const raw = fs.readFileSync(path.join(root, source)).toString('utf8').replace(/\r\n/g, '\n');
  fs.writeFileSync(dest, raw, 'utf8');
}

fs.cpSync(path.join(root, 'apps/web/dist'), path.join(pub, 'web-dist'), { recursive: true });

const sqlActual = crypto.createHash('sha256').update(fs.readFileSync(path.join(pub, '10832-whatsapp-relay-principal-sync.review.sql'))).digest('hex');
if (sqlActual !== SQL_SHA) throw new Error('SQL SHA mismatch: ' + sqlActual);
const sql10833Actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(pub, '10833-whatsapp-dynamic-customer-scale.review.sql'))).digest('hex');
if (sql10833Actual !== SQL_10833_SHA) throw new Error('SQL 10833 SHA mismatch: ' + sql10833Actual);
const sql10833RollbackActual = crypto.createHash('sha256').update(fs.readFileSync(path.join(pub, '10833-whatsapp-dynamic-customer-scale.rollback.sql'))).digest('hex');
if (sql10833RollbackActual !== SQL_10833_ROLLBACK_SHA) throw new Error('SQL 10833 Rollback SHA mismatch: ' + sql10833RollbackActual);

function walk(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(full));
    else if (entry.isFile()) results.push(full);
  }
  return results;
}

for (const sub of ['contracts', 'db', 'api-services']) {
  for (const file of walk(path.join(pub, sub))) {
    const content = fs.readFileSync(file, 'utf8');
    if (/PHONE_AI_CALL_ACTION|PhoneCallingService|chat-phone-calling|phone-calling-store/.test(content)) {
      throw new Error('Paused Phone code found in ' + file);
    }
  }
}

const manifest = walk(pub).map(full => ({
  Path: path.relative(pub, full).replace(/\\/g, '/'),
  SHA256: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
})).sort((a, b) => a.Path.localeCompare(b.Path));

fs.writeFileSync(path.join(pub, 'manifest.json'), JSON.stringify(manifest, null, 1), 'utf8');

const fixedDate = new Date('2026-11-01T00:00:00Z');
function normalizeMtimes(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      normalizeMtimes(full);
      fs.utimesSync(full, fixedDate, fixedDate);
    } else {
      fs.utimesSync(full, fixedDate, fixedDate);
    }
  }
}
normalizeMtimes(pub);
fs.utimesSync(pub, fixedDate, fixedDate);

const archive = path.join(cache, 'publication.tar.gz');
if (fs.existsSync(archive)) fs.unlinkSync(archive);
const topLevelEntries = fs.readdirSync(pub).sort();
execFileSync('tar.exe', ['--options', 'gzip:!timestamp', '-czf', archive, '-C', pub, ...topLevelEntries]);

const rawArchive = fs.readFileSync(archive);
const archiveSha = crypto.createHash('sha256').update(rawArchive).digest('hex');
const pubPath = path.join(root, 'deploy/hostinger-pilot/publish-whatsapp-10831.py');
let publisher = fs.readFileSync(pubPath, 'utf8').replace(/\r\n/g, '\n');
publisher = publisher.replace(/ARCHIVE_SHA = '[^']*'/, `ARCHIVE_SHA = '${archiveSha}'`);
fs.writeFileSync(pubPath, publisher, 'utf8');

const publishSh = `set -euo pipefail\npython3 - <<'THAARA_10831_PY'\nOWNER_APPROVED_10831 = False\nPAYLOAD = '${rawArchive.toString('base64')}'\n${publisher}\nTHAARA_10831_PY\n`;
fs.writeFileSync(path.join(cache, 'publish.sh'), publishSh, 'utf8');
console.log(JSON.stringify({ files: manifest.length, archive_sha256: archiveSha, sql_sha256: SQL_SHA, bytes: rawArchive.length }));
