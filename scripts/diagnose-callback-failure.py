"""Simulate evaluateAndClaim for call e08e595066cd3788699164ee33cd9f19b3226a1012a93ddde72ac603c70aee51."""
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
  const wsId = '75d2f889-d3eb-4acc-861a-fada4691ecce';
  const ownerId = '4b4cbc9c-df01-4cc2-8565-8a23a3435b9d';
  const callId = 'e08e595066cd3788699164ee33cd9f19b3226a1012a93ddde72ac603c70aee51';

  // Read the saved call from job_runs as postgres superuser or with RLS
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN;");
    await client.query("SELECT set_config('app.workspace_id', $1, true);", [wsId]);
    await client.query("SELECT set_config('app.user_id', $1, true);", [ownerId]);
    await client.query("SELECT set_config('app.user_role', 'owner', true);");

    const callRes = await client.query(
      "SELECT payload FROM public.job_runs WHERE workspace_id = $1 AND job_name = 'phone.n8n.call_sync' AND idempotency_key = $2;",
      [wsId, `sarvam_call:inbound:${callId}`]
    );

    const cursorRes = await client.query(
      "SELECT payload FROM public.job_runs WHERE workspace_id = $1 AND job_name = 'phone.n8n.sync_checkpoint' AND idempotency_key = $2;",
      [wsId, `sarvam_sync_cursor:${ownerId}`]
    );

    const claimRes = await client.query(
      "SELECT id, status, retries_count, payload, result FROM public.job_runs WHERE workspace_id = $1 AND job_name = 'phone.n8n.callback_claim' AND idempotency_key = $2;",
      [wsId, `callback_notify:${callId}`]
    );

    console.log("CALL_RECORD:", JSON.stringify({
      callId: callRes.rows[0]?.payload?.callId,
      occurredAt: callRes.rows[0]?.payload?.occurredAt,
      customerName: callRes.rows[0]?.payload?.customerName,
      phoneE164: callRes.rows[0]?.payload?.phoneE164,
      callbackEligibility: callRes.rows[0]?.payload?.callbackEligibility,
      callbackRequestId: callRes.rows[0]?.payload?.callbackRequestId
    }, null, 2));

    console.log("CURSOR:", JSON.stringify(cursorRes.rows[0]?.payload, null, 2));
    console.log("EXISTING_CLAIM:", JSON.stringify(claimRes.rows[0], null, 2));

    await client.query("COMMIT;");
  } finally {
    client.release();
  }
} catch (e) {
  console.error("Diagnostic error:", e);
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
