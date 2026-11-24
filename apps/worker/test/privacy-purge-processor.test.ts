import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PGliteDatabase,
  Migrator,
  WorkspaceRepository,
  UserRepository,
  MembershipRepository,
  SessionRepository,
  hashSessionToken,
  generateSessionToken
} from '@thaara/db';
import { PrivacyPurgeProcessor } from '../src/privacy-purge-processor.js';
import { PrivacyPurgeContinuationSweeper } from '../src/continuation-sweeper.js';
import { JobData } from '../src/processor.js';

describe('PrivacyPurgeProcessor & ContinuationSweeper (Task 003 Phase 4)', () => {
  let db: PGliteDatabase;
  let workspaceId: string;
  let userId: string;
  let sessionToken: string;
  let sessionTokenHash: string;
  let enqueuedJobs: JobData[];
  let mockQueue: { enqueue: (data: JobData) => Promise<void> };
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    enqueuedJobs = [];
    mockQueue = {
      enqueue: async (data: JobData) => {
        enqueuedJobs.push(data);
      }
    };

    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());

    const wsRepo = new WorkspaceRepository(db);
    const userRepo = new UserRepository(db);

    const ws = await wsRepo.create('Purge Test Org');
    workspaceId = ws.id;

    const user = await userRepo.create('purge-user@org.com', 'hash', 'Purge User');
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
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('fails PrivacyPurgeProcessor and PrivacyPurgeContinuationSweeper construction in non-test env without RoleAwarePool', () => {
    process.env.NODE_ENV = 'production';

    expect(() => {
      new PrivacyPurgeProcessor(db as any, mockQueue);
    }).toThrow(/RoleAwarePool configured for thaara_worker/);

    expect(() => {
      new PrivacyPurgeContinuationSweeper(db as any, mockQueue);
    }).toThrow(/RoleAwarePool configured for thaara_worker/);
  });

  it('processes small purge within single delivery to completion', async () => {
    // Initiate purge
    const { rows: initRows } = await db.query<{ operation_id: string }>(
      `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
      [sessionTokenHash]
    );
    const opId = initRows[0].operation_id;

    const processor = new PrivacyPurgeProcessor(db, mockQueue);
    const res = await processor.processPurge({
      workspaceId,
      jobRunId: `purge:${opId}`,
      jobName: 'privacy.purge_operation',
      payload: { operation_id: opId }
    });

    expect(res.success).toBe(true);
    expect(res.result?.status).toBe('completed');

    const { rows: opRows } = await db.query<{ status: string; continuation_pending: boolean }>(
      `SELECT status, continuation_pending FROM public.user_purge_operations WHERE id = $1;`,
      [opId]
    );
    expect(opRows[0].status).toBe('completed');
    expect(opRows[0].continuation_pending).toBe(false);

    // Audit event privacy.purge_completed must be recorded
    const { rows: auditRows } = await db.query<{ action: string }>(
      `SELECT action FROM public.audit_events WHERE action = 'privacy.purge_completed';`
    );
    expect(auditRows.length).toBe(1);
  });

  it('bounds execution and schedules durable continuation when batch budget is exhausted', async () => {
    // Initiate purge
    const { rows: initRows } = await db.query<{ operation_id: string }>(
      `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
      [sessionTokenHash]
    );
    const opId = initRows[0].operation_id;

    // Set maxBatchesPerDelivery = 0 to immediately trigger continuation
    const processor = new PrivacyPurgeProcessor(db, mockQueue, undefined, {
      maxBatchesPerDelivery: 0
    });

    const res = await processor.processPurge({
      workspaceId,
      jobRunId: `purge:${opId}`,
      jobName: 'privacy.purge_operation',
      payload: { operation_id: opId }
    });

    expect(res.success).toBe(true);
    expect(res.result?.continuationScheduled).toBe(true);
    expect(res.result?.continuationSequence).toBe(1);

    // Operation must remain 'running' with continuation_pending = true
    const { rows: opRows } = await db.query<{
      status: string;
      continuation_pending: boolean;
      continuation_sequence: number;
      continuation_token: string;
      lease_token: string;
      lease_worker_id: string;
    }>(
      `SELECT status, continuation_pending, continuation_sequence, continuation_token, lease_token, lease_worker_id FROM public.user_purge_operations WHERE id = $1;`,
      [opId]
    );
    expect(opRows[0].status).toBe('running');
    expect(opRows[0].continuation_pending).toBe(true);
    expect(opRows[0].continuation_sequence).toBe(1);
    expect(opRows[0].continuation_token).toBeTruthy();

    // Completion barrier: complete_purge_operation must fail while continuation_pending = true
    await expect(
      db.query(`SELECT public.complete_purge_operation($1, $2, $3);`, [
        opId,
        opRows[0].lease_token,
        opRows[0].lease_worker_id
      ])
    ).rejects.toThrow(/continuation is currently pending/);

    // Continuation job must have been enqueued
    expect(enqueuedJobs.length).toBe(1);
    expect(enqueuedJobs[0].jobRunId).toBe(`purge:${opId}:seq:1`);
    expect(enqueuedJobs[0].payload).toMatchObject({
      operation_id: opId,
      continuation: true,
      continuation_token: opRows[0].continuation_token
    });
  });

  it('handles duplicate delivery of already-claimed continuation idempotently', async () => {
    // Initiate purge
    const { rows: initRows } = await db.query<{ operation_id: string }>(
      `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
      [sessionTokenHash]
    );
    const opId = initRows[0].operation_id;

    // Force continuation
    const processor = new PrivacyPurgeProcessor(db, mockQueue, undefined, {
      maxBatchesPerDelivery: 0
    });
    await processor.processPurge({
      workspaceId,
      jobRunId: `purge:${opId}`,
      jobName: 'privacy.purge_operation',
      payload: { operation_id: opId }
    });

    const contJob = enqueuedJobs[0];

    // Create a regular processor that will complete it
    const regularProcessor = new PrivacyPurgeProcessor(db, mockQueue);
    const firstRun = await regularProcessor.processPurge(contJob);
    expect(firstRun.success).toBe(true);

    // Second run with identical continuation job payload (duplicate BullMQ delivery)
    const secondRun = await regularProcessor.processPurge(contJob);
    expect(secondRun.success).toBe(true);
    expect(secondRun.result?.duplicate ?? secondRun.result?.already_terminal).toBeTruthy();
  });

  it('enforces terminal failure on continuation attempt exhaustion (max_attempts = 3) and emits single privacy.purge_failed audit event', async () => {
    // Initiate purge
    const { rows: initRows } = await db.query<{ operation_id: string }>(
      `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
      [sessionTokenHash]
    );
    const opId = initRows[0].operation_id;

    // Force continuation sequence 1
    const boundedProcessor = new PrivacyPurgeProcessor(db, mockQueue, undefined, {
      maxBatchesPerDelivery: 0
    });
    await boundedProcessor.processPurge({
      workspaceId,
      jobRunId: `purge:${opId}`,
      jobName: 'privacy.purge_operation',
      payload: { operation_id: opId }
    });

    const { rows: contRows } = await db.query<{ continuation_token: string }>(
      `SELECT continuation_token FROM public.user_purge_operations WHERE id = $1;`,
      [opId]
    );
    const contToken = contRows[0].continuation_token;

    // Artificially set attempts to max_attempts so next attempt hits exhaustion
    await db.query(
      `UPDATE public.user_purge_operations SET attempts = max_attempts WHERE id = $1;`,
      [opId]
    );

    // Process continuation job
    const processor = new PrivacyPurgeProcessor(db, mockQueue);
    const res = await processor.processPurge({
      workspaceId,
      jobRunId: `purge:${opId}:seq:1`,
      jobName: 'privacy.purge_operation',
      payload: {
        operation_id: opId,
        continuation: true,
        continuation_token: contToken
      }
    });

    expect(res.success).toBe(false);

    // Operation must be failed
    const { rows: opRows } = await db.query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM public.user_purge_operations WHERE id = $1;`,
      [opId]
    );
    expect(opRows[0].status).toBe('failed');
    expect(opRows[0].attempts).toBe(5);

    // Exactly one privacy.purge_failed audit event must be emitted
    const { rows: auditRows } = await db.query<{ action: string; payload: any }>(
      `SELECT action, payload FROM public.audit_events WHERE action = 'privacy.purge_failed';`
    );
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].payload.error_code).toBe('PURGE_MAX_ATTEMPTS_EXCEEDED');
  });

  it('recovers stranded continuation via PrivacyPurgeContinuationSweeper after crash and lease expiry', async () => {
    // Initiate purge
    const { rows: initRows } = await db.query<{ operation_id: string }>(
      `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
      [sessionTokenHash]
    );
    const opId = initRows[0].operation_id;

    // Simulate crash after schedule_purge_continuation before enqueue
    // Acquire lease and schedule continuation
    const { rows: leaseRows } = await db.query<{ lease_token: string }>(
      `SELECT lease_token FROM public.acquire_purge_lease($1, 'worker-1', 1);`,
      [opId]
    );
    const leaseToken = leaseRows[0].lease_token;

    await db.query(
      `SELECT * FROM public.schedule_purge_continuation($1, $2, 'worker-1');`,
      [opId, leaseToken]
    );

    // Operation is 'running' with continuation_pending = true
    // Fast-forward lease expiry into the past
    await db.query(
      `UPDATE public.user_purge_operations SET lease_expires_at = clock_timestamp() - interval '10 seconds' WHERE id = $1;`,
      [opId]
    );

    // Now run PrivacyPurgeContinuationSweeper
    const sweeper = new PrivacyPurgeContinuationSweeper(db, mockQueue);
    const sweepRes = await sweeper.sweep();

    expect(sweepRes.recoveredCount).toBe(1);
    expect(enqueuedJobs.length).toBe(1);
    expect(enqueuedJobs[0].jobRunId).toBe(`purge:${opId}:seq:1`);
    expect(enqueuedJobs[0].payload).toMatchObject({
      operation_id: opId,
      continuation: true
    });
  });

  it('blocks account closure purge when user is the sole owner in workspace and records PURGE_LAST_OWNER_BLOCKED', async () => {
    // Initiate account closure purge (user is sole owner of workspace)
    const { rows: initRows } = await db.query<{ operation_id: string }>(
      `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'account_closure');`,
      [sessionTokenHash]
    );
    const opId = initRows[0].operation_id;

    const processor = new PrivacyPurgeProcessor(db, mockQueue);
    const res = await processor.processPurge({
      workspaceId,
      jobRunId: `purge:${opId}`,
      jobName: 'privacy.purge_operation',
      payload: { operation_id: opId }
    });

    expect(res.success).toBe(false);
    expect(res.result?.errorCode).toBe('PURGE_LAST_OWNER_BLOCKED');

    // Operation marked failed
    const { rows: opRows } = await db.query<{ status: string }>(
      `SELECT status FROM public.user_purge_operations WHERE id = $1;`,
      [opId]
    );
    expect(opRows[0].status).toBe('failed');

    // Audit event privacy.purge_failed emitted with PURGE_LAST_OWNER_BLOCKED
    const { rows: auditRows } = await db.query<{ action: string; payload: any }>(
      `SELECT action, payload FROM public.audit_events WHERE action = 'privacy.purge_failed';`
    );
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].payload.error_code).toBe('PURGE_LAST_OWNER_BLOCKED');
  });

  it('completes account closure when user is not the sole owner (removes membership and revokes sessions)', async () => {
    // Add a second owner to the workspace so userId is not the sole owner
    const userRepo = new UserRepository(db);
    const secondUser = await userRepo.create('owner2@org.com', 'hash', 'Owner 2');
    await db.query(
      `INSERT INTO public.memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner');`,
      [workspaceId, secondUser.id]
    );

    // Initiate account closure purge
    const { rows: initRows } = await db.query<{ operation_id: string }>(
      `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'account_closure');`,
      [sessionTokenHash]
    );
    const opId = initRows[0].operation_id;

    const processor = new PrivacyPurgeProcessor(db, mockQueue);
    const res = await processor.processPurge({
      workspaceId,
      jobRunId: `purge:${opId}`,
      jobName: 'privacy.purge_operation',
      payload: { operation_id: opId }
    });

    expect(res.success).toBe(true);
    expect(res.result?.status).toBe('completed');

    // Membership for userId must be deleted
    const { rows: memRows } = await db.query(
      `SELECT * FROM public.memberships WHERE workspace_id = $1 AND user_id = $2;`,
      [workspaceId, userId]
    );
    expect(memRows.length).toBe(0);

    // Second owner's membership must remain intact
    const { rows: owner2Rows } = await db.query(
      `SELECT * FROM public.memberships WHERE workspace_id = $1 AND user_id = $2;`,
      [workspaceId, secondUser.id]
    );
    expect(owner2Rows.length).toBe(1);
  });

  it('recovers operation after crash following claim_purge_continuation (continuation_pending = false)', async () => {
    // Initiate purge
    const { rows: initRows } = await db.query<{ operation_id: string }>(
      `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
      [sessionTokenHash]
    );
    const opId = initRows[0].operation_id;

    // Acquire initial lease and schedule continuation
    const { rows: leaseRows } = await db.query<{ lease_token: string }>(
      `SELECT lease_token FROM public.acquire_purge_lease($1, 'worker-1', 60);`,
      [opId]
    );
    const leaseToken = leaseRows[0].lease_token;

    const { rows: schedRows } = await db.query<{ continuation_token: string }>(
      `SELECT * FROM public.schedule_purge_continuation($1, $2, 'worker-1');`,
      [opId, leaseToken]
    );
    const contToken = schedRows[0].continuation_token;

    // Worker claims continuation -> continuation_pending becomes FALSE, continuation_token becomes NULL
    const { rows: claimRows } = await db.query<{ lease_token: string }>(
      `SELECT * FROM public.claim_purge_continuation($1, $2, 'worker-claimed-then-crashed', 60);`,
      [opId, contToken]
    );
    expect(claimRows[0].lease_token).toBeTruthy();

    const { rows: postClaimRows } = await db.query<{ continuation_pending: boolean; status: string }>(
      `SELECT continuation_pending, status FROM public.user_purge_operations WHERE id = $1;`,
      [opId]
    );
    expect(postClaimRows[0].status).toBe('running');
    expect(postClaimRows[0].continuation_pending).toBe(false);

    // Simulate worker crash by expiring lease into the past
    await db.query(
      `UPDATE public.user_purge_operations SET lease_expires_at = clock_timestamp() - interval '10 seconds' WHERE id = $1;`,
      [opId]
    );

    // Sweeper must recover this running operation even though continuation_pending is false
    const sweeper = new PrivacyPurgeContinuationSweeper(db, mockQueue);
    const sweepRes = await sweeper.sweep();

    expect(sweepRes.recoveredCount).toBe(1);
    expect(enqueuedJobs.length).toBe(1);
    expect(enqueuedJobs[0].jobRunId).toMatch(new RegExp(`^purge:${opId}:seq:`));
    expect(enqueuedJobs[0].payload).toMatchObject({
      operation_id: opId,
      continuation: true
    });

    // Verify DB state: fresh continuation identity persisted and marked pending
    const { rows: recoveredRows } = await db.query<{ continuation_pending: boolean; continuation_token: string }>(
      `SELECT continuation_pending, continuation_token FROM public.user_purge_operations WHERE id = $1;`,
      [opId]
    );
    expect(recoveredRows[0].continuation_pending).toBe(true);
    expect(recoveredRows[0].continuation_token).toBeTruthy();
  });

  it('safely reacquires lease on continuation job retry after non-terminal failure without silently returning success', async () => {
    // Initiate purge
    const { rows: initRows } = await db.query<{ operation_id: string }>(
      `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
      [sessionTokenHash]
    );
    const opId = initRows[0].operation_id;

    // Acquire lease and schedule continuation
    const { rows: leaseRows } = await db.query<{ lease_token: string }>(
      `SELECT lease_token FROM public.acquire_purge_lease($1, 'worker-1', 60);`,
      [opId]
    );
    const leaseToken = leaseRows[0].lease_token;

    const { rows: schedRows } = await db.query<{ continuation_token: string }>(
      `SELECT * FROM public.schedule_purge_continuation($1, $2, 'worker-1');`,
      [opId, leaseToken]
    );
    const contToken = schedRows[0].continuation_token;

    // Worker claims continuation
    const { rows: claimRows } = await db.query<{ lease_token: string }>(
      `SELECT * FROM public.claim_purge_continuation($1, $2, 'worker-1', 60);`,
      [opId, contToken]
    );
    const claimedLeaseToken = claimRows[0].lease_token;

    // Worker experiences non-terminal checkpoint failure
    await db.query(
      `SELECT public.fail_purge_operation($1, $2, 'worker-1', 'CHECKPOINT_FAILED', 'DB_ERROR', false);`,
      [opId, claimedLeaseToken]
    );

    const { rows: failedRows } = await db.query<{ status: string }>(
      `SELECT status FROM public.user_purge_operations WHERE id = $1;`,
      [opId]
    );
    expect(failedRows[0].status).toBe('pending');

    // Retried delivery arrives with consumed continuation token
    const processor = new PrivacyPurgeProcessor(db, mockQueue);
    const retryRes = await processor.processPurge({
      workspaceId,
      jobRunId: `purge:${opId}:cont:retry`,
      jobName: 'privacy.purge_operation',
      payload: {
        operation_id: opId,
        continuation: true,
        continuation_token: contToken
      }
    });

    // Must successfully process work by reacquiring lease rather than silently returning duplicate success
    expect(retryRes.success).toBe(true);
    expect(retryRes.result?.duplicate).toBeFalsy();
    expect(retryRes.result?.status).toBe('completed');
  });

  it('recovers pending operation with no active dispatch record via sweeper', async () => {
    // Initiate purge
    const { rows: initRows } = await db.query<{ operation_id: string }>(
      `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
      [sessionTokenHash]
    );
    const opId = initRows[0].operation_id;

    // Simulate outbox record already dispatched/cleared beyond the grace period
    await db.query(
      `UPDATE public.worker_dispatch_outbox
       SET status = 'dispatched',
           dispatched_at = clock_timestamp() - interval '400 seconds',
           updated_at = clock_timestamp() - interval '400 seconds'
       WHERE workspace_id = $1;`,
      [workspaceId]
    );

    // Sweeper must detect pending operation without active dispatch and recover it
    const sweeper = new PrivacyPurgeContinuationSweeper(db, mockQueue);
    const sweepRes = await sweeper.sweep(10, 300, 300);

    expect(sweepRes.recoveredCount).toBe(1);
    expect(enqueuedJobs.length).toBe(1);
    expect(enqueuedJobs[0].payload).toMatchObject({
      operation_id: opId,
      continuation: true
    });
  });

  it('does not recover pending operation if outbox row was dispatched within grace period', async () => {
    // Initiate purge
    const { rows: initRows } = await db.query<{ operation_id: string }>(
      `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
      [sessionTokenHash]
    );
    const opId = initRows[0].operation_id;

    // Mark outbox record freshly dispatched (within 300s grace period)
    await db.query(
      `UPDATE public.worker_dispatch_outbox
       SET status = 'dispatched',
           dispatched_at = clock_timestamp(),
           updated_at = clock_timestamp()
       WHERE workspace_id = $1;`,
      [workspaceId]
    );

    const sweeper = new PrivacyPurgeContinuationSweeper(db, mockQueue);
    const sweepRes = await sweeper.sweep(10, 300, 300);

    // Must NOT recover since the BullMQ dispatch is still within the active grace interval
    expect(sweepRes.recoveredCount).toBe(0);

    const { rows: opRows } = await db.query<{ status: string }>(
      `SELECT status FROM public.user_purge_operations WHERE id = $1;`,
      [opId]
    );
    expect(opRows[0].status).toBe('pending');
  });

  it('does not crash recovery sweep when outbox contains malformed non-UUID operation_id in JSON payload', async () => {
    // Insert malformed outbox row with non-UUID operation_id
    await db.query(
      `INSERT INTO public.worker_dispatch_outbox (
         id, workspace_id, topic, dedup_key, payload, status, created_at, updated_at
       ) VALUES (
         gen_random_uuid(), $1, 'privacy_purge', 'purge:corrupt-payload',
         '{"operation_id": "malformed-not-uuid", "corrupted": true}'::jsonb,
         'pending', clock_timestamp(), clock_timestamp()
       );`,
      [workspaceId]
    );

    const sweeper = new PrivacyPurgeContinuationSweeper(db, mockQueue);
    // Sweeper must execute safely without database cast exception
    await expect(sweeper.sweep(10, 300, 300)).resolves.toBeDefined();
  });

  it('throws on non-terminal lease reacquisition failure so BullMQ retries', async () => {
    // Initiate purge
    const { rows: initRows } = await db.query<{ operation_id: string }>(
      `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
      [sessionTokenHash]
    );
    const opId = initRows[0].operation_id;

    // Acquire lease and schedule continuation
    const { rows: leaseRows } = await db.query<{ lease_token: string }>(
      `SELECT lease_token FROM public.acquire_purge_lease($1, 'worker-throw-test', 60);`,
      [opId]
    );
    const leaseToken = leaseRows[0].lease_token;

    const { rows: schedRows } = await db.query<{ continuation_token: string }>(
      `SELECT * FROM public.schedule_purge_continuation($1, $2, 'worker-throw-test');`,
      [opId, leaseToken]
    );
    const contToken = schedRows[0].continuation_token;

    // Consume the token via claim
    await db.query(
      `SELECT * FROM public.claim_purge_continuation($1, $2, 'worker-throw-test', 60);`,
      [opId, contToken]
    );

    // Expire lease
    await db.query(
      `UPDATE public.user_purge_operations SET lease_expires_at = clock_timestamp() - interval '10 seconds' WHERE id = $1;`,
      [opId]
    );

    // Mock acquireLease on repository to return null (simulating failure to acquire)
    const processor = new PrivacyPurgeProcessor(db, mockQueue, undefined, { workerId: 'worker-throw-test' });
    const repo = (processor as any).purgeRepo;
    vi.spyOn(repo, 'acquireLease').mockResolvedValueOnce(null);

    // Processor must throw so BullMQ handles retry
    await expect(
      processor.processPurge({
        workspaceId,
        jobRunId: `purge:${opId}:cont:retry`,
        jobName: 'privacy.purge_operation',
        payload: {
          operation_id: opId,
          continuation: true,
          continuation_token: contToken
        }
      })
    ).rejects.toThrow(/Non-terminal lease reacquisition failed/);
  });

  it('proves concurrent recovery sweepers produce only one effective recovery', async () => {
    // Initiate purge and leave it stranded
    const { rows: initRows } = await db.query<{ operation_id: string }>(
      `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
      [sessionTokenHash]
    );
    const opId = initRows[0].operation_id;

    await db.query(
      `UPDATE public.worker_dispatch_outbox
       SET status = 'dispatched',
           dispatched_at = clock_timestamp() - interval '400 seconds',
           updated_at = clock_timestamp() - interval '400 seconds'
       WHERE workspace_id = $1;`,
      [workspaceId]
    );

    const sweeper1 = new PrivacyPurgeContinuationSweeper(db, mockQueue, undefined, { workerId: 'sweeper-1' });
    const sweeper2 = new PrivacyPurgeContinuationSweeper(db, mockQueue, undefined, { workerId: 'sweeper-2' });

    // Run sweep concurrently
    const [res1, res2] = await Promise.all([sweeper1.sweep(10, 300, 300), sweeper2.sweep(10, 300, 300)]);
    const totalRecovered = res1.recoveredCount + res2.recoveredCount;

    expect(totalRecovered).toBe(1);
    expect(enqueuedJobs.length).toBe(1);
  });

  it('emits exactly one privacy.purge_failed audit event when recovery sweeper exhausts max_attempts', async () => {
    // Initiate purge
    const { rows: initRows } = await db.query<{ operation_id: string }>(
      `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
      [sessionTokenHash]
    );
    const opId = initRows[0].operation_id;

    // Acquire lease and expire it with attempts = max_attempts
    await db.query(
      `UPDATE public.user_purge_operations
       SET status = 'running',
           attempts = max_attempts,
           lease_expires_at = clock_timestamp() - interval '10 seconds'
       WHERE id = $1;`,
      [opId]
    );

    const sweeper = new PrivacyPurgeContinuationSweeper(db, mockQueue);
    const sweepRes = await sweeper.sweep();

    // No job enqueued because operation failed terminally
    expect(sweepRes.recoveredCount).toBe(0);
    expect(enqueuedJobs.length).toBe(0);

    // Verify operation is failed
    const { rows: opRows } = await db.query<{ status: string; error_code: string }>(
      `SELECT status, error_code FROM public.user_purge_operations WHERE id = $1;`,
      [opId]
    );
    expect(opRows[0].status).toBe('failed');
    expect(opRows[0].error_code).toBe('PURGE_MAX_ATTEMPTS_EXCEEDED');

    // Verify exactly one audit event emitted
    const { rows: auditRows } = await db.query<{ action: string }>(
      `SELECT action FROM public.audit_events WHERE action = 'privacy.purge_failed' AND target_id = $1;`,
      [opId]
    );
    expect(auditRows.length).toBe(1);
  });
});
