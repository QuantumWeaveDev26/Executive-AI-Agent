import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as wa from '../src/whatsapp-stored-inbox';
import * as ui from '../src/StoredWhatsAppInbox';

const c = { connectionId: 'wa_test', revision: 1, disconnected: false };
const media = { kind: 'image', mediaId: '12345', mimeType: 'image/png', sha256: 'a'.repeat(64) } as const;
const draftBase = { connectionId: c.connectionId, connectionRevision: 1, senderPhoneNumberId: '123456', recipientId: 'ram', idempotencyKey: 'test-compose-12345' };
const prepared = (content: object) => ({ draft: { ...draftBase, ...content }, actionName: 'whatsapp.meta.messages.send', riskLevel: 'high', liveSendingEnabled: false });
const response = (data: unknown) => ({ ok: true, json: async () => data });
const uploadAuth = { approvalId: '11111111-1111-4111-8111-111111111111', idempotencyKey: 'upload-fixture-12345678' };
beforeEach(() => vi.stubGlobal('document', { cookie: 'thaara_csrf=synthetic-compose-csrf' }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('10826 typed compose client; simulated server only', () => {
  it('prepares a template without deciding approval and rejects substituted content/scope', async () => {
    const input = { recipientId: 'ram', name: 'meeting', language: 'en', bodyParams: ['Tomorrow'] };
    const result = prepared({ template: { name: 'meeting', language: 'en', bodyParams: ['Tomorrow'] } });
    const call = vi.fn(async () => response(result)); vi.stubGlobal('fetch', call);
    await expect((wa as any).prepareStoredWhatsAppTemplate(c, input)).resolves.toEqual(result);
    expect(call).toHaveBeenCalledTimes(1); expect(String(call.mock.calls[0]?.[0])).toContain('/template-drafts');
    for (const draft of [{ ...result.draft, recipientId: 'other' }, { ...result.draft, connectionRevision: 2 }, { ...result.draft, template: { name: 'other', language: 'en' } }]) {
      vi.stubGlobal('fetch', vi.fn(async () => response({ ...result, draft })));
      await expect((wa as any).prepareStoredWhatsAppTemplate(c, input)).rejects.toThrow();
    }
  });
  it('prepares only the exact uploaded media and rejects extra authority fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(prepared({ media }))));
    await expect((wa as any).prepareStoredWhatsAppMedia(c, { recipientId: 'ram', media })).resolves.toMatchObject({ draft: { media } });
    vi.stubGlobal('fetch', vi.fn(async () => response(prepared({ media: { ...media, mediaId: '98765' } }))));
    await expect((wa as any).prepareStoredWhatsAppMedia(c, { recipientId: 'ram', media })).rejects.toThrow();
  });
  it('saves existing contacts without inventing or exposing their stored phone numbers', async () => {
    const call = vi.fn(async () => response({ connectionId: c.connectionId, revision: 2, contacts: 1 })); vi.stubGlobal('fetch', call);
    await expect((wa as any).saveStoredWhatsAppContacts(c, { contacts: [{ id: 'ram', displayName: 'Ram', optedIn: true }] })).resolves.toMatchObject({ revision: 2 });
    const body = JSON.parse((call.mock.calls as any)[0][1].body); expect(body.contacts[0]).not.toHaveProperty('phoneE164');
    vi.stubGlobal('fetch', vi.fn(async () => response({ connectionId: 'foreign', revision: 2, contacts: 1 })));
    await expect((wa as any).saveStoredWhatsAppContacts(c, body)).rejects.toThrow();
  });
  it('validates upload size/type before any network request', async () => {
    const call = vi.fn(); vi.stubGlobal('fetch', call);
    for (const file of [{ name: 'x.svg', type: 'image/svg+xml', size: 10 }, { name: 'x.png', type: 'image/png', size: 5 * 1024 * 1024 + 1 }, { name: 'x.mp3', type: 'audio/mpeg', size: 16 * 1024 * 1024 + 1 }, { name: '../x.pdf', type: 'application/pdf', size: 10 }]) {
      await expect((wa as any).uploadStoredWhatsAppFile(c, file)).rejects.toThrow();
    }
    expect(call).not.toHaveBeenCalled();
  });
  it('uploads raw bytes with explicit type/name headers and validates the returned asset', async () => {
    const file = new Blob([new Uint8Array([137,80,78,71,13,10,26,10])], { type: 'image/png' }); Object.defineProperty(file, 'name', { value: 'ಕನ್ನಡ.png' });
    const call = vi.fn(async () => response({ media })); vi.stubGlobal('fetch', call);
    await expect((wa as any).uploadStoredWhatsAppFile(c, file, uploadAuth)).resolves.toEqual({ media });
    const options = (call.mock.calls as any)[0][1]; expect(options.credentials).toBe('include'); expect(options.body).toBe(file);
    const headers = new Headers(options.headers); expect(headers.get('content-type')).toBe('application/octet-stream'); expect(headers.get('x-thaara-file-name')).toBe(encodeURIComponent('ಕನ್ನಡ.png'));
    vi.stubGlobal('fetch', vi.fn(async () => response({ media: { ...media, url: 'https://evil.invalid' } })));
    await expect((wa as any).uploadStoredWhatsAppFile(c, file, uploadAuth)).rejects.toThrow();
  });
});

describe('10826 compose screens and navigation fences', () => {
  const inbox = { connectionId: c.connectionId, revision: 1, conversations: [], messages: [], nextPageToken: null, liveSendingEnabled: false };
  async function model(extra: object = {}, role = 'owner') {
    let state: any;
    const api = { connections: vi.fn(async () => ({ connections: [c] })), inbox: vi.fn(async () => inbox), contacts: vi.fn(async () => []), prepareTemplate: vi.fn(async () => prepared({ template: { name: 'meeting', language: 'en' } })), prepareUpload: vi.fn(async () => ({ draft: { ...draftBase, filename: 'image.png', mimeType: 'image/png', bytes: 9, sha256: media.sha256, idempotencyKey: uploadAuth.idempotencyKey }, actionName: 'whatsapp.meta.media.upload', riskLevel: 'high', liveSendingEnabled: false })), approveUpload: vi.fn(async () => undefined), requestApproval: vi.fn(async () => '11111111-1111-4111-8111-111111111111'), approve: vi.fn(), ...extra };
    const m = wa.createStoredWhatsAppModel(role, s => { state = s; }, api as any); await m.load(); await m.recipient('ram');
    return { m, api, state: () => state };
  }
  it('prepares a rich draft and stops at explicit approval', async () => {
    const f = await model(); await (f.m as any).prepareTemplate({ name: 'meeting', language: 'en' });
    expect(f.state().reply.phase).toBe('awaiting_approval'); expect(f.api.approve).not.toHaveBeenCalled(); f.m.dispose();
  });
  it('does not request approval for a draft whose chat was left while awaiting the server', async () => {
    let resolve!: (value: any) => void;
    const f = await model({ prepareTemplate: vi.fn(() => new Promise(r => { resolve = r; })) });
    const pending = (f.m as any).prepareTemplate({ name: 'meeting', language: 'en' }); await f.m.recipient('other');
    resolve(prepared({ template: { name: 'meeting', language: 'en' } })); await pending;
    expect(f.api.requestApproval).not.toHaveBeenCalled(); expect(f.state().reply.phase).toBe('idle'); f.m.dispose();
  });
  it('blocks member contact writes before calling the API', async () => {
    const saveContacts = vi.fn(); const f = await model({ saveContacts }, 'member');
    expect(await (f.m as any).saveContacts({ contacts: [{ id: 'ram', optedIn: true }] })).toBe(false); expect(saveContacts).not.toHaveBeenCalled(); f.m.dispose();
  });
  it('does not consume another approval or lose the receipt on a double approval click', async () => {
    let resolve!: (value: any) => void;
    const approve = vi.fn(() => new Promise(r => { resolve = r; })); const f = await model({ approve });
    await (f.m as any).prepareTemplate({ name: 'meeting', language: 'en' });
    const pending = f.m.approveReply(); await f.m.approveReply();
    resolve({ status: 'not_configured', verified: false }); await pending;
    expect(approve).toHaveBeenCalledTimes(1); expect(f.state().reply.phase).toBe('prepared'); f.m.dispose();
  });
  it('separately approves upload, then binds the file draft and waits for message approval', async () => {
    const upload = vi.fn(async () => ({ media })), prepareMedia = vi.fn(async () => prepared({ media: { ...media, caption: 'Meeting' } }));
    const f = await model({ upload, prepareMedia }); const file = new Blob(['synthetic'], { type: 'image/png' }); Object.defineProperty(file, 'name', { value: 'meeting.png' });
    await (f.m as any).prepareMedia(file, 'Meeting');
    expect(upload).not.toHaveBeenCalled(); expect(f.state().reply.phase).toBe('awaiting_upload_approval');
    await f.m.approveUpload();
    expect(upload).toHaveBeenCalledTimes(1); expect(prepareMedia).toHaveBeenCalledWith(c, { recipientId: 'ram', media: { ...media, caption: 'Meeting' } });
    expect(f.state().reply.phase).toBe('awaiting_approval'); expect(f.api.approve).not.toHaveBeenCalled(); f.m.dispose();
  });
  it('discards an upload result after switching inboxes without preparing another draft', async () => {
    let resolve!: (value: any) => void; const prepareMedia = vi.fn();
    const f = await model({ upload: vi.fn(() => new Promise(r => { resolve = r; })), prepareMedia }); const file = new Blob(['synthetic'], { type: 'image/png' }); Object.defineProperty(file, 'name', { value: 'image.png' });
    await f.m.prepareMedia(file as File); const pending = f.m.approveUpload(); await Promise.resolve(); await f.m.select('other'); resolve({ media }); await pending;
    expect(prepareMedia).not.toHaveBeenCalled(); expect(f.api.requestApproval).toHaveBeenCalledTimes(1); f.m.dispose();
  });
  it('discloses an uncertain upload truthfully: failure after the transfer started never auto-retries or claims a send', async () => {
    const upload = vi.fn(async () => { throw new Error('network dropped'); }), prepareMedia = vi.fn();
    const f = await model({ upload, prepareMedia }); const file = new Blob(['synthetic'], { type: 'image/png' }); Object.defineProperty(file, 'name', { value: 'image.png' });
    await f.m.prepareMedia(file as File); await f.m.approveUpload();
    expect(upload).toHaveBeenCalledTimes(1); expect(prepareMedia).not.toHaveBeenCalled();
    expect(f.state().reply).toMatchObject({ phase: 'failed', uploadAttempted: true });
    await f.m.approveUpload(); expect(upload).toHaveBeenCalledTimes(1);
    f.m.dispose();
  });
  it('a failed upload approval never transfers the file and is reported as nothing uploaded', async () => {
    const upload = vi.fn(), approveUpload = vi.fn(async () => { throw new Error('approval refused'); });
    const f = await model({ upload, approveUpload }); const file = new Blob(['synthetic'], { type: 'image/png' }); Object.defineProperty(file, 'name', { value: 'image.png' });
    await f.m.prepareMedia(file as File); await f.m.approveUpload();
    expect(upload).not.toHaveBeenCalled(); expect(f.state().reply).toMatchObject({ phase: 'failed', uploadAttempted: false });
    f.m.dispose();
  });
  it('renders each stage distinctly: upload approval (no send), message approval, and honest failure text', () => {
    const base = { ...wa.initialStoredWhatsAppState('owner'), connections: [c], selectedId: c.connectionId, recipientId: 'ram', data: { ...inbox, messages: [] } };
    const view = (reply: object) => renderToStaticMarkup(<ui.StoredWhatsAppInboxView state={{ ...base, reply } as any} onRefresh={() => {}} onSelect={() => {}} onSearch={() => {}} onRecipient={() => {}} onNext={() => {}} onPrepareReply={() => {}} onApproveUpload={() => {}} />);
    const stage1 = view({ phase: 'awaiting_upload_approval', uploadReview: { draft: { ...draftBase, filename: 'meeting.png', mimeType: 'image/png', bytes: 2048, sha256: media.sha256 } }, approvalId: uploadAuth.approvalId });
    expect(stage1).toContain('Approve uploading this file to WhatsApp?'); expect(stage1).toContain('meeting.png · 2 KB · image/png');
    expect(stage1).toContain('It does not send it to'); expect(stage1).toContain('Approve file upload');
    expect(stage1).not.toContain('Approve reply'); expect(stage1).not.toContain('<textarea');
    const stage2 = view({ phase: 'awaiting_approval', prepared: prepared({ media: { ...media, caption: 'Meeting' } }), approvalId: uploadAuth.approvalId });
    expect(stage2).toContain('Approve this WhatsApp reply?'); expect(stage2).toContain('[Image] Meeting'); expect(stage2).not.toContain('Approve file upload');
    const uncertain = view({ phase: 'failed', uploadAttempted: true });
    expect(uncertain).toContain('A file upload may already have occurred'); expect(uncertain).toContain('no automatic retry'); expect(uncertain).toContain('No message was sent');
    expect(view({ phase: 'failed', uploadAttempted: false })).toContain('Nothing was sent.');
  });
  it('reloads the catalog and invalidates a pending draft after a contact revision update', async () => {
    const saveContacts = vi.fn(async () => ({ connectionId: c.connectionId, revision: 2, contacts: 1 }));
    const f = await model({ saveContacts }); await (f.m as any).prepareTemplate({ name: 'meeting', language: 'en' });
    f.api.connections.mockResolvedValueOnce({ connections: [{ ...c, revision: 2 }] } as any); f.api.inbox.mockResolvedValueOnce({ ...inbox, revision: 2 });
    expect(await (f.m as any).saveContacts({ contacts: [{ id: 'ram', displayName: 'Ram', optedIn: true }] })).toBe(true);
    expect(f.state().reply.phase).toBe('idle'); expect(f.state().connections[0].revision).toBe(2); f.m.dispose();
  });
  it('prevents approval and duplicate saves while contact changes are in flight', async () => {
    let resolve!: (value: any) => void; const saveContacts = vi.fn(() => new Promise(r => { resolve = r; }));
    const f = await model({ saveContacts }); await (f.m as any).prepareTemplate({ name: 'meeting', language: 'en' });
    const pending = f.m.saveContacts({ contacts: [{ id: 'ram', optedIn: true }] });
    expect(await f.m.saveContacts({ contacts: [{ id: 'ram', optedIn: true }] })).toBe(false);
    await f.m.approveReply(); expect(f.api.approve).not.toHaveBeenCalled();
    resolve({ connectionId: c.connectionId, revision: 2, contacts: 1 }); await pending;
    expect(saveContacts).toHaveBeenCalledTimes(1); expect(f.state().reply.phase).toBe('idle'); f.m.dispose();
  });
  it('shows all template parameters in the approval preview as escaped text', () => {
    const state = { ...wa.initialStoredWhatsAppState('owner'), connections: [c], selectedId: c.connectionId, recipientId: 'ram', data: inbox, reply: { phase: 'awaiting_approval', prepared: prepared({ template: { name: 'meeting', language: 'en', headerParams: ['<b>Ram</b>'], bodyParams: ['Tomorrow'] } }) } };
    const html = renderToStaticMarkup(<ui.StoredWhatsAppInboxView state={state as any} onRefresh={() => {}} onSelect={() => {}} onSearch={() => {}} onRecipient={() => {}} onNext={() => {}} />);
    expect(html).toContain('Header: &lt;b&gt;Ram&lt;/b&gt;'); expect(html).toContain('Tomorrow'); expect(html).not.toContain('<b>Ram</b>');
  });
  it('shows rich content instead of an empty text approval', () => {
    const state = { ...wa.initialStoredWhatsAppState('owner'), connections: [c], selectedId: c.connectionId, recipientId: 'ram', data: inbox, reply: { phase: 'awaiting_approval', prepared: prepared({ media: { ...media, caption: '<script>hello</script>' } }) } };
    const html = renderToStaticMarkup(<ui.StoredWhatsAppInboxView state={state as any} onRefresh={() => {}} onSelect={() => {}} onSearch={() => {}} onRecipient={() => {}} onNext={() => {}} />);
    expect(html).toContain('[Image]'); expect(html).toContain('&lt;script&gt;hello&lt;/script&gt;'); expect(html).not.toContain('<script>');
  });
  it('renders a contacts editor with masked existing numbers and explicit new-contact consent', () => {
    const Component = (ui as any).WhatsAppContactsManager;
    expect(Component).toBeTypeOf('function');
    const html = renderToStaticMarkup(<Component contacts={[{ recipientId: 'ram', contactName: 'Ram', maskedPhone: '+91 ******4634', optedIn: true }]} onSave={async () => true} onClose={() => {}} />);
    expect(html).toContain('+91 ******4634'); expect(html).toContain('Add contact'); expect(html).not.toContain('phoneE164');
  });
});
