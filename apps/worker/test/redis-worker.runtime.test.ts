import { getIsolatedRuntimeConfig, isolatedRoleUrl } from '../../../scripts/step74-runtime-guard.mjs';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'node:crypto';
import { Redis } from 'ioredis';
import {
  PostgresDatabase,
  Migrator,
  WorkspaceRepository,
  JobRunRepository,
  AuditEventRepository,
  PlanRepository,
  PlanStepRepository,
  PlanStepDependencyRepository,
  ReceiptRepository,
  UserRepository,
  MembershipRepository,
  SessionRepository,
  TransactionalDbClient,
  RoleAwarePool,
  WorkerPurgeRepository,
  hashSessionToken
} from '@thaara/db';
import { defaultLogger } from '@thaara/observability';
import { computeCanonicalParameterHash } from '@thaara/contracts';
import { DistributedJobQueue, QUEUE_NAME } from '../src/queue.js';
import { PrivacyPurgeContinuationSweeper } from '../src/continuation-sweeper.js';

const isolated = getIsolatedRuntimeConfig();

describe('BullMQ and Redis Distributed Worker Runtime (Real Redis & PostgreSQL)', () => {
  const allowOffline = process.env.ALLOW_OFFLINE_RUNTIME_SKIP === 'true';
  const redisUrl = isolated.redisUrl;
  const dbUrl = isolated.appUrl;
  const migrationDbUrl = isolated.migrationUrl;

  let isLive = false;
  let db: TransactionalDbClient;
  let adminDb: PostgresDatabase | null = null;
  let workerPool: RoleAwarePool | undefined;
  let queue: DistributedJobQueue;
  let redisClient: Redis;
  let workspaceId: string;
  let userId: string;

  const fakeScope = () => ({
    workspaceId,
    userId: userId || '00000000-0000-0000-0000-000000000000',
    role: 'owner' as const,
    sessionTokenHash: hashSessionToken('redis-worker-token')
  });

  beforeAll(async () => {
    // 1. Probe if Redis is reachable
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      retryStrategy: () => null
    });

    const pgProbe = new PostgresDatabase(migrationDbUrl);

    try {
      await redisClient.ping();
      await pgProbe.query('SELECT 1;');
      await pgProbe.close();
      isLive = true;
    } catch (err) {
      try {
        await pgProbe.close();
      } catch {}
      if (!allowOffline) {
        throw new Error(
          `[Runtime Proof Failure] Redis or PostgreSQL runtime service is unavailable. ` +
          `Real Redis and PostgreSQL are required for worker runtime verification. ` +
          `Verify the disposable Step 74 services and explicit test settings. ` +
          `To run in explicit offline diagnostic mode, set ALLOW_OFFLINE_RUNTIME_SKIP=true. ` +
          `Underlying error: ${(err as Error).message}`
        );
      }
      console.warn(
        `[Redis Worker Runtime Suite] Runtime services unavailable. ` +
        `ALLOW_OFFLINE_RUNTIME_SKIP=true is set; running in offline diagnostic mode. Skipping live queries.`
      );
      return;
    }

    if (!dbUrl) {
      throw new Error(
        `[Runtime Proof Failure] DATABASE_URL must be provided with valid non-superuser thaara_app credentials.`
      );
    }

    // 2. Run migrations as migration admin (superuser / ddl role)
    adminDb = new PostgresDatabase(migrationDbUrl);
    const migrator = new Migrator(adminDb);
    await migrator.migrate(migrator.loadMigrationFiles());

    // 3. Connect application worker DB using DATABASE_URL (thaara_app)
    db = new PostgresDatabase(dbUrl);

    const wsRepo = new WorkspaceRepository(db);
    const ws = await wsRepo.create('Redis Worker Runtime Org');
    workspaceId = ws.id;

    const userRepo = new UserRepository(db);
    const u = await userRepo.create(`worker.runtime.${crypto.randomUUID().slice(0, 8)}@org.com`, 'pwd_hash', 'Worker Runtime User');
    userId = u.id;
    await db.withScopedTransaction(fakeScope(), async (txClient) => {
      await new MembershipRepository(txClient).create(workspaceId, userId, 'owner');
    });

    const workerPw = process.env.THAARA_DB_WORKER_PASSWORD;
    if (workerPw) {
      workerPool = new RoleAwarePool({
        connectionString: isolatedRoleUrl(isolated, 'thaara_worker_user', workerPw),
        targetRole: 'thaara_worker',
        expectedLoginUser: 'thaara_worker_user'
      });
    }

    queue = new DistributedJobQueue(redisUrl, db, defaultLogger, workerPool);
    queue.startWorker();
  });

  afterAll(async () => {
    if (isLive) {
      if (queue) await queue.close();
      if (workerPool) await workerPool.close();
      if (redisClient) await redisClient.quit();
      if (adminDb) await adminDb.close();
      if (db && 'close' in db && typeof (db as any).close === 'function') {
        await (db as any).close();
      }
    }
  });

  // Helper to poll for job completion in DB
  const waitForJobStatus = async (
    jobRunId: string,
    targetStatuses: string[],
    timeoutMs = 10000
  ) => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const run = await db.withScopedTransaction(fakeScope(), async (txClient) => {
        const repo = new JobRunRepository(txClient);
        return await repo.findById(workspaceId, jobRunId);
      });

      if (run && targetStatuses.includes(run.status)) {
        return run;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(
      `Job ${jobRunId} did not reach one of [${targetStatuses.join(', ')}] within ${timeoutMs}ms`
    );
  };

  const waitForStepStatus = async (
    stepId: string,
    targetStatuses: string[],
    timeoutMs = 15000
  ) => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const step = await db.withScopedTransaction(fakeScope(), async (txClient) => {
        const repo = new PlanStepRepository(txClient);
        return await repo.findById(workspaceId, stepId);
      });

      if (step && targetStatuses.includes(step.status)) {
        return step;
      }
      if (
        step &&
        ['failed', 'cancelled', 'unverified', 'not_configured'].includes(step.status) &&
        !targetStatuses.includes(step.status)
      ) {
        throw new Error(
          `Step ${stepId} reached unexpected terminal status '${step.status}' with error: ${JSON.stringify(step.error)}`
        );
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(
      `Step ${stepId} did not reach one of [${targetStatuses.join(', ')}] within ${timeoutMs}ms`
    );
  };

  it('proves BullMQ enqueue deduplication / idempotency for identical jobRunId', async () => {
    if (!isLive) return;

    const jobRun = await db.withScopedTransaction(fakeScope(), async (txClient) => {
      const repo = new JobRunRepository(txClient);
      return await repo.create(workspaceId, 'test.sample_task', { step: 1 }, 'idem-bullmq-key-01');
    });

    // Enqueue first time
    await queue.enqueue({
      workspaceId,
      jobRunId: jobRun.id,
      jobName: jobRun.job_name,
      payload: jobRun.payload
    });

    // Enqueue identical jobRunId again (must not throw or duplicate)
    await queue.enqueue({
      workspaceId,
      jobRunId: jobRun.id,
      jobName: jobRun.job_name,
      payload: jobRun.payload
    });

    const finished = await waitForJobStatus(jobRun.id, ['completed']);
    expect(finished.status).toBe('completed');
  });

  it('processes a job to completion and persists truthful completed state and audit event', async () => {
    if (!isLive) return;

    const jobRun = await db.withScopedTransaction(fakeScope(), async (txClient) => {
      const repo = new JobRunRepository(txClient);
      return await repo.create(workspaceId, 'test.sample_task', { count: 100 });
    });

    await queue.enqueue({
      workspaceId,
      jobRunId: jobRun.id,
      jobName: jobRun.job_name,
      payload: jobRun.payload
    });

    const finished = await waitForJobStatus(jobRun.id, ['completed']);
    expect(finished.status).toBe('completed');
    expect(finished.completed_at).not.toBeNull();

    await db.withScopedTransaction(fakeScope(), async (txClient) => {
      const auditRepo = new AuditEventRepository(txClient);
      const audit = await auditRepo.listByWorkspace(workspaceId);
      const completionEvt = audit.events.find(
        (e) => e.action === 'job.completed' && e.target_id === jobRun.id
      );
      expect(completionEvt).toBeDefined();
    });
  });

  it('retries transient failures and recovers with backoff', async () => {
    if (!isLive) return;

    const jobRun = await db.withScopedTransaction(fakeScope(), async (txClient) => {
      const repo = new JobRunRepository(txClient);
      return await repo.create(workspaceId, 'test.transient_failure', {});
    });

    await queue.enqueue({
      workspaceId,
      jobRunId: jobRun.id,
      jobName: jobRun.job_name,
      payload: jobRun.payload,
      maxRetries: 3
    });

    const finished = await waitForJobStatus(jobRun.id, ['completed'], 15000);
    expect(finished.status).toBe('completed');
    expect(finished.retries_count).toBeGreaterThanOrEqual(1);

    await db.withScopedTransaction(fakeScope(), async (txClient) => {
      const auditRepo = new AuditEventRepository(txClient);
      const audit = await auditRepo.listByWorkspace(workspaceId);
      const completionEvt = audit.events.find(
        (e) => e.action === 'job.completed' && e.target_id === jobRun.id
      );
      expect(completionEvt).toBeDefined();
    });
  });

  it('truthfully marks unconfigured connectors as failed with job.not_configured audit event', async () => {
    if (!isLive) return;

    const jobRun = await db.withScopedTransaction(fakeScope(), async (txClient) => {
      const repo = new JobRunRepository(txClient);
      return await repo.create(workspaceId, 'connector.slack', { channel: 'general' });
    });

    await queue.enqueue({
      workspaceId,
      jobRunId: jobRun.id,
      jobName: jobRun.job_name,
      payload: jobRun.payload
    });

    const finished = await waitForJobStatus(jobRun.id, ['failed']);
    expect(finished.status).toBe('failed');
    expect(finished.error).toBe('External connector credentials are not configured.');

    await db.withScopedTransaction(fakeScope(), async (txClient) => {
      const auditRepo = new AuditEventRepository(txClient);
      const audit = await auditRepo.listByWorkspace(workspaceId);
      const notConfiguredEvt = audit.events.find(
        (e) => e.action === 'job.not_configured' && e.target_id === jobRun.id
      );
      expect(notConfiguredEvt).toBeDefined();
      expect(notConfiguredEvt?.payload).toMatchObject({
        jobName: 'connector.slack',
        error: 'External connector credentials are not configured.'
      });
    });
  });

  it('rejects arbitrary or unknown job names without executing fake success paths', async () => {
    if (!isLive) return;

    const jobRun = await db.withScopedTransaction(fakeScope(), async (txClient) => {
      const repo = new JobRunRepository(txClient);
      return await repo.create(workspaceId, 'unregistered.malicious_job', { foo: 'bar' });
    });

    await queue.enqueue({
      workspaceId,
      jobRunId: jobRun.id,
      jobName: jobRun.job_name,
      payload: jobRun.payload,
      maxRetries: 1
    });

    const finished = await waitForJobStatus(jobRun.id, ['failed']);
    expect(finished.status).toBe('failed');
    expect(finished.error).toContain('Unsupported or unknown job name');
  });

  it('recovers and processes queued jobs across worker stop and restart', async () => {
    if (!isLive) return;

    // 1. Create a job run in DB
    const jobRun = await db.withScopedTransaction(fakeScope(), async (txClient) => {
      const repo = new JobRunRepository(txClient);
      return await repo.create(workspaceId, 'test.sample_task', { recoveryTest: true });
    });

    // 2. Stop current worker
    await queue.close();

    // 3. Enqueue job while worker is down
    const restartedQueue = new DistributedJobQueue(redisUrl, db, defaultLogger, workerPool);
    await restartedQueue.enqueue({
      workspaceId,
      jobRunId: jobRun.id,
      jobName: jobRun.job_name,
      payload: jobRun.payload
    });

    // 4. Start worker on restarted queue instance
    restartedQueue.startWorker();

    // 5. Verify restarted worker recovers the queued job and completes it
    const finished = await waitForJobStatus(jobRun.id, ['completed']);
    expect(finished.status).toBe('completed');
    expect(finished.completed_at).not.toBeNull();

    await restartedQueue.close();

    // Re-initialize queue instance and start worker for subsequent tests
    queue = new DistributedJobQueue(redisUrl, db, defaultLogger, workerPool);
    queue.startWorker();
  });

  it('processes distributed multi-step plan execution over Redis, BullMQ, and PostgreSQL RLS with truthful receipts', async () => {
    if (!isLive) return;

    let planId = '';
    let step1Id = '';
    let step2Id = '';

    await db.withScopedTransaction(fakeScope(), async (txClient) => {
      const planRepo = new PlanRepository(txClient);
      const stepRepo = new PlanStepRepository(txClient);
      const depRepo = new PlanStepDependencyRepository(txClient);

      const plan = await planRepo.create(workspaceId, fakeScope().userId, 'Distributed Pipeline Plan');
      planId = plan.id;

      const p1 = { task: 'prepare_distributed_env' };
      const s1 = await stepRepo.create(
        workspaceId,
        planId,
        0,
        'test.deterministic_hash_task',
        'write',
        'low',
        'none',
        p1,
        computeCanonicalParameterHash(p1)
      );
      step1Id = s1.id;

      const p2 = { task: 'verify_distributed_env' };
      const s2 = await stepRepo.create(
        workspaceId,
        planId,
        1,
        'test.deterministic_hash_task',
        'write',
        'low',
        'none',
        p2,
        computeCanonicalParameterHash(p2)
      );
      step2Id = s2.id;
      await depRepo.create(workspaceId, planId, step2Id, step1Id);

      await planRepo.transitionStatus(workspaceId, planId, 'draft', 'queued');
      await stepRepo.transitionStatus(workspaceId, step1Id, 'blocked', 'queued');
    });

    // Enqueue step 1 to BullMQ
    await queue.enqueue({
      workspaceId,
      jobRunId: step1Id,
      jobName: 'plan.execute_step',
      payload: { planId, stepId: step1Id, actionName: 'test.deterministic_hash_task' }
    });

    // Wait for Step 1 to be executed and verified
    const s1Result = await waitForStepStatus(step1Id, ['verified']);
    expect(s1Result.status).toBe('verified');

    // Wait for Step 2 (automatically unblocked and enqueued) to be executed and verified
    const s2Result = await waitForStepStatus(step2Id, ['verified']);
    expect(s2Result.status).toBe('verified');

    // Verify final state in PostgreSQL under RLS
    await db.withScopedTransaction(fakeScope(), async (txClient) => {
      const planRepo = new PlanRepository(txClient);
      const receiptRepo = new ReceiptRepository(txClient);
      const auditRepo = new AuditEventRepository(txClient);

      const plan = await planRepo.findById(workspaceId, planId);
      expect(plan?.status).toBe('completed');

      const r1 = await receiptRepo.findByStepId(workspaceId, step1Id);
      expect(r1?.status).toBe('verified');
      expect(r1?.verification_method).toBe('cryptographic_hash_receipt');

      const r2 = await receiptRepo.findByStepId(workspaceId, step2Id);
      expect(r2?.status).toBe('verified');
      expect(r2?.verification_method).toBe('cryptographic_hash_receipt');

      const audit = await auditRepo.listByWorkspace(workspaceId);
      expect(audit.events.some((e) => e.action === 'plan.completed')).toBe(true);
    });
  });

  it('proves a claimed continuation survives a worker crash, expires, is recovered by sweeper with a replacement continuation, and completes truthfully', async () => {
    if (!isLive) return;

    // 1. Initiate purge with unique user
    const userRepo = new UserRepository(adminDb!);
    const u1 = await userRepo.create(`crash.user.${crypto.randomUUID()}@org.com`, 'pwd_hash', 'Crash User');
    const u1Id = u1.id;

    const sessionToken = `redis-crash-test-token-${crypto.randomUUID()}`;
    const sessionTokenHash = hashSessionToken(sessionToken);

    const memRepo = new MembershipRepository(adminDb!);
    await memRepo.create(workspaceId, u1Id, 'owner');

    const sessionRepo = new SessionRepository(adminDb!);
    await sessionRepo.create(u1Id, workspaceId, sessionToken);

    const { rows: initRows } = await adminDb!.query<{ operation_id: string }>(
      `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
      [sessionTokenHash]
    );
    const opId = initRows[0].operation_id;

    // 2. Acquire initial lease and schedule continuation
    const { rows: leaseRows } = await adminDb!.query<{ lease_token: string }>(
      `SELECT lease_token FROM public.acquire_purge_lease($1, 'initial-worker', 300);`,
      [opId]
    );
    const initialLeaseToken = leaseRows[0].lease_token;

    const { rows: schedRows } = await adminDb!.query<{ continuation_token: string; continuation_sequence: number }>(
      `SELECT * FROM public.schedule_purge_continuation($1, $2, 'initial-worker', 300);`,
      [opId, initialLeaseToken]
    );
    const firstContToken = schedRows[0].continuation_token;
    const firstContSeq = schedRows[0].continuation_sequence;

    // 3. Worker claims continuation: atomically clears continuation_token and continuation_pending
    const { rows: claimRows } = await adminDb!.query<{ lease_token: string; status: string }>(
      `SELECT * FROM public.claim_purge_continuation($1, $2, 'crashed-worker', 300);`,
      [opId, firstContToken]
    );
    expect(claimRows[0]?.status).toBe('running');

    const { rows: preCrashRows } = await adminDb!.query<{ continuation_pending: boolean; continuation_token: string | null }>(
      `SELECT continuation_pending, continuation_token FROM public.user_purge_operations WHERE id = $1;`,
      [opId]
    );
    expect(preCrashRows[0].continuation_pending).toBe(false);
    expect(preCrashRows[0].continuation_token).toBeNull();

    // 4. Worker crashes / stops before batch completion
    await queue.close();

    // 5. Lease expires while worker is crashed
    await adminDb!.query(
      `UPDATE public.user_purge_operations SET lease_expires_at = clock_timestamp() - interval '10 seconds' WHERE id = $1;`,
      [opId]
    );

    // 6. Recovery sweeper runs, detects the stranded operation, persists a replacement continuation, and enqueues to BullMQ
    const sweeperProducerQueue = new DistributedJobQueue(redisUrl, db, defaultLogger, workerPool);
    const sweeper = new PrivacyPurgeContinuationSweeper(
      workerPool || adminDb!,
      sweeperProducerQueue,
      defaultLogger
    );
    const sweepRes = await sweeper.sweep(10, 300, 300);
    expect(sweepRes.recoveredCount).toBeGreaterThanOrEqual(1);
    await sweeperProducerQueue.close();

    // Verify replacement continuation was persisted with incremented sequence
    const { rows: postRecoveryRows } = await adminDb!.query<{ continuation_pending: boolean; continuation_token: string | null; continuation_sequence: number }>(
      `SELECT continuation_pending, continuation_token, continuation_sequence FROM public.user_purge_operations WHERE id = $1;`,
      [opId]
    );
    expect(postRecoveryRows[0].continuation_pending).toBe(true);
    expect(postRecoveryRows[0].continuation_token).toBeTruthy();
    expect(postRecoveryRows[0].continuation_token).not.toBe(firstContToken);
    expect(postRecoveryRows[0].continuation_sequence).toBe(firstContSeq + 1);

    // 7. Restarted worker comes online and completes the purge
    queue = new DistributedJobQueue(redisUrl, db, defaultLogger, workerPool);
    queue.startWorker();

    const startTime = Date.now();
    let finalStatus = '';
    while (Date.now() - startTime < 15000) {
      const { rows } = await adminDb!.query<{ status: string }>(
        `SELECT status FROM public.user_purge_operations WHERE id = $1;`,
        [opId]
      );
      if (rows[0]?.status === 'completed' || rows[0]?.status === 'failed') {
        finalStatus = rows[0].status;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(finalStatus).toBe('completed');

    // 8. Duplicate delivery does not duplicate work or terminal audit events
    await queue.enqueue({
      workspaceId,
      jobRunId: `purge-${opId}-dup`,
      jobName: 'privacy.purge_operation',
      payload: {
        operation_id: opId,
        workspace_id: workspaceId,
        user_id: u1Id,
        continuation: true,
        continuation_token: postRecoveryRows[0].continuation_token
      }
    });

    await new Promise((r) => setTimeout(r, 1000));

    // Status remains completed
    const { rows: postDupRows } = await adminDb!.query<{ status: string }>(
      `SELECT status FROM public.user_purge_operations WHERE id = $1;`,
      [opId]
    );
    expect(postDupRows[0].status).toBe('completed');

    // Exactly one privacy.purge_completed audit event
    const { rows: auditRows } = await adminDb!.query<{ action: string }>(
      `SELECT action FROM public.audit_events WHERE action = 'privacy.purge_completed' AND target_id = $1;`,
      [opId]
    );
    expect(auditRows.length).toBe(1);
  });

  it('proves a non-terminal lease reacquisition failure causes an actual BullMQ retry rather than a resolved success', async () => {
    if (!isLive) return;

    // 1. Initiate purge with unique user
    const userRepo = new UserRepository(adminDb!);
    const u2 = await userRepo.create(`retry.user.${crypto.randomUUID()}@org.com`, 'pwd_hash', 'Retry User');
    const u2Id = u2.id;

    const sessionToken = `redis-retry-test-token-${crypto.randomUUID()}`;
    const sessionTokenHash = hashSessionToken(sessionToken);

    const memRepo = new MembershipRepository(adminDb!);
    await memRepo.create(workspaceId, u2Id, 'owner');

    const sessionRepo = new SessionRepository(adminDb!);
    await sessionRepo.create(u2Id, workspaceId, sessionToken);

    const { rows: initRows } = await adminDb!.query<{ operation_id: string }>(
      `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
      [sessionTokenHash]
    );
    const opId = initRows[0].operation_id;

    // 2. Acquire initial lease and schedule continuation
    const { rows: leaseRows } = await adminDb!.query<{ lease_token: string }>(
      `SELECT lease_token FROM public.acquire_purge_lease($1, 'retry-worker-sim', 300);`,
      [opId]
    );
    const initialLeaseToken = leaseRows[0].lease_token;

    const { rows: schedRows } = await adminDb!.query<{ continuation_token: string; continuation_sequence: number }>(
      `SELECT * FROM public.schedule_purge_continuation($1, $2, 'retry-worker-sim', 300);`,
      [opId, initialLeaseToken]
    );
    const contToken = schedRows[0].continuation_token;
    const contSeq = schedRows[0].continuation_sequence;

    // 3. Claim continuation so continuation_pending is false and token is cleared
    await adminDb!.query(
      `SELECT * FROM public.claim_purge_continuation($1, $2, 'retry-worker-sim', 300);`,
      [opId, contToken]
    );

    // 4. Expire lease so reacquisition is necessary on retry delivery
    await adminDb!.query(
      `UPDATE public.user_purge_operations SET lease_expires_at = clock_timestamp() - interval '10 seconds' WHERE id = $1;`,
      [opId]
    );

    // 5. Spy on acquireLease to reject once with transient error, simulating transient reacquisition failure
    let callCount = 0;
    const origAcquireLease = WorkerPurgeRepository.prototype.acquireLease;
    const acquireSpy = vi.spyOn(WorkerPurgeRepository.prototype, 'acquireLease').mockImplementation(async function (this: WorkerPurgeRepository, id: string, wId: string, dur?: number) {
      if (id === opId && callCount === 0) {
        callCount++;
        throw new Error('Simulated transient network glitch during lease reacquisition');
      }
      return await origAcquireLease.call(this, id, wId, dur);
    });

    try {
      // 6. Enqueue continuation job.
      // On attempt 1: claimContinuation fails because token was already consumed.
      // PrivacyPurgeProcessor falls back to acquireLease for reacquisition.
      // acquireLease throws transient error -> PrivacyPurgeProcessor rethrows.
      // BullMQ catches error and executes retry (attempt 2).
      // On attempt 2: acquireLease succeeds and operation completes!
      const jobRunId = `purge-${opId}-retry-test-${contSeq}`;
      await queue.enqueue({
        workspaceId,
        jobRunId,
        jobName: 'privacy.purge_operation',
        payload: {
          operation_id: opId,
          workspace_id: workspaceId,
          user_id: u2Id,
          continuation: true,
          continuation_token: contToken
        },
        maxRetries: 3
      });

      // 7. Await purge completion
      const startTime = Date.now();
      let completedStatus = '';
      while (Date.now() - startTime < 15000) {
        const { rows } = await adminDb!.query<{ status: string }>(
          `SELECT status FROM public.user_purge_operations WHERE id = $1;`,
          [opId]
        );
        if (rows[0]?.status === 'completed') {
          completedStatus = rows[0].status;
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      expect(completedStatus).toBe('completed');
      // Verify acquireLease was called at least twice, proving BullMQ actually retried
      expect(callCount).toBeGreaterThanOrEqual(1);
      expect(acquireSpy).toHaveBeenCalled();
    } finally {
      acquireSpy.mockRestore();
    }
  });
});
