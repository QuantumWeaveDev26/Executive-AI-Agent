import { describe, it, expect, beforeEach } from 'vitest';
import {
  PGliteDatabase,
  Migrator,
  WorkspaceRepository,
  UserRepository,
  MembershipRepository,
  SessionRepository,
  ConversationRepository,
  AssistantStreamRepository,
  hashSessionToken,
  generateSessionToken
} from '@thaara/db';
import { AssistantStreamSweeper } from '../src/sweeper.js';

describe('Worker Assistant Stream Stale Sweeper & Recovery (Task 003 Phase 3)', () => {
  let db: PGliteDatabase;
  let workspaceId: string;
  let userId: string;
  let sessionToken: string;
  let sessionTokenHash: string;
  let streamRepo: AssistantStreamRepository;
  let convRepo: ConversationRepository;
  let sweeper: AssistantStreamSweeper;

  beforeEach(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());

    const wsRepo = new WorkspaceRepository(db);
    const userRepo = new UserRepository(db);

    const ws = await wsRepo.create('Sweeper Test Org');
    workspaceId = ws.id;

    const user = await userRepo.create('sweeper-user@org.com', 'hash', 'Sweeper User');
    userId = user.id;

    sessionToken = generateSessionToken();
    sessionTokenHash = hashSessionToken(sessionToken);

    const scope = {
      workspaceId: ws.id,
      userId: user.id,
      role: 'owner' as const,
      sessionTokenHash
    };

    await db.withScopedTransaction(scope, async (tx) => {
      const mRepo = new MembershipRepository(tx);
      const sRepo = new SessionRepository(tx);
      await mRepo.create(ws.id, user.id, 'owner');
      await sRepo.create(user.id, ws.id, sessionToken);
    });

    streamRepo = new AssistantStreamRepository(db);
    convRepo = new ConversationRepository(db);
    sweeper = new AssistantStreamSweeper(db);
  });

  const getScope = () => ({
    workspaceId,
    userId,
    role: 'owner' as const,
    sessionTokenHash
  });

  it('reconciles stale streams (> 60s) to failed with STREAM_TIMEOUT and appends error event and audit record', async () => {
    const scope = getScope();

    // 1. Create conversation
    const conv = await convRepo.create(scope, { title: 'Executive Session' });

    // 2. Initiate stream
    const initiated = await streamRepo.initiateStream(
      scope,
      conv.id,
      'stale-test-key-1',
      'Please analyze Q3 balance sheet.'
    );
    expect(initiated.status).toBe('queued');

    // 3. Artificially backdate started_at past 60s
    await db.query(
      `UPDATE public.assistant_stream_executions
       SET started_at = NOW() - interval '70 seconds'
       WHERE id = $1;`,
      [initiated.stream_id]
    );

    // 4. Run sweeper
    const result = await sweeper.reconcileStaleStreams(50);
    expect(result.recoveredCount).toBe(1);
    expect(result.streamIds).toContain(initiated.stream_id);

    // 5. Verify database state
    const stream = await streamRepo.findById(scope, initiated.stream_id);
    expect(stream).not.toBeNull();
    expect(stream!.status).toBe('failed');
    expect(stream!.error_code).toBe('STREAM_TIMEOUT');
    expect(stream!.completed_at).not.toBeNull();

    // 6. Verify error event was appended
    const eventsRes = await streamRepo.getEventsAfter(scope, initiated.stream_id, -1);
    const errorEvt = eventsRes.events.find((e) => e.event_type === 'error');
    expect(errorEvt).toBeDefined();
    expect((errorEvt!.payload as any).error).toBe('STREAM_TIMEOUT');

    // 7. Verify single audit event
    const auditRes = await db.query(
      `SELECT action, target_type, target_id, payload
       FROM public.audit_events
       WHERE workspace_id = $1 AND action = 'assistant.stream_stale_recovered';`,
      [workspaceId]
    );
    expect(auditRes.rows.length).toBe(1);
    expect(auditRes.rows[0].target_id).toBe(initiated.stream_id);
    expect(auditRes.rows[0].payload.error_code).toBe('STREAM_TIMEOUT');
  });

  it('is strictly idempotent on subsequent sweeper runs with zero duplicate events or audits', async () => {
    const scope = getScope();

    const conv = await convRepo.create(scope, { title: 'Idempotency Session' });
    const initiated = await streamRepo.initiateStream(
      scope,
      conv.id,
      'stale-idemp-key',
      'What are our OKRs?'
    );

    await db.query(
      `UPDATE public.assistant_stream_executions
       SET started_at = NOW() - interval '90 seconds'
       WHERE id = $1;`,
      [initiated.stream_id]
    );

    // First recovery
    const firstSweep = await sweeper.reconcileStaleStreams(50);
    expect(firstSweep.recoveredCount).toBe(1);

    // Second recovery immediately after
    const secondSweep = await sweeper.reconcileStaleStreams(50);
    expect(secondSweep.recoveredCount).toBe(0);

    // Verify exactly one error event exists
    const eventsRes = await streamRepo.getEventsAfter(scope, initiated.stream_id, -1);
    const errorEvents = eventsRes.events.filter((e) => e.event_type === 'error');
    expect(errorEvents.length).toBe(1);

    // Verify exactly one audit event exists
    const auditRes = await db.query(
      `SELECT count(*)::int as count
       FROM public.audit_events
       WHERE workspace_id = $1 AND action = 'assistant.stream_stale_recovered' AND target_id = $2;`,
      [workspaceId, initiated.stream_id]
    );
    expect(auditRes.rows[0].count).toBe(1);
  });

  it('does not touch active streams that have elapsed less than 60 seconds', async () => {
    const scope = getScope();

    const conv = await convRepo.create(scope, { title: 'Active Session' });
    const initiated = await streamRepo.initiateStream(
      scope,
      conv.id,
      'active-stream-key',
      'Brief me on project status.'
    );

    // Stream started 10 seconds ago (fresh)
    await db.query(
      `UPDATE public.assistant_stream_executions
       SET started_at = NOW() - interval '10 seconds'
       WHERE id = $1;`,
      [initiated.stream_id]
    );

    const result = await sweeper.reconcileStaleStreams(50);
    expect(result.recoveredCount).toBe(0);

    const stream = await streamRepo.findById(scope, initiated.stream_id);
    expect(stream!.status).toBe('queued');
  });

  describe('Worker Process Lifecycle & Fail-Closed Behavior in All Non-Test Environments', () => {
    it('fails closed in development, staging, and production if worker-role access is unavailable', () => {
      const origEnv = process.env.NODE_ENV;
      try {
        for (const envName of ['development', 'staging', 'production']) {
          process.env.NODE_ENV = envName;
          expect(() => new AssistantStreamSweeper(db)).toThrow(
            /AssistantStreamSweeper requires a RoleAwarePool configured for thaara_worker in all non-test environments/
          );
        }
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    it('fails createWorkerService startup in every non-test environment when worker credentials are missing', async () => {
      const { createWorkerService } = await import('../src/worker.js');
      const origEnv = process.env.NODE_ENV;
      try {
        for (const envName of ['development', 'staging', 'production']) {
          process.env.NODE_ENV = envName;
          await expect(
            createWorkerService({
              config: {
                NODE_ENV: envName as any,
                PORT: 3001,
                HOST: '127.0.0.1',
                CORS_ORIGIN: '*',
                DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
                REDIS_URL: 'redis://localhost:6379',
                SESSION_SECRET: 'test_only_session_secret_at_least_32_chars_long_12345678',
                CSRF_SECRET: 'test_only_csrf_secret_at_least_32_chars_long_1234567890',
                COOKIE_SECURE: false,
                LOG_LEVEL: 'info',
                RATE_LIMIT_MAX: 1000,
                RATE_LIMIT_TIME_WINDOW_MS: 60000
              },
              db: db as any
            })
          ).rejects.toThrow(
            /Worker database credentials .* must be configured for thaara_worker in all non-test environments/
          );
        }
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    it('fails createWorkerService startup immediately if worker pool checkout fails (invalid credentials)', async () => {
      const { createWorkerService } = await import('../src/worker.js');
      const mockFailingPool: any = {
        targetRole: 'thaara_worker',
        checkout: async () => {
          throw new Error('password authentication failed for user "thaara_worker_user"');
        },
        close: async () => {}
      };

      await expect(
        createWorkerService({
          config: {
            NODE_ENV: 'production',
            PORT: 3001,
            HOST: '127.0.0.1',
            CORS_ORIGIN: '*',
            DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
            REDIS_URL: 'redis://localhost:6379',
            SESSION_SECRET: 'test_only_session_secret_at_least_32_chars_long_12345678',
            CSRF_SECRET: 'test_only_csrf_secret_at_least_32_chars_long_1234567890',
            COOKIE_SECURE: false,
            LOG_LEVEL: 'info',
            RATE_LIMIT_MAX: 1000,
            RATE_LIMIT_TIME_WINDOW_MS: 60000
          },
          db: db as any,
          workerPool: mockFailingPool
        })
      ).rejects.toThrow(/password authentication failed/);
    });

    it('fails createWorkerService startup immediately if checkout identity does not match thaara_worker_user / thaara_worker', async () => {
      const { createWorkerService } = await import('../src/worker.js');
      const mockWrongIdentityPool: any = {
        targetRole: 'thaara_worker',
        checkout: async () => ({
          query: async () => ({ rows: [{ session_user: 'thaara_app', current_user: 'thaara_app' }] }),
          release: async () => {}
        }),
        close: async () => {}
      };

      await expect(
        createWorkerService({
          config: {
            NODE_ENV: 'production',
            PORT: 3001,
            HOST: '127.0.0.1',
            CORS_ORIGIN: '*',
            DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
            REDIS_URL: 'redis://localhost:6379',
            SESSION_SECRET: 'test_only_session_secret_at_least_32_chars_long_12345678',
            CSRF_SECRET: 'test_only_csrf_secret_at_least_32_chars_long_1234567890',
            COOKIE_SECURE: false,
            LOG_LEVEL: 'info',
            RATE_LIMIT_MAX: 1000,
            RATE_LIMIT_TIME_WINDOW_MS: 60000
          },
          db: db as any,
          workerPool: mockWrongIdentityPool
        })
      ).rejects.toThrow(/Worker role checkout identity mismatch/);
    });

    it('validates worker credentials at startup and starts/stops AssistantStreamSweeper during lifecycle', async () => {
      const { createWorkerService } = await import('../src/worker.js');
      let checkedOut = false;
      let released = false;

      const mockValidPool: any = {
        targetRole: 'thaara_worker',
        checkout: async () => {
          checkedOut = true;
          return {
            query: async () => ({ rows: [{ session_user: 'thaara_worker_user', current_user: 'thaara_worker' }] }),
            release: async () => {
              released = true;
            }
          };
        },
        withRoleClient: async (fn: any) => fn({ query: async () => ({ rows: [] }) }),
        close: async () => {}
      };

      const service = await createWorkerService({
        config: {
          NODE_ENV: 'production',
          PORT: 3001,
          HOST: '127.0.0.1',
          CORS_ORIGIN: '*',
          DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
          REDIS_URL: 'redis://localhost:6379',
          SESSION_SECRET: 'test_only_session_secret_at_least_32_chars_long_12345678',
          CSRF_SECRET: 'test_only_csrf_secret_at_least_32_chars_long_1234567890',
          COOKIE_SECURE: false,
          LOG_LEVEL: 'info',
          RATE_LIMIT_MAX: 1000,
          RATE_LIMIT_TIME_WINDOW_MS: 60000
        },
        db: db as any,
        workerPool: mockValidPool
      });

      expect(checkedOut).toBe(true);
      expect(released).toBe(true);
      expect(service.assistantStreamSweeper).toBeDefined();
      expect(service.approvalSweeper).toBeDefined();

      service.start();
      await service.stop();
    });
  });
});
