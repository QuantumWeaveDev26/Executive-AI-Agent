import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPolicyGateway } from '@thaara/policy';
import { ForbiddenError } from '@thaara/observability';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { whatsappN8nRoutes } from '../src/routes/whatsapp-n8n.js';
import { WhatsAppTransactionalFixture, waScope, waBinding, waDraft, waApproval, waEvent, waNow } from './helpers/whatsapp-durable-fixture.js';
const secret = 'synthetic_durable_callback_secret_1085', hash = createHash('sha256').update(secret).digest('hex');
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(waNow); }); afterEach(() => vi.useRealTimers());
async function fixture() {
  const store = new WhatsAppTransactionalFixture() as any;
  store.resolveRelay = vi.fn(async (digest: string, id: string, operation: string) => {
    if (digest !== hash || id !== waBinding.connectionId || !store.authorized || store.state.disconnected) throw new ForbiddenError('Denied');
    return { authKind: 'whatsapp_relay', workspaceId: waScope.workspaceId, userId: waScope.userId, role: waScope.role, principalId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', relayTokenHash: digest, connectionId: id, revision: 1, operation };
  });
  const service = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow), app = Fastify({ logger: false });
  app.decorate('requireAuth', async () => {}); app.decorateRequest('scope', undefined);
  app.setErrorHandler((e: any, _req, reply) => reply.code(e.statusCode ?? 500).send({ code: e.code ?? 'ERROR' }));
  await app.register(async child => (whatsappN8nRoutes as any)(child, undefined, service), { prefix: '/api/v1' });
  const path = '/api/v1/connectors/whatsapp/n8n/relay/' + waBinding.connectionId;
  const call = (suffix: string, payload: unknown, headers = { authorization: 'Bearer ' + secret } as any) => app.inject({ method: 'POST', url: path + suffix, headers, payload });
  return { store, service, app, call };
}
describe('durable callback protocol; synthetic scope/transaction fixture, not PostgreSQL proof', () => {
  it.each(['image', 'document', 'audio'] as const)('accepts authenticated synthetic %s events and rejects unauthenticated replay', async kind => {
    const f = await fixture(); try {
      const source = waEvent(), original = source.messages[0]!;
      const event = { ...source, messages: [{ id: original.id, from: original.from, timestamp: original.timestamp, type: kind,
        [kind]: { id: '123456789', mime_type: kind === 'image' ? 'image/jpeg' : kind === 'audio' ? 'audio/ogg; codecs=opus' : 'application/pdf', sha256: 'a'.repeat(64) } }] };
      expect((await f.call('/events', { event }, {})).statusCode).toBe(403);
      expect(f.store.state.messages).toHaveLength(0);
      expect((await f.call('/events', { event })).json()).toMatchObject({ acceptedMessages: 1 });
      expect((await f.call('/events', { event })).json()).toMatchObject({ duplicates: 1 });
      expect(f.store.state.messages[0]).toMatchObject({ media: { kind, downloadStatus: 'not_downloaded' } });
      expect(f.store.state.dispatches).toHaveLength(0);
    } finally { await f.app.close(); }
  });
  it('authenticates a distinct callback identity and deduplicates stored incoming events', async () => {
    const f = await fixture(); try {
      expect((await f.call('/events', { event: waEvent() })).json()).toMatchObject({ acceptedMessages: 1 });
      expect((await f.call('/events', { event: waEvent() })).json()).toMatchObject({ acceptedMessages: 0, duplicates: 1 });
      expect(f.store.resolveRelay).toHaveBeenCalledWith(hash, waBinding.connectionId, 'events'); expect(f.store.state.dispatches).toHaveLength(0);
    } finally { await f.app.close(); }
  });
  it('rejects wrong/missing secrets, browser cookies and payload authority before mutation', async () => {
    const f = await fixture(); try {
      for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: 'Bearer ' + secret, cookie: 'anything=1' }]) expect((await f.call('/events', { event: waEvent() }, headers)).statusCode).toBe(403);
      expect((await f.call('/events', { event: waEvent(), workspaceId: waScope.workspaceId })).statusCode).toBe(400);
      expect(f.store.state.messages).toHaveLength(0);
    } finally { await f.app.close(); }
  });
  it('consumes an exactly approved dispatch once, keeps sending disabled and correlates acknowledgements', async () => {
    const f = await fixture(); try {
      await f.service.ingest(waScope, waBinding.connectionId, waEvent()); const reserved = await f.service.reserve(waScope, waBinding.connectionId, waDraft, waApproval().id);
      const results = await Promise.all([f.call('/claim', { dispatchId: reserved.dispatchId, connectionRevision: 1 }), f.call('/claim', { dispatchId: reserved.dispatchId, connectionRevision: 1 })]);
      expect(results.map(r => r.statusCode).sort()).toEqual([200, 403]); expect(results.find(r => r.statusCode === 200)!.json()).toMatchObject({ dispatchEnabled: false });
      expect((await f.call('/receipts', { dispatchId: reserved.dispatchId, providerMessageId: 'wamid.synthetic1085', recipientAddress: '15550000001' })).json()).toMatchObject({ status: 'unverified', verified: false });
      const eventScope = await f.store.resolveRelay(hash, waBinding.connectionId, 'events');
      await expect(f.service.claim(eventScope, waBinding.connectionId, reserved.dispatchId!, 1)).rejects.toThrow();
      await expect(f.service.disconnect(eventScope as any, waBinding.connectionId)).rejects.toThrow();
    } finally { await f.app.close(); }
  });
  it('fails safely on unavailable principal storage and fences revoked membership', async () => {
    const f = await fixture(); try {
      f.store.resolveRelay.mockRejectedValueOnce(new Error('private SQL or credential details'));
      const failed = await f.call('/events', { event: waEvent() }); expect(failed.statusCode).toBe(503); expect(failed.body).not.toContain('private');
      f.store.authorized = false; expect((await f.call('/events', { event: waEvent() })).statusCode).toBe(403);
      expect(f.store.state.messages).toHaveLength(0);
    } finally { await f.app.close(); }
  });
});
