"""Verify live sync execution and call history records in Postgres."""
import subprocess
import json

def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    return p.returncode, p.stdout.strip(), p.stderr.strip()

out = {}

# 1. Check n8n executions
rc_exec, exec_rows, _ = run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  db.all("SELECT id, workflowId, status, mode, startedAt, stoppedAt FROM execution_entity WHERE workflowId IN ('ThaaraCbNotif001', 'ThaarSarvamSync1') ORDER BY startedAt DESC LIMIT 10;", (err, rows) => {
    console.log(JSON.stringify(rows));
    db.close();
  });
});
"""])
out['executions'] = json.loads(exec_rows) if rc_exec == 0 and exec_rows else []

# 2. Check Postgres job_runs
rc_pg, pg_count, _ = run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT count(*) FROM public.job_runs WHERE job_type LIKE 'sarvam_%';"
])
out['total_sarvam_job_runs'] = pg_count

rc_calls, calls_summary, _ = run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT job_type, (payload->>'direction'), (payload->>'occurredAt'), (payload->>'customerName'), (payload->>'phoneNumber'), (payload->>'outcomeLabel'), (payload->>'recordingAvailable'), (payload->>'interactionId') FROM public.job_runs WHERE job_type LIKE 'sarvam_synced_call:%' ORDER BY created_at DESC LIMIT 10;"
])
out['recent_calls'] = calls_summary.split('\n') if rc_calls == 0 and calls_summary else []

rc_cur, cur_summary, _ = run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT payload FROM public.job_runs WHERE job_type = 'sarvam_phone_sync_cursor';"
])
out['cursor'] = json.loads(cur_summary) if rc_cur == 0 and cur_summary else None

print(json.dumps(out, indent=2))
