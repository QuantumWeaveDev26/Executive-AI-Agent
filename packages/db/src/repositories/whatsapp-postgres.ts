import { randomBytes } from 'node:crypto';
import type { ApprovalRequest, MetaWhatsAppSendInput, MetaWhatsAppTestConfig, WhatsAppStoredAutoReplyMetadata, WhatsAppStoredFailureMetadata } from '@thaara/contracts';
import { computeCanonicalParameterHash, isWhatsAppStoredAutoReplyMetadata, isWhatsAppStoredFailureMetadata } from '@thaara/contracts';
import { AppError, ForbiddenError } from '@thaara/observability';
import { isMetaWhatsAppStoredMedia, type MetaWhatsAppStoredMedia } from '@thaara/contracts';
import { isWhatsAppRelayScope, type AuthenticatedScope, type TransactionalDbClient, type WhatsAppExecutionScope, type WhatsAppRelayOperation } from '../client.js';
import type { DbClient } from '../migrator.js';
import { AuditEventRepository } from './audit.js';
import type { ApprovalRecord } from './approvals.js';
import type { WhatsAppDurableState, WhatsAppStateStore, WhatsAppStateTransaction } from './whatsapp-state.js';

const denied = () => new ForbiddenError('WhatsApp durable storage unavailable or unauthorized.');
type Database = Pick<TransactionalDbClient, 'withScopedTransaction' | 'withWhatsAppRelayTransaction'>;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Requires separately reviewed/applied 1083 SQL. Never migrates or opens its own privileged pool. */
export class PostgresWhatsAppStateStore implements WhatsAppStateStore {
  private readonly connectionActorCache = new Map<string, { workspaceId: string; userId: string; role: AuthenticatedScope['role'] }>();

  constructor(private readonly db: Database) {}

  private rememberConnectionActor(connectionId: string, scope: { workspaceId: string; userId: string; role: AuthenticatedScope['role'] }) {
    if (/^[a-zA-Z0-9_-]{1,128}$/.test(connectionId) && scope.workspaceId && scope.userId && ['owner', 'admin', 'member'].includes(scope.role)) {
      this.connectionActorCache.set(connectionId, {
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        role: scope.role
      });
    }
  }

  private async resolveOwnerSessionForActor(
    workspaceId: string,
    userId: string,
    role: AuthenticatedScope['role'],
    connectionId: string
  ): Promise<AuthenticatedScope | null> {
    if (!workspaceId || !userId || !['owner', 'admin', 'member'].includes(role)) return null;
    this.rememberConnectionActor(connectionId, { workspaceId, userId, role });
    const bootstrapScope: AuthenticatedScope = {
      workspaceId,
      userId,
      role,
      sessionTokenHash: '0'.repeat(64)
    };
    return this.db.withScopedTransaction(bootstrapScope, async tx => {
      const existing = await tx.query<{ token_hash: string }>(
        `SELECT token_hash FROM public.sessions
         WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > clock_timestamp() + interval '5 minutes'
         ORDER BY expires_at DESC LIMIT 1`,
        [workspaceId, userId]
      );
      let sessionTokenHash = existing.rows[0]?.token_hash;
      if (!sessionTokenHash) {
        const freshHash = randomBytes(32).toString('hex');
        const created = await tx.query<{ token_hash: string }>(
          `INSERT INTO public.sessions (user_id, workspace_id, token_hash, expires_at)
           VALUES ($1, $2, $3, clock_timestamp() + interval '7 days')
           RETURNING token_hash`,
          [userId, workspaceId, freshHash]
        );
        sessionTokenHash = created.rows[0]?.token_hash;
      }
      if (!sessionTokenHash) return null;
      return {
        workspaceId,
        userId,
        role,
        sessionTokenHash
      };
    });
  }

  async resolveAutoReplyOwnerScope(scope: WhatsAppExecutionScope, connectionId: string): Promise<AuthenticatedScope | null> {
    if (!isWhatsAppRelayScope(scope) && scope.sessionTokenHash) {
      this.rememberConnectionActor(connectionId, scope);
      return scope;
    }
    return this.resolveOwnerSessionForActor(scope.workspaceId, scope.userId, scope.role, connectionId);
  }

  async resolveAutoReplyOwnerScopeByConnection(connectionId: string): Promise<AuthenticatedScope | null> {
    const actor = this.connectionActorCache.get(connectionId);
    if (!actor) return null;
    return this.resolveOwnerSessionForActor(actor.workspaceId, actor.userId, actor.role, connectionId);
  }

  async listOwned(scope: AuthenticatedScope) {
    const caller = { ...scope };
    if (!caller.sessionTokenHash) throw denied();
    return this.db.withScopedTransaction(caller, async tx => {
      await this.authorize(tx, caller);
      const { rows } = await tx.query<{ connection_id: string; binding: MetaWhatsAppTestConfig; revision: string; disconnected: boolean }>(
        `SELECT connection_id, binding, revision, disconnected FROM public.whatsapp_n8n_connections
         WHERE workspace_id = $1 AND owner_user_id = $2 ORDER BY connection_id LIMIT 21`, [caller.workspaceId, caller.userId]);
      if (rows.length > 20) throw new AppError('Stored WhatsApp catalog is unavailable.', 'WHATSAPP_INBOX_UNAVAILABLE', 503);
      const result = rows.map(row => {
        const b = row.binding, revision = Number(row.revision);
        if (b.workspaceId !== caller.workspaceId || b.userId !== caller.userId || b.mode !== 'offline_test' || b.connectionId !== row.connection_id || !/^[a-zA-Z0-9_-]{1,128}$/.test(b.connectionId) || !Number.isSafeInteger(revision) || revision < 1 || b.revision !== revision || typeof row.disconnected !== 'boolean') throw denied();
        this.rememberConnectionActor(b.connectionId, caller);
        return { connectionId: b.connectionId, revision, disconnected: row.disconnected };
      });
      await this.authorize(tx, caller); return result;
    });
  }

  async resolveRelay(tokenHash: string, connectionId: string, operation: WhatsAppRelayOperation) {
    if (!this.db.withWhatsAppRelayTransaction) throw denied();
    return this.db.withWhatsAppRelayTransaction(tokenHash, connectionId, operation, async (_tx, scope) => {
      this.rememberConnectionActor(connectionId, scope);
      return scope;
    });
  }

  private async authorize(tx: DbClient, scope: WhatsAppExecutionScope) {
    if (isWhatsAppRelayScope(scope)) {
      const { rows } = await tx.query<any>('SELECT * FROM public.current_whatsapp_runtime_scope()');
      const a = rows[0];
      if (rows.length !== 1 || !a || a.workspace_id !== scope.workspaceId || a.user_id !== scope.userId || a.role !== scope.role || a.principal_id !== scope.principalId || a.connection_id !== scope.connectionId || Number(a.revision) !== scope.revision || a.relay_operation !== scope.operation) throw denied();
      return;
    }
    const { rows } = await tx.query<{ workspace_id: string; user_id: string; role: string }>(
      `SELECT a.workspace_id, a.user_id, a.role FROM public.current_authenticated_scope() a
       JOIN public.sessions s ON s.workspace_id = a.workspace_id AND s.user_id = a.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()`, [scope.sessionTokenHash]);
    const actual = rows[0];
    if (!actual || actual.workspace_id !== scope.workspaceId || actual.user_id !== scope.userId || actual.role !== scope.role || !['owner', 'admin', 'member'].includes(actual.role)) throw denied();
  }

  private async writeAudit(tx: DbClient, scope: WhatsAppExecutionScope, connectionId: string, action: string,
    details: { dispatchId?: string; revision?: number; messages?: number; statuses?: number }, writeVersion: number) {
    if (!Number.isSafeInteger(writeVersion) || writeVersion < 1) throw denied();
    const payload = { ...details, ...(isWhatsAppRelayScope(scope) ? { actorKind: 'whatsapp_relay', principalId: scope.principalId, relayOperation: scope.operation } : {}) };
    const audit = await new AuditEventRepository(tx).create(scope.workspaceId, action, 'whatsapp_connection', payload, scope.userId, connectionId);
    // DB-owned issuer records provenance; missing/old/mismatched proofs never authorize persistence.
    const { rows } = await tx.query<{ audit_id: string }>(
      `SELECT audit_id FROM public.whatsapp_n8n_audit_proofs
       WHERE workspace_id = $1 AND owner_user_id = $2 AND connection_id = $3 AND audit_id = $4
         AND audit_action = $5 AND transaction_id = pg_current_xact_id() AND write_version = $6
         AND bound_dispatch_id IS NOT DISTINCT FROM $7::uuid`,
      [scope.workspaceId, scope.userId, connectionId, audit.id, action, writeVersion, details.dispatchId ?? null]);
    if (rows.length !== 1 || rows[0]?.audit_id !== audit.id) throw denied();
    return audit.id;
  }

  /** Internal offline provisioning only; no API route and no credentials accepted. Never overwrites a tombstone. */
  async createOffline(scope: AuthenticatedScope, input: MetaWhatsAppTestConfig): Promise<void> {
    // Project known configuration fields; unknown fields/credential properties cannot reach SQL.
    const binding: MetaWhatsAppTestConfig = {
      mode: input.mode, connectionId: input.connectionId, revision: input.revision, workspaceId: input.workspaceId,
      userId: input.userId, businessAccountId: input.businessAccountId, phoneNumberId: input.phoneNumberId,
      graphVersion: input.graphVersion, recipients: input.recipients.map(r => ({ id: r.id, phoneE164: r.phoneE164, optedIn: r.optedIn }))
    };
    if (binding.mode !== 'offline_test' || binding.revision !== 1 || binding.workspaceId !== scope.workspaceId || binding.userId !== scope.userId || !/^[a-zA-Z0-9_-]{1,128}$/.test(binding.connectionId) || binding.recipients.length < 1 || binding.recipients.length > 50 || new Set(binding.recipients.map(r => r.id)).size !== binding.recipients.length || new Set(binding.recipients.map(r => r.phoneE164)).size !== binding.recipients.length) throw denied();
    await this.db.withScopedTransaction({ ...scope }, async tx => {
      await this.authorize(tx, scope);
      const auditId = await this.writeAudit(tx, scope, binding.connectionId, 'whatsapp.durable.created', { revision: 1 }, 1);
      const result = await tx.query(
        `INSERT INTO public.whatsapp_n8n_connections (workspace_id, owner_user_id, connection_id, binding, revision, disconnected, row_version, audit_id)
         VALUES ($1, $2, $3, $4::jsonb, 1, false, 1, $5) ON CONFLICT DO NOTHING RETURNING connection_id`,
        [scope.workspaceId, scope.userId, binding.connectionId, JSON.stringify(binding), auditId]);
      if (result.rows.length !== 1) throw denied();
      await this.authorize(tx, scope);
    });
  }

  async transaction<T>(scope: WhatsAppExecutionScope, connectionId: string, operation: (tx: WhatsAppStateTransaction) => Promise<T>): Promise<T> {
    const caller = { ...scope }, key = [caller.workspaceId, caller.userId, connectionId];
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(connectionId) || (isWhatsAppRelayScope(caller) ? ('sessionTokenHash' in caller || caller.connectionId !== connectionId) : !caller.sessionTokenHash)) throw denied();
    this.rememberConnectionActor(connectionId, caller);
    const execute = async (client: DbClient) => {
      await this.authorize(client, caller);
      // All mutations, disconnects and callback reconciliation share this lock, including across pools.
      const { rows } = await client.query<{ binding: MetaWhatsAppTestConfig; revision: string; disconnected: boolean; row_version: string }>(
        `SELECT binding, revision, disconnected, row_version FROM public.whatsapp_n8n_connections
         WHERE workspace_id = $1 AND owner_user_id = $2 AND connection_id = $3 FOR UPDATE`, key);
      const row = rows[0];
      if (!row || row.binding.workspaceId !== caller.workspaceId || row.binding.userId !== caller.userId || row.binding.connectionId !== connectionId || Number(row.revision) !== row.binding.revision || !Number.isSafeInteger(Number(row.row_version))) throw denied();
      const messages = await client.query<{ record: WhatsAppDurableState['messages'][number]; media_metadata?: MetaWhatsAppStoredMedia | null; auto_reply_metadata?: WhatsAppStoredAutoReplyMetadata | null }>(
        `SELECT record, media_metadata, auto_reply_metadata FROM public.whatsapp_n8n_messages WHERE workspace_id = $1 AND owner_user_id = $2 AND connection_id = $3 ORDER BY provider_message_id LIMIT 1001`, key);
      const dispatches = await client.query<{ record: WhatsAppDurableState['dispatches'][number] }>(
        `SELECT record FROM public.whatsapp_n8n_dispatches WHERE workspace_id = $1 AND owner_user_id = $2 AND connection_id = $3 ORDER BY dispatch_id LIMIT 1001`, key);
      const events = await client.query<{ record: WhatsAppDurableState['events'][number]; failure_metadata?: WhatsAppStoredFailureMetadata | null }>(
        `SELECT record, failure_metadata FROM public.whatsapp_n8n_status_events WHERE workspace_id = $1 AND owner_user_id = $2 AND connection_id = $3 ORDER BY event_key LIMIT 2001`, key);
      if (messages.rows.length > 1000 || dispatches.rows.length > 1000 || events.rows.length > 2000) throw denied();
      const state: WhatsAppDurableState = { binding: row.binding, disconnected: row.disconnected, messages: messages.rows.map(r => {
        if (r.media_metadata != null && !isMetaWhatsAppStoredMedia(r.media_metadata)) throw denied();
        if (r.auto_reply_metadata != null && !isWhatsAppStoredAutoReplyMetadata(r.auto_reply_metadata)) throw denied();
        return { ...r.record, ...(r.media_metadata != null ? { media: r.media_metadata } : {}), ...(r.auto_reply_metadata != null ? { autoReply: r.auto_reply_metadata } : {}) };
      }), dispatches: dispatches.rows.map(r => r.record), events: events.rows.map(r => {
        if (r.failure_metadata != null && (r.record?.status !== 'failed' || !isWhatsAppStoredFailureMetadata(r.failure_metadata))) throw denied();
        return { ...r.record, ...(r.failure_metadata != null ? { failure: r.failure_metadata } : {}) };
      }) };
      const before = structuredClone(state);
      let auditId: string | undefined;
      const tx: WhatsAppStateTransaction = {
        state,
        assertAuthorized: () => this.authorize(client, caller),
        approval: async id => {
          const { rows: approvals } = await client.query<ApprovalRecord>(
            isWhatsAppRelayScope(caller) ? 'SELECT * FROM public.whatsapp_runtime_approval($1::uuid)' : `SELECT * FROM public.approval_requests WHERE workspace_id = $1 AND requester_user_id = $2 AND id = $3 FOR UPDATE`, isWhatsAppRelayScope(caller) ? [id] : [...key.slice(0, 2), id]);
          const a = approvals[0]; if (!a) return null;
          return { id: a.id, workspaceId: a.workspace_id, requesterUserId: a.requester_user_id, approverUserId: a.approver_user_id,
            actionName: a.action_name, actionParams: a.action_params, status: a.status, riskLevel: a.risk_level,
            createdAt: new Date(a.created_at).toISOString(), updatedAt: new Date(a.updated_at).toISOString(), expiresAt: new Date(a.expires_at).toISOString() } as ApprovalRequest;
        },
        createAutoReplyApproval: async (draft: MetaWhatsAppSendInput) => {
          if (isWhatsAppRelayScope(caller)) throw denied();
          await this.authorize(client, caller);
          const { rows: created } = await client.query<{ id: string }>(
            `INSERT INTO public.approval_requests (workspace_id, action_name, action_params, requester_user_id, approver_user_id, status, risk_level, expires_at)
             VALUES ($1, 'whatsapp.meta.messages.send', $2::jsonb, $3, $3, 'approved', 'high', clock_timestamp() + interval '1 hour')
             RETURNING id`,
            [caller.workspaceId, JSON.stringify(draft), caller.userId]
          );
          const approvalId = created[0]?.id;
          if (!approvalId) throw denied();
          await new AuditEventRepository(client).create(
            caller.workspaceId,
            'approval.approved',
            'approval_request',
            { status: 'approved', source: 'whatsapp_customer_auto_reply' },
            caller.userId,
            approvalId
          );
          return approvalId;
        },
        audit: async (action, details) => {
          if (!/^whatsapp\.durable\.(events|reserved|claimed|receipt|unknown|disconnected|contacts_updated|appointment_confirmed|appointment_rescheduled|appointment_cancelled)$/.test(action)) throw denied();
          const safe = { dispatchId: details.dispatchId, revision: details.revision, messages: details.messages, statuses: details.statuses };
          auditId = await this.writeAudit(client, caller, connectionId, action, safe, Number(row.row_version) + 1);
        }
      };
      const result = await operation(tx);
      await tx.assertAuthorized();
      if (!equal(before, state)) {
        if (!auditId) throw denied();
        await this.save(client, key, Number(row.row_version), before, state, auditId);
      }
      await tx.assertAuthorized();
      return structuredClone(result);
    };
    if (isWhatsAppRelayScope(caller)) {
      if (!this.db.withWhatsAppRelayTransaction) throw denied();
      return this.db.withWhatsAppRelayTransaction(caller.relayTokenHash, connectionId, caller.operation, async (client, actual) => {
        if (actual.principalId !== caller.principalId || actual.workspaceId !== caller.workspaceId || actual.userId !== caller.userId || actual.role !== caller.role || actual.revision !== caller.revision) throw denied();
        return execute(client);
      });
    }
    return this.db.withScopedTransaction(caller, execute);
  }

  private async save(client: DbClient, key: string[], version: number, before: WhatsAppDurableState, state: WhatsAppDurableState, auditId: string) {
    // No delete/reconnect path. Immutable rows and consumed claims survive disconnect/restart.
    if (!Number.isSafeInteger(version + 1) || state.messages.length < before.messages.length || state.events.length < before.events.length || state.dispatches.length < before.dispatches.length) throw denied();
    const updated = await client.query(
      `UPDATE public.whatsapp_n8n_connections SET binding = $5::jsonb, revision = $6, disconnected = $7, row_version = row_version + 1, audit_id = $8
       WHERE workspace_id = $1 AND owner_user_id = $2 AND connection_id = $3 AND row_version = $4 RETURNING row_version`,
      [...key, version, JSON.stringify(state.binding), state.binding.revision, state.disconnected, auditId]);
    if (updated.rows.length !== 1) throw denied();
    for (const message of state.messages) {
      const old = before.messages.find(m => m.providerMessageId === message.providerMessageId);
      if (old) { if (!equal(old, message)) throw denied(); continue; }
      const { media, autoReply, ...record } = message;
      if (media && !isMetaWhatsAppStoredMedia(media)) throw denied();
      if (autoReply && !isWhatsAppStoredAutoReplyMetadata(autoReply)) throw denied();
      await client.query(
        `INSERT INTO public.whatsapp_n8n_messages (workspace_id, owner_user_id, connection_id, provider_message_id, recipient_id, record, audit_id, media_metadata, auto_reply_metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9::jsonb)`, [...key, message.providerMessageId, message.recipientId, JSON.stringify(record), auditId, media ? JSON.stringify(media) : null, autoReply ? JSON.stringify(autoReply) : null]);
    }
    for (const event of state.events) {
      const old = before.events.find(e => e.key === event.key);
      if (old) { if (!equal(old, event)) throw denied(); continue; }
      const { failure, ...record } = event;
      if (failure && (record.status !== 'failed' || !isWhatsAppStoredFailureMetadata(failure))) throw denied();
      await client.query(
        `INSERT INTO public.whatsapp_n8n_status_events (workspace_id, owner_user_id, connection_id, event_key, record, audit_id, failure_metadata)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)`, [...key, event.key, JSON.stringify(record), auditId, failure ? JSON.stringify(failure) : null]);
    }
    for (const dispatch of state.dispatches) {
      const old = before.dispatches.find(d => d.id === dispatch.id);
      if (old && equal(old, dispatch)) continue;
      if (dispatch.parameterHash !== computeCanonicalParameterHash(dispatch.draft) || dispatch.receipt.verified !== false || dispatch.receipt.mode !== 'offline_test' || dispatch.receipt.dispatchId !== dispatch.id || (old && (!equal(old.draft, dispatch.draft) || old.approvalId !== dispatch.approvalId || old.createdAt !== dispatch.createdAt || old.expiresAt !== dispatch.expiresAt || (old.claimedAt !== null && old.claimedAt !== dispatch.claimedAt)))) throw denied();
      if (old) {
        // An UPSERT would invoke the BEFORE INSERT reservation guard on an already-consumed claim.
        await client.query(
          `UPDATE public.whatsapp_n8n_dispatches SET claimed_at_ms = $5, provider_message_id = $6, record = $7::jsonb, audit_id = $8
           WHERE workspace_id = $1 AND owner_user_id = $2 AND connection_id = $3 AND dispatch_id = $4`,
          [...key, dispatch.id, dispatch.claimedAt, dispatch.receipt.providerMessageId, JSON.stringify(dispatch), auditId]);
      } else {
        await client.query(
          `INSERT INTO public.whatsapp_n8n_dispatches (workspace_id, owner_user_id, connection_id, dispatch_id, idempotency_key, parameter_hash, approval_id, created_at_ms, expires_at_ms, claimed_at_ms, provider_message_id, record, audit_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)`,
          [...key, dispatch.id, dispatch.draft.idempotencyKey, dispatch.parameterHash, dispatch.approvalId, dispatch.createdAt, dispatch.expiresAt, dispatch.claimedAt, dispatch.receipt.providerMessageId, JSON.stringify(dispatch), auditId]);
      }
    }
  }
}
