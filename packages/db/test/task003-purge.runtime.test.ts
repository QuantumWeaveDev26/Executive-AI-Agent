import { getIsolatedRuntimeConfig, isolatedRoleUrl } from '../../../scripts/step74-runtime-guard.mjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import pg from 'pg';
import { PostgresDatabase, RoleAwarePool, AuthenticatedScope } from '../src/client.js';
import { Migrator } from '../src/migrator.js';
import { WorkspaceRepository } from '../src/repositories/workspaces.js';
import { UserRepository } from '../src/repositories/users.js';
import { MembershipRepository } from '../src/repositories/memberships.js';
import { SessionRepository, hashSessionToken } from '../src/repositories/sessions.js';
import { WorkerPurgeRepository } from '../src/repositories/worker/worker-purge.js';
import { WorkerOutboxRepository } from '../src/repositories/worker/worker-outbox.js';
import { bootstrapRuntimeIdentities } from '../scripts/bootstrap-runtime-identities.js';

const { Client } = pg;

const isolated = getIsolatedRuntimeConfig();

describe('Task 003 Phase 4: Hardened Privacy Purge & Outbox Fencing Runtime (Real PostgreSQL)', () => {
  const migrationDbUrl = isolated.migrationUrl;
  const appDbUrl = isolated.appUrl;

  let isLive = false;
  let adminDb: PostgresDatabase | null = null;
  let appDb: PostgresDatabase | null = null;
  let workerPool: RoleAwarePool | null = null;
  let unprivilegedClient: pg.Client | null = null;
  let unprivilegedTesterPassword: string;

  let workspaceAId: string;
  let workspaceBId: string;
  let userAId: string;
  let userBId: string;
  let tokenA: string;
  let tokenHashA: string;
  let tokenB: string;
  let tokenHashB: string;

  let scopeA: AuthenticatedScope;
  let scopeB: AuthenticatedScope;

  const adminPw = process.env.THAARA_DB_ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
  const workerPw = process.env.THAARA_DB_WORKER_PASSWORD || crypto.randomBytes(16).toString('hex');
  const seederPw = process.env.THAARA_DB_SEEDER_PASSWORD || crypto.randomBytes(16).toString('hex');

  const purgeWorkerFunctions = [
    'schedule_purge_continuation',
    'claim_purge_continuation',
    'claim_unrecovered_purge_continuations',
    'recover_stranded_purge_operations',
    'complete_purge_operation',
    'fail_purge_operation',
    'mark_outbox_failed',
    'get_purge_operation'
  ] as const;

  beforeAll(async () => {
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
            `Underlying error: ${(err as Error).message}`
        );
      }
      console.warn(
        `[Task 003 Purge Runtime] PostgreSQL is not reachable at 127.0.0.1:15432/thaara_step74_test. ` +
          `ALLOW_OFFLINE_RUNTIME_SKIP=true is set; skipping live queries.`
      );
      return;
    }

    if (!appDbUrl) {
      throw new Error(
        `[Runtime Proof Failure] DATABASE_URL must be provided with valid non-superuser thaara_app credentials.`
      );
    }

    // 1. Run migrations as migration admin
    adminDb = new PostgresDatabase(migrationDbUrl);
    const migrator = new Migrator(adminDb);
    await migrator.migrate(migrator.loadMigrationFiles());

    const parsedMigrationUrl = new URL(migrationDbUrl);
    const dbName = parsedMigrationUrl.pathname.replace(/^\//, '');

    // 2. Provision / bootstrap runtime roles
    await bootstrapRuntimeIdentities(adminDb, {
      databaseName: dbName,
      adminPassword: adminPw,
      workerPassword: workerPw,
      seederPassword: seederPw
    });

    // 3. Connect app database as thaara_app
    appDb = new PostgresDatabase(appDbUrl);

    // 4. Connect worker pool as thaara_worker
    workerPool = new RoleAwarePool({
      connectionString: isolatedRoleUrl(isolated, 'thaara_worker_user', workerPw),
      targetRole: 'thaara_worker',
      expectedLoginUser: 'thaara_worker_user'
    });

    // 5. Create unprivileged tester role for boundary testing
    unprivilegedTesterPassword = crypto.randomBytes(16).toString('hex');
    await adminDb.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'unprivileged_tester_t003_purge') THEN
          CREATE ROLE unprivileged_tester_t003_purge WITH LOGIN PASSWORD '${unprivilegedTesterPassword}';
        ELSE
          ALTER ROLE unprivileged_tester_t003_purge WITH PASSWORD '${unprivilegedTesterPassword}';
        END IF;
      END $$;
      GRANT CONNECT ON DATABASE ${dbName} TO unprivileged_tester_t003_purge;
      GRANT USAGE ON SCHEMA public TO unprivileged_tester_t003_purge;
    `);

    unprivilegedClient = new Client({
      connectionString: isolatedRoleUrl(isolated, 'unprivileged_tester_t003_purge', unprivilegedTesterPassword)
    });
    await unprivilegedClient.connect();

    // 6. Seed test tenants and users
    const wsRepo = new WorkspaceRepository(appDb);
    const userRepo = new UserRepository(appDb);

    const wsA = await wsRepo.create('Purge Org Alpha');
    workspaceAId = wsA.id;
    const userA = await userRepo.create('alice.purge@alpha.com', 'hashA', 'Alice Purge');
    userAId = userA.id;
    tokenA = crypto.randomBytes(32).toString('hex');
    tokenHashA = hashSessionToken(tokenA);

    scopeA = {
      workspaceId: workspaceAId,
      userId: userAId,
      role: 'owner',
      sessionTokenHash: tokenHashA
    };

    await appDb.withScopedTransaction(scopeA, async (tx) => {
      const mRepo = new MembershipRepository(tx);
      const sRepo = new SessionRepository(tx);
      await mRepo.create(workspaceAId, userAId, 'owner');
      await sRepo.create(userAId, workspaceAId, tokenA);
    });

    const wsB = await wsRepo.create('Purge Org Beta');
    workspaceBId = wsB.id;
    const userB = await userRepo.create('bob.purge@beta.com', 'hashB', 'Bob Purge');
    userBId = userB.id;
    tokenB = crypto.randomBytes(32).toString('hex');
    tokenHashB = hashSessionToken(tokenB);

    scopeB = {
      workspaceId: workspaceBId,
      userId: userBId,
      role: 'owner',
      sessionTokenHash: tokenHashB
    };

    await appDb.withScopedTransaction(scopeB, async (tx) => {
      const mRepo = new MembershipRepository(tx);
      const sRepo = new SessionRepository(tx);
      await mRepo.create(workspaceBId, userBId, 'owner');
      await sRepo.create(userBId, workspaceBId, tokenB);
    });
  });

  afterAll(async () => {
    if (unprivilegedClient) await unprivilegedClient.end();
    if (workerPool) await workerPool.close();
    if (appDb) await appDb.close();
    if (adminDb) await adminDb.close();
  });

  describe('PostgreSQL Migration 0009 Catalog & Security Assertions', () => {
    it('proves user_purge_operations and worker_dispatch_outbox have RLS enabled and forced', async () => {
      if (!isLive || !adminDb) return;

      const tables = ['user_purge_operations', 'worker_dispatch_outbox'];
      for (const table of tables) {
        const res = await adminDb.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
          SELECT c.relrowsecurity, c.relforcerowsecurity
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
          WHERE n.nspname = 'public' AND c.relname = $1;
        `, [table]);

        expect(res.rows.length, `Table ${table} must exist in public schema`).toBe(1);
        expect(res.rows[0]?.relrowsecurity, `Table ${table} must have relrowsecurity enabled`).toBe(true);
        expect(res.rows[0]?.relforcerowsecurity, `Table ${table} must have relforcerowsecurity enabled`).toBe(true);
      }
    });

    it('proves migration 0009 worker procedures are executable by thaara_worker and denied to thaara_app (42501)', async () => {
      if (!isLive || !adminDb || !appDb) return;

      for (const fn of purgeWorkerFunctions) {
        const { rows } = await adminDb.query<{
          proname: string;
          prosecdef: boolean;
          proconfig: string[] | null;
          app_grant: boolean;
          worker_grant: boolean;
        }>(
          `SELECT
             p.proname,
             p.prosecdef,
             p.proconfig,
             has_function_privilege('thaara_app', p.oid, 'EXECUTE') AS app_grant,
             has_function_privilege('thaara_worker', p.oid, 'EXECUTE') AS worker_grant
           FROM pg_proc p
           JOIN pg_namespace n ON p.pronamespace = n.oid
           WHERE n.nspname = 'public' AND p.proname = $1;`,
          [fn]
        );

        expect(rows.length).toBeGreaterThan(0);
        const row = rows[0];
        expect(row.prosecdef, `${fn} must be SECURITY DEFINER`).toBe(true);
        expect(row.proconfig).toBeDefined();
        expect(row.proconfig).toContain('search_path=pg_catalog, public, pg_temp');
        expect(row.worker_grant, `${fn} must be granted to thaara_worker`).toBe(true);
        expect(row.app_grant, `${fn} must NOT be granted to thaara_app`).toBe(false);
      }

      // App role direct execution attempt on worker procedure must fail with 42501
      await expect(
        appDb.query(`SELECT public.get_purge_operation($1);`, [crypto.randomUUID()])
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('proves migration 0011 recovery procedures have exact owner postgres, pinned search_path, single signature count, and exact grants', async () => {
      if (!isLive || !adminDb) return;

      const recoveryProcs = [
        'recover_stranded_purge_operations',
        'claim_unrecovered_purge_continuations'
      ];

      for (const fn of recoveryProcs) {
        const { rows } = await adminDb.query<{
          proname: string;
          prosecdef: boolean;
          proowner_name: string;
          proconfig: string[] | null;
          app_grant: boolean;
          worker_grant: boolean;
          public_grant: boolean;
          signature_count: string;
        }>(
          `SELECT
             p.proname,
             p.prosecdef,
             r.rolname AS proowner_name,
             p.proconfig,
             has_function_privilege('thaara_app', p.oid, 'EXECUTE') AS app_grant,
             has_function_privilege('thaara_worker', p.oid, 'EXECUTE') AS worker_grant,
             has_function_privilege('public', p.oid, 'EXECUTE') AS public_grant,
             (SELECT count(*)::text FROM pg_proc p2 JOIN pg_namespace n2 ON p2.pronamespace = n2.oid WHERE n2.nspname = 'public' AND p2.proname = p.proname) AS signature_count
           FROM pg_proc p
           JOIN pg_namespace n ON p.pronamespace = n.oid
           JOIN pg_roles r ON p.proowner = r.oid
           WHERE n.nspname = 'public' AND p.proname = $1;`,
          [fn]
        );

        expect(rows.length, `Expected exactly 1 signature for ${fn}`).toBe(1);
        const row = rows[0];
        expect(row.signature_count).toBe('1');
        expect(row.prosecdef, `${fn} must be SECURITY DEFINER`).toBe(true);
        expect(row.proowner_name, `${fn} owner must be postgres`).toBe('postgres');
        expect(row.proconfig).toContain('search_path=pg_catalog, public, pg_temp');
        expect(row.worker_grant, `${fn} must be granted to thaara_worker`).toBe(true);
        expect(row.app_grant, `${fn} must NOT be granted to thaara_app`).toBe(false);
        expect(row.public_grant, `${fn} must NOT be granted to public`).toBe(false);
      }
    });

    it('proves unprivileged roles are completely denied execution on all worker procedures (42501)', async () => {
      if (!isLive || !adminDb || !unprivilegedClient) return;

      for (const fn of purgeWorkerFunctions) {
        const { rows } = await adminDb.query<{ unprivileged_grant: boolean }>(
          `SELECT has_function_privilege('unprivileged_tester_t003_purge', p.oid, 'EXECUTE') AS unprivileged_grant
           FROM pg_proc p
           JOIN pg_namespace n ON p.pronamespace = n.oid
           WHERE n.nspname = 'public' AND p.proname = $1;`,
          [fn]
        );

        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0]?.unprivileged_grant, `${fn} must NOT be granted to unprivileged role`).toBe(false);
      }

      // Unprivileged direct execution attempt on worker procedure must fail with 42501
      await expect(
        unprivilegedClient.query(`SELECT public.get_purge_operation($1);`, [crypto.randomUUID()])
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  describe('Strict Expiry Fencing Assertions (Outbox & Purge Zombies)', () => {
    it('proves expired claim token returns FALSE on mark_outbox_dispatched and mark_outbox_failed', async () => {
      if (!isLive || !workerPool || !appDb) return;

      // 1. Initiate purge via thaara_app to generate outbox row
      const { rows: initRows } = await appDb.query<{ operation_id: string }>(
        `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
        [tokenHashA]
      );
      const opId = initRows[0].operation_id;

      // 2. Claim outbox row under thaara_worker
      const outboxRepo = new WorkerOutboxRepository(workerPool);
      const claimed = await outboxRepo.claimDispatches('worker-zombie-test', 50, 60);
      expect(claimed.length).toBeGreaterThan(0);
      const targetRecord = claimed.find((r) => (r.payload as any)?.operation_id === opId)!;
      expect(targetRecord).toBeDefined();

      const claimToken = targetRecord.claim_token;

      // 3. Fast-forward outbox lease expiry into past as admin
      await adminDb!.query(
        `UPDATE public.worker_dispatch_outbox SET lease_expires_at = clock_timestamp() - interval '5 seconds' WHERE id = $1;`,
        [targetRecord.id]
      );

      // 4. Zombie attempt to mark dispatched with expired claim token must return FALSE
      const dispatchedRes = await outboxRepo.markDispatched(targetRecord.id, claimToken);
      expect(dispatchedRes).toBe(false);

      // 5. Zombie attempt to mark failed with expired claim token must return FALSE
      const failedRes = await outboxRepo.markFailed(targetRecord.id, claimToken, 'OUTBOX_QUEUE_UNAVAILABLE', 'TRANSIENT_INFRASTRUCTURE');
      expect(failedRes).toBe(false);

      // Record remains claimed or pending, unaffected by zombie
      const { rows: currRows } = await adminDb!.query<{ status: string }>(
        `SELECT status FROM public.worker_dispatch_outbox WHERE id = $1;`,
        [targetRecord.id]
      );
      expect(currRows[0].status).toBe('claimed');
    });

    it('proves expired lease token throws fence violation on purge mutations', async () => {
      if (!isLive || !workerPool || !appDb) return;

      // 1. Initiate purge
      const { rows: initRows } = await appDb.query<{ operation_id: string }>(
        `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
        [tokenHashA]
      );
      const opId = initRows[0].operation_id;

      // 2. Acquire purge lease under thaara_worker
      const purgeRepo = new WorkerPurgeRepository(workerPool);
      const lease = await purgeRepo.acquireLease(opId, 'worker-fence-test', 1);
      expect(lease).toBeTruthy();
      const leaseToken = lease!.lease_token;

      // 3. Fast-forward lease expiry into the past
      await adminDb!.query(
        `UPDATE public.user_purge_operations SET lease_expires_at = clock_timestamp() - interval '5 seconds' WHERE id = $1;`,
        [opId]
      );

      // 4. Zombie attempts to execute batch or complete purge must throw fence violation
      await expect(
        purgeRepo.processMessagesBatch(opId, leaseToken, 'worker-fence-test', 10)
      ).rejects.toThrow(/Purge fence violation/);

      await expect(
        purgeRepo.scheduleContinuation(opId, leaseToken, 'worker-fence-test')
      ).rejects.toThrow(/Purge fence violation/);

      await expect(
        purgeRepo.completePurge(opId, leaseToken, 'worker-fence-test')
      ).rejects.toThrow(/Purge fence violation/);

      await expect(
        purgeRepo.failPurge(opId, leaseToken, 'worker-fence-test', 'PURGE_CHECKPOINT_FAILED', 'DATABASE_ERROR')
      ).rejects.toThrow(/Purge fence violation/);
    });
  });

  describe('Durable Continuation, Completion Barrier & Attempt Exhaustion Assertions', () => {
    it('enforces completion barrier when continuation is pending', async () => {
      if (!isLive || !workerPool || !appDb) return;

      // Initiate purge
      const { rows: initRows } = await appDb.query<{ operation_id: string }>(
        `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
        [tokenHashA]
      );
      const opId = initRows[0].operation_id;

      const purgeRepo = new WorkerPurgeRepository(workerPool);
      const lease = await purgeRepo.acquireLease(opId, 'barrier-worker', 300);
      expect(lease).toBeTruthy();

      // Schedule continuation
      const cont = await purgeRepo.scheduleContinuation(opId, lease!.lease_token, 'barrier-worker');
      expect(cont).toBeTruthy();
      expect(cont!.continuation_sequence).toBe(1);

      // Attempt to complete purge while continuation_pending is TRUE must fail with completion barrier
      await expect(
        purgeRepo.completePurge(opId, lease!.lease_token, 'barrier-worker')
      ).rejects.toThrow(/continuation is currently pending/);
    });

    it('enforces terminal failure and emits single privacy.purge_failed audit event when continuation attempts hit max_attempts', async () => {
      if (!isLive || !workerPool || !appDb) return;

      // Initiate purge
      const { rows: initRows } = await appDb.query<{ operation_id: string }>(
        `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
        [tokenHashA]
      );
      const opId = initRows[0].operation_id;

      const purgeRepo = new WorkerPurgeRepository(workerPool);
      const lease = await purgeRepo.acquireLease(opId, 'exhaustion-worker', 300);

      // Schedule continuation
      const cont = await purgeRepo.scheduleContinuation(opId, lease!.lease_token, 'exhaustion-worker');
      expect(cont).toBeTruthy();

      // Set attempts to max_attempts in database
      await adminDb!.query(
        `UPDATE public.user_purge_operations SET attempts = max_attempts WHERE id = $1;`,
        [opId]
      );

      // Claim continuation must atomically fail operation
      const claimRes = await purgeRepo.claimContinuation(opId, cont!.continuation_token, 'exhaustion-worker', 300);
      expect(claimRes?.status).toBe('failed');
      expect(claimRes?.lease_token).toBeNull();

      // Verify operation status
      const op = await purgeRepo.getPurgeOperation(opId);
      expect(op?.status).toBe('failed');
      expect(op?.continuation_pending).toBe(false);

      // Verify exactly one privacy.purge_failed audit event was recorded
      const { rows: auditRows } = await adminDb!.query<{ action: string; payload: any }>(
        `SELECT action, payload FROM public.audit_events WHERE action = 'privacy.purge_failed' AND target_id = $1;`,
        [opId]
      );
      expect(auditRows.length).toBe(1);
      expect(auditRows[0].payload.error_code).toBe('PURGE_MAX_ATTEMPTS_EXCEEDED');
      expect(auditRows[0].payload.error_category).toBe('TRANSIENT_INFRASTRUCTURE');
    });

    it('reclaims expired running continuations via claim_unrecovered_purge_continuations', async () => {
      if (!isLive || !workerPool || !appDb) return;

      // Initiate purge
      const { rows: initRows } = await appDb.query<{ operation_id: string }>(
        `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
        [tokenHashA]
      );
      const opId = initRows[0].operation_id;

      const purgeRepo = new WorkerPurgeRepository(workerPool);
      const lease = await purgeRepo.acquireLease(opId, 'worker-pre-crash', 300);

      // Schedule continuation
      const cont = await purgeRepo.scheduleContinuation(opId, lease!.lease_token, 'worker-pre-crash');
      expect(cont).toBeTruthy();

      // Fast-forward lease expiry into past to simulate worker crash
      await adminDb!.query(
        `UPDATE public.user_purge_operations SET lease_expires_at = clock_timestamp() - interval '10 seconds' WHERE id = $1;`,
        [opId]
      );

      // Recovery sweeper claims unrecovered continuations
      const unrecovered = await purgeRepo.claimUnrecoveredContinuations('worker-recovery-sweeper', 10, 300);
      const found = unrecovered.find((r) => r.operation_id === opId);
      expect(found).toBeDefined();
      expect(found!.continuation_sequence).toBe(1);
      expect(found!.continuation_token).toBe(cont!.continuation_token);
    });

    it('recovers expired running operations without continuation_pending via recover_stranded_purge_operations', async () => {
      if (!isLive || !workerPool || !appDb) return;

      // Initiate purge
      const { rows: initRows } = await appDb.query<{ operation_id: string }>(
        `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
        [tokenHashA]
      );
      const opId = initRows[0].operation_id;

      const purgeRepo = new WorkerPurgeRepository(workerPool);
      await purgeRepo.acquireLease(opId, 'worker-claimed-and-crashed', 300);

      // Verify continuation_pending is false
      const opBefore = await purgeRepo.getPurgeOperation(opId);
      expect(opBefore?.status).toBe('running');
      expect(opBefore?.continuation_pending).toBe(false);

      // Expire lease into past
      await adminDb!.query(
        `UPDATE public.user_purge_operations SET lease_expires_at = clock_timestamp() - interval '10 seconds' WHERE id = $1;`,
        [opId]
      );

      // Recovery procedure must recover it
      const recovered = await purgeRepo.recoverStrandedPurgeOperations('sweeper-running-recovery', 10, 300);
      const found = recovered.find((r) => r.operation_id === opId);
      expect(found).toBeDefined();
      expect(found!.continuation_token).toBeTruthy();
      expect(found!.continuation_sequence).toBe(1);

      // DB state must be updated to running with continuation_pending = true
      const opAfter = await purgeRepo.getPurgeOperation(opId);
      expect(opAfter?.status).toBe('running');
      expect(opAfter?.continuation_pending).toBe(true);
      expect(opAfter?.continuation_token).toBe(found!.continuation_token);
    });

    it('recovers retryable pending operations without active durable dispatch', async () => {
      if (!isLive || !workerPool || !appDb) return;

      // Initiate purge
      const { rows: initRows } = await appDb.query<{ operation_id: string }>(
        `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
        [tokenHashA]
      );
      const opId = initRows[0].operation_id;

      // Mark outbox row as stale dispatched so operation is pending with no recent active durable dispatch
      await adminDb!.query(
        `UPDATE public.worker_dispatch_outbox
         SET status = 'dispatched',
             dispatched_at = clock_timestamp() - interval '400 seconds',
             updated_at = clock_timestamp() - interval '400 seconds'
         WHERE workspace_id = $1 AND payload->>'operation_id' = $2;`,
        [workspaceAId, opId]
      );

      const purgeRepo = new WorkerPurgeRepository(workerPool);
      const recovered = await purgeRepo.recoverStrandedPurgeOperations('sweeper-pending-recovery', 10, 300);
      const found = recovered.find((r) => r.operation_id === opId);
      expect(found).toBeDefined();
      expect(found!.continuation_token).toBeTruthy();

      const opAfter = await purgeRepo.getPurgeOperation(opId);
      expect(opAfter?.status).toBe('running');
      expect(opAfter?.continuation_pending).toBe(true);
    });

    it('proves a freshly dispatched outbox row within grace period does not trigger premature recovery', async () => {
      if (!isLive || !workerPool || !appDb) return;

      // Initiate purge
      const { rows: initRows } = await appDb.query<{ operation_id: string }>(
        `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
        [tokenHashA]
      );
      const opId = initRows[0].operation_id;

      // Mark outbox row as freshly dispatched (within grace period of 300s)
      await adminDb!.query(
        `UPDATE public.worker_dispatch_outbox
         SET status = 'dispatched',
             dispatched_at = clock_timestamp() - interval '10 seconds',
             updated_at = clock_timestamp() - interval '10 seconds'
         WHERE workspace_id = $1 AND payload->>'operation_id' = $2;`,
        [workspaceAId, opId]
      );

      const purgeRepo = new WorkerPurgeRepository(workerPool);
      // Run sweeper with default 300s grace period
      const recovered = await purgeRepo.recoverStrandedPurgeOperations('sweeper-fresh-grace-test', 10, 300, 300);
      const found = recovered.find((r) => r.operation_id === opId);
      expect(found).toBeUndefined(); // Freshly dispatched must NOT be recovered prematurely

      // Operation must still be pending with continuation_pending = false
      const op = await purgeRepo.getPurgeOperation(opId);
      expect(op?.status).toBe('pending');
      expect(op?.continuation_pending).toBe(false);
    });

    it('proves a stale dispatched row is recovered only after the grace period', async () => {
      if (!isLive || !workerPool || !appDb) return;

      // Initiate purge
      const { rows: initRows } = await appDb.query<{ operation_id: string }>(
        `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
        [tokenHashA]
      );
      const opId = initRows[0].operation_id;

      // Mark outbox row as stale dispatched (older than grace period: 301 seconds)
      await adminDb!.query(
        `UPDATE public.worker_dispatch_outbox
         SET status = 'dispatched',
             dispatched_at = clock_timestamp() - interval '301 seconds',
             updated_at = clock_timestamp() - interval '301 seconds'
         WHERE workspace_id = $1 AND payload->>'operation_id' = $2;`,
        [workspaceAId, opId]
      );

      const purgeRepo = new WorkerPurgeRepository(workerPool);
      const recovered = await purgeRepo.recoverStrandedPurgeOperations('sweeper-stale-grace-test', 10, 300, 300);
      const found = recovered.find((r) => r.operation_id === opId);
      expect(found).toBeDefined();
      expect(found!.continuation_token).toBeTruthy();

      // Operation is now transitioned to running with continuation_pending = true
      const op = await purgeRepo.getPurgeOperation(opId);
      expect(op?.status).toBe('running');
      expect(op?.continuation_pending).toBe(true);
      expect(op?.continuation_token).toBe(found!.continuation_token);
    });

    it('proves malformed outbox JSON cannot crash the recovery sweep', async () => {
      if (!isLive || !workerPool || !appDb) return;

      // Insert an outbox row with corrupt / non-UUID payload in workspace A
      await adminDb!.query(
        `INSERT INTO public.worker_dispatch_outbox (workspace_id, topic, dedup_key, payload, status, created_at, updated_at)
         VALUES ($1, 'privacy.purge_operation', $2, $3::jsonb, 'dispatched', clock_timestamp() - interval '400 seconds', clock_timestamp() - interval '400 seconds');`,
        [
          workspaceAId,
          `corrupt-dedup-${crypto.randomUUID()}`,
          JSON.stringify({ operation_id: 'not-a-valid-uuid-!@#$%', corrupt_field: 9999 })
        ]
      );

      // Also insert another outbox row with arbitrary nested JSON
      await adminDb!.query(
        `INSERT INTO public.worker_dispatch_outbox (workspace_id, topic, dedup_key, payload, status, created_at, updated_at)
         VALUES ($1, 'privacy.purge_operation', $2, $3::jsonb, 'dispatched', clock_timestamp() - interval '400 seconds', clock_timestamp() - interval '400 seconds');`,
        [
          workspaceAId,
          `corrupt-dedup-${crypto.randomUUID()}`,
          JSON.stringify({ nested: { structure: true } })
        ]
      );

      // Now initiate a legitimate purge
      const { rows: initRows } = await appDb.query<{ operation_id: string }>(
        `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
        [tokenHashA]
      );
      const legitOpId = initRows[0].operation_id;

      // Mark the legitimate outbox row stale dispatched
      await adminDb!.query(
        `UPDATE public.worker_dispatch_outbox
         SET status = 'dispatched',
             dispatched_at = clock_timestamp() - interval '400 seconds',
             updated_at = clock_timestamp() - interval '400 seconds'
         WHERE workspace_id = $1 AND payload->>'operation_id' = $2;`,
        [workspaceAId, legitOpId]
      );

      // The sweeper MUST NOT crash due to UUID casting errors on corrupt outbox rows
      const purgeRepo = new WorkerPurgeRepository(workerPool);
      const recovered = await purgeRepo.recoverStrandedPurgeOperations('sweeper-corrupt-payload-test', 10, 300, 300);
      const found = recovered.find((r) => r.operation_id === legitOpId);
      expect(found).toBeDefined();
    });

    it('proves concurrent recovery sweepers produce mutually exclusive recovery sets with SKIP LOCKED', async () => {
      if (!isLive || !workerPool || !appDb) return;

      // Initiate two purges
      const { rows: op1Rows } = await appDb.query<{ operation_id: string }>(
        `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
        [tokenHashA]
      );
      const { rows: op2Rows } = await appDb.query<{ operation_id: string }>(
        `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
        [tokenHashA]
      );
      const op1Id = op1Rows[0].operation_id;
      const op2Id = op2Rows[0].operation_id;

      // Mark both outbox rows stale dispatched so both are pending without active dispatch
      await adminDb!.query(
        `UPDATE public.worker_dispatch_outbox
         SET status = 'dispatched',
             dispatched_at = clock_timestamp() - interval '400 seconds',
             updated_at = clock_timestamp() - interval '400 seconds'
         WHERE payload->>'operation_id' IN ($1, $2);`,
        [op1Id, op2Id]
      );

      const purgeRepo = new WorkerPurgeRepository(workerPool);

      // Concurrently run recovery sweepers with batch size 1
      const [res1, res2] = await Promise.all([
        purgeRepo.recoverStrandedPurgeOperations('sweeper-concurrent-1', 1, 300, 300),
        purgeRepo.recoverStrandedPurgeOperations('sweeper-concurrent-2', 1, 300, 300)
      ]);

      const allRecoveredIds = [...res1, ...res2].map((r) => r.operation_id);
      const targetRecovered = allRecoveredIds.filter((id) => id === op1Id || id === op2Id);

      // Exactly 2 operations recovered, no duplicate claims
      expect(targetRecovered.length).toBe(2);
      expect(new Set(targetRecovered).size).toBe(2);
    });

    it('atomically fails operation and emits exactly one audit event on max_attempts in recovery sweeper', async () => {
      if (!isLive || !workerPool || !appDb) return;

      // Initiate purge
      const { rows: initRows } = await appDb.query<{ operation_id: string }>(
        `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
        [tokenHashA]
      );
      const opId = initRows[0].operation_id;

      // Acquire lease and set attempts = max_attempts with expired lease
      await adminDb!.query(
        `UPDATE public.user_purge_operations
         SET status = 'running',
             attempts = max_attempts,
             lease_expires_at = clock_timestamp() - interval '10 seconds'
         WHERE id = $1;`,
        [opId]
      );

      const purgeRepo = new WorkerPurgeRepository(workerPool);
      const recovered = await purgeRepo.recoverStrandedPurgeOperations('sweeper-exhaustion', 10, 300);
      const found = recovered.find((r) => r.operation_id === opId);
      expect(found).toBeUndefined(); // Must NOT be returned for work

      // Must be marked failed
      const op = await purgeRepo.getPurgeOperation(opId);
      expect(op?.status).toBe('failed');
      expect(op?.error_code).toBe('PURGE_MAX_ATTEMPTS_EXCEEDED');

      // Exactly one audit event
      const { rows: auditRows } = await adminDb!.query<{ action: string; payload: any }>(
        `SELECT action, payload FROM public.audit_events WHERE action = 'privacy.purge_failed' AND target_id = $1;`,
        [opId]
      );
      expect(auditRows.length).toBe(1);
      expect(auditRows[0].payload.error_code).toBe('PURGE_MAX_ATTEMPTS_EXCEEDED');
    });
  });

  describe('Sole-Owner Protection & Account Closure Assertions', () => {
    it('blocks account closure when user is sole owner of workspace', async () => {
      if (!isLive || !workerPool || !appDb) return;

      // Initiate account closure
      const { rows: initRows } = await appDb.query<{ operation_id: string }>(
        `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'account_closure');`,
        [tokenHashA]
      );
      const opId = initRows[0].operation_id;

      const purgeRepo = new WorkerPurgeRepository(workerPool);
      const lease = await purgeRepo.acquireLease(opId, 'sole-owner-worker', 300);

      // Mark prerequisite checkpoints complete
      await adminDb!.query(
        `UPDATE public.user_purge_operations
         SET checkpoint_messages_completed = true,
             checkpoint_conversations_completed = true,
             checkpoint_memories_completed = true
         WHERE id = $1;`,
        [opId]
      );

      // Complete purge must fail because user is sole owner
      await expect(
        purgeRepo.completePurge(opId, lease!.lease_token, 'sole-owner-worker')
      ).rejects.toThrow(/user is the sole owner of workspace/);
    });

    it('completes account closure and deletes membership when workspace has multiple owners', async () => {
      if (!isLive || !workerPool || !appDb) return;

      // Add second owner to Workspace B
      const userRepo = new UserRepository(appDb);
      const secondOwner = await userRepo.create('bob.second@beta.com', 'hash2', 'Bob Second');
      await adminDb!.query(
        `INSERT INTO public.memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner');`,
        [workspaceBId, secondOwner.id]
      );

      // Initiate account closure for userB
      const { rows: initRows } = await appDb.query<{ operation_id: string }>(
        `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'account_closure');`,
        [tokenHashB]
      );
      const opId = initRows[0].operation_id;

      const purgeRepo = new WorkerPurgeRepository(workerPool);
      const lease = await purgeRepo.acquireLease(opId, 'multi-owner-worker', 300);

      // Mark prerequisite checkpoints complete
      await adminDb!.query(
        `UPDATE public.user_purge_operations
         SET checkpoint_messages_completed = true,
             checkpoint_conversations_completed = true,
             checkpoint_memories_completed = true
         WHERE id = $1;`,
        [opId]
      );

      // Complete purge must succeed
      const completed = await purgeRepo.completePurge(opId, lease!.lease_token, 'multi-owner-worker');
      expect(completed).toBe(true);

      // Membership for userB must be removed
      const { rows: memRows } = await adminDb!.query(
        `SELECT * FROM public.memberships WHERE workspace_id = $1 AND user_id = $2;`,
        [workspaceBId, userBId]
      );
      expect(memRows.length).toBe(0);

      // Second owner remains
      const { rows: ownerRows } = await adminDb!.query(
        `SELECT * FROM public.memberships WHERE workspace_id = $1 AND user_id = $2;`,
        [workspaceBId, secondOwner.id]
      );
      expect(ownerRows.length).toBe(1);
    });
  });

  describe('Multi-Tenant Boundary & Data Isolation Assertions', () => {
    it('proves Tenant A cannot read Tenant B purge operations or outbox rows under RLS', async () => {
      if (!isLive || !appDb) return;

      // As Tenant A, query user_purge_operations and worker_dispatch_outbox
      await appDb.withScopedTransaction(scopeA, async (tx) => {
        const { rows: opRows } = await tx.query(
          `SELECT * FROM public.user_purge_operations WHERE workspace_id = $1;`,
          [workspaceBId]
        );
        expect(opRows.length).toBe(0);

        const { rows: outboxRows } = await tx.query(
          `SELECT * FROM public.worker_dispatch_outbox WHERE workspace_id = $1;`,
          [workspaceBId]
        );
        expect(outboxRows.length).toBe(0);
      });
    });
  });
});
