import type { CallbackMail, CallbackMailOutcome, CallbackMailTransport } from './phone-callback-notification.js';

export const PHONE_CALLBACK_RECIPIENT = 'connect@brandmintai.io';
export const PHONE_CALLBACK_SENDER = 'notifications@brandmintai.io';

export function createConfiguredPhoneCallbackMailTransport(options: {
  environment: Readonly<Record<string, string | undefined>>;
  apiKey: () => Promise<string>;
  fetch?: typeof fetch;
}): CallbackMailTransport {
  const environment = { ...options.environment };
  const enabled = environment.THAARA_PHONE_CALLBACK_ENABLED === 'true' &&
    environment.THAARA_PHONE_CALLBACK_DOMAIN_VERIFIED === 'true' &&
    environment.THAARA_PHONE_CALLBACK_SENDER === PHONE_CALLBACK_SENDER;
  return createPhoneCallbackMailTransport({ sender: PHONE_CALLBACK_SENDER, sendingEnabled: enabled,
    apiKey: options.apiKey, fetch: options.fetch });
}

export function isCallbackSender(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 &&
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value);
}

/** Dedicated transactional mail transport. Construct only inside the authorized Phone worker. */
export function createPhoneCallbackMailTransport(options: {
  sender: string;
  apiKey: () => Promise<string>;
  sendingEnabled?: boolean;
  fetch?: typeof fetch;
}): CallbackMailTransport {
  const { sender, apiKey, fetch: send = fetch } = options;
  if (!isCallbackSender(sender)) throw new Error('Phone callback sender is not configured.');
  return {
    sender,
    async ready() {
      if (options.sendingEnabled !== true) return false;
      try { const key = await apiKey(); return typeof key === 'string' && !!key && !/\s/.test(key); } catch { return false; }
    },
    async send(mail: CallbackMail): Promise<CallbackMailOutcome> {
      if (options.sendingEnabled !== true) return 'not_submitted';
      if (mail.from !== sender || mail.to !== PHONE_CALLBACK_RECIPIENT || !/^callback:[a-f0-9]{64}$/.test(mail.idempotencyKey)) return 'rejected';
      let key: string;
      try { key = await apiKey(); } catch { return 'not_submitted'; }
      if (typeof key !== 'string' || !key.trim() || /\s/.test(key)) return 'rejected';
      try {
        const response = await send('https://api.resend.com/emails', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8_000),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': mail.idempotencyKey },
          body: JSON.stringify({ from: sender, to: [PHONE_CALLBACK_RECIPIENT], subject: mail.subject, text: mail.bodyText }),
        });
        if (response.status === 429) return 'not_submitted';
        if ([400, 401, 403, 404, 422].includes(response.status)) return 'rejected';
        if (!response.ok) return 'unknown';
        const result: unknown = await response.json();
        return result && typeof result === 'object' && 'id' in result && typeof result.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(result.id)
          ? { acceptedId: result.id } : 'unknown';
      } catch { return 'unknown'; }
    },
  };
}
