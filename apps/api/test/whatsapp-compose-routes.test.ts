import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPolicyGateway } from '@thaara/policy';
import { UnauthorizedError } from '@thaara/observability';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { whatsappDurableInboxRoutes } from '../src/routes/whatsapp-inbox.js';
import { WhatsAppTemplateService } from '../src/services/whatsapp-templates.js';
import { WhatsAppMediaUploadService, createMetaWhatsAppMediaUploader } from '../src/services/whatsapp-media-upload.js';
import { WhatsAppTransactionalFixture, waScope, waBinding, waEvent, waNow } from './helpers/whatsapp-durable-fixture.js';

// Synthetic only: simulated Meta catalog/uploader, in-memory store. Nothing is sent.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
const owner = { ...waScope, role: 'owner' as const };
const catalog = [{ name: 'meeting_reminder', language: 'en_US', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Meeting at {{1}} on {{2}}' }] },
  { name: 'pending_one', language: 'en_US', status: 'PENDING', category: 'UTILITY', components: [{ type: 'BODY', text: 'Hi' }] }];
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(waNow); });
afterEach(() => vi.useRealTimers());

async function app(opts: { uploader?: any; templates?: boolean; recentInbound?: boolean } = {}) {
  const store = new WhatsAppTransactionalFixture(), durable = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow);
  if (opts.recentInbound !== false) await durable.ingest(waScope, waBinding.connectionId, waEvent());
  const audit = vi.fn(async () => undefined);
  const server = Fastify({ logger: false, bodyLimit: 1048576 });
  server.decorateRequest('scope', undefined);
  server.addHook('onRequest', async request => { if (request.headers.cookie === 'fixture=owner') request.scope = owner; if (request.headers.cookie === 'fixture=member') request.scope = waScope; });
  server.decorate('requireAuth', async request => { if (!request.scope) throw new UnauthorizedError('Fixture session required.'); });
  server.setErrorHandler((error: any, _req, reply) => reply.code(error.statusCode ?? 500).send({ code: error.code ?? 'ERROR' }));
  await server.register(async child => whatsappDurableInboxRoutes(child, durable, undefined, new WhatsAppTemplateService(durable, opts.templates === false ? undefined : { list: async () => catalog }),
    new WhatsAppMediaUploadService(durable, audit, opts.uploader, () => waNow, { begin: async () => ({ fresh: true }), complete: async (scope, intent) => { await audit(scope, 'whatsapp.media.uploaded', { kind: intent.mimeType.startsWith('image/') ? 'image' : 'document', outcome: 'uploaded' }); }, fail: async () => {} })), { prefix: '/api/v1' });
  return { server, store, audit };
}
const base = '/api/v1/connectors/whatsapp/n8n/durable/' + waBinding.connectionId;
const ownerHeaders = { cookie: 'fixture=owner' };

describe('contacts screen API', () => {
  it('lets the owner save contacts (audited revision bump) and refuses members and invalid lists', async () => {
    const { server, store } = await app();
    try {
      const contacts = [{ id: 'ram', phoneE164: '+15550000001', optedIn: true, displayName: 'Ram Kumar' }, { id: 'priya', phoneE164: '+919900000003', optedIn: true }];
      expect((await server.inject({ method: 'PUT', url: base + '/contacts', headers: { cookie: 'fixture=member' }, payload: { contacts } })).statusCode).toBe(403);
      expect((await server.inject({ method: 'PUT', url: base + '/contacts', headers: ownerHeaders, payload: { contacts: [{ ...contacts[0], phoneE164: '15550000001' }] } })).statusCode).toBe(400);
      expect((await server.inject({ method: 'PUT', url: base + '/contacts', headers: ownerHeaders, payload: { contacts: [contacts[0], contacts[0]] } })).statusCode).toBe(400);
      const ok = await server.inject({ method: 'PUT', url: base + '/contacts', headers: ownerHeaders, payload: { contacts } });
      expect(ok.statusCode).toBe(200); expect(ok.json()).toEqual({ connectionId: waBinding.connectionId, revision: 2, contacts: 2 });
      expect(store.audits.at(-1).action).toBe('whatsapp.durable.contacts_updated');
    } finally { await server.close(); }
  });
  it('keeps stored numbers for existing contacts (numbers never round-trip) and requires one for new contacts', async () => {
    const { server, store } = await app();
    try {
      const before = store.state.binding.recipients[0].phoneE164;
      const rename = await server.inject({ method: 'PUT', url: base + '/contacts', headers: ownerHeaders, payload: { contacts: [{ id: 'ram', optedIn: true, displayName: 'Ram K' }] } });
      expect(rename.statusCode).toBe(200); expect(store.state.binding.recipients).toEqual([{ id: 'ram', phoneE164: before, optedIn: true, displayName: 'Ram K' }]);
      expect(rename.body).not.toContain(before.slice(1));
      expect((await server.inject({ method: 'PUT', url: base + '/contacts', headers: ownerHeaders, payload: { contacts: [{ id: 'brand_new', optedIn: true }] } })).json().code).toBe('WHATSAPP_DURABLE_INVALID');
      expect((await server.inject({ method: 'PUT', url: base + '/contacts', headers: ownerHeaders, payload: { contacts: [{ id: 'ram', optedIn: true }, { id: 'dup', phoneE164: before, optedIn: true }] } })).json().code).toBe('WHATSAPP_DURABLE_INVALID');
    } finally { await server.close(); }
  });
});

describe('template and media drafts API', () => {
  it('prepares an approval-ready template only for APPROVED templates with exact variables, even outside the 24 h window', async () => {
    const { server } = await app({ recentInbound: false });
    try {
      const url = base + '/template-drafts';
      const ok = await server.inject({ method: 'POST', url, headers: ownerHeaders, payload: { recipientId: 'ram', name: 'meeting_reminder', language: 'en_US', bodyParams: ['11 AM', 'Friday'] } });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ actionName: 'whatsapp.meta.messages.send', riskLevel: 'high', draft: { recipientId: 'ram', template: { name: 'meeting_reminder', bodyParams: ['11 AM', 'Friday'] } } });
      for (const bad of [{ bodyParams: ['only one'] }, { name: 'pending_one', bodyParams: undefined }, { name: 'unknown_template' }])
        expect((await server.inject({ method: 'POST', url, headers: ownerHeaders, payload: JSON.parse(JSON.stringify({ recipientId: 'ram', name: 'meeting_reminder', language: 'en_US', bodyParams: ['a', 'b'], ...bad })) })).json().code).toBe('WHATSAPP_TEMPLATE_INVALID');
    } finally { await server.close(); }
    const unset = await app({ templates: false });
    try { expect((await unset.server.inject({ method: 'POST', url: base + '/template-drafts', headers: ownerHeaders, payload: { recipientId: 'ram', name: 'meeting_reminder', language: 'en_US' } })).statusCode).toBe(503); }
    finally { await unset.server.close(); }
  });
  it('prepares media drafts inside the window and explains the closed window outside it', async () => {
    const media = { kind: 'image', mediaId: '123456', mimeType: 'image/jpeg', sha256: 'a'.repeat(64), caption: 'Site photo' };
    const open = await app();
    try { expect((await open.server.inject({ method: 'POST', url: base + '/media-drafts', headers: ownerHeaders, payload: { recipientId: 'ram', media } })).json()).toMatchObject({ draft: { media } }); }
    finally { await open.server.close(); }
    const closed = await app({ recentInbound: false });
    try { expect((await closed.server.inject({ method: 'POST', url: base + '/media-drafts', headers: ownerHeaders, payload: { recipientId: 'ram', media } })).json().code).toBe('WHATSAPP_WINDOW_CLOSED'); }
    finally { await closed.server.close(); }
  });
});

describe('verified attachment upload API', () => {
  const upload = (server: any, bytes: Buffer, type: string, name?: string) => server.inject({ method: 'POST', url: base + '/media-uploads', headers: { ...ownerHeaders, 'content-type': 'application/octet-stream', 'x-thaara-file-type': type, 'x-thaara-upload-approval': '11111111-1111-4111-8111-111111111111', 'x-thaara-idempotency-key': 'synthetic-upload-123', ...(name ? { 'x-thaara-file-name': encodeURIComponent(name) } : {}) }, payload: bytes });
  it('uploads only verified files to the connection’s own number and returns a fingerprinted media reference', async () => {
    const uploader = { upload: vi.fn(async () => '987654321') };
    const { server, audit } = await app({ uploader });
    try {
      const r = await upload(server, JPEG, 'image/jpeg');
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ media: { kind: 'image', mediaId: '987654321', mimeType: 'image/jpeg', sha256: createHash('sha256').update(JPEG).digest('hex') } });
      expect(uploader.upload).toHaveBeenCalledWith(waBinding.phoneNumberId, expect.objectContaining({ mimeType: 'image/jpeg' }), expect.any(AbortSignal));
      expect(audit).toHaveBeenCalledWith(expect.anything(), 'whatsapp.media.uploaded', expect.objectContaining({ kind: 'image', outcome: 'uploaded' }));
      const pdf = Buffer.from('%PDF-1.7 test');
      expect((await upload(server, pdf, 'application/pdf', '../Q3 report.pdf')).json().media).toMatchObject({ kind: 'document', filename: '.._Q3 report.pdf' });
      for (const [bytes, type] of [[Buffer.from('<html><script>x</script>'), 'image/png'], [JPEG, 'image/png'], [Buffer.from('<svg/>'), 'image/svg+xml'], [Buffer.from('MZ'), 'application/x-msdownload']] as const)
        expect((await upload(server, bytes, type)).json().code).toBe('WHATSAPP_UPLOAD_REJECTED');
      expect((await server.inject({ method: 'POST', url: base + '/media-uploads', headers: { 'content-type': 'application/octet-stream', 'x-thaara-file-type': 'image/jpeg' }, payload: JPEG })).statusCode).toBe(401);
      expect((await upload(server, Buffer.alloc(6 * 1024 * 1024, 0xff), 'image/jpeg')).json().code).toBe('WHATSAPP_UPLOAD_REJECTED');
    } finally { await server.close(); }
  });
  it('is truthful when uploads are not set up, and the Meta uploader never leaks its token', async () => {
    const { server } = await app();
    try { expect((await upload(server, JPEG, 'image/jpeg')).json().code).toBe('WHATSAPP_UPLOAD_NOT_CONFIGURED'); } finally { await server.close(); }
    const fetcher = vi.fn(async (_url: any, init: any) => { expect(init.redirect).toBe('error'); return new Response(JSON.stringify({ id: '555' })); });
    const id = await createMetaWhatsAppMediaUploader({ accessToken: () => 'synthetic-token', fetch: fetcher as any }).upload('100020003000', { bytes: JPEG, mimeType: 'image/jpeg' }, AbortSignal.timeout(1000));
    expect(id).toBe('555'); expect(String(fetcher.mock.calls[0]![0])).toBe('https://graph.facebook.com/v21.0/100020003000/media');
    await expect(createMetaWhatsAppMediaUploader({ accessToken: () => null, fetch: fetcher as any }).upload('100020003000', { bytes: JPEG, mimeType: 'image/jpeg' }, AbortSignal.timeout(1000))).rejects.toMatchObject({ reason: 'not_configured' });
  });
});
