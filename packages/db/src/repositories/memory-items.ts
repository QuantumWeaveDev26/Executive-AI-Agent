import {
  MemoryItemRecord,
  CreateMemoryInput,
  SupersedeMemoryInput,
  MemoryCategory,
  MemoryScope,
  ConsentStatus
} from '@thaara/contracts';
import { DbClient, TransactionalDbClient, AuthenticatedScope } from '../client.js';
import {
  sanitizeDatabaseError,
  ForbiddenError,
  NotFoundError,
  ValidationError
} from '../errors.js';

export class MemoryItemRepository {
  constructor(private db: DbClient | TransactionalDbClient) { }

  private async executeScoped<T>(
    scope: AuthenticatedScope,
    operation: (client: DbClient) => Promise<T>
  ): Promise<T> {
    if (
      'withScopedTransaction' in this.db &&
      typeof (this.db as TransactionalDbClient).withScopedTransaction === 'function'
    ) {
      return (this.db as TransactionalDbClient).withScopedTransaction(scope, operation);
    }
    return operation(this.db);
  }

  async create(scope: AuthenticatedScope, input: CreateMemoryInput): Promise<MemoryItemRecord> {
    try {
      return await this.executeScoped(scope, async (client) => {
        // Workspace-scoped memory requires owner or admin role
        if (input.scope === 'workspace' && !['owner', 'admin'].includes(scope.role ?? '')) {
          throw new ForbiddenError('Permission denied: workspace-scoped memory creation requires owner or admin role.');
        }

        // Validate provenance constraints
        if (input.provenance === 'explicit_user_input') {
          if (input.provenanceConversationId || input.provenanceMessageId) {
            throw new ValidationError('explicit_user_input provenance cannot reference conversation or message IDs.');
          }
        } else if (input.provenance === 'conversation_message') {
          if (!input.provenanceConversationId || !input.provenanceMessageId) {
            throw new ValidationError('conversation_message provenance requires both conversation_id and message_id.');
          }
          const msgRes = await client.query<{ id: string }>(
            `SELECT id FROM public.conversation_messages
             WHERE workspace_id = $1 AND conversation_id = $2 AND id = $3 AND user_id = $4;`,
            [scope.workspaceId, input.provenanceConversationId, input.provenanceMessageId, scope.userId]
          );
          if (msgRes.rows.length === 0) {
            throw new ForbiddenError('Referenced conversation message not found or unauthorized.');
          }
        }

        const { rows: createRows } = await client.query<{ id: string }>(
          `SELECT public.create_memory_item($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) AS id;`,
          [
            scope.sessionTokenHash,
            input.scope,
            input.category,
            input.key.trim(),
            input.value.trim(),
            input.confidence ?? 1.0,
            input.provenance,
            input.provenanceConversationId ?? null,
            input.provenanceMessageId ?? null,
            input.expiresAt ? new Date(input.expiresAt) : null
          ]
        );

        const memoryId = createRows[0]?.id;
        if (!memoryId) {
          throw new NotFoundError('Failed to create memory item');
        }

        const { rows } = await client.query<MemoryItemRecord>(
          `SELECT id, workspace_id, scope, user_id, category, key, value, confidence,
                  consent_status, provenance, provenance_conversation_id, provenance_message_id,
                  provenance_user_id, lifecycle_status, version, superseded_by_id, expires_at,
                  consented_at, consent_actor_user_id, revoked_at, created_at, updated_at
           FROM public.memory_items
           WHERE id = $1;`,
          [memoryId]
        );

        if (!rows[0]) {
          throw new NotFoundError('Created memory item not found or unauthorized');
        }

        return rows[0];
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async grantConsent(scope: AuthenticatedScope, memoryId: string): Promise<MemoryItemRecord> {
    try {
      return await this.executeScoped(scope, async (client) => {
        await client.query<{ grant_memory_consent: boolean }>(
          `SELECT public.grant_memory_consent($1, $2);`,
          [scope.sessionTokenHash, memoryId]
        );
        const { rows } = await client.query<MemoryItemRecord>(
          `SELECT id, workspace_id, scope, user_id, category, key, value, confidence,
                  consent_status, provenance, provenance_conversation_id, provenance_message_id,
                  provenance_user_id, lifecycle_status, version, superseded_by_id, expires_at,
                  consented_at, consent_actor_user_id, revoked_at, created_at, updated_at
           FROM public.memory_items
           WHERE workspace_id = $1 AND id = $2;`,
          [scope.workspaceId, memoryId]
        );
        if (!rows[0]) {
          throw new NotFoundError(`Memory item '${memoryId}' not found`);
        }
        return rows[0];
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async revokeConsent(scope: AuthenticatedScope, memoryId: string): Promise<MemoryItemRecord> {
    try {
      return await this.executeScoped(scope, async (client) => {
        await client.query<{ revoke_memory_consent: boolean }>(
          `SELECT public.revoke_memory_consent($1, $2);`,
          [scope.sessionTokenHash, memoryId]
        );
        const { rows } = await client.query<MemoryItemRecord>(
          `SELECT id, workspace_id, scope, user_id, category, key, value, confidence,
                  consent_status, provenance, provenance_conversation_id, provenance_message_id,
                  provenance_user_id, lifecycle_status, version, superseded_by_id, expires_at,
                  consented_at, consent_actor_user_id, revoked_at, created_at, updated_at
           FROM public.memory_items
           WHERE workspace_id = $1 AND id = $2;`,
          [scope.workspaceId, memoryId]
        );
        if (!rows[0]) {
          throw new NotFoundError(`Memory item '${memoryId}' not found`);
        }
        return rows[0];
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async supersede(
    scope: AuthenticatedScope,
    predecessorId: string,
    input: SupersedeMemoryInput
  ): Promise<MemoryItemRecord> {
    try {
      return await this.executeScoped(scope, async (client) => {
        // Validate conversation provenance ownership before procedure call
        if (input.provenance === 'conversation_message') {
          if (!input.provenanceConversationId || !input.provenanceMessageId) {
            throw new ValidationError('conversation_message provenance requires both conversation_id and message_id.');
          }
          const msgRes = await client.query<{ id: string }>(
            `SELECT id FROM public.conversation_messages
             WHERE workspace_id = $1 AND conversation_id = $2 AND id = $3 AND user_id = $4;`,
            [scope.workspaceId, input.provenanceConversationId, input.provenanceMessageId, scope.userId]
          );
          if (msgRes.rows.length === 0) {
            throw new ForbiddenError('Referenced conversation message not found or unauthorized.');
          }
        }

        // Verify predecessor existence and user ownership before procedure call
        const predRes = await client.query<{ id: string; scope: string; user_id: string | null }>(
          `SELECT id, scope, user_id FROM public.memory_items
           WHERE workspace_id = $1 AND id = $2;`,
          [scope.workspaceId, predecessorId]
        );
        if (predRes.rows.length === 0) {
          throw new NotFoundError('Predecessor memory item not found.');
        }
        const pred = predRes.rows[0]!;
        if (pred.scope === 'user' && pred.user_id !== scope.userId) {
          throw new ForbiddenError("Cannot supersede another user's memory.");
        }
        if (pred.scope === 'workspace' && !['owner', 'admin'].includes(scope.role ?? '')) {
          throw new ForbiddenError('Workspace memory supersession requires owner or admin role.');
        }

        const { rows } = await client.query<{ supersede_memory_item: string }>(
          `SELECT public.supersede_memory_item($1, $2, $3, $4, $5, $6, $7);`,
          [
            scope.sessionTokenHash,
            predecessorId,
            input.value.trim(),
            input.confidence ?? 1.0,
            input.provenance ?? 'explicit_user_input',
            input.provenanceConversationId ?? null,
            input.provenanceMessageId ?? null
          ]
        );

        const successorId = rows[0]?.supersede_memory_item;
        if (!successorId) {
          throw new NotFoundError('Failed to supersede memory item');
        }

        const { rows: succRows } = await client.query<MemoryItemRecord>(
          `SELECT id, workspace_id, scope, user_id, category, key, value, confidence,
                  consent_status, provenance, provenance_conversation_id, provenance_message_id,
                  provenance_user_id, lifecycle_status, version, superseded_by_id, expires_at,
                  consented_at, consent_actor_user_id, revoked_at, created_at, updated_at
           FROM public.memory_items
           WHERE id = $1;`,
          [successorId]
        );

        if (!succRows[0]) {
          throw new NotFoundError('Superseded memory item not found or unauthorized');
        }

        return succRows[0];
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async findById(scope: AuthenticatedScope, id: string): Promise<MemoryItemRecord | null> {
    try {
      return await this.executeScoped(scope, async (client) => {
        const { rows } = await client.query<MemoryItemRecord>(
          `SELECT id, workspace_id, scope, user_id, category, key, value, confidence,
                  consent_status, provenance, provenance_conversation_id, provenance_message_id,
                  provenance_user_id, lifecycle_status, version, superseded_by_id, expires_at,
                  consented_at, consent_actor_user_id, revoked_at, created_at, updated_at
           FROM public.memory_items
           WHERE workspace_id = $1 AND id = $2
             AND (
               (scope = 'user' AND user_id = $3 AND created_at > COALESCE(
                 (SELECT MAX(cutoff_at) FROM public.user_purge_cutoffs WHERE workspace_id = $1 AND user_id = $3),
                 '-infinity'::timestamptz
               ))
               OR (scope = 'workspace')
             );`,
          [scope.workspaceId, id, scope.userId]
        );
        return rows[0] ?? null;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async list(
    scope: AuthenticatedScope,
    options?: {
      scope?: MemoryScope;
      category?: MemoryCategory;
      consentStatus?: ConsentStatus;
      limit?: number;
      offset?: number;
    }
  ): Promise<MemoryItemRecord[]> {
    try {
      return await this.executeScoped(scope, async (client) => {
        const limit = Math.min(options?.limit ?? 50, 100);
        const offset = options?.offset ?? 0;
        const params: any[] = [scope.workspaceId, scope.userId];

        let sql = `SELECT id, workspace_id, scope, user_id, category, key, value, confidence,
                          consent_status, provenance, provenance_conversation_id, provenance_message_id,
                          provenance_user_id, lifecycle_status, version, superseded_by_id, expires_at,
                          consented_at, consent_actor_user_id, revoked_at, created_at, updated_at
                   FROM public.memory_items
                   WHERE workspace_id = $1
                     AND (
                       (scope = 'user' AND user_id = $2 AND created_at > COALESCE(
                         (SELECT MAX(cutoff_at) FROM public.user_purge_cutoffs WHERE workspace_id = $1 AND user_id = $2),
                         '-infinity'::timestamptz
                       ))
                       OR (scope = 'workspace')
                     )`;

        if (options?.scope) {
          params.push(options.scope);
          sql += ` AND scope = $${params.length}`;
        }

        if (options?.category) {
          params.push(options.category);
          sql += ` AND category = $${params.length}`;
        }

        if (options?.consentStatus) {
          params.push(options.consentStatus);
          sql += ` AND consent_status = $${params.length}`;
        }

        params.push(limit, offset);
        sql += ` ORDER BY confidence DESC, updated_at DESC, id ASC LIMIT $${params.length - 1} OFFSET $${params.length};`;

        const { rows } = await client.query<MemoryItemRecord>(sql, params);
        return rows;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }

  async listActive(
    scope: AuthenticatedScope,
    options?: { scopeType?: MemoryScope; category?: MemoryCategory }
  ): Promise<MemoryItemRecord[]> {
    try {
      return await this.executeScoped(scope, async (client) => {
        const params: any[] = [scope.workspaceId, scope.userId];

        // SQL applies privacy cutoff exclusively to user-scoped memories; workspace memories are immune
        let sql = `SELECT id, workspace_id, scope, user_id, category, key, value, confidence,
                          consent_status, provenance, provenance_conversation_id, provenance_message_id,
                          provenance_user_id, lifecycle_status, version, superseded_by_id, expires_at,
                          consented_at, consent_actor_user_id, revoked_at, created_at, updated_at
                   FROM public.memory_items
                   WHERE workspace_id = $1
                     AND lifecycle_status = 'active'
                     AND (
                       (scope = 'user' AND user_id = $2 AND created_at > COALESCE(
                         (SELECT MAX(cutoff_at) FROM public.user_purge_cutoffs WHERE workspace_id = $1 AND user_id = $2),
                         '-infinity'::timestamptz
                       ))
                       OR (scope = 'workspace')
                     )`;

        if (options?.scopeType) {
          params.push(options.scopeType);
          sql += ` AND scope = $${params.length}`;
        }

        if (options?.category) {
          params.push(options.category);
          sql += ` AND category = $${params.length}`;
        }

        sql += ` ORDER BY confidence DESC, updated_at DESC, id ASC;`;

        const { rows } = await client.query<MemoryItemRecord>(sql, params);
        return rows;
      });
    } catch (err) {
      throw sanitizeDatabaseError(err);
    }
  }
}
