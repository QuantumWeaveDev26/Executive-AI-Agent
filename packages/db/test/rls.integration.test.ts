import { describe, it, expect, beforeAll } from 'vitest';
import { PGliteDatabase } from '../src/pglite.js';
import { Migrator } from '../src/migrator.js';
import { WorkspaceRepository } from '../src/repositories/workspaces.js';
import { UserRepository } from '../src/repositories/users.js';
import { hashSessionToken } from '../src/repositories/sessions.js';
import { AuthenticatedScope } from '../src/client.js';

describe('PostgreSQL Row-Level Security (RLS) Boundary', () => {
  let db: PGliteDatabase;
  let workspaceAId: string;
  let workspaceBId: string;
  let userAId: string;
  let userBId: string;
  let scopeA: AuthenticatedScope;
  let scopeB: AuthenticatedScope;

  const tables = [
    'sessions',
    'memberships',
    'audit_events',
    'idempotency_keys',
    'approval_requests',
    'job_runs'
  ] as const;

  beforeAll(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());

    // Switch to non-superuser application role thaara_app so RLS is strictly enforced
    await db.exec('SET ROLE thaara_app;');

    // Verify current user is non-superuser thaara_app
    const roleCheck = await db.query<{ current_user: string }>('SELECT current_user;');
    expect(roleCheck.rows[0]?.current_user).toBe('thaara_app');

    // Create 2 distinct workspaces and users
    const wsRepo = new WorkspaceRepository(db);
    const userRepo = new UserRepository(db);

    const wsA = await wsRepo.create('Workspace Alpha');
    const wsB = await wsRepo.create('Workspace Beta');
    workspaceAId = wsA.id;
    workspaceBId = wsB.id;

    const uA = await userRepo.create('alice@alpha.com', 'hashA', 'Alice');
    const uB = await userRepo.create('bob@beta.com', 'hashB', 'Bob');
    userAId = uA.id;
    userBId = uB.id;

    scopeA = {
      workspaceId: workspaceAId,
      userId: userAId,
      role: 'owner',
      sessionTokenHash: hashSessionToken('token-alpha-1')
    };

    scopeB = {
      workspaceId: workspaceBId,
      userId: userBId,
      role: 'owner',
      sessionTokenHash: hashSessionToken('token-beta-1')
    };

    // Seed Workspace A data under scopeA
    await db.withScopedTransaction(scopeA, async (txClient) => {
      const tokenHashA = hashSessionToken('token-alpha-1');
      await txClient.query(
        `INSERT INTO sessions (user_id, workspace_id, token_hash, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '1 day');`,
        [userAId, workspaceAId, tokenHashA]
      );
      await txClient.query(
        `INSERT INTO memberships (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner');`,
        [workspaceAId, userAId]
      );
      await txClient.query(
        `INSERT INTO audit_events (workspace_id, action, target_type, payload)
         VALUES ($1, 'alpha.audit', 'test', '{"k":"v"}');`,
        [workspaceAId]
      );
      await txClient.query(
        `INSERT INTO idempotency_keys (key, workspace_id, user_id, request_path, status, expires_at)
         VALUES ('key-a1', $1, $2, '/api/v1/test', 'completed', NOW() + INTERVAL '1 day');`,
        [workspaceAId, userAId]
      );
      await txClient.query(
        `INSERT INTO approval_requests (workspace_id, action_name, requester_user_id, status, risk_level, expires_at)
         VALUES ($1, 'alpha.action', $2, 'pending', 'low', NOW() + INTERVAL '1 day');`,
        [workspaceAId, userAId]
      );
      await txClient.query(
        `INSERT INTO job_runs (workspace_id, job_name, status, payload)
         VALUES ($1, 'alpha.job', 'queued', '{}');`,
        [workspaceAId]
      );
    });

    // Seed Workspace B data under scopeB
    await db.withScopedTransaction(scopeB, async (txClient) => {
      const tokenHashB = hashSessionToken('token-beta-1');
      await txClient.query(
        `INSERT INTO sessions (user_id, workspace_id, token_hash, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '1 day');`,
        [userBId, workspaceBId, tokenHashB]
      );
      await txClient.query(
        `INSERT INTO memberships (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner');`,
        [workspaceBId, userBId]
      );
      await txClient.query(
        `INSERT INTO audit_events (workspace_id, action, target_type, payload)
         VALUES ($1, 'beta.audit', 'test', '{"k":"v"}');`,
        [workspaceBId]
      );
      await txClient.query(
        `INSERT INTO idempotency_keys (key, workspace_id, user_id, request_path, status, expires_at)
         VALUES ('key-b1', $1, $2, '/api/v1/test', 'completed', NOW() + INTERVAL '1 day');`,
        [workspaceBId, userBId]
      );
      await txClient.query(
        `INSERT INTO approval_requests (workspace_id, action_name, requester_user_id, status, risk_level, expires_at)
         VALUES ($1, 'beta.action', $2, 'pending', 'critical', NOW() + INTERVAL '1 day');`,
        [workspaceBId, userBId]
      );
      await txClient.query(
        `INSERT INTO job_runs (workspace_id, job_name, status, payload)
         VALUES ($1, 'beta.job', 'queued', '{}');`,
        [workspaceBId]
      );
    });
  });

  describe('Unscoped Fail-Closed (Direct queries without app.workspace_id under thaara_app)', () => {
    it('unscoped SELECT on all 6 tables returns 0 rows', async () => {
      for (const table of tables) {
        const res = await db.query(`SELECT * FROM ${table};`);
        expect(res.rows.length, `Table ${table} must return 0 rows on unscoped SELECT`).toBe(0);
      }
    });

    it('unscoped UPDATE on all 6 tables updates 0 rows', async () => {
      for (const table of tables) {
        let updateSql = '';
        if (table === 'sessions') updateSql = `UPDATE sessions SET revoked_at = NOW()`;
        else if (table === 'memberships') updateSql = `UPDATE memberships SET role = 'admin'`;
        else if (table === 'audit_events') updateSql = `UPDATE audit_events SET action = 'tampered'`;
        else if (table === 'idempotency_keys') updateSql = `UPDATE idempotency_keys SET status = 'failed'`;
        else if (table === 'approval_requests') updateSql = `UPDATE approval_requests SET status = 'rejected'`;
        else if (table === 'job_runs') updateSql = `UPDATE job_runs SET status = 'failed'`;

        const res = await db.query(`${updateSql} RETURNING *;`);
        expect(res.rows.length, `Table ${table} must update 0 rows on unscoped UPDATE`).toBe(0);
      }
    });

    it('unscoped DELETE on all 6 tables deletes 0 rows', async () => {
      for (const table of tables) {
        const res = await db.query(`DELETE FROM ${table} RETURNING *;`);
        expect(res.rows.length, `Table ${table} must delete 0 rows on unscoped DELETE`).toBe(0);
      }
    });

    it('unscoped INSERT fails closed with RLS violation on all 6 tables', async () => {
      // 1. sessions
      await expect(
        db.query(
          `INSERT INTO sessions (user_id, workspace_id, token_hash, expires_at)
           VALUES ($1, $2, 'unscoped_hash', NOW() + INTERVAL '1 day');`,
          [userAId, workspaceAId]
        )
      ).rejects.toThrow();

      // 2. memberships
      await expect(
        db.query(
          `INSERT INTO memberships (workspace_id, user_id, role)
           VALUES ($1, $2, 'member');`,
          [workspaceAId, userAId]
        )
      ).rejects.toThrow();

      // 3. audit_events
      await expect(
        db.query(
          `INSERT INTO audit_events (workspace_id, action, target_type, payload)
           VALUES ($1, 'unscoped.hack', 'test', '{}');`,
          [workspaceAId]
        )
      ).rejects.toThrow();

      // 4. idempotency_keys
      await expect(
        db.query(
          `INSERT INTO idempotency_keys (key, workspace_id, user_id, request_path, status, expires_at)
           VALUES ('unscoped-key', $1, $2, '/path', 'in_progress', NOW() + INTERVAL '1 day');`,
          [workspaceAId, userAId]
        )
      ).rejects.toThrow();

      // 5. approval_requests
      await expect(
        db.query(
          `INSERT INTO approval_requests (workspace_id, action_name, requester_user_id, status, risk_level, expires_at)
           VALUES ($1, 'unscoped.action', $2, 'pending', 'low', NOW() + INTERVAL '1 day');`,
          [workspaceAId, userAId]
        )
      ).rejects.toThrow();

      // 6. job_runs
      await expect(
        db.query(
          `INSERT INTO job_runs (workspace_id, job_name, status, payload)
           VALUES ($1, 'unscoped.job', 'queued', '{}');`,
          [workspaceAId]
        )
      ).rejects.toThrow();
    });
  });

  describe('Cross-Workspace Tenant Isolation (Scope A cannot access Scope B data)', () => {
    it('Scope A can read its own records from all 6 tables', async () => {
      await db.withScopedTransaction(scopeA, async (txClient) => {
        for (const table of tables) {
          const res = await txClient.query(`SELECT * FROM ${table} WHERE workspace_id = $1;`, [workspaceAId]);
          expect(res.rows.length, `Scope A must read its own rows in ${table}`).toBeGreaterThanOrEqual(1);
        }
      });
    });

    it('Scope A cannot SELECT Workspace B records from any of the 6 tables', async () => {
      await db.withScopedTransaction(scopeA, async (txClient) => {
        for (const table of tables) {
          const res = await txClient.query(`SELECT * FROM ${table} WHERE workspace_id = $1;`, [workspaceBId]);
          expect(res.rows.length, `Scope A must not read Workspace B rows from ${table}`).toBe(0);
        }
      });
    });

    it('Scope A cannot UPDATE Workspace B records in any of the 6 tables', async () => {
      await db.withScopedTransaction(scopeA, async (txClient) => {
        for (const table of tables) {
          let updateSql = '';
          if (table === 'sessions') updateSql = `UPDATE sessions SET revoked_at = NOW() WHERE workspace_id = $1`;
          else if (table === 'memberships') updateSql = `UPDATE memberships SET role = 'viewer' WHERE workspace_id = $1`;
          else if (table === 'audit_events') updateSql = `UPDATE audit_events SET action = 'tampered' WHERE workspace_id = $1`;
          else if (table === 'idempotency_keys') updateSql = `UPDATE idempotency_keys SET status = 'failed' WHERE workspace_id = $1`;
          else if (table === 'approval_requests') updateSql = `UPDATE approval_requests SET status = 'rejected' WHERE workspace_id = $1`;
          else if (table === 'job_runs') updateSql = `UPDATE job_runs SET status = 'failed' WHERE workspace_id = $1`;

          const res = await txClient.query(`${updateSql} RETURNING *;`, [workspaceBId]);
          expect(res.rows.length, `Scope A must update 0 Workspace B rows in ${table}`).toBe(0);
        }
      });
    });

    it('Scope A cannot DELETE Workspace B records in any of the 6 tables', async () => {
      await db.withScopedTransaction(scopeA, async (txClient) => {
        for (const table of tables) {
          const res = await txClient.query(`DELETE FROM ${table} WHERE workspace_id = $1 RETURNING *;`, [workspaceBId]);
          expect(res.rows.length, `Scope A must delete 0 Workspace B rows in ${table}`).toBe(0);
        }
      });
    });

    it('Scope A cannot INSERT records claiming Workspace B workspace_id (RLS WITH CHECK rejection)', async () => {
      // 1. sessions
      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO sessions (user_id, workspace_id, token_hash, expires_at)
             VALUES ($1, $2, 'cross_hash', NOW() + INTERVAL '1 day');`,
            [userAId, workspaceBId]
          );
        })
      ).rejects.toThrow();

      // 2. memberships
      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO memberships (workspace_id, user_id, role)
             VALUES ($1, $2, 'admin');`,
            [workspaceBId, userAId]
          );
        })
      ).rejects.toThrow();

      // 3. audit_events
      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO audit_events (workspace_id, action, target_type, payload)
             VALUES ($1, 'cross.audit', 'exploit', '{}');`,
            [workspaceBId]
          );
        })
      ).rejects.toThrow();

      // 4. idempotency_keys
      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO idempotency_keys (key, workspace_id, user_id, request_path, status, expires_at)
             VALUES ('cross-key', $1, $2, '/path', 'in_progress', NOW() + INTERVAL '1 day');`,
            [workspaceBId, userAId]
          );
        })
      ).rejects.toThrow();

      // 5. approval_requests
      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO approval_requests (workspace_id, action_name, requester_user_id, status, risk_level, expires_at)
             VALUES ($1, 'cross.approval', $2, 'pending', 'critical', NOW() + INTERVAL '1 day');`,
            [workspaceBId, userAId]
          );
        })
      ).rejects.toThrow();

      // 6. job_runs
      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO job_runs (workspace_id, job_name, status, payload)
             VALUES ($1, 'cross.job', 'queued', '{}');`,
            [workspaceBId]
          );
        })
      ).rejects.toThrow();
    });

    it('SECURITY DEFINER functions resolve session scope and memberships safely', async () => {
      // Direct unscoped test for resolve_session_scope
      const scopeResult = await db.query<{
        session_id: string;
        workspace_id: string;
        user_id: string;
        role: string;
      }>('SELECT * FROM resolve_session_scope($1);', [hashSessionToken('token-alpha-1')]);

      expect(scopeResult.rows.length).toBe(1);
      expect(scopeResult.rows[0]?.workspace_id).toBe(workspaceAId);
      expect(scopeResult.rows[0]?.user_id).toBe(userAId);
      expect(scopeResult.rows[0]?.role).toBe('owner');

      // Unscoped query for unknown hash returns empty
      const emptyResult = await db.query('SELECT * FROM resolve_session_scope($1);', ['non_existent_token_hash']);
      expect(emptyResult.rows.length).toBe(0);

      // get_authenticated_user_memberships returns only when both user_id and matching email match
      const membershipsA = await db.query<{ workspace_id: string; role: string }>(
        'SELECT * FROM get_authenticated_user_memberships($1, $2);',
        [userAId, 'alice@alpha.com']
      );
      expect(membershipsA.rows.length).toBe(1);
      expect(membershipsA.rows[0]?.workspace_id).toBe(workspaceAId);

      // Negative case: wrong email returns empty
      const wrongEmail = await db.query(
        'SELECT * FROM get_authenticated_user_memberships($1, $2);',
        [userAId, 'wrong@alpha.com']
      );
      expect(wrongEmail.rows.length).toBe(0);

      const emptyMemberships = await db.query(
        'SELECT * FROM get_authenticated_user_memberships($1, $2);',
        ['00000000-0000-0000-0000-000000000000', 'nobody@alpha.com']
      );
      expect(emptyMemberships.rows.length).toBe(0);
    });
  });
});
