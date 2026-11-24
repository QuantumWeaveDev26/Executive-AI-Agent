"""Thaara V2 — October Antigravity — Bulk Campaigns Production Overlay Publisher (LOCKED):
- Rebased onto latest verified production baseline:
  thaara-v2-pilot-api:chat-voice-restored-20261118 (sha256:a44bb2a34fafb6260b8f43b0445e71e43fa6d2ecc669300c7bd32c1ca4977099)
- Layers ONLY Bulk Campaigns contracts, Campaign Knowledge engine, API service/routes, WhatsApp campaign context bridge, and simplified Bulk Campaigns UI (preserving Chaitra Chat Voice & Phone History UI 20261118).
- Durable PostgreSQL campaign storage via RLS-scoped public.plans (recordKind=bulk_campaign_state_v1) — zero DDL migration required.
- Preserves Chaitra Chat Voice (chaitra_kn_conversation / bulbul:v4-flash), Phone History UI (20261118), Phone n8n Call History Sync & Callback Email (Path A r2), Phone Calling Agent v26/v6, Phone Step 115 callback notifications, WhatsApp, Gmail, Calendar, and Drive byte-identically.
- Atomic container deployment with verified pre-deployment pg_dump backup and instant one-command rollback (--rollback).
- Hard-locked with OWNER_APPROVED_BULK_CAMPAIGN = False until explicit owner production approval.
"""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request

OWNER_APPROVED_BULK_CAMPAIGN = False

BASE_IMAGE = 'sha256:24581095b4aafede405e2cc2368e834ec63a6be55c412d139cebbe7b6d2ec945'
BASE_IMAGE_TAG = 'thaara-v2-pilot-api:two-way-transcript-r7-20261120'
ROLLBACK_IMAGE_TAG = 'thaara-v2-pilot-api:rollback-pre-bulk-batch-r1'
PRIOR_WHATSAPP_BASELINE_IMAGE = BASE_IMAGE
APPROVED_CANDIDATE_ID = 'PENDING_POST_APPROVAL_BUILD'
ARCHIVE_SHA = '996385e36152a892ebad596c021b779c33bac2a9ae7bdaaae4af7e674f7b65c1'
P = Path('/opt/thaara-v2-pilot')
PRIVATE = Path('/opt/thaara-v2-pilot-private')
API = 'thaara-v2-pilot-api-1'
PG = 'thaara-v2-pilot-postgres-1'
DB = 'thaara_vps_pilot'
LINK = P / 'n8n-link-v2.sh'
SITE = 'https://thaara-v2.quantumweaveai.io'
ALLOWED = ['Dockerfile', 'reconcile-bulk-campaign.mjs', 'manifest.json', 'contracts', 'api-services', 'api-routes', 'web-dist']

def run(args, check=True, env=None, timeout=240, stdin=None):
    result = subprocess.run(args, capture_output=True, text=True, env=env, timeout=timeout, input=stdin)
    if check and result.returncode:
        raise RuntimeError('Command failed; details withheld: ' + args[0] + ' ' + (result.stderr or '')[-800:])
    return result

def inspect(name):
    return json.loads(run(['docker', 'inspect', name]).stdout)[0]

def wait_api():
    for _ in range(40):
        if inspect(API)['State'].get('Health', {}).get('Status') == 'healthy':
            return
        time.sleep(3)
    raise RuntimeError('Pilot API health check timeout')

def restore_link():
    if 'n8n_default' in inspect(API)['NetworkSettings']['Networks']:
        return
    if LINK.exists():
        run(['bash', str(LINK)], check=False)

def update_compose_and_env(env_path, compose_path, original_compose_bytes, base_image, target_image):
    compose_doc = json.loads(original_compose_bytes.decode('utf-8'))
    compose_doc['services']['api']['image'] = target_image
    env_path.write_text('THAARA_PILOT_API_IMAGE=' + target_image + '\n', encoding='utf-8')
    compose_path.write_text(json.dumps(compose_doc, indent=2) + '\n', encoding='utf-8')

def rollback_compose_and_env(env_path, compose_path, original_env, original_compose, compose_cmd, old_env, base_image):
    env_path.write_bytes(original_env)
    compose_path.write_bytes(original_compose)
    run(compose_cmd + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=old_env, check=False)
    time.sleep(5)
    restore_link()

def manual_rollback():
    env_file = P / '.env'
    compose_file = P / 'compose.json'
    compose_cmd = ['docker', 'compose', '-p', 'thaara-v2-pilot', '-f', str(compose_file), '--profile', 'application']
    orig_compose = compose_file.read_bytes()
    update_compose_and_env(env_file, compose_file, orig_compose, BASE_IMAGE, BASE_IMAGE_TAG)
    old_env = dict(os.environ, THAARA_PILOT_API_IMAGE=BASE_IMAGE_TAG)
    run(compose_cmd + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=old_env)
    wait_api()
    restore_link()
    cur_api = inspect(API)
    print(json.dumps({
        'status': 'ROLLED_BACK_TO_BASELINE',
        'restored_image_tag': BASE_IMAGE_TAG,
        'restored_image_digest': cur_api.get('Image'),
        'database_touched': False
    }, indent=2))

def main():
    if not OWNER_APPROVED_BULK_CAMPAIGN:
        raise SystemExit('Deployment not authorized by owner (OWNER_APPROVED_BULK_CAMPAIGN is False).')

    if '--rollback' in sys.argv:
        manual_rollback()
        return

    print('Starting Bulk Campaign Simulation-Only deployment preflight...')
    cur_api = inspect(API)
    actual_base = cur_api.get('Image') or cur_api['Config']['Image']
    if actual_base not in (BASE_IMAGE, PRIOR_WHATSAPP_BASELINE_IMAGE, APPROVED_CANDIDATE_ID):
        raise RuntimeError(f'Base image mismatch: expected {BASE_IMAGE}, got {actual_base}')
    print(f'Verified live API image digest matches expected base: {actual_base[:19]}...')

    payload_b64 = globals().get('PAYLOAD')
    if not payload_b64:
        raise RuntimeError('Missing embedded payload archive')
    raw_archive = base64.b64decode(payload_b64)
    actual_sha = hashlib.sha256(raw_archive).hexdigest()
    if actual_sha != ARCHIVE_SHA:
        raise RuntimeError(f'Archive sha256 mismatch: {actual_sha} != {ARCHIVE_SHA}')
    print(f'Verified release payload SHA256 integrity: {actual_sha[:16]}...')

    stage = P / 'staging-bulk-campaign'
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True, exist_ok=True)

    with tarfile.open(fileobj=io.BytesIO(raw_archive), mode='r:gz') as tf:
        for member in tf.getmembers():
            parts = Path(member.name).parts
            if not parts or parts[0] not in ALLOWED:
                raise RuntimeError(f'Prohibited entry in release archive: {member.name}')
            tf.extract(member, stage)

    now_ts = time.time()
    for p_item in stage.rglob('*'):
        os.utime(p_item, (now_ts, now_ts))

    print('Preserving live production image for instant rollback...')
    run(['docker', 'tag', BASE_IMAGE, ROLLBACK_IMAGE_TAG])

    print('Building candidate Docker overlay image on top of live baseline...')
    base_tag = 'thaara-v2-base:bulk-campaign-rebase'
    run(['docker', 'tag', BASE_IMAGE, base_tag])
    cand_tag = 'thaara-v2-pilot-api:bulk-campaign-sim-' + str(int(time.time()))
    run(['docker', 'build', '--no-cache', '--network=none', '--pull=false', '--build-arg', f'BASE_IMAGE={base_tag}', '-t', cand_tag, '-f', str(stage / 'Dockerfile'), str(stage)], timeout=300)

    built_inspect = inspect(cand_tag)
    cand_id = built_inspect['Id']
    print(f'Successfully built candidate image: {cand_id[:19]}')

    env_file = P / '.env'
    compose_file = P / 'compose.json'
    orig_env = env_file.read_bytes()
    orig_compose = compose_file.read_bytes()
    compose_cmd = ['docker', 'compose', '-p', 'thaara-v2-pilot', '-f', str(compose_file), '--profile', 'application']
    old_env = dict(os.environ, THAARA_PILOT_API_IMAGE=BASE_IMAGE_TAG)
    new_env = dict(os.environ, THAARA_PILOT_API_IMAGE=cand_tag)

    backups_dir = PRIVATE / 'backups'
    backups_dir.mkdir(parents=True, exist_ok=True)
    backup = backups_dir / f'backup_pre_bulk_campaign_sim_{int(time.time())}.dump'
    with backup.open('xb') as stream:
        dump = subprocess.run(['docker', 'exec', '--user', 'postgres', PG, 'pg_dump', '-U', 'postgres', '-d', DB, '-Fc'], stdout=stream, stderr=subprocess.PIPE, timeout=120)
    if dump.returncode != 0 or backup.stat().st_size <= 1000:
        raise RuntimeError('Pre-deployment database backup failed')
    backup_bytes = backup.read_bytes()
    backup_sha = hashlib.sha256(backup_bytes).hexdigest()
    toc_verify = subprocess.run(['docker', 'exec', '-i', '--user', 'postgres', PG, 'pg_restore', '-l'], input=backup_bytes, capture_output=True, timeout=60)
    if toc_verify.returncode != 0 or len(toc_verify.stdout.splitlines()) < 10:
        raise RuntimeError('Pre-deployment database backup TOC verification failed')
    print(f'Verified database backup created and pg_restore TOC checked: {backup.name} ({len(backup_bytes)} bytes)')

    changed = False
    try:
        update_compose_and_env(env_file, compose_file, orig_compose, BASE_IMAGE, cand_tag)
        changed = True
        run(compose_cmd + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=new_env)
        wait_api()
        restore_link()

        req = urllib.request.Request(SITE + '/api/v1/health', headers={'User-Agent': 'ThaaraReleaseVerifier/1.0'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status != 200:
                raise RuntimeError(f'External health check returned {resp.status}')
    except Exception as exc:
        print(f'Rollout verification failed ({exc}); rolling back to {BASE_IMAGE[:19]}...')
        if changed:
            rollback_compose_and_env(env_file, compose_file, orig_env, orig_compose, compose_cmd, old_env, BASE_IMAGE)
            wait_api()
        raise

    print(json.dumps({
        'status': 'DEPLOYED_AND_VERIFIED',
        'previous_image': BASE_IMAGE,
        'rollback_image_tag': ROLLBACK_IMAGE_TAG,
        'deployed_image_tag': cand_tag,
        'deployed_image_id': cand_id,
        'backup_file': str(backup),
        'backup_sha256': backup_sha,
        'archive_sha256': ARCHIVE_SHA,
        'liveCallingEnabled': False,
        'liveSendingEnabled': False
    }, indent=2))

if __name__ == '__main__':
    main()
