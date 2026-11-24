"""LOCAL check that the phone image starts on the pilot schema with the pilot's container limits.

Modes: no phone switches, durable only, live with synthetic secrets, live with an unsafe secret file. The containers share one
internal Docker network, so no provider or outside host is reachable and no call can be placed. Synthetic values only. Needs explicit owner approval.
"""
import base64
import json
import secrets
import subprocess
import sys
import time

import phone_backup_local_rehearsal as R
from phone_migration_local_rehearsal import SQL

IMAGE = sys.argv[1] if len(sys.argv) > 1 else 'thaara-v2-pilot-api:phone-110-web'
REPORT = R.ROOT / 'node_modules/.cache/phone-image-local-check.json'
PROBE = """const u='http://127.0.0.1:3002';const s=async(p,o)=>(await fetch(u+p,o)).status;
const out={health:await s('/api/v1/health'),page:await s('/integrations/phone'),root:await s('/'),phoneRequests:await s('/api/v1/connectors/phone/ai/requests'),whatsappConnections:await s('/api/v1/connectors/whatsapp/connections'),
sarvamHook:await s('/api/v1/connectors/phone/sarvam/calls/00000000-0000-4000-8000-000000000001/'+'0'.repeat(64),{method:'POST',headers:{'content-type':'application/json'},body:'{}'})};console.log(JSON.stringify(out));"""


def wrapper(values, unsafe):
    writes = ''.join("printf %%s '%s' > /run/secrets/%s; chmod 0400 /run/secrets/%s; " % (v, k, k) for k, v in values.items())
    if unsafe:
        writes += 'chmod 0644 /run/secrets/sarvam_api_key; '
    return writes + 'exec node pilot-start.mjs'


def start_api(mode, network, api_password):
    name = 'thaara-phone-imagecheck-api-' + secrets.token_hex(6)
    values = {'api_password': api_password, 'session_secret': secrets.token_urlsafe(48), 'csrf_secret': secrets.token_urlsafe(48)}
    env = {'NODE_ENV': 'development', 'THAARA_VPS_PILOT_ACK': 'isolated_synthetic_only', 'THAARA_WHATSAPP_SEND_ENABLED': 'false'}
    if mode != 'off':
        env['THAARA_PHONE_DURABLE'] = 'approved'
    if mode in ('live', 'unsafe'):
        env.update(THAARA_PHONE_LIVE_CALLING='approved', THAARA_SARVAM_PROFILE_FILE='/run/secrets/sarvam_profile', THAARA_SARVAM_API_KEY_FILE='/run/secrets/sarvam_api_key',
                   THAARA_SARVAM_WEBHOOK_SECRET_FILE='/run/secrets/sarvam_webhook_secret', THAARA_PHONE_CALLBACK_ORIGIN='https://thaara-v2.quantumweaveai.io')
        values.update(sarvam_api_key='synthetic-api-key-' + secrets.token_hex(8), sarvam_webhook_secret=secrets.token_urlsafe(48),
                      sarvam_profile=(R.ROOT / 'docs/integrations/phone/sarvam-runtime-profile.pilot.json').read_text(encoding='utf-8').replace("'", ''))
    args = ['run', '-d', '--pull=never', '--name', name, '--network', network, '--label', 'thaara.phone-rehearsal=imagecheck', '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges:true', '--memory', '512m', '--cpus', '0.5', '--pids-limit', '128', '--tmpfs', '/tmp:rw,noexec,nosuid,size=33554432,uid=1000,gid=1000',
            '--tmpfs', '/run/secrets:rw,noexec,nosuid,size=1048576,uid=1000,gid=1000']
    for key, value in env.items():
        args += ['-e', key + '=' + value]
    args += ['--entrypoint', 'sh', IMAGE, '-c', wrapper(values, mode == 'unsafe')]
    return name, R.docker(*args), values


def wait_health(container):
    for _ in range(60):
        probe = subprocess.run(['docker', 'exec', container, 'node', '-e', "fetch('http://127.0.0.1:3002/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], capture_output=True, timeout=30)
        if probe.returncode == 0:
            return True
        if R.docker('inspect', '--format', '{{.State.Running}}', container) != 'true':
            return False
        time.sleep(1)
    return False


def main():
    if R.docker('context', 'show') != 'desktop-linux':
        raise RuntimeError('refusing: not the local Docker Desktop context')
    nonce = secrets.token_hex(8)
    network = 'thaara-phone-imagecheck-' + nonce
    api_password = secrets.token_urlsafe(48)
    report = {'mode': 'local_image_check', 'image': R.docker('image', 'inspect', '--format', '{{.Id}}', IMAGE), 'vpsAccess': False, 'syntheticDataOnly': True, 'runs': []}
    source_id = None
    R.docker('network', 'create', '--internal', '--label', 'thaara.phone-rehearsal=' + nonce, network)
    try:
        source_id = R.create_source('thaara-phone-rehearsal-source-' + nonce, nonce, network, api_password)
        for step, stem in SQL.items():
            sql = (R.ROOT / 'docs/migrations' / (stem + '.review.sql')).read_bytes()
            guard = ("SELECT set_config('thaara.step%s_review_approved','yes',false), set_config('thaara.step%s_target_database',current_database(),false);\n" % (step, step)).encode()
            R.docker('exec', '-i', '--user', 'postgres', source_id, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-o', '/dev/null', '-U', 'postgres', '-d', 'thaara_vps_pilot', input=guard + sql)
        for mode in ('off', 'durable', 'live', 'unsafe'):
            name, container, values = start_api(mode, network, api_password)
            run = {'mode': mode}
            try:
                run['healthy'] = wait_health(container)
                if run['healthy']:
                    run['routes'] = json.loads(R.docker('exec', container, 'node', '--input-type=module', '-e', PROBE))
                logs = subprocess.run(['docker', 'logs', container], capture_output=True, timeout=30)
                text = (logs.stdout + logs.stderr).decode(errors='replace')
                run['logTail'] = text[-600:]
                run['secretInLogs'] = any(v in text for k, v in values.items() if k != 'sarvam_profile')
                run['memoryUsage'] = R.docker('stats', '--no-stream', '--format', '{{.MemUsage}}', container)
            finally:
                R.docker('rm', '-f', '-v', container, check=False)
            report['runs'].append(run)
    except Exception as error:
        report['harnessError'] = str(error)[:1000]
    finally:
        if source_id:
            R.docker('rm', '-f', '-v', source_id, check=False)
        R.docker('network', 'rm', network, check=False)
        report['containersLeft'] = R.docker('ps', '-a', '--filter', 'label=thaara.phone-rehearsal', '--format', '{{.Names}}').split()
    REPORT.write_text(json.dumps(report, indent=1, sort_keys=True), encoding='utf-8')
    print(json.dumps(report, indent=1, sort_keys=True))
    return 0 if 'harnessError' not in report else 1


if __name__ == '__main__':
    sys.exit(main())
