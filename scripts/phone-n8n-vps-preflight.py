"""Read-only preflight inspection for Phone n8n Integration on VPS 1871828."""
import json
import subprocess
import os
import hashlib

def run(cmd, inp=None):
    p = subprocess.run(cmd, input=inp, capture_output=True, text=True, timeout=30)
    return p.returncode, p.stdout.strip(), p.stderr.strip()

out = {}

# 1. Containers check
containers = [
    'thaara-v2-pilot-api-1',
    'thaara-v2-pilot-postgres-1',
    'thaara-v2-pilot-redis-1',
    'thaara-phone115-receiver',
    'thaara-phone115-worker',
    'n8n-n8n-1',
    'n8n-traefik-1'
]

container_info = {}
for c in containers:
    rc, stdout, _ = run(['docker', 'inspect', '--format', '{{.Id}}|{{.Image}}|{{.State.Status}}|{{.State.Health.Status}}|{{.RestartCount}}', c])
    if rc == 0:
        parts = stdout.split('|')
        container_info[c] = {
            'id': parts[0][:12],
            'image': parts[1],
            'status': parts[2],
            'health': parts[3] if len(parts) > 3 else None,
            'restarts': parts[4] if len(parts) > 4 else None
        }
    else:
        container_info[c] = {'status': 'not_found'}
out['containers'] = container_info

# 2. Check deployment lock
lock_paths = [
    '/opt/thaara-v2-pilot/deploy.lock',
    '/opt/thaara-v2-pilot/.lock',
    '/tmp/thaara-deploy.lock',
    '/tmp/phone-step115.lock'
]
locks = {}
for lp in lock_paths:
    locks[lp] = os.path.exists(lp)
out['locks'] = locks

# 3. Check secrets existence and non-emptiness (WITHOUT revealing values)
secret_paths = [
    '/opt/thaara-v2-pilot-private/secrets/sarvam_api_key',
    '/opt/thaara-v2-pilot-private/secrets/sarvam_app_id',
    '/opt/thaara-v2-pilot-private/secrets/sarvam_workspace_id',
    '/opt/thaara-v2-pilot-private/secrets/sarvam_org_id',
    '/opt/thaara-v2-pilot-private/secrets/sarvam_webhook_secret',
    '/opt/thaara-v2-pilot-private/secrets/resend_api_key',
    '/opt/thaara-v2-pilot-private/secrets/session_secret'
]
sec_status = {}
for sp in secret_paths:
    if os.path.exists(sp):
        st = os.stat(sp)
        sec_status[os.path.basename(sp)] = {'exists': True, 'size': st.st_size}
    else:
        sec_status[os.path.basename(sp)] = {'exists': False}
out['secrets'] = sec_status

# 4. Check active n8n workflows and credentials via docker exec n8n-n8n-1
n8n_check = {}
rc, n8n_wf, _ = run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const fs = require('fs');
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  if (err) { console.log(JSON.stringify({error: err.message})); process.exit(1); }
  db.all('SELECT id, name, active FROM workflow_entity;', (err, rows) => {
    if (err) { console.log(JSON.stringify({error: err.message})); process.exit(1); }
    db.all('SELECT id, name, type FROM credentials_entity;', (err2, creds) => {
      console.log(JSON.stringify({workflows: rows, credentials: creds}));
      db.close();
    });
  });
});
"""])
if rc == 0:
    try:
        n8n_check = json.loads(n8n_wf)
    except Exception as e:
        n8n_check = {'raw': n8n_wf, 'error': str(e)}
else:
    n8n_check = {'rc': rc, 'error': 'failed to inspect n8n'}
out['n8n'] = n8n_check

# 5. Check Postgres database state (callback requests count, job_runs count)
pg_check = {}
rc, pg_out, _ = run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT (SELECT count(*) FROM public.phone_callback_requests) AS callbacks, (SELECT count(*) FROM public.job_runs) AS jobs, (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') AS tables;"
])
if rc == 0:
    parts = pg_out.strip().split('|')
    pg_check = {
        'callback_rows': parts[0] if len(parts) > 0 else '0',
        'job_rows': parts[1] if len(parts) > 1 else '0',
        'table_count': parts[2] if len(parts) > 2 else '0'
    }
else:
    pg_check = {'rc': rc, 'error': 'failed to query postgres'}
out['postgres'] = pg_check

print(json.dumps(out, indent=2))
