import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPolicyGateway } from '@thaara/policy';
import { isMetaWhatsAppAnySendInput, whatsappDraftPreview } from '@thaara/contracts';
import { DurableWhatsAppService, type WhatsAppSendProfile } from '../src/services/whatsapp-durable.js';
import { WhatsAppTransactionalFixture, waScope, waBinding, waDraft, waApproval, waEvent, waNow } from './helpers/whatsapp-durable-fixture.js';

// Synthetic only. Template/media drafts need migration 10825 in PostgreSQL; this covers the service rules.
const { bodyText: _text, ...base } = waDraft;
const templateDraft = { ...base, idempotencyKey: 'template-draft-0001', template: { name: 'meeting_reminder', language: 'en_US', bodyParams: ['11 AM', 'Friday'] } };
const mediaDraft = { ...base, idempotencyKey: 'media-draft-0001', media: { kind: 'document' as const, mediaId: '123456789', mimeType: 'application/pdf', sha256: 'a'.repeat(64), filename: 'Q3.pdf', caption: 'Report' } };
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(waNow); });
afterEach(() => vi.useRealTimers());

describe('draft shapes (contracts)', () => {
  it('accepts exactly one content kind with bounded, rule-checked fields', () => {
    expect(isMetaWhatsAppAnySendInput(waDraft)).toBe(true);
    expect(isMetaWhatsAppAnySendInput(templateDraft)).toBe(true);
    expect(isMetaWhatsAppAnySendInput(mediaDraft)).toBe(true);
    for (const bad of [
      { ...templateDraft, bodyText: 'both' }, { ...mediaDraft, template: templateDraft.template }, base,
      { ...templateDraft, template: { ...templateDraft.template, name: 'Bad Name' } },
      { ...templateDraft, template: { ...templateDraft.template, bodyParams: Array(21).fill('x') } },
      { ...templateDraft, replyToProviderMessageId: 'wamid.x' },
      { ...mediaDraft, media: { ...mediaDraft.media, kind: 'audio', filename: undefined } },
      { ...mediaDraft, media: { ...mediaDraft.media, kind: 'image', caption: undefined } },
      { ...mediaDraft, media: { ...mediaDraft.media, mediaId: 'https://evil.example' } },
      { ...mediaDraft, media: { ...mediaDraft.media, filename: '../etc/passwd' } },
      { ...mediaDraft, media: { ...mediaDraft.media, url: 'https://evil.example' } }
    ]) expect(isMetaWhatsAppAnySendInput(JSON.parse(JSON.stringify(bad)))).toBe(false);
    expect(isMetaWhatsAppAnySendInput({ ...mediaDraft, media: { kind: 'audio', mediaId: '1', mimeType: 'audio/ogg', sha256: 'b'.repeat(64) } })).toBe(true);
    expect(isMetaWhatsAppAnySendInput({ ...mediaDraft, media: { ...mediaDraft.media, kind: 'audio', filename: undefined, caption: 'no' } })).toBe(false);
  });
  it('previews templates and media without fetching anything', () => {
    expect(whatsappDraftPreview(templateDraft)).toBe('[Template: meeting_reminder (en_US)] 11 AM · Friday');
    expect(whatsappDraftPreview(mediaDraft)).toBe('[Document: Q3.pdf] Report');
  });
});

describe('durable reserve/claim with template and media drafts', () => {
  function setup(profile: WhatsAppSendProfile | null) {
    const store = new WhatsAppTransactionalFixture(), submit = vi.fn(async () => {});
    const service = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow, { profile: () => profile, dispatcher: { submit } });
    return { store, service, submit };
  }
  const live = { connectionId: waBinding.connectionId, recipientId: '*', maxPerDay: null, expiresAt: waNow + 3600000 };
  it('allows an approved template outside the 24-hour window, but not text', async () => {
    const f = setup({ ...live, richMessages: true });
    await f.service.ingest(waScope, waBinding.connectionId, waEvent('wamid.old', waNow - 30 * 3600000));
    await expect(f.service.reserve(waScope, waBinding.connectionId, waDraft, waApproval().id)).rejects.toThrow();
    f.store.setApproval(templateDraft as any);
    const r = await f.service.reserve(waScope, waBinding.connectionId, templateDraft as any, waApproval().id);
    expect(f.submit).toHaveBeenCalledTimes(1);
    const claim = await f.service.claim(waScope, waBinding.connectionId, r.dispatchId!, 1);
    expect(claim).toMatchObject({ dispatchEnabled: true, messageType: 'template', template: templateDraft.template });
    expect(claim).not.toHaveProperty('textBody');
  });
  it('never enables template or media sending until the outbound workflow is marked rich-capable', async () => {
    const f = setup(live); await f.service.ingest(waScope, waBinding.connectionId, waEvent());
    f.store.setApproval(mediaDraft as any);
    const r = await f.service.reserve(waScope, waBinding.connectionId, mediaDraft as any, waApproval().id);
    expect((await f.service.claim(waScope, waBinding.connectionId, r.dispatchId!, 1)).dispatchEnabled).toBe(false);
    const g = setup({ ...live, richMessages: true }); await g.service.ingest(waScope, waBinding.connectionId, waEvent());
    g.store.setApproval(mediaDraft as any);
    const r2 = await g.service.reserve(waScope, waBinding.connectionId, mediaDraft as any, waApproval().id);
    expect(await g.service.claim(waScope, waBinding.connectionId, r2.dispatchId!, 1)).toMatchObject({ dispatchEnabled: true, messageType: 'media', media: mediaDraft.media });
    const inbox = await g.service.inbox(waScope, waBinding.connectionId);
    expect(inbox.messages.find(m => m.direction === 'outbound')?.textPreview).toBe('[Document: Q3.pdf] Report');
  });
  it('media drafts stay inside the 24-hour window', async () => {
    const f = setup({ ...live, richMessages: true });
    await f.service.ingest(waScope, waBinding.connectionId, waEvent('wamid.old', waNow - 30 * 3600000));
    f.store.setApproval(mediaDraft as any);
    await expect(f.service.reserve(waScope, waBinding.connectionId, mediaDraft as any, waApproval().id)).rejects.toThrow();
  });
});

describe('contact management (owner-only, audited, revision-fenced)', () => {
  const contacts = [{ id: 'ram', phoneE164: '+15550000001', optedIn: true, displayName: 'Ram Kumar' }, { id: 'sita', phoneE164: '+919900000002', optedIn: false }];
  it('replaces contacts with revision +1 and an audit entry; pending drafts for the old revision are fenced', async () => {
    const store = new WhatsAppTransactionalFixture(), service = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow);
    await service.ingest(waScope, waBinding.connectionId, waEvent());
    const owner = { ...waScope, role: 'owner' as const };
    expect(await service.updateContacts(owner, waBinding.connectionId, contacts)).toEqual({ connectionId: waBinding.connectionId, revision: 2, contacts: 2 });
    expect(store.state.binding.recipients).toEqual(contacts);
    expect(store.audits.at(-1)).toEqual({ action: 'whatsapp.durable.contacts_updated', details: { revision: 2 } });
    await expect(service.reserve(waScope, waBinding.connectionId, waDraft, waApproval().id)).rejects.toThrow();
    expect((await service.contacts(owner, waBinding.connectionId)).contacts.find(c => c.recipientId === 'sita')).toMatchObject({ contactName: 'Sita', eligibility: 'not_opted_in' });
  });
  it('rejects members, unchanged lists, duplicates, bad numbers, extra fields and oversize lists', async () => {
    const store = new WhatsAppTransactionalFixture(), service = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow);
    const owner = { ...waScope, role: 'owner' as const };
    await expect(service.updateContacts(waScope, waBinding.connectionId, contacts)).rejects.toThrow();
    for (const bad of [[], [contacts[0], contacts[0]], [{ ...contacts[0], phoneE164: '9187951539' }], [{ ...contacts[0], token: 'x' }], [{ ...contacts[0], displayName: 'a\u0007b' }],
      Array.from({ length: 6 }, (_, i) => ({ id: 'c' + i, phoneE164: '+1555000000' + i, optedIn: true })), [{ ...contacts[0], id: 'sita' }, contacts[1]]])
      await expect(service.updateContacts(owner, waBinding.connectionId, bad)).rejects.toMatchObject({ code: 'WHATSAPP_DURABLE_INVALID' });
    await expect(service.updateContacts(owner, waBinding.connectionId, store.state.binding.recipients)).rejects.toMatchObject({ code: 'WHATSAPP_DURABLE_INVALID' });
    expect(store.audits).toHaveLength(0);
  });
});
