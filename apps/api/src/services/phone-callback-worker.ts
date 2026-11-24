import { createHash } from 'node:crypto';
import type { DbClient } from '@thaara/db';
import { AppError, ForbiddenError } from '@thaara/observability';
import {
  createCallbackNotificationDispatcher, type CallbackMailTransport, type CallbackNotificationGrant,
  type CallbackRequest, type CallbackScope, type NotificationResult,
} from './phone-callback-notification.js';
import { createPhoneCallbackQueue } from './phone-callback-queue.js';

/** Dedicated service-role connection. It never receives or creates an owner browser session. */
export function createPhoneCallbackWorker(options: {
  db: DbClient;
  scope: Readonly<CallbackScope>;
  credential(): Promise<string>;
  transport: CallbackMailTransport;
}) {
  if (Object.keys(options.scope).sort().join(',') !== 'userId,workspaceId' ||
      ![options.scope.workspaceId, options.scope.userId].every(value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value))) {
    throw new ForbiddenError('Phone notification worker requires a service-only scope.');
  }
  const scope = Object.freeze({ workspaceId: options.scope.workspaceId, userId: options.scope.userId });
  const unavailable = () => new AppError('Phone notification worker is unavailable.', 'PHONE_CALLBACK_WORKER_UNAVAILABLE', 503);
  async function operation<T>(provided: CallbackScope, name: string, id?: string, attempt?: string,
    outcome?: NotificationResult, providerId?: string, approvalId?: string): Promise<T> {
    if (provided.workspaceId !== scope.workspaceId || provided.userId !== scope.userId) throw new ForbiddenError('Phone notification worker scope denied.');
    try {
      const credential = await options.credential();
      if (typeof credential !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(credential)) throw unavailable();
      const hash = createHash('sha256').update(credential).digest('hex');
      const result = await options.db.query<{ result: CallbackScope & { data: T } }>(
        'SELECT public.phone_callback_worker_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',
        [hash, scope.workspaceId, scope.userId, name, id ?? null, attempt ?? null, outcome ?? null, providerId ?? null, approvalId ?? null]);
      const receipt = result.rows[0]?.result;
      if (result.rows.length !== 1 || !receipt || receipt.workspaceId !== scope.workspaceId || receipt.userId !== scope.userId || !('data' in receipt)) throw unavailable();
      return receipt.data;
    } catch { throw unavailable(); }
  }
  const repository = {
    read: (provided: CallbackScope, id: string) => operation<CallbackRequest | null>(provided, 'read', id),
    claim: (provided: CallbackScope, id: string, attempt: string, approvalId?: string) => operation<number | null>(provided, 'claim', id, attempt, undefined, undefined, approvalId),
    finish: async (provided: CallbackScope, id: string, attempt: string, outcome: NotificationResult, providerId?: string) => {
      await operation<boolean>(provided, 'finish', id, attempt, outcome, providerId);
    },
    pending: (provided: CallbackScope) => operation<string[]>(provided, 'pending'),
    recoverInterrupted: async (provided: CallbackScope) => { await operation(provided, 'recover'); },
  };
  const notify = createCallbackNotificationDispatcher({ repository, transport: options.transport,
    currentOwnerGrant: provided => operation<CallbackNotificationGrant>(provided, 'grant') });
  const drain = createPhoneCallbackQueue({ repository, notify });
  return { run: () => drain(scope) };
}
