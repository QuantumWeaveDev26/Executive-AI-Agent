import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolveStageCacheDir() {
  if (process.env.THAARA_STAGE_CACHE_DIR) {
    fs.mkdirSync(process.env.THAARA_STAGE_CACHE_DIR, { recursive: true });
    return process.env.THAARA_STAGE_CACHE_DIR;
  }
  const preferred = path.join(root, 'node_modules', '.cache', 'google-drive');
  try {
    fs.mkdirSync(preferred, { recursive: true });
    const probe = path.join(preferred, '.write-probe');
    fs.writeFileSync(probe, 'ok', 'utf8');
    fs.unlinkSync(probe);
    return preferred;
  } catch {
    const fallback = path.join(os.tmpdir(), 'thaara-google-drive-stage');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

const cache = resolveStageCacheDir();
const pub = path.join(cache, 'publication');

const files = {
  'Dockerfile': 'deploy/hostinger-pilot/Dockerfile.google-drive',
  'pilot-start/pilot-start.mjs': 'deploy/hostinger-pilot/reconciled-phone115/pilot-start.mjs',
  'contracts/google-drive.js': 'packages/contracts/dist/google-drive.js',
  'contracts/google-drive.d.ts': 'packages/contracts/dist/google-drive.d.ts',
  'contracts/index.js': 'deploy/hostinger-pilot/reconciled-phone115/contracts-index.js',
  'contracts/index.d.ts': 'deploy/hostinger-pilot/reconciled-phone115/contracts-index.d.ts',
  'policy/registry.js': 'deploy/hostinger-pilot/reconciled-phone115/policy-registry.js',
  'policy/registry.d.ts': 'packages/policy/dist/registry.d.ts',
  'policy/index.js': 'packages/policy/dist/index.js',
  'policy/index.d.ts': 'packages/policy/dist/index.d.ts',
  'api-app/app.js': 'deploy/hostinger-pilot/reconciled-phone115/app.js',
  'api-app/app.d.ts': 'deploy/hostinger-pilot/reconciled-phone115/app.d.ts',
  'api-routes/conversations.js': 'apps/api/dist/routes/conversations.js',
  'api-routes/conversations.d.ts': 'apps/api/dist/routes/conversations.d.ts',
  'api-routes/google-drive.js': 'apps/api/dist/routes/google-drive.js',
  'api-routes/google-drive.d.ts': 'apps/api/dist/routes/google-drive.d.ts',
  'api-services/google-drive.js': 'apps/api/dist/services/google-drive.js',
  'api-services/google-drive.d.ts': 'apps/api/dist/services/google-drive.d.ts',
  'api-services/chat-google-drive-assistant.js': 'apps/api/dist/services/chat-google-drive-assistant.js',
  'api-services/chat-google-drive-assistant.d.ts': 'apps/api/dist/services/chat-google-drive-assistant.d.ts',
  'n8n/Sub_05_Gmail_and_Google_Drive_Operations.workflow.json': 'deploy/n8n/Sub_05_Gmail_and_Google_Drive_Operations.workflow.json'
};

fs.rmSync(pub, { recursive: true, force: true });
fs.mkdirSync(pub, { recursive: true });

for (const [target, source] of Object.entries(files)) {
  const dest = path.join(pub, target);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const raw = fs.readFileSync(path.join(root, source)).toString('utf8').replace(/\r\n/g, '\n');
  fs.writeFileSync(dest, raw, 'utf8');
}

// Include production web bundle (GoogleDriveScreen /integrations/drive + ChatRichText + PhoneCallbackReports + BulkCampaignPanel)
fs.cpSync(path.join(root, 'apps/web/dist'), path.join(pub, 'web-dist'), { recursive: true });

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(full));
    else if (entry.isFile()) results.push(full);
  }
  return results;
}

const manifest = walk(pub)
  .map((full) => ({
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

const pubPyPath = path.join(root, 'deploy/hostinger-pilot/publish-google-drive-final.py');
const releaseManifestPath = path.join(root, 'deploy/hostinger-pilot/google-drive-release-manifest.json');

const EXPECTED_BASE_IMAGE = 'sha256:352cc60a6b5c89bacde094c8bb8ce9060e94009d86816010d050e759ae1ca02d';

const publisherTemplate = `"""Thaara V2 — Google Drive Governed Production Deployment Publisher (Reconciled onto Phone Step 115):
- Expected baseline image: ${EXPECTED_BASE_IMAGE} (thaara-v2-pilot-api:phone115-r2)
- Upgrades n8n Sub 05 (upU4clCyj1VvJlpk) Drive branch with full backup & Gmail preservation.
- Overlays reconciled @thaara/contracts, @thaara/policy, @thaara/api (preserving ownerCallback runtime, callback reports, callback authorization), and @thaara/web.
- Internal Docker network routing (http://n8n-n8n-1:5678/webhook/sub-gmail-operations).
- Preserves all Phone Step 115 (Sarvam, receiver, TLS bridge, standing worker), WhatsApp, Bulk Campaigns, Chat Modernization, Gmail, and Calendar services.
- Atomic container swap + PostgreSQL pg_dump backup + automatic rollback of both API container and Sub 05 on failure.
"""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import time
import urllib.request

# CLOSED GATE BY DEFAULT — flip to True ONLY during owner-approved deployment execution
OWNER_APPROVED_GOOGLE_DRIVE = False

EXPECTED_BASE_IMAGE = '${EXPECTED_BASE_IMAGE}'
ARCHIVE_SHA = '${archiveSha}'
SUB05_WORKFLOW_ID = 'upU4clCyj1VvJlpk'
P = Path('/opt/thaara-v2-pilot')
API = 'thaara-v2-pilot-api-1'
PG = 'thaara-v2-pilot-postgres-1'
N8N = 'n8n-n8n-1'
DB = 'thaara_vps_pilot'
LINK = P / 'n8n-link-v2.sh'
SITE = 'https://thaara-v2.quantumweaveai.io'
ALLOWED = [
    'Dockerfile',
    'manifest.json',
    'pilot-start',
    'contracts',
    'policy',
    'api-app',
    'api-services',
    'api-routes',
    'web-dist',
    'n8n',
]


def run(args, check=True, env=None, timeout=240, stdin=None):
    result = subprocess.run(args, capture_output=True, text=True, env=env, timeout=timeout, input=stdin)
    if check and result.returncode:
        raise RuntimeError('Command failed; details withheld: ' + args[0])
    return result


def inspect(name):
    return json.loads(run(['docker', 'inspect', name]).stdout)[0]


def identity(facts):
    return (facts['Id'], facts['State']['StartedAt'], facts['RestartCount'])


def wait_api():
    for _ in range(45):
        if inspect(API)['State'].get('Health', {}).get('Status') == 'healthy':
            return
        time.sleep(2)
    raise RuntimeError('Pilot API health check timeout')


def restore_link():
    if 'n8n_default' in inspect(API)['NetworkSettings']['Networks']:
        return
    if LINK.exists():
        run(['bash', str(LINK)], check=False)


def backup_and_update_sub05(stage):
    import uuid
    export_tmp = f'/tmp/sub05-export-{int(time.time())}.json'
    backup_path = stage / f'before-sub05-{SUB05_WORKFLOW_ID}.json'
    try:
        run(['docker', 'exec', N8N, 'n8n', 'export:workflow', f'--id={SUB05_WORKFLOW_ID}', f'--output={export_tmp}'])
        run(['docker', 'cp', f'{N8N}:{export_tmp}', str(backup_path)])
    finally:
        run(['docker', 'exec', '-u', '0', N8N, 'rm', '-f', export_tmp], check=False)

    exported_list = json.loads(backup_path.read_text(encoding='utf-8'))
    live_wf = exported_list[0] if isinstance(exported_list, list) else exported_list
    blueprint = json.loads((stage / 'n8n/Sub_05_Gmail_and_Google_Drive_Operations.workflow.json').read_text(encoding='utf-8'))

    updated_wf = dict(live_wf)
    updated_wf['nodes'] = blueprint['nodes']
    updated_wf['connections'] = blueprint['connections']
    updated_wf['versionId'] = str(uuid.uuid4())
    updated_wf['active'] = True
    updated_wf.pop('activeVersionId', None)
    updated_wf.pop('activeVersion', None)
    updated_path = stage / f'updated-sub05-{SUB05_WORKFLOW_ID}.json'
    updated_path.write_text(json.dumps([updated_wf], indent=2), encoding='utf-8')

    container_tmp = f'/tmp/sub05-{int(time.time())}.json'
    run(['docker', 'cp', str(updated_path), f'{N8N}:{container_tmp}'])
    run(['docker', 'exec', '-u', '0', N8N, 'chown', 'node:node', container_tmp])
    try:
        run(['docker', 'exec', N8N, 'n8n', 'import:workflow', f'--input={container_tmp}'])
        run(['docker', 'exec', N8N, 'n8n', 'publish:workflow', f'--id={SUB05_WORKFLOW_ID}'])
    finally:
        run(['docker', 'exec', '-u', '0', N8N, 'rm', '-f', container_tmp], check=False)

    return backup_path


def rollback_sub05(backup_path):
    if not backup_path or not backup_path.exists():
        return
    container_tmp = f'/tmp/sub05-rollback-{int(time.time())}.json'
    run(['docker', 'cp', str(backup_path), f'{N8N}:{container_tmp}'], check=False)
    run(['docker', 'exec', '-u', '0', N8N, 'chown', 'node:node', container_tmp], check=False)
    run(['docker', 'exec', N8N, 'n8n', 'import:workflow', f'--input={container_tmp}'], check=False)
    run(['docker', 'exec', N8N, 'n8n', 'publish:workflow', f'--id={SUB05_WORKFLOW_ID}'], check=False)
    run(['docker', 'exec', '-u', '0', N8N, 'rm', '-f', container_tmp], check=False)


def update_compose_and_env(env_path, compose_path, original_compose_bytes, target_digest):
    compose_doc = json.loads(original_compose_bytes.decode('utf-8'))
    compose_doc['services']['api']['image'] = target_digest

    orig_text = env_path.read_text(encoding='utf-8')
    new_lines = []
    found = False
    for line in orig_text.splitlines():
        if line.strip().startswith('THAARA_PILOT_API_IMAGE='):
            new_lines.append(f'THAARA_PILOT_API_IMAGE={target_digest}')
            found = True
        else:
            new_lines.append(line)
    if not found:
        new_lines.append(f'THAARA_PILOT_API_IMAGE={target_digest}')

    stat = env_path.stat()
    env_path.write_text('\\n'.join(new_lines) + '\\n', encoding='utf-8')
    env_path.chmod(stat.st_mode)
    compose_path.write_text(json.dumps(compose_doc, indent=2) + '\\n', encoding='utf-8')


def main():
    if not OWNER_APPROVED_GOOGLE_DRIVE:
        raise SystemExit('Deployment not authorized by owner. Set OWNER_APPROVED_GOOGLE_DRIVE = True only after explicit owner approval.')
    if os.getuid() != 0:
        raise RuntimeError('Must run as root on Hostinger VPS')

    lock_path = Path('/tmp/thaara-deploy.lock')
    if lock_path.exists():
        raise RuntimeError('Concurrent deployment lock /tmp/thaara-deploy.lock exists')
    lock_path.write_text(str(os.getpid()), encoding='utf-8')

    try:
        cur_api = inspect(API)
        if cur_api['State'].get('Health', {}).get('Status') != 'healthy':
            raise RuntimeError('Current live API container is not healthy; aborting preflight')
        actual_base = cur_api.get('Image') or cur_api['Config']['Image']
        if actual_base != EXPECTED_BASE_IMAGE:
            raise RuntimeError(f'Live API image {actual_base} differs from expected baseline {EXPECTED_BASE_IMAGE}')

        peer_services = [
            PG,
            'thaara-v2-pilot-redis-1',
            'n8n-traefik-1',
            'thaara-phone115-receiver',
            'thaara-phone115-worker',
            'thaara-phone115-tls-bridge-f3a0ab369fe5061f',
        ]
        peers_before = {name: identity(inspect(name)) for name in peer_services}

        payload_b64 = globals().get('PAYLOAD')
        if not payload_b64:
            raise RuntimeError('Missing embedded PAYLOAD archive')
        raw_archive = base64.b64decode(payload_b64, validate=True)
        actual_sha = hashlib.sha256(raw_archive).hexdigest()
        if actual_sha != ARCHIVE_SHA:
            raise RuntimeError(f'Archive SHA256 mismatch: {actual_sha} != {ARCHIVE_SHA}')

        stage = P / 'staging-google-drive'
        if stage.exists():
            shutil.rmtree(stage)
        stage.mkdir(parents=True, exist_ok=True)

        with tarfile.open(fileobj=io.BytesIO(raw_archive), mode='r:gz') as tf:
            for member in tf.getmembers():
                parts = Path(member.name).parts
                if not parts or parts[0] not in ALLOWED or '..' in parts:
                    raise RuntimeError(f'Prohibited archive member: {member.name}')
                tf.extract(member, stage)

        # Verify extracted manifest SHA256s
        manifest_items = json.loads((stage / 'manifest.json').read_text(encoding='utf-8'))
        for item in manifest_items:
            disk_sha = hashlib.sha256((stage / item['Path']).read_bytes()).hexdigest()
            if disk_sha != item['SHA256']:
                raise RuntimeError(f'Manifest hash mismatch on {item["Path"]}')

        base_tag = 'thaara-v2-base:phone115-r2-rebase'
        base_user = inspect(actual_base).get('Config', {}).get('User') or 'root'
        run(['docker', 'tag', actual_base, base_tag])
        cand_tag = 'thaara-v2-pilot-api:google-drive-compat-candidate'
        run([
            'docker', 'build', '--no-cache', '--network=none', '--pull=false',
            '--build-arg', f'BASE_IMAGE={base_tag}',
            '--build-arg', f'FINAL_USER={base_user}',
            '-t', cand_tag,
            '-f', str(stage / 'Dockerfile'),
            str(stage)
        ], timeout=300)
        cand_id = inspect(cand_tag)['Id']

        env_file = P / '.env'
        compose_file = P / 'compose.json'
        orig_env = env_file.read_bytes()
        orig_env_mode = env_file.stat().st_mode
        orig_compose = compose_file.read_bytes()

        (stage / 'before-google-drive.env.bak').write_bytes(orig_env)
        (stage / 'before-google-drive.env.bak').chmod(orig_env_mode)
        (stage / 'before-google-drive.compose.json.bak').write_bytes(orig_compose)

        backup_dump = stage / 'before-google-drive.dump'
        with backup_dump.open('xb') as stream:
            dump = subprocess.run(
                ['docker', 'exec', '--user', 'postgres', PG, 'pg_dump', '-U', 'postgres', '-d', DB, '-Fc'],
                stdout=stream,
                stderr=subprocess.PIPE,
                timeout=120
            )
        if dump.returncode != 0 or backup_dump.stat().st_size <= 100:
            raise RuntimeError('Pre-deployment PostgreSQL pg_dump backup failed')

        compose_cmd = ['docker', 'compose', '-p', 'thaara-v2-pilot', '-f', str(compose_file), '--profile', 'application']
        old_env = dict(os.environ, THAARA_PILOT_API_IMAGE=actual_base)
        new_env = dict(os.environ, THAARA_PILOT_API_IMAGE=cand_id)
        sub05_backup = None

        try:
            sub05_backup = backup_and_update_sub05(stage)
            update_compose_and_env(env_file, compose_file, orig_compose, cand_id)
            run(compose_cmd + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=new_env)
            wait_api()
            restore_link()

            req = urllib.request.Request(f'{SITE}/api/v1/health', headers={'User-Agent': 'GoogleDriveDeployVerifier/2.0'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status != 200:
                    raise RuntimeError(f'Public /api/v1/health returned HTTP {resp.status}')

            for name, before_id in peers_before.items():
                if identity(inspect(name)) != before_id:
                    raise RuntimeError(f'Peer container {name} changed unexpectedly during deployment')

            print(json.dumps({
                'deployment': 'SUCCESS',
                'previous_image': actual_base,
                'new_image': cand_id,
                'new_tag': cand_tag,
                'sub05_workflow_id': SUB05_WORKFLOW_ID,
                'status': 'HEALTHY'
            }, indent=2))
        except Exception:
            rollback_sub05(sub05_backup)
            env_file.write_bytes(orig_env)
            env_file.chmod(orig_env_mode)
            compose_file.write_bytes(orig_compose)
            run(compose_cmd + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=old_env, check=False)
            time.sleep(4)
            restore_link()
            raise
    finally:
        lock_path.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
`;

const stagedPyPath = path.join(cache, 'publish-google-drive-final.py');
const stagedManifestPath = path.join(cache, 'google-drive-release-manifest.json');
fs.writeFileSync(stagedPyPath, publisherTemplate, 'utf8');
try {
  fs.writeFileSync(pubPyPath, publisherTemplate, 'utf8');
} catch {
  // In sandboxed runs, deploy/hostinger-pilot may be read-only to child processes; staged copy is in cache.
}

const publishSh = `set -euo pipefail
python3 - <<'THAARA_GDRIVE_PY'
PAYLOAD = '${rawArchive.toString('base64')}'
${publisherTemplate}
THAARA_GDRIVE_PY
`;
fs.writeFileSync(path.join(cache, 'publish.sh'), publishSh, 'utf8');

const dockerfileSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, files['Dockerfile']))).digest('hex');
const sub05Sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, files['n8n/Sub_05_Gmail_and_Google_Drive_Operations.workflow.json']))).digest('hex');
const publishPySha = crypto.createHash('sha256').update(fs.readFileSync(stagedPyPath)).digest('hex');
const publishShSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(cache, 'publish.sh'))).digest('hex');

const summary = {
  prepared_at: '2026-11-14',
  owner_approval_gate: 'CLOSED (OWNER_APPROVED_GOOGLE_DRIVE = False)',
  expected_live_base_image: EXPECTED_BASE_IMAGE,
  target_n8n_workflow_id: 'upU4clCyj1VvJlpk',
  internal_webhook_url: 'http://n8n-n8n-1:5678/webhook/sub-gmail-operations',
  stage_cache_dir: cache,
  publication_archive_sha256: archiveSha,
  dockerfile_sha256: dockerfileSha,
  sub05_workflow_sha256: sub05Sha,
  publish_py_sha256: publishPySha,
  publish_sh_sha256: publishShSha,
  archive_bytes: rawArchive.length,
  manifest_file_count: manifest.length,
  manifest
};

fs.writeFileSync(stagedManifestPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
try {
  fs.writeFileSync(releaseManifestPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
} catch {
  // Staged copy written to stagedManifestPath.
}
console.log(JSON.stringify({ ...summary, manifest: `[${manifest.length} pinned files]` }, null, 2));
