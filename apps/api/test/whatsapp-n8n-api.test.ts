import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { defaultPolicyGateway } from '@thaara/policy';
import { CsrfError, UnauthorizedError } from '@thaara/observability';
import { generateCsrfToken, verifyCsrfToken } from '../src/crypto/csrf.js';
import { whatsappN8nRoutes } from '../src/routes/whatsapp-n8n.js';
import { N8nWhatsAppBridge } from '../src/services/whatsapp-n8n.js';
import { WhatsAppVault, createInMemoryWhatsAppStore } from '../src/services/whatsapp.js';

describe('Step 108.2 database-free HTTP route protocol fixtures', () => {
  let app: ReturnType<typeof Fastify>, disabled: ReturnType<typeof Fastify>;
  const owner = { workspaceId: '11111111-1111-4111-8111-111111111111', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'member' as const, sessionTokenHash: 'synthetic-owner-session' };
  const other = { ...owner, userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, outsider = { ...owner, workspaceId: '22222222-2222-4222-8222-222222222222' };
  const csrf = generateCsrfToken(), relay = 'synthetic-n8n-relay-secret-1082-api', connectionId = 'n8n_api_test';
  const submit = vi.fn(async (id: string) => ({ dispatchId: id, status: 'not_configured' as const }));
  const draft = { connectionId, connectionRevision: 1, senderPhoneNumberId: '100020003000', recipientId: 'ram', bodyText: 'Synthetic API message', idempotencyKey: 'n8n-api-dispatch-0001' };
  const approvalId = '99999999-9999-4999-8999-999999999999', path = '/api/v1/connectors/whatsapp/n8n';
  const headers = (session = 'owner') => ({ cookie: 'fixture_session=' + session, 'x-csrf-token': csrf });
  async function fixture(bridge?: N8nWhatsAppBridge) {
    const server = Fastify({ logger: false });
    server.decorateRequest('scope', undefined);
    server.addHook('onRequest', async request => { const session = request.headers.cookie?.split('=')[1]; request.scope = ({ owner, other, outsider } as Record<string, typeof owner>)[session ?? '']; });
    // Explicit fixture guard verifies the route's auth/CSRF delegation. No sessions or DB are created.
    server.decorate('requireAuth', async (request: any) => { if (!request.scope) throw new UnauthorizedError('Fixture authentication required.'); if (['POST', 'DELETE'].includes(request.method) && !verifyCsrfToken(request.headers['x-csrf-token'], csrf)) throw new CsrfError('Fixture CSRF required.'); });
    server.setErrorHandler((error: any, _request, reply) => reply.status(error.statusCode ?? 500).send({ code: error.code ?? 'TEST_ERROR' }));
    await server.register(async child => whatsappN8nRoutes(child, bridge), { prefix: '/api/v1' }); await server.ready(); return server;
  }
  beforeAll(async () => {
    const bridge = new N8nWhatsAppBridge({ binding: { mode: 'offline_test', connectionId, revision: 1, workspaceId: owner.workspaceId, userId: owner.userId, businessAccountId: '900080007000', phoneNumberId: draft.senderPhoneNumberId, graphVersion: 'v26.0', recipients: [{ id: 'ram', phoneE164: '+15550000001', optedIn: true }] }, vault: new WhatsAppVault(randomBytes(32), createInMemoryWhatsAppStore()), relayToken: relay, dispatchToken: 'synthetic-dispatch-header-secret-1082-api', policyGateway: defaultPolicyGateway,
      authorize: async s => s.workspaceId === owner.workspaceId && s.userId === owner.userId,
      resolveApproval: async () => ({ id: approvalId, workspaceId: owner.workspaceId, requesterUserId: owner.userId, approverUserId: owner.userId, actionName: 'whatsapp.meta.messages.send', actionParams: draft, status: 'approved', riskLevel: 'high', expiresAt: new Date(Date.now() + 60000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }), audit: async () => {}, transport: { mode: 'mock', submit } });
    app = await fixture(bridge); disabled = await fixture();
  });
  afterAll(async () => { await app?.close(); await disabled?.close(); });
  it('delegates user routes to auth/CSRF and enforces owner/workspace binding', async () => {
    expect((await app.inject({ url: path + '/status' })).statusCode).toBe(401);
    for (const session of ['other', 'outsider']) expect((await app.inject({ url: path + '/messages', headers: headers(session) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: path + '/dispatches', headers: { cookie: headers().cookie }, payload: { draft, approvalId } })).statusCode).toBe(403);
  });
  it('keeps default routes not configured and rejects machine relay traffic', async () => {
    expect((await disabled.inject({ url: path + '/status', headers: headers() })).json()).toMatchObject({ configured: false, liveSendingEnabled: false });
    expect((await disabled.inject({ method: 'POST', url: path + '/relay/' + connectionId + '/events', headers: { authorization: 'Bearer ' + relay }, payload: { event: {} } })).statusCode).toBe(503);
  });
  it('accepts only machine authentication, rejects payload claims and gates approved dispatch/receipts', async () => {
    const event = { field: 'messages', messaging_product: 'whatsapp', metadata: { phone_number_id: draft.senderPhoneNumberId }, messages: [{ id: 'wamid.api_inbound', from: '15550000001', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Synthetic inbound' } }] };
    expect((await app.inject({ method: 'POST', url: path + '/relay/' + connectionId + '/events', headers: headers(), payload: { event } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: path + '/relay/' + connectionId + '/events', headers: { authorization: 'Bearer ' + relay }, payload: { event, workspaceId: owner.workspaceId } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: path + '/relay/' + connectionId + '/events', headers: { authorization: 'Bearer ' + relay }, payload: { event } })).statusCode).toBe(200);
    const response = await app.inject({ method: 'POST', url: path + '/dispatches', headers: headers(), payload: { draft, approvalId } }); expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ status: 'not_configured', verified: false }); expect(submit).toHaveBeenCalledTimes(1);
    const dispatchId = response.json().dispatchId;
    expect((await app.inject({ method: 'POST', url: path + '/relay/' + connectionId + '/claim', headers: headers(), payload: { dispatchId, connectionRevision: 1 } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: path + '/relay/' + connectionId + '/claim', headers: { authorization: 'Bearer ' + relay }, payload: { dispatchId, connectionRevision: 2 } })).statusCode).toBe(403);
    const claim = await app.inject({ method: 'POST', url: path + '/relay/' + connectionId + '/claim', headers: { authorization: 'Bearer ' + relay }, payload: { dispatchId, connectionRevision: 1 } }); expect(claim.statusCode).toBe(200); expect(claim.json()).toMatchObject({ authorized: true, dispatchEnabled: false });
    expect((await app.inject({ method: 'POST', url: path + '/relay/' + connectionId + '/receipts', headers: { authorization: 'Bearer ' + relay }, payload: { dispatchId, providerMessageId: 'wamid.api_outbound', recipientAddress: '15550000001' } })).json()).toMatchObject({ status: 'unverified', verified: false });
  });
});
