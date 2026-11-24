import { computeCanonicalParameterHash } from '@thaara/contracts';
import type { DbClient } from '@thaara/db';
import { AppError } from '@thaara/observability';
import type { CallbackRequest } from './phone-callback-notification.js';

/** Use only in the already admitted inbound completion transaction, after its journal append. */
export async function savePhoneCallbackInInboundTransaction(tx: DbClient, request: CallbackRequest) {
  const snapshot = structuredClone(request);
  try {
    const result = await tx.query<{ receipt: { saved: boolean; requestId: string } }>(
      'SELECT public.phone_callback_inbound_save($1::jsonb,$2) AS receipt',
      [JSON.stringify(snapshot), computeCanonicalParameterHash({ ...snapshot })]);
    if (result.rows.length !== 1 || result.rows[0]?.receipt?.saved !== true || result.rows[0].receipt.requestId !== snapshot.id) throw Error('receipt');
  } catch { throw new AppError('Inbound callback save could not be verified.', 'PHONE_CALLBACK_INBOUND_SAVE_UNAVAILABLE', 503); }
}
