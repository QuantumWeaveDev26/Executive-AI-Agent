import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '@thaara/observability';
import { createWhatsAppReserveAdapter, detectWhatsAppReplyChatRequest, executeChatWhatsAppReply } from '../src/services/chat-whatsapp-assistant.js';

const scope = { workspaceId: '11111111-1111-4111-8111-111111111111', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'owner' as const, sessionTokenHash: 'session-hash' };
const noDb: any = { withScopedTransaction: vi.fn(async () => { throw new Error('must not touch the database'); }) };

describe('WhatsApp reply chat command detection', () => {
  it.each([
    ['reply on WhatsApp: I will call you tomorrow', 'I will call you tomorrow'],
    ['Please respond via whatsapp - Meeting moved to 4 pm', 'Meeting moved to 4 pm'],
    ['WhatsApp reply: ಸರಿ, ನಾಳೆ ಸಿಗೋಣ', 'ಸರಿ, ನಾಳೆ ಸಿಗೋಣ'],
    ['whatsapp alli reply madu: naale meet madona', 'naale meet madona'],
    ['ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಉತ್ತರಿಸು: ಸರಿ', 'ಸರಿ']
  ])('detects %j', (message, body) => expect(detectWhatsAppReplyChatRequest(message)).toEqual({ kind: 'whatsapp_reply', bodyText: body }));
  it.each([
    ['reply to Ram on WhatsApp: I will call you tomorrow', 'Ram', 'I will call you tomorrow'],
    ['Please respond to Ram Kumar via whatsapp - Meeting moved to 4 pm', 'Ram Kumar', 'Meeting moved to 4 pm'],
    ['WhatsApp reply to Sita: ಸರಿ, ನಾಳೆ ಸಿಗೋಣ', 'Sita', 'ಸರಿ, ನಾಳೆ ಸಿಗೋಣ'],
    ['whatsapp alli Ram ge reply madu: naale meet madona', 'Ram', 'naale meet madona'],
    ['ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ರಾಮ್‌ಗೆ ಉತ್ತರಿಸು: ಸರಿ', 'ರಾಮ್', 'ಸರಿ']
  ])('detects named contact %j', (message, recipientQuery, bodyText) => expect(detectWhatsAppReplyChatRequest(message)).toEqual({ kind: 'whatsapp_reply', recipientQuery, bodyText }));
  it.each(['Did Ram reply on WhatsApp?', 'reply on WhatsApp', 'reply on WhatsApp:   ', 'Show my WhatsApp messages', 'send an email reply: hello', 'reply on WhatsApp: ' + 'x'.repeat(4097)])('ignores %j', message => {
    expect(detectWhatsAppReplyChatRequest(message)).toBeNull();
  });
});

describe('WhatsApp reply chat execution refusals and contact matching (no database writes on refusal, nothing sent)', () => {
  const intent = { kind: 'whatsapp_reply' as const, bodyText: 'Noted' };
  const durable = (over: Record<string, unknown>) => ({ connections: vi.fn(async () => ({ connections: [{ connectionId: 'wa_x', revision: 1, disconnected: false }] })), inbox: vi.fn(), replyDraft: vi.fn(), ...over }) as any;
  it('is truthful when WhatsApp is not connected', async () => {
    expect(await executeChatWhatsAppReply(scope, intent, { db: noDb })).toMatchObject({ status: 'not_configured' });
    expect((await executeChatWhatsAppReply(scope, intent, { db: noDb, durable: durable({ connections: vi.fn(async () => ({ connections: [] })) }) })).status).toBe('not_configured');
  });
  it('refuses to guess between inboxes or conversations, and resolves a unique contact by name (including Kannada script)', async () => {
    const two = durable({ connections: vi.fn(async () => ({ connections: [{ connectionId: 'a', revision: 1, disconnected: false }, { connectionId: 'b', revision: 1, disconnected: false }] })) });
    expect((await executeChatWhatsAppReply(scope, intent, { db: noDb, durable: two })).status).toBe('ambiguous');
    const manyChats = durable({ inbox: vi.fn(async () => ({ conversations: [{ recipientId: 'ram_1', contactName: 'Ram Kumar' }, { recipientId: 'ram_2', contactName: 'Ram Rao' }], messages: [] })) });
    expect((await executeChatWhatsAppReply(scope, intent, { db: noDb, durable: manyChats })).status).toBe('ambiguous');
    expect((await executeChatWhatsAppReply(scope, { kind: 'whatsapp_reply', recipientQuery: 'Ram', bodyText: 'Noted' }, { db: noDb, durable: manyChats })).status).toBe('ambiguous');
    expect((await executeChatWhatsAppReply(scope, { kind: 'whatsapp_reply', recipientQuery: 'Priya', bodyText: 'Noted' }, { db: noDb, durable: manyChats })).status).toBe('ambiguous');
    expect(noDb.withScopedTransaction).not.toHaveBeenCalled();

    const replyDraft = vi.fn(async () => ({ draft: { connectionId: 'wa_x', connectionRevision: 1, senderPhoneNumberId: '100020003000', recipientId: 'synthetic_ram', bodyText: 'ಸರಿ', replyToProviderMessageId: 'wamid.ram1', idempotencyKey: 'reply-12345678' } }));
    const namedInbox = durable({
      inbox: vi.fn(async () => ({ conversations: [{ recipientId: 'synthetic_ram', contactName: 'Ram' }, { recipientId: 'sita', contactName: 'Sita' }], messages: [{ direction: 'inbound', recipientId: 'synthetic_ram', providerMessageId: 'wamid.ram1' }] })),
      replyDraft
    });
    const fakeDb: any = { withScopedTransaction: vi.fn(async () => ({ planId: 'plan-1', stepId: 'step-1', approvalId: 'appr-1' })) };
    const matched = await executeChatWhatsAppReply(scope, { kind: 'whatsapp_reply', recipientQuery: 'ರಾಮ್', bodyText: 'ಸರಿ' }, { db: fakeDb, durable: namedInbox });
    expect(matched).toMatchObject({ status: 'awaiting_approval', planId: 'plan-1', approvalId: 'appr-1' });
    expect(matched.assistantResponseText).toContain('reply to Ram');
    expect(replyDraft).toHaveBeenCalledWith(scope, 'wa_x', { recipientId: 'synthetic_ram', bodyText: 'ಸರಿ', replyToProviderMessageId: 'wamid.ram1' });
  });
  it('maps owner-policy refusals to denied', async () => {
    const forbidden = durable({ connections: vi.fn(async () => { throw new ForbiddenError('no'); }) });
    expect((await executeChatWhatsAppReply(scope, intent, { db: noDb, durable: forbidden })).status).toBe('denied');
    const badRecipient = durable({ inbox: vi.fn(async () => ({ conversations: [{ recipientId: 'r1' }], messages: [] })), replyDraft: vi.fn(async () => { throw new ForbiddenError('no'); }) });
    expect((await executeChatWhatsAppReply(scope, intent, { db: noDb, durable: badRecipient })).status).toBe('denied');
  });
});

describe('reserve-only approval adapter', () => {
  const draft = { connectionId: 'wa_x', connectionRevision: 1, senderPhoneNumberId: '100020003000', recipientId: 'r1', bodyText: 'Noted', idempotencyKey: 'reply-1234567890' };
  const ctx = (over: Record<string, unknown> = {}) => ({ workspaceId: scope.workspaceId, planId: 'p', stepId: 's', idempotencyKey: 'k', parameters: draft, scope, approvedRequest: { id: 'appr-1' }, ...over }) as any;
  it('reserves the exact approved draft and reports unverified, not sent', async () => {
    const reserve = vi.fn(async () => ({ transport: 'n8n', mode: 'offline_test', dispatchId: 'd1', providerMessageId: null, status: 'not_configured', verified: false }));
    const result = await createWhatsAppReserveAdapter({ reserve } as any).execute(ctx());
    expect(reserve).toHaveBeenCalledWith(scope, 'wa_x', draft, 'appr-1');
    expect(result).toMatchObject({ success: true, status: 'unverified', proof: { reserved: true, sent: false, transport: 'not_configured', dispatchId: 'd1' } });
  });
  it('fails closed without owner session scope or approval, and on refusal', async () => {
    const reserve = vi.fn(async () => { throw new ForbiddenError('denied'); });
    const adapter = createWhatsAppReserveAdapter({ reserve } as any);
    expect(await adapter.execute(ctx({ scope: { ...scope, sessionTokenHash: undefined } }))).toMatchObject({ success: false, proof: { sent: false } });
    expect(await adapter.execute(ctx({ approvedRequest: undefined }))).toMatchObject({ success: false });
    expect(reserve).not.toHaveBeenCalled();
    expect(await adapter.execute(ctx())).toMatchObject({ success: false, status: 'failed', proof: { reserved: false, sent: false } });
  });
});
