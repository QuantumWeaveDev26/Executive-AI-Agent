"""Inspect expectedToken inside thaara-v2-pilot-api-1."""
import subprocess

js = """
import { createRuntimePhoneN8nSyncService, derivePhoneN8nSyncToken } from './dist/services/phone-n8n-sync.js';
import { PostgresDatabase } from '@thaara/db';
import { defaultPolicyGateway } from '@thaara/policy';

const db = new PostgresDatabase(process.env.DATABASE_URL);
try {
  const syncService = createRuntimePhoneN8nSyncService({ db, policyGateway: defaultPolicyGateway });
  const principal = await syncService['deps'].resolveMachinePrincipal();
  console.log('Principal:', JSON.stringify(principal));
} catch (e) {
  console.error('Error:', e);
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
