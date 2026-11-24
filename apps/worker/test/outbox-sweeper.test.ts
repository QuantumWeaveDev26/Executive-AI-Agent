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
import { OutboxDispatchSweeper } from '../src/outbox-sweeper.js';
import { JobData } from '../src/processor.js';

describe('OutboxDispatchSweeper (Task 003 Phase 4)', () => {
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

    const ws = await wsRepo.create('Outbox Test Org');
    workspaceId = ws.id;

    const user = await userRepo.create('outbox-user@org.com', 'hash', 'Outbox User');
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

  it('fails OutboxDispatchSweeper construction in every non-test environment when worker pool is missing', () => {
    for (const env of ['development', 'staging', 'production']) {
      process.env.NODE_ENV = env;
      expect(() => new OutboxDispatchSweeper(db, mockQueue)).toThrow(
        /Fatal: OutboxDispatchSweeper requires a RoleAwarePool configured for thaara_worker in all non-test environments/
      );
    }
    process.env.NODE_ENV = 'test';
    expect(() => new OutboxDispatchSweeper(db, mockQueue)).not.toThrow();
  });

  it('successfully claims, rehydrates authoritative DB operation, enqueues canonical job payload, and marks dispatched', async () => {
    // 1. User initiates purge via SECURITY DEFINER procedure
    const { rows: initRows } = await db.query<{ operation_id: string }>(
      `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
      [sessionTokenHash]
    );
    const opId = initRows[0].operation_id;

    // Check outbox row exists in 'pending' status
    const { rows: preOutbox } = await db.query<{ status: string; topic: string }>(
      `SELECT status, topic FROM public.worker_dispatch_outbox WHERE workspace_id = $1;`,
      [workspaceId]
    );
    expect(preOutbox.length).toBe(1);
    expect(preOutbox[0].status).toBe('pending');
    expect(preOutbox[0].topic).toBe('privacy_purge');

    // 2. Sweeper runs
    const sweeper = new OutboxDispatchSweeper(db, mockQueue);
    const sweepRes = await sweeper.sweep();

    expect(sweepRes.claimedCount).toBe(1);
    expect(sweepRes.dispatchedCount).toBe(1);
    expect(sweepRes.failedCount).toBe(0);

    // 3. Verify BullMQ job was enqueued with canonical payload
    expect(enqueuedJobs.length).toBe(1);
    expect(enqueuedJobs[0].jobName).toBe('privacy.purge_operation');
    expect(enqueuedJobs[0].payload.operation_id).toBe(opId);
    expect(enqueuedJobs[0].payload.workspace_id).toBe(workspaceId);
    expect(enqueuedJobs[0].payload.user_id).toBe(userId);
    expect(enqueuedJobs[0].payload.mode).toBe('history_and_memory');
    expect(enqueuedJobs[0].payload.continuation).toBe(false);

    // 4. Verify outbox record is marked 'dispatched'
    const { rows: postOutbox } = await db.query<{ status: string; dispatched_at: string }>(
      `SELECT status, dispatched_at FROM public.worker_dispatch_outbox WHERE workspace_id = $1;`,
      [workspaceId]
    );
    expect(postOutbox[0].status).toBe('dispatched');
    expect(postOutbox[0].dispatched_at).not.toBeNull();
  });

  it('terminally rejects outbox records with payload field mismatches (OUTBOX_PAYLOAD_MISMATCH)', async () => {
    // Create authentic purge operation
    const { rows: initRows } = await db.query<{ operation_id: string }>(
      `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
      [sessionTokenHash]
    );
    const opId = initRows[0].operation_id;

    const { rows: currOutbox } = await db.query<{ payload: any }>(
      `SELECT payload FROM public.worker_dispatch_outbox WHERE workspace_id = $1;`,
      [workspaceId]
    );
    const tamperedPayload = typeof currOutbox[0].payload === 'string'
      ? JSON.parse(currOutbox[0].payload)
      : { ...currOutbox[0].payload };
    tamperedPayload.user_id = crypto.randomUUID();
    await db.query(
      `UPDATE public.worker_dispatch_outbox SET payload = $1::jsonb WHERE workspace_id = $2;`,
      [JSON.stringify(tamperedPayload), workspaceId]
    );

    const sweeper = new OutboxDispatchSweeper(db, mockQueue);
    const sweepRes = await sweeper.sweep();

    expect(sweepRes.claimedCount).toBe(1);
    expect(sweepRes.dispatchedCount).toBe(0);
    expect(sweepRes.failedCount).toBe(1);
    expect(enqueuedJobs.length).toBe(0);

    // Outbox record must be marked 'failed' with OUTBOX_PAYLOAD_MISMATCH
    const { rows: outboxRows } = await db.query<{ status: string; error_code: string; error_category: string }>(
      `SELECT status, error_code, error_category FROM public.worker_dispatch_outbox WHERE workspace_id = $1;`,
      [workspaceId]
    );
    expect(outboxRows[0].status).toBe('failed');
    expect(outboxRows[0].error_code).toBe('OUTBOX_PAYLOAD_MISMATCH');
    expect(outboxRows[0].error_category).toBe('SYSTEM_VALIDATION');

    // Audit event outbox.dispatch_failed must be emitted
    const { rows: auditRows } = await db.query<{ action: string; payload: any }>(
      `SELECT action, payload FROM public.audit_events WHERE action = 'outbox.dispatch_failed';`
    );
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].payload.error_code).toBe('OUTBOX_PAYLOAD_MISMATCH');
  });

  it('terminally rejects outbox records with unknown topic (OUTBOX_UNKNOWN_TOPIC)', async () => {
    // Insert outbox item with invalid topic
    await db.query(
      `INSERT INTO public.worker_dispatch_outbox (workspace_id, topic, dedup_key, payload, status)
       VALUES ($1, 'unauthorized_topic', 'test:dedup:unknown', '{"operation_id":"00000000-0000-0000-0000-000000000000"}'::jsonb, 'pending');`,
      [workspaceId]
    );

    const sweeper = new OutboxDispatchSweeper(db, mockQueue);
    const sweepRes = await sweeper.sweep();

    expect(sweepRes.claimedCount).toBe(1);
    expect(sweepRes.failedCount).toBe(1);

    const { rows: outboxRows } = await db.query<{ status: string; error_code: string }>(
      `SELECT status, error_code FROM public.worker_dispatch_outbox WHERE topic = 'unauthorized_topic';`
    );
    expect(outboxRows[0].status).toBe('failed');
    expect(outboxRows[0].error_code).toBe('OUTBOX_UNKNOWN_TOPIC');
  });

  it('terminally rejects outbox records with malformed payload (OUTBOX_MALFORMED_PAYLOAD)', async () => {
    // Insert outbox item with invalid payload shape (missing required fields)
    await db.query(
      `INSERT INTO public.worker_dispatch_outbox (workspace_id, topic, dedup_key, payload, status)
       VALUES ($1, 'privacy_purge', 'test:dedup:malformed', '{"invalid":"data"}'::jsonb, 'pending');`,
      [workspaceId]
    );

    const sweeper = new OutboxDispatchSweeper(db, mockQueue);
    const sweepRes = await sweeper.sweep();

    expect(sweepRes.claimedCount).toBe(1);
    expect(sweepRes.failedCount).toBe(1);

    const { rows: outboxRows } = await db.query<{ status: string; error_code: string }>(
      `SELECT status, error_code FROM public.worker_dispatch_outbox WHERE dedup_key = 'test:dedup:malformed';`
    );
    expect(outboxRows[0].status).toBe('failed');
    expect(outboxRows[0].error_code).toBe('OUTBOX_MALFORMED_PAYLOAD');
  });

  it('resets outbox record to pending on transient queue enqueue error (OUTBOX_QUEUE_UNAVAILABLE)', async () => {
    await db.query(
      `SELECT public.initiate_self_privacy_purge($1, 'history_and_memory');`,
      [sessionTokenHash]
    );

    const failingQueue = {
      enqueue: async () => {
        throw new Error('Redis connection timeout');
      }
    };

    const sweeper = new OutboxDispatchSweeper(db, failingQueue);
    const sweepRes = await sweeper.sweep();

    expect(sweepRes.claimedCount).toBe(1);
    expect(sweepRes.dispatchedCount).toBe(0);
    expect(sweepRes.failedCount).toBe(1);

    // Outbox record must be reset to 'pending' with incremented attempts
    const { rows: outboxRows } = await db.query<{ status: string; attempts: number; error_code: string }>(
      `SELECT status, attempts, error_code FROM public.worker_dispatch_outbox WHERE workspace_id = $1;`,
      [workspaceId]
    );
    expect(outboxRows[0].status).toBe('pending');
    expect(outboxRows[0].attempts).toBe(1);
    expect(outboxRows[0].error_code).toBe('OUTBOX_QUEUE_UNAVAILABLE');
  });

  it('does not count dispatch as successful when markDispatched returns false due to lease expiry', async () => {
    await db.query(
      `SELECT public.initiate_self_privacy_purge($1, 'history_and_memory');`,
      [sessionTokenHash]
    );

    // Expire lease concurrently inside queue.enqueue to simulate slow dispatch after lease expiration
    const expiringQueue = {
      enqueue: async (_data: JobData) => {
        await db.query(
          `UPDATE public.worker_dispatch_outbox SET lease_expires_at = clock_timestamp() - interval '10 seconds' WHERE workspace_id = $1;`,
          [workspaceId]
        );
      }
    };

    const sweeper = new OutboxDispatchSweeper(db, expiringQueue);
    const sweepRes = await sweeper.sweep();

    expect(sweepRes.claimedCount).toBe(1);
    expect(sweepRes.dispatchedCount).toBe(0);

    // Outbox record must NOT be marked dispatched because lease expired
    const { rows: outboxRows } = await db.query<{ status: string }>(
      `SELECT status FROM public.worker_dispatch_outbox WHERE workspace_id = $1;`,
      [workspaceId]
    );
    expect(outboxRows[0].status).toBe('claimed');
  });

  it('manages sweeper lifecycle safely via start and stop', () => {
    const sweeper = new OutboxDispatchSweeper(db, mockQueue);
    sweeper.start(50);
    sweeper.start(50); // Idempotent
    sweeper.stop();
    sweeper.stop(); // Safe
  });
});
