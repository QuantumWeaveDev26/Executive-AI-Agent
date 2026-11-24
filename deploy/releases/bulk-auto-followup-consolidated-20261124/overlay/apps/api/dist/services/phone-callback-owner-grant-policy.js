import { PhoneCallbackNotificationGrantInputSchema } from '@thaara/contracts';
import { ActionRegistry, PolicyGateway } from '@thaara/policy';
export const PHONE_CALLBACK_GRANT_ACTION = 'phone.callback.authorize_notifications';
const registry = new ActionRegistry();
registry.register({ metadata: {
        name: PHONE_CALLBACK_GRANT_ACTION, actionClass: 'write', risk: 'medium', approvalMode: 'explicit',
        idempotencyRequired: true, requiredRole: 'owner', auditRequired: true, capabilityScope: 'external_connector',
        schemaIdentifier: 'phone.callback.authorize_notifications.v1', timeoutMs: 5000,
        retryPolicy: { maxRetries: 0, backoffMs: 0, exponential: false },
    }, inputSchema: PhoneCallbackNotificationGrantInputSchema });
export const phoneCallbackGrantPolicy = new PolicyGateway({ registry });
