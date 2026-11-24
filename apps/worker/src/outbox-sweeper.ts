import os from 'node:os';
import crypto from 'node:crypto';
import {
  DbClient,
  TransactionalDbClient,
  RoleAwarePool,
  WorkerOutboxRepository,
  WorkerPurgeRepository
} from '@thaara/db';
import { Logger, defaultLogger } from '@thaara/observability';
import { JobData } from './processor.js';
import { validateTopicPayload } from './outbox-registry.js';

export interface OutboxSweeperOptions {
  intervalMs?: number;
  batchSize?: number;
  leaseSeconds?: number;
  workerId?: string;
  logger?: Logger;
}

export interface JobEnqueuer {
  enqueue: (data: JobData) => Promise<void>;
}

export class OutboxDispatchSweeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private workerId: string;
  private outboxRepo: WorkerOutboxRepository;
  private purgeRepo: WorkerPurgeRepository;

  constructor(
    private db: DbClient | TransactionalDbClient | RoleAwarePool,
    private queue: JobEnqueuer,
    private logger: Logger = defaultLogger,
    options?: OutboxSweeperOptions
  ) {
    if (process.env.NODE_ENV !== 'test') {
      const isRolePool = Boolean(
        this.db &&
        'checkout' in this.db &&
        'withRoleClient' in this.db &&
        (this.db as any).targetRole === 'thaara_worker'
      );
      if (!isRolePool) {
        throw new Error(
          '[OutboxDispatchSweeper] Fatal: OutboxDispatchSweeper requires a RoleAwarePool configured for thaara_worker in all non-test environments.'
        );
      }
    }

    this.workerId = options?.workerId ?? `${os.hostname()}:outbox:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
    this.outboxRepo = new WorkerOutboxRepository(this.db as any);
    this.purgeRepo = new WorkerPurgeRepository(this.db as any);
  }

  async sweep(batchSize = 20, leaseSeconds = 60): Promise<{ claimedCount: number; dispatchedCount: number; failedCount: number }> {
    const records = await this.outboxRepo.claimDispatches(this.workerId, batchSize, leaseSeconds);
    if (records.length === 0) {
      return { claimedCount: 0, dispatchedCount: 0, failedCount: 0 };
    }

    let dispatchedCount = 0;
    let failedCount = 0;

    for (const record of records) {
      // 1. Syntactic Topic & Schema Validation
      const val = validateTopicPayload(record.topic, record.payload);
      if (!val.valid) {
        this.logger.warn(`[OutboxDispatchSweeper] Rejecting invalid outbox record ${record.id}: ${val.reason}`, {
          context: { outboxId: record.id, topic: record.topic, errorCode: val.errorCode }
        });
        await this.outboxRepo.markFailed(
          record.id,
          record.claim_token,
          val.errorCode,
          'SYSTEM_VALIDATION',
          true
        );
        failedCount++;
        continue;
      }

      // 2. Pre-Dispatch Authoritative Database Rehydration under thaara_worker
      const dbOp = await this.purgeRepo.getPurgeOperation(val.data.operation_id);
      if (!dbOp) {
        this.logger.warn(`[OutboxDispatchSweeper] Rejecting outbox record ${record.id}: purge operation not found`, {
          context: { outboxId: record.id, operationId: val.data.operation_id }
        });
        await this.outboxRepo.markFailed(
          record.id,
          record.claim_token,
          'OUTBOX_PAYLOAD_MISMATCH',
          'SYSTEM_VALIDATION',
          true
        );
        failedCount++;
        continue;
      }

      // Strict field-by-field equality check against authoritative database row
      const payloadCutoff = new Date(val.data.cutoff_at).getTime();
      const dbCutoff = new Date(dbOp.cutoff_at).getTime();
      const isMatch =
        dbOp.workspace_id === val.data.workspace_id &&
        dbOp.user_id === val.data.user_id &&
        dbOp.generation === val.data.generation &&
        dbOp.mode === val.data.mode &&
        payloadCutoff === dbCutoff;

      if (!isMatch) {
        this.logger.warn(`[OutboxDispatchSweeper] Rejecting outbox record ${record.id}: payload fields mismatch authoritative DB operation`, {
          context: {
            outboxId: record.id,
            operationId: dbOp.id,
            dbWorkspace: dbOp.workspace_id,
            payloadWorkspace: val.data.workspace_id
          }
        });
        await this.outboxRepo.markFailed(
          record.id,
          record.claim_token,
          'OUTBOX_PAYLOAD_MISMATCH',
          'SYSTEM_VALIDATION',
          true
        );
        failedCount++;
        continue;
      }

      // 3. Build Canonical Job Payload from Authoritative Database Row
      const canonicalJobPayload: Record<string, unknown> = {
        operation_id: dbOp.id,
        workspace_id: dbOp.workspace_id,
        user_id: dbOp.user_id,
        generation: dbOp.generation,
        mode: dbOp.mode,
        cutoff_at: new Date(dbOp.cutoff_at).toISOString(),
        continuation: false
      };

      // 4. Enqueue to BullMQ and Mark Dispatched
      try {
        await this.queue.enqueue({
          workspaceId: dbOp.workspace_id,
          jobRunId: record.dedup_key,
          jobName: 'privacy.purge_operation',
          payload: canonicalJobPayload,
          maxRetries: 3
        });

        const marked = await this.outboxRepo.markDispatched(record.id, record.claim_token);
        if (!marked) {
          this.logger.warn(
            `[OutboxDispatchSweeper] Outbox record ${record.id} dispatch acknowledgement fenced: lease expired; relying on durable recovery`,
            { context: { outboxId: record.id } }
          );
        } else {
          dispatchedCount++;
        }
      } catch (enqueueErr) {
        this.logger.error('[OutboxDispatchSweeper] Error enqueuing job to queue', {
          context: { outboxId: record.id, error: (enqueueErr as Error).message }
        });
        await this.outboxRepo.markFailed(
          record.id,
          record.claim_token,
          'OUTBOX_QUEUE_UNAVAILABLE',
          'TRANSIENT_INFRASTRUCTURE',
          false
        );
        failedCount++;
      }
    }

    return {
      claimedCount: records.length,
      dispatchedCount,
      failedCount
    };
  }

  start(intervalMs = 5000): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(async () => {
      try {
        await this.sweep();
      } catch (err) {
        this.logger.error('[OutboxDispatchSweeper] Uncaught error during sweep', {
          error: { name: (err as Error).name, message: (err as Error).message }
        });
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }
}
