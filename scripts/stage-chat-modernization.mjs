import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, 'node_modules', '.cache', 'chat-modernization');
const pub = path.join(cache, 'publication');

const files = {
  'Dockerfile': 'deploy/hostinger-pilot/Dockerfile.chat-modernization',
  'contracts/conversations.js': 'packages/contracts/dist/conversations.js',
  'contracts/conversations.d.ts': 'packages/contracts/dist/conversations.d.ts',
  'api-services/quantum-weave-knowledge.js': 'apps/api/dist/services/quantum-weave-knowledge.js',
  'api-services/quantum-weave-knowledge.d.ts': 'apps/api/dist/services/quantum-weave-knowledge.d.ts',
  'api-services/chat-business-classifier.js': 'apps/api/dist/services/chat-business-classifier.js',
  'api-services/chat-business-classifier.d.ts': 'apps/api/dist/services/chat-business-classifier.d.ts',
  'api-services/chat-attachments.js': 'apps/api/dist/services/chat-attachments.js',
  'api-services/chat-attachments.d.ts': 'apps/api/dist/services/chat-attachments.d.ts',
  'api-routes/chat-attachments.js': 'apps/api/dist/routes/chat-attachments.js',
  'api-routes/chat-attachments.d.ts': 'apps/api/dist/routes/chat-attachments.d.ts',
  'api-routes/conversations.js': 'apps/api/dist/routes/conversations.js',
  'api-routes/conversations.d.ts': 'apps/api/dist/routes/conversations.d.ts',
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

function walk(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(full));
    else if (entry.isFile()) results.push(full);
  }
  return results;
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

const pubPath = path.join(root, 'deploy/hostinger-pilot/publish-chat-modernization.py');
let publisher = fs.readFileSync(pubPath, 'utf8').replace(/\r\n/g, '\n');
publisher = publisher.replace(/ARCHIVE_SHA = '[^']*'/, `ARCHIVE_SHA = '${archiveSha}'`);
fs.writeFileSync(pubPath, publisher, 'utf8');

const publishSh = `set -euo pipefail\npython3 - <<'THAARA_CHAT_PY'\nOWNER_APPROVED_CHAT = True\nPAYLOAD = '${rawArchive.toString('base64')}'\n${publisher}\nTHAARA_CHAT_PY\n`;
fs.writeFileSync(path.join(cache, 'publish.sh'), publishSh, 'utf8');

console.log(JSON.stringify({
  files: manifest.length,
  archive_sha256: archiveSha,
  bytes: rawArchive.length
}, null, 2));
