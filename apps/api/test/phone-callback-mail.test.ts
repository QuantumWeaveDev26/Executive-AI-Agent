import { expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { createConfiguredPhoneCallbackMailTransport, createPhoneCallbackMailTransport, PHONE_CALLBACK_RECIPIENT, PHONE_CALLBACK_SENDER } from '../src/services/phone-callback-mail.js';
import { formatCallbackEmail, type CallbackRequest } from '../src/services/phone-callback-notification.js';
import { sarvamWebhookToken } from '../src/services/phone-sarvam-calls.js';
import { phoneSarvamWebhookRoutes } from '../src/routes/phone-sarvam-webhook.js';

const email = { ...formatCallbackEmail({ name: 'Synthetic Caller', business: null, service: null, phoneNumber: '+919000000001' }),
  from: 'phone@example.test', to: PHONE_CALLBACK_RECIPIENT, idempotencyKey: 'callback:' + 'a'.repeat(64) };

it('requires explicit enablement, verified domain and the owner-selected sender before reading a secret', async () => {
  const apiKey = vi.fn(async () => 'synthetic-only');
  const send = vi.fn<typeof fetch>();
  for (const environment of [{}, { THAARA_PHONE_CALLBACK_ENABLED: 'true' },
    { THAARA_PHONE_CALLBACK_ENABLED: 'true', THAARA_PHONE_CALLBACK_DOMAIN_VERIFIED: 'true', THAARA_PHONE_CALLBACK_SENDER: 'wrong@example.test' }]) {
    const transport = createConfiguredPhoneCallbackMailTransport({ environment, apiKey, fetch: send });
    expect(await transport.ready!()).toBe(false);
    expect(await transport.send({ ...email, from: PHONE_CALLBACK_SENDER })).toBe('not_submitted');
  }
  expect(apiKey).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it('posts only the fixed recipient and exact plain text via the dedicated transport', async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'provider-abc' }));
  const transport = createPhoneCallbackMailTransport({ sender: email.from, sendingEnabled: true, apiKey: async () => 'synthetic', fetch: send });
  await expect(transport.send({ ...email, to: 'wrong@example.test' })).resolves.toBe('rejected');
  expect(send).not.toHaveBeenCalled();
  await expect(transport.send(email)).resolves.toEqual({ acceptedId: 'provider-abc' });
  expect(send).toHaveBeenCalledTimes(1);
  const [url, options] = send.mock.calls[0]!;
  expect(url).toBe('https://api.resend.com/emails');
  expect(options).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'Idempotency-Key': email.idempotencyKey } });
  expect(JSON.parse(options!.body as string)).toEqual({ from: email.from, to: ['connect@brandmintai.io'], subject: 'Thaara AI — New Callback Request',
    text: 'New Callback Request\n\nName: Synthetic Caller\nPhone: +919000000001\nBusiness: Not provided\nService Needed: Not provided' });
});

it.each([[429, 'not_submitted'], [401, 'rejected'], [409, 'unknown'], [503, 'unknown'], [200, 'unknown']])(
  'classifies provider HTTP %s as %s without disclosing provider content', async (status, outcome) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: 'private provider response' }, { status: Number(status) }));
    const transport = createPhoneCallbackMailTransport({ sender: email.from, sendingEnabled: true, apiKey: async () => 'synthetic', fetch: send });
    await expect(transport.send(email)).resolves.toBe(outcome);
  },
);

it('admits an outbound Sarvam completion before projecting one callback from repeated events', async () => {
  const app = Fastify();
  const secret = 'synthetic-secret-with-more-than-32-characters';
  const callId = '10000000-0000-4000-8000-000000000001';
  const providerRequestId = 'attempt123';
  const records = new Map<string, CallbackRequest>();
  const projectFinal = vi.fn();
  try {
    await phoneSarvamWebhookRoutes(app, { webhookSecret: async () => secret,
      store: { binding: vi.fn().mockResolvedValue({ providerRequestId }), apply: vi.fn(), transcript: vi.fn() },
      async completeWithCallback(completion, project) {
        projectFinal();
        expect(completion.providerRequestId).toBe(providerRequestId);
        const request = project({ workspaceId: 'tenant', userId: 'owner', occurredAt: '2026-11-09T00:00:00Z', verifiedNumber: '+919000000001' });
        if (request && !records.has(request.id)) records.set(request.id, request);
      },
    });
    const payload = { attempt_id: providerRequestId, status: 'connected', webhook_config: { metadata: { thaara_call_id: callId } },
      final_agent_variables: { customer_name: 'Synthetic', business_type: 'Test', requested_service: 'Automation', callback_preference: 'yes',
        recipient: 'wrong@example.test', user_phone_number: '+919000000099' },
      interaction_transcript: [{ role: 'agent', en_text: 'Synthetic, Test, Automation. May I record a callback request?' }, { role: 'user', en_text: 'Yes' }] };
    const path = '/connectors/phone/sarvam/calls/' + callId + '/';
    expect((await app.inject({ method: 'POST', url: path + 'a'.repeat(64), payload })).statusCode).toBe(403);
    expect(records.size).toBe(0);
    const signed = path + sarvamWebhookToken(secret, callId);
    expect((await app.inject({ method: 'POST', url: signed, payload: { ...payload, attempt_id: 'different' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: signed, payload: { ...payload, status: 'failed' } })).statusCode).toBe(200);
    expect(projectFinal).not.toHaveBeenCalled();
    for (let index = 0; index < 2; index++) {
      expect((await app.inject({ method: 'POST', url: signed, payload })).statusCode).toBe(200);
    }
    expect([...records.values()]).toMatchObject([{ direction: 'outbound', phoneNumber: '+919000000001', notificationStatus: 'pending' }]);
  } finally { await app.close(); }
});
