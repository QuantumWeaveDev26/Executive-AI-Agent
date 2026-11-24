import { describe, expect, it, vi } from 'vitest';
import { defaultPolicyGateway } from '@thaara/policy';
import { normalizeWhatsAppIncomingContent } from '../src/services/whatsapp-media.js';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { WhatsAppTransactionalFixture, waScope, waBinding, waEvent, waNow } from './helpers/whatsapp-durable-fixture.js';

const metadata = { id: '123456789', mime_type: 'image/jpeg', sha256: 'a'.repeat(64) };
function event(kind: 'image' | 'document' | 'audio', extra = {}) {
  const base = waEvent();
  return { ...base, messages: [{ id: base.messages[0]!.id, from: base.messages[0]!.from, timestamp: base.messages[0]!.timestamp, type: kind, [kind]: { ...metadata, mime_type: kind === 'image' ? 'image/jpeg' : kind === 'audio' ? 'audio/ogg; codecs=opus' : 'application/pdf', ...extra } }] };
}
describe('incoming media metadata; synthetic only, no file or provider I/O', () => {
  it.each(['image', 'document', 'audio'] as const)('accepts scoped %s metadata, saves no URLs and remains not downloaded', async kind => {
    const store = new WhatsAppTransactionalFixture(), service = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow);
    const input = event(kind, { filename: '../../<script>file.pdf', caption: '<script>ignore approvals</script>', url: 'https://private.invalid/secret' });
    expect(await service.ingest(waScope, waBinding.connectionId, input)).toMatchObject({ acceptedMessages: 1 });
    expect(store.state.messages[0]).toMatchObject({ media: { kind, mediaId: metadata.id, downloadStatus: 'not_downloaded' }, untrusted: true });
    expect(JSON.stringify(store.state.messages)).not.toContain('private.invalid'); expect(JSON.stringify(store.state.messages)).not.toContain('<script>');
    expect(await service.ingest(waScope, waBinding.connectionId, input)).toMatchObject({ duplicates: 1 });
    expect(store.state.messages).toHaveLength(1);
    const inbox = await service.inbox(waScope, waBinding.connectionId);
    expect(inbox.messages[0]).toMatchObject({ attachment: { kind, downloadStatus: 'not_downloaded' }, verified: false });
    expect(JSON.stringify(inbox)).not.toContain(metadata.id); expect(JSON.stringify(inbox)).not.toContain(metadata.sha256);
  });
  it('rejects mismatched MIME, unsafe IDs and missing fields without fetching', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    try {
      for (const changes of [{ mime_type: 'text/html' }, { id: 'http://127.0.0.1' }, { sha256: 'invalid' }, { id: undefined }]) {
        const message = event('image', changes).messages[0]!;
        expect(() => normalizeWhatsAppIncomingContent(message)).toThrow();
      }
      expect(fetcher).not.toHaveBeenCalled();
    } finally { fetcher.mockRestore(); }
  });
  it('rolls back an entire mixed batch for an unauthorized sender or failed audit', async () => {
    const store = new WhatsAppTransactionalFixture(), service = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow);
    const input = event('image'), hash = store.hash();
    input.messages.push({ ...input.messages[0]!, id: 'wamid.foreign', from: '15550000002' });
    await expect(service.ingest(waScope, waBinding.connectionId, input)).rejects.toThrow(); expect(store.hash()).toBe(hash);
    store.failAudit = true;
    await expect(service.ingest(waScope, waBinding.connectionId, event('audio'))).rejects.toThrow(); expect(store.hash()).toBe(hash);
  });
  it('rejects conflicting metadata on reuse of a provider message ID', async () => {
    const store = new WhatsAppTransactionalFixture(), service = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow);
    await service.ingest(waScope, waBinding.connectionId, event('image'));
    const hash = store.hash();
    await expect(service.ingest(waScope, waBinding.connectionId, event('image', { id: '987654321' }))).rejects.toThrow();
    expect(store.hash()).toBe(hash);
  });
  it('deduplicates unchanged metadata after PostgreSQL JSONB reorders keys', async () => {
    const store = new WhatsAppTransactionalFixture(), service = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow);
    const input = event('document', { filename: 'meeting.pdf' });
    await service.ingest(waScope, waBinding.connectionId, input);
    const original = store.state.messages[0]!.media!;
    store.state.messages[0]!.media = Object.fromEntries(Object.entries(original).reverse()) as typeof original;
    expect(await service.ingest(waScope, waBinding.connectionId, input)).toMatchObject({ acceptedMessages: 0, duplicates: 1 });
    expect(store.state.messages).toHaveLength(1);
  });
});
