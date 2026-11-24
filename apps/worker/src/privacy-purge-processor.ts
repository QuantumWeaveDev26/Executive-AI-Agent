import os from 'node:os';
import crypto from 'node:crypto';
import {
  DbClient,
  TransactionalDbClient,
  RoleAwarePool,
  WorkerPurgeRepository
} from '@thaara/db';
import { Logger, defaultLogger } from '@thaara/observability';
import { JobData } from './processor.js';
import { JobEnqueuer } from './outbox-sweeper.js';

export interface PurgeProcessorOptions {
  workerId?: string;
  maxBatchesPerDelivery?: number;
  maxTimeBudgetMs?: number;
}

export class PrivacyPurgeProcessor {
  private workerId: string;
  private purgeRepo: WorkerPurgeRepository;
  private maxBatchesPerDelivery: number;
  private maxTimeBudgetMs: number;

  constructor(
    private db: DbClient | TransactionalDbClient | RoleAwarePool,
    private queue: JobEnqueuer,
    private logger: Logger = defaultLogger,
    options?: PurgeProcessorOptions
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
          '[PrivacyPurgeProcessor] Fatal: PrivacyPurgeProcessor requires a RoleAwarePool configured for thaara_worker in all non-test environments.'
        );
      }
    }

    this.workerId = options?.workerId ?? `${os.hostname()}:purge:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
    this.purgeRepo = new WorkerPurgeRepository(this.db as any);
    this.maxBatchesPerDelivery = options?.maxBatchesPerDelivery ?? 10;
    this.maxTimeBudgetMs = options?.maxTimeBudgetMs ?? 20_000;
  }

  async processPurge(
    jobData: JobData,
    _attemptNumber = 1
  ): Promise<{ success: boolean; result?: Record<string, unknown> }> {
    const payload = jobData.payload as {
      operation_id?: string;
      continuation?: boolean;
      continuation_token?: string;
    };

    const operationId = payload.operation_id;
    if (!operationId || typeof operationId !== 'string') {
      this.logger.error('[PrivacyPurgeProcessor] Job payload missing operation_id');
      return { success: false, result: { error: 'INVALID_PAYLOAD' } };
    }

    // Defensively rehydrate authoritative DB operation under thaara_worker
    const dbOp = await this.purgeRepo.getPurgeOperation(operationId);
    if (!dbOp) {
      this.logger.warn(`[PrivacyPurgeProcessor] Purge operation ${operationId} not found in database`);
      return { success: true, result: { not_found: true } };
    }

    if (dbOp.status === 'completed' || dbOp.status === 'failed') {
      this.logger.info(`[PrivacyPurgeProcessor] Purge operation ${operationId} is already in terminal state '${dbOp.status}'`);
      return { success: true, result: { already_terminal: true, status: dbOp.status } };
    }

    let leaseToken: string;

    // Pick up lease: continuation vs initial delivery
    if (payload.continuation && payload.continuation_token) {
      const res = await this.purgeRepo.claimContinuation(dbOp.id, payload.continuation_token, this.workerId, 300);
      if (!res || !res.lease_token) {
        if (res?.status === 'failed') {
          this.logger.warn(`[PrivacyPurgeProcessor] Purge ${dbOp.id} continuation delivery rejected: attempt exhaustion`);
          return { success: false, result: { status: 'failed', reason: 'Attempt exhaustion' } };
        }

        // Re-read current DB state to determine if operation is truly terminal or needs safe lease reacquisition for retry
        const refreshedOp = await this.purgeRepo.getPurgeOperation(dbOp.id);
        if (!refreshedOp || refreshedOp.status === 'completed' || refreshedOp.status === 'failed') {
          this.logger.info(`[PrivacyPurgeProcessor] Purge ${dbOp.id} is already in terminal state; discarding delivery`);
          return { success: true, result: { already_terminal: true } };
        }

        // Check if another worker is actively executing this under an unexpired lease
        const hasActiveLease =
          refreshedOp.status === 'running' &&
          refreshedOp.lease_expires_at &&
          new Date(refreshedOp.lease_expires_at).getTime() > Date.now();

        if (hasActiveLease && refreshedOp.lease_worker_id !== this.workerId) {
          this.logger.info(
            `[PrivacyPurgeProcessor] Continuation for purge ${dbOp.id} already claimed by another active worker; discarding duplicate delivery`
          );
          return { success: true, result: { duplicate: true } };
        }

        // The operation is pending or running with an expired lease (e.g. retry after non-terminal checkpoint failure or worker crash)
        // Safely reacquire lease rather than silently succeeding
        this.logger.info(
          `[PrivacyPurgeProcessor] Continuation token already consumed for purge ${dbOp.id}; attempting safe lease reacquisition for retry`
        );
        try {
          const lease = await this.purgeRepo.acquireLease(dbOp.id, this.workerId, 300);
          if (lease?.lease_token) {
            leaseToken = lease.lease_token;
          } else {
            this.logger.warn(`[PrivacyPurgeProcessor] Could not reacquire lease for retry of purge ${dbOp.id}`);
            throw new Error(`[PrivacyPurgeProcessor] Non-terminal lease reacquisition failed for purge ${dbOp.id}: lease could not be acquired`);
          }
        } catch (acquireErr) {
          this.logger.warn(
            `[PrivacyPurgeProcessor] Lease reacquisition failed for purge ${dbOp.id}: ${(acquireErr as Error).message}`
          );
          throw acquireErr;
        }
      } else {
        leaseToken = res.lease_token;
      }
    } else {
      const lease = await this.purgeRepo.acquireLease(dbOp.id, this.workerId, 300);
      if (!lease) {
        // Re-read current DB state to check if already terminal or actively claimed by another worker
        const currentOp = await this.purgeRepo.getPurgeOperation(dbOp.id);
        if (currentOp?.status === 'completed' || currentOp?.status === 'failed') {
          this.logger.info(`[PrivacyPurgeProcessor] Purge ${dbOp.id} is already in terminal state; discarding initial delivery`);
          return { success: true, result: { already_terminal: true } };
        }
        if (
          currentOp?.status === 'running' &&
          currentOp.lease_worker_id !== this.workerId &&
          currentOp.lease_expires_at &&
          new Date(currentOp.lease_expires_at).getTime() > Date.now()
        ) {
          this.logger.info(`[PrivacyPurgeProcessor] Purge ${dbOp.id} already claimed by another active worker; discarding duplicate delivery`);
          return { success: true, result: { duplicate: true } };
        }
        this.logger.warn(`[PrivacyPurgeProcessor] Could not acquire lease for purge ${dbOp.id}`);
        throw new Error(`[PrivacyPurgeProcessor] Non-terminal lease acquisition failed for purge ${dbOp.id}: lease could not be acquired`);
      }
      leaseToken = lease.lease_token;
    }

    const startTime = Date.now();
    let batchesExecuted = 0;

    const isBudgetExhausted = () => {
      return batchesExecuted >= this.maxBatchesPerDelivery || (Date.now() - startTime) >= this.maxTimeBudgetMs;
    };

    try {
      // Checkpoint 1: Messages Redaction
      if (!dbOp.checkpoint_messages_completed) {
        let hasMore = true;
        while (hasMore) {
          if (isBudgetExhausted()) {
            return await this.scheduleAndEnqueueContinuation(dbOp.id, leaseToken);
          }
          const renewed = await this.purgeRepo.renewLease(dbOp.id, leaseToken, this.workerId, 300);
          if (!renewed) {
            throw new Error(`Purge fence violation: expired lease or failed renewal for operation ${dbOp.id}`);
          }
          const res = await this.purgeRepo.processMessagesBatch(dbOp.id, leaseToken, this.workerId, 100);
          batchesExecuted++;
          hasMore = res.has_more;
        }
      }

      // Checkpoint 2: Conversations Status & Redaction
      if (!dbOp.checkpoint_conversations_completed) {
        let hasMore = true;
        while (hasMore) {
          if (isBudgetExhausted()) {
            return await this.scheduleAndEnqueueContinuation(dbOp.id, leaseToken);
          }
          const renewed = await this.purgeRepo.renewLease(dbOp.id, leaseToken, this.workerId, 300);
          if (!renewed) {
            throw new Error(`Purge fence violation: expired lease or failed renewal for operation ${dbOp.id}`);
          }
          const res = await this.purgeRepo.processConversationsBatch(dbOp.id, leaseToken, this.workerId, 100);
          batchesExecuted++;
          hasMore = res.has_more;
        }
      }

      // Checkpoint 3: Memories Redaction & Deletion
      if (!dbOp.checkpoint_memories_completed) {
        let hasMore = true;
        while (hasMore) {
          if (isBudgetExhausted()) {
            return await this.scheduleAndEnqueueContinuation(dbOp.id, leaseToken);
          }
          const renewed = await this.purgeRepo.renewLease(dbOp.id, leaseToken, this.workerId, 300);
          if (!renewed) {
            throw new Error(`Purge fence violation: expired lease or failed renewal for operation ${dbOp.id}`);
          }
          const res = await this.purgeRepo.processMemoriesBatch(dbOp.id, leaseToken, this.workerId, 100);
          batchesExecuted++;
          hasMore = res.has_more;
        }
      }

      // All checkpoints complete: Complete purge operation
      try {
        await this.purgeRepo.completePurge(dbOp.id, leaseToken, this.workerId);
        this.logger.info(`[PrivacyPurgeProcessor] Purge operation ${dbOp.id} completed successfully`);
        return { success: true, result: { status: 'completed' } };
      } catch (completeErr) {
        const errMsg = (completeErr as Error).message;
        if (errMsg.includes('sole owner')) {
          this.logger.warn(`[PrivacyPurgeProcessor] Account closure blocked: sole owner for purge ${dbOp.id}`);
          await this.purgeRepo.failPurge(
            dbOp.id,
            leaseToken,
            this.workerId,
            'PURGE_LAST_OWNER_BLOCKED',
            'POLICY_VIOLATION',
            true
          );
          return { success: false, result: { status: 'failed', errorCode: 'PURGE_LAST_OWNER_BLOCKED' } };
        }
        throw completeErr;
      }
    } catch (err) {
      const errMsg = (err as Error).message;
      if (errMsg.includes('fence violation') || errMsg.includes('expired lease')) {
        this.logger.warn(`[PrivacyPurgeProcessor] Fence violation for purge ${dbOp.id}: ${errMsg}`);
        const current = await this.purgeRepo.getPurgeOperation(dbOp.id);
        if (current && (current.status === 'completed' || current.status === 'failed')) {
          this.logger.info(`[PrivacyPurgeProcessor] Operation ${dbOp.id} reached terminal status '${current.status}'. Acknowledging duplicate execution.`);
          return { success: true };
        }
        if (
          current &&
          current.status === 'running' &&
          current.lease_worker_id &&
          current.lease_worker_id !== this.workerId &&
          current.lease_expires_at &&
          new Date(current.lease_expires_at).getTime() > Date.now()
        ) {
          this.logger.info(`[PrivacyPurgeProcessor] Operation ${dbOp.id} is active under lease by worker ${current.lease_worker_id}. Acknowledging concurrent delivery.`);
          return { success: true };
        }
        throw new Error(`[PrivacyPurgeProcessor] Non-terminal lease lost during processing for operation ${dbOp.id}: ${errMsg}. Triggering BullMQ retry.`);
      }

      this.logger.error(`[PrivacyPurgeProcessor] Error executing purge batch for ${dbOp.id}`, {
        error: { name: (err as Error).name, message: errMsg }
      });

      try {
        await this.purgeRepo.failPurge(
          dbOp.id,
          leaseToken,
          this.workerId,
          'PURGE_CHECKPOINT_FAILED',
          'DATABASE_ERROR',
          false
        );
      } catch (failErr) {
        this.logger.error(`[PrivacyPurgeProcessor] Failed to record failure for purge ${dbOp.id}: ${(failErr as Error).message}`);
      }

      throw err;
    }
  }

  private async scheduleAndEnqueueContinuation(
    purgeId: string,
    leaseToken: string
  ): Promise<{ success: boolean; result: Record<string, unknown> }> {
    const sched = await this.purgeRepo.scheduleContinuation(purgeId, leaseToken, this.workerId, 300);
    if (!sched) {
      throw new Error(`Failed to schedule continuation for purge ${purgeId}`);
    }

    const dbOp = await this.purgeRepo.getPurgeOperation(purgeId);
    if (!dbOp) {
      throw new Error(`Purge operation ${purgeId} not found after scheduling continuation`);
    }

    const continuationPayload: Record<string, unknown> = {
      operation_id: dbOp.id,
      workspace_id: dbOp.workspace_id,
      user_id: dbOp.user_id,
      generation: dbOp.generation,
      mode: dbOp.mode,
      cutoff_at: new Date(dbOp.cutoff_at).toISOString(),
      continuation: true,
      continuation_token: sched.continuation_token
    };

    try {
      await this.queue.enqueue({
        workspaceId: dbOp.workspace_id,
        jobRunId: `purge:${dbOp.id}:seq:${sched.continuation_sequence}`,
        jobName: 'privacy.purge_operation',
        payload: continuationPayload,
        maxRetries: 3
      });

      this.logger.info(`[PrivacyPurgeProcessor] Enqueued continuation job for purge ${purgeId} (seq: ${sched.continuation_sequence})`);
      return {
        success: true,
        result: {
          continuationScheduled: true,
          continuationSequence: sched.continuation_sequence,
          continued: true,
          sequence: sched.continuation_sequence
        }
      };
    } catch (enqueueErr) {
      this.logger.error('[PrivacyPurgeProcessor] Failed to enqueue continuation job to BullMQ; retaining running operation for sweeper recovery', {
        context: { purgeId, error: (enqueueErr as Error).message }
      });
      return { success: false, result: { continued: false, error: 'OUTBOX_QUEUE_UNAVAILABLE' } };
    }
  }
}
