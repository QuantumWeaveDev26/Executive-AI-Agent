import {
  createCallbackCapture, createCallbackNotificationDispatcher,
  type AdmittedCallbackCall, type CallbackMailTransport, type CallbackNotificationGrant, type CallbackRepository, type CallbackScope,
} from './phone-callback-notification.js';
import { createPhoneCallbackQueue } from './phone-callback-queue.js';
import { readCallbackReports } from './phone-callback-reports.js';

/** Server-only composition. Admission and repository ports must be bound to the reviewed provider identity. */
export function createPhoneCallbackRuntime<Input>(options: {
  admit(input: Input): Promise<AdmittedCallbackCall | null>;
  repository: CallbackRepository & {
    recoverInterrupted(scope: CallbackScope): Promise<void>;
    pending(scope: CallbackScope): Promise<string[]>;
    list(scope: CallbackScope): Promise<import('./phone-callback-notification.js').CallbackRequest[]>;
  };
  transport: CallbackMailTransport;
  currentOwnerGrant(scope: CallbackScope): Promise<CallbackNotificationGrant | null>;
}) {
  const repository = options.repository;
  const notify = createCallbackNotificationDispatcher(options);
  return {
    async receive(input: Input, details: unknown) {
      // Capture returns only after the repository commits. Delivery remains in the durable queue.
      return createCallbackCapture({ admit: options.admit, repository })(input, details);
    },
    drain: createPhoneCallbackQueue({ repository, notify }),
    reports: (scope: CallbackScope & { role: string }) => readCallbackReports(scope, value => repository.list(value)),
  };
}
