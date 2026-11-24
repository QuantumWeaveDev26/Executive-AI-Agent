import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApprovalRepository, PhoneContactRepository } from '@thaara/db';
import { phoneContactsDatabase } from './helpers/phone-contacts-fixture.js';
import { captureInboundFixtureAdmin } from './helpers/phone-inbound-fixture-identity.js';
import { createCallbackAwarePhoneCallLedger, createPhoneCallbackOutboundCompletion } from '../src/services/phone-callback-outbound-store.js';
import { createPostgresPhoneCallbackStore } from '../src/services/phone-calls-postgres.js';
import { createPhoneCallingStore } from '../src/services/phone-calling-store.js';
import { createPostgresPhoneContactDirectory } from '../src/services/phone-contacts-postgres.js';
import { PhoneCallingService } from '../src/services/phone-calling.js';
import { PhoneCallbackNotificationRepository } from '../src/services/phone-callback-notification-store.js';
import { phoneSarvamWebhookRoutes } from '../src/routes/phone-sarvam-webhook.js';
import { sarvamWebhookToken } from '../src/services/phone-sarvam-calls.js';
import { createPhoneCallbackWorker } from '../src/services/phone-callback-worker.js';
import { PHONE_CALLBACK_SENDER } from '../src/services/phone-callback-mail.js';

describe.skipIf(process.env.THAARA_PHONE115_SQL_TEST_APPROVED !== 'in-memory-only')('outbound callback database integration', () => {
  let fixture: Awaited<ReturnType<typeof phoneContactsDatabase>>;
  let administrator: Awaited<ReturnType<typeof captureInboundFixtureAdmin>>;
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  beforeAll(async () => {
    fixture = await phoneContactsDatabase({ live: true });
    await fixture.db.exec('RESET ROLE');
    administrator = await captureInboundFixtureAdmin(fixture.db);
    await fixture.db.query("SELECT set_config('thaara.step115_review_approved','in-memory-only',false),set_config('thaara.step115_target_database',current_database(),false),set_config('thaara.enable_phone_structured_report_114','approved',false)");
    for (const path of ['114-phone-structured-report.review.sql', '115-phone-callback-notification.review.sql',
      '115g-phone-callback-grants.review.sql', '115w-phone-callback-worker.review.sql', '115o-phone-callback-outbound.review.sql']) {
      await fixture.db.exec(readFileSync(root + 'docs/migrations/' + path, 'utf8'));
    }
    await fixture.db.exec('SET ROLE thaara_app');
  }, 60_000);
  afterAll(async () => { if (fixture) { if (administrator) await administrator.restore(); await fixture.db.close(); } });

  it('snapshots only the approved dialed number and commits completion, outbox and one notification', async () => {
    const { db, owner, foreign } = fixture;
    const contact = { displayName: 'Synthetic', aliases: [], phoneE164: '+919000000001', consent: { callingAllowed: true,
      reference: 'callback-fixture', source: 'recipient_verbal' as const, recordedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString() } };
    const contacts = new PhoneContactRepository(db);
    await contacts.create(owner, 'callback-contact', contact);
    const ledger = createCallbackAwarePhoneCallLedger(db);
    const dispatch = vi.fn(async () => {
      const snapshot = await db.withScopedTransaction(owner, tx => tx.query('SELECT phone_e164 FROM public.phone_callback_dispatch_numbers'));
      expect(snapshot.rows).toEqual([{ phone_e164: contact.phoneE164 }]);
      return { status: 'unverified' as const, providerRequestId: 'synthetic-attempt' };
    });
    const calls = new PhoneCallingService({ store: createPhoneCallingStore(db), calls: ledger, contacts: createPostgresPhoneContactDirectory(db),
      live: { provider: { name: 'sarvam', liveCallingEnabled: true, dispatch }, store: ledger } });
    const prepared = await calls.prepare(owner, { contactQuery: 'Synthetic', purpose: 'Ask about interest in automation.', language: 'en-IN', maxDurationSeconds: 300 });
    await expect(calls.placeCall(owner, prepared.approvalId)).rejects.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
    await db.withScopedTransaction(owner, tx => new ApprovalRepository(tx).transitionStatus(owner.workspaceId, prepared.approvalId, 'pending', 'approved', owner.userId));
    const call = await calls.placeCall(owner, prepared.approvalId);
    expect(dispatch).toHaveBeenCalledTimes(1);
    await expect(db.withScopedTransaction(owner, tx => tx.query('DELETE FROM public.phone_callback_dispatch_numbers WHERE call_id=$1', [call.id]))).rejects.toThrow('permission denied');
    await expect(db.withScopedTransaction(owner, tx => tx.query("UPDATE public.phone_callback_dispatch_numbers SET phone_e164='+919000000099' WHERE call_id=$1", [call.id]))).rejects.toThrow('permission denied');
    await contacts.update(owner, 'callback-contact', 1, { ...contact, phoneE164: '+919000000099' });
    const app = Fastify();
    const secret = 'synthetic-webhook-secret-more-than-32-characters';
    let corrupt = true;
    const complete = createPhoneCallbackOutboundCompletion({ connect: async () => ({ query: db.query.bind(db), release: () => {} }) });
    await phoneSarvamWebhookRoutes(app, { store: createPostgresPhoneCallbackStore(db), webhookSecret: async () => secret,
      completeWithCallback: (completion, project) => complete(completion, binding => {
        const request = project(binding);
        return request && corrupt ? { ...request, workspaceId: foreign.workspaceId } : request;
      }) });
    const payload = { attempt_id: 'synthetic-attempt', interaction_id: '20261111/outbound-fixture', status: 'connected',
      webhook_config: { metadata: { thaara_call_id: call.id } },
      final_agent_variables: { callback_preference: 'yes', customer_name: 'Synthetic', business_type: 'Retail', requested_service: 'Automation' },
      interaction_transcript: [{ role: 'agent', en_text: 'Synthetic, Retail, Automation. Should I share your callback request with our team?' }, { role: 'user', en_text: 'Yes' }] };
    const path = '/connectors/phone/sarvam/calls/' + call.id + '/';
    try {
      expect((await app.inject({ method: 'POST', url: path + 'a'.repeat(64), payload })).statusCode).toBe(403);
      const url = path + sarvamWebhookToken(secret, call.id);
      expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(409);
      expect((await ledger.load(owner, call.id))?.record.state).toBe('queued');
      corrupt = false;
      for (let index = 0; index < 2; index++) expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(200);
      const callbacks = new PhoneCallbackNotificationRepository(db, owner);
      expect(await callbacks.list(owner)).toMatchObject([{ callId: call.id, direction: 'outbound', phoneNumber: contact.phoneE164, notificationStatus: 'pending' }]);
      expect(await new PhoneCallbackNotificationRepository(db, foreign).list(foreign)).toEqual([]);
      const proposal = await callbacks.prepareNotificationGrant(owner, new Date(Date.now() + 86_400_000).toISOString());
      await db.withScopedTransaction(owner, tx => new ApprovalRepository(tx).transitionStatus(owner.workspaceId, proposal.approvalId, 'pending', 'approved', owner.userId));
      await callbacks.activateNotificationGrant(owner, proposal.approvalId);
      await administrator.restore();
      const credential = randomBytes(32).toString('hex');
      await db.query(`INSERT INTO public.phone_callback_worker_principals(workspace_id,owner_user_id,approval_id,token_hash,expires_at)
        VALUES($1,$2,$3,$4,clock_timestamp()+interval '1 hour')`, [owner.workspaceId, owner.userId, proposal.approvalId, createHash('sha256').update(credential).digest('hex')]);
      await db.exec('SET SESSION AUTHORIZATION thaara_phone_notify');
      const send = vi.fn(async () => ({ acceptedId: 'outbound-provider-accepted' }));
      const worker = createPhoneCallbackWorker({ db, scope: { workspaceId: owner.workspaceId, userId: owner.userId }, credential: async () => credential,
        transport: { sender: PHONE_CALLBACK_SENDER, send } });
      await worker.run();
      await worker.run();
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]).toBeDefined();
      await administrator.restore();
      await db.exec('SET ROLE thaara_app');
      expect(await callbacks.list(owner)).toMatchObject([{ notificationStatus: 'submitted', attempts: 1, phoneNumber: contact.phoneE164 }]);
    } finally { await app.close(); }
  });

  it('records a known pre-dispatch failure when the callback snapshot cannot be saved', async () => {
    const { db, owner } = fixture;
    const ledger = createCallbackAwarePhoneCallLedger(db);
    const dispatch = vi.fn();
    const calls = new PhoneCallingService({ store: createPhoneCallingStore(db), contacts: createPostgresPhoneContactDirectory(db), calls: ledger,
      live: { store: { ...ledger, bindCallbackNumber: async () => { throw Error('Synthetic snapshot failure'); } },
        provider: { name: 'sarvam', liveCallingEnabled: true, dispatch } } });
    const prepared = await calls.prepare(owner, { contactQuery: 'Synthetic', purpose: 'Ask about automation requirements.', language: 'en-IN' });
    await db.withScopedTransaction(owner, tx => new ApprovalRepository(tx).transitionStatus(owner.workspaceId, prepared.approvalId, 'pending', 'approved', owner.userId));
    const result = await calls.placeCall(owner, prepared.approvalId);
    expect(result).toMatchObject({ state: 'failed', dispatchStatus: 'failed' });
    expect(result.report.text).toContain('callback number could not be saved');
    expect((await calls.placeCall(owner, prepared.approvalId)).id).toBe(result.id);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not create a callback from a transcript ignored by an already completed legacy call', async () => {
    const { db, owner } = fixture;
    const ledger = createCallbackAwarePhoneCallLedger(db);
    const calls = new PhoneCallingService({ store: createPhoneCallingStore(db), contacts: createPostgresPhoneContactDirectory(db), calls: ledger,
      live: { store: ledger, provider: { name: 'sarvam', liveCallingEnabled: true,
        dispatch: async () => ({ status: 'unverified', providerRequestId: 'legacy-attempt' }) } } });
    const prepared = await calls.prepare(owner, { contactQuery: 'Synthetic', purpose: 'Ask about the project.', language: 'en-IN' });
    await db.withScopedTransaction(owner, tx => new ApprovalRepository(tx).transitionStatus(owner.workspaceId, prepared.approvalId, 'pending', 'approved', owner.userId));
    const call = await calls.placeCall(owner, prepared.approvalId);
    const secret = 'synthetic-legacy-webhook-secret-more-than-32-characters';
    const url = '/connectors/phone/sarvam/calls/' + call.id + '/' + sarvamWebhookToken(secret, call.id);
    const payload = { attempt_id: 'legacy-attempt', interaction_id: '20261111/legacy-fixture', status: 'connected',
      webhook_config: { metadata: { thaara_call_id: call.id } },
      final_agent_variables: { callback_preference: 'yes', customer_name: 'Synthetic', business_type: 'Retail', requested_service: 'Automation' },
      interaction_transcript: [{ role: 'agent', en_text: 'Synthetic, Retail, Automation. May I record a callback request?' }, { role: 'user', en_text: 'Yes' }] };
    const legacy = Fastify();
    const current = Fastify();
    await phoneSarvamWebhookRoutes(legacy, { store: createPostgresPhoneCallbackStore(db), webhookSecret: async () => secret });
    await phoneSarvamWebhookRoutes(current, { store: createPostgresPhoneCallbackStore(db), webhookSecret: async () => secret,
      completeWithCallback: createPhoneCallbackOutboundCompletion({ connect: async () => ({ query: db.query.bind(db), release: () => {} }) }) });
    try {
      expect((await legacy.inject({ method: 'POST', url, payload })).statusCode).toBe(200);
      expect((await ledger.load(owner, call.id))?.record.state).toBe('completed');
      expect((await current.inject({ method: 'POST', url, payload })).statusCode).toBe(200);
      expect((await new PhoneCallbackNotificationRepository(db, owner).list(owner)).some(row => row.callId === call.id)).toBe(false);
    } finally { await legacy.close(); await current.close(); }
  });
});
