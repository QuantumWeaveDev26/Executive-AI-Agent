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
import { ConversationRepository } from '../src/repositories/conversations.js';
import { AssistantStreamRepository } from '../src/repositories/assistant-streams.js';
import { bootstrapRuntimeIdentities } from '../scripts/bootstrap-runtime-identities.js';

const { Client } = pg;

const isolated = getIsolatedRuntimeConfig();

describe('Task 003 Phase 3: Assistant Stream Lifecycle, Reciprocal Constraints & Worker Recovery (Real PostgreSQL)', () => {
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

  const streamTables = [
    'assistant_stream_executions',
    'assistant_stream_events'
  ] as const;

  const appStreamFunctions = [
    'initiate_assistant_stream',
    'append_assistant_stream_event',
    'finalize_assistant_stream',
    'cancel_assistant_stream',
    'get_assistant_stream_events_after'
  ] as const;

  const workerStreamFunctions = [
    'recover_stale_assistant_stream',
    'reconcile_stale_assistant_streams'
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
        `[Task 003 Streaming Runtime] PostgreSQL is not reachable at 127.0.0.1:15432/thaara_step74_test. ` +
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
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'unprivileged_tester_t003_stream') THEN
          CREATE ROLE unprivileged_tester_t003_stream WITH LOGIN PASSWORD '${unprivilegedTesterPassword}';
        ELSE
          ALTER ROLE unprivileged_tester_t003_stream WITH PASSWORD '${unprivilegedTesterPassword}';
        END IF;
      END $$;
      GRANT CONNECT ON DATABASE ${dbName} TO unprivileged_tester_t003_stream;
      GRANT USAGE ON SCHEMA public TO unprivileged_tester_t003_stream;
    `);

    unprivilegedClient = new Client({
      connectionString: isolatedRoleUrl(isolated, 'unprivileged_tester_t003_stream', unprivilegedTesterPassword)
    });
    await unprivilegedClient.connect();

    // 6. Seed test tenants and users
    const wsRepo = new WorkspaceRepository(appDb);
    const userRepo = new UserRepository(appDb);

    const wsA = await wsRepo.create('Stream Org Alpha');
    workspaceAId = wsA.id;
    const userA = await userRepo.create('alice.exec@alpha.com', 'hashA', 'Alice Exec');
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

    const wsB = await wsRepo.create('Stream Org Beta');
    workspaceBId = wsB.id;
    const userB = await userRepo.create('bob.exec@beta.com', 'hashB', 'Bob Exec');
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

  describe('PostgreSQL Migration 0008 Catalog & Security Assertions', () => {
    it('proves assistant stream tables have RLS enabled and forced', async () => {
      if (!isLive || !adminDb) return;

      for (const table of streamTables) {
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

    it('proves direct-DML is denied on assistant_stream_executions and assistant_stream_events for thaara_app', async () => {
      if (!isLive || !appDb) return;

      // Direct INSERT as thaara_app must fail with 42501
      await expect(
        appDb.query(
          `INSERT INTO public.assistant_stream_executions (workspace_id, conversation_id, user_id, idempotency_key, user_message_id, status)
           VALUES ($1, gen_random_uuid(), $2, 'direct-dml-key', gen_random_uuid(), 'queued');`,
          [workspaceAId, userAId]
        )
      ).rejects.toMatchObject({ code: '42501' });

      await expect(
        appDb.query(
          `INSERT INTO public.assistant_stream_events (workspace_id, conversation_id, user_id, stream_id, sequence_number, event_type, payload)
           VALUES ($1, gen_random_uuid(), $2, gen_random_uuid(), 0, 'context_ready', '{}');`,
          [workspaceAId, userAId]
        )
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('proves user-facing stream procedures have prosecdef, search_path, and thaara_app grants only', async () => {
      if (!isLive || !adminDb) return;

      for (const fnName of appStreamFunctions) {
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
          [fnName]
        );

        expect(rows.length).toBeGreaterThan(0);
        const row = rows[0];
        expect(row.prosecdef, `${fnName} must be SECURITY DEFINER`).toBe(true);
        expect(row.proconfig).toBeDefined();
        expect(row.proconfig).toContain('search_path=pg_catalog, public, pg_temp');
        expect(row.app_grant, `${fnName} must be granted to thaara_app`).toBe(true);
        expect(row.worker_grant, `${fnName} must NOT be granted to thaara_worker`).toBe(false);
      }
    });

    it('proves worker recovery procedures have prosecdef, search_path, and thaara_worker grants only', async () => {
      if (!isLive || !adminDb) return;

      for (const fnName of workerStreamFunctions) {
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
          [fnName]
        );

        expect(rows.length).toBeGreaterThan(0);
        const row = rows[0];
        expect(row.prosecdef, `${fnName} must be SECURITY DEFINER`).toBe(true);
        expect(row.proconfig).toBeDefined();
        expect(row.proconfig).toContain('search_path=pg_catalog, public, pg_temp');
        expect(row.worker_grant, `${fnName} must be granted to thaara_worker`).toBe(true);
        expect(row.app_grant, `${fnName} must NOT be granted to thaara_app`).toBe(false);
      }
    });

    it('proves all role ACL denials: direct table DML and unauthorized procedure execution reject thaara_app, thaara_worker, and unprivileged role with 42501', async () => {
      if (!isLive || !appDb || !workerPool || !unprivilegedClient) return;

      // 1. Direct DML denial on assistant_stream_executions
      // thaara_app: UPDATE and DELETE denied (42501)
      await expect(
        appDb.query(`UPDATE public.assistant_stream_executions SET status = 'failed' WHERE id = gen_random_uuid();`)
      ).rejects.toMatchObject({ code: '42501' });

      await expect(
        appDb.query(`DELETE FROM public.assistant_stream_executions WHERE id = gen_random_uuid();`)
      ).rejects.toMatchObject({ code: '42501' });

      // thaara_worker: direct SELECT, INSERT, UPDATE, DELETE denied (42501)
      await workerPool.withRoleClient(async (workerClient) => {
        await expect(
          workerClient.query(`SELECT * FROM public.assistant_stream_executions LIMIT 1;`)
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          workerClient.query(`SELECT * FROM public.assistant_stream_events LIMIT 1;`)
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          workerClient.query(
            `INSERT INTO public.assistant_stream_executions (workspace_id, conversation_id, user_id, idempotency_key, user_message_id, status)
             VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'k', gen_random_uuid(), 'queued');`
          )
        ).rejects.toMatchObject({ code: '42501' });
      });

      // unprivileged_tester: direct SELECT, INSERT denied (42501)
      await expect(
        unprivilegedClient.query(`SELECT * FROM public.assistant_stream_executions LIMIT 1;`)
      ).rejects.toMatchObject({ code: '42501' });

      await expect(
        unprivilegedClient.query(`SELECT * FROM public.assistant_stream_events LIMIT 1;`)
      ).rejects.toMatchObject({ code: '42501' });

      // 2. User-facing procedures denied to thaara_worker and unprivileged_tester (42501)
      await workerPool.withRoleClient(async (workerClient) => {
        await expect(
          workerClient.query(`SELECT public.initiate_assistant_stream('t', gen_random_uuid(), 'k', 'c');`)
        ).rejects.toMatchObject({ code: '42501' });

        await expect(
          workerClient.query(`SELECT public.append_assistant_stream_event('t', gen_random_uuid(), 1, 'stream_status', '{}'::jsonb);`)
        ).rejects.toMatchObject({ code: '42501' });

        await expect(
          workerClient.query(`SELECT public.finalize_assistant_stream('t', gen_random_uuid(), 1, 100);`)
        ).rejects.toMatchObject({ code: '42501' });

        await expect(
          workerClient.query(`SELECT public.cancel_assistant_stream('t', gen_random_uuid(), 1, 'reason');`)
        ).rejects.toMatchObject({ code: '42501' });

        await expect(
          workerClient.query(`SELECT public.get_assistant_stream_events_after('t', gen_random_uuid(), -1);`)
        ).rejects.toMatchObject({ code: '42501' });
      });

      await expect(
        unprivilegedClient.query(`SELECT public.initiate_assistant_stream('t', gen_random_uuid(), 'k', 'c');`)
      ).rejects.toMatchObject({ code: '42501' });

      await expect(
        unprivilegedClient.query(`SELECT public.recover_stale_assistant_stream(gen_random_uuid());`)
      ).rejects.toMatchObject({ code: '42501' });

      await expect(
        unprivilegedClient.query(`SELECT public.reconcile_stale_assistant_streams(10);`)
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('proves direct trigger-function execution of enforce_assistant_stream_bidirectional_integrity() is denied to all roles (42501)', async () => {
      if (!isLive || !adminDb || !appDb || !workerPool || !unprivilegedClient) return;

      // 1. Catalog check: no role has EXECUTE privilege on trigger function
      const { rows } = await adminDb.query<{
        app_grant: boolean;
        worker_grant: boolean;
        public_grant: boolean;
      }>(`
        SELECT
          has_function_privilege('thaara_app', 'public.enforce_assistant_stream_bidirectional_integrity()', 'EXECUTE') AS app_grant,
          has_function_privilege('thaara_worker', 'public.enforce_assistant_stream_bidirectional_integrity()', 'EXECUTE') AS worker_grant,
          has_function_privilege('public', 'public.enforce_assistant_stream_bidirectional_integrity()', 'EXECUTE') AS public_grant;
      `);
      expect(rows[0].app_grant).toBe(false);
      expect(rows[0].worker_grant).toBe(false);
      expect(rows[0].public_grant).toBe(false);

      // 2. Direct execution attempts reject with 42501
      await expect(
        appDb.query(`SELECT public.enforce_assistant_stream_bidirectional_integrity();`)
      ).rejects.toMatchObject({ code: '42501' });

      await workerPool.withRoleClient(async (workerClient) => {
        await expect(
          workerClient.query(`SELECT public.enforce_assistant_stream_bidirectional_integrity();`)
        ).rejects.toMatchObject({ code: '42501' });
      });

      await expect(
        unprivilegedClient.query(`SELECT public.enforce_assistant_stream_bidirectional_integrity();`)
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  describe('Governed Assistant Stream Full Lifecycle & Deferred Invariants', () => {
    let streamRepo: AssistantStreamRepository;
    let convRepo: ConversationRepository;

    beforeAll(() => {
      if (appDb) {
        streamRepo = new AssistantStreamRepository(appDb);
        convRepo = new ConversationRepository(appDb);
      }
    });

    it('executes full stream lifecycle: initiate -> append -> finalize with reciprocal message linkage', async () => {
      if (!isLive || !streamRepo || !convRepo) return;

      // 1. Create conversation
      const conv = await convRepo.create(scopeA, { title: 'Q3 Board Review' });

      // 2. Initiate stream
      const initiated = await streamRepo.initiateStream(
        scopeA,
        conv.id,
        'rt-stream-idemp-1',
        'Summarize earnings call highlights.'
      );
      expect(initiated.status).toBe('queued');
      expect(initiated.version).toBe(1);
      expect(initiated.user_message_id).toBeDefined();

      // 3. Append streaming status event
      const statusRes = await streamRepo.appendEvent(
        scopeA,
        initiated.stream_id,
        initiated.version,
        'stream_status',
        { status: 'streaming' }
      );
      expect(statusRes.status).toBe('streaming');
      expect(statusRes.version).toBe(2);
      expect(statusRes.sequence_number).toBe(1);

      // 4. Append token delta events
      const delta1 = await streamRepo.appendEvent(
        scopeA,
        initiated.stream_id,
        statusRes.version,
        'token',
        { delta: 'Q3 revenue ' },
        'Q3 revenue '
      );
      expect(delta1.sequence_number).toBe(2);

      const delta2 = await streamRepo.appendEvent(
        scopeA,
        initiated.stream_id,
        delta1.version,
        'token',
        { delta: 'grew 24% YoY.' },
        'grew 24% YoY.'
      );
      expect(delta2.sequence_number).toBe(3);

      // 5. Finalize stream
      const finalized = await streamRepo.finalizeStream(
        scopeA,
        initiated.stream_id,
        delta2.version,
        1500
      );
      expect(finalized.status).toBe('completed');
      expect(finalized.assistant_message_id).toBeDefined();
      expect(finalized.sequence_number).toBe(4);

      // 6. Verify reciprocal message and event sequence in DB
      const eventsRes = await streamRepo.getEventsAfter(scopeA, initiated.stream_id, -1);
      expect(eventsRes.events).toHaveLength(5); // context_ready (0), streaming (1), delta1 (2), delta2 (3), done (4)
      expect(eventsRes.events.map((e) => e.sequence_number)).toEqual([0, 1, 2, 3, 4]);
      expect(eventsRes.events.map((e) => e.event_type)).toEqual([
        'context_ready',
        'stream_status',
        'token',
        'token',
        'done'
      ]);

      // 7. Replay after sequence 2
      const replay = await streamRepo.getEventsAfter(scopeA, initiated.stream_id, 2);
      expect(replay.events).toHaveLength(2); // delta2 (3), done (4)
      expect(replay.events[0].sequence_number).toBe(3);
    });

    it('enforces active idempotency: duplicate initiate during queued and streaming states returns idempotent replay with durable events only', async () => {
      if (!isLive || !streamRepo || !convRepo) return;

      const conv = await convRepo.create(scopeA, { title: 'Active Idempotency Suite' });
      const idempKey = 'active-retry-idemp-' + crypto.randomBytes(6).toString('hex');

      // 1. Initial initiate -> queued
      const initiated1 = await streamRepo.initiateStream(
        scopeA,
        conv.id,
        idempKey,
        'Active idempotent prompt'
      );
      expect(initiated1.status).toBe('queued');
      expect(initiated1.idempotent_replay).toBe(false);

      // 2. Immediate retry while still queued
      const retryQueued = await streamRepo.initiateStream(
        scopeA,
        conv.id,
        idempKey,
        'Active idempotent prompt'
      );
      expect(retryQueued.status).toBe('queued');
      expect(retryQueued.idempotent_replay).toBe(true);
      expect(retryQueued.stream_id).toBe(initiated1.stream_id);
      expect(retryQueued.user_message_id).toBe(initiated1.user_message_id);

      // 3. Transition to streaming
      const statusRes = await streamRepo.appendEvent(
        scopeA,
        initiated1.stream_id,
        initiated1.version,
        'stream_status',
        { status: 'streaming' }
      );
      expect(statusRes.status).toBe('streaming');

      // 4. Retry while streaming
      const retryStreaming = await streamRepo.initiateStream(
        scopeA,
        conv.id,
        idempKey,
        'Active idempotent prompt'
      );
      expect(retryStreaming.status).toBe('streaming');
      expect(retryStreaming.idempotent_replay).toBe(true);
      expect(retryStreaming.stream_id).toBe(initiated1.stream_id);

      // 5. Durable events must contain exactly 2 events: sequence 0 and sequence 1
      const events = await streamRepo.getEventsAfter(scopeA, initiated1.stream_id, -1);
      expect(events.events).toHaveLength(2);
      expect(events.events[0].event_type).toBe('context_ready');
      expect(events.events[0].sequence_number).toBe(0);
      expect(events.events[1].event_type).toBe('stream_status');
      expect(events.events[1].sequence_number).toBe(1);
    });

    it('enforces optimistic concurrency control on stream append/finalize', async () => {
      if (!isLive || !streamRepo || !convRepo) return;

      const conv = await convRepo.create(scopeA, { title: 'Concurrency Session' });
      const initiated = await streamRepo.initiateStream(
        scopeA,
        conv.id,
        'concurrency-key-1',
        'Testing version conflict.'
      );

      // Attempt append with stale version (expected 99, actual 1) -> must fail
      await expect(
        streamRepo.appendEvent(
          scopeA,
          initiated.stream_id,
          99,
          'stream_status',
          { status: 'streaming' }
        )
      ).rejects.toThrow();
    });

    it('supports cancellation and idempotent re-cancellation on active streams', async () => {
      if (!isLive || !streamRepo || !convRepo) return;

      const conv = await convRepo.create(scopeA, { title: 'Cancellation Session' });
      const initiated = await streamRepo.initiateStream(
        scopeA,
        conv.id,
        'cancel-key-1',
        'Stop this stream please.'
      );

      const cancelRes1 = await streamRepo.cancelStream(
        scopeA,
        initiated.stream_id,
        initiated.version,
        'User pressed stop'
      );
      expect(cancelRes1.status).toBe('cancelled');
      expect(cancelRes1.idempotent).toBe(false);

      // Second cancel is idempotent
      const cancelRes2 = await streamRepo.cancelStream(
        scopeA,
        initiated.stream_id,
        cancelRes1.version,
        'User pressed stop again'
      );
      expect(cancelRes2.status).toBe('cancelled');
      expect(cancelRes2.idempotent).toBe(true);
    });

    it('handles cancel-vs-recovery race using separate sessions with no duplicate events or audits', async () => {
      if (!isLive || !streamRepo || !convRepo || !workerPool || !adminDb) return;

      const conv = await convRepo.create(scopeA, { title: 'Cancel-vs-Recovery Race' });
      const initiated = await streamRepo.initiateStream(
        scopeA,
        conv.id,
        'race-cancel-recov-' + crypto.randomBytes(6).toString('hex'),
        'Cancel vs Recovery message'
      );

      // Transition to streaming
      const statusRes = await streamRepo.appendEvent(
        scopeA,
        initiated.stream_id,
        initiated.version,
        'stream_status',
        { status: 'streaming' }
      );

      // Backdate started_at past 60s
      await adminDb.query(
        `UPDATE public.assistant_stream_executions
         SET started_at = NOW() - interval '80 seconds'
         WHERE id = $1;`,
        [initiated.stream_id]
      );

      // Session 1: User cancel
      const cancelPromise = streamRepo.cancelStream(
        scopeA,
        initiated.stream_id,
        statusRes.version,
        'Concurrent cancel by user'
      );

      // Session 2: Worker recovery
      const recoverPromise = workerPool.withRoleClient(async (client) => {
        const repo = new AssistantStreamRepository(client);
        return await repo.recoverStaleStream(initiated.stream_id);
      });

      await Promise.allSettled([cancelPromise, recoverPromise]);

      // At least one operation must succeed, and stream must reach a terminal state
      const finalStream = await streamRepo.findById(scopeA, initiated.stream_id);
      expect(['cancelled', 'failed']).toContain(finalStream!.status);

      // Verify no duplicate terminal events in assistant_stream_events
      const eventsRes = await streamRepo.getEventsAfter(scopeA, initiated.stream_id, -1);
      const terminalEvents = eventsRes.events.filter(
        (e) => e.event_type === 'error' || (e.event_type === 'stream_status' && (e.payload as any).status === 'cancelled')
      );
      expect(terminalEvents.length).toBe(1);

      // Verify audit records: exactly one terminal audit record
      const auditRes = await adminDb.query<{ action: string }>(
        `SELECT action FROM public.audit_events
         WHERE workspace_id = $1 AND target_id = $2
           AND action IN ('assistant.stream_cancelled', 'assistant.stream_stale_recovered');`,
        [workspaceAId, initiated.stream_id]
      );
      expect(auditRes.rows.length).toBe(1);
    });

    it('handles finalize-vs-recovery race using separate sessions with no duplicate events or audits', async () => {
      if (!isLive || !streamRepo || !convRepo || !workerPool || !adminDb) return;

      const conv = await convRepo.create(scopeA, { title: 'Finalize-vs-Recovery Race' });
      const initiated = await streamRepo.initiateStream(
        scopeA,
        conv.id,
        'race-fin-recov-' + crypto.randomBytes(6).toString('hex'),
        'Finalize vs Recovery message'
      );

      const statusRes = await streamRepo.appendEvent(
        scopeA,
        initiated.stream_id,
        initiated.version,
        'stream_status',
        { status: 'streaming' }
      );

      const deltaRes = await streamRepo.appendEvent(
        scopeA,
        initiated.stream_id,
        statusRes.version,
        'token',
        { delta: 'Complete answer text.' },
        'Complete answer text.'
      );

      // Backdate started_at past 60s
      await adminDb.query(
        `UPDATE public.assistant_stream_executions
         SET started_at = NOW() - interval '85 seconds'
         WHERE id = $1;`,
        [initiated.stream_id]
      );

      // Session 1: User finalize
      const finalizePromise = streamRepo.finalizeStream(
        scopeA,
        initiated.stream_id,
        deltaRes.version,
        2000
      );

      // Session 2: Worker recovery
      const recoverPromise = workerPool.withRoleClient(async (client) => {
        const repo = new AssistantStreamRepository(client);
        return await repo.recoverStaleStream(initiated.stream_id);
      });

      await Promise.allSettled([finalizePromise, recoverPromise]);

      // Stream must be either completed or failed
      const finalStream = await streamRepo.findById(scopeA, initiated.stream_id);
      expect(['completed', 'failed']).toContain(finalStream!.status);

      // Verify no duplicate terminal events in assistant_stream_events
      const eventsRes = await streamRepo.getEventsAfter(scopeA, initiated.stream_id, -1);
      const terminalEvents = eventsRes.events.filter((e) => e.event_type === 'done' || e.event_type === 'error');
      expect(terminalEvents.length).toBe(1);

      // Verify exactly one terminal audit record exists
      const auditRes = await adminDb.query<{ action: string }>(
        `SELECT action FROM public.audit_events
         WHERE workspace_id = $1 AND target_id = $2
           AND action IN ('assistant.stream_completed', 'assistant.stream_stale_recovered');`,
        [workspaceAId, initiated.stream_id]
      );
      expect(auditRes.rows.length).toBe(1);

      // If completed, verify reciprocal message exists and links back
      if (finalStream!.status === 'completed') {
        expect(finalStream!.assistant_message_id).toBeDefined();
        const msgRes = await adminDb.query<{ assistant_stream_id: string }>(
          `SELECT assistant_stream_id FROM public.conversation_messages WHERE id = $1;`,
          [finalStream!.assistant_message_id]
        );
        expect(msgRes.rows[0].assistant_stream_id).toBe(initiated.stream_id);
      }
    });

    it('proves no duplicate events or audits on repeated cancellation and recovery attempts', async () => {
      if (!isLive || !streamRepo || !convRepo || !workerPool || !adminDb) return;

      const conv = await convRepo.create(scopeA, { title: 'No Duplicates Suite' });
      const initiated = await streamRepo.initiateStream(
        scopeA,
        conv.id,
        'no-dups-' + crypto.randomBytes(6).toString('hex'),
        'No duplicates message'
      );

      // First cancel
      const cancel1 = await streamRepo.cancelStream(scopeA, initiated.stream_id, initiated.version, 'Cancel 1');
      expect(cancel1.status).toBe('cancelled');
      expect(cancel1.idempotent).toBe(false);

      // Repeat cancel twice more
      const cancel2 = await streamRepo.cancelStream(scopeA, initiated.stream_id, cancel1.version, 'Cancel 2');
      expect(cancel2.idempotent).toBe(true);

      const cancel3 = await streamRepo.cancelStream(scopeA, initiated.stream_id, cancel2.version, 'Cancel 3');
      expect(cancel3.idempotent).toBe(true);

      // Attempt recovery on cancelled stream -> must recover 0
      const recov = await workerPool.withRoleClient(async (client) => {
        const repo = new AssistantStreamRepository(client);
        return await repo.recoverStaleStream(initiated.stream_id);
      });
      expect(recov.recovered).toBe(false);

      // Assert exactly 1 cancelled event
      const eventsRes = await streamRepo.getEventsAfter(scopeA, initiated.stream_id, -1);
      const cancelEvents = eventsRes.events.filter(
        (e) => e.event_type === 'stream_status' && (e.payload as any).status === 'cancelled'
      );
      expect(cancelEvents.length).toBe(1);

      // Assert exactly 1 audit event
      const auditRes = await adminDb.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM public.audit_events
         WHERE workspace_id = $1 AND target_id = $2 AND action = 'assistant.stream_cancelled';`,
        [workspaceAId, initiated.stream_id]
      );
      expect(parseInt(auditRes.rows[0].count, 10)).toBe(1);
    });
  });

  describe('Worker Recovery Security & Truthful Reconciliation (thaara_worker)', () => {
    it('proves thaara_app cannot execute worker recovery procedures (42501)', async () => {
      if (!isLive || !appDb) return;

      await expect(
        appDb.query(`SELECT public.recover_stale_assistant_stream(gen_random_uuid());`)
      ).rejects.toMatchObject({ code: '42501' });

      await expect(
        appDb.query(`SELECT public.reconcile_stale_assistant_streams(50);`)
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('executes stale stream recovery under thaara_worker with truthful STREAM_TIMEOUT', async () => {
      if (!isLive || !workerPool || !appDb) return;

      const streamRepo = new AssistantStreamRepository(appDb);
      const convRepo = new ConversationRepository(appDb);

      const conv = await convRepo.create(scopeA, { title: 'Worker Recovery Org' });
      const initiated = await streamRepo.initiateStream(
        scopeA,
        conv.id,
        'worker-recov-key-1',
        'Stale stream for worker recovery.'
      );

      // Artificially backdate started_at past 60s
      await adminDb!.query(
        `UPDATE public.assistant_stream_executions
         SET started_at = NOW() - interval '80 seconds'
         WHERE id = $1;`,
        [initiated.stream_id]
      );

      // Execute worker reconciliation under thaara_worker
      const sweepRes = await workerPool.withRoleClient(async (client) => {
        const repo = new AssistantStreamRepository(client);
        return await repo.reconcileStaleStreams(50);
      });

      expect(sweepRes.recovered_count).toBeGreaterThanOrEqual(1);
      expect(sweepRes.stream_ids).toContain(initiated.stream_id);

      // Verify stream is failed with STREAM_TIMEOUT
      const stream = await streamRepo.findById(scopeA, initiated.stream_id);
      expect(stream!.status).toBe('failed');
      expect(stream!.error_code).toBe('STREAM_TIMEOUT');
      expect(stream!.completed_at).not.toBeNull();

      // Verify audit record emitted
      const { rows } = await adminDb!.query(
        `SELECT action, target_id, payload
         FROM public.audit_events
         WHERE workspace_id = $1 AND action = 'assistant.stream_stale_recovered' AND target_id = $2;`,
        [workspaceAId, initiated.stream_id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].payload.error_code).toBe('STREAM_TIMEOUT');
    });
  });

  describe('Cross-Tenant & Cross-User Security Isolation', () => {
    it('prohibits User B from initiating, appending, or finalizing Tenant A streams', async () => {
      if (!isLive || !appDb) return;

      const streamRepo = new AssistantStreamRepository(appDb);
      const convRepo = new ConversationRepository(appDb);

      const convA = await convRepo.create(scopeA, { title: 'Confidential Strategy A' });

      // User B attempts to initiate stream on Tenant A conversation -> fails
      await expect(
        streamRepo.initiateStream(scopeB, convA.id, 'cross-stream-key', 'Steal strategy')
      ).rejects.toThrow();

      // Alice creates valid stream
      const streamA = await streamRepo.initiateStream(scopeA, convA.id, 'stream-a-valid', 'Legit prompt');

      // User B attempts to append event to Alice's stream -> fails
      await expect(
        streamRepo.appendEvent(scopeB, streamA.stream_id, streamA.version, 'stream_status', { status: 'streaming' })
      ).rejects.toThrow();

      // User B attempts to finalize Alice's stream -> fails
      await expect(
        streamRepo.finalizeStream(scopeB, streamA.stream_id, streamA.version, 100)
      ).rejects.toThrow();

      // User B attempts to fetch Alice's stream events -> fails
      await expect(
        streamRepo.getEventsAfter(scopeB, streamA.stream_id, -1)
      ).rejects.toThrow();
    });
  });

  describe('Real PostgreSQL Scope-Wrapper Boundary (max: 1 Pool)', () => {
    it('proves withAuthenticatedScope sets token only inside transaction and connection is clean after commit and rollback', async () => {
      if (!isLive || !appDbUrl) return;

      // 1. Create a real pg.Pool with max: 1
      const singleConnPool = new pg.Pool({
        connectionString: appDbUrl,
        max: 1,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
      });
      const singleDb = new PostgresDatabase(singleConnPool);

      try {
        // Initial state: verify app.session_token_hash is unset on the single connection
        const cInitial = await singleConnPool.connect();
        try {
          const res = await cInitial.query<{ hash: string | null }>(
            "SELECT current_setting('app.session_token_hash', true) AS hash;"
          );
          expect(['', null]).toContain(res.rows[0].hash);
        } finally {
          cInitial.release();
        }

        // 2. Commit path: withAuthenticatedScope sets token inside transaction
        const commitTokenHash = 'hash-commit-real-pg-' + crypto.randomBytes(8).toString('hex');
        const insideCommitHash = await singleDb.withAuthenticatedScope(commitTokenHash, async (client) => {
          const res = await client.query<{ hash: string | null }>(
            "SELECT current_setting('app.session_token_hash', true) AS hash;"
          );
          return res.rows[0].hash;
        });
        expect(insideCommitHash).toBe(commitTokenHash);

        // Reacquire the same pooled connection after commit: prove app.session_token_hash is unset/empty
        const cAfterCommit = await singleConnPool.connect();
        try {
          const res = await cAfterCommit.query<{ hash: string | null }>(
            "SELECT current_setting('app.session_token_hash', true) AS hash;"
          );
          expect(['', null]).toContain(res.rows[0].hash);
        } finally {
          cAfterCommit.release();
        }

        // 3. Rollback path: error during transaction rolls back cleanly
        const rollbackTokenHash = 'hash-rollback-real-pg-' + crypto.randomBytes(8).toString('hex');
        let insideRollbackHash: string | null = null;
        await expect(
          singleDb.withAuthenticatedScope(rollbackTokenHash, async (client) => {
            const res = await client.query<{ hash: string | null }>(
              "SELECT current_setting('app.session_token_hash', true) AS hash;"
            );
            insideRollbackHash = res.rows[0].hash;
            throw new Error('Forced rollback in runtime scope test');
          })
        ).rejects.toThrow('Forced rollback in runtime scope test');

        expect(insideRollbackHash).toBe(rollbackTokenHash);

        // Reacquire the same pooled connection after rollback: prove app.session_token_hash is unset/empty
        const cAfterRollback = await singleConnPool.connect();
        try {
          const res = await cAfterRollback.query<{ hash: string | null }>(
            "SELECT current_setting('app.session_token_hash', true) AS hash;"
          );
          expect(['', null]).toContain(res.rows[0].hash);
        } finally {
          cAfterRollback.release();
        }
      } finally {
        await singleConnPool.end();
      }
    });
  });

  describe('Worker Credentials & Role Validation at Startup (Real PostgreSQL)', () => {
    it('proves valid worker pool checkout verifies thaara_worker_user identity and thaara_worker role', async () => {
      if (!isLive || !workerPool) return;

      const client = await workerPool.checkout();
      try {
        const res = await client.query<{ session_user: string; current_user: string; has_role: boolean }>(`
          SELECT session_user, current_user, pg_catalog.pg_has_role(session_user, current_user, 'member') AS has_role;
        `);
        expect(res.rows[0].session_user).toBe('thaara_worker_user');
        expect(res.rows[0].current_user).toBe('thaara_worker');
        expect(res.rows[0].has_role).toBe(true);
      } finally {
        await client.release();
      }
    });

    it('proves invalid worker credentials fail startup immediately before processing jobs', async () => {
      if (!isLive || !adminDb) return;


      // 1. Invalid password
      const badPasswordPool = new RoleAwarePool({
        connectionString: isolatedRoleUrl(isolated, 'thaara_worker_user', 'definitely_wrong_password_12345'),
        targetRole: 'thaara_worker',
        expectedLoginUser: 'thaara_worker_user',
        connectionTimeoutMillis: 2000
      });

      await expect(badPasswordPool.checkout()).rejects.toThrow();
      await badPasswordPool.close();

      // 2. Wrong login user (connecting as thaara_app when expecting thaara_worker_user)
      if (appDbUrl) {
        const wrongUserPool = new RoleAwarePool({
          connectionString: appDbUrl, // logs in as thaara_app
          targetRole: 'thaara_worker',
          expectedLoginUser: 'thaara_worker_user',
          connectionTimeoutMillis: 2000
        });

        // session_user mismatch throws
        await expect(wrongUserPool.checkout()).rejects.toThrow();
        await wrongUserPool.close();
      }

      // 3. Invalid target role: unprivileged role attempting thaara_worker
      const unprivilegedPool = new RoleAwarePool({
        connectionString: isolatedRoleUrl(isolated, 'unprivileged_tester_t003_stream', unprivilegedTesterPassword),
        targetRole: 'thaara_worker',
        expectedLoginUser: 'unprivileged_tester_t003_stream',
        connectionTimeoutMillis: 2000
      });

      // SET ROLE "thaara_worker" fails with permission denied (42501)
      await expect(unprivilegedPool.checkout()).rejects.toThrow();
      await unprivilegedPool.close();
    });
  });
});
