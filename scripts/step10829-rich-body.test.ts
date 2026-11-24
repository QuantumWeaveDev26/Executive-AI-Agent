import { describe, expect, it } from 'vitest';
import { buildRichMessageBody, richMessageExpression } from '../deploy/n8n/rich-message-body.mjs';

// Offline: Graph payloads for the outbound workflow's rich-message branch (no network).
const claim = { authorized: true, dispatchEnabled: true, dispatchId: 'd1', phoneNumberId: '1402873856243129', recipientPhoneNumber: '+919900000001' };
describe('rich message Graph body', () => {
  it('builds a template message with header/body variables, and a bare template', () => {
    expect(buildRichMessageBody({ ...claim, messageType: 'template', template: { name: 'meeting_reminder', language: 'en_US', headerParams: ['Ram'], bodyParams: ['11 AM', 'Friday'] } })).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '919900000001', type: 'template',
      template: { name: 'meeting_reminder', language: { code: 'en_US' }, components: [{ type: 'header', parameters: [{ type: 'text', text: 'Ram' }] }, { type: 'body', parameters: [{ type: 'text', text: '11 AM' }, { type: 'text', text: 'Friday' }] }] } });
    expect(buildRichMessageBody({ ...claim, messageType: 'template', template: { name: 'hello_world', language: 'en_US' } }).template).toEqual({ name: 'hello_world', language: { code: 'en_US' } });
  });
  it('builds image/document/audio messages by uploaded media ID with only permitted fields', () => {
    expect(buildRichMessageBody({ ...claim, messageType: 'media', replyToProviderMessageId: 'wamid.x', media: { kind: 'document', mediaId: '987', mimeType: 'application/pdf', sha256: 'a'.repeat(64), filename: 'Q3.pdf', caption: 'Report' } }))
      .toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '919900000001', context: { message_id: 'wamid.x' }, type: 'document', document: { id: '987', caption: 'Report', filename: 'Q3.pdf' } });
    expect(buildRichMessageBody({ ...claim, messageType: 'media', media: { kind: 'audio', mediaId: '5', caption: 'x', filename: 'y' } })).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '919900000001', type: 'audio', audio: { id: '5' } });
    expect(buildRichMessageBody({ ...claim, messageType: 'media', media: { kind: 'image', mediaId: '6', filename: 'n.png', caption: 'Site' } }).image).toEqual({ id: '6', caption: 'Site' });
  });
  it('refuses unauthorized claims, bad numbers, unknown kinds and URL media', () => {
    for (const bad of [{ ...claim, authorized: false, messageType: 'template' }, { ...claim, dispatchEnabled: false, messageType: 'template' }, { ...claim, recipientPhoneNumber: '919900000001', messageType: 'template' },
      { ...claim, messageType: 'media', media: { kind: 'video', mediaId: '1' } }, { ...claim, messageType: 'media', media: { kind: 'image', mediaId: 'https://evil.example/x.png' } }, { ...claim, messageType: 'text', textBody: 'hi' }])
      expect(() => buildRichMessageBody(bad)).toThrow();
  });
  it('the n8n expression evaluates to exactly the same payload', () => {
    const expr = richMessageExpression();
    expect(expr.startsWith('={{ ((j => {')).toBe(true);
    const evaluate = (json: object) => new Function('$json', 'return ' + expr.slice(4, -3))(json);
    const input = { ...claim, messageType: 'template', template: { name: 'hello_world', language: 'en_US', bodyParams: ['a'] } };
    expect(evaluate(input)).toEqual(buildRichMessageBody(input));
  });
});
