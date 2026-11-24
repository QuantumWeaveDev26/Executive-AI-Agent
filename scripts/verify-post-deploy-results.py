"""Inspect post-deployment sync results, recordings, and API reports."""
import subprocess
import json
import time

def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    return p.returncode, p.stdout.strip(), p.stderr.strip()

results = {}

# 1. Check n8n executions
rc, n8n_execs, _ = run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  db.all("SELECT id, workflowId, status, mode, startedAt, stoppedAt FROM execution_entity WHERE workflowId IN ('ThaaraCbNotif001', 'ThaarSarvamSync1') ORDER BY startedAt DESC LIMIT 10;", (err, rows) => {
    console.log(JSON.stringify(rows));
    db.close();
  });
});
"""])
results['n8n_executions'] = json.loads(n8n_execs) if rc == 0 and n8n_execs else []

# 2. Check Postgres job_runs
rc_pg, pg_jobs, _ = run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT job_type, (payload->>'direction'), (payload->>'occurredAt'), (payload->>'customerName'), (payload->>'phoneNumber'), (payload->>'outcomeLabel'), (payload->>'recordingAvailable'), (payload->>'interactionId') FROM public.job_runs WHERE job_type LIKE 'sarvam_%' ORDER BY created_at DESC LIMIT 10;"
])
results['postgres_synced_calls'] = pg_jobs.split('\n') if rc_pg == 0 and pg_jobs else []

# 3. Check cursor position
rc_cur, cur_out, _ = run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT job_type, payload FROM public.job_runs WHERE job_type = 'sarvam_phone_sync_cursor';"
])
results['sync_cursor'] = cur_out if rc_cur == 0 and cur_out else 'none'

# 4. Check API response for inbound history via owner session
rc_api, api_out, _ = run(['docker', 'exec', 'thaara-v2-pilot-api-1', 'node', '-e', """
import { SessionRepository, PostgresDatabase } from '@thaara/db';
import { pilotEnvironment, pilotSecrets } from './pilot-config.mjs';

const c = pilotEnvironment();
const s = pilotSecrets();
const dbPassword = encodeURIComponent(s.databasePassword);
const dbUrl = `postgresql://thaara_app:${dbPassword}@${c.host}:5432/${c.database}`;
const db = new PostgresDatabase(dbUrl);

try {
  // Find an active session or create a temporary diagnostic one for owner
  const wsRes = await db.query("SELECT id FROM public.workspaces LIMIT 1");
  const wsId = wsRes.rows[0].id;
  const ownerRes = await db.query("SELECT user_id FROM public.memberships WHERE workspace_id = $1 AND role = 'owner' LIMIT 1", [wsId]);
  const ownerId = ownerRes.rows[0].user_id;

  const sessionRepo = new SessionRepository(db);
  const rawToken = 'testdiag' + Math.random().toString(36).slice(2) + '0123456789abcdef';
  await sessionRepo.create(ownerId, wsId, rawToken, 300);

  const res = await fetch('http://127.0.0.1:3002/api/v1/connectors/phone/call-history/inbound', {
    headers: { 'cookie': `thaara_session=${rawToken}` }
  });
  const data = await res.json();
  console.log(JSON.stringify({ status: res.status, count: data.reports?.length ?? 0, sample: data.reports?.[0] }));
} catch (e) {
  console.error(e);
} finally {
  await db.close();
}
"""])
results['inbound_api_check'] = json.loads(api_out) if rc_api == 0 and api_out else {'raw': api_out}

print(json.dumps(results, indent=2))
