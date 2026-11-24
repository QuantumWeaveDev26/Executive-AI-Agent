import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_BASE_IMAGE = 'sha256:24581095b4aafede405e2cc2368e834ec63a6be55c412d139cebbe7b6d2ec945';

function resolveStageCacheDir() {
  const candidates = [
    process.env.THAARA_STAGE_CACHE_DIR,
    path.join(root, 'node_modules', '.cache', 'bulk-campaign'),
    path.join(os.tmpdir(), 'thaara-bulk-campaign-stage')
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.write-probe');
      fs.writeFileSync(probe, 'ok', 'utf8');
      fs.unlinkSync(probe);
      return dir;
    } catch {
      // try next writable candidate
    }
  }
  throw new Error('Unable to locate a writable staging cache directory.');
}

const cache = resolveStageCacheDir();
const pub = path.join(cache, 'publication');

const contractsDistRoot = process.env.THAARA_CONTRACTS_DIST_DIR
  ? path.resolve(process.env.THAARA_CONTRACTS_DIST_DIR)
  : path.join(root, 'packages/contracts/dist');

const apiDistRoot = process.env.THAARA_API_DIST_DIR
  ? path.resolve(process.env.THAARA_API_DIST_DIR)
  : path.join(root, 'apps/api/dist');

const files = {
  'Dockerfile': path.join(root, 'deploy/hostinger-pilot/Dockerfile.bulk-campaign'),
  'reconcile-bulk-campaign.mjs': path.join(root, 'deploy/hostinger-pilot/reconcile-bulk-campaign.mjs'),
  'contracts/bulk-campaign.js': path.join(contractsDistRoot, 'bulk-campaign.js'),
  'contracts/bulk-campaign.d.ts': path.join(contractsDistRoot, 'bulk-campaign.d.ts'),
  'api-services/bulk-campaign.js': path.join(apiDistRoot, 'services/bulk-campaign.js'),
  'api-services/bulk-campaign.d.ts': path.join(apiDistRoot, 'services/bulk-campaign.d.ts'),
  'api-services/bulk-campaign-knowledge.js': path.join(apiDistRoot, 'services/bulk-campaign-knowledge.js'),
  'api-services/bulk-campaign-knowledge.d.ts': path.join(apiDistRoot, 'services/bulk-campaign-knowledge.d.ts'),
  'api-services/bulk-campaign-auto-followup.js': path.join(apiDistRoot, 'services/bulk-campaign-auto-followup.js'),
  'api-services/bulk-campaign-auto-followup.d.ts': path.join(apiDistRoot, 'services/bulk-campaign-auto-followup.d.ts'),
  'api-services/phone-calling.js': path.join(apiDistRoot, 'services/phone-calling.js'),
  'api-services/phone-calling.d.ts': path.join(apiDistRoot, 'services/phone-calling.d.ts'),
  'api-services/phone-pilot-startup.js': path.join(apiDistRoot, 'services/phone-pilot-startup.js'),
  'api-services/phone-pilot-startup.d.ts': path.join(apiDistRoot, 'services/phone-pilot-startup.d.ts'),
  'api-services/phone-sarvam-runtime.js': path.join(apiDistRoot, 'services/phone-sarvam-runtime.js'),
  'api-services/phone-sarvam-runtime.d.ts': path.join(apiDistRoot, 'services/phone-sarvam-runtime.d.ts'),
  'api-routes/bulk-campaign.js': path.join(apiDistRoot, 'routes/bulk-campaign.js'),
  'api-routes/bulk-campaign.d.ts': path.join(apiDistRoot, 'routes/bulk-campaign.d.ts')
};

fs.rmSync(pub, { recursive: true, force: true });
fs.mkdirSync(pub, { recursive: true });

for (const [target, source] of Object.entries(files)) {
  const dest = path.join(pub, target);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const raw = fs.readFileSync(source).toString('utf8').replace(/\r\n/g, '\n');
  fs.writeFileSync(dest, raw, 'utf8');
}

// Stage production web bundle (BulkCampaignPanel + BulkCampaignCreateView + BulkCampaignChatCard + navigation + Chat Voice R7 + Google Drive + Phone Step 115)
const webDistSource = process.env.THAARA_WEB_DIST_DIR
  ? path.resolve(process.env.THAARA_WEB_DIST_DIR)
  : path.join(root, 'apps/web/dist');
if (!fs.existsSync(path.join(webDistSource, 'index.html'))) {
  throw new Error('apps/web/dist/index.html is missing. Build @thaara/web before staging.');
}
fs.cpSync(webDistSource, path.join(pub, 'web-dist'), { recursive: true });

function walk(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(full));
    else if (entry.isFile()) results.push(full);
  }
  return results;
}

const manifest = walk(pub)
  .map(full => ({
    Path: path.relative(pub, full).replace(/\\/g, '/'),
    SHA256: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
  }))
  .sort((a, b) => a.Path.localeCompare(b.Path));

fs.writeFileSync(path.join(pub, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

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

const pubPath = path.join(root, 'deploy/hostinger-pilot/publish-bulk-campaign.py');
let publisher = fs.readFileSync(pubPath, 'utf8').replace(/\r\n/g, '\n');
publisher = publisher.replace(/ARCHIVE_SHA = '[^']*'/, `ARCHIVE_SHA = '${archiveSha}'`);
if (!publisher.includes('OWNER_APPROVED_BULK_CAMPAIGN = False')) {
  throw new Error('Safety lock violation: OWNER_APPROVED_BULK_CAMPAIGN must remain False in publish-bulk-campaign.py');
}
let publisherSha;
try {
  fs.writeFileSync(pubPath, publisher, 'utf8');
  publisherSha = crypto.createHash('sha256').update(fs.readFileSync(pubPath)).digest('hex');
} catch {
  const fallbackPub = path.join(cache, 'publish-bulk-campaign.py');
  fs.writeFileSync(fallbackPub, publisher, 'utf8');
  publisherSha = crypto.createHash('sha256').update(Buffer.from(publisher, 'utf8')).digest('hex');
}

const dockerfileSha = crypto
  .createHash('sha256')
  .update(fs.readFileSync(path.join(root, 'deploy/hostinger-pilot/Dockerfile.bulk-campaign')))
  .digest('hex');
const reconcileSha = crypto
  .createHash('sha256')
  .update(fs.readFileSync(path.join(root, 'deploy/hostinger-pilot/reconcile-bulk-campaign.mjs')))
  .digest('hex');
const migrationDocSha = crypto
  .createHash('sha256')
  .update(fs.readFileSync(path.join(root, 'docs/migrations/116-bulk-campaigns.review.sql')))
  .digest('hex');

const publishSh = `set -euo pipefail\npython3 - <<'THAARA_BULK_CAMPAIGN_PY'\nOWNER_APPROVED_BULK_CAMPAIGN = False\nPAYLOAD = '${rawArchive.toString('base64')}'\n${publisher}\nTHAARA_BULK_CAMPAIGN_PY\n`;
fs.writeFileSync(path.join(cache, 'publish.sh'), publishSh, 'utf8');
const publishShSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(cache, 'publish.sh'))).digest('hex');

// Generate a build-and-verify-only script (`check-candidate-build.sh`) that builds the isolated candidate image
// and verifies module imports, API startup, and simulation-only settings WITHOUT mutating or restarting production!
const checkCandidateSh = `set -euo pipefail
python3 - <<'THAARA_CANDIDATE_CHECK_PY'
import base64, hashlib, io, json, shutil, subprocess, tarfile
from pathlib import Path

BASE_IMAGE = '${EXPECTED_BASE_IMAGE}'
ARCHIVE_SHA = '${archiveSha}'
PAYLOAD = '${rawArchive.toString('base64')}'
ALLOWED = ['Dockerfile', 'reconcile-bulk-campaign.mjs', 'manifest.json', 'contracts', 'api-services', 'api-routes', 'web-dist']

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

stage = Path('/tmp/thaara-bulk-campaign-candidate-stage')
if stage.exists():
    shutil.rmtree(stage)
stage.mkdir(parents=True, exist_ok=True)

with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as tf:
    for m in tf.getmembers():
        parts = Path(m.name).parts
        if not parts or parts[0] not in ALLOWED:
            raise RuntimeError(f"Unexpected archive member: {m.name}")
        tf.extract(m, stage)

base_tag = 'thaara-v2-base:bulk-campaign-rebase'
cand_tag = 'thaara-v2-candidate:bulk-campaign-sim'
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
    import {
      createBulkCampaignPlan,
      DEFAULT_DEMO_INSTRUCTION,
      DEFAULT_DEMO_PHONE_DIRECTORY,
      detectBulkCampaignChatIntent,
      executeChatBulkCampaign,
      parseBulkCampaignContacts,
      SYNTHETIC_DEMO_CONTACTS_CSV
    } from './dist/services/bulk-campaign.js';

    const imported = parseBulkCampaignContacts({
      sourceType: 'csv',
      rawText: SYNTHETIC_DEMO_CONTACTS_CSV,
      phoneDirectory: DEFAULT_DEMO_PHONE_DIRECTORY
    });
    const plan = createBulkCampaignPlan({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      instruction: DEFAULT_DEMO_INSTRUCTION,
      importResult: imported
    });
    if (plan.liveCallingEnabled !== false || plan.liveSendingEnabled !== false || plan.executionMode !== 'planned') {
      throw new Error('Simulation safety lock invalid');
    }
    const scope = {
      workspaceId: '11111111-1111-4111-8111-111111111111',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      role: 'owner',
      sessionTokenHash: 'smoke'
    };
    const chatRes = await executeChatBulkCampaign(
      scope,
      detectBulkCampaignChatIntent("Prepare an AI calling campaign, but don't call anyone.")
    );
    if (!chatRes.handled || !chatRes.assistantResponseText.includes('liveCallingEnabled=false')) {
      throw new Error('Chat simulation check failed');
    }
    console.log('ISOLATED_CONTAINER_SMOKE_OK');
    """
])

api_after = inspect('thaara-v2-pilot-api-1')
if api_after['Id'] != api_before['Id'] or api_after['State']['StartedAt'] != api_before['State']['StartedAt']:
    raise RuntimeError("Production container identity changed during build-only check!")

shutil.rmtree(stage, ignore_errors=True)

print(json.dumps({
    'status': 'CANDIDATE_VERIFIED_PRODUCTION_UNTOUCHED',
    'live_container_id': api_after['Id'],
    'live_image_digest': actual_live_image,
    'live_health': api_after['State'].get('Health', {}).get('Status'),
    'candidate_image_tag': cand_tag,
    'candidate_image_digest': cand_id,
    'archive_sha256': ARCHIVE_SHA,
    'isolated_smoke': smoke.stdout.strip(),
    'liveCallingEnabled': False,
    'liveSendingEnabled': False
}, indent=2))
THAARA_CANDIDATE_CHECK_PY
`;
fs.writeFileSync(path.join(cache, 'check-candidate-build.sh'), checkCandidateSh, 'utf8');

console.log(
  JSON.stringify(
    {
      stage_cache_dir: cache,
      base_image: EXPECTED_BASE_IMAGE,
      files: manifest.length,
      archive_sha256: archiveSha,
      archive_bytes: rawArchive.length,
      deployment_script_sha256: publisherSha,
      publish_sh_sha256: publishShSha,
      dockerfile_sha256: dockerfileSha,
      reconcile_script_sha256: reconcileSha,
      migration_doc_sha256: migrationDocSha,
      owner_approved_lock: false
    },
    null,
    2
  )
);
