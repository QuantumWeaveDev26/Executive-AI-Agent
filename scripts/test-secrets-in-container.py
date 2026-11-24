"""Test secret reading and owner query inside container."""
import subprocess

js = """
import { PostgresDatabase } from '@thaara/db';
import fs from 'node:fs';

const secretPath = process.env.THAARA_SARVAM_WEBHOOK_SECRET_FILE || '/run/secrets/sarvam_webhook_secret';
console.log('secretPath:', secretPath, 'exists:', fs.existsSync(secretPath));
const secret = fs.readFileSync(secretPath, 'utf8').trim();
console.log('secret length:', secret.length);

const db = new PostgresDatabase(process.env.DATABASE_URL);
const wsRes = await db.query("SELECT id FROM public.workspaces ORDER BY created_at ASC LIMIT 2");
console.log('workspaces:', JSON.stringify(wsRes.rows));

const mRes = await db.query("SELECT workspace_id, user_id, role FROM public.memberships WHERE role = 'owner' ORDER BY created_at ASC LIMIT 1");
console.log('memberships:', JSON.stringify(mRes.rows));
"""

p = subprocess.run([
    'docker', 'exec', 'thaara-v2-pilot-api-1',
    'node', '--input-type=module', '-e', js
], capture_output=True, text=True)

print("STDOUT:\n", p.stdout)
print("STDERR:\n", p.stderr)
