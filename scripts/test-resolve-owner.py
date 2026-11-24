"""Debug resolveOwnerWorkspace in node."""
import subprocess

js = """
import { PostgresDatabase } from '@thaara/db';
import { pilotEnvironment, pilotSecrets } from './pilot-config.mjs';

const c = pilotEnvironment();
const s = pilotSecrets();
const dbPassword = encodeURIComponent(s.databasePassword);
const dbUrl = `postgresql://thaara_app:${dbPassword}@${c.host}:5432/${c.database}`;
const db = new PostgresDatabase(dbUrl);

try {
  console.log('Querying workspaces without scope...');
  const wsRes = await db.query('SELECT id FROM public.workspaces ORDER BY created_at ASC LIMIT 2');
  console.log('Workspaces:', JSON.stringify(wsRes.rows));

  const workspaceId = wsRes.rows[0]?.id;
  const bootstrapScope = {
    workspaceId,
    userId: '00000000-0000-4000-8000-000000000000',
    role: 'owner',
    sessionTokenHash: '0'.repeat(64)
  };

  console.log('Querying memberships with scoped transaction...');
  const ownerId = await db.withScopedTransaction(bootstrapScope, async tx => {
    const mRes = await tx.query(
      'SELECT user_id, role FROM public.memberships WHERE workspace_id = $1 AND role = $2 ORDER BY created_at ASC LIMIT 1',
      [workspaceId, 'owner']
    );
    return mRes.rows;
  });
  console.log('Owner query result:', JSON.stringify(ownerId));
} catch (e) {
  console.error('Error in resolveOwnerWorkspace:', e);
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
