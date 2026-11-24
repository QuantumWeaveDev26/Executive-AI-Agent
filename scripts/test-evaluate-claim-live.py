"""Replay the exact evaluate-and-claim request to see the backend response."""
import subprocess
import json
import urllib.request

test_code = """
import { PostgresDatabase } from '@thaara/db';
import { pilotEnvironment, pilotSecrets } from './pilot-config.mjs';

const c = pilotEnvironment();
const s = pilotSecrets();
const dbPassword = encodeURIComponent(s.databasePassword);
const dbUrl = `postgresql://thaara_app:${dbPassword}@${c.host}:5432/${c.database}`;
const db = new PostgresDatabase(dbUrl);

const VERIFIED_TOKEN = '34d60f56367e401eab3d3c8e3b1ae4902838cb71f3e1cdc3bb2bfa55b87af850';
const callId = 'e08e595066cd3788699164ee33cd9f19b3226a1012a93ddde72ac603c70aee51';
const wsId = '75d2f889-d3eb-4acc-861a-fada4691ecce';
const ownerId = '4b4cbc9c-df01-4cc2-8565-8a23a3435b9d';

const client = await db.pool.connect();
let callRecord;
try {
  await client.query("BEGIN;");
  await client.query("SELECT set_config('app.workspace_id', $1, true);", [wsId]);
  await client.query("SELECT set_config('app.user_id', $1, true);", [ownerId]);
  await client.query("SELECT set_config('app.user_role', 'owner', true);");

  const res = await client.query(
    "SELECT payload FROM public.job_runs WHERE workspace_id = $1 AND job_name = 'phone.n8n.call_sync' AND idempotency_key = $2;",
    [wsId, `sarvam_call:inbound:${callId}`]
  );
  callRecord = res.rows[0]?.payload;
  await client.query("COMMIT;");
} finally {
  client.release();
  await db.close();
}

if (!callRecord) {
  console.log("Call record not found");
  process.exit(1);
}

// Build input payload matching Prepare Verification Payload node
const payload = {
  call: {
    attemptId: callRecord.attemptId,
    interactionId: callRecord.interactionId,
    direction: 'inbound',
    connectivityStatus: callRecord.connectivityStatus || 'connected',
    failureReason: callRecord.failureReason || null,
    endedBy: callRecord.endedBy || null,
    durationSeconds: callRecord.durationSeconds,
    startDatetime: callRecord.occurredAt,
    endDatetime: callRecord.occurredAt,
    attemptedAt: callRecord.occurredAt,
    userContact: callRecord.phoneE164,
    userContactMasked: callRecord.maskedInboundPhone,
    recordingAvailable: callRecord.recordingAvailable,
    appVersion: callRecord.appVersion,
    languageName: callRecord.languageName,
    agentVariables: {
      user_name: callRecord.customerName,
      call_purpose: null,
      call_summary: callRecord.summary,
      business_name: callRecord.business,
      service_needed: callRecord.serviceNeeded,
      preferred_callback_time: callRecord.preferredCallbackTime
    },
    messages: (callRecord.transcript || []).map((t, idx) => ({
      role: t.speaker === 'thaara' ? 'assistant' : 'user',
      content: t.text,
      language_name: t.languageName || 'English',
      turn_id: idx + 1
    }))
  }
};

const resp = await fetch('http://127.0.0.1:3002/api/v1/connectors/phone/n8n/callbacks/evaluate-and-claim', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-thaara-phone-sync-token': VERIFIED_TOKEN
  },
  body: JSON.stringify(payload)
});

const data = await resp.json();
console.log("RESPONSE_STATUS:", resp.status);
console.log("BACKEND_DECISION:", JSON.stringify(data, null, 2));
"""

p = subprocess.run([
    'docker', 'exec', 'thaara-v2-pilot-api-1',
    'node', '--input-type=module', '-e', test_code
], capture_output=True, text=True)

print(p.stdout)
if p.stderr:
    print("STDERR:\n", p.stderr)
