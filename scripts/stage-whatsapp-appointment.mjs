import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, 'node_modules', '.cache', 'whatsapp-appointment');
const pub = path.join(cache, 'publication');

const files = {
  'Dockerfile': 'deploy/hostinger-pilot/Dockerfile.whatsapp-appointment',
  'contracts/whatsapp-n8n.js': 'packages/contracts/dist/whatsapp-n8n.js',
  'contracts/whatsapp-n8n.d.ts': 'packages/contracts/dist/whatsapp-n8n.d.ts',
  'api-app/app.js': 'apps/api/dist/app.js',
  'api-app/app.d.ts': 'apps/api/dist/app.d.ts',
  'api-services/model-gateway.js': 'apps/api/dist/services/model-gateway.js',
  'api-services/model-gateway.d.ts': 'apps/api/dist/services/model-gateway.d.ts',
  'api-services/whatsapp-ai-service.js': 'apps/api/dist/services/whatsapp-ai-service.js',
  'api-services/whatsapp-ai-service.d.ts': 'apps/api/dist/services/whatsapp-ai-service.d.ts',
  'api-services/whatsapp-enquiries.js': 'apps/api/dist/services/whatsapp-enquiries.js',
  'api-services/whatsapp-enquiries.d.ts': 'apps/api/dist/services/whatsapp-enquiries.d.ts',
  'api-services/whatsapp-durable.js': 'apps/api/dist/services/whatsapp-durable.js',
  'api-services/whatsapp-durable.d.ts': 'apps/api/dist/services/whatsapp-durable.d.ts',
  'api-services/quantum-weave-knowledge.js': 'apps/api/dist/services/quantum-weave-knowledge.js',
  'api-services/quantum-weave-knowledge.d.ts': 'apps/api/dist/services/quantum-weave-knowledge.d.ts',
  'api-services/whatsapp-inbox.js': 'apps/api/dist/services/whatsapp-inbox.js',
  'api-services/whatsapp-inbox.d.ts': 'apps/api/dist/services/whatsapp-inbox.d.ts',
  'api-services/chat-whatsapp-assistant.js': 'apps/api/dist/services/chat-whatsapp-assistant.js',
  'api-services/chat-whatsapp-assistant.d.ts': 'apps/api/dist/services/chat-whatsapp-assistant.d.ts',
  'api-routes/whatsapp-inbox.js': 'apps/api/dist/routes/whatsapp-inbox.js',
  'api-routes/whatsapp-inbox.d.ts': 'apps/api/dist/routes/whatsapp-inbox.d.ts',
  'api-routes/whatsapp-n8n.js': 'apps/api/dist/routes/whatsapp-n8n.js',
  'api-routes/whatsapp-n8n.d.ts': 'apps/api/dist/routes/whatsapp-n8n.d.ts',
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

const pubPath = path.join(root, 'deploy/hostinger-pilot/publish-whatsapp-appointment.py');
let publisher = fs.readFileSync(pubPath, 'utf8').replace(/\r\n/g, '\n');
publisher = publisher.replace(/ARCHIVE_SHA = '[^']*'/, `ARCHIVE_SHA = '${archiveSha}'`);
fs.writeFileSync(pubPath, publisher, 'utf8');

const publishSh = `set -euo pipefail\npython3 - <<'THAARA_WHATSAPP_PY'\nOWNER_APPROVED_WHATSAPP_APPOINTMENT = True\nPAYLOAD = '${rawArchive.toString('base64')}'\n${publisher}\nTHAARA_WHATSAPP_PY\n`;
fs.writeFileSync(path.join(cache, 'publish.sh'), publishSh, 'utf8');

const checkCandidateSh = `set -euo pipefail
python3 - <<'THAARA_CANDIDATE_CHECK_PY'
import base64, hashlib, io, json, shutil, subprocess, tarfile
from pathlib import Path

BASE_IMAGE = 'sha256:371cf2c14c74c025f690d924414907527589ef35bd454b25d6f7e211d9a9da0e'
ARCHIVE_SHA = '${archiveSha}'
PAYLOAD = '${rawArchive.toString('base64')}'
ALLOWED = ['Dockerfile', 'manifest.json', 'contracts', 'api-app', 'api-services', 'api-routes', 'web-dist']

def run(args, check=True, timeout=300):
    res = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if check and res.returncode != 0:
        raise RuntimeError(f"Command failed ({args[0]}): {res.stderr}\\n{res.stdout}")
    return res

def inspect(name):
    return json.loads(run(['docker', 'inspect', name]).stdout)[0]

api_before = inspect('thaara-v2-pilot-api-1')
actual_live_image = api_before.get('Image') or api_before['Config']['Image']
if actual_live_image != BASE_IMAGE:
    raise RuntimeError(f"Live production image changed! Expected {BASE_IMAGE}, got {actual_live_image}")

raw = base64.b64decode(PAYLOAD)
if hashlib.sha256(raw).hexdigest() != ARCHIVE_SHA:
    raise RuntimeError("Archive SHA256 mismatch")

stage = Path('/tmp/thaara-whatsapp-candidate-stage')
if stage.exists():
    shutil.rmtree(stage)
stage.mkdir(parents=True, exist_ok=True)

with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as tf:
    for m in tf.getmembers():
        parts = Path(m.name).parts
        if not parts or parts[0] not in ALLOWED:
            raise RuntimeError(f"Unexpected archive member: {m.name}")
        tf.extract(m, stage)

base_tag = 'thaara-v2-base:whatsapp-sarvam-rebase'
cand_tag = 'thaara-v2-candidate:whatsapp-unified-ai'
run(['docker', 'tag', BASE_IMAGE, base_tag])
run([
    'docker', 'build', '--no-cache', '--network=none', '--pull=false',
    '--build-arg', f'BASE_IMAGE={base_tag}',
    '-t', cand_tag,
    '-f', str(stage / 'Dockerfile'),
    str(stage)
])

cand_info = inspect(cand_tag)
cand_id = cand_info['Id']

smoke = run([
    'docker', 'run', '--rm', '--network=none', cand_tag,
    'node', '--input-type=module', '-e',
    """
    import { buildApp } from './dist/app.js';
    import { WhatsAppAIService } from './dist/services/whatsapp-ai-service.js';
    import { DIRECT_CALENDLY_URL, QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK } from './dist/services/whatsapp-enquiries.js';
    if (typeof WhatsAppAIService !== 'function') throw new Error('Missing WhatsAppAIService');
    if (DIRECT_CALENDLY_URL !== 'https://calendly.com/team-brandmint/30min') throw new Error('Invalid Calendly URL');
    if (QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK !== 'https://wa.me/919972965677') throw new Error('Invalid WhatsApp contact link');
    console.log(JSON.stringify({ status: 'OK', buildApp: typeof buildApp }));
    """
])

print(json.dumps({
    'candidate_build': 'VERIFIED_SUCCESS',
    'base_image': BASE_IMAGE,
    'candidate_image_id': cand_id,
    'archive_sha256': ARCHIVE_SHA,
    'smoke_output': smoke.stdout.strip()
}, indent=2))
THAARA_CANDIDATE_CHECK_PY
`;
fs.writeFileSync(path.join(cache, 'check-candidate-build.sh'), checkCandidateSh, 'utf8');

console.log(JSON.stringify({
  files: manifest.length,
  archive_sha256: archiveSha,
  bytes: rawArchive.length
}, null, 2));
