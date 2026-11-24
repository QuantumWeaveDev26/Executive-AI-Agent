import { RoleAwarePool, DbClient, TransactionalDbClient } from '../../client.js';
import { sanitizeDatabaseError } from '../../errors.js';

export interface PurgeLeaseRecord {
  lease_token: string;
  lease_expires_at: string;
  mode: string;
  cutoff_at: string;
  workspace_id: string;
  user_id: string;
}

export interface BatchResult {
  processed_count: number;
  has_more: boolean;
}

export interface ScheduleContinuationResult {
  continuation_sequence: number;
  continuation_token: string;
  lease_expires_at: string;
  already_pending: boolean;
}

export interface ClaimContinuationResult {
  lease_token: string | null;
  lease_expires_at: string | null;
  status: string;
}

export interface UnrecoveredContinuationRecord {
  operation_id: string;
  workspace_id: string;
  user_id: string;
  generation: number;
  mode: string;
  cutoff_at: string;
  continuation_sequence: number;
  continuation_token: string;
}

export interface PurgeOperationRow {
  id: string;
  workspace_id: string;
  user_id: string;
  generation: number;
  cutoff_at: string | Date;
  mode: string;
  status: string;
  checkpoint_conversations_completed: boolean;
  checkpoint_messages_completed: boolean;
  checkpoint_memories_completed: boolean;
  checkpoint_membership_completed: boolean;
  purged_messages_count: number;
  purged_conversations_count: number;
  purged_memories_count: number;
  continuation_sequence: number;
  continuation_token: string | null;
  continuation_pending: boolean;
  lease_token: string | null;
  lease_worker_id: string | null;
  lease_expires_at: string | Date | null;
  attempts: number;
  max_attempts: number;
  error_code: string | null;
  error_category: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at: string | Date | null;
}

export class WorkerPurgeRepository {
  constructor(private pool: RoleAwarePool | DbClient | TransactionalDbClient) {}

  private async withClient<T>(op: (client: DbClient) => Promise<T>): Promise<T> {
    if (this.pool && 'withRoleClient' in this.pool && typeof (this.pool as any).withRoleClient === 'function') {
      return await (this.pool as any).withRoleClient(op);
    }
    return await op(this.pool as DbClient);
  }

  async getPurgeOperation(purgeId: string): Promise<PurgeOperationRow | null> {
    try {
      return await this.withClient(async (client) => {
        const { rows } = await client.query<PurgeOperationRow>(
          `SELECT * FROM public.get_purge_operation($1);`,
          [purgeId]
        );
        return rows[0] ?? null;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async acquireLease(
    purgeId: string,
    workerId: string,
    leaseDurationSec = 300
  ): Promise<PurgeLeaseRecord | null> {
    try {
      return await this.withClient(async (client) => {
        const { rows } = await client.query<PurgeLeaseRecord>(
          `SELECT * FROM public.acquire_purge_lease($1, $2, $3);`,
          [purgeId, workerId, leaseDurationSec]
        );
        return rows[0] ?? null;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async renewLease(
    purgeId: string,
    leaseToken: string,
    workerId: string,
    additionalSec = 300
  ): Promise<boolean> {
    try {
      return await this.withClient(async (client) => {
        const { rows } = await client.query<{ renew_purge_lease: boolean }>(
          `SELECT public.renew_purge_lease($1, $2, $3, $4);`,
          [purgeId, leaseToken, workerId, additionalSec]
        );
        return rows[0]?.renew_purge_lease ?? true;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async scheduleContinuation(
    purgeId: string,
    leaseToken: string,
    workerId: string,
    extensionSec = 300
  ): Promise<ScheduleContinuationResult | null> {
    try {
      return await this.withClient(async (client) => {
        const { rows } = await client.query<ScheduleContinuationResult>(
          `SELECT * FROM public.schedule_purge_continuation($1, $2, $3, $4);`,
          [purgeId, leaseToken, workerId, extensionSec]
        );
        return rows[0] ?? null;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async claimContinuation(
    purgeId: string,
    continuationToken: string,
    workerId: string,
    leaseSec = 300
  ): Promise<ClaimContinuationResult | null> {
    try {
      return await this.withClient(async (client) => {
        const { rows } = await client.query<ClaimContinuationResult>(
          `SELECT * FROM public.claim_purge_continuation($1, $2, $3, $4);`,
          [purgeId, continuationToken, workerId, leaseSec]
        );
        return rows[0] ?? null;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async claimUnrecoveredContinuations(
    workerId: string,
    batchSize = 10,
    leaseExtensionSec = 300,
    dispatchedGraceSec = 300
  ): Promise<UnrecoveredContinuationRecord[]> {
    try {
      return await this.withClient(async (client) => {
        const { rows } = await client.query<UnrecoveredContinuationRecord>(
          `SELECT * FROM public.claim_unrecovered_purge_continuations($1, $2, $3, $4);`,
          [workerId, batchSize, leaseExtensionSec, dispatchedGraceSec]
        );
        return rows;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async recoverStrandedPurgeOperations(
    workerId: string,
    batchSize = 10,
    leaseExtensionSec = 300,
    dispatchedGraceSec = 300
  ): Promise<UnrecoveredContinuationRecord[]> {
    try {
      return await this.withClient(async (client) => {
        const { rows } = await client.query<UnrecoveredContinuationRecord>(
          `SELECT * FROM public.recover_stranded_purge_operations($1, $2, $3, $4);`,
          [workerId, batchSize, leaseExtensionSec, dispatchedGraceSec]
        );
        return rows;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async processMessagesBatch(
    purgeId: string,
    leaseToken: string,
    workerId: string,
    batchSize = 500
  ): Promise<BatchResult> {
    try {
      return await this.withClient(async (client) => {
        const { rows } = await client.query<BatchResult>(
          `SELECT * FROM public.process_purge_batch_messages($1, $2, $3, $4);`,
          [purgeId, leaseToken, workerId, batchSize]
        );
        return rows[0] ?? { processed_count: 0, has_more: false };
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async processConversationsBatch(
    purgeId: string,
    leaseToken: string,
    workerId: string,
    batchSize = 100
  ): Promise<BatchResult> {
    try {
      return await this.withClient(async (client) => {
        const { rows } = await client.query<BatchResult>(
          `SELECT * FROM public.process_purge_batch_conversations($1, $2, $3, $4);`,
          [purgeId, leaseToken, workerId, batchSize]
        );
        return rows[0] ?? { processed_count: 0, has_more: false };
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async processMemoriesBatch(
    purgeId: string,
    leaseToken: string,
    workerId: string,
    batchSize = 500
  ): Promise<BatchResult> {
    try {
      return await this.withClient(async (client) => {
        const { rows } = await client.query<BatchResult>(
          `SELECT * FROM public.process_purge_batch_memories($1, $2, $3, $4);`,
          [purgeId, leaseToken, workerId, batchSize]
        );
        return rows[0] ?? { processed_count: 0, has_more: false };
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async completePurge(purgeId: string, leaseToken: string, workerId: string): Promise<boolean> {
    try {
      return await this.withClient(async (client) => {
        const { rows } = await client.query<{ complete_purge_operation: boolean }>(
          `SELECT public.complete_purge_operation($1, $2, $3);`,
          [purgeId, leaseToken, workerId]
        );
        return rows[0]?.complete_purge_operation ?? true;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async failPurge(
    purgeId: string,
    leaseToken: string,
    workerId: string,
    errorCode: string,
    errorCategory: string,
    isTerminal = false
  ): Promise<boolean> {
    try {
      return await this.withClient(async (client) => {
        const { rows } = await client.query<{ fail_purge_operation: boolean }>(
          `SELECT public.fail_purge_operation($1, $2, $3, $4, $5, $6);`,
          [purgeId, leaseToken, workerId, errorCode, errorCategory, isTerminal]
        );
        return rows[0]?.fail_purge_operation ?? true;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }
}
