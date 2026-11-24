import { computeCanonicalParameterHash } from '@thaara/contracts';
import { AuditEventRepository, type TransactionalDbClient, type DbClient } from '@thaara/db';
import { AppError, ForbiddenError } from '@thaara/observability';
import { createPostgresPhoneCallLedger } from './phone-calls-postgres.js';
import { createPhoneStructuredCallbackStoreForReview, type PhoneStructuredCompletion } from './phone-structured-callback-store.js';
import type { AdmittedCallbackCall, CallbackRequest } from './phone-callback-notification.js';
import type { InboundPrincipalPool } from './phone-inbound-principal-postgres.js';

/** Explicit opt-in. Existing live callers retain their current ledger until the reviewed snapshot schema is installed. */
export function createCallbackAwarePhoneCallLedger(db: TransactionalDbClient) {
  return { ...createPostgresPhoneCallLedger(db), async bindCallbackNumber(scope: import('@thaara/db').AuthenticatedScope, callId: string, phone: string, draftHash: string) {
    if (scope.role !== 'owner' || !/^\+[1-9][0-9]{7,14}$/.test(phone)) throw new ForbiddenError('Callback dispatch number denied.');
    await db.withScopedTransaction(scope, async tx => {
      const saved = await tx.query(`INSERT INTO public.phone_callback_dispatch_numbers(workspace_id,owner_user_id,call_id,phone_e164,draft_hash)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING call_id`, [scope.workspaceId, scope.userId, callId, phone, draftHash]);
      if (!saved.rows.length) {
        const existing = await tx.query('SELECT call_id FROM public.phone_callback_dispatch_numbers WHERE workspace_id=$1 AND owner_user_id=$2 AND call_id=$3 AND phone_e164=$4 AND draft_hash=$5',
          [scope.workspaceId, scope.userId, callId, phone, draftHash]);
        if (!existing.rows.length) throw new ForbiddenError('Callback dispatch snapshot conflict.');
      } else await new AuditEventRepository(tx).create(scope.workspaceId, 'phone.callback.dispatch_number_bound', 'phone_call', { callId }, scope.userId, callId);
    });
  } };
}

/** Called only after the existing Sarvam capability/attempt gate. Both report and callback commit together. */
export function createPhoneCallbackOutboundCompletion(pool: InboundPrincipalPool) {
  const unavailable = () => new AppError('Outbound callback completion could not be verified.', 'PHONE_CALLBACK_OUTBOUND_UNAVAILABLE', 503);
  return async (completion: PhoneStructuredCompletion,
    project: (binding: Omit<AdmittedCallbackCall, 'callId' | 'direction' | 'turns'>) => CallbackRequest | null) => {
    let connection: Awaited<ReturnType<InboundPrincipalPool['connect']>>;
    try { connection = await pool.connect(); } catch { throw unavailable(); }
    let discard = false;
    try {
      await connection.query('BEGIN');
      await connection.query("SET LOCAL statement_timeout='5s'");
      await connection.query("SET LOCAL lock_timeout='1s'");
      const { rows } = await connection.query<{ binding: Omit<AdmittedCallbackCall, 'callId' | 'direction' | 'turns'> }>(
        'SELECT public.phone_callback_outbound_context($1,$2,$3) AS binding', [completion.callId, completion.providerRequestId, completion.providerCallId]);
      if (rows.length !== 1 || !rows[0]?.binding) throw Error('binding');
      const request = project(rows[0].binding);
      const reportStatus = await createPhoneStructuredCallbackStoreForReview(connection as DbClient).completeReport(completion);
      if (request && reportStatus !== 'ignored') {
        const result = await connection.query<{ receipt: { saved: boolean; requestId: string } }>(
          'SELECT public.phone_callback_outbound_save($1,$2,$3,$4::jsonb,$5) AS receipt',
          [completion.callId, completion.providerRequestId, completion.providerCallId, JSON.stringify(request), computeCanonicalParameterHash({ ...request })]);
        if (result.rows[0]?.receipt?.saved !== true || result.rows[0].receipt.requestId !== request.id) throw Error('receipt');
      }
      try { await connection.query('COMMIT'); } catch (error) { discard = true; throw error; }
    } catch {
      try { await connection.query('ROLLBACK'); } catch { discard = true; }
      throw unavailable();
    } finally { try { connection.release(discard); } catch { throw unavailable(); } }
  };
}
