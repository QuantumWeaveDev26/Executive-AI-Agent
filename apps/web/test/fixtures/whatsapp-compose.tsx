// Local browser acceptance fixture only. Every API hook is simulated; no fetch/provider/account is used.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoredWhatsAppInboxView } from '../../src/StoredWhatsAppInbox';
import { createStoredWhatsAppModel, initialStoredWhatsAppState } from '../../src/whatsapp-stored-inbox';
import '../../src/styles.css';
const connection = { connectionId: 'synthetic_compose', revision: 1, disconnected: false };
let contacts = [{ recipientId: 'ram', contactName: 'Ram', maskedPhone: '+91 ******0001', optedIn: true, lastInboundAt: new Date().toISOString(), eligibility: 'eligible' as const }];
const template = { name: 'meeting', language: 'en', status: 'APPROVED' as const, category: 'UTILITY' as const, bodyText: 'Can you attend {{1}}?', bodyParams: 1, headerText: 'Hello {{1}}', headerParams: 1 };
const draft = (recipientId: string, content: object) => ({ draft: { connectionId: connection.connectionId, connectionRevision: connection.revision, senderPhoneNumberId: '123456', recipientId, idempotencyKey: crypto.randomUUID(), ...content }, actionName: 'whatsapp.meta.messages.send', riskLevel: 'high', liveSendingEnabled: false });
function Harness() {
  const [state, update] = useState(initialStoredWhatsAppState('owner'));
  const [model] = useState(() => createStoredWhatsAppModel('owner', update, {
    connections: async () => ({ connections: [{ ...connection }], mode: 'offline_test', liveSendingEnabled: false }),
    inbox: async (_c, query) => ({ connectionId: connection.connectionId, revision: connection.revision, transport: 'n8n', mode: 'offline_test', verified: false, liveSendingEnabled: false, nextPageToken: null,
      conversations: contacts.map(c => ({ recipientId: c.recipientId, contactName: c.contactName, maskedPhone: c.maskedPhone, messageCount: 1, lastMessageAt: new Date().toISOString(), lastMessagePreview: 'Synthetic hello', untrusted: true })),
      messages: contacts.filter(c => !query.recipientId || query.recipientId === c.recipientId).map(c => ({ id: 'in:' + c.recipientId, providerMessageId: 'wamid.' + c.recipientId, direction: 'inbound', recipientId: c.recipientId, maskedPhone: c.maskedPhone, timestamp: new Date().toISOString(), textPreview: 'Synthetic hello', status: 'received', verified: false, untrusted: true })) }),
    contacts: async () => contacts,
    prepare: async (_c, input) => draft(input.recipientId, { bodyText: input.bodyText }) as any,
    prepareTemplate: async (_c, { recipientId, ...input }) => draft(recipientId, { template: input }) as any,
    prepareUpload: async (_c, file) => ({ draft: { connectionId: connection.connectionId, connectionRevision: connection.revision, senderPhoneNumberId: '123456', filename: file.name, mimeType: file.type, bytes: file.size, sha256: 'a'.repeat(64), idempotencyKey: crypto.randomUUID() }, actionName: 'whatsapp.meta.media.upload', riskLevel: 'high', liveSendingEnabled: false }),
    approveUpload: async () => undefined,
    upload: async (_c, file) => ({ media: { kind: file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'document', mediaId: '123456', mimeType: file.type, sha256: 'a'.repeat(64), ...(file.type === 'application/pdf' ? { filename: file.name } : {}) } }),
    prepareMedia: async (_c, input) => draft(input.recipientId, { media: input.media }) as any,
    saveContacts: async (_c, input) => { contacts = input.contacts.map(c => ({ recipientId: c.id, contactName: c.displayName ?? 'Contact', maskedPhone: contacts.find(x => x.recipientId === c.id)?.maskedPhone ?? '+91 ******0002', optedIn: c.optedIn, lastInboundAt: new Date().toISOString(), eligibility: 'eligible' })); connection.revision++; return { connectionId: connection.connectionId, revision: connection.revision, contacts: contacts.length }; },
    requestApproval: async () => crypto.randomUUID(),
    approve: async () => ({ transport: 'n8n', mode: 'offline_test', dispatchId: 'synthetic-dispatch', providerMessageId: null, status: 'not_configured', verified: false })
  } as any));
  useEffect(() => { void model.load(); return () => model.dispose(); }, [model]);
  return <main style={{ padding: 16 }}><h1>Synthetic acceptance — no provider connection</h1><StoredWhatsAppInboxView state={state} onRefresh={() => void model.load()} onSelect={id => void model.select(id)} onSearch={q => void model.search(q)} onRecipient={id => void model.recipient(id)} onNext={() => void model.next()}
    onPrepareReply={text => void model.prepareReply(text)} onPrepareTemplate={input => void model.prepareTemplate(input)} onPrepareMedia={(file, caption) => void model.prepareMedia(file, caption)}
    onApproveUpload={() => void model.approveUpload()} onApproveReply={() => void model.approveReply()} onDiscardReply={() => model.discardReply()} onLoadTemplates={async () => [template]} canManageContacts onSaveContacts={input => model.saveContacts(input)} /></main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
