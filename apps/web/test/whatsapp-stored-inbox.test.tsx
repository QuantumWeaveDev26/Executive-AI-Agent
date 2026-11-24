import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fillTemplate, loadStoredWhatsAppTemplates, loadStoredWhatsAppAttachment, loadStoredWhatsAppConnections, loadStoredWhatsAppContacts, loadStoredWhatsAppInbox, loadStoredWhatsAppImagePreview, createStoredWhatsAppModel, initialStoredWhatsAppState } from '../src/whatsapp-stored-inbox';
import { StoredWhatsAppInboxView, WhatsAppImagePreview } from '../src/StoredWhatsAppInbox';
const connection = { connectionId: 'wa_test', revision: 1, disconnected: false };
const catalog = { mode: 'offline_test', liveSendingEnabled: false, connections: [connection] };
const inbox = { transport: 'n8n', mode: 'offline_test', liveSendingEnabled: false, verified: false, connectionId: 'wa_test', revision: 1,
  conversations: [{ recipientId: 'ram', maskedPhone: '+1 ******0001', messageCount: 1, lastMessageAt: '2026-10-27T04:00:00.000Z', lastMessagePreview: '<script>evil()</script>', untrusted: true }],
  messages: [{ id: 'in:wamid.test', providerMessageId: 'wamid.test', recipientId: 'ram', maskedPhone: '+1 ******0001', direction: 'inbound', textPreview: '<script>evil()</script>', timestamp: '2026-10-27T04:00:00.000Z', status: 'received', mode: 'offline_test', verified: false, untrusted: true }], nextPageToken: null };
afterEach(() => vi.unstubAllGlobals());
describe('stored WhatsApp inbox client/model/view', () => {
  it('shows escaped attachment metadata without download, playback or remote image controls', async () => {
    const attachment = { kind: 'document', mimeType: 'application/pdf', filename: '<script>report.pdf', downloadStatus: 'not_downloaded' };
    const data = { ...inbox, messages: [{ ...inbox.messages[0], attachment }] };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    await expect(loadStoredWhatsAppInbox(connection, {})).resolves.toMatchObject({ messages: [{ attachment }] });
    const html = renderToStaticMarkup(<StoredWhatsAppInboxView state={{ ...initialStoredWhatsAppState('member'), connections: [connection], selectedId: connection.connectionId, recipientId: 'ram', data } as any} onRefresh={() => {}} onSelect={() => {}} onSearch={() => {}} onRecipient={() => {}} onNext={() => {}} />);
    expect(html).toContain('Document attachment'); expect(html).toContain('Not downloaded'); expect(html).toContain('&lt;script&gt;report.pdf');
    for (const tag of ['<script>', '<img', '<audio', '<iframe', 'href=']) expect(html).not.toContain(tag);
  });
  it.each([{ url: 'http://127.0.0.1/private' }, { mediaId: '123456789' }, { downloadStatus: 'verified' }, { kind: 'script' }, { mimeType: 'text/html' }, { filename: '../file.pdf' }])('rejects unsafe attachment payloads', async changes => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...inbox, messages: [{ ...inbox.messages[0], attachment: { kind: 'image', mimeType: 'image/jpeg', downloadStatus: 'not_downloaded', ...changes } }] }) })));
    await expect(loadStoredWhatsAppInbox(connection, {})).rejects.toThrow();
  });
  it('renders saved delivery events with an unverified disclosure and accepts older responses without events', async () => {
    const data = { ...inbox, messages: [{ ...inbox.messages[0], direction: 'outbound', status: 'read', deliveryEvents: [{ status: 'read', timestamp: '2026-10-27T04:00:00.000Z' }] }] };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    await expect(loadStoredWhatsAppInbox(connection, {})).resolves.toMatchObject({ messages: [{ deliveryEvents: [{ status: 'read' }] }] });
    const html = renderToStaticMarkup(<StoredWhatsAppInboxView state={{ ...initialStoredWhatsAppState('member'), connections: [connection], selectedId: connection.connectionId, recipientId: 'ram', data } as any} onRefresh={() => {}} onSelect={() => {}} onSearch={() => {}} onRecipient={() => {}} onNext={() => {}} />);
    expect(html).toContain('Saved delivery events'); expect(html).toContain('Read'); expect(html).toContain('Statuses come from saved provider events'); expect(html).not.toContain('Verified delivery');
  });
  it.each([[{ status: 'read', timestamp: 'not-a-date' }], [{ status: 'invented', timestamp: '2026-10-27T04:00:00Z' }], Array(5).fill({ status: 'read', timestamp: '2026-10-27T04:00:00Z' })])('rejects malformed delivery histories', async deliveryEvents => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...inbox, messages: [{ ...inbox.messages[0], deliveryEvents }] }) })));
    await expect(loadStoredWhatsAppInbox(connection, {})).rejects.toThrow();
  });
  it.each([
    { direction: 'inbound', providerMessageId: 'wamid.test' },
    { direction: 'outbound', providerMessageId: null },
    { direction: 'outbound', providerMessageId: 'wamid.test', deliveryEvents: [{ status: 'read', timestamp: '2026-10-27T04:00:00.000Z' }, { status: 'read', timestamp: '2026-10-27T04:00:01.000Z' }] },
    { direction: 'outbound', providerMessageId: 'wamid.test', deliveryEvents: [{ status: 'read', timestamp: '2026-02-30T04:00:00.000Z' }] }
  ])('rejects uncorrelatable, duplicated or impossible delivery history', async changes => {
    const deliveryEvents = [{ status: 'read', timestamp: '2026-10-27T04:00:00.000Z' }];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...inbox, messages: [{ ...inbox.messages[0], deliveryEvents, ...changes }] }) })));
    await expect(loadStoredWhatsAppInbox(connection, {})).rejects.toThrow();
  });
  it('uses only fixed authenticated read endpoints, abort signal and no credentials in URLs/body', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => catalog }).mockResolvedValueOnce({ ok: true, json: async () => inbox }); vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    await loadStoredWhatsAppConnections(controller.signal); await loadStoredWhatsAppInbox(connection, { query: 'ನಾಳೆ' }, controller.signal);
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/connectors/whatsapp/n8n/durable/connections');
    expect(fetcher.mock.calls[1]![0]).toContain('/wa_test/inbox?');
    expect(fetcher.mock.calls[1]![1]).toMatchObject({ credentials: 'include', cache: 'no-store', signal: controller.signal });
    expect(fetcher.mock.calls[1]![1].body).toBeUndefined();
  });
  it.each([{ ...inbox, verified: true }, { ...inbox, connectionId: 'foreign' }, { ...inbox, revision: 2 }, { ...inbox, liveSendingEnabled: 'yes' }, { ...inbox, messages: [{ ...inbox.messages[0], maskedPhone: '+15550000001' }] }])('rejects unsafe/cross-connection server data', async response => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => response })));
    await expect(loadStoredWhatsAppInbox(connection, {})).rejects.toThrow();
  });
  it.each([{ ...catalog, mode: 'live' }, { ...catalog, connections: [connection, connection] }, { ...catalog, secret: 'must-not-be-accepted' }])('rejects malformed or overbroad connection catalogs', async response => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => response })));
    await expect(loadStoredWhatsAppConnections()).rejects.toThrow();
  });
  it('discovers accounts and loads stored data without inventing messages', async () => {
    let state: any; const api = { connections: vi.fn(async () => catalog), inbox: vi.fn(async () => inbox) };
    const model = createStoredWhatsAppModel('member', s => { state = s; }, api as any);
    await model.load(); expect(state.data.messages).toHaveLength(1); expect(state.selectedId).toBe('wa_test');
    model.dispose();
    let empty: any; const emptyModel = createStoredWhatsAppModel('member', s => { empty = s; }, { ...api, connections: async () => ({ ...catalog, connections: [] }) } as any);
    await emptyModel.load(); expect(empty.data).toBeNull(); expect(empty.connections).toHaveLength(0); emptyModel.dispose();
  });
  it('clears previous messages immediately on search or account change and ignores late completion after dispose', async () => {
    let state: any, release!: (data: any) => void;
    const api = { connections: async () => catalog, inbox: vi.fn().mockResolvedValueOnce(inbox).mockImplementationOnce(() => new Promise(r => { release = r; })) };
    const model = createStoredWhatsAppModel('member', s => { state = s; }, api as any); await model.load();
    const pending = model.search('new query'); expect(state.data).toBeNull(); expect(state.loading).toBe(true);
    model.dispose(); const snapshot = state; release(inbox); await pending; expect(state).toBe(snapshot);
  });
  it('blocks viewers without making requests and treats storage failures honestly', async () => {
    const api = { connections: vi.fn(async () => { throw Error('private details'); }), inbox: vi.fn() }; let state: any;
    const denied = createStoredWhatsAppModel('viewer', s => { state = s; }, api as any); await denied.load(); expect(api.connections).not.toHaveBeenCalled(); expect(state.error).toBe('unauthorized'); denied.dispose();
    const model = createStoredWhatsAppModel('member', s => { state = s; }, api as any); await model.load(); expect(state.data).toBeNull(); expect(state.error).toBe('unavailable'); model.dispose();
  });
  it('ignores out-of-order search responses and clears messages after access revocation', async () => {
    let state: any, release!: (value: any) => void;
    const api = { connections: async () => catalog, inbox: vi.fn().mockResolvedValueOnce(inbox).mockImplementationOnce(() => new Promise(r => { release = r; })).mockResolvedValueOnce({ ...inbox, messages: [] }) };
    const model = createStoredWhatsAppModel('member', s => { state = s; }, api as any); await model.load();
    const stale = model.search('old'); await model.search('new'); release(inbox); await stale;
    expect(state.query).toBe('new'); expect(state.data.messages).toHaveLength(0);
    const { ApiRequestError } = await import('../src/api'); api.inbox.mockRejectedValueOnce(new ApiRequestError(403, 'private details'));
    await model.search('revoked'); expect(state.data).toBeNull(); expect(state.connections).toHaveLength(0); expect(state.error).toBe('unauthorized'); model.dispose();
  });
  it('appends bounded pages and clears stale snapshots on409 without retry', async () => {
    let state: any; const token = 'a'.repeat(64) + '.20';
    const { ApiRequestError } = await import('../src/api');
    const api = { connections: async () => catalog, inbox: vi.fn().mockResolvedValueOnce({ ...inbox, nextPageToken: token }).mockResolvedValueOnce({ ...inbox, messages: [{ ...inbox.messages[0], id: 'in:wamid.next' }], nextPageToken: 'a'.repeat(64) + '.40' }).mockRejectedValueOnce(new ApiRequestError(409, 'changed')) };
    const model = createStoredWhatsAppModel('member', s => { state = s; }, api as any); await model.load(); await model.next(); expect(state.data.messages).toHaveLength(2);
    expect(api.inbox.mock.calls[1]![1].pageToken).toBe(token); await model.next(); expect(state.data).toBeNull(); expect(state.error).toBe('changed'); expect(api.inbox).toHaveBeenCalledTimes(3); model.dispose();
  });
  it('rejects a repeated next-page cursor instead of looping through fabricated pages', async () => {
    let state: any; const token = 'a'.repeat(64) + '.20';
    const api = { connections: async () => catalog, inbox: vi.fn().mockResolvedValueOnce({ ...inbox, nextPageToken: token }).mockResolvedValueOnce({ ...inbox, messages: [{ ...inbox.messages[0], id: 'in:wamid.next' }], nextPageToken: token }) };
    const model = createStoredWhatsAppModel('member', s => { state = s; }, api as any); await model.load(); await model.next();
    expect(state.data).toBeNull(); expect(state.error).toBe('unavailable'); expect(api.inbox).toHaveBeenCalledTimes(2); model.dispose();
  });
  it('requires a choice for multiple inboxes, preserves it on refresh, and clears it when disconnected', async () => {
    const second = { connectionId: 'wa_second', revision: 1, disconnected: false };
    let available = [connection, second], state: any;
    const api = { connections: vi.fn(async () => ({ ...catalog, connections: available })), inbox: vi.fn(async (c: typeof connection) => ({ ...inbox, connectionId: c.connectionId })) };
    const model = createStoredWhatsAppModel('member', s => { state = s; }, api as any);
    await model.load();
    expect(state.selectedId).toBeNull(); expect(state.data).toBeNull(); expect(api.inbox).not.toHaveBeenCalled();
    await model.select(second.connectionId); expect(state.selectedId).toBe(second.connectionId);
    await model.load(); expect(state.selectedId).toBe(second.connectionId); expect(state.data.connectionId).toBe(second.connectionId);
    available = [connection, { ...second, disconnected: true }];
    await model.load(); expect(state.selectedId).toBe(connection.connectionId); expect(state.data.connectionId).toBe(connection.connectionId);
    available = available.map(c => ({ ...c, disconnected: true }));
    await model.load(); expect(state.selectedId).toBeNull(); expect(state.data).toBeNull(); model.dispose();
  });
  it('prompts for an inbox choice without claiming all available inboxes are disconnected', () => {
    const state = { ...initialStoredWhatsAppState('member'), connections: [connection, { ...connection, connectionId: 'wa_second' }] };
    const html = renderToStaticMarkup(<StoredWhatsAppInboxView state={state} onRefresh={() => {}} onSelect={() => {}} onSearch={() => {}} onRecipient={() => {}} onNext={() => {}} />);
    expect(html).toContain('Select an inbox to view its saved conversations.'); expect(html).not.toContain('All stored inboxes are disconnected.');
    expect(html).toContain('Saved inbox 1'); expect(html).toContain('Saved inbox 2');
  });
  it('renders escaped messages, contact names, honest stored-status warnings, selection and no send controls', async () => {
    const namedInbox = { ...inbox, conversations: [{ ...inbox.conversations[0]!, contactName: 'Ram Kumar' }] };
    const state = { ...initialStoredWhatsAppState('member'), connections: [connection], selectedId: 'wa_test', data: namedInbox } as any;
    const html = renderToStaticMarkup(<StoredWhatsAppInboxView state={state} onRefresh={() => {}} onSelect={() => {}} onSearch={() => {}} onRecipient={() => {}} onNext={() => {}} />);
    expect(html).toContain('Stored conversations'); expect(html).toContain('Saved WhatsApp records'); expect(html).toContain('Sending is disabled');
    expect(html).not.toContain('Real WhatsApp messaging is not connected yet'); expect(html).not.toContain('Test record'); expect(html).not.toContain('Test data');
    expect(html).toContain('Statuses come from saved provider events');
    expect(html).toContain('Ram Kumar (+1 ******0001)');
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>'); expect(html).not.toContain('Send message');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...inbox, conversations: [{ ...inbox.conversations[0]!, contactName: '+15550000001' }] }) })));
    await expect(loadStoredWhatsAppInbox(connection, {})).rejects.toThrow();
  });
});

describe('stored inbox reply preparation (sending disabled)', () => {
  const draft = { connectionId: 'wa_test', connectionRevision: 1, senderPhoneNumberId: '100020003000', recipientId: 'ram', bodyText: 'Noted', idempotencyKey: 'reply-00000000-0000-4000-8000-000000000001' };
  const prepared = { draft, actionName: 'whatsapp.meta.messages.send', riskLevel: 'high', liveSendingEnabled: false } as const;
  const receipt = { transport: 'n8n', mode: 'offline_test', dispatchId: 'd1', providerMessageId: null, status: 'not_configured', verified: false } as const;
  async function ready(extra: Record<string, unknown> = {}) {
    const states: any[] = [];
    const api: any = { connections: vi.fn(async () => catalog), inbox: vi.fn(async () => inbox), prepare: vi.fn(async () => prepared), requestApproval: vi.fn(async () => '11111111-1111-4111-8111-111111111111'), approve: vi.fn(async () => receipt), ...extra };
    const model = createStoredWhatsAppModel('owner', s => states.push(s), api);
    await model.load(); await model.recipient('ram');
    return { model, api, last: () => states[states.length - 1] };
  }
  it('prepares, waits for an explicit approval click, then shows Prepared, not sent', async () => {
    const f = await ready();
    await f.model.prepareReply('Noted');
    expect(f.api.prepare).toHaveBeenCalledWith(connection, { recipientId: 'ram', bodyText: 'Noted' });
    expect(f.last().reply).toMatchObject({ phase: 'awaiting_approval', approvalId: '11111111-1111-4111-8111-111111111111' });
    expect(f.api.approve).not.toHaveBeenCalled();
    await f.model.approveReply();
    expect(f.api.approve).toHaveBeenCalledTimes(1);
    expect(f.last().reply).toMatchObject({ phase: 'prepared', receipt: { status: 'not_configured', verified: false } });
  });
  it('fails closed and never approves when preparation fails; ignores empty or oversized text', async () => {
    const f = await ready({ prepare: vi.fn(async () => { throw new Error('denied'); }) });
    await f.model.prepareReply('   '); await f.model.prepareReply('x'.repeat(4097));
    expect(f.api.prepare).not.toHaveBeenCalled();
    await f.model.prepareReply('Noted');
    expect(f.last().reply.phase).toBe('failed'); expect(f.api.approve).not.toHaveBeenCalled();
    await f.model.approveReply(); expect(f.api.approve).not.toHaveBeenCalled();
  });
  it('switching conversation discards a pending reply', async () => {
    const f = await ready(); await f.model.prepareReply('Noted');
    await f.model.recipient(null); expect(f.last().reply.phase).toBe('idle');
    await f.model.approveReply(); expect(f.api.approve).not.toHaveBeenCalled();
  });
  it('view states sending is disabled and shows the approval step and the not-sent result', () => {
    const base = { ...initialStoredWhatsAppState('owner'), connections: [connection], selectedId: 'wa_test', recipientId: 'ram', data: inbox as any };
    const handlers = { onRefresh() {}, onSelect() {}, onSearch() {}, onRecipient() {}, onNext() {}, onPrepareReply() {}, onApproveReply() {}, onDiscardReply() {} };
    const idle = renderToStaticMarkup(<StoredWhatsAppInboxView state={base} {...handlers} />);
    expect(idle).toContain('Sending is disabled'); expect(idle).toContain('Prepare reply (needs approval)');
    const waiting = renderToStaticMarkup(<StoredWhatsAppInboxView state={{ ...base, reply: { phase: 'awaiting_approval', prepared, approvalId: 'a' } as any }} {...handlers} />);
    expect(waiting).toContain('Approve reply'); expect(waiting).not.toContain('Prepare reply (needs approval)');
    const done = renderToStaticMarkup(<StoredWhatsAppInboxView state={{ ...base, reply: { phase: 'prepared', prepared, receipt } as any }} {...handlers} />);
    expect(done).toContain('Prepared, not sent'); expect(done).toContain('Nothing was sent to WhatsApp');
  });
});
describe('verified image preview (Step 108.22, simulated server)', () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
  const respond = (body: Uint8Array | string, status = 200, type = 'image/jpeg') => vi.fn(async () => new Response(body, { status, headers: { 'content-type': type } }));
  beforeEach(() => vi.stubGlobal('document', { cookie: 'thaara_csrf=synthetic-csrf' }));
  it('posts with CSRF to the owner route by saved message ID only and returns a re-checked image blob', async () => {
    const call = respond(JPEG);
    const blob = await loadStoredWhatsAppImagePreview(connection, 'wamid.test', call as any);
    expect(blob.type).toBe('image/jpeg'); expect(blob.size).toBe(JPEG.length);
    const [url, init] = call.mock.calls[0] as any;
    expect(url).toBe('/api/v1/connectors/whatsapp/n8n/durable/wa_test/media/wamid.test/preview');
    expect(init).toMatchObject({ method: 'POST', body: '{}', credentials: 'include', cache: 'no-store', redirect: 'error' });
    expect(init.headers.get('x-csrf-token')).toBe('synthetic-csrf');
  });
  it.each([
    [respond('<svg onload="x()"></svg>', 200, 'image/jpeg'), 'unverified'], [respond(JPEG, 200, 'image/svg+xml'), 'unverified'], [respond(JPEG, 200, 'text/html'), 'unverified'],
    [respond('', 503), 'not_configured'], [respond('', 403), 'denied'], [respond('', 429), 'rate_limited'], [respond('', 502), 'unverified']
  ])('refuses unsafe or failed responses truthfully', async (call, reason) => {
    await expect(loadStoredWhatsAppImagePreview(connection, 'wamid.test', call as any)).rejects.toMatchObject({ reason });
  });
  it('never calls the server for a malformed message ID', async () => {
    const call = respond(JPEG);
    await expect(loadStoredWhatsAppImagePreview(connection, 'https://evil.example/x', call as any)).rejects.toMatchObject({ reason: 'denied' });
    expect(call).not.toHaveBeenCalled();
  });
  it('offers an on-request preview button for saved JPEG/PNG images only, never an automatic image load', () => {
    const image = { kind: 'image', mimeType: 'image/jpeg', downloadStatus: 'not_downloaded' };
    const data = { ...inbox, messages: [{ ...inbox.messages[0], attachment: image }] };
    const view = (onLoadImage?: any) => renderToStaticMarkup(<StoredWhatsAppInboxView state={{ ...initialStoredWhatsAppState('member'), connections: [connection], selectedId: connection.connectionId, recipientId: 'ram', data } as any} onRefresh={() => {}} onSelect={() => {}} onSearch={() => {}} onRecipient={() => {}} onNext={() => {}} onLoadImage={onLoadImage} />);
    const html = view(async () => new Blob());
    expect(html).toContain('Load image preview'); expect(html).not.toContain('<img');
    expect(view()).toContain('File preview and playback are unavailable');
    expect(renderToStaticMarkup(<WhatsAppImagePreview load={async () => new Blob()} />)).toContain('Load image preview');
  });
});

describe('WhatsApp-style chat experience (Step 108.23)', () => {
  const base = inbox.messages[0]!;
  const msgs = [
    { ...base, id: 'in:a', providerMessageId: 'wamid.a', textPreview: 'Hello from Ram', timestamp: '2026-10-27T04:00:00.000Z' },
    { ...base, id: 'out:b', providerMessageId: 'wamid.b', direction: 'outbound', status: 'read', textPreview: 'Read reply', timestamp: '2026-10-28T05:00:00.000Z' },
    { ...base, id: 'out:c', providerMessageId: null, direction: 'outbound', status: 'reserved', textPreview: 'Prepared one', timestamp: '2026-10-28T06:00:00.000Z' }
  ];
  const contact = (eligibility: string) => ({ recipientId: 'ram', contactName: 'Ram Kumar', maskedPhone: '+91 ******1539', optedIn: eligibility !== 'not_opted_in', lastInboundAt: null, eligibility });
  const render = (extra: Record<string, unknown> = {}, props: Record<string, unknown> = {}) => renderToStaticMarkup(<StoredWhatsAppInboxView now={Date.parse('2026-10-28T08:00:00.000Z')}
    state={{ ...initialStoredWhatsAppState('member'), connections: [connection], selectedId: 'wa_test', recipientId: 'ram', data: { ...inbox, messages: msgs }, conversations: inbox.conversations, ...extra } as any}
    onRefresh={() => {}} onSelect={() => {}} onSearch={() => {}} onRecipient={() => {}} onNext={() => {}} {...props} />);
  it('renders bubbles in time order with date separators and truthful ticks', () => {
    const html = render({}, { onPrepareReply: () => {}, onPrepareMedia: () => {} });
    expect(html.indexOf('Hello from Ram')).toBeLessThan(html.indexOf('Read reply'));
    expect(html).toContain('Yesterday'); expect(html).toContain('Today');
    expect(html).toContain('wa-bubble--in'); expect(html).toContain('wa-bubble--out');
    expect(html).toContain('aria-label="Read"'); expect(html).toContain('aria-label="Prepared, not sent"'); expect(html).not.toContain('aria-label="Delivered"');
    expect(html).toContain('wa-app--chat-open'); expect(html).toContain('Back to chats');
    expect(html).toContain('Shift+Enter adds a new line'); expect(html).toContain('Insert emoji'); expect(html).toContain('aria-label="Attach file"');
  });
  it('blocks the composer truthfully when the 24-hour window is closed or the contact has not opted in', () => {
    const closed = render({ contacts: [contact('window_closed')] }, { onPrepareReply: () => {} });
    expect(closed).toContain('An approved template is needed'); expect(closed).toMatch(/<textarea[^>]*disabled/);
    expect(render({ contacts: [contact('not_opted_in')] }, { onPrepareReply: () => {} })).toContain('has not opted in');
    expect(render({ contacts: [contact('eligible')] }, { onPrepareReply: () => {} })).not.toMatch(/<textarea[^>]*disabled/);
  });
  it('switches wording truthfully when live sending is on (still approval-gated)', () => {
    const off = render({}, { onPrepareReply: () => {} });
    expect(off).toContain('Sending is disabled'); expect(off).toContain('aria-label="Prepared, not sent"');
    const on = render({ data: { ...inbox, liveSendingEnabled: true, messages: msgs } }, { onPrepareReply: () => {} });
    expect(on).toContain('Live sending on'); expect(on).not.toContain('Sending is disabled');
    expect(on).toContain('aria-label="Queued, not yet sent"'); expect(on).toContain('needs your approval');
    const approval = render({ data: { ...inbox, liveSendingEnabled: true, messages: msgs }, reply: { phase: 'awaiting_approval', prepared: { draft: { bodyText: 'Joining at 11' } } } }, { onPrepareReply: () => {} });
    expect(approval).toContain('Approving sends this exact message on WhatsApp.');
  });
  it('shows a chat list with names, masked numbers and an empty prompt when no chat is open', () => {
    const html = render({ recipientId: null });
    expect(html).toContain('Select a chat'); expect(html).not.toContain('wa-app--chat-open'); expect(html).toContain('Search chats and messages');
  });
  it('accepts only masked, de-duplicated authorized contacts', async () => {
    const ok = { connectionId: 'wa_test', revision: 1, liveSendingEnabled: false, contacts: [contact('eligible')] };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ok })));
    await expect(loadStoredWhatsAppContacts(connection)).resolves.toHaveLength(1);
    for (const bad of [{ ...ok, contacts: [{ ...contact('eligible'), maskedPhone: '+919187951539' }] }, { ...ok, contacts: [contact('eligible'), contact('eligible')] }, { ...ok, contacts: [{ ...contact('eligible'), contactName: '+919187951539' }] }, { ...ok, revision: 2 }, { ...ok, contacts: [{ ...contact('eligible'), phoneE164: '+919187951539' }] }]) {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => bad })));
      await expect(loadStoredWhatsAppContacts(connection)).rejects.toThrow();
    }
  });
});

describe('document download and audio playback client (Step 108.25, simulated server)', () => {
  beforeEach(() => vi.stubGlobal('document', { cookie: 'thaara_csrf=synthetic-csrf' }));
  const PDF = new TextEncoder().encode('%PDF-1.7 test');
  const reply = (body: Uint8Array, headers: Record<string, string>, status = 200) => vi.fn(async () => new Response(body, { status, headers }));
  const docHeaders = { 'content-type': 'application/pdf', 'x-whatsapp-media-kind': 'document', 'content-disposition': "attachment; filename=\"whatsapp-document.pdf\"; filename*=UTF-8''Q3%20report%2F..%5Cevil.pdf" };
  it('downloads a verified document by saved message ID with CSRF and a sanitized filename', async () => {
    const call = reply(PDF, docHeaders);
    const out = await loadStoredWhatsAppAttachment(connection, 'wamid.test', 'document', call as any);
    expect(out.blob.type).toBe('application/pdf'); expect(out.filename).toBe('Q3 report_.._evil.pdf');
    const [url, init] = call.mock.calls[0] as any;
    expect(url).toBe('/api/v1/connectors/whatsapp/n8n/durable/wa_test/media/wamid.test/content');
    expect(init).toMatchObject({ method: 'POST', body: '{}', credentials: 'include', redirect: 'error' }); expect(init.headers.get('x-csrf-token')).toBe('synthetic-csrf');
  });
  it.each([
    ['inline document', { ...docHeaders, 'content-disposition': 'inline; filename="x.pdf"' }],
    ['HTML disguised', { ...docHeaders, 'content-type': 'text/html' }],
    ['kind mismatch', { ...docHeaders, 'x-whatsapp-media-kind': 'audio' }]
  ])('refuses %s', async (_name, headers) => {
    await expect(loadStoredWhatsAppAttachment(connection, 'wamid.test', 'document', reply(PDF, headers) as any)).rejects.toMatchObject({ reason: 'unverified' });
  });
  it('plays verified audio types only and reports setup/denied truthfully', async () => {
    const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53]);
    const ok = await loadStoredWhatsAppAttachment(connection, 'wamid.test', 'audio', reply(ogg, { 'content-type': 'audio/ogg', 'x-whatsapp-media-kind': 'audio', 'content-disposition': 'inline; filename="whatsapp-audio.ogg"' }) as any);
    expect(ok.blob.type).toBe('audio/ogg');
    await expect(loadStoredWhatsAppAttachment(connection, 'wamid.test', 'audio', reply(ogg, { 'content-type': 'video/mp4', 'x-whatsapp-media-kind': 'audio' }) as any)).rejects.toMatchObject({ reason: 'unverified' });
    await expect(loadStoredWhatsAppAttachment(connection, 'wamid.test', 'audio', reply(new Uint8Array(), {}, 503) as any)).rejects.toMatchObject({ reason: 'not_configured' });
    await expect(loadStoredWhatsAppAttachment(connection, 'wamid.test', 'document', reply(new Uint8Array(), {}, 403) as any)).rejects.toMatchObject({ reason: 'denied' });
    const never = reply(ogg, {});
    await expect(loadStoredWhatsAppAttachment(connection, 'javascript:alert(1)', 'audio', never as any)).rejects.toMatchObject({ reason: 'denied' }); expect(never).not.toHaveBeenCalled();
  });
  it('shows Download for documents and Play audio for audio, never an automatic load', () => {
    const view = (attachment: any) => renderToStaticMarkup(<StoredWhatsAppInboxView state={{ ...initialStoredWhatsAppState('member'), connections: [connection], selectedId: 'wa_test', recipientId: 'ram', data: { ...inbox, messages: [{ ...inbox.messages[0], attachment }] } } as any}
      onRefresh={() => {}} onSelect={() => {}} onSearch={() => {}} onRecipient={() => {}} onNext={() => {}} onLoadAttachment={async () => ({ blob: new Blob(), filename: 'x' })} />);
    const doc = view({ kind: 'document', mimeType: 'application/pdf', filename: 'Q3.pdf', downloadStatus: 'not_downloaded' });
    expect(doc).toContain('>Download<'); expect(doc).toContain('Q3.pdf'); expect(doc).not.toContain('<a ');
    const audio = view({ kind: 'audio', mimeType: 'audio/ogg; codecs=opus', downloadStatus: 'not_downloaded' });
    expect(audio).toContain('Play audio'); expect(audio).not.toContain('<audio');
  });
});

describe('templates (Step 108.25, simulated server)', () => {
  const t = { name: 'meeting_reminder', language: 'en_US', status: 'APPROVED', category: 'UTILITY', bodyText: 'Meeting at {{1}} on {{2}}', bodyParams: 2 };
  it('accepts only the validated catalog for this connection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ connectionId: 'wa_test', templates: [t] }) })));
    await expect(loadStoredWhatsAppTemplates(connection)).resolves.toHaveLength(1);
    for (const bad of [{ connectionId: 'other', templates: [t] }, { connectionId: 'wa_test', templates: [{ ...t, url: 'https://evil.example' }] }, { connectionId: 'wa_test', templates: [{ ...t, status: 'LIVE' }] }]) {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => bad })));
      await expect(loadStoredWhatsAppTemplates(connection)).rejects.toThrow();
    }
  });
  it('fills variables as plain text for preview and leaves missing ones visible', () => {
    expect(fillTemplate('Meeting at {{1}} on {{2}}', ['11 AM', ''])).toBe('Meeting at 11 AM on {{2}}');
    expect(fillTemplate('Hi {{1}}', ['<b>Ram</b>'])).toBe('Hi <b>Ram</b>');
  });
  it('offers the template button in the composer even when the 24-hour window is closed', () => {
    const html = renderToStaticMarkup(<StoredWhatsAppInboxView state={{ ...initialStoredWhatsAppState('member'), connections: [connection], selectedId: 'wa_test', recipientId: 'ram', data: inbox, contacts: [{ recipientId: 'ram', contactName: 'Ram', maskedPhone: '+91 ******0001', optedIn: true, lastInboundAt: null, eligibility: 'window_closed' }] } as any}
      onRefresh={() => {}} onSelect={() => {}} onSearch={() => {}} onRecipient={() => {}} onNext={() => {}} onPrepareReply={() => {}} onLoadTemplates={async () => []} />);
    expect(html).toContain('aria-label="Message templates"'); expect(html).toMatch(/<textarea[^>]*disabled/);
  });
});
