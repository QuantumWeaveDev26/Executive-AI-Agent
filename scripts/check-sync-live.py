"""Check execution status, postgres synced calls, and API responses."""
import subprocess
import json
import time

# Check n8n executions
rc, n8n_execs, _ = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  db.all("SELECT id, workflowId, status, mode, startedAt, stoppedAt FROM execution_entity WHERE workflowId IN ('ThaaraCbNotif001', 'ThaarSarvamSync1') ORDER BY startedAt DESC LIMIT 6;", (err, rows) => {
    console.log(JSON.stringify(rows || []));
    db.close();
  });
});
"""], capture_output=True, text=True), None, None

print("=== Recent n8n Executions ===")
print(n8n_execs.stdout if hasattr(n8n_execs, 'stdout') else rc.stdout)

# Check postgres synced calls
rc_pg = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT job_type, (payload->>'direction'), (payload->>'occurredAt'), (payload->>'customerName'), (payload->>'phoneNumber'), (payload->>'outcomeLabel'), (payload->>'recordingAvailable'), (payload->>'interactionId') FROM public.job_runs WHERE job_type LIKE 'sarvam_%' ORDER BY created_at DESC LIMIT 10;"
], capture_output=True, text=True)

print("=== Synced Calls in Postgres ===")
print(rc_pg.stdout if rc_pg.stdout.strip() else "(No synced calls in Postgres yet)")

# Check cursor position
rc_cur = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT job_type, payload FROM public.job_runs WHERE job_type = 'sarvam_phone_sync_cursor';"
], capture_output=True, text=True)
print("=== Sync Cursor ===")
print(rc_cur.stdout if rc_cur.stdout.strip() else "(No cursor set yet)")
