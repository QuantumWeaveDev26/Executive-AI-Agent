import os from 'node:os';
import crypto from 'node:crypto';
import {
  DbClient,
  TransactionalDbClient,
  RoleAwarePool,
  WorkerPurgeRepository
} from '@thaara/db';
import { Logger, defaultLogger } from '@thaara/observability';
import { JobEnqueuer } from './outbox-sweeper.js';

export interface ContinuationSweeperOptions {
  intervalMs?: number;
  batchSize?: number;
  leaseExtensionSeconds?: number;
  workerId?: string;
  logger?: Logger;
}

export class PrivacyPurgeContinuationSweeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private workerId: string;
  private purgeRepo: WorkerPurgeRepository;

  constructor(
    private db: DbClient | TransactionalDbClient | RoleAwarePool,
    private queue: JobEnqueuer,
    private logger: Logger = defaultLogger,
    options?: ContinuationSweeperOptions
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
          '[PrivacyPurgeContinuationSweeper] Fatal: PrivacyPurgeContinuationSweeper requires a RoleAwarePool configured for thaara_worker in all non-test environments.'
        );
      }
    }

    this.workerId = options?.workerId ?? `${os.hostname()}:continuation:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
    this.purgeRepo = new WorkerPurgeRepository(this.db as any);
  }

  async sweep(
    batchSize = 10,
    leaseExtensionSeconds = 300,
    dispatchedGraceSeconds = 300
  ): Promise<{ recoveredCount: number }> {
    const unrecovered = await this.purgeRepo.claimUnrecoveredContinuations(
      this.workerId,
      batchSize,
      leaseExtensionSeconds,
      dispatchedGraceSeconds
    );

    if (unrecovered.length === 0) {
      return { recoveredCount: 0 };
    }

    let recoveredCount = 0;

    for (const record of unrecovered) {
      const canonicalPayload: Record<string, unknown> = {
        operation_id: record.operation_id,
        workspace_id: record.workspace_id,
        user_id: record.user_id,
        generation: record.generation,
        mode: record.mode,
        cutoff_at: new Date(record.cutoff_at).toISOString(),
        continuation: true,
        continuation_token: record.continuation_token
      };

      try {
        await this.queue.enqueue({
          workspaceId: record.workspace_id,
          jobRunId: `purge:${record.operation_id}:seq:${record.continuation_sequence}`,
          jobName: 'privacy.purge_operation',
          payload: canonicalPayload,
          maxRetries: 3
        });

        this.logger.info(
          `[PrivacyPurgeContinuationSweeper] Re-enqueued continuation job for purge ${record.operation_id} (seq: ${record.continuation_sequence})`,
          {
            context: {
              operationId: record.operation_id,
              continuationSequence: record.continuation_sequence
            }
          }
        );
        recoveredCount++;
      } catch (enqueueErr) {
        this.logger.error('[PrivacyPurgeContinuationSweeper] Failed to re-enqueue unrecovered continuation', {
          context: {
            operationId: record.operation_id,
            error: (enqueueErr as Error).message
          }
        });
      }
    }

    return { recoveredCount };
  }

  start(intervalMs = 10000): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(async () => {
      try {
        await this.sweep();
      } catch (err) {
        this.logger.error('[PrivacyPurgeContinuationSweeper] Uncaught error during sweep', {
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
