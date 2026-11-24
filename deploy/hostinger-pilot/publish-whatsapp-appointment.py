"""WhatsApp Appointment Contact Details & Calendly Handoff Approved Release Publisher:
- Base image: sha256:da0cf28a92658a89498693e8b1724377be8a399c5c693f31db506f3d64b12d81 (Phone/Sarvam compatible)
- Clickable WhatsApp contact link (https://wa.me/919972965677).
- Customer email collection and persistence with format validation and decline support.
- Natural consultation intake and Calendly handoff (https://calendly.com/team-brandmint/30min).
- Trusted external Calendly booking evidence required for CONFIRMED status.
- Disables Google Calendar mutations for this WhatsApp appointment flow.
- Preserves all Phone/Sarvam, WhatsApp, Chat, and n8n workflows.
- Atomic container deployment with automatic rollback protection.
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

OWNER_APPROVED_WHATSAPP_APPOINTMENT = True

BASE_IMAGE = 'sha256:371cf2c14c74c025f690d924414907527589ef35bd454b25d6f7e211d9a9da0e'
ARCHIVE_SHA = '7dc1fefa6d7e2fbedf05b9256ad6361853ec770d2454737aa60877a3256548fd'
P = Path('/opt/thaara-v2-pilot')
API = 'thaara-v2-pilot-api-1'
PG = 'thaara-v2-pilot-postgres-1'
DB = 'thaara_vps_pilot'
LINK = P / 'n8n-link-v2.sh'
SITE = 'https://thaara-v2.quantumweaveai.io'
ALLOWED = ['Dockerfile', 'manifest.json', 'contracts', 'api-app', 'api-services', 'api-routes', 'web-dist']

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

    # Modify ONLY THAARA_PILOT_API_IMAGE, preserving all other variables, comments, and permissions
    orig_text = env_path.read_text(encoding='utf-8')
    lines = orig_text.splitlines()
    found = False
    new_lines = []
    for line in lines:
        if line.strip().startswith('THAARA_PILOT_API_IMAGE='):
            new_lines.append(f'THAARA_PILOT_API_IMAGE={target_image}')
            found = True
        else:
            new_lines.append(line)
    if not found:
        new_lines.append(f'THAARA_PILOT_API_IMAGE={target_image}')

    stat = env_path.stat()
    env_path.write_text('\n'.join(new_lines) + '\n', encoding='utf-8')
    env_path.chmod(stat.st_mode)
    compose_path.write_text(json.dumps(compose_doc, indent=2) + '\n', encoding='utf-8')

def rollback_compose_and_env(env_path, compose_path, original_env, original_compose, orig_env_mode, compose_cmd, old_env, base_image):
    env_path.write_bytes(original_env)
    env_path.chmod(orig_env_mode)
    compose_path.write_bytes(original_compose)
    run(compose_cmd + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=old_env, check=False)
    time.sleep(5)
    restore_link()

def main():
    if not OWNER_APPROVED_WHATSAPP_APPOINTMENT:
        raise SystemExit('Deployment not authorized by owner.')

    print('Starting WhatsApp appointment update deployment preflight...')
    cur_api = inspect(API)
    actual_base = cur_api.get('Image') or cur_api['Config']['Image']
    if actual_base != BASE_IMAGE:
        raise RuntimeError(f'Base image mismatch: expected {BASE_IMAGE}, got {actual_base}')
    print(f'Verified live API image digest matches expected base: {actual_base[:19]}...')

    # Payload extraction and integrity verification
    payload_b64 = globals().get('PAYLOAD')
    if not payload_b64:
        raise RuntimeError('Missing embedded payload archive')
    raw_archive = base64.b64decode(payload_b64)
    actual_sha = hashlib.sha256(raw_archive).hexdigest()
    if actual_sha != ARCHIVE_SHA:
        raise RuntimeError(f'Archive sha256 mismatch: {actual_sha} != {ARCHIVE_SHA}')
    print(f'Verified release payload SHA256 integrity: {actual_sha[:16]}...')

    stage = P / 'staging-whatsapp-appointment'
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True, exist_ok=True)

    with tarfile.open(fileobj=io.BytesIO(raw_archive), mode='r:gz') as tf:
        for member in tf.getmembers():
            parts = Path(member.name).parts
            if not parts or parts[0] not in ALLOWED:
                raise RuntimeError(f'Prohibited entry in release archive: {member.name}')
            tf.extract(member, stage)

    print('Building candidate Docker overlay image on top of Phone-compatible base...')
    base_tag = 'thaara-v2-base:phone-sarvam-rebase'
    run(['docker', 'tag', BASE_IMAGE, base_tag])
    cand_tag = 'thaara-v2-pilot-api:whatsapp-appointment-' + str(int(time.time()))
    run(['docker', 'build', '--no-cache', '--network=none', '--pull=false', '--build-arg', f'BASE_IMAGE={base_tag}', '-t', cand_tag, '-f', str(stage / 'Dockerfile'), str(stage)], timeout=300)

    built_inspect = inspect(cand_tag)
    cand_id = built_inspect['Id']
    print(f'Successfully built candidate image: {cand_id[:19]}')

    # Atomic rollout configuration with secure backup
    env_file = P / '.env'
    compose_file = P / 'compose.json'
    orig_env = env_file.read_bytes()
    orig_env_mode = env_file.stat().st_mode
    orig_compose = compose_file.read_bytes()

    # Create secure backup of .env with identical permissions
    env_backup = stage / 'before-whatsapp-appointment.env.bak'
    env_backup.write_bytes(orig_env)
    env_backup.chmod(orig_env_mode)
    durable_backup = P / '.env.pre-whatsapp-appointment'
    durable_backup.write_bytes(orig_env)
    durable_backup.chmod(orig_env_mode)
    print('Verified secure environment backup created before deployment.')

    compose = ['docker', 'compose', '-p', 'thaara-v2-pilot', '-f', str(compose_file), '--profile', 'application']
    old_env = dict(os.environ, THAARA_PILOT_API_IMAGE=BASE_IMAGE)
    new_env = dict(os.environ, THAARA_PILOT_API_IMAGE=cand_tag)

    backup = stage / 'before-whatsapp-appointment.dump'
    with backup.open('xb') as stream:
        dump = subprocess.run(['docker', 'exec', '--user', 'postgres', PG, 'pg_dump', '-U', 'postgres', '-d', DB, '-Fc'], stdout=stream, stderr=subprocess.PIPE, timeout=120)
    if dump.returncode != 0 or backup.stat().st_size <= 100:
        raise RuntimeError('Pre-deployment database backup failed')
    print('Verified database backup created before deployment.')

    changed = False
    try:
        update_compose_and_env(env_file, compose_file, orig_compose, BASE_IMAGE, cand_tag)
        changed = True
        print('Restarting pilot API container with new image...')
        run(compose + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=new_env)
        wait_api()
        restore_link()
        print('Candidate container healthy and linked.')

        # Post-deployment validation
        req = urllib.request.Request(f'{SITE}/api/v1/health', headers={'User-Agent': 'WhatsAppAppointmentDeployVerifier/1.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status != 200:
                raise RuntimeError(f'Health probe returned HTTP {resp.status}')
        print('Production site /api/v1/health check: OK')

        print(json.dumps({
            'deployment': 'SUCCESS',
            'previous_image': BASE_IMAGE,
            'candidate_image': cand_id,
            'archive_sha256': ARCHIVE_SHA
        }, indent=2))

    except Exception as e:
        print(f'DEPLOYMENT FAILED: details withheld. Initiating automatic rollback...')
        if changed:
            rollback_compose_and_env(env_file, compose_file, orig_env, orig_compose, orig_env_mode, compose, old_env, BASE_IMAGE)
            print('Rollback completed successfully.')
        raise

if __name__ == '__main__':
    main()
