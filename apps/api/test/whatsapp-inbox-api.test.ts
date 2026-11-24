import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { defaultPolicyGateway } from '@thaara/policy';
import { UnauthorizedError } from '@thaara/observability';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { whatsappDurableInboxRoutes } from '../src/routes/whatsapp-inbox.js';
import { WhatsAppTransactionalFixture, waScope, waBinding, waEvent, waNow, waDraft, waApproval } from './helpers/whatsapp-durable-fixture.js';
const path = '/api/v1/connectors/whatsapp/n8n/durable/' + waBinding.connectionId + '/inbox';
async function fixture(configured = true) {
  const store = new WhatsAppTransactionalFixture(), service = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow);
  const app = Fastify({ logger: false });
  app.decorateRequest('scope', undefined);
  app.addHook('onRequest', async request => { if (request.headers.cookie === 'fixture=owner') request.scope = waScope; });
  app.decorate('requireAuth', async request => { if (!request.scope) throw new UnauthorizedError('Fixture session required.'); });
  app.setErrorHandler((error: any, _req, reply) => reply.code(error.statusCode ?? 500).send({ code: error.code ?? 'ERROR', message: error.message }));
  await app.register(async child => whatsappDurableInboxRoutes(child, configured ? service : undefined), { prefix: '/api/v1' });
  return { store, service, app };
}
describe('versioned durable WhatsApp inbox HTTP read surface', () => {
  it('serializes correlated saved delivery events without upgrading verification or exposing recipient addresses', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(waNow);
    const f = await fixture(); try {
      await f.service.ingest(waScope, waBinding.connectionId, waEvent());
      await f.service.reserve(waScope, waBinding.connectionId, waDraft, waApproval().id);
      f.store.state.dispatches[0].claimedAt = waNow;
      f.store.state.dispatches[0].receipt.providerMessageId = 'wamid.outbound';
      f.store.state.events = [{ key: 'private-event-key', providerMessageId: 'wamid.outbound', recipientAddress: '15550000001', status: 'read', timestamp: String(waNow / 1000) }];
      const response = await f.app.inject({ url: path, headers: { cookie: 'fixture=owner' } });
      expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json().messages.find((m: any) => m.direction === 'outbound')).toMatchObject({ verified: false, deliveryEvents: [{ status: 'read', timestamp: new Date(waNow).toISOString() }] });
      expect(response.body).not.toContain('15550000001'); expect(response.body).not.toContain('private-event-key');
    } finally { await f.app.close(); vi.useRealTimers(); }
  });
  it('discovers safe connection metadata only for an authenticated user without payload scope claims', async () => {
    const f = await fixture(); try {
      (f.store as any).listOwned = async () => [{ connectionId: waBinding.connectionId, revision: 1, disconnected: false }];
      const url = '/api/v1/connectors/whatsapp/n8n/durable/connections';
      expect((await f.app.inject({ url })).statusCode).toBe(401);
      const r = await f.app.inject({ url, headers: { cookie: 'fixture=owner' } });
      expect(r.statusCode).toBe(200); expect(r.headers['cache-control']).toBe('no-store');
      expect(r.json()).toEqual({ mode: 'offline_test', liveSendingEnabled: false, connections: [{ connectionId: waBinding.connectionId, revision: 1, disconnected: false }] });
      expect(r.body).not.toContain(waScope.sessionTokenHash);
      expect((await f.app.inject({ url: url + '?workspaceId=other', headers: { cookie: 'fixture=owner' } })).statusCode).toBe(400);
    } finally { await f.app.close(); }
  });
  it('requires a user session; a bearer credential cannot authorize the browser inbox', async () => {
    const f = await fixture(); try {
      expect((await f.app.inject({ url: path })).statusCode).toBe(401);
      expect((await f.app.inject({ url: path, headers: { authorization: 'Bearer synthetic-relay' } })).statusCode).toBe(401);
    } finally { await f.app.close(); }
  });
  it('returns stored data under shared contracts, no-cache and no sensitive internals', async () => {
    const f = await fixture(); try {
      await f.service.ingest(waScope, waBinding.connectionId, waEvent());
      const r = await f.app.inject({ url: path + '?query=approvals&pageSize=1', headers: { cookie: 'fixture=owner' } });
      expect(r.statusCode).toBe(200); expect(r.headers['cache-control']).toBe('no-store');
      expect(r.json()).toMatchObject({ mode: 'offline_test', verified: false, liveSendingEnabled: false, messages: [{ recipientId: 'ram', status: 'received' }] });
      expect(r.body).not.toContain(waScope.sessionTokenHash); expect(r.body).not.toContain(waBinding.recipients[0]!.phoneE164);
    } finally { await f.app.close(); }
  });
  it('rejects tenant claims, oversized inputs, bad cursors and writes', async () => {
    const f = await fixture(); try {
      const headers = { cookie: 'fixture=owner' };
      for (const query of ['workspaceId=other', 'userId=other', 'pageSize=999', 'pageToken=invalid', 'query=' + 'x'.repeat(257)]) expect((await f.app.inject({ url: path + '?' + query, headers })).statusCode).toBe(400);
      expect((await f.app.inject({ method: 'POST', url: path, headers, payload: {} })).statusCode).toBe(404);
    } finally { await f.app.close(); }
  });
  it('fails safely when storage is absent or unavailable without exposing database errors', async () => {
    const missing = await fixture(false), f = await fixture(); try {
      expect((await missing.app.inject({ url: path, headers: { cookie: 'fixture=owner' } })).statusCode).toBe(503);
      f.store.transaction = async () => { throw new Error('private database credential and SQL details'); };
      const r = await f.app.inject({ url: path, headers: { cookie: 'fixture=owner' } });
      expect(r.statusCode).toBe(503); expect(r.body).not.toContain('private database');
    } finally { await f.app.close(); await missing.app.close(); }
  });
  it('lists authorized contacts with masked numbers and truthful 24-hour eligibility (Step 108.23)', async () => {
    const f = await fixture(); try {
      const url = '/api/v1/connectors/whatsapp/n8n/durable/' + waBinding.connectionId + '/contacts';
      expect((await f.app.inject({ url })).statusCode).toBe(401);
      expect((await f.app.inject({ url: url + '?x=1', headers: { cookie: 'fixture=owner' } })).statusCode).toBe(400);
      const closed = await f.app.inject({ url, headers: { cookie: 'fixture=owner' } });
      expect(closed.statusCode).toBe(200); expect(closed.headers['cache-control']).toBe('no-store');
      expect(closed.json().contacts.every((c: any) => c.eligibility !== 'eligible')).toBe(true);
      await f.service.ingest(waScope, waBinding.connectionId, waEvent());
      const open = (await f.app.inject({ url, headers: { cookie: 'fixture=owner' } })).json();
      expect(open.contacts.find((c: any) => c.lastInboundAt)).toMatchObject({ eligibility: 'eligible' });
      for (const c of open.contacts) expect(c.maskedPhone).toContain('*');
      expect(JSON.stringify(open)).not.toMatch(/\+?1555\d{7}/);
      const other = await f.service.contacts({ ...waScope, workspaceId: '22222222-2222-4222-8222-222222222222' }, waBinding.connectionId).catch(e => e);
      expect(other).toBeInstanceOf(Error);
    } finally { await f.app.close(); }
  });
});

