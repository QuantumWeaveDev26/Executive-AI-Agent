import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPolicyGateway } from '@thaara/policy';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { WhatsAppTransactionalFixture, waScope, waBinding, waDraft, waApproval, waEvent, waNow } from './helpers/whatsapp-durable-fixture.js';
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(waNow); });
afterEach(() => vi.useRealTimers());

function fixture() {
  const store = new WhatsAppTransactionalFixture();
  const service = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow);
  return { store, service, inbox: (query: any = {}, scope: any = waScope) => (service as any).inbox(scope, waBinding.connectionId, query) };
}
describe('durable WhatsApp authenticated inbox; synthetic transactional fixture only', () => {
  it('returns an honest empty inbox without creating history or audits', async () => {
    const f = fixture(), hash = f.store.hash();
    expect(await f.inbox()).toMatchObject({ mode: 'offline_test', liveSendingEnabled: false, verified: false, conversations: [], messages: [], nextPageToken: null });
    expect(f.store.hash()).toBe(hash); expect(f.store.audits).toHaveLength(0);
  });
  it('groups stored inbound/outbound records without exposing approvals, secrets or raw addresses', async () => {
    const f = fixture(); await f.service.ingest(waScope, waBinding.connectionId, waEvent());
    await f.service.reserve(waScope, waBinding.connectionId, waDraft, waApproval().id);
    const hash = f.store.hash(), auditCount = f.store.audits.length;
    const result = await f.inbox();
    expect(result.conversations).toMatchObject([{ recipientId: 'ram', contactName: 'Ram', messageCount: 2 }]);
    expect(result.messages).toEqual(expect.arrayContaining([expect.objectContaining({ direction: 'inbound', status: 'received', untrusted: true }), expect.objectContaining({ direction: 'outbound', status: 'reserved', verified: false, textPreview: waDraft.bodyText })]));
    const json = JSON.stringify(result);
    for (const hidden of [waScope.sessionTokenHash, waBinding.recipients[0]!.phoneE164, 'parameterHash', 'approvalId', 'bodyText', '<script>']) expect(json).not.toContain(hidden);
    expect(f.store.hash()).toBe(hash); expect(f.store.audits).toHaveLength(auditCount);
  });
  it('shows consumed claims as uncertain and preserves explicit offline evidence', async () => {
    const f = fixture(); await f.service.ingest(waScope, waBinding.connectionId, waEvent());
    const reserved = await f.service.reserve(waScope, waBinding.connectionId, waDraft, waApproval().id);
    await f.service.claim(waScope, waBinding.connectionId, reserved.dispatchId!, 1);
    expect((await f.inbox()).messages.find((m: any) => m.direction === 'outbound')).toMatchObject({ status: 'unverified', mode: 'offline_test', verified: false });
  });
  it('projects bounded correlated delivery history without changing state or claiming verification', async () => {
    const f = fixture(); await f.service.ingest(waScope, waBinding.connectionId, waEvent());
    await f.service.reserve(waScope, waBinding.connectionId, waDraft, waApproval().id);
    const dispatch = f.store.state.dispatches[0]; dispatch.claimedAt = waNow;
    dispatch.receipt.providerMessageId = 'wamid.outbound';
    const event = (status: string, timestamp: string, extra = {}) => ({ key: 'private-key', providerMessageId: 'wamid.outbound', recipientAddress: '15550000001', status, timestamp, ...extra });
    f.store.state.events = [event('read', String(waNow / 1000 + 2)), event('sent', String(waNow / 1000)), event('sent', String(waNow / 1000 + 1)), event('delivered', String(waNow / 1000 + 1)), event('failed', 'bad'), event('failed', '1e100'), event('failed', String(waNow / 1000), { recipientAddress: '15550000002' }), event('failed', String(waNow / 1000), { providerMessageId: 'wamid.foreign' }), event('unknown', String(waNow / 1000))];
    const hash = f.store.hash(), result = await f.inbox();
    const outbound = result.messages.find((m: any) => m.direction === 'outbound');
    expect(outbound).toMatchObject({ verified: false, deliveryEvents: [{ status: 'sent', timestamp: new Date(waNow).toISOString() }, { status: 'delivered', timestamp: new Date(waNow + 1000).toISOString() }, { status: 'read', timestamp: new Date(waNow + 2000).toISOString() }] });
    expect(result.messages.find((m: any) => m.direction === 'inbound')).not.toHaveProperty('deliveryEvents');
    expect(f.store.hash()).toBe(hash); expect(JSON.stringify(result)).not.toContain('private-key');
    f.store.state.events.reverse(); expect((await f.inbox()).messages.find((m: any) => m.direction === 'outbound').deliveryEvents).toEqual(outbound.deliveryEvents);
    f.store.state.dispatches[0].claimedAt = null; expect((await f.inbox()).messages.find((m: any) => m.direction === 'outbound')).not.toHaveProperty('deliveryEvents');
    f.store.state.dispatches[0].claimedAt = waNow; f.store.state.dispatches[0].receipt.providerMessageId = null;
    expect((await f.inbox()).messages.find((m: any) => m.direction === 'outbound')).not.toHaveProperty('deliveryEvents');
  });
  it('invalidates pagination when correlated saved events change without mutating receipt status', async () => {
    const f = fixture();
    for (let i = 0; i < 3; i++) await f.service.ingest(waScope, waBinding.connectionId, waEvent('wamid.history_' + i, waNow - i * 1000));
    await f.service.reserve(waScope, waBinding.connectionId, waDraft, waApproval().id);
    f.store.state.dispatches[0].claimedAt = waNow; f.store.state.dispatches[0].receipt.providerMessageId = 'wamid.outbound';
    const first = await f.inbox({ pageSize: 2 }); expect(first.nextPageToken).not.toBeNull();
    f.store.state.events.push({ key: 'saved', providerMessageId: 'wamid.outbound', recipientAddress: '15550000001', status: 'delivered', timestamp: String(waNow / 1000) });
    await expect(f.inbox({ pageSize: 2, pageToken: first.nextPageToken })).rejects.toMatchObject({ statusCode: 409 });
    expect(f.store.state.dispatches[0].receipt.status).toBe('not_configured');
  });
  it('supports literal Kannada/English search, contact-name search and recipient filtering without regex execution', async () => {
    const f = fixture(), event = waEvent(); event.messages[0]!.text.body = 'ನಾಳೆ meeting (a+b)';
    await f.service.ingest(waScope, waBinding.connectionId, event);
    expect((await f.inbox({ query: 'ನಾಳೆ' })).messages).toHaveLength(1);
    expect((await f.inbox({ query: '(a+b)' })).messages).toHaveLength(1);
    expect((await f.inbox({ query: 'Ram' })).messages).toHaveLength(1);
    expect((await f.inbox({ query: 'MEETING', recipientId: 'ram' })).messages).toHaveLength(1);
    expect((await f.inbox({ recipientId: 'unknown' })).messages).toHaveLength(0);
  });
  it('paginates stable snapshots without duplicates and rejects changed filters or tampered cursors', async () => {
    const f = fixture();
    for (let i = 0; i < 3; i++) await f.service.ingest(waScope, waBinding.connectionId, waEvent('wamid.page_' + i, waNow - i * 1000));
    const first = await f.inbox({ pageSize: 2 }); expect(first.messages).toHaveLength(2); expect(first.nextPageToken).toEqual(expect.any(String));
    const second = await f.inbox({ pageSize: 2, pageToken: first.nextPageToken }); expect(second.messages).toHaveLength(1); expect(second.nextPageToken).toBeNull();
    expect(new Set([...first.messages, ...second.messages].map(m => m.id)).size).toBe(3);
    await expect(f.inbox({ query: 'different', pageSize: 2, pageToken: first.nextPageToken })).rejects.toThrow();
    await expect(f.inbox({ pageSize: 1, pageToken: first.nextPageToken })).rejects.toThrow();
    await expect(f.inbox({ pageSize: 2, pageToken: 'bad.cursor' })).rejects.toThrow();
    await f.service.ingest(waScope, waBinding.connectionId, waEvent('wamid.new'));
    await expect(f.inbox({ pageSize: 2, pageToken: first.nextPageToken })).rejects.toMatchObject({ statusCode: 409 });
  });
  it.each([{ workspaceId: 'other' }, { userId: 'other' }, { role: 'viewer' }, { sessionTokenHash: '' }])('denies scope %j', async change => {
    await expect(fixture().inbox({}, { ...waScope, ...change })).rejects.toThrow();
  });
  it('rejects malformed/unbounded query input', async () => {
    const f = fixture();
    for (const query of [{ pageSize: 0 }, { pageSize: 51 }, { pageSize: 1.5 }, { query: 'x'.repeat(257) }, { pageToken: 'x'.repeat(100) }, { recipientId: '../other' }, { workspaceId: waScope.workspaceId }]) await expect(f.inbox(query)).rejects.toThrow();
  });
  it('does not expose retained history after disconnect', async () => {
    const f = fixture(); await f.service.ingest(waScope, waBinding.connectionId, waEvent()); await f.service.disconnect(waScope, waBinding.connectionId);
    await expect(f.inbox()).rejects.toThrow(); expect(f.store.state.messages).toHaveLength(1);
  });
});
