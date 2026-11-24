"""Check token derivation directly inside container."""
import subprocess

js = """
import { createRuntimePhoneN8nSyncService } from './dist/services/phone-n8n-sync.js';
import { PostgresDatabase } from '@thaara/db';
import { defaultPolicyGateway } from '@thaara/policy';

const db = new PostgresDatabase(process.env.DATABASE_URL);
try {
  const sync = createRuntimePhoneN8nSyncService({ db, policyGateway: defaultPolicyGateway });
  const checkRes = await sync.getCheckpoint('any_token');
  console.log('Result:', JSON.stringify(checkRes));
} catch (e) {
  console.log('Error name:', e.name, 'code:', e.code, 'message:', e.message);
  if (e.expectedToken) {
    console.log('Expected token:', e.expectedToken);
  }
} finally {
  await db.close();
}
"""

p = subprocess.run([
    'docker', 'exec', 'thaara-v2-pilot-api-1',
    'node', '--input-type=module', '-e', js
], capture_output=True, text=True)

print("STDOUT:\n", p.stdout)
print("STDERR:\n", p.stderr)
