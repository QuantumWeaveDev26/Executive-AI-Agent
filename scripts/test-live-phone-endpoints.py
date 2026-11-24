"""Verify live production API responses for inbound, outbound, and recordings."""
import subprocess
import json

test_code = """
import { SessionRepository, PostgresDatabase } from '@thaara/db';
import { pilotEnvironment, pilotSecrets } from './pilot-config.mjs';

const c = pilotEnvironment();
const s = pilotSecrets();
const dbPassword = encodeURIComponent(s.databasePassword);
const dbUrl = `postgresql://thaara_app:${dbPassword}@${c.host}:5432/${c.database}`;
const db = new PostgresDatabase(dbUrl);

try {
  const wsId = '75d2f889-d3eb-4acc-861a-fada4691ecce';
  const ownerId = '4b4cbc9c-df01-4cc2-8565-8a23a3435b9d';

  const sessionRepo = new SessionRepository(db);
  const rawToken = 'diagtok' + Math.random().toString(36).slice(2) + '0123456789abcdef';
  await sessionRepo.create(ownerId, wsId, rawToken, 300);

  // 1. Inbound history
  const rIn = await fetch('http://127.0.0.1:3002/api/v1/connectors/phone/call-history/inbound', {
    headers: { 'cookie': `thaara_session=${rawToken}` }
  });
  const dIn = await rIn.json();
  console.log("INBOUND_STATUS:", rIn.status, "COUNT:", dIn.reports?.length ?? 0);
  if (dIn.reports?.length) {
    const s = dIn.reports[0];
    console.log("SAMPLE_INBOUND:", JSON.stringify({
      callId: s.callId,
      customerName: s.customerName,
      phoneNumber: s.phoneNumber,
      duration: s.durationSeconds,
      recordingAvailable: s.recordingAvailable,
      transcriptTurns: s.transcript?.length ?? 0
    }));
  }

  // 2. Outbound history
  const rOut = await fetch('http://127.0.0.1:3002/api/v1/connectors/phone/call-history/outbound', {
    headers: { 'cookie': `thaara_session=${rawToken}` }
  });
  const dOut = await rOut.json();
  console.log("OUTBOUND_STATUS:", rOut.status, "COUNT:", dOut.reports?.length ?? 0);
  if (dOut.reports?.length) {
    const s = dOut.reports[0];
    console.log("SAMPLE_OUTBOUND:", JSON.stringify({
      callId: s.callId,
      customerName: s.customerName,
      duration: s.durationSeconds,
      recordingAvailable: s.recordingAvailable,
      transcriptTurns: s.transcript?.length ?? 0
    }));
  }

  // 3. Audio recording endpoint
  if (dIn.reports?.[0]?.callId) {
    const rAud = await fetch(`http://127.0.0.1:3002/api/v1/connectors/phone/recordings/inbound/${dIn.reports[0].callId}`, {
      headers: { 'cookie': `thaara_session=${rawToken}` }
    });
    console.log("RECORDING_ENDPOINT_STATUS:", rAud.status, "CONTENT_TYPE:", rAud.headers.get('content-type'));
  }
} catch (e) {
  console.error("API check failed:", e);
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
