import { describe, it, expect, beforeEach } from 'vitest';
import {
  PGliteDatabase,
  Migrator,
  WorkspaceRepository,
  JobRunRepository,
  AuditEventRepository,
  hashSessionToken,
  AuthenticatedScope
} from '@thaara/db';
import { JobProcessor } from '../src/processor.js';

describe('Worker Lifecycle, Idempotency, and Failure Truthfulness', () => {
  let db: PGliteDatabase;
  let workspaceId: string;
  let processor: JobProcessor;
  let fakeScope: AuthenticatedScope;

  beforeEach(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());

    const wsRepo = new WorkspaceRepository(db);
    const ws = await wsRepo.create('Worker Test Org');
    workspaceId = ws.id;

    processor = new JobProcessor(db);
    fakeScope = {
      workspaceId,
      userId: '00000000-0000-0000-0000-000000000000',
      role: 'owner' as const,
      sessionTokenHash: hashSessionToken('worker-test-token')
    };
  });

  it('processes a standard job to completion and writes an audit record', async () => {

    const jobRun = await db.withScopedTransaction(fakeScope, async (txClient) => {
      const jobRepo = new JobRunRepository(txClient);
      return await jobRepo.create(workspaceId, 'test.sample_task', { count: 42 });
    });

    const result = await processor.process({
      workspaceId,
      jobRunId: jobRun.id,
      jobName: jobRun.job_name,
      payload: jobRun.payload
    });

    expect(result.success).toBe(true);

    // Verify DB state
    await db.withScopedTransaction(fakeScope, async (txClient) => {
      const jobRepo = new JobRunRepository(txClient);
      const auditRepo = new AuditEventRepository(txClient);

      const updated = await jobRepo.findById(workspaceId, jobRun.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.completed_at).not.toBeNull();

      const audit = await auditRepo.listByWorkspace(workspaceId);
      const completionEvt = audit.events.find((e) => e.action === 'job.completed');
      expect(completionEvt).toBeDefined();
    });
  });

  it('retries on transient failure and updates retries count', async () => {
    const jobRun = await db.withScopedTransaction(fakeScope, async (txClient) => {
      const jobRepo = new JobRunRepository(txClient);
      return await jobRepo.create(workspaceId, 'test.transient_failure', {});
    });

    // Attempt 1: throws transient error
    await expect(
      processor.process(
        {
          workspaceId,
          jobRunId: jobRun.id,
          jobName: jobRun.job_name,
          payload: jobRun.payload,
          maxRetries: 3
        },
        1
      )
    ).rejects.toThrow(/Deterministic transient failure/);

    // Verify retries incremented in DB
    await db.withScopedTransaction(fakeScope, async (txClient) => {
      const jobRepo = new JobRunRepository(txClient);
      const updated = await jobRepo.findById(workspaceId, jobRun.id);
      expect(updated?.retries_count).toBe(1);
      expect(updated?.status).toBe('retrying');
    });

    // Attempt 2: succeeds
    const recovery = await processor.process(
      {
        workspaceId,
        jobRunId: jobRun.id,
        jobName: jobRun.job_name,
        payload: jobRun.payload,
        maxRetries: 3
      },
      2
    );

    expect(recovery.success).toBe(true);

    await db.withScopedTransaction(fakeScope, async (txClient) => {
      const jobRepo = new JobRunRepository(txClient);
      const completed = await jobRepo.findById(workspaceId, jobRun.id);
      expect(completed?.status).toBe('completed');
    });
  });

  it('records truthful failed state and audit log on permanent failure', async () => {
    const jobRun = await db.withScopedTransaction(fakeScope, async (txClient) => {
      const jobRepo = new JobRunRepository(txClient);
      return await jobRepo.create(workspaceId, 'test.permanent_failure', {});
    });

    // Run at attempt = maxRetries (simulating final failure)
    const outcome = await processor.process(
      {
        workspaceId,
        jobRunId: jobRun.id,
        jobName: jobRun.job_name,
        payload: jobRun.payload,
        maxRetries: 3
      },
      3
    );

    expect(outcome.success).toBe(false);

    // Verify DB records truthful failure
    await db.withScopedTransaction(fakeScope, async (txClient) => {
      const jobRepo = new JobRunRepository(txClient);
      const auditRepo = new AuditEventRepository(txClient);

      const failedJob = await jobRepo.findById(workspaceId, jobRun.id);
      expect(failedJob?.status).toBe('failed');
      expect(failedJob?.error).toContain('Deterministic permanent job failure');

      const audit = await auditRepo.listByWorkspace(workspaceId);
      const failureEvt = audit.events.find((e) => e.action === 'job.failed');
      expect(failureEvt).toBeDefined();
    });
  });

  it('enforces enqueue idempotency by returning existing job run for duplicate idempotency key', async () => {
    const idempotencyKey = 'sync-calendar-20260910-001';

    const firstRun = await db.withScopedTransaction(fakeScope, async (txClient) => {
      const jobRepo = new JobRunRepository(txClient);
      return await jobRepo.create(workspaceId, 'calendar.sync', { mailbox: 'exec@corp.com' }, idempotencyKey);
    });

    const secondRun = await db.withScopedTransaction(fakeScope, async (txClient) => {
      const jobRepo = new JobRunRepository(txClient);
      return await jobRepo.create(workspaceId, 'calendar.sync', { mailbox: 'exec@corp.com' }, idempotencyKey);
    });

    expect(secondRun.id).toBe(firstRun.id);
    expect(secondRun.idempotency_key).toBe(idempotencyKey);
  });

  it('truthfully records failed status and audit log for unconfigured connectors without simulated success', async () => {
    const jobRun = await db.withScopedTransaction(fakeScope, async (txClient) => {
      const jobRepo = new JobRunRepository(txClient);
      return await jobRepo.create(workspaceId, 'connector.salesforce', { syncType: 'incremental' });
    });

    const outcome = await processor.process({
      workspaceId,
      jobRunId: jobRun.id,
      jobName: jobRun.job_name,
      payload: jobRun.payload
    });

    expect(outcome.success).toBe(false);
    expect(outcome.result?.status).toBe('not_configured');
    expect(outcome.result?.connector).toBe('salesforce');

    await db.withScopedTransaction(fakeScope, async (txClient) => {
      const jobRepo = new JobRunRepository(txClient);
      const auditRepo = new AuditEventRepository(txClient);

      const updated = await jobRepo.findById(workspaceId, jobRun.id);
      expect(updated?.status).toBe('failed');
      expect(updated?.error).toBe('External connector credentials are not configured.');
      expect((updated?.result as any)?.status).toBe('not_configured');

      const audit = await auditRepo.listByWorkspace(workspaceId);
      const notConfiguredEvt = audit.events.find((e) => e.action === 'job.not_configured');
      expect(notConfiguredEvt).toBeDefined();
      expect(notConfiguredEvt?.payload).toMatchObject({
        jobName: 'connector.salesforce',
        error: 'External connector credentials are not configured.'
      });
    });
  });

  it('rejects arbitrary or unknown job names without executing fake success paths', async () => {
    const jobRun = await db.withScopedTransaction(fakeScope, async (txClient) => {
      const jobRepo = new JobRunRepository(txClient);
      return await jobRepo.create(workspaceId, 'arbitrary.fake_job', { data: 123 });
    });

    // On attempt < maxRetries, it throws the rejection error
    await expect(
      processor.process(
        {
          workspaceId,
          jobRunId: jobRun.id,
          jobName: jobRun.job_name,
          payload: jobRun.payload,
          maxRetries: 3
        },
        1
      )
    ).rejects.toThrow(/Unsupported or unknown job name: arbitrary\.fake_job/);

    // On final attempt, it persists truthful failed state and returns success: false
    const finalOutcome = await processor.process(
      {
        workspaceId,
        jobRunId: jobRun.id,
        jobName: jobRun.job_name,
        payload: jobRun.payload,
        maxRetries: 3
      },
      3
    );
    expect(finalOutcome.success).toBe(false);

    await db.withScopedTransaction(fakeScope, async (txClient) => {
      const jobRepo = new JobRunRepository(txClient);
      const failedJob = await jobRepo.findById(workspaceId, jobRun.id);
      expect(failedJob?.status).toBe('failed');
      expect(failedJob?.error).toContain('Unsupported or unknown job name: arbitrary.fake_job');
    });
  });
});
