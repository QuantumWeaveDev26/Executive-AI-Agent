"""Query live phone endpoints using an existing owner session or internal service."""
import subprocess
import json

test_code = """
import { PostgresDatabase } from '@thaara/db';
import { pilotEnvironment, pilotSecrets } from './pilot-config.mjs';

const c = pilotEnvironment();
const s = pilotSecrets();
const dbPassword = encodeURIComponent(s.databasePassword);
const dbUrl = `postgresql://thaara_app:${dbPassword}@${c.host}:5432/${c.database}`;
const db = new PostgresDatabase(dbUrl);

try {
  // Directly query the phone calling service / sync service to verify data read
  const wsId = '75d2f889-d3eb-4acc-861a-fada4691ecce';
  const ownerId = '4b4cbc9c-df01-4cc2-8565-8a23a3435b9d';

  // Read stored synced calls directly using Postgres database transaction with RLS set
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN;");
    await client.query("SELECT set_config('app.current_workspace_id', $1, true);", [wsId]);
    await client.query("SELECT set_config('app.current_user_id', $1, true);", [ownerId]);
    await client.query("SELECT set_config('app.current_user_role', 'owner', true);");

    const inRes = await client.query(
      `SELECT payload FROM public.job_runs
       WHERE workspace_id = $1 AND job_name = 'phone.n8n.call_sync' AND idempotency_key LIKE 'sarvam_call:inbound:%'
       ORDER BY COALESCE((payload->>'occurredAt')::timestamptz, created_at) DESC LIMIT 5;`,
      [wsId]
    );

    const outRes = await client.query(
      `SELECT payload FROM public.job_runs
       WHERE workspace_id = $1 AND job_name = 'phone.n8n.call_sync' AND idempotency_key LIKE 'sarvam_call:outbound:%'
       ORDER BY COALESCE((payload->>'occurredAt')::timestamptz, created_at) DESC LIMIT 5;`,
      [wsId]
    );

    console.log("INBOUND_RECORDS_STORED:", inRes.rows.length);
    if (inRes.rows.length > 0) {
      const sample = inRes.rows[0].payload;
      console.log("SAMPLE_INBOUND_CALL:", JSON.stringify({
        callId: sample.callId,
        customerName: sample.customerName,
        durationSeconds: sample.durationSeconds,
        recordingAvailable: sample.recordingAvailable,
        turnsCount: sample.transcript?.length ?? 0
      }));
    }

    console.log("OUTBOUND_RECORDS_STORED:", outRes.rows.length);
    if (outRes.rows.length > 0) {
      const sample = outRes.rows[0].payload;
      console.log("SAMPLE_OUTBOUND_CALL:", JSON.stringify({
        callId: sample.callId,
        customerName: sample.customerName,
        durationSeconds: sample.durationSeconds,
        recordingAvailable: sample.recordingAvailable,
        turnsCount: sample.transcript?.length ?? 0
      }));
    }

    await client.query("COMMIT;");
  } finally {
    client.release();
  }
} catch (e) {
  console.error("Direct check failed:", e);
} finally {
  await db.close();
}
"""

p = subprocess.run([
    'docker', 'exec', 'thaara-v2-pilot-api-1',
    'node', '--input-type=module', '-e', test_code
], capture_output=True, text=True)

print(p.stdout)
if p.stderr:
    print("STDERR:\n", p.stderr)
