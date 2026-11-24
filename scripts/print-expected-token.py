"""Print expectedToken by creating the principal inside container."""
import subprocess

js = """
import { createRuntimePhoneN8nSyncService, derivePhoneN8nSyncToken } from './dist/services/phone-n8n-sync.js';
import { PostgresDatabase } from '@thaara/db';
import { defaultPolicyGateway } from '@thaara/policy';
import fs from 'node:fs';

const secretPath = process.env.THAARA_SARVAM_WEBHOOK_SECRET_FILE || '/run/secrets/sarvam_webhook_secret';
const secretMaterial = fs.readFileSync(secretPath, 'utf8').trim();

const db = new PostgresDatabase(process.env.DATABASE_URL);
const wsRes = await db.query('SELECT id FROM public.workspaces ORDER BY created_at ASC LIMIT 1');
const workspaceId = wsRes.rows[0].id;
const bootstrapScope = {
  workspaceId,
  userId: '00000000-0000-4000-8000-000000000000',
  role: 'owner',
  sessionTokenHash: '0'.repeat(64)
};
const ownerId = await db.withScopedTransaction(bootstrapScope, async tx => {
  const mRes = await tx.query('SELECT user_id FROM public.memberships WHERE workspace_id = $1 AND role = $2', [workspaceId, 'owner']);
  return mRes.rows[0].user_id;
});

const token = derivePhoneN8nSyncToken(secretMaterial, workspaceId, ownerId);
console.log('workspaceId:', workspaceId);
console.log('ownerId:', ownerId);
console.log('Calculated expectedToken:', token);
"""

p = subprocess.run([
    'docker', 'exec', 'thaara-v2-pilot-api-1',
    'node', '--input-type=module', '-e', js
], capture_output=True, text=True)

print("STDOUT:\n", p.stdout)
print("STDERR:\n", p.stderr)
