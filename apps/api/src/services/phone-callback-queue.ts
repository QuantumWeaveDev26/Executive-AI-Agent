import type { CallbackScope } from './phone-callback-notification.js';

/** Bounded drain for a trusted, explicitly scoped runtime. Atomic claims arbitrate concurrent drains. */
export function createPhoneCallbackQueue(options: {
  repository: { recoverInterrupted(scope: CallbackScope): Promise<void>; pending(scope: CallbackScope): Promise<string[]> };
  notify(scope: CallbackScope, id: string): Promise<string>;
}) {
  return async (scope: CallbackScope) => {
    await options.repository.recoverInterrupted(scope);
    const ids = await options.repository.pending(scope);
    const results: { id: string; result: string }[] = [];
    for (const id of ids.slice(0, 25)) {
      const result = await options.notify(scope, id);
      results.push({ id, result });
      if (result === 'not_configured' || result === 'awaiting_owner_authorization') break;
    }
    return results;
  };
}
