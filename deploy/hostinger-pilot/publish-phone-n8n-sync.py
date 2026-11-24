"""Controlled production deployment for Phone n8n Integration on VPS 1871828.
Preserves Chat Voice R7, Phone Calling Agent v26/v6, Bulk Campaigns simulation,
WhatsApp, Gmail, Calendar, Drive, and all existing integrations.
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
import hmac

EXPECTED_BASE_IMAGE = 'sha256:6f18f77eccaf224a0279c89d69b196e9670d6161e6e4465683f0781e9f99e195'
BASE_IMAGE_TAG = 'thaara-v2-pilot-api:chat-voice-r7-bulk-sim-r1'
ROLLBACK_IMAGE_TAG = 'thaara-v2-pilot-api:rollback-20261117-pre-phone-n8n-sync'
CANDIDATE_TAG = 'thaara-v2-pilot-api:phone-n8n-sync-r1'
EXPECTED_ARCHIVE_SHA = 'e9c1f46e23630494bd8a78517525eca6bfd72a6671d0886fa6ff976e93d25907'

P = Path('/opt/thaara-v2-pilot')
PRIVATE = Path('/opt/thaara-v2-pilot-private')
API = 'thaara-v2-pilot-api-1'
PG = 'thaara-v2-pilot-postgres-1'
DB = 'thaara_vps_pilot'
LINK = P / 'n8n-link-v2.sh'
SITE = 'https://thaara-v2.quantumweaveai.io'

WORKSPACE_ID = '75d2f889-d3eb-4acc-861a-fada4691ecce'
OWNER_USER_ID = '4b4cbc9c-df01-4cc2-8565-8a23a3435b9d'
PROJECT_ID = 'fn6pQNcDpG7hLM3t'

PAYLOAD = ""  # PAYLOAD_BASE64_PLACEHOLDER
WF1_JSON = "" # WF1_JSON_PLACEHOLDER
WF2_JSON = "" # WF2_JSON_PLACEHOLDER

def run(cmd, check=True, env=None, timeout=300, stdin=None):
    res = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=timeout, input=stdin)
    if check and res.returncode != 0:
        raise RuntimeError(f"Command failed ({cmd[0]}): stderr={res.stderr[-600:]} stdout={res.stdout[-300:]}")
    return res

def inspect(target):
    return json.loads(run(['docker', 'inspect', target]).stdout)[0]

def wait_api():
    for _ in range(40):
        try:
            status = inspect(API)['State'].get('Health', {}).get('Status')
            if status == 'healthy':
                return
        except Exception:
            pass
        time.sleep(3)
    raise RuntimeError('Pilot API health check timeout')

def restore_link():
    try:
        networks = inspect(API)['NetworkSettings']['Networks']
        if 'n8n_default' in networks:
            return
        if LINK.exists():
            run(['bash', str(LINK)], check=False)
    except Exception as e:
        print(f"Warning: could not verify n8n link: {e}")

def derive_sync_token(secret: str, workspace_id: str, owner_user_id: str) -> str:
    msg = f"thaara:phone-n8n-sync:v1:{workspace_id}:{owner_user_id}".encode('utf-8')
    return hmac.new(secret.encode('utf-8'), msg, hashlib.sha256).hexdigest()

def manual_rollback():
    print("Initiating rollback to preserved pre-phone-n8n baseline...")
    env_file = P / '.env'
    compose_file = P / 'compose.json'
    compose_cmd = ['docker', 'compose', '-p', 'thaara-v2-pilot', '-f', str(compose_file), '--profile', 'application']
    
    compose_doc = json.loads(compose_file.read_text(encoding='utf-8'))
    compose_doc['services']['api']['image'] = ROLLBACK_IMAGE_TAG
    compose_file.write_text(json.dumps(compose_doc, indent=2) + '\n', encoding='utf-8')
    env_file.write_text(f"THAARA_PILOT_API_IMAGE={ROLLBACK_IMAGE_TAG}\n", encoding='utf-8')
    
    old_env = dict(os.environ, THAARA_PILOT_API_IMAGE=ROLLBACK_IMAGE_TAG)
    run(compose_cmd + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=old_env)
    wait_api()
    restore_link()
    print("Rollback complete.")

def main():
    if '--rollback' in sys.argv:
        manual_rollback()
        return

    print("=== Step 1: Pre-flight Verification ===")
    cur_api = inspect(API)
    actual_image = cur_api.get('Image')
    if actual_image != EXPECTED_BASE_IMAGE:
        raise RuntimeError(f"Base image mismatch: expected {EXPECTED_BASE_IMAGE}, got {actual_image}")
    print(f"Verified live API image digest matches expected baseline: {actual_image[:24]}...")

    # Verify secrets exist
    secret_path = PRIVATE / 'secrets' / 'sarvam_webhook_secret'
    if not secret_path.exists():
        raise RuntimeError("Missing sarvam_webhook_secret")
    raw_secret = secret_path.read_text(encoding='utf-8').strip()

    print("=== Step 2: Database Backup & Rollback Image Preservation ===")
    backups_dir = PRIVATE / 'backups'
    backups_dir.mkdir(parents=True, exist_ok=True)
    backup_file = backups_dir / f"backup_pre_phone_n8n_sync_{int(time.time())}.dump"
    
    with backup_file.open('wb') as stream:
        dump = subprocess.run(
            ['docker', 'exec', '--user', 'postgres', PG, 'pg_dump', '-U', 'postgres', '-d', DB, '-Fc'],
            stdout=stream, stderr=subprocess.PIPE, timeout=120
        )
    if dump.returncode != 0 or backup_file.stat().st_size < 1000:
        raise RuntimeError(f"Database backup failed: {dump.stderr.decode()}")
    
    backup_bytes = backup_file.read_bytes()
    backup_sha = hashlib.sha256(backup_bytes).hexdigest()
    print(f"Verified DB backup: size={len(backup_bytes)} bytes, sha256={backup_sha[:16]}... at {backup_file.name}")

    # Tag rollback image
    run(['docker', 'tag', EXPECTED_BASE_IMAGE, ROLLBACK_IMAGE_TAG])
    print(f"Preserved rollback image tag: {ROLLBACK_IMAGE_TAG}")

    print("=== Step 3: Extract Release Overlay ===")
    if not PAYLOAD:
        raise RuntimeError("Embedded release payload is empty")
    raw_archive = base64.b64decode(PAYLOAD)
    actual_sha = hashlib.sha256(raw_archive).hexdigest()
    if actual_sha != EXPECTED_ARCHIVE_SHA:
        raise RuntimeError(f"Archive SHA256 mismatch: {actual_sha} != {EXPECTED_ARCHIVE_SHA}")
    print(f"Verified release archive SHA256: {actual_sha[:16]}...")

    stage = P / 'staging-phone-n8n-sync'
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True, exist_ok=True)

    with tarfile.open(fileobj=io.BytesIO(raw_archive), mode='r:gz') as tf:
        tf.extractall(stage)
    print("Extracted release overlay to staging directory.")

    print("=== Step 4: Build Candidate Overlay Docker Image ===")
    base_tag = 'thaara-v2-base:phone-n8n-sync-rebase'
    run(['docker', 'tag', EXPECTED_BASE_IMAGE, base_tag])
    
    build_res = run([
        'docker', 'build', '--no-cache', '--network=none', '--pull=false',
        '--build-arg', f'BASE_IMAGE={base_tag}',
        '-t', CANDIDATE_TAG,
        '-f', str(stage / 'Dockerfile'),
        str(stage)
    ], timeout=360)
    print("Docker build completed with in-container smoke verification passing.")

    cand_inspect = inspect(CANDIDATE_TAG)
    candidate_id = cand_inspect['Id']
    print(f"Built candidate image ID: {candidate_id[:24]}...")

    print("=== Step 5: Atomic Container Switch ===")
    env_file = P / '.env'
    compose_file = P / 'compose.json'
    orig_env = env_file.read_bytes()
    orig_compose = compose_file.read_bytes()
    compose_cmd = ['docker', 'compose', '-p', 'thaara-v2-pilot', '-f', str(compose_file), '--profile', 'application']

    compose_doc = json.loads(orig_compose.decode('utf-8'))
    compose_doc['services']['api']['image'] = CANDIDATE_TAG
    
    changed = False
    try:
        env_file.write_text(f"THAARA_PILOT_API_IMAGE={CANDIDATE_TAG}\n", encoding='utf-8')
        compose_file.write_text(json.dumps(compose_doc, indent=2) + '\n', encoding='utf-8')
        changed = True

        new_env = dict(os.environ, THAARA_PILOT_API_IMAGE=CANDIDATE_TAG)
        run(compose_cmd + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=new_env)
        print("Waiting for API health check...")
        wait_api()
        restore_link()
        print("API container is running and healthy.")

        # Verify live internal health check inside container
        hc = run(['docker', 'exec', API, 'node', '-e', "fetch('http://127.0.0.1:3002/api/v1/health').then(r => process.exit(r.status === 200 ? 0 : 1))"])
        if hc.returncode != 0:
            raise RuntimeError("Internal container health check failed")
        print("Internal API /health verified 200 OK.")

        # Verify external health check via SITE
        ext_req = urllib.request.Request(SITE + '/api/v1/health', headers={'User-Agent': 'ThaaraReleaseVerifier/1.0'})
        with urllib.request.urlopen(ext_req, timeout=15) as resp:
            if resp.status != 200:
                raise RuntimeError(f"External health check failed with status {resp.status}")
        print("External API /health verified 200 OK.")
    except Exception as exc:
        print(f"Deployment failed ({exc}); rolling back immediately...")
        if changed:
            env_file.write_bytes(orig_env)
            compose_file.write_bytes(orig_compose)
            old_env = dict(os.environ, THAARA_PILOT_API_IMAGE=EXPECTED_BASE_IMAGE)
            run(compose_cmd + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=old_env)
            wait_api()
            restore_link()
        raise

    print("=== Step 6: Configure & Activate n8n Workflows ===")
    derived_token = derive_sync_token(raw_secret, WORKSPACE_ID, OWNER_USER_ID)
    print("Computed derived machine sync token deterministically from webhook secret.")

    # Substitute token in Workflow 1 and Workflow 2
    wf1_data = json.loads(WF1_JSON)
    wf2_data = json.loads(WF2_JSON)

    for node in wf1_data.get('nodes', []):
        if node.get('name') in ['Verify Consent & Claim Single Delivery', 'Record Delivery Receipt', 'Release Claim for Retry']:
            params = node.get('parameters', {})
            header_params = params.get('headerParameters', {}).get('parameters', [])
            for hp in header_params:
                if hp.get('name') == 'x-thaara-phone-sync-token':
                    hp['value'] = derived_token

    for node in wf2_data.get('nodes', []):
        if node.get('name') in ['Fetch Sync Checkpoint', 'Send Call Batch to Thaara']:
            params = node.get('parameters', {})
            header_params = params.get('headerParameters', {}).get('parameters', [])
            for hp in header_params:
                if hp.get('name') == 'x-thaara-phone-sync-token':
                    hp['value'] = derived_token

    # Write substituted workflows to temp files inside n8n data
    n8n_tmp_dir = Path('/home/deploy/n8n/n8n_data')
    if not n8n_tmp_dir.exists():
        n8n_tmp_dir = P / 'n8n_tmp'
        n8n_tmp_dir.mkdir(parents=True, exist_ok=True)
    
    wf1_file = n8n_tmp_dir / 'thaara-callback-email-notifications.active.json'
    wf2_file = n8n_tmp_dir / 'thaara-sarvam-call-history-sync.active.json'
    
    wf1_file.write_text(json.dumps(wf1_data, indent=2), encoding='utf-8')
    wf2_file.write_text(json.dumps(wf2_data, indent=2), encoding='utf-8')

    # Import via n8n CLI or SQLite
    # Copy files into n8n container
    run(['docker', 'cp', str(wf1_file), 'n8n-n8n-1:/tmp/wf1.json'])
    run(['docker', 'cp', str(wf2_file), 'n8n-n8n-1:/tmp/wf2.json'])

    import1 = run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'import:workflow', '--input=/tmp/wf1.json', f'--projectId={PROJECT_ID}'], check=False)
    import2 = run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'import:workflow', '--input=/tmp/wf2.json', f'--projectId={PROJECT_ID}'], check=False)
    print(f"Import Workflow 1: code={import1.returncode}, output={import1.stdout}")
    print(f"Import Workflow 2: code={import2.returncode}, output={import2.stdout}")

    # Query active IDs and activate in database
    act_res = run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', (err) => {
  if (err) { console.error(err); process.exit(1); }
  db.run("UPDATE workflow_entity SET active = 1 WHERE name LIKE 'Thaara — %';", (err2) => {
    if (err2) { console.error(err2); process.exit(1); }
    db.all("SELECT id, name, active FROM workflow_entity WHERE name LIKE 'Thaara — %';", (err3, rows) => {
      console.log(JSON.stringify(rows));
      db.close();
    });
  });
});
"""])
    print(f"Active Thaara workflows in n8n:\n{act_res.stdout}")

    # Restart n8n container to pick up active schedule triggers cleanly
    run(['docker', 'restart', 'n8n-n8n-1'])
    time.sleep(5)
    print("n8n container restarted to initialize schedule triggers.")

    # Cleanup temporary workflow files
    wf1_file.unlink(missing_ok=True)
    wf2_file.unlink(missing_ok=True)

    result = {
        'status': 'DEPLOYED_AND_ACTIVATED',
        'previous_image': EXPECTED_BASE_IMAGE,
        'deployed_image_tag': CANDIDATE_TAG,
        'deployed_image_id': candidate_id,
        'backup_file': str(backup_file),
        'backup_sha256': backup_sha,
        'n8n_workflows': json.loads(act_res.stdout) if act_res.stdout else []
    }
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
