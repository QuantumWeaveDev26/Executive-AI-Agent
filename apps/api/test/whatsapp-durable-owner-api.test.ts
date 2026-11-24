import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defaultPolicyGateway } from '@thaara/policy';
import { UnauthorizedError, CsrfError } from '@thaara/observability';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { whatsappDurableInboxRoutes } from '../src/routes/whatsapp-inbox.js';
import { whatsappN8nRoutes } from '../src/routes/whatsapp-n8n.js';
import { verifyCsrfToken } from '../src/crypto/csrf.js';
import { WhatsAppTransactionalFixture, waScope, waBinding, waDraft, waApproval, waEvent, waNow } from './helpers/whatsapp-durable-fixture.js';

const prefix = '/api/v1/connectors/whatsapp/n8n', base = prefix + '/durable/' + waBinding.connectionId;
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(waNow); });
afterEach(() => vi.useRealTimers());
const headers = { cookie: 'fixture=owner; thaara_csrf=synthetic-owner-csrf', 'x-csrf-token': 'synthetic-owner-csrf' };
async function fixture(configured = true) {
  const store = new WhatsAppTransactionalFixture(), service = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow);
  const app = Fastify({ logger: false }); await app.register(cookie); app.decorateRequest('scope', undefined);
  app.addHook('onRequest', async req => { if (req.cookies.fixture === 'owner') req.scope = waScope; });
  app.decorate('requireAuth', async req => {
    if (!req.scope) throw new UnauthorizedError('Session required.');
    if (['POST','DELETE','PUT','PATCH'].includes(req.method) && !verifyCsrfToken(req.headers['x-csrf-token'] as string, req.cookies.thaara_csrf)) throw new CsrfError('CSRF required.');
  });
  app.setErrorHandler((error: any, _req, reply) => reply.code(error.statusCode ?? 500).send({ code: error.code ?? 'ERROR' }));
  await app.register(async child => whatsappDurableInboxRoutes(child, configured ? service : undefined), { prefix: '/api/v1' });
  await app.register(async child => whatsappN8nRoutes(child, undefined, configured ? service : undefined), { prefix: '/api/v1' });
  await service.ingest(waScope, waBinding.connectionId, waEvent());
  return { app, store, service };
}
const payload = () => ({ draft: structuredClone(waDraft), approvalId: waApproval().id });
describe('durable owner controls; transactional fixture, no provider traffic', () => {
  it('reserves an exact approved draft idempotently through both durable and existing dispatch endpoints without sending', async () => {
    const f = await fixture(); try {
      const first = await f.app.inject({ method: 'POST', url: base + '/dispatches', headers, payload: payload() });
      expect(first.statusCode).toBe(200); expect(first.json()).toMatchObject({ mode: 'offline_test', status: 'not_configured', verified: false });
      const second = await f.app.inject({ method: 'POST', url: prefix + '/dispatches', headers, payload: payload() });
      expect(second.statusCode).toBe(200); expect(second.json()).toEqual(first.json());
      expect(f.store.state.dispatches).toHaveLength(1); expect(f.store.state.dispatches[0].claimedAt).toBeNull();
      const status = await f.app.inject({ url: base + '/status', headers });
      expect(status.statusCode).toBe(200); expect(status.headers['cache-control']).toBe('no-store');
      expect(status.json()).toMatchObject({ storage: 'postgresql_offline', liveSendingEnabled: false, configured: false, revision: 1, disconnected: false });
      expect(status.body).not.toContain(waScope.sessionTokenHash);
    } finally { await f.app.close(); }
  });
  it('requires browser auth and CSRF; machine credentials never authorize owner controls', async () => {
    const f = await fixture(); try {
      for (const authHeaders of [{}, { authorization: 'Bearer ' + 'a'.repeat(43) }]) {
        expect((await f.app.inject({ url: base + '/status', headers: authHeaders })).statusCode).toBe(401);
        expect((await f.app.inject({ method: 'POST', url: base + '/dispatches', headers: authHeaders, payload: payload() })).statusCode).toBe(401);
      }
      for (const method of ['POST','DELETE'] as const) expect((await f.app.inject({ method, url: base + (method === 'POST' ? '/dispatches' : '/connection'), headers: { cookie: headers.cookie }, ...(method === 'POST' ? { payload: payload() } : {}) })).statusCode).toBe(403);
      expect(f.store.state.dispatches).toHaveLength(0); expect(f.store.state.disconnected).toBe(false);
    } finally { await f.app.close(); }
  });
  it('rejects extra authority, mismatched path, wrong approval and changed draft before reserving', async () => {
    const f = await fixture(); try {
      for (const change of [{ workspaceId: 'foreign' }, { draft: { ...waDraft, userId: 'foreign' } }]) {
        const result = await f.app.inject({ method: 'POST', url: base + '/dispatches', headers, payload: { ...payload(), ...change } });
        expect(result.statusCode).toBe(400);
      }
      for (const data of [{ ...payload(), approvalId: 'missing' }, { ...payload(), draft: { ...waDraft, bodyText: 'changed after approval' } }, { ...payload(), draft: { ...waDraft, connectionRevision: 2 } }]) {
        expect((await f.app.inject({ method: 'POST', url: base + '/dispatches', headers, payload: data })).statusCode).toBe(403);
      }
      expect((await f.app.inject({ method: 'POST', url: base.replace(waBinding.connectionId,'another') + '/dispatches', headers, payload: payload() })).statusCode).toBe(403);
      expect(f.store.state.dispatches).toHaveLength(0);
    } finally { await f.app.close(); }
  });
  it('disconnects with an audited revision fence and rejects subsequent reservations', async () => {
    const f = await fixture(); try {
      const result = await f.app.inject({ method: 'DELETE', url: base + '/connection', headers });
      expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ disconnected: true, revision: 2 });
      expect((await f.app.inject({ method: 'DELETE', url: base + '/connection', headers })).json()).toEqual(result.json());
      expect((await f.app.inject({ method: 'POST', url: base + '/dispatches', headers, payload: payload() })).statusCode).toBe(403);
      expect(f.store.audits.filter(a => a.action === 'whatsapp.durable.disconnected')).toHaveLength(1);
      expect((await f.app.inject({ url: base + '/status', headers })).json()).toMatchObject({ disconnected: true, revision: 2 });
    } finally { await f.app.close(); }
  });
  it('fails closed for absent storage and sanitizes storage errors', async () => {
    const missing = await fixture(false), broken = await fixture(); try {
      expect((await missing.app.inject({ url: base + '/status', headers })).statusCode).toBe(503);
      broken.store.transaction = async () => { throw Error('private SQL connection password'); };
      for (const method of ['GET','POST','DELETE'] as const) {
        const r = await broken.app.inject({ method, url: base + (method === 'GET' ? '/status' : method === 'POST' ? '/dispatches' : '/connection'), headers, ...(method === 'POST' ? { payload: payload() } : {}) });
        expect(r.statusCode).toBe(503); expect(r.body).not.toContain('private');
      }
    } finally { await missing.app.close(); await broken.app.close(); }
  });
});

describe('POST reply-drafts (owner only, builds an unsent draft)', () => {
  it('returns a server-built draft with no-store, requires session and CSRF, rejects extra fields and unconfigured storage', async () => {
    const f = await fixture(); try {
      const ok = await f.app.inject({ method: 'POST', url: base + '/reply-drafts', headers, payload: { recipientId: 'ram', bodyText: 'Noted, thanks.' } });
      expect(ok.statusCode).toBe(200); expect(ok.headers['cache-control']).toBe('no-store');
      expect(ok.json()).toMatchObject({ liveSendingEnabled: false, draft: { senderPhoneNumberId: waBinding.phoneNumberId, recipientId: 'ram' } });
      expect(f.store.state.dispatches).toHaveLength(0);
      expect((await f.app.inject({ method: 'POST', url: base + '/reply-drafts', payload: { recipientId: 'ram', bodyText: 'x' } })).statusCode).toBe(401);
      expect((await f.app.inject({ method: 'POST', url: base + '/reply-drafts', headers: { cookie: headers.cookie }, payload: { recipientId: 'ram', bodyText: 'x' } })).statusCode).toBe(403);
      expect((await f.app.inject({ method: 'POST', url: base + '/reply-drafts', headers, payload: { recipientId: 'ram', bodyText: 'x', senderPhoneNumberId: '1' } })).statusCode).toBe(400);
      expect((await f.app.inject({ method: 'POST', url: base + '/reply-drafts?x=1', headers, payload: { recipientId: 'ram', bodyText: 'x' } })).statusCode).toBe(400);
      expect((await f.app.inject({ method: 'POST', url: base + '/reply-drafts', headers, payload: { recipientId: 'nobody', bodyText: 'x' } })).statusCode).toBe(403);
    } finally { await f.app.close(); }
    const off = await fixture(false); try {
      expect((await off.app.inject({ method: 'POST', url: base + '/reply-drafts', headers, payload: { recipientId: 'ram', bodyText: 'x' } })).statusCode).toBe(503);
    } finally { await off.app.close(); }
  });
});
