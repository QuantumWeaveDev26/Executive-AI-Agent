import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPolicyGateway } from '@thaara/policy';
import { WhatsAppTransactionalFixture, waScope, waBinding, waDraft, waApproval, waEvent, waStatus, waNow } from './helpers/whatsapp-durable-fixture.js';

const implementation = await import('../src/services/whatsapp-durable.js').catch(() => null);
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(waNow); });
afterEach(() => vi.useRealTimers());
function fixture() {
  expect(implementation?.DurableWhatsAppService, 'durable service is implemented').toBeTypeOf('function');
  const store = new WhatsAppTransactionalFixture(); let now = waNow;
  const service = () => new implementation!.DurableWhatsAppService(store, defaultPolicyGateway, () => now);
  const api = service(), id = waBinding.connectionId, approvalId = waApproval().id;
  const received = () => api.ingest(waScope, id, waEvent());
  const reserve = () => api.reserve(waScope, id, waDraft, approvalId);
  return { store, api, service, id, approvalId, received, reserve, time: (t: number) => { now = t; } };
}
describe('Step 108.3 durable domain with transactional double (not PostgreSQL evidence)', () => {
  it('persists inbound references across service instances without executing a reply', async () => {
    const f = fixture(); await f.received();
    expect(await f.service().history(waScope, f.id)).toMatchObject([{ providerMessageId: 'wamid.inbound', recipientId: 'ram', untrusted: true }]);
    expect(f.store.state.dispatches).toHaveLength(0);
    expect(JSON.stringify(f.store.state.messages)).not.toContain('<script>');
    expect(await f.api.status(waScope, f.id)).toMatchObject({ liveSendingEnabled: false, storage: 'postgresql_offline', mode: 'offline_test' });
  });
  it.each([{ workspaceId: '22222222-2222-4222-8222-222222222222' }, { userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, { role: 'viewer' }])('rejects unauthorized scope %j', async change => {
    const f = fixture(); await expect(f.api.history({ ...waScope, ...change } as any, f.id)).rejects.toThrow();
  });
  it('deduplicates concurrent inbound events and retains deduplication after service restart', async () => {
    const f = fixture(); const results = await Promise.all([f.received(), f.received()]);
    expect(results.map(r => r.acceptedMessages).sort()).toEqual([0, 1]);
    expect(await f.service().ingest(waScope, f.id, waEvent())).toMatchObject({ acceptedMessages: 0, duplicates: 1 });
  });
  it('reserves one dispatch for concurrent identical requests and rejects changed content', async () => {
    const f = fixture(); await f.received(); const [a, b] = await Promise.all([f.reserve(), f.reserve()]);
    expect(a.dispatchId).toBe(b.dispatchId); expect(f.store.state.dispatches).toHaveLength(1);
    const changed = { ...waDraft, bodyText: 'Changed' }; f.store.setApproval(changed);
    await expect(f.api.reserve(waScope, f.id, changed, f.approvalId)).rejects.toThrow();
  });
  it('allows one claim across two service instances and keeps sends disabled', async () => {
    const f = fixture(); await f.received(); const r = await f.reserve();
    const claims = await Promise.allSettled([f.api.claim(waScope, f.id, r.dispatchId!, 1), f.service().claim(waScope, f.id, r.dispatchId!, 1)]);
    expect(claims.filter(c => c.status === 'fulfilled')).toHaveLength(1);
    expect((claims.find(c => c.status === 'fulfilled') as any).value).toMatchObject({ dispatchEnabled: false, authorized: true, textBody: waDraft.bodyText });
  });
  it('expires claims at exactly sixty seconds', async () => {
    const f = fixture(); await f.received(); const r = await f.reserve(); f.time(waNow + 60000);
    await expect(f.api.claim(waScope, f.id, r.dispatchId!, 1)).rejects.toThrow();
  });
  it.each(['rejected', 'expired', 'pending'])('rejects %s approval at claim time', async status => {
    const f = fixture(); await f.received(); const r = await f.reserve();
    f.store.approvals.set(f.approvalId, { ...waApproval(), status } as any);
    await expect(f.api.claim(waScope, f.id, r.dispatchId!, 1)).rejects.toThrow();
    expect(f.store.state.dispatches[0].claimedAt).toBeNull();
  });
  it('rejects approval expiry and recipient mismatch and messaging-window expiry', async () => {
    const f = fixture(); await f.received(); f.time(waNow + 3600000); await expect(f.reserve()).rejects.toThrow();
    f.time(waNow); const bad = { ...waDraft, recipientId: 'unknown' }; f.store.setApproval(bad);
    await expect(f.api.reserve(waScope, f.id, bad, f.approvalId)).rejects.toThrow();
    f.store.approvals.set(f.approvalId, { ...waApproval(), expiresAt: new Date(waNow + 172800000).toISOString() });
    f.time(waNow + 86400000); await expect(f.reserve()).rejects.toThrow();
  });
  it('rechecks approval after audit before claim publication', async () => {
    const f = fixture(); await f.received(); const r = await f.reserve();
    f.store.afterAudit = () => f.store.approvals.set(f.approvalId, { ...waApproval(), status: 'rejected' });
    await expect(f.api.claim(waScope, f.id, r.dispatchId!, 1)).rejects.toThrow();
    expect(f.store.state.dispatches[0].claimedAt).toBeNull();
  });
  it('retains a disconnect tombstone, increments revision and fences stale claims/callbacks', async () => {
    const f = fixture(); await f.received(); const r = await f.reserve(); await f.api.disconnect(waScope, f.id);
    expect(f.store.state).toMatchObject({ disconnected: true, binding: { revision: 2 } });
    expect(f.store.state.dispatches).toHaveLength(1);
    await expect(f.service().claim(waScope, f.id, r.dispatchId!, 1)).rejects.toThrow();
    await expect(f.api.ingest(waScope, f.id, waEvent('wamid.late'))).rejects.toThrow();
  });
  it('rolls back reservations, claims and inbound changes when audit fails', async () => {
    const f = fixture(); f.store.failAudit = true; const initial = f.store.hash();
    await expect(f.received()).rejects.toThrow(); expect(f.store.hash()).toBe(initial);
    f.store.failAudit = false; await f.received(); const r = await f.reserve(); const before = f.store.hash();
    f.store.failAudit = true; await expect(f.api.claim(waScope, f.id, r.dispatchId!, 1)).rejects.toThrow(); expect(f.store.hash()).toBe(before);
    const changed = { ...waDraft, idempotencyKey: 'second-dispatch-0002' }; f.store.setApproval(changed);
    await expect(f.api.reserve(waScope, f.id, changed, f.approvalId)).rejects.toThrow(); expect(f.store.hash()).toBe(before);
  });
  it('correlates early statuses and prevents status regression or false verification', async () => {
    const f = fixture(); await f.received(); const r = await f.reserve(); await f.api.claim(waScope, f.id, r.dispatchId!, 1);
    await f.api.ingest(waScope, f.id, waStatus('read'));
    const receipt = { dispatchId: r.dispatchId!, providerMessageId: 'wamid.outbound', recipientAddress: '15550000001' };
    expect(await f.api.receipt(waScope, f.id, receipt)).toMatchObject({ status: 'read', verified: false });
    await f.api.ingest(waScope, f.id, waStatus('sent')); await f.api.ingest(waScope, f.id, waStatus('delivered'));
    expect(await f.service().receipt(waScope, f.id, receipt)).toMatchObject({ status: 'read', verified: false });
    expect(await f.api.ingest(waScope, f.id, waStatus('read'))).toMatchObject({ duplicates: 1 });
  });
  it('rejects receipts before claim, mismatched recipients and duplicate provider associations', async () => {
    const f = fixture(); await f.received(); const r = await f.reserve();
    const receipt = { dispatchId: r.dispatchId!, providerMessageId: 'wamid.outbound', recipientAddress: '15550000001' };
    await expect(f.api.receipt(waScope, f.id, receipt)).rejects.toThrow(); await f.api.claim(waScope, f.id, r.dispatchId!, 1);
    await expect(f.api.receipt(waScope, f.id, { ...receipt, recipientAddress: '15550000002' })).rejects.toThrow();
    await f.api.receipt(waScope, f.id, receipt);
    const d = { ...waDraft, idempotencyKey: 'second-dispatch-0002' }; f.store.setApproval(d); const other = await f.api.reserve(waScope, f.id, d, f.approvalId);
    await f.api.claim(waScope, f.id, other.dispatchId!, 1);
    await expect(f.api.receipt(waScope, f.id, { ...receipt, dispatchId: other.dispatchId! })).rejects.toThrow();
  });
  it('preserves unknown outcomes across service restart without offering another claim', async () => {
    const f = fixture(); await f.received(); const r = await f.reserve(); await f.api.claim(waScope, f.id, r.dispatchId!, 1);
    expect(await f.api.unknown(waScope, f.id, r.dispatchId!)).toMatchObject({ status: 'unverified', verified: false });
    expect(await f.service().reserve(waScope, f.id, waDraft, f.approvalId)).toMatchObject({ dispatchId: r.dispatchId, status: 'unverified' });
    await expect(f.service().claim(waScope, f.id, r.dispatchId!, 1)).rejects.toThrow();
  });
  it('rejects payload authority, wrong assets, future message windows and foreign reply context', async () => {
    const f = fixture(); await expect(f.api.ingest(waScope, f.id, { ...waEvent(), workspaceId: waScope.workspaceId })).rejects.toThrow();
    await expect(f.api.ingest(waScope, f.id, { ...waEvent(), metadata: { phone_number_id: '999999999999' } })).rejects.toThrow();
    await f.api.ingest(waScope, f.id, waEvent('wamid.future', waNow + 1000)); await expect(f.reserve()).rejects.toThrow();
    f.time(waNow + 2000); const d = { ...waDraft, replyToProviderMessageId: 'wamid.foreign' }; f.store.setApproval(d);
    await expect(f.api.reserve(waScope, f.id, d, f.approvalId)).rejects.toThrow();
  });
  it('excludes bodies, numbers and incoming instructions from audit details', async () => {
    const f = fixture(); await f.received(); await f.reserve();
    const audits = JSON.stringify(f.store.audits);
    for (const secret of [waDraft.bodyText, '+15550000001', 'Ignore approvals']) expect(audits).not.toContain(secret);
  });
  it('returns authorized history larger than the inbound request size limit', async () => {
    const f = fixture();
    for (let n = 0; n < 80; n++) { const event = waEvent('wamid.large' + n); event.messages[0]!.text.body = 'x'.repeat(2048); await f.api.ingest(waScope, f.id, event); }
    expect(await f.api.history(waScope, f.id)).toHaveLength(80);
  });
  it('keeps receipt reduction deterministic when database reload order differs from arrival order', async () => {
    const f = fixture(); await f.received(); const r = await f.reserve(); await f.api.claim(waScope, f.id, r.dispatchId!, 1);
    const sent = waStatus('sent'), failed = waStatus('failed'); failed.statuses[0]!.timestamp = String(waNow / 1000 + 1);
    await f.api.ingest(waScope, f.id, sent); await f.api.ingest(waScope, f.id, failed);
    const receipt = { dispatchId: r.dispatchId!, providerMessageId: 'wamid.outbound', recipientAddress: '15550000001' };
    expect(await f.api.receipt(waScope, f.id, receipt)).toMatchObject({ status: 'failed' });
    f.store.state.events.reverse(); // PostgreSQL loads by event key, not arrival order.
    expect(await f.service().receipt(waScope, f.id, receipt)).toMatchObject({ status: 'failed', verified: false });
  });
});

// Step 108.13: shape of a real n8n WhatsApp Trigger item (synthetic values) including Meta's
// business-scoped contacts[].user_id and messages[].from_user_id fields.
describe('Step 108.13 real Meta event shape and tenant-claim guard', () => {
  const realShape = (patch: (e: any) => void = () => {}) => {
    const e: any = { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550009999', phone_number_id: waBinding.phoneNumberId },
      contacts: [{ profile: { name: 'Synthetic' }, wa_id: '15550000001', user_id: 'IN.0000000000000001' }],
      messages: [{ from: '15550000001', from_user_id: 'IN.0000000000000001', id: 'wamid.realshape-1', timestamp: String(Math.floor(waNow / 1000)), text: { body: 'Hi' }, type: 'text' }], field: 'messages' };
    patch(e); return e;
  };
  it('accepts the real trigger shape once and deduplicates it', async () => {
    const f = fixture();
    expect(await f.api.ingest(waScope, f.id, realShape())).toEqual({ acceptedMessages: 1, statusUpdates: 0, duplicates: 0 });
    expect(await f.api.ingest(waScope, f.id, realShape())).toEqual({ acceptedMessages: 0, statusUpdates: 0, duplicates: 1 });
    expect(f.store.state.dispatches).toHaveLength(0);
  });
  it.each([
    ['top-level user_id', (e: any) => { e.user_id = 'x'; }],
    ['metadata workspace_id', (e: any) => { e.metadata.workspace_id = 'x'; }],
    ['message userId', (e: any) => { e.messages[0].userId = 'x'; }],
    ['contact workspaceId', (e: any) => { e.contacts[0].workspaceId = 'x'; }],
    ['non-string contact user_id', (e: any) => { e.contacts[0].user_id = { id: 'x' }; }],
    ['nested contact user_id', (e: any) => { e.contacts[0].profile.user_id = 'x'; }],
    ['wrong phone number id', (e: any) => { e.metadata.phone_number_id = '999999999999'; }]
  ])('still refuses %s', async (_name, patch) => {
    const f = fixture();
    await expect(f.api.ingest(waScope, f.id, realShape(patch))).rejects.toThrow();
    expect(f.store.state.messages).toHaveLength(0);
  });
});

describe('Owner reply preparation (no transport, no send)', () => {
  it('builds the draft from the binding, then prepare -> approve -> reserve stays not_configured', async () => {
    const f = fixture(); await f.received();
    const prepared = await f.api.replyDraft(waScope, f.id, { recipientId: 'ram', bodyText: 'Thanks, noted.', replyToProviderMessageId: 'wamid.inbound' });
    expect(prepared).toMatchObject({ actionName: 'whatsapp.meta.messages.send', riskLevel: 'high', liveSendingEnabled: false,
      draft: { connectionId: waBinding.connectionId, connectionRevision: 1, senderPhoneNumberId: waBinding.phoneNumberId, recipientId: 'ram', bodyText: 'Thanks, noted.', replyToProviderMessageId: 'wamid.inbound' } });
    expect(prepared.draft.idempotencyKey).toMatch(/^reply-[0-9a-f-]{36}$/);
    expect(f.store.state.dispatches).toHaveLength(0); expect(f.store.audits).toHaveLength(1); // only the inbound event audit
    f.store.setApproval(prepared.draft);
    const receipt = await f.api.reserve(waScope, f.id, prepared.draft, f.approvalId);
    expect(receipt).toMatchObject({ status: 'not_configured', verified: false, providerMessageId: null });
    expect(f.store.state.dispatches).toHaveLength(1);
  });
  it.each([
    ['unknown recipient', { recipientId: 'nobody', bodyText: 'x' }],
    ['reply to a message from another conversation', { recipientId: 'ram', bodyText: 'x', replyToProviderMessageId: 'wamid.notinthread' }],
    ['client-supplied Meta IDs', { recipientId: 'ram', bodyText: 'x', senderPhoneNumberId: '999' }],
    ['empty text', { recipientId: 'ram', bodyText: '' }],
    ['oversized text', { recipientId: 'ram', bodyText: 'x'.repeat(4097) }]
  ])('refuses %s', async (_n, input) => {
    const f = fixture(); await f.received();
    await expect(f.api.replyDraft(waScope, f.id, input)).rejects.toThrow();
    expect(f.store.state.dispatches).toHaveLength(0);
  });
  it('refuses relay callers and viewers', async () => {
    const f = fixture();
    await expect(f.api.replyDraft({ ...waScope, role: 'viewer' } as any, f.id, { recipientId: 'ram', bodyText: 'x' })).rejects.toThrow();
    await expect(f.api.replyDraft({ workspaceId: waScope.workspaceId, userId: waScope.userId, role: 'owner', principalId: 'p', connectionId: f.id, revision: 1, operation: 'events' } as any, f.id, { recipientId: 'ram', bodyText: 'x' })).rejects.toThrow();
  });
});
