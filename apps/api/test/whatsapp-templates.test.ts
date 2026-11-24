import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { defaultPolicyGateway } from '@thaara/policy';
import { UnauthorizedError } from '@thaara/observability';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { whatsappDurableInboxRoutes } from '../src/routes/whatsapp-inbox.js';
import { WhatsAppTemplateService, createMetaWhatsAppTemplateProvider, normalizeWhatsAppTemplates } from '../src/services/whatsapp-templates.js';
import { WhatsAppTransactionalFixture, waScope, waBinding, waNow } from './helpers/whatsapp-durable-fixture.js';

// Simulated provider data only; no real Meta call or token.
const TOKEN = 'synthetic-template-token-never-leaks';
const raw = [
  { name: 'meeting_reminder', language: 'en_US', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'HEADER', format: 'TEXT', text: 'Hi {{1}}' }, { type: 'BODY', text: 'Your meeting is at {{1}} on {{2}}. <script>x</script>' }, { type: 'FOOTER', text: 'Thaara' }] },
  { name: 'promo_offer', language: 'kn', status: 'REJECTED', category: 'MARKETING', components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'ಹೊಸ ಆಫರ್' }] },
  { name: 'Bad Name', language: 'en', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'x' }] },
  { name: 'no_body', language: 'en', status: 'APPROVED', category: 'UTILITY', components: [] },
  { name: 'weird_status', language: 'en', status: 'LIVE', category: 'UTILITY', components: [{ type: 'BODY', text: 'x' }] },
  { name: 'extra', language: 'en', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'ok' }], url: 'https://evil.example' }
];

describe('template catalog normalization (untrusted provider data)', () => {
  it('keeps bounded sanitized fields, counts variables, drops malformed entries and extra provider fields', () => {
    const out = normalizeWhatsAppTemplates(raw);
    expect(out.map(t => t.name)).toEqual(['extra', 'meeting_reminder', 'promo_offer']);
    const reminder = out.find(t => t.name === 'meeting_reminder')!;
    expect(reminder).toMatchObject({ language: 'en_US', status: 'APPROVED', bodyParams: 2, headerText: 'Hi {{1}}', headerParams: 1, footerText: 'Thaara' });
    expect(reminder.bodyText).not.toContain('<script>');
    expect(out.find(t => t.name === 'promo_offer')).toMatchObject({ status: 'REJECTED', headerMedia: true, bodyParams: 0 });
    expect(JSON.stringify(out)).not.toContain('evil.example');
  });
});

describe('Meta template provider (simulated)', () => {
  it('reads the stored account with redirects disabled and never needs a browser-supplied URL', async () => {
    const fetcher = vi.fn(async (_u: any, init?: RequestInit) => { expect(init?.redirect).toBe('error'); return new Response(JSON.stringify({ data: raw })); });
    const list = await createMetaWhatsAppTemplateProvider({ accessToken: () => TOKEN, fetch: fetcher as any }).list('900080007000', AbortSignal.timeout(1000));
    expect(list).toHaveLength(raw.length);
    expect(String(fetcher.mock.calls[0]![0])).toBe('https://graph.facebook.com/v21.0/900080007000/message_templates?fields=name,language,status,category,components&limit=100');
  });
  it('is truthful about missing token, expired credentials, bad IDs and provider errors', async () => {
    const never = vi.fn();
    await expect(createMetaWhatsAppTemplateProvider({ accessToken: () => null, fetch: never as any }).list('900080007000', AbortSignal.timeout(1000))).rejects.toMatchObject({ reason: 'not_configured' });
    await expect(createMetaWhatsAppTemplateProvider({ accessToken: () => TOKEN, fetch: never as any }).list('../me', AbortSignal.timeout(1000))).rejects.toMatchObject({ reason: 'rejected' });
    expect(never).not.toHaveBeenCalled();
    await expect(createMetaWhatsAppTemplateProvider({ accessToken: () => TOKEN, fetch: vi.fn(async () => new Response('', { status: 401 })) as any }).list('900080007000', AbortSignal.timeout(1000))).rejects.toMatchObject({ reason: 'not_configured' });
    await expect(createMetaWhatsAppTemplateProvider({ accessToken: () => TOKEN, fetch: vi.fn(async () => new Response('{}')) as any }).list('900080007000', AbortSignal.timeout(1000))).rejects.toMatchObject({ reason: 'rejected' });
  });
});

describe('owner-scoped templates route', () => {
  async function app(provider?: any) {
    const store = new WhatsAppTransactionalFixture(), durable = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow);
    const server = Fastify({ logger: false });
    server.decorateRequest('scope', undefined);
    server.addHook('onRequest', async request => { if (request.headers.cookie === 'fixture=owner') request.scope = waScope; if (request.headers.cookie === 'fixture=other') request.scope = { ...waScope, workspaceId: '22222222-2222-4222-8222-222222222222' }; });
    server.decorate('requireAuth', async request => { if (!request.scope) throw new UnauthorizedError('Fixture session required.'); });
    server.setErrorHandler((error: any, _req, reply) => reply.code(error.statusCode ?? 500).send({ code: error.code ?? 'ERROR' }));
    await server.register(async child => whatsappDurableInboxRoutes(child, durable, undefined, new WhatsAppTemplateService(durable, provider)), { prefix: '/api/v1' });
    return server;
  }
  const url = '/api/v1/connectors/whatsapp/n8n/durable/' + waBinding.connectionId + '/templates';
  it('lists sanitized templates for the owner only, using the connection’s own business account', async () => {
    const list = vi.fn(async () => raw);
    const server = await app({ list });
    try {
      expect((await server.inject({ url })).statusCode).toBe(401);
      expect((await server.inject({ url, headers: { cookie: 'fixture=other' } })).statusCode).toBe(403);
      const r = await server.inject({ url, headers: { cookie: 'fixture=owner' } });
      expect(r.statusCode).toBe(200); expect(r.headers['cache-control']).toBe('no-store');
      expect(r.json().templates.map((t: any) => t.name)).toEqual(['extra', 'meeting_reminder', 'promo_offer']);
      expect(list).toHaveBeenCalledWith(waBinding.businessAccountId, expect.any(AbortSignal));
      expect(r.body).not.toContain(waBinding.businessAccountId);
    } finally { await server.close(); }
  });
  it('reports not set up with a stable code', async () => {
    const server = await app(undefined);
    try { const r = await server.inject({ url, headers: { cookie: 'fixture=owner' } }); expect(r.statusCode).toBe(503); expect(r.json().code).toBe('WHATSAPP_TEMPLATES_NOT_CONFIGURED'); }
    finally { await server.close(); }
  });
});
