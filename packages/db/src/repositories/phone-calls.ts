import type { AuthenticatedScope, DbClient, TransactionalDbClient } from '../client.js';
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from '../errors.js';
import { AuditEventRepository } from './audit.js';

/** Requires reviewed `docs/migrations/110a` + `110b` (+ `110c` for live mode). Not part of the installed chain. */
export type PhoneCallState = 'queued' | 'ringing' | 'answered' | 'completed' | 'failed' | 'cancelled' | 'busy' | 'no_answer';
export type PhoneDispatchStatus = 'not_applicable' | 'pending' | 'claimed' | 'unverified' | 'failed' | 'unknown';
export interface PhoneCallRow {
  callId: string; approvalId: string; draft: Record<string, unknown>; draftHash: string; mode: 'simulation' | 'live'; state: PhoneCallState;
  report: Record<string, unknown>; eventSequence: number; providerCallId: string | null; providerRequestId: string | null;
  dispatchStatus: PhoneDispatchStatus; createdAt: string; updatedAt: string;
}
export interface PhoneCallEventRow { eventId: string; sequence: number; kind: 'state' | 'recipient_final' | 'interruption'; state: PhoneCallState | null; text: string | null; eventHash: string }
export interface PhoneCallClaim { callId: string; approvalId: string; draft: Record<string, unknown> & { contactId: string; contactRevision: number; idempotencyKey: string; mode: string }; draftHash: string; report: Record<string, unknown> }
export type PhoneDispatchResult = { status: 'unverified'; providerRequestId: string } | { status: 'failed' | 'unknown'; code: string };

// to_jsonb keeps reads working on the 110b schema (no dispatch columns) and the 110c schema alike.
const SELECT = 'SELECT to_jsonb(c.*) AS r FROM public.phone_calls c';
type Json = Record<string, unknown>;
const toRow = ({ r }: { r: Json }): PhoneCallRow => ({
  callId: String(r.call_id), approvalId: String(r.approval_id), draft: r.draft as Json, draftHash: String(r.draft_hash), mode: r.mode as PhoneCallRow['mode'],
  state: r.state as PhoneCallState, report: r.report as Json, eventSequence: Number(r.event_sequence),
  providerCallId: (r.provider_call_id as string | null) ?? null, providerRequestId: (r.provider_request_id as string | null) ?? null,
  dispatchStatus: (r.dispatch_status as PhoneDispatchStatus | undefined) ?? 'not_applicable',
  createdAt: new Date(String(r.created_at)).toISOString(), updatedAt: new Date(String(r.updated_at)).toISOString(),
});

/** Durable call ledger: one call per approval, fenced state changes and an append-only event log, audited in the same transaction. */
export class PhoneCallRepository {
  constructor(private readonly db: TransactionalDbClient) {}

  private run<T>(scope: AuthenticatedScope, work: (tx: DbClient) => Promise<T>): Promise<T> {
    if (!scope.sessionTokenHash || !['owner', 'admin', 'member'].includes(scope.role ?? '')) throw new ForbiddenError('Phone calls require an active member session.');
    return this.db.withScopedTransaction(scope, work);
  }

  private async one(tx: DbClient, scope: AuthenticatedScope, callId: string, lock = false) {
    const { rows } = await tx.query<{ r: Json }>(`${SELECT} WHERE c.workspace_id=$1 AND c.owner_user_id=$2 AND c.call_id=$3${lock ? ' FOR UPDATE' : ''}`, [scope.workspaceId, scope.userId, callId]);
    return rows[0] ? toRow(rows[0]) : null;
  }

  /** Returns the existing call for a replayed approval only when the stored draft is identical. */
  /**
   * `dailyLiveLimit`: hard cap on new live calls per owner in any rolling 24 hours (all attempts count, answered or not).
   * Checked under a per-owner transaction lock, so parallel confirmations cannot both slip under the limit.
   */
  async claim(scope: AuthenticatedScope, c: PhoneCallClaim, options: { dailyLiveLimit?: number } = {}): Promise<{ call: PhoneCallRow; created: boolean }> {
    return this.run(scope, async (tx) => {
      const live = c.draft.mode === 'live';
      if (live && options.dailyLiveLimit !== undefined) {
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`thaara-phone-live:${scope.workspaceId}:${scope.userId}`]);
      }
      const existing = await tx.query<{ r: Json }>(`${SELECT} WHERE c.workspace_id=$1 AND c.approval_id=$2`, [scope.workspaceId, c.approvalId]);
      if (existing.rows[0]) {
        const call = toRow(existing.rows[0]);
        if (call.draftHash !== c.draftHash) throw new ForbiddenError('This approval was already used for a different call.');
        return { call, created: false };
      }
      if (live && options.dailyLiveLimit !== undefined) {
        const { rows: counted } = await tx.query<{ n: string | number }>(`SELECT count(*) AS n FROM public.phone_calls
          WHERE workspace_id=$1 AND owner_user_id=$2 AND mode='live' AND created_at > clock_timestamp() - interval '24 hours'`, [scope.workspaceId, scope.userId]);
        if (Number(counted[0]?.n ?? 0) >= options.dailyLiveLimit) {
          throw new DomainError(`Thaara's daily call limit (${options.dailyLiveLimit} in 24 hours) has been reached. No call was made.`, 'PHONE_DAILY_CALL_LIMIT', 429);
        }
      }
      // A concurrent claim of the same approval loses on the unique constraint and gets a clean conflict, never a second call.
      const { rows } = await tx.query<{ r: Json }>(`WITH c AS (INSERT INTO public.phone_calls (workspace_id, owner_user_id, call_id, approval_id, draft, draft_hash, idempotency_key,
          contact_id, contact_revision, mode, state, report${live ? ', dispatch_status' : ''}) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,'queued',$11::jsonb${live ? ",'pending'" : ''}) RETURNING *)
          SELECT to_jsonb(c.*) AS r FROM c`,
        [scope.workspaceId, scope.userId, c.callId, c.approvalId, JSON.stringify(c.draft), c.draftHash, c.draft.idempotencyKey, c.draft.contactId,
          c.draft.contactRevision, c.draft.mode, JSON.stringify(c.report)]).catch((e: { code?: string }) => {
        if (e?.code === '23505') throw new ConflictError('This approval is already being used for a call. Reload call history.');
        throw e;
      });
      const call = toRow(rows[0]!);
      await new AuditEventRepository(tx).create(scope.workspaceId!, 'phone.ai.call_claimed', 'phone_call', { callId: call.callId, approvalId: c.approvalId, mode: c.draft.mode }, scope.userId, call.callId);
      return { call, created: true };
    });
  }

  async list(scope: AuthenticatedScope, limit = 100): Promise<PhoneCallRow[]> {
    return this.run(scope, async (tx) => (await tx.query<{ r: Json }>(`${SELECT} WHERE c.workspace_id=$1 AND c.owner_user_id=$2
      ORDER BY c.created_at DESC, c.call_id LIMIT $3`, [scope.workspaceId, scope.userId, Math.min(Math.max(1, limit), 100)])).rows.map(toRow));
  }

  async load(scope: AuthenticatedScope, callId: string): Promise<{ call: PhoneCallRow; events: PhoneCallEventRow[] } | null> {
    if (!/^[0-9a-f-]{36}$/i.test(callId)) return null;
    return this.run(scope, async (tx) => {
      const call = await this.one(tx, scope, callId);
      if (!call) return null;
      const events = await tx.query<{ event_id: string; sequence: string | number; kind: PhoneCallEventRow['kind']; state: PhoneCallState | null; text: string | null; event_hash: string }>(
        `SELECT event_id, sequence, kind, state, text, event_hash FROM public.phone_call_events WHERE workspace_id=$1 AND owner_user_id=$2 AND call_id=$3 ORDER BY sequence`,
        [scope.workspaceId, scope.userId, callId]);
      return { call, events: events.rows.map((e) => ({ eventId: e.event_id, sequence: Number(e.sequence), kind: e.kind, state: e.state, text: e.text, eventHash: e.event_hash })) };
    });
  }

  /** Appends one event and the resulting state/report atomically. The row lock plus sequence check serialise concurrent writers. */
  async appendEvent(scope: AuthenticatedScope, callId: string, event: Omit<PhoneCallEventRow, 'sequence'> & { sequence: number }, next: { state: PhoneCallState; report: Record<string, unknown> }): Promise<PhoneCallRow> {
    return this.run(scope, async (tx) => {
      const current = await this.one(tx, scope, callId, true);
      if (!current) throw new NotFoundError('Phone call not found.');
      if (current.eventSequence + 1 !== event.sequence) throw new ConflictError('Phone call event out of order.');
      await tx.query(`INSERT INTO public.phone_call_events (workspace_id, owner_user_id, call_id, event_id, sequence, kind, state, text, event_hash)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [scope.workspaceId, scope.userId, callId, event.eventId, event.sequence, event.kind, event.state, event.text, event.eventHash]);
      await tx.query(`UPDATE public.phone_calls SET state=$4, report=$5::jsonb, event_sequence=$6 WHERE workspace_id=$1 AND owner_user_id=$2 AND call_id=$3`,
        [scope.workspaceId, scope.userId, callId, next.state, JSON.stringify(next.report), event.sequence]);
      await new AuditEventRepository(tx).create(scope.workspaceId!, 'phone.ai.call_event', 'phone_call', { callId, eventId: event.eventId, kind: event.kind, state: next.state }, scope.userId, callId);
      return (await this.one(tx, scope, callId))!;
    });
  }

  /** Live outbox, step 1: pending -> claimed exactly once. Returns null if another worker already claimed it. */
  async claimDispatch(scope: AuthenticatedScope, callId: string): Promise<PhoneCallRow | null> {
    return this.run(scope, async (tx) => {
      // Only the worker whose UPDATE actually changed pending -> claimed gets a row back; everyone else must not dial.
      const { rows } = await tx.query<{ call_id: string }>(`UPDATE public.phone_calls SET dispatch_status='claimed'
        WHERE workspace_id=$1 AND owner_user_id=$2 AND call_id=$3 AND mode='live' AND dispatch_status='pending' RETURNING call_id`, [scope.workspaceId, scope.userId, callId]);
      if (rows.length !== 1) return null;
      const call = (await this.one(tx, scope, callId))!;
      await new AuditEventRepository(tx).create(scope.workspaceId!, 'phone.ai.dispatch_claimed', 'phone_call', { callId }, scope.userId, callId);
      return call;
    });
  }

  /** Live outbox, step 2: record the provider acknowledgement once. `unverified` is acceptance, not a call outcome. */
  async recordDispatch(scope: AuthenticatedScope, callId: string, result: PhoneDispatchResult): Promise<PhoneCallRow> {
    return this.run(scope, async (tx) => {
      const params = result.status === 'unverified' ? [result.status, null, result.providerRequestId] : [result.status, result.code, null];
      const { rows } = await tx.query<{ call_id: string }>(`UPDATE public.phone_calls SET dispatch_status=$4, dispatch_code=$5, provider_request_id=$6
        WHERE workspace_id=$1 AND owner_user_id=$2 AND call_id=$3 AND dispatch_status='claimed' RETURNING call_id`, [scope.workspaceId, scope.userId, callId, ...params]);
      if (rows.length !== 1) throw new ConflictError('Phone call dispatch already recorded.');
      const call = (await this.one(tx, scope, callId))!;
      await new AuditEventRepository(tx).create(scope.workspaceId!, 'phone.ai.dispatch_recorded', 'phone_call', { callId, status: result.status, code: result.status === 'unverified' ? null : result.code }, scope.userId, callId);
      return call;
    });
  }
}

/**
 * Provider callback path. No user session exists, so this runs only the reviewed SECURITY DEFINER function, which re-checks
 * the dispatch binding. Callers MUST have verified the provider signature, pinned URL and nonce first.
 */
/** `source`: 'verbatim' = our own speech-to-text; 'provider_english' = the call provider's English rendering (may be translated). */
export async function appendPhoneProviderTranscript(db: DbClient, e: { callId: string; providerCallId: string; eventId: string; text: string; eventHash: string; source: 'verbatim' | 'provider_english' }): Promise<'applied' | 'duplicate' | 'ignored'> {
  const { rows } = await db.query<{ result: 'applied' | 'duplicate' | 'ignored' }>('SELECT public.append_phone_provider_transcript($1,$2,$3,$4,$5,$6) AS result',
    [e.callId, e.providerCallId, e.eventId, e.text, e.eventHash, e.source]);
  return rows[0]!.result;
}

export async function applyPhoneProviderEvent(db: DbClient, e: { callId: string; providerRequestId: string; providerCallId: string; state: PhoneCallState; eventId: string; eventHash: string }): Promise<'applied' | 'duplicate' | 'ignored'> {
  const { rows } = await db.query<{ result: 'applied' | 'duplicate' | 'ignored' }>('SELECT public.apply_phone_provider_event($1,$2,$3,$4,$5,$6) AS result',
    [e.callId, e.providerRequestId, e.providerCallId, e.state, e.eventId, e.eventHash]);
  return rows[0]!.result;
}
