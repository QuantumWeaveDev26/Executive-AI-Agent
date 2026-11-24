"""Live post-deployment verification for Phone n8n Integration on VPS."""
import subprocess
import json
import time

def run(cmd, inp=None):
    p = subprocess.run(cmd, input=inp, capture_output=True, text=True, timeout=60)
    return p.returncode, p.stdout.strip(), p.stderr.strip()

out = {}

# 1. Container status
rc, stdout, _ = run(['docker', 'inspect', '--format', '{{.Id}}|{{.Image}}|{{.State.Status}}|{{.State.Health.Status}}', 'thaara-v2-pilot-api-1'])
parts = stdout.split('|')
out['api_container'] = {
    'id': parts[0][:12],
    'image': parts[1],
    'status': parts[2],
    'health': parts[3] if len(parts) > 3 else None
}

# 2. Execute one run of Call History Sync workflow via n8n CLI
rc_exec, stdout_exec, stderr_exec = run(['docker', 'exec', 'n8n-n8n-1', 'n8n', 'execute', '--id=ThaarSarvamSync1'])
out['workflow_sync_run'] = {
    'rc': rc_exec,
    'stdout': stdout_exec[:500],
    'stderr': stderr_exec[:300]
}

# 3. Check postgres job_runs for synced calls
rc_pg, stdout_pg, _ = run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT count(*) FROM public.job_runs WHERE job_type LIKE 'sarvam_synced_call:%';"
])
out['synced_calls_count'] = stdout_pg

# 4. Check details of synced calls
rc_calls, stdout_calls, _ = run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT job_type, (payload->>'direction'), (payload->>'occurredAt'), (payload->>'customerName'), (payload->>'phoneNumber'), (payload->>'outcomeLabel'), (payload->>'recordingAvailable') FROM public.job_runs WHERE job_type LIKE 'sarvam_synced_call:%' ORDER BY created_at DESC LIMIT 5;"
])
out['recent_synced_calls'] = stdout_calls.split('\n') if stdout_calls else []

# 5. Check active n8n workflows
rc_wfs, stdout_wfs, _ = run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', (err) => {
  db.all("SELECT id, name, active FROM workflow_entity WHERE id IN ('ThaaraCbNotif001', 'ThaarSarvamSync1');", (err, rows) => {
    console.log(JSON.stringify(rows));
    db.close();
  });
});
"""])
out['active_workflows'] = json.loads(stdout_wfs) if stdout_wfs else []

print(json.dumps(out, indent=2))
