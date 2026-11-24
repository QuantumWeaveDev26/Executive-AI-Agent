import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { defaultPolicyGateway } from '@thaara/policy';
import { AppError, ForbiddenError, UnauthorizedError } from '@thaara/observability';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { whatsappDurableInboxRoutes } from '../src/routes/whatsapp-inbox.js';
import { WhatsAppMediaError, WhatsAppMediaPreviewService, verifyWhatsAppMedia, WHATSAPP_MEDIA_MAX_BYTES, createMetaWhatsAppMediaProvider, isAllowedWhatsAppMediaUrl, verifyWhatsAppPreviewImage, WHATSAPP_PREVIEW_MAX_BYTES, type WhatsAppMediaProvider } from '../src/services/whatsapp-media-preview.js';
import { WhatsAppTransactionalFixture, waScope, waBinding, waEvent, waNow } from './helpers/whatsapp-durable-fixture.js';

// Simulated provider data only. No real Meta call, token or image is used.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const hex = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const TOKEN = 'synthetic-token-must-never-leak';
const MEDIA_ID = '123456789';
const CDN = 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=123456789&ext=1';

function imageEvent(bytes = JPEG, mime = 'image/jpeg') {
  const base = waEvent();
  return { ...base, messages: [{ id: base.messages[0]!.id, from: base.messages[0]!.from, timestamp: base.messages[0]!.timestamp, type: 'image', image: { id: MEDIA_ID, mime_type: mime, sha256: hex(bytes) } }] };
}
function graph(over: { info?: Record<string, unknown>; bytes?: Buffer; lookupStatus?: number; fileStatus?: number; headers?: Record<string, string> } = {}) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(init?.redirect).toBe('error');
    if (String(url).startsWith('https://graph.facebook.com/')) return new Response(JSON.stringify({ id: MEDIA_ID, url: CDN, mime_type: 'image/jpeg', sha256: hex(JPEG), file_size: JPEG.length, ...over.info }), { status: over.lookupStatus ?? 200, headers: { 'content-type': 'application/json' } });
    return new Response(over.bytes ?? JPEG, { status: over.fileStatus ?? 200, headers: over.headers ?? {} });
  });
}
async function owned(provider?: WhatsAppMediaProvider, limits?: { perWindow: number; windowMs: number; timeoutMs: number }, audit = vi.fn(async () => undefined), event: unknown = imageEvent()) {
  const store = new WhatsAppTransactionalFixture(), durable = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow);
  await durable.ingest(waScope, waBinding.connectionId, event as any);
  return { store, durable, audit, service: new WhatsAppMediaPreviewService(durable, defaultPolicyGateway, audit, provider, limits, () => waNow) };
}

describe('Meta media adapter (simulated responses)', () => {
  it('downloads via the stored media ID with redirects disabled and never reveals the token', async () => {
    const fetcher = graph();
    const result = await createMetaWhatsAppMediaProvider({ accessToken: () => TOKEN, fetch: fetcher as any }).download(MEDIA_ID, AbortSignal.timeout(1000));
    expect(result.bytes.equals(JPEG)).toBe(true);
    expect(String(fetcher.mock.calls[0]![0])).toBe('https://graph.facebook.com/v21.0/' + MEDIA_ID);
    expect(String(fetcher.mock.calls[1]![0])).toBe(CDN);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
  it('reports not_configured without any network call when no token exists', async () => {
    const fetcher = graph();
    await expect(createMetaWhatsAppMediaProvider({ accessToken: () => null, fetch: fetcher as any }).download(MEDIA_ID, AbortSignal.timeout(1000))).rejects.toMatchObject({ reason: 'not_configured' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['http://lookaside.fbsbx.com/x', 'https://evil.example/x', 'https://lookaside.fbsbx.com.evil.example/x', 'https://169.254.169.254/latest/meta-data', 'https://127.0.0.1/x', 'https://[::1]/x',
    'https://lookaside.fbsbx.com:8443/x', 'https://user:pass@lookaside.fbsbx.com/x', 'file:///etc/passwd', 'javascript:alert(1)', 42])('refuses provider URL %j before fetching it (SSRF)', async url => {
    expect(isAllowedWhatsAppMediaUrl(url)).toBe(false);
    const fetcher = graph({ info: { url } });
    await expect(createMetaWhatsAppMediaProvider({ accessToken: () => TOKEN, fetch: fetcher as any }).download(MEDIA_ID, AbortSignal.timeout(1000))).rejects.toMatchObject({ reason: 'rejected' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('refuses non-numeric media IDs, mismatched IDs and oversized files (declared, streamed or reported)', async () => {
    const make = (f: any) => createMetaWhatsAppMediaProvider({ accessToken: () => TOKEN, fetch: f });
    const none = graph();
    await expect(make(none).download('../me?fields=x', AbortSignal.timeout(1000))).rejects.toMatchObject({ reason: 'rejected' });
    expect(none).not.toHaveBeenCalled();
    await expect(make(graph({ info: { id: '999' } })).download(MEDIA_ID, AbortSignal.timeout(1000))).rejects.toMatchObject({ reason: 'rejected' });
    await expect(make(graph({ info: { file_size: WHATSAPP_PREVIEW_MAX_BYTES + 1 } })).download(MEDIA_ID, AbortSignal.timeout(1000))).rejects.toMatchObject({ reason: 'rejected' });
    await expect(make(graph({ headers: { 'content-length': String(WHATSAPP_PREVIEW_MAX_BYTES + 1) } })).download(MEDIA_ID, AbortSignal.timeout(1000))).rejects.toMatchObject({ reason: 'rejected' });
    const huge = Buffer.alloc(WHATSAPP_PREVIEW_MAX_BYTES + 10, 0xff);
    await expect(make(graph({ info: { file_size: undefined }, bytes: huge })).download(MEDIA_ID, AbortSignal.timeout(1000))).rejects.toMatchObject({ reason: 'rejected' });
  });
  it('maps redirects, provider errors and expired credentials truthfully', async () => {
    const redirecting = vi.fn(async () => { throw new TypeError('fetch failed: unexpected redirect'); });
    await expect(createMetaWhatsAppMediaProvider({ accessToken: () => TOKEN, fetch: redirecting as any }).download(MEDIA_ID, AbortSignal.timeout(1000))).rejects.toMatchObject({ reason: 'unavailable' });
    await expect(createMetaWhatsAppMediaProvider({ accessToken: () => TOKEN, fetch: graph({ lookupStatus: 401 }) as any }).download(MEDIA_ID, AbortSignal.timeout(1000))).rejects.toMatchObject({ reason: 'not_configured' });
    await expect(createMetaWhatsAppMediaProvider({ accessToken: () => TOKEN, fetch: graph({ fileStatus: 302 }) as any }).download(MEDIA_ID, AbortSignal.timeout(1000))).rejects.toMatchObject({ reason: 'unavailable' });
  });
});

describe('image verification', () => {
  it('accepts only JPEG/PNG whose bytes, saved type, provider type and saved fingerprint all agree', () => {
    expect(verifyWhatsAppPreviewImage({ bytes: JPEG, mimeType: 'image/jpeg' }, { mimeType: 'image/jpeg', sha256: hex(JPEG) })).toBe('image/jpeg');
    expect(verifyWhatsAppPreviewImage({ bytes: PNG, mimeType: 'image/png' }, { mimeType: 'image/png', sha256: createHash('sha256').update(PNG).digest('base64') })).toBe('image/png');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), html = Buffer.from('<html><script>x</script>');
    for (const [bytes, provided, savedType, sha] of [[PNG, 'image/jpeg', 'image/jpeg', hex(PNG)], [svg, 'image/jpeg', 'image/jpeg', hex(svg)], [html, 'image/png', 'image/png', hex(html)],
      [JPEG, 'image/jpeg', 'image/jpeg', 'a'.repeat(64)], [JPEG, 'image/png', 'image/jpeg', hex(JPEG)], [Buffer.from([0x47, 0x49, 0x46, 0x38]), 'image/gif', 'image/gif', 'b'.repeat(64)]] as const)
      expect(() => verifyWhatsAppPreviewImage({ bytes, mimeType: provided }, { mimeType: savedType, sha256: sha })).toThrow(WhatsAppMediaError);
    expect(() => verifyWhatsAppPreviewImage({ bytes: JPEG, mimeType: 'image/jpeg', sha256: 'c'.repeat(64) }, { mimeType: 'image/jpeg', sha256: hex(JPEG) })).toThrow(WhatsAppMediaError);
  });
});

describe('owner-scoped preview service', () => {
  it('returns verified bytes only to the owner, after an audit without URLs, IDs or tokens', async () => {
    const provider = { download: vi.fn(async () => ({ bytes: JPEG, mimeType: 'image/jpeg', sha256: hex(JPEG) })) };
    const f = await owned(provider);
    const result = await f.service.preview(waScope, waBinding.connectionId, 'wamid.inbound');
    expect(result).toMatchObject({ status: 'verified', contentType: 'image/jpeg' });
    expect(provider.download).toHaveBeenCalledWith(MEDIA_ID, expect.any(AbortSignal), 5 * 1024 * 1024);
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ userId: waScope.userId }), 'whatsapp.media.previewed', { connectionId: waBinding.connectionId, providerMessageId: 'wamid.inbound', outcome: 'verified', kind: 'image', bytes: JPEG.length, mimeType: 'image/jpeg' });
    expect(JSON.stringify(f.audit.mock.calls)).not.toMatch(/lookaside|graph\.facebook|123456789|synthetic-token/);
    expect(f.store.state.messages[0]!.media?.downloadStatus).toBe('not_downloaded');
  });
  it('denies other tenants, other owners, viewers, missing sessions, unknown and non-image messages before any provider I/O or audit', async () => {
    const provider = { download: vi.fn() };
    const f = await owned(provider as any);
    for (const scope of [{ ...waScope, workspaceId: '22222222-2222-4222-8222-222222222222' }, { ...waScope, userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, { ...waScope, role: 'viewer' as const }, { ...waScope, sessionTokenHash: undefined }])
      await expect(f.service.preview(scope as any, waBinding.connectionId, 'wamid.inbound')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(f.service.preview(waScope, waBinding.connectionId, 'wamid.unknown')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(f.service.preview(waScope, 'other_connection', 'wamid.inbound')).rejects.toBeInstanceOf(ForbiddenError);
    const text = await owned(provider as any, undefined, vi.fn(async () => undefined), waEvent());
    await expect(text.service.preview(waScope, waBinding.connectionId, 'wamid.inbound')).rejects.toBeInstanceOf(ForbiddenError);
    expect(provider.download).not.toHaveBeenCalled(); expect(f.audit).not.toHaveBeenCalled();
  });
  it('is truthful when not configured, rate limited or unverifiable, and audits each refusal', async () => {
    const none = await owned(undefined);
    await expect(none.service.preview(waScope, waBinding.connectionId, 'wamid.inbound')).rejects.toMatchObject({ code: 'WHATSAPP_MEDIA_NOT_CONFIGURED', statusCode: 503 });
    expect(none.audit).toHaveBeenCalledWith(expect.anything(), 'whatsapp.media.preview_refused', expect.objectContaining({ outcome: 'not_configured' }));
    const tampered = await owned({ download: async () => ({ bytes: PNG, mimeType: 'image/jpeg' }) });
    const error = await tampered.service.preview(waScope, waBinding.connectionId, 'wamid.inbound').catch(e => e);
    expect(error).toMatchObject({ code: 'WHATSAPP_MEDIA_UNVERIFIED', statusCode: 502 }); expect(String(error.message)).not.toContain(TOKEN);
    expect(tampered.audit).toHaveBeenCalledWith(expect.anything(), 'whatsapp.media.preview_refused', expect.objectContaining({ outcome: 'rejected' }));
    const limited = await owned({ download: async () => ({ bytes: JPEG, mimeType: 'image/jpeg' }) }, { perWindow: 1, windowMs: 60000, timeoutMs: 1000 });
    await limited.service.preview(waScope, waBinding.connectionId, 'wamid.inbound');
    await expect(limited.service.preview(waScope, waBinding.connectionId, 'wamid.inbound')).rejects.toMatchObject({ code: 'WHATSAPP_MEDIA_RATE_LIMITED', statusCode: 429 });
  });
  it('fails closed when the audit cannot be written', async () => {
    const f = await owned({ download: async () => ({ bytes: JPEG, mimeType: 'image/jpeg' }) }, undefined, vi.fn(async () => { throw new Error('audit down'); }));
    await expect(f.service.preview(waScope, waBinding.connectionId, 'wamid.inbound')).rejects.toThrow();
  });
});

describe('versioned preview HTTP route', () => {
  async function app(provider?: WhatsAppMediaProvider) {
    const f = await owned(provider), server = Fastify({ logger: false });
    server.decorateRequest('scope', undefined);
    server.addHook('onRequest', async request => { if (request.headers.cookie === 'fixture=owner') request.scope = waScope; });
    server.decorate('requireAuth', async request => { if (!request.scope) throw new UnauthorizedError('Fixture session required.'); });
    server.setErrorHandler((error: any, _req, reply) => reply.code(error.statusCode ?? 500).send({ code: error.code ?? 'ERROR', message: error.message }));
    await server.register(async child => whatsappDurableInboxRoutes(child, f.durable, f.service), { prefix: '/api/v1' });
    return server;
  }
  const url = '/api/v1/connectors/whatsapp/n8n/durable/' + waBinding.connectionId + '/media/wamid.inbound/preview';
  it('serves verified bytes inert and uncached to the signed-in owner only', async () => {
    const server = await app({ download: async () => ({ bytes: JPEG, mimeType: 'image/jpeg' }) });
    try {
      expect((await server.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(401);
      expect((await server.inject({ method: 'GET', url, headers: { cookie: 'fixture=owner' } })).statusCode).toBe(404);
      expect((await server.inject({ method: 'POST', url, headers: { cookie: 'fixture=owner' }, payload: { u: 1 } })).statusCode).toBe(400);
      expect((await server.inject({ method: 'POST', url: url + '?mediaId=1', headers: { cookie: 'fixture=owner' }, payload: {} })).statusCode).toBe(400);
      expect((await server.inject({ method: 'POST', url: url.replace('wamid.inbound', 'not-a-wamid'), headers: { cookie: 'fixture=owner' }, payload: {} })).statusCode).toBe(400);
      const r = await server.inject({ method: 'POST', url, headers: { cookie: 'fixture=owner' }, payload: {} });
      expect(r.statusCode).toBe(200); expect(r.rawPayload.equals(JPEG)).toBe(true);
      expect(r.headers).toMatchObject({ 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'cross-origin-resource-policy': 'same-origin' });
    } finally { await server.close(); }
  });
  it('reports not configured with a stable code', async () => {
    const server = await app(undefined);
    try {
      const r = await server.inject({ method: 'POST', url, headers: { cookie: 'fixture=owner' }, payload: {} });
      expect(r.statusCode).toBe(503); expect(r.json()).toMatchObject({ code: 'WHATSAPP_MEDIA_NOT_CONFIGURED' });
    } finally { await server.close(); }
  });
});
void AppError;

describe('documents and audio (Step 108.25, simulated provider)', () => {
  const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
  const OGG = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]);
  const DOCX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
  const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  function mediaEvent(kind: 'document' | 'audio', bytes: Buffer, mime: string, filename?: string) {
    const base = waEvent();
    return { ...base, messages: [{ id: base.messages[0]!.id, from: base.messages[0]!.from, timestamp: base.messages[0]!.timestamp, type: kind, [kind]: { id: MEDIA_ID, mime_type: mime, sha256: hex(bytes), ...(filename ? { filename } : {}) } }] };
  }
  it('verifies PDF, Office (OOXML) and plain-text documents; refuses HTML, scripts and type confusion', () => {
    expect(verifyWhatsAppMedia('document', { bytes: PDF, mimeType: 'application/pdf' }, { mimeType: 'application/pdf', sha256: hex(PDF) })).toBe('application/pdf');
    expect(verifyWhatsAppMedia('document', { bytes: DOCX, mimeType: DOCX_TYPE }, { mimeType: DOCX_TYPE, sha256: hex(DOCX) })).toBe(DOCX_TYPE);
    const text = Buffer.from('Meeting notes\nನಾಳೆ 11 ಗಂಟೆ');
    expect(verifyWhatsAppMedia('document', { bytes: text, mimeType: 'text/plain' }, { mimeType: 'text/plain', sha256: hex(text) })).toBe('text/plain');
    const html = Buffer.from('<html><script>steal()</script>');
    for (const [bytes, mime] of [[html, 'text/html'], [html, 'application/pdf'], [DOCX, 'application/zip'], [PDF, DOCX_TYPE], [Buffer.from([0x00, 0x01, 0x02]), 'text/plain'], [JPEG, 'application/pdf']] as const)
      expect(() => verifyWhatsAppMedia('document', { bytes, mimeType: mime }, { mimeType: mime, sha256: hex(bytes) })).toThrow(WhatsAppMediaError);
  });
  it('verifies OGG/Opus, MP3 (ID3), AMR and M4A audio; refuses mismatches and non-audio', () => {
    expect(verifyWhatsAppMedia('audio', { bytes: OGG, mimeType: 'audio/ogg' }, { mimeType: 'audio/ogg; codecs=opus', sha256: hex(OGG) })).toBe('audio/ogg');
    const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00]), amr = Buffer.from('#!AMR\n'), m4a = Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41]);
    expect(verifyWhatsAppMedia('audio', { bytes: mp3, mimeType: 'audio/mpeg' }, { mimeType: 'audio/mpeg', sha256: hex(mp3) })).toBe('audio/mpeg');
    expect(verifyWhatsAppMedia('audio', { bytes: amr, mimeType: 'audio/amr' }, { mimeType: 'audio/amr', sha256: hex(amr) })).toBe('audio/amr');
    expect(verifyWhatsAppMedia('audio', { bytes: m4a, mimeType: 'audio/mp4' }, { mimeType: 'audio/mp4', sha256: hex(m4a) })).toBe('audio/mp4');
    for (const [bytes, mime] of [[OGG, 'audio/mpeg'], [PDF, 'audio/ogg'], [JPEG, 'audio/ogg']] as const)
      expect(() => verifyWhatsAppMedia('audio', { bytes, mimeType: mime }, { mimeType: mime, sha256: hex(bytes) })).toThrow(WhatsAppMediaError);
    expect(() => verifyWhatsAppMedia('audio', { bytes: OGG, mimeType: 'audio/ogg' }, { mimeType: 'audio/ogg', sha256: 'f'.repeat(64) })).toThrow(WhatsAppMediaError);
  });
  it('serves documents only as downloads and audio inline, each audited with its kind; per-kind size ceilings', async () => {
    const audit = vi.fn(async () => undefined), provider = { download: vi.fn(async () => ({ bytes: PDF, mimeType: 'application/pdf' })) };
    const f = await owned(provider, undefined, audit, mediaEvent('document', PDF, 'application/pdf', 'Q3 report "final".pdf'));
    const server = Fastify({ logger: false });
    server.decorateRequest('scope', undefined);
    server.addHook('onRequest', async request => { if (request.headers.cookie === 'fixture=owner') request.scope = waScope; });
    server.decorate('requireAuth', async request => { if (!request.scope) throw new UnauthorizedError('Fixture session required.'); });
    server.setErrorHandler((error: any, _req, reply) => reply.code(error.statusCode ?? 500).send({ code: error.code ?? 'ERROR' }));
    await server.register(async child => whatsappDurableInboxRoutes(child, f.durable, f.service), { prefix: '/api/v1' });
    try {
      const base = '/api/v1/connectors/whatsapp/n8n/durable/' + waBinding.connectionId + '/media/wamid.inbound/';
      expect((await server.inject({ method: 'POST', url: base + 'preview', headers: { cookie: 'fixture=owner' }, payload: {} })).statusCode).toBe(403);
      const r = await server.inject({ method: 'POST', url: base + 'content', headers: { cookie: 'fixture=owner' }, payload: {} });
      expect(r.statusCode).toBe(200); expect(r.rawPayload.equals(PDF)).toBe(true);
      expect(r.headers['content-type']).toBe('application/pdf');
      expect(String(r.headers['content-disposition'])).toMatch(/^attachment; filename="whatsapp-document\.pdf"; filename\*=UTF-8''Q3%20report%20_final_\.pdf$/);
      expect(r.headers).toMatchObject({ 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'cache-control': 'no-store' });
      expect(provider.download).toHaveBeenCalledWith(MEDIA_ID, expect.any(AbortSignal), WHATSAPP_MEDIA_MAX_BYTES.document);
      expect(audit).toHaveBeenCalledWith(expect.anything(), 'whatsapp.media.downloaded', expect.objectContaining({ kind: 'document', outcome: 'verified' }));
    } finally { await server.close(); }
    const a = await owned({ download: async () => ({ bytes: OGG, mimeType: 'audio/ogg' }) }, undefined, vi.fn(async () => undefined), mediaEvent('audio', OGG, 'audio/ogg; codecs=opus'));
    expect(await a.service.content(waScope, waBinding.connectionId, 'wamid.inbound')).toMatchObject({ kind: 'audio', contentType: 'audio/ogg' });
    expect(WHATSAPP_MEDIA_MAX_BYTES).toEqual({ image: 5242880, audio: 16777216, document: 20971520 });
  });
});
