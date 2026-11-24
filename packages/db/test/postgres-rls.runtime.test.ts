import { getIsolatedRuntimeConfig, isolatedRoleUrl } from '../../../scripts/step74-runtime-guard.mjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import pg from 'pg';
import { PostgresDatabase, AuthenticatedScope } from '../src/client.js';
import { Migrator } from '../src/migrator.js';
import { WorkspaceRepository } from '../src/repositories/workspaces.js';
import { UserRepository } from '../src/repositories/users.js';
import { hashSessionToken } from '../src/repositories/sessions.js';
import { RequestScope } from '@thaara/contracts';

const { Client } = pg;

const isolated = getIsolatedRuntimeConfig();

describe('PostgreSQL Runtime RLS and Security Boundary (Real PostgreSQL)', () => {
  const allowOffline = process.env.ALLOW_OFFLINE_RUNTIME_SKIP === 'true';
  const migrationDbUrl = isolated.migrationUrl;
  const appDbUrl = isolated.appUrl;

  let isLive = false;
  let adminDb: PostgresDatabase | null = null;
  let appDb: PostgresDatabase | null = null;
  let ephemeralTesterPassword = '';

  let workspaceAId: string;
  let workspaceBId: string;
  let userAId: string;
  let userBId: string;
  let scopeA: AuthenticatedScope;
  let scopeB: AuthenticatedScope;

  let planAId: string;
  let stepAId: string;
  let stepA2Id: string;
  let stepA3Id: string;
  let approvalAId: string;

  let planBId: string;
  let stepBId: string;
  let stepB2Id: string;
  let stepB3Id: string;
  let approvalBId: string;

  const tables = [
    'sessions',
    'memberships',
    'audit_events',
    'idempotency_keys',
    'approval_requests',
    'job_runs',
    'plans',
    'plan_steps',
    'plan_step_dependencies',
    'plan_step_approval_bindings',
    'step_executions',
    'receipts'
  ] as const;

  beforeAll(async () => {
    // Probe if PostgreSQL is reachable
    const probeClient = new Client({
      connectionString: migrationDbUrl,
      connectionTimeoutMillis: 3000
    });

    const allowOffline = process.env.ALLOW_OFFLINE_RUNTIME_SKIP === 'true';

    try {
      await probeClient.connect();
      await probeClient.query('SELECT 1;');
      await probeClient.end();
      isLive = true;
    } catch (err) {
      if (!allowOffline) {
        throw new Error(
          `[Runtime Proof Failure] PostgreSQL runtime service is unavailable at 127.0.0.1:15432/thaara_step74_test. ` +
          `Real PostgreSQL is required for runtime verification. ` +
          `Verify the disposable Step 74 services and explicit test settings. ` +
          `To run in explicit offline diagnostic mode, set ALLOW_OFFLINE_RUNTIME_SKIP=true. ` +
          `Underlying error: ${(err as Error).message}`
        );
      }
      console.warn(
        `[PostgreSQL Runtime Suite] PostgreSQL is not reachable at 127.0.0.1:15432/thaara_step74_test. ` +
        `ALLOW_OFFLINE_RUNTIME_SKIP=true is set; running in offline diagnostic mode. Skipping live queries.`
      );
      return;
    }

    if (!appDbUrl) {
      throw new Error(
        `[Runtime Proof Failure] DATABASE_URL must be provided with valid non-superuser thaara_app credentials.`
      );
    }

    // 1. Run migrations as migration admin (superuser / ddl role)
    adminDb = new PostgresDatabase(migrationDbUrl);
    const migrator = new Migrator(adminDb);
    await migrator.migrate(migrator.loadMigrationFiles());

    // 2. Connect app database directly as non-superuser thaara_app
    appDb = new PostgresDatabase(appDbUrl);

    // 3. Create unprivileged tester role with ephemeral dynamically generated password for boundary testing
    ephemeralTesterPassword = crypto.randomBytes(16).toString('hex');
    await adminDb.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'unprivileged_tester') THEN
          CREATE ROLE unprivileged_tester WITH LOGIN PASSWORD '${ephemeralTesterPassword}';
        ELSE
          ALTER ROLE unprivileged_tester WITH PASSWORD '${ephemeralTesterPassword}';
        END IF;
      END $$;
      GRANT CONNECT ON DATABASE ${isolated.databaseName} TO unprivileged_tester;
      GRANT USAGE ON SCHEMA public TO unprivileged_tester;
    `);

    // 4. Seed test tenants using appDb
    const wsRepo = new WorkspaceRepository(appDb);
    const userRepo = new UserRepository(appDb);

    const wsA = await wsRepo.create('PG Runtime Org Alpha');
    const wsB = await wsRepo.create('PG Runtime Org Beta');
    workspaceAId = wsA.id;
    workspaceBId = wsB.id;

    const uA = await userRepo.create('alice.runtime@alpha.com', 'hashA', 'Alice Runtime');
    const uB = await userRepo.create('bob.runtime@beta.com', 'hashB', 'Bob Runtime');
    userAId = uA.id;
    userBId = uB.id;

    scopeA = {
      workspaceId: workspaceAId,
      userId: userAId,
      role: 'owner',
      sessionTokenHash: hashSessionToken('pg-token-alpha-1')
    };

    scopeB = {
      workspaceId: workspaceBId,
      userId: userBId,
      role: 'owner',
      sessionTokenHash: hashSessionToken('pg-token-beta-1')
    };

    // Seed Workspace A data under scopeA
    await appDb.withScopedTransaction(scopeA, async (txClient) => {
      const tokenHashA = hashSessionToken('pg-token-alpha-1');
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
         VALUES ($1, 'alpha.pg_audit', 'test', '{"k":"v"}');`,
        [workspaceAId]
      );
      await txClient.query(
        `INSERT INTO idempotency_keys (key, workspace_id, user_id, request_path, status, expires_at)
         VALUES ('pg-key-a1', $1, $2, '/api/v1/test', 'completed', NOW() + INTERVAL '1 day');`,
        [workspaceAId, userAId]
      );
      await txClient.query(
        `INSERT INTO approval_requests (workspace_id, action_name, requester_user_id, status, risk_level, expires_at)
         VALUES ($1, 'alpha.pg_action', $2, 'pending', 'low', NOW() + INTERVAL '1 day');`,
        [workspaceAId, userAId]
      );
      await txClient.query(
        `INSERT INTO job_runs (workspace_id, job_name, status, payload)
         VALUES ($1, 'alpha.pg_job', 'queued', '{}');`,
        [workspaceAId]
      );
      const { rows: planRowsA } = await txClient.query<{ id: string }>(
        `INSERT INTO plans (workspace_id, created_by_user_id, title, status)
         VALUES ($1, $2, 'PG Plan Alpha', 'draft') RETURNING id;`,
        [workspaceAId, userAId]
      );
      planAId = planRowsA[0]!.id;
      const { rows: stepRowsA } = await txClient.query<{ id: string }>(
        `INSERT INTO plan_steps (workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode, parameters, parameter_hash, status)
         VALUES ($1, $2, 0, 'test.sample_task', 'read', 'low', 'none', '{}', 'hash-a', 'verified') RETURNING id;`,
        [workspaceAId, planAId]
      );
      stepAId = stepRowsA[0]!.id;
      await txClient.query(
        `INSERT INTO receipts (workspace_id, plan_id, plan_step_id, action_name, status, proof, verification_method, verified_at)
         VALUES ($1, $2, $3, 'test.sample_task', 'verified', '{}', 'test_assertion', NOW());`,
        [workspaceAId, planAId, stepAId]
      );

      const { rows: stepRowsA2 } = await txClient.query<{ id: string }>(
        `INSERT INTO plan_steps (workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode, parameters, parameter_hash, status)
         VALUES ($1, $2, 1, 'test.sample_task', 'read', 'low', 'none', '{}', 'hash-a2', 'blocked') RETURNING id;`,
        [workspaceAId, planAId]
      );
      stepA2Id = stepRowsA2[0]!.id;

      const { rows: stepRowsA3 } = await txClient.query<{ id: string }>(
        `INSERT INTO plan_steps (workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode, parameters, parameter_hash, status)
         VALUES ($1, $2, 2, 'test.sample_task', 'read', 'low', 'none', '{}', 'hash-a3', 'verified') RETURNING id;`,
        [workspaceAId, planAId]
      );
      stepA3Id = stepRowsA3[0]!.id;

      await txClient.query(
        `INSERT INTO plan_step_dependencies (workspace_id, plan_id, step_id, depends_on_step_id)
         VALUES ($1, $2, $3, $4);`,
        [workspaceAId, planAId, stepA2Id, stepAId]
      );

      const { rows: appRowsA } = await txClient.query<{ id: string }>(
        `INSERT INTO approval_requests (workspace_id, action_name, requester_user_id, status, risk_level, expires_at)
         VALUES ($1, 'test.sample_task', $2, 'approved', 'medium', NOW() + INTERVAL '1 day') RETURNING id;`,
        [workspaceAId, userAId]
      );
      approvalAId = appRowsA[0]!.id;
      await txClient.query(
        `INSERT INTO plan_step_approval_bindings (workspace_id, plan_id, step_id, approval_request_id, parameter_hash)
         VALUES ($1, $2, $3, $4, 'hash-a2');`,
        [workspaceAId, planAId, stepA2Id, approvalAId]
      );

      await txClient.query(
        `INSERT INTO step_executions (workspace_id, plan_id, step_id, idempotency_key, worker_id, lease_token, attempt_number, status, lease_expires_at)
         VALUES ($1, $2, $3, 'exec-key-a1', 'worker-a', gen_random_uuid(), 1, 'started', NOW() + INTERVAL '5 minutes');`,
        [workspaceAId, planAId, stepAId]
      );
    });

    // Seed Workspace B data under scopeB
    await appDb.withScopedTransaction(scopeB, async (txClient) => {
      const tokenHashB = hashSessionToken('pg-token-beta-1');
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
         VALUES ($1, 'beta.pg_audit', 'test', '{"k":"v"}');`,
        [workspaceBId]
      );
      await txClient.query(
        `INSERT INTO idempotency_keys (key, workspace_id, user_id, request_path, status, expires_at)
         VALUES ('pg-key-b1', $1, $2, '/api/v1/test', 'completed', NOW() + INTERVAL '1 day');`,
        [workspaceBId, userBId]
      );
      await txClient.query(
        `INSERT INTO approval_requests (workspace_id, action_name, requester_user_id, status, risk_level, expires_at)
         VALUES ($1, 'beta.pg_action', $2, 'pending', 'critical', NOW() + INTERVAL '1 day');`,
        [workspaceBId, userBId]
      );
      await txClient.query(
        `INSERT INTO job_runs (workspace_id, job_name, status, payload)
         VALUES ($1, 'beta.pg_job', 'queued', '{}');`,
        [workspaceBId]
      );
      const { rows: planRowsB } = await txClient.query<{ id: string }>(
        `INSERT INTO plans (workspace_id, created_by_user_id, title, status)
         VALUES ($1, $2, 'PG Plan Beta', 'draft') RETURNING id;`,
        [workspaceBId, userBId]
      );
      planBId = planRowsB[0]!.id;
      const { rows: stepRowsB } = await txClient.query<{ id: string }>(
        `INSERT INTO plan_steps (workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode, parameters, parameter_hash, status)
         VALUES ($1, $2, 0, 'test.sample_task', 'read', 'low', 'none', '{}', 'hash-b', 'verified') RETURNING id;`,
        [workspaceBId, planBId]
      );
      stepBId = stepRowsB[0]!.id;
      await txClient.query(
        `INSERT INTO receipts (workspace_id, plan_id, plan_step_id, action_name, status, proof, verification_method, verified_at)
         VALUES ($1, $2, $3, 'test.sample_task', 'verified', '{}', 'test_assertion', NOW());`,
        [workspaceBId, planBId, stepBId]
      );

      const { rows: stepRowsB2 } = await txClient.query<{ id: string }>(
        `INSERT INTO plan_steps (workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode, parameters, parameter_hash, status)
         VALUES ($1, $2, 1, 'test.sample_task', 'read', 'low', 'none', '{}', 'hash-b2', 'blocked') RETURNING id;`,
        [workspaceBId, planBId]
      );
      stepB2Id = stepRowsB2[0]!.id;

      const { rows: stepRowsB3 } = await txClient.query<{ id: string }>(
        `INSERT INTO plan_steps (workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode, parameters, parameter_hash, status)
         VALUES ($1, $2, 2, 'test.sample_task', 'read', 'low', 'none', '{}', 'hash-b3', 'verified') RETURNING id;`,
        [workspaceBId, planBId]
      );
      stepB3Id = stepRowsB3[0]!.id;

      await txClient.query(
        `INSERT INTO plan_step_dependencies (workspace_id, plan_id, step_id, depends_on_step_id)
         VALUES ($1, $2, $3, $4);`,
        [workspaceBId, planBId, stepB2Id, stepBId]
      );

      const { rows: appRowsB } = await txClient.query<{ id: string }>(
        `INSERT INTO approval_requests (workspace_id, action_name, requester_user_id, status, risk_level, expires_at)
         VALUES ($1, 'test.sample_task', $2, 'approved', 'medium', NOW() + INTERVAL '1 day') RETURNING id;`,
        [workspaceBId, userBId]
      );
      approvalBId = appRowsB[0]!.id;
      await txClient.query(
        `INSERT INTO plan_step_approval_bindings (workspace_id, plan_id, step_id, approval_request_id, parameter_hash)
         VALUES ($1, $2, $3, $4, 'hash-b2');`,
        [workspaceBId, planBId, stepB2Id, approvalBId]
      );

      await txClient.query(
        `INSERT INTO step_executions (workspace_id, plan_id, step_id, idempotency_key, worker_id, lease_token, attempt_number, status, lease_expires_at)
         VALUES ($1, $2, $3, 'exec-key-b1', 'worker-b', gen_random_uuid(), 1, 'started', NOW() + INTERVAL '5 minutes');`,
        [workspaceBId, planBId, stepBId]
      );
    });
  });

  afterAll(async () => {
    if (appDb) await appDb.close();
    if (adminDb) await adminDb.close();
  });

  it('proves the application connects directly as non-superuser thaara_app without SET ROLE', async () => {
    if (!isLive || !appDb) return;

    const res = await appDb.query<{ current_user: string; session_user: string; rolsuper: boolean }>(`
      SELECT current_user, session_user, r.rolsuper
      FROM pg_catalog.pg_roles r
      WHERE r.rolname = current_user;
    `);

    expect(res.rows[0]?.current_user).toBe('thaara_app');
    expect(res.rows[0]?.session_user).toBe('thaara_app');
    expect(res.rows[0]?.rolsuper).toBe(false);
  });

  it('proves thaara_app cannot create tables or objects in schema public (privilege boundary)', async () => {
    if (!isLive || !appDb) return;

    await expect(
      appDb.query('CREATE TABLE public.malicious_runtime_table (id INT);')
    ).rejects.toThrow(/permission denied for schema public/);
  });

  it('proves an ungranted role cannot execute SECURITY DEFINER auth boundary functions', async () => {
    if (!isLive) return;

    const unprivilegedUrl = isolatedRoleUrl(isolated, 'unprivileged_tester', ephemeralTesterPassword);
    const unprivilegedClient = new Client({ connectionString: unprivilegedUrl });

    try {
      await unprivilegedClient.connect();

      await expect(
        unprivilegedClient.query('SELECT * FROM resolve_session_scope($1);', ['any-hash'])
      ).rejects.toThrow(/permission denied for function resolve_session_scope/);

      await expect(
        unprivilegedClient.query('SELECT * FROM get_authenticated_user_memberships($1, $2);', [
          '00000000-0000-0000-0000-000000000000',
          'any@corp.com'
        ])
      ).rejects.toThrow(/permission denied for function get_authenticated_user_memberships/);
    } finally {
      await unprivilegedClient.end();
    }
  });

  it('proves narrow get_authenticated_user_memberships requires both user_id AND matching email', async () => {
    if (!isLive || !appDb) return;

    // Positive case: matching user_id and email returns membership
    const matchRes = await appDb.query<{ workspace_id: string; role: string }>(
      'SELECT * FROM get_authenticated_user_memberships($1, $2);',
      [userAId, 'alice.runtime@alpha.com']
    );
    expect(matchRes.rows.length).toBe(1);
    expect(matchRes.rows[0]?.workspace_id).toBe(workspaceAId);

    // Negative case 1: correct user_id, incorrect email returns 0 rows (prevents enumeration)
    const wrongEmailRes = await appDb.query(
      'SELECT * FROM get_authenticated_user_memberships($1, $2);',
      [userAId, 'wrong.email@other.com']
    );
    expect(wrongEmailRes.rows.length).toBe(0);

    // Negative case 2: non-existent user_id returns 0 rows
    const nonExistentRes = await appDb.query(
      'SELECT * FROM get_authenticated_user_memberships($1, $2);',
      ['00000000-0000-0000-0000-000000000000', 'alice.runtime@alpha.com']
    );
    expect(nonExistentRes.rows.length).toBe(0);
  });

  describe('Unscoped Fail-Closed (Direct queries without app.workspace_id under real PostgreSQL)', () => {
    it('unscoped SELECT on all 12 tables returns 0 rows', async () => {
      if (!isLive || !appDb) return;

      for (const table of tables) {
        const res = await appDb.query(`SELECT * FROM ${table};`);
        expect(res.rows.length, `Table ${table} must return 0 rows on unscoped SELECT`).toBe(0);
      }
    });

    it('unscoped UPDATE on all 12 tables updates 0 rows or is rejected by privilege boundary', async () => {
      if (!isLive || !appDb) return;

      for (const table of tables) {
        let updateSql = '';
        if (table === 'sessions') updateSql = `UPDATE sessions SET revoked_at = NOW()`;
        else if (table === 'memberships') updateSql = `UPDATE memberships SET role = 'admin'`;
        else if (table === 'audit_events') updateSql = `UPDATE audit_events SET action = 'tampered'`;
        else if (table === 'idempotency_keys') updateSql = `UPDATE idempotency_keys SET status = 'failed'`;
        else if (table === 'approval_requests') updateSql = `UPDATE approval_requests SET status = 'rejected'`;
        else if (table === 'job_runs') updateSql = `UPDATE job_runs SET status = 'failed'`;
        else if (table === 'plans') updateSql = `UPDATE plans SET status = 'cancelled'`;
        else if (table === 'plan_steps') updateSql = `UPDATE plan_steps SET status = 'cancelled'`;
        else if (table === 'plan_step_dependencies') updateSql = `UPDATE plan_step_dependencies SET depends_on_step_id = '00000000-0000-0000-0000-000000000000'`;
        else if (table === 'plan_step_approval_bindings') updateSql = `UPDATE plan_step_approval_bindings SET parameter_hash = 'tampered'`;
        else if (table === 'step_executions') updateSql = `UPDATE step_executions SET status = 'failed'`;
        else if (table === 'receipts') updateSql = `UPDATE receipts SET verification_method = 'tampered'`;

        if (table === 'receipts') {
          // receipts has UPDATE revoked from thaara_app (privilege boundary)
          await expect(appDb.query(`${updateSql} RETURNING *;`)).rejects.toThrow(/permission denied for table receipts/);
        } else {
          const res = await appDb.query(`${updateSql} RETURNING *;`);
          expect(res.rows.length, `Table ${table} must update 0 rows on unscoped UPDATE`).toBe(0);
        }
      }
    });

    it('unscoped DELETE on all 12 tables deletes 0 rows or is rejected by privilege boundary', async () => {
      if (!isLive || !appDb) return;

      const revokedDeleteTables = new Set([
        'plans',
        'plan_steps',
        'plan_step_approval_bindings',
        'step_executions',
        'receipts'
      ]);

      for (const table of tables) {
        if (revokedDeleteTables.has(table)) {
          await expect(appDb.query(`DELETE FROM ${table} RETURNING *;`)).rejects.toThrow(
            new RegExp(`permission denied for table ${table}`)
          );
        } else {
          const res = await appDb.query(`DELETE FROM ${table} RETURNING *;`);
          expect(res.rows.length, `Table ${table} must delete 0 rows on unscoped DELETE`).toBe(0);
        }
      }
    });

    it('unscoped INSERT fails closed with RLS violation on all 12 tables', async () => {
      if (!isLive || !appDb) return;

      // 1. sessions
      await expect(
        appDb.query(
          `INSERT INTO sessions (user_id, workspace_id, token_hash, expires_at)
           VALUES ($1, $2, 'unscoped_hash', NOW() + INTERVAL '1 day');`,
          [userAId, workspaceAId]
        )
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 2. memberships
      await expect(
        appDb.query(
          `INSERT INTO memberships (workspace_id, user_id, role)
           VALUES ($1, $2, 'member');`,
          [workspaceAId, userAId]
        )
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 3. audit_events
      await expect(
        appDb.query(
          `INSERT INTO audit_events (workspace_id, action, target_type, payload)
           VALUES ($1, 'unscoped.hack', 'test', '{}');`,
          [workspaceAId]
        )
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 4. idempotency_keys
      await expect(
        appDb.query(
          `INSERT INTO idempotency_keys (key, workspace_id, user_id, request_path, status, expires_at)
           VALUES ('unscoped-key', $1, $2, '/path', 'in_progress', NOW() + INTERVAL '1 day');`,
          [workspaceAId, userAId]
        )
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 5. approval_requests
      await expect(
        appDb.query(
          `INSERT INTO approval_requests (workspace_id, action_name, requester_user_id, status, risk_level, expires_at)
           VALUES ($1, 'unscoped.action', $2, 'pending', 'low', NOW() + INTERVAL '1 day');`,
          [workspaceAId, userAId]
        )
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 6. job_runs
      await expect(
        appDb.query(
          `INSERT INTO job_runs (workspace_id, job_name, status, payload)
           VALUES ($1, 'unscoped.job', 'queued', '{}');`,
          [workspaceAId]
        )
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 7. plans
      await expect(
        appDb.query(
          `INSERT INTO plans (workspace_id, created_by_user_id, title, status)
           VALUES ($1, $2, 'unscoped-plan', 'draft');`,
          [workspaceAId, userAId]
        )
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 8. plan_steps
      await expect(
        appDb.query(
          `INSERT INTO plan_steps (workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode, parameters, parameter_hash, status)
           VALUES ($1, $2, 99, 'test.sample_task', 'read', 'low', 'none', '{}', 'h', 'blocked');`,
          [workspaceAId, planAId]
        )
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 9. plan_step_dependencies
      await expect(
        appDb.query(
          `INSERT INTO plan_step_dependencies (workspace_id, plan_id, step_id, depends_on_step_id)
           VALUES ($1, $2, $3, $4);`,
          [workspaceAId, planAId, stepA3Id, stepAId]
        )
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 10. plan_step_approval_bindings
      await expect(
        appDb.query(
          `INSERT INTO plan_step_approval_bindings (workspace_id, plan_id, step_id, approval_request_id, parameter_hash)
           VALUES ($1, $2, $3, $4, 'hash-a3');`,
          [workspaceAId, planAId, stepA3Id, approvalAId]
        )
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 11. step_executions
      await expect(
        appDb.query(
          `INSERT INTO step_executions (workspace_id, plan_id, step_id, idempotency_key, worker_id, lease_token, attempt_number, status, lease_expires_at)
           VALUES ($1, $2, $3, 'unscoped-idem', 'w1', gen_random_uuid(), 1, 'started', NOW() + INTERVAL '5 minutes');`,
          [workspaceAId, planAId, stepA3Id]
        )
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 12. receipts
      await expect(
        appDb.query(
          `INSERT INTO receipts (workspace_id, plan_id, plan_step_id, action_name, status, proof, verification_method, verified_at)
           VALUES ($1, $2, $3, 'test.sample_task', 'verified', '{}', 'test_unscoped', NOW());`,
          [workspaceAId, planAId, stepA3Id]
        )
      ).rejects.toThrow(/new row violates row-level security policy/);
    });
  });

  describe('Cross-Workspace Tenant Isolation (Real PostgreSQL RLS)', () => {
    it('Scope A can read its own records from all 12 tables', async () => {
      if (!isLive || !appDb) return;

      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        for (const table of tables) {
          const res = await txClient.query(`SELECT * FROM ${table} WHERE workspace_id = $1;`, [workspaceAId]);
          expect(res.rows.length, `Scope A must read its own rows in ${table}`).toBeGreaterThanOrEqual(1);
        }
      });
    });

    it('Scope A cannot SELECT Workspace B records from any of the 12 tables', async () => {
      if (!isLive || !appDb) return;

      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        for (const table of tables) {
          const res = await txClient.query(`SELECT * FROM ${table} WHERE workspace_id = $1;`, [workspaceBId]);
          expect(res.rows.length, `Scope A must not read Workspace B rows from ${table}`).toBe(0);
        }
      });
    });

    it('Scope A cannot UPDATE Workspace B records in any of the 12 tables', async () => {
      if (!isLive || !appDb) return;

      for (const table of tables) {
        await appDb.withScopedTransaction(scopeA, async (txClient) => {
          let updateSql = '';
          if (table === 'sessions') updateSql = `UPDATE sessions SET revoked_at = NOW() WHERE workspace_id = $1`;
          else if (table === 'memberships') updateSql = `UPDATE memberships SET role = 'viewer' WHERE workspace_id = $1`;
          else if (table === 'audit_events') updateSql = `UPDATE audit_events SET action = 'tampered' WHERE workspace_id = $1`;
          else if (table === 'idempotency_keys') updateSql = `UPDATE idempotency_keys SET status = 'failed' WHERE workspace_id = $1`;
          else if (table === 'approval_requests') updateSql = `UPDATE approval_requests SET status = 'rejected' WHERE workspace_id = $1`;
          else if (table === 'job_runs') updateSql = `UPDATE job_runs SET status = 'failed' WHERE workspace_id = $1`;
          else if (table === 'plans') updateSql = `UPDATE plans SET status = 'cancelled' WHERE workspace_id = $1`;
          else if (table === 'plan_steps') updateSql = `UPDATE plan_steps SET status = 'cancelled' WHERE workspace_id = $1`;
          else if (table === 'plan_step_dependencies') updateSql = `UPDATE plan_step_dependencies SET depends_on_step_id = $2 WHERE workspace_id = $1`;
          else if (table === 'plan_step_approval_bindings') updateSql = `UPDATE plan_step_approval_bindings SET parameter_hash = 'tampered' WHERE workspace_id = $1`;
          else if (table === 'step_executions') updateSql = `UPDATE step_executions SET status = 'failed' WHERE workspace_id = $1`;
          else if (table === 'receipts') updateSql = `UPDATE receipts SET verification_method = 'tampered' WHERE workspace_id = $1`;

          if (table === 'receipts') {
            await expect(txClient.query(`${updateSql} RETURNING *;`, [workspaceBId])).rejects.toThrow(/permission denied for table receipts/);
          } else {
            const params = table === 'plan_step_dependencies' ? [workspaceBId, stepBId] : [workspaceBId];
            const res = await txClient.query(`${updateSql} RETURNING *;`, params);
            expect(res.rows.length, `Scope A must update 0 Workspace B rows in ${table}`).toBe(0);
          }
        });
      }
    });

    it('Scope A cannot DELETE Workspace B records in any of the 12 tables', async () => {
      if (!isLive || !appDb) return;

      const revokedDeleteTables = new Set([
        'plans',
        'plan_steps',
        'plan_step_approval_bindings',
        'step_executions',
        'receipts'
      ]);

      for (const table of tables) {
        await appDb.withScopedTransaction(scopeA, async (txClient) => {
          if (revokedDeleteTables.has(table)) {
            await expect(txClient.query(`DELETE FROM ${table} WHERE workspace_id = $1 RETURNING *;`, [workspaceBId])).rejects.toThrow(
              new RegExp(`permission denied for table ${table}`)
            );
          } else {
            const res = await txClient.query(`DELETE FROM ${table} WHERE workspace_id = $1 RETURNING *;`, [workspaceBId]);
            expect(res.rows.length, `Scope A must delete 0 Workspace B rows in ${table}`).toBe(0);
          }
        });
      }
    });

    it('Scope A cannot INSERT records claiming Workspace B workspace_id (RLS WITH CHECK rejection)', async () => {
      if (!isLive || !appDb) return;

      // 1. sessions
      await expect(
        appDb.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO sessions (user_id, workspace_id, token_hash, expires_at)
             VALUES ($1, $2, 'cross_hash', NOW() + INTERVAL '1 day');`,
            [userAId, workspaceBId]
          );
        })
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 2. memberships
      await expect(
        appDb.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO memberships (workspace_id, user_id, role)
             VALUES ($1, $2, 'admin');`,
            [workspaceBId, userAId]
          );
        })
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 3. audit_events
      await expect(
        appDb.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO audit_events (workspace_id, action, target_type, payload)
             VALUES ($1, 'cross.audit', 'exploit', '{}');`,
            [workspaceBId]
          );
        })
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 4. idempotency_keys
      await expect(
        appDb.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO idempotency_keys (key, workspace_id, user_id, request_path, status, expires_at)
             VALUES ('cross-key', $1, $2, '/path', 'in_progress', NOW() + INTERVAL '1 day');`,
            [workspaceBId, userAId]
          );
        })
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 5. approval_requests
      await expect(
        appDb.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO approval_requests (workspace_id, action_name, requester_user_id, status, risk_level, expires_at)
             VALUES ($1, 'cross.approval', $2, 'pending', 'critical', NOW() + INTERVAL '1 day');`,
            [workspaceBId, userAId]
          );
        })
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 6. job_runs
      await expect(
        appDb.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO job_runs (workspace_id, job_name, status, payload)
             VALUES ($1, 'cross.job', 'queued', '{}');`,
            [workspaceBId]
          );
        })
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 7. plans
      await expect(
        appDb.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO plans (workspace_id, created_by_user_id, title, status)
             VALUES ($1, $2, 'cross-plan', 'draft');`,
            [workspaceBId, userAId]
          );
        })
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 8. plan_steps
      await expect(
        appDb.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO plan_steps (workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode, parameters, parameter_hash, status)
             VALUES ($1, $2, 99, 'test.sample_task', 'read', 'low', 'none', '{}', 'h', 'blocked');`,
            [workspaceBId, planBId]
          );
        })
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 9. plan_step_dependencies
      await expect(
        appDb.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO plan_step_dependencies (workspace_id, plan_id, step_id, depends_on_step_id)
             VALUES ($1, $2, $3, $4);`,
            [workspaceBId, planBId, stepB3Id, stepBId]
          );
        })
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 10. plan_step_approval_bindings
      await expect(
        appDb.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO plan_step_approval_bindings (workspace_id, plan_id, step_id, approval_request_id, parameter_hash)
             VALUES ($1, $2, $3, $4, 'hash-b3');`,
            [workspaceBId, planBId, stepB3Id, approvalBId]
          );
        })
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 11. step_executions
      await expect(
        appDb.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO step_executions (workspace_id, plan_id, step_id, idempotency_key, worker_id, lease_token, attempt_number, status, lease_expires_at)
             VALUES ($1, $2, $3, 'cross-idem', 'w1', gen_random_uuid(), 1, 'started', NOW() + INTERVAL '5 minutes');`,
            [workspaceBId, planBId, stepB3Id]
          );
        })
      ).rejects.toThrow(/new row violates row-level security policy/);

      // 12. receipts
      await expect(
        appDb.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO receipts (workspace_id, plan_id, plan_step_id, action_name, status, proof, verification_method, verified_at)
             VALUES ($1, $2, $3, 'test.sample_task', 'verified', '{}', 'test_cross', NOW());`,
            [workspaceBId, planBId, stepB3Id]
          );
        })
      ).rejects.toThrow(/new row violates row-level security policy/);
    });
  });

  describe('SECURITY DEFINER Scope Resolution & Tenant Safety (Real PostgreSQL)', () => {
    it('resolve_session_scope safely resolves valid session token hash to tenant scope', async () => {
      if (!isLive || !appDb) return;

      const tokenHashA = hashSessionToken('pg-token-alpha-1');
      const res = await appDb.query<{
        session_id: string;
        workspace_id: string;
        user_id: string;
        role: string;
      }>('SELECT * FROM resolve_session_scope($1);', [tokenHashA]);

      expect(res.rows.length).toBe(1);
      expect(res.rows[0]?.workspace_id).toBe(workspaceAId);
      expect(res.rows[0]?.user_id).toBe(userAId);
      expect(res.rows[0]?.role).toBe('owner');
    });

    it('resolve_session_scope returns 0 rows for invalid or nonexistent token hash', async () => {
      if (!isLive || !appDb) return;

      const res = await appDb.query('SELECT * FROM resolve_session_scope($1);', ['nonexistent_hash']);
      expect(res.rows.length).toBe(0);
    });
  });

  describe('Approval Authorization & Cross-Tenant Rejection (Real PostgreSQL Path)', () => {
    it('enforces tenant boundary and atomic status transitions on approval requests', async () => {
      if (!isLive || !appDb) return;

      // 1. Create approval request under Workspace A
      let approvalId = '';
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        const { rows } = await txClient.query<{ id: string }>(
          `INSERT INTO approval_requests (workspace_id, action_name, requester_user_id, status, risk_level, expires_at)
           VALUES ($1, 'cloud.deploy', $2, 'pending', 'critical', NOW() + INTERVAL '1 day')
           RETURNING id;`,
          [workspaceAId, userAId]
        );
        approvalId = rows[0]!.id;
      });

      // 2. Scope B cannot read or update Workspace A's approval request
      await appDb.withScopedTransaction(scopeB, async (txClient) => {
        const selectRes = await txClient.query(
          `SELECT * FROM approval_requests WHERE id = $1;`,
          [approvalId]
        );
        expect(selectRes.rows.length).toBe(0);

        const updateRes = await txClient.query(
          `UPDATE approval_requests SET status = 'approved' WHERE id = $1 RETURNING *;`,
          [approvalId]
        );
        expect(updateRes.rows.length).toBe(0);
      });

      // 3. Scope A atomic transition from pending to approved succeeds
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        const transitionRes = await txClient.query(
          `UPDATE approval_requests
           SET status = 'approved', updated_at = NOW()
           WHERE workspace_id = $1 AND id = $2 AND status = 'pending'
           RETURNING *;`,
          [workspaceAId, approvalId]
        );
        expect(transitionRes.rows.length).toBe(1);
        expect(transitionRes.rows[0]?.status).toBe('approved');
      });

      // 4. Second transition on already-decided approval returns 0 rows (terminal state protection)
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        const doubleTransitionRes = await txClient.query(
          `UPDATE approval_requests
           SET status = 'rejected', updated_at = NOW()
           WHERE workspace_id = $1 AND id = $2 AND status = 'pending'
           RETURNING *;`,
          [workspaceAId, approvalId]
        );
        expect(doubleTransitionRes.rows.length).toBe(0);
      });
    });
  });

  describe('Plan, Step, and Receipt Governed Lifecycle (Real PostgreSQL Path)', () => {
    it('enforces optimistic locking and status transitions on plans and steps under RLS', async () => {
      if (!isLive || !appDb) return;

      let runtimePlanId = '';
      let runtimeStepId = '';

      // 1. Create plan and step under Scope A
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        const { rows: planRows } = await txClient.query<{ id: string }>(
          `INSERT INTO plans (workspace_id, created_by_user_id, title, status)
           VALUES ($1, $2, 'Runtime Execution Plan', 'draft') RETURNING id;`,
          [workspaceAId, userAId]
        );
        runtimePlanId = planRows[0]!.id;

        const { rows: stepRows } = await txClient.query<{ id: string }>(
          `INSERT INTO plan_steps (workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode, parameters, parameter_hash, status)
           VALUES ($1, $2, 0, 'test.sample_task', 'read', 'low', 'none', '{}', 'param-hash-live', 'blocked') RETURNING id;`,
          [workspaceAId, runtimePlanId]
        );
        runtimeStepId = stepRows[0]!.id;
      });

      // 2. Scope B cannot read or transition Scope A's plan
      await appDb.withScopedTransaction(scopeB, async (txClient) => {
        const selectPlan = await txClient.query(`SELECT * FROM plans WHERE id = $1;`, [runtimePlanId]);
        expect(selectPlan.rows.length).toBe(0);

        const updatePlan = await txClient.query(
          `UPDATE plans SET status = 'cancelled' WHERE id = $1 RETURNING *;`,
          [runtimePlanId]
        );
        expect(updatePlan.rows.length).toBe(0);
      });

      // 3. Scope A optimistic locking: update with version = 1 increments to version = 2
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        const versionedUpdate = await txClient.query<{ version: number; status: string }>(
          `UPDATE plans
           SET status = 'queued', version = version + 1, updated_at = NOW()
           WHERE workspace_id = $1 AND id = $2 AND status = 'draft' AND version = 1
           RETURNING version, status;`,
          [workspaceAId, runtimePlanId]
        );
        expect(versionedUpdate.rows.length).toBe(1);
        expect(versionedUpdate.rows[0]?.version).toBe(2);
        expect(versionedUpdate.rows[0]?.status).toBe('queued');

        // Step transition to running, then to verified
        const stepTransition = await txClient.query<{ status: string }>(
          `UPDATE plan_steps
           SET status = 'running', version = version + 1, updated_at = NOW()
           WHERE workspace_id = $1 AND id = $2 AND status = 'blocked'
           RETURNING status;`,
          [workspaceAId, runtimeStepId]
        );
        expect(stepTransition.rows.length).toBe(1);
        expect(stepTransition.rows[0]?.status).toBe('running');

        const stepVerify = await txClient.query<{ status: string }>(
          `UPDATE plan_steps
           SET status = 'verified', version = version + 1, updated_at = NOW()
           WHERE workspace_id = $1 AND id = $2 AND status = 'running'
           RETURNING status;`,
          [workspaceAId, runtimeStepId]
        );
        expect(stepVerify.rows.length).toBe(1);
        expect(stepVerify.rows[0]?.status).toBe('verified');

        // Persist verified receipt
        const receiptInsert = await txClient.query<{ status: string }>(
          `INSERT INTO receipts (workspace_id, plan_id, plan_step_id, action_name, status, proof, verification_method, verified_at)
           VALUES ($1, $2, $3, 'test.sample_task', 'verified', '{"executed":true}', 'post_condition_verified', NOW())
           RETURNING status;`,
          [workspaceAId, runtimePlanId, runtimeStepId]
        );
        expect(receiptInsert.rows.length).toBe(1);
        expect(receiptInsert.rows[0]?.status).toBe('verified');
      });

      // Assert privilege boundary: thaara_app cannot mutate or delete receipts (isolated transactions)
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        await expect(
          txClient.query(`UPDATE receipts SET verification_method = 'tampered' WHERE workspace_id = $1;`, [workspaceAId])
        ).rejects.toThrow(/permission denied for table receipts/);
      });

      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        await expect(
          txClient.query(`DELETE FROM receipts WHERE workspace_id = $1;`, [workspaceAId])
        ).rejects.toThrow(/permission denied for table receipts/);
      });

      // Assert privilege boundary: thaara_app cannot delete durable step executions
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        await expect(
          txClient.query(`DELETE FROM step_executions WHERE workspace_id = $1;`, [workspaceAId])
        ).rejects.toThrow(/permission denied for table step_executions/);
      });
    });
  });

  describe('PostgreSQL Runtime Governed State-Machine & Immutability Proof', () => {
    it('proves invalid plan transitions fail under database runtime trigger', async () => {
      if (!isLive || !appDb) return;

      let testPlanId = '';
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        const { rows } = await txClient.query<{ id: string }>(
          `INSERT INTO plans (workspace_id, created_by_user_id, title, status)
           VALUES ($1, $2, 'Invalid Plan Transition Test', 'draft') RETURNING id;`,
          [workspaceAId, userAId]
        );
        testPlanId = rows[0]!.id;
      });

      // draft -> completed directly is prohibited by allowed transition matrix
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        await expect(
          txClient.query(
            `UPDATE plans SET status = 'completed', version = version + 1 WHERE workspace_id = $1 AND id = $2;`,
            [workspaceAId, testPlanId]
          )
        ).rejects.toThrow(/Invalid plan state transition from draft to completed/);
      });
    });

    it('proves invalid step transitions fail under database runtime trigger', async () => {
      if (!isLive || !appDb) return;

      let testPlanId = '';
      let testStepId = '';
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        const { rows: planRows } = await txClient.query<{ id: string }>(
          `INSERT INTO plans (workspace_id, created_by_user_id, title, status)
           VALUES ($1, $2, 'Invalid Step Transition Test', 'draft') RETURNING id;`,
          [workspaceAId, userAId]
        );
        testPlanId = planRows[0]!.id;

        const { rows: stepRows } = await txClient.query<{ id: string }>(
          `INSERT INTO plan_steps (workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode, parameters, parameter_hash, status)
           VALUES ($1, $2, 0, 'test.sample_task', 'read', 'low', 'none', '{}', 'hash-1', 'blocked') RETURNING id;`,
          [workspaceAId, testPlanId]
        );
        testStepId = stepRows[0]!.id;
      });

      // blocked -> verified directly is prohibited (must transition through running)
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        await expect(
          txClient.query(
            `UPDATE plan_steps SET status = 'verified', version = version + 1 WHERE workspace_id = $1 AND id = $2;`,
            [workspaceAId, testStepId]
          )
        ).rejects.toThrow(/Invalid plan step state transition from blocked to verified/);
      });
    });

    it('proves version skips and version replays fail on plans and steps (optimistic locking)', async () => {
      if (!isLive || !appDb) return;

      let testPlanId = '';
      let testStepId = '';
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        const { rows: planRows } = await txClient.query<{ id: string }>(
          `INSERT INTO plans (workspace_id, created_by_user_id, title, status)
           VALUES ($1, $2, 'Version Test Plan', 'draft') RETURNING id;`,
          [workspaceAId, userAId]
        );
        testPlanId = planRows[0]!.id;

        const { rows: stepRows } = await txClient.query<{ id: string }>(
          `INSERT INTO plan_steps (workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode, parameters, parameter_hash, status)
           VALUES ($1, $2, 0, 'test.sample_task', 'read', 'low', 'none', '{}', 'hash-ver', 'blocked') RETURNING id;`,
          [workspaceAId, testPlanId]
        );
        testStepId = stepRows[0]!.id;
      });

      // 1. Version replay on plan (version unchanged: 1 -> 1)
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        await expect(
          txClient.query(
            `UPDATE plans SET title = 'Replay Title', version = 1 WHERE workspace_id = $1 AND id = $2;`,
            [workspaceAId, testPlanId]
          )
        ).rejects.toThrow(/Optimistic concurrency violation on plans: expected version 2, got 1/);
      });

      // 2. Version skip on plan (version skip: 1 -> 3)
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        await expect(
          txClient.query(
            `UPDATE plans SET title = 'Skip Title', version = 3 WHERE workspace_id = $1 AND id = $2;`,
            [workspaceAId, testPlanId]
          )
        ).rejects.toThrow(/Optimistic concurrency violation on plans: expected version 2, got 3/);
      });

      // 3. Version replay on step (version unchanged: 1 -> 1)
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        await expect(
          txClient.query(
            `UPDATE plan_steps SET status = 'running', version = 1 WHERE workspace_id = $1 AND id = $2;`,
            [workspaceAId, testStepId]
          )
        ).rejects.toThrow(/Optimistic concurrency violation on plan_steps: expected version 2, got 1/);
      });

      // 4. Version skip on step (version skip: 1 -> 4)
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        await expect(
          txClient.query(
            `UPDATE plan_steps SET status = 'running', version = 4 WHERE workspace_id = $1 AND id = $2;`,
            [workspaceAId, testStepId]
          )
        ).rejects.toThrow(/Optimistic concurrency violation on plan_steps: expected version 2, got 4/);
      });
    });

    it('proves terminal mutation bypasses fail on terminal plans and terminal steps', async () => {
      if (!isLive || !appDb) return;

      let termPlanId = '';
      let termStepId = '';
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        const { rows: planRows } = await txClient.query<{ id: string }>(
          `INSERT INTO plans (workspace_id, created_by_user_id, title, status)
           VALUES ($1, $2, 'Terminal Test Plan', 'draft') RETURNING id;`,
          [workspaceAId, userAId]
        );
        termPlanId = planRows[0]!.id;

        const { rows: stepRows } = await txClient.query<{ id: string }>(
          `INSERT INTO plan_steps (workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode, parameters, parameter_hash, status)
           VALUES ($1, $2, 0, 'test.sample_task', 'read', 'low', 'none', '{}', 'hash-term', 'blocked') RETURNING id;`,
          [workspaceAId, termPlanId]
        );
        termStepId = stepRows[0]!.id;

        // Transition step through running to verified (terminal)
        await txClient.query(
          `UPDATE plan_steps SET status = 'running', version = version + 1 WHERE id = $1;`,
          [termStepId]
        );
        await txClient.query(
          `UPDATE plan_steps SET status = 'verified', version = version + 1 WHERE id = $1;`,
          [termStepId]
        );

        // Cancel the plan (terminal)
        await txClient.query(
          `UPDATE plans SET status = 'cancelled', version = version + 1 WHERE id = $1;`,
          [termPlanId]
        );
      });

      // Attempt to mutate terminal plan (even with valid version increment and same or different status)
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        await expect(
          txClient.query(
            `UPDATE plans SET title = 'Tampered Cancelled Plan', version = version + 1 WHERE workspace_id = $1 AND id = $2;`,
            [workspaceAId, termPlanId]
          )
        ).rejects.toThrow(/is in terminal state cancelled and cannot be modified/);
      });

      // Attempt to mutate terminal step (even with valid version increment and same status metadata update)
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        await expect(
          txClient.query(
            `UPDATE plan_steps SET error = '{"tampered":true}', version = version + 1 WHERE workspace_id = $1 AND id = $2;`,
            [workspaceAId, termStepId]
          )
        ).rejects.toThrow(/is in terminal state verified and cannot be modified/);
      });
    });

    it('proves dependency INSERT after plan submission fails closed', async () => {
      if (!isLive || !appDb) return;

      let subPlanId = '';
      let step1Id = '';
      let step2Id = '';
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        const { rows: planRows } = await txClient.query<{ id: string }>(
          `INSERT INTO plans (workspace_id, created_by_user_id, title, status)
           VALUES ($1, $2, 'Submitted Plan for Dep Insert Test', 'draft') RETURNING id;`,
          [workspaceAId, userAId]
        );
        subPlanId = planRows[0]!.id;

        const { rows: s1Rows } = await txClient.query<{ id: string }>(
          `INSERT INTO plan_steps (workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode, parameters, parameter_hash, status)
           VALUES ($1, $2, 0, 'test.sample_task', 'read', 'low', 'none', '{}', 'hash-s1', 'blocked') RETURNING id;`,
          [workspaceAId, subPlanId]
        );
        step1Id = s1Rows[0]!.id;

        const { rows: s2Rows } = await txClient.query<{ id: string }>(
          `INSERT INTO plan_steps (workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode, parameters, parameter_hash, status)
           VALUES ($1, $2, 1, 'test.sample_task', 'read', 'low', 'none', '{}', 'hash-s2', 'blocked') RETURNING id;`,
          [workspaceAId, subPlanId]
        );
        step2Id = s2Rows[0]!.id;

        // Transition plan to queued (submitted)
        await txClient.query(
          `UPDATE plans SET status = 'queued', version = version + 1 WHERE workspace_id = $1 AND id = $2;`,
          [workspaceAId, subPlanId]
        );
      });

      // Attempt dependency INSERT after submission
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        await expect(
          txClient.query(
            `INSERT INTO plan_step_dependencies (workspace_id, plan_id, step_id, depends_on_step_id)
             VALUES ($1, $2, $3, $4);`,
            [workspaceAId, subPlanId, step2Id, step1Id]
          )
        ).rejects.toThrow(/Plan dependencies cannot be modified after submission/);
      });
    });
  });

  describe('SECURITY DEFINER Hardening and Search Path Isolation (Task 002)', () => {
    const secDefFunctions = [
      'enforce_plan_state_transition',
      'enforce_plan_step_state_transition',
      'enforce_dep_immutability',
      'enforce_step_exec_immutability',
      'enforce_receipt_integrity',
      'reject_receipt_mutation'
    ] as const;

    it('proves every SECURITY DEFINER trigger function has search_path pinned to pg_catalog, public, pg_temp with pg_temp last', async () => {
      if (!isLive || !adminDb) return;

      for (const fnName of secDefFunctions) {
        const res = await adminDb.query<{ prosecdef: boolean; proconfig: string[] | null }>(
          `SELECT p.prosecdef, p.proconfig
           FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = $1;`,
          [fnName]
        );

        expect(res.rows.length).toBe(1);
        const row = res.rows[0]!;
        expect(row.prosecdef).toBe(true);
        expect(row.proconfig).not.toBeNull();

        const searchPathConfig = row.proconfig?.find((c) => c.startsWith('search_path='));
        expect(searchPathConfig).toBeDefined();
        expect(searchPathConfig).toBe('search_path=pg_catalog, public, pg_temp');

        // Verify pg_temp is strictly the last entry in the search path list
        const schemas = searchPathConfig!
          .replace('search_path=', '')
          .split(',')
          .map((s) => s.trim());
        expect(schemas[schemas.length - 1]).toBe('pg_temp');
        expect(schemas[0]).toBe('pg_catalog');
      }
    });

    it('proves PUBLIC has no execute privilege on any SECURITY DEFINER trigger function in pg_catalog', async () => {
      if (!isLive || !adminDb) return;

      for (const fnName of secDefFunctions) {
        const res = await adminDb.query<{ has_priv: boolean }>(
          `SELECT has_function_privilege('public', 'public.' || $1 || '()', 'execute') AS has_priv;`,
          [fnName]
        );
        expect(res.rows[0]?.has_priv).toBe(false);
      }
    });

    it('proves an unprivileged client cannot invoke SECURITY DEFINER functions directly', async () => {
      if (!isLive) return;

      const unprivilegedUrl = isolatedRoleUrl(isolated, 'unprivileged_tester', ephemeralTesterPassword);
      const unprivilegedClient = new Client({ connectionString: unprivilegedUrl });

      try {
        await unprivilegedClient.connect();

        for (const fnName of secDefFunctions) {
          await expect(
            unprivilegedClient.query(`SELECT public.${fnName}();`)
          ).rejects.toThrow(/permission denied for function/);
        }
      } finally {
        await unprivilegedClient.end();
      }
    });

    it('proves thaara_app cannot call trigger functions directly in SQL to bypass RLS or escalate privilege', async () => {
      if (!isLive || !appDb) return;

      for (const fnName of secDefFunctions) {
        await expect(
          appDb.query(`SELECT public.${fnName}();`)
        ).rejects.toThrow(/(cannot call function returning trigger|trigger functions can only be called as triggers|permission denied)/);
      }
    });

    it('proves thaara_app cannot make public schema writable to inject shadow objects', async () => {
      if (!isLive || !appDb) return;

      const res = await appDb.query<{ has_create: boolean }>(
        `SELECT has_schema_privilege('thaara_app', 'public', 'create') AS has_create;`
      );
      expect(res.rows[0]?.has_create).toBe(false);

      await expect(
        appDb.query('CREATE TABLE public.temp_exploit (id int);')
      ).rejects.toThrow(/permission denied for schema public/);
    });

    it('proves thaara_app cannot perform tenant escape or trigger mutation across workspace boundaries', async () => {
      if (!isLive || !appDb) return;

      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        // Attempting to update a plan belonging to workspace B while scoped to workspace A
        // RLS filters out workspace B completely (0 rows affected), preventing trigger from touching foreign workspace
        const updateRes = await txClient.query(
          `UPDATE plans SET title = 'Escaped Plan' WHERE id = $1 RETURNING *;`,
          [planBId]
        );
        expect(updateRes.rows.length).toBe(0);

        // Attempting to insert a step tied to workspace B's plan while scoped to workspace A
        // Foreign key and RLS prevent unauthorized cross-tenant binding
        await expect(
          txClient.query(
            `INSERT INTO plan_steps (workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode, parameters, parameter_hash, status)
             VALUES ($1, $2, 99, 'test.escape', 'read', 'low', 'none', '{}', 'hash-esc', 'ready');`,
            [workspaceAId, planBId]
          )
        ).rejects.toThrow(/(violates foreign key constraint|fk_plan_steps_plan)/);
      });
    });

    it('proves trigger execution still works through normal DML under thaara_app role', async () => {
      if (!isLive || !appDb) return;

      let normPlanId = '';
      let normStep1Id = '';
      let normStep2Id = '';

      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        // 1. Insert draft plan (proves plans trigger allows draft creation)
        const { rows: planRows } = await txClient.query<{ id: string }>(
          `INSERT INTO plans (workspace_id, created_by_user_id, title, status)
           VALUES ($1, $2, 'Normal DML Lifecycle Plan', 'draft') RETURNING id;`,
          [workspaceAId, userAId]
        );
        normPlanId = planRows[0]!.id;

        // 2. Insert plan steps (proves plan_steps trigger allows steps in draft)
        const { rows: s1Rows } = await txClient.query<{ id: string }>(
          `INSERT INTO plan_steps (workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode, parameters, parameter_hash, status)
           VALUES ($1, $2, 0, 'test.step_one', 'read', 'low', 'none', '{}', 'hash-norm-1', 'ready') RETURNING id;`,
          [workspaceAId, normPlanId]
        );
        normStep1Id = s1Rows[0]!.id;

        const { rows: s2Rows } = await txClient.query<{ id: string }>(
          `INSERT INTO plan_steps (workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode, parameters, parameter_hash, status)
           VALUES ($1, $2, 1, 'test.step_two', 'write', 'medium', 'none', '{}', 'hash-norm-2', 'blocked') RETURNING id;`,
          [workspaceAId, normPlanId]
        );
        normStep2Id = s2Rows[0]!.id;

        // 3. Insert dependency while draft (proves enforce_dep_immutability allows draft insert)
        await txClient.query(
          `INSERT INTO plan_step_dependencies (workspace_id, plan_id, step_id, depends_on_step_id)
           VALUES ($1, $2, $3, $4);`,
          [workspaceAId, normPlanId, normStep2Id, normStep1Id]
        );

        // 4. Submit plan to queued (proves enforce_plan_state_transition allows draft -> queued)
        await txClient.query(
          `UPDATE plans SET status = 'queued', version = version + 1 WHERE id = $1;`,
          [normPlanId]
        );

        // 5. Start plan and step 1 (proves state transitions)
        await txClient.query(
          `UPDATE plans SET status = 'running', version = version + 1 WHERE id = $1;`,
          [normPlanId]
        );
        await txClient.query(
          `UPDATE plan_steps SET status = 'running', version = version + 1 WHERE id = $1;`,
          [normStep1Id]
        );

        // 6. Record step execution (proves enforce_step_exec_immutability allows step_executions insert)
        await txClient.query(
          `INSERT INTO step_executions (workspace_id, plan_id, step_id, idempotency_key, worker_id, lease_token, attempt_number, status, lease_expires_at)
           VALUES ($1, $2, $3, 'exec-norm-1', 'worker-norm', gen_random_uuid(), 1, 'completed', NOW() + INTERVAL '5 minutes');`,
          [workspaceAId, normPlanId, normStep1Id]
        );

        // 7. Verify step 1 and insert verified receipt (proves enforce_receipt_integrity works)
        await txClient.query(
          `UPDATE plan_steps SET status = 'verified', version = version + 1 WHERE id = $1;`,
          [normStep1Id]
        );
        await txClient.query(
          `INSERT INTO receipts (workspace_id, plan_id, plan_step_id, action_name, status, proof, verification_method, verified_at)
           VALUES ($1, $2, $3, 'test.step_one', 'verified', '{"proof":"valid"}', 'automated', NOW());`,
          [workspaceAId, normPlanId, normStep1Id]
        );

        // 8. Advance and verify step 2
        await txClient.query(
          `UPDATE plan_steps SET status = 'ready', version = version + 1 WHERE id = $1;`,
          [normStep2Id]
        );
        await txClient.query(
          `UPDATE plan_steps SET status = 'running', version = version + 1 WHERE id = $1;`,
          [normStep2Id]
        );
        await txClient.query(
          `UPDATE plan_steps SET status = 'verified', version = version + 1 WHERE id = $1;`,
          [normStep2Id]
        );
        await txClient.query(
          `INSERT INTO receipts (workspace_id, plan_id, plan_step_id, action_name, status, proof, verification_method, verified_at)
           VALUES ($1, $2, $3, 'test.step_two', 'verified', '{"proof":"valid2"}', 'automated', NOW());`,
          [workspaceAId, normPlanId, normStep2Id]
        );

        // 9. Complete plan (proves completion guard passes with all steps verified)
        const { rows: completedPlan } = await txClient.query<{ status: string }>(
          `UPDATE plans SET status = 'completed', version = version + 1 WHERE id = $1 RETURNING status;`,
          [normPlanId]
        );
        expect(completedPlan[0]?.status).toBe('completed');
      });

      // 10. Reject receipt mutation under thaara_app (isolated transaction: table-level privileges prevent update)
      await appDb.withScopedTransaction(scopeA, async (txClient) => {
        await expect(
          txClient.query(
            `UPDATE receipts SET status = 'failed' WHERE plan_step_id = $1;`,
            [normStep1Id]
          )
        ).rejects.toThrow(/permission denied for table receipts/);
      });

      // 11. Proves the reject_receipt_mutation trigger itself enforces terminal immutability even if executed by adminDb
      if (adminDb && normStep1Id) {
        await expect(
          adminDb.query(
            `UPDATE public.receipts SET status = 'failed' WHERE plan_step_id = $1;`,
            [normStep1Id]
          )
        ).rejects.toThrow(/Receipts are immutable terminal records and cannot be updated or deleted/);
      }
    });
  });
});
