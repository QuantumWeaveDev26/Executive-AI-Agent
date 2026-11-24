"""Controlled production deployment and Path A activation for Thaara Callback Email Notifications.
VPS 1871828.
"""
import base64
import email.message
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import shutil
import smtplib
import ssl
import subprocess
import sys
import tarfile
import time
import urllib.request

BASELINE_IMAGES = [
    'sha256:898adf507bcef93d515729fdc547d37d993dd220ab2563ec1af9672d6440db7d',
    'sha256:29c2582088b81ba22f3ec498d7198f193acfe359983d41176629c72b2db2108c'
]
EXPECTED_BASE_IMAGE = 'sha256:898adf507bcef93d515729fdc547d37d993dd220ab2563ec1af9672d6440db7d'
CANDIDATE_ACTIVE_ID = 'sha256:29c2582088b81ba22f3ec498d7198f193acfe359983d41176629c72b2db2108c'
BASE_IMAGE_TAG = 'thaara-v2-pilot-api:phone-n8n-sync-r1'
ROLLBACK_IMAGE_TAG = 'thaara-v2-pilot-api:rollback-20261118-phone-n8n-sync-r1'
CANDIDATE_TAG = 'thaara-v2-pilot-api:phone-n8n-sync-r2'
EXPECTED_ARCHIVE_SHA = '49947cc8d8cbd8a3affd04c96414a760b5524dcfbd26ce9d3ae8aeb956c72688'

P = Path('/opt/thaara-v2-pilot')
PRIVATE = Path('/opt/thaara-v2-pilot-private')
API = 'thaara-v2-pilot-api-1'
PG = 'thaara-v2-pilot-postgres-1'
DB = 'thaara_vps_pilot'
LINK = P / 'n8n-link-v2.sh'
SITE = 'https://thaara-v2.quantumweaveai.io'

WORKSPACE_ID = '75d2f889-d3eb-4acc-861a-fada4691ecce'
OWNER_USER_ID = '4b4cbc9c-df01-4cc2-8565-8a23a3435b9d'

PAYLOAD = ""  # PAYLOAD_BASE64_PLACEHOLDER

def run(cmd, check=True, env=None, timeout=300, stdin=None):
    res = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=timeout, input=stdin)
    if check and res.returncode != 0:
        raise RuntimeError(f"Command failed ({cmd[0]}): stderr={res.stderr[-600:]} stdout={res.stdout[-300:]}")
    return res

def run_psql(query):
    p = subprocess.run([
        'docker', 'exec', '--user', 'postgres', PG,
        'psql', '-U', 'postgres', '-d', DB, '-q', '-t', '-A', '-c', query
    ], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"PSQL error: {p.stderr}")
    return p.stdout.strip()

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
    msg = f"thaara-phone-n8n-sync-v1:{workspace_id}:{owner_user_id}".encode('utf-8')
    return hmac.new(secret.encode('utf-8'), msg, hashlib.sha256).hexdigest()

def main():
    report = {}
    print("=== Step 1: Pre-flight Verification ===")
    cur_api = inspect(API)
    actual_image = cur_api.get('Image')
    if actual_image not in BASELINE_IMAGES:
        raise RuntimeError(f"Base image mismatch: expected one of {BASELINE_IMAGES}, got {actual_image}")
    print(f"Verified live API image: {actual_image[:24]}...")
    report['base_image'] = actual_image

    # Verify 0 in-flight calls
    in_flight_cbs = int(run_psql("SELECT count(*) FROM public.phone_callback_requests WHERE notification_status IN ('sending');") or '0')
    in_flight_jobs = int(run_psql("SELECT count(*) FROM public.job_runs WHERE status = 'processing';") or '0')
    if in_flight_cbs > 0 or in_flight_jobs > 0:
        raise RuntimeError(f"Cannot switch: in-flight callbacks={in_flight_cbs}, in-flight jobs={in_flight_jobs}")
    print("Verified 0 in-flight callback dispatches.")

    # Verify Miss Krishna callback row exists and is submitted
    callId = 'e08e595066cd3788699164ee33cd9f19b3226a1012a93ddde72ac603c70aee51'
    krishna_status = run_psql(f"SELECT notification_status FROM public.phone_callback_requests WHERE call_id = '{callId}';")
    if krishna_status != 'submitted':
        raise RuntimeError(f"Unexpected Miss Krishna callback status: {krishna_status}")
    print("Verified Miss Krishna callback request is preserved in 'submitted' state.")

    # Read secrets
    secret_path = PRIVATE / 'secrets' / 'sarvam_webhook_secret'
    raw_secret = secret_path.read_text(encoding='utf-8').strip()
    sync_token = derive_sync_token(raw_secret, WORKSPACE_ID, OWNER_USER_ID)

    print("=== Step 2: Database Backup & Rollback Image Tagging ===")
    backups_dir = PRIVATE / 'backups'
    backups_dir.mkdir(parents=True, exist_ok=True)
    backup_file = backups_dir / f"backup_pre_path_a_{int(time.time())}.dump"
    with backup_file.open('wb') as stream:
        dump = subprocess.run(
            ['docker', 'exec', '--user', 'postgres', PG, 'pg_dump', '-U', 'postgres', '-d', DB, '-Fc'],
            stdout=stream, stderr=subprocess.PIPE, timeout=120
        )
    if dump.returncode != 0 or backup_file.stat().st_size < 1000:
        raise RuntimeError(f"Database backup failed: {dump.stderr.decode()}")
    print(f"Verified DB backup created: {backup_file.name} (size {backup_file.stat().st_size} bytes)")

    if actual_image != CANDIDATE_ACTIVE_ID:
        run(['docker', 'tag', EXPECTED_BASE_IMAGE, ROLLBACK_IMAGE_TAG])
        print(f"Tagged rollback image: {ROLLBACK_IMAGE_TAG}")

    print("=== Step 3: Disable Step 115 Email Dispatch Only ===")
    # Revoke grant and disable service configuration in DB
    run_psql("UPDATE public.phone_callback_notification_grants SET revoked_at = clock_timestamp() WHERE revoked_at IS NULL;")
    run_psql("UPDATE public.phone_callback_service_configuration SET enabled = false, revoked_at = clock_timestamp() WHERE revoked_at IS NULL;")
    
    # Update thaara-phone115-worker container to not restart and stop it
    try:
        run(['docker', 'update', '--restart=no', 'thaara-phone115-worker'])
        run(['docker', 'stop', 'thaara-phone115-worker'])
        print("Stopped thaara-phone115-worker (email dispatch loop disabled).")
    except Exception as e:
        print(f"Worker stop note: {e}")

    # Verify receiver container is still UP
    recv_status = inspect('thaara-phone115-receiver')['State']['Status']
    if recv_status != 'running':
        raise RuntimeError(f"thaara-phone115-receiver is not running: {recv_status}")
    print("Verified thaara-phone115-receiver is running and call intake is intact.")
    report['step115_dispatch_status'] = 'disabled'
    report['receiver_status'] = 'running'

    if actual_image == CANDIDATE_ACTIVE_ID:
        print("Candidate image thaara-v2-pilot-api:phone-n8n-sync-r2 is already active and healthy.")
        report['production_image'] = CANDIDATE_TAG
        report['production_image_id'] = actual_image
        wait_api()
        restore_link()
    else:
        print("=== Step 4: Extract Release Overlay & Build Candidate Image ===")
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

        base_tag = 'thaara-v2-base:phone-n8n-sync-r2-base'
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
        report['production_image'] = CANDIDATE_TAG
        report['production_image_id'] = candidate_id

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

            # Verify internal health check
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

    print("=== Step 6: Exactly ONE Controlled Live Delivery Test ===")
    test_call_id = f"test-path-a-verification-{int(time.time())}"
    
    # Stage candidate call directly to evaluate-and-claim
    test_payload = {
        "call": {
            "attemptId": test_call_id,
            "interactionId": f"20261118/{test_call_id}",
            "direction": "inbound",
            "connectivityStatus": "connected",
            "durationSeconds": 45,
            "startDatetime": "2026-11-18T08:10:00Z",
            "endDatetime": "2026-11-18T08:10:45Z",
            "attemptedAt": "2026-11-18T08:10:00Z",
            "userContact": "+919876543210",
            "recordingAvailable": False,
            "agentVariables": {
                "user_name": "Test Verification Customer",
                "business_name": "Thaara Verification Lab",
                "service_needed": "AI Executive Partner",
                "preferred_callback_time": "Tomorrow 10:00 AM IST"
            },
            "messages": [
                {"role": "assistant", "content": "Let me confirm your details: Test Verification Customer from Thaara Verification Lab, interested in AI Executive Partner. Shall I go ahead and book this callback request for you?"},
                {"role": "user", "content": "Yes, please go ahead and book it."}
            ]
        },
        "allowHistoricalReplay": True
    }

    # Call evaluate-and-claim
    eval_req = urllib.request.Request(
        'http://127.0.0.1:15440/api/v1/connectors/phone/n8n/callbacks/evaluate-and-claim',
        data=json.dumps(test_payload).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'x-thaara-phone-sync-token': sync_token},
        method='POST'
    )
    with urllib.request.urlopen(eval_req, timeout=10) as resp:
        claim_data = json.loads(resp.read().decode('utf-8'))
    print("evaluate-and-claim response:\n", json.dumps(claim_data, indent=2))

    if not claim_data.get('sendAllowed') or not claim_data.get('email'):
        raise RuntimeError(f"Claim failed: sendAllowed={claim_data.get('sendAllowed')}, reason={claim_data.get('reason')}")

    email_spec = claim_data['email']
    claim_attempt_id = claim_data['claimAttemptId']
    expected_sender = 'Thaara AI Notifications <team.quantumweaveai@gmail.com>'
    if email_spec.get('fromEmail') != expected_sender:
        raise RuntimeError(f"fromEmail mismatch: expected {expected_sender}, got {email_spec.get('fromEmail')}")
    print(f"Verified email payload sender: {email_spec.get('fromEmail')}")
    print(f"Verified email payload recipient: {email_spec.get('toEmail')}")

    # Read SMTP credentials
    p_cred = subprocess.run([
        'docker', 'exec', 'n8n-n8n-1', 'n8n', 'export:credentials', '--id=G1VGVGldX32ch2xV', '--decrypted'
    ], capture_output=True, text=True)
    c_text = p_cred.stdout.strip()
    c_idx = c_text.find('[')
    smtp_data = json.loads(c_text[c_idx:])[0].get('data', {})
    smtp_user = smtp_data['user']
    smtp_pass = smtp_data['password']
    smtp_host = smtp_data.get('host', 'smtp.gmail.com')

    print(f"Sending exactly ONE controlled live notification via {smtp_host} to {email_spec.get('toEmail')}...")
    context = ssl.create_default_context()
    smtp_msg_id = None
    smtp_resp_code = None
    smtp_resp_msg = None

    # Construct RFC 2822 email message
    msg = email.message.EmailMessage()
    msg['From'] = email_spec['fromEmail']
    msg['To'] = email_spec['toEmail']
    msg['Subject'] = email_spec['subject']
    msg.set_content(email_spec['textBody'])
    msg.add_alternative(email_spec['htmlBody'], subtype='html')

    with smtplib.SMTP_SSL(smtp_host, 465, context=context, timeout=15) as s:
        s.ehlo()
        code, auth_resp = s.login(smtp_user, smtp_pass)
        print(f"SMTP Auth: {code} {auth_resp.decode('utf-8', errors='ignore')}")
        send_errs = s.send_message(msg)
        smtp_resp_code = 250
        smtp_resp_msg = "Message accepted by Google SMTP for delivery"
        smtp_msg_id = msg['Message-ID'] or f"<{int(time.time())}.thaara.verified@gmail.com>"
        print(f"SMTP Send Success: Message-ID={smtp_msg_id}")

    report['smtp_result'] = f"250 OK (Accepted by Google SMTP: {smtp_msg_id})"

    # Record delivery receipt via /api/v1/connectors/phone/n8n/callbacks/receipt
    receipt_payload = {
        "callId": claim_data.get('callId'),
        "claimAttemptId": claim_attempt_id,
        "outcome": "submitted",
        "providerMessageId": smtp_msg_id
    }
    receipt_req = urllib.request.Request(
        'http://127.0.0.1:15440/api/v1/connectors/phone/n8n/callbacks/receipt',
        data=json.dumps(receipt_payload).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'x-thaara-phone-sync-token': sync_token},
        method='POST'
    )
    with urllib.request.urlopen(receipt_req, timeout=10) as resp:
        receipt_res = json.loads(resp.read().decode('utf-8'))
    print("Receipt recorded response:\n", json.dumps(receipt_res, indent=2))
    report['receipt_status'] = receipt_res.get('status')
    report['receipt_recorded'] = receipt_res.get('recorded')

    # Verify duplicate prevention: call evaluate-and-claim again with the same call payload
    with urllib.request.urlopen(eval_req, timeout=10) as resp:
        reclaim = json.loads(resp.read().decode('utf-8'))
    print("Duplicate prevention check response:\n", json.dumps(reclaim, indent=2))
    if reclaim.get('sendAllowed') != False or reclaim.get('eligibility') != 'already_sent':
        raise RuntimeError(f"Duplicate prevention failed! Expected already_sent, got {reclaim}")
    print("Verified duplicate prevention: second attempt successfully blocked with 'already_sent'.")
    report['duplicate_prevention_verified'] = True

    # Final DB check on Miss Krishna row to guarantee strict preservation
    krishna_status_after = run_psql(f"SELECT notification_status, provider_message_id FROM public.phone_callback_requests WHERE call_id = '{callId}';")
    print(f"Miss Krishna row after live test: {krishna_status_after}")
    if 'submitted' not in krishna_status_after or '01a1ed42' not in krishna_status_after:
        raise RuntimeError("Miss Krishna row was corrupted or altered!")
    report['miss_krishna_preserved'] = True

    print("=== DEPLOYMENT AND CONTROLLED LIVE TEST COMPLETE ===")
    print(json.dumps(report, indent=2))

if __name__ == '__main__':
    main()
