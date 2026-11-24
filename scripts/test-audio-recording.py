"""Test live recording proxy for a synced call."""
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

  // Read the call's audio_url from the payload
  const res = await db.query(
    "SELECT payload FROM public.job_runs WHERE job_name = 'phone.n8n.call_sync' AND idempotency_key = 'sarvam_call:inbound:6ced2ce4df5e93ac89f2179e6199724ace82e12d32105d2d88c8752b51e5ee83';"
  );
  if (res.rows.length === 0) {
    console.log("Call not found");
    process.exit(0);
  }
  const call = res.rows[0].payload;
  console.log("Call details:", {
    callId: call.callId,
    recordingAvailable: call.recordingAvailable,
    rawAudioUrl: call.rawAudioUrl ? call.rawAudioUrl.slice(0, 40) + '...' : null
  });

  if (call.rawAudioUrl) {
    // Test proxying audio stream
    const audioResp = await fetch(call.rawAudioUrl, {
      headers: {
        'User-Agent': 'Thaara-Voice-Proxy/1.0',
        'api-subscription-key': s.sarvamApiKey,
        'X-API-Key': s.sarvamApiKey
      }
    });
    console.log("Sarvam Audio fetch status:", audioResp.status);
    console.log("Content-Type:", audioResp.headers.get('content-type'));
    console.log("Content-Length:", audioResp.headers.get('content-length'));
  }
} catch (e) {
  console.error("Audio check failed:", e);
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
