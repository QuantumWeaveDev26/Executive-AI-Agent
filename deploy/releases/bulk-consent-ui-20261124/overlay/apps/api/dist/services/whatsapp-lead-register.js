import { createHash } from 'node:crypto';
import { buildConversationMemoryState, DIRECT_CALENDLY_URL } from './whatsapp-enquiries.js';
export const LEAD_HEADERS = ['First Contact', 'Last Contact', 'Customer Name', 'WhatsApp Number', 'Business Name', 'Business Type', 'Service Interested In', 'Customer Requirement', 'Lead Status', 'Calendly Link Shared', 'Appointment Status', 'Last Customer Message', 'Follow-Up Notes', 'Conversation ID', 'Internal Lead ID', 'Sync Version'];
const compact = (value, max = 500) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '';
export function buildWhatsAppLead(input) {
    if (!/^\+[1-9]\d{6,14}$/.test(input.phoneE164))
        throw Error('Lead sender unavailable');
    const id = createHash('sha256').update(JSON.stringify([input.workspaceId, input.connectionId, input.phoneE164])).digest('hex');
    if (input.previous && input.previous.id !== id)
        throw Error('Lead scope mismatch');
    const messages = input.messages.filter(m => m.recipientId === input.recipientId).map(m => ({ ...m, timestamp: new Date(m.timestamp).toISOString() })).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.providerMessageId.localeCompare(b.providerMessageId));
    if (!messages.length)
        throw Error('Accepted inbound message required');
    const first = messages[0], latest = messages[messages.length - 1], previous = input.previous;
    if (previous?.erased)
        return previous;
    const row = previous ? { ...previous } : { id, firstContact: input.firstContact ? new Date(input.firstContact).toISOString() : first.timestamp, lastContact: latest.timestamp, name: '', phone: input.phoneE164, businessName: '', businessType: '', service: '', requirement: '', status: 'New', calendlyShared: false, appointment: 'Unknown', lastMessage: '', notes: '', conversationId: `${input.connectionId}:${input.recipientId}`, erased: false };
    const text = latest.textPreview.trim();
    // Only explicit sender privacy requests; never an assistant/tool instruction or tenant claim.
    if (messages.some(m => isLeadErasureRequest(m.textPreview))) {
        return { ...row, name: '', phone: '', businessName: '', businessType: '', service: '', requirement: '', lastMessage: '', notes: '', conversationId: '', calendlyShared: false, appointment: 'Unknown', erased: true, lastContact: latest.timestamp };
    }
    const memory = buildConversationMemoryState({ connectionId: input.connectionId, recipientId: input.recipientId, maskedPhone: '[not-displayed]', messages: messages.map(m => ({ ...m, direction: 'inbound' })) });
    // Older pages may fill an unknown field, but never replace a newer known value.
    row.name ||= compact(memory.customerName || memory.priorCustomerName, 100);
    row.businessName ||= compact(memory.businessName || memory.priorBusinessName, 160);
    row.businessType ||= compact(memory.businessType || memory.businessCategory || memory.priorBusinessType, 160);
    row.service ||= compact(memory.interestedService, 200);
    row.requirement ||= compact(memory.customerRequirements);
    if (latest.timestamp >= row.lastContact) {
        row.lastContact = latest.timestamp;
        row.lastMessage = compact(text, 1000);
        row.name = compact(memory.customerName || memory.priorCustomerName, 100) || row.name;
        row.businessName = compact(memory.businessName || memory.priorBusinessName, 160) || row.businessName;
        row.businessType = compact(memory.businessType || memory.businessCategory || memory.priorBusinessType, 160) || row.businessType;
        row.service = compact(memory.interestedService, 200) || row.service;
        row.requirement = compact(memory.customerRequirements) || row.requirement;
        if (/^(?:stop|unsubscribe|opt\s*out)[.!\s]*$|\b(?:not interested|do not contact|don't contact)\b/i.test(text))
            row.status = 'Not Interested';
        else if (/\b(?:arrange|request|schedule|book|want|need)\b.{0,35}\bcall\b|\bspeak\s+(?:with|to)\s+(?:your|the)\s+team\b/i.test(text)) {
            row.status = 'Call Requested';
            if (row.appointment === 'Unknown')
                row.appointment = 'Requested';
        }
        else if (/\b(?:interested in|looking for|want to|need an?|need help)\b/i.test(text) && !/\b(?:not interested|do not need|don't need)\b/i.test(text))
            row.status = 'Interested';
        else if (row.status === 'New' && (messages.length > 1 || row.name || row.businessType || row.service))
            row.status = 'In Conversation';
    }
    row.calendlyShared ||= input.outbound.some(m => m.verifiedSent && m.text.includes(DIRECT_CALENDLY_URL));
    // A link or a customer's booking claim is never verified booking evidence.
    return row;
}
export function isLeadErasureRequest(text) { return /^(?:please\s+)?(?:delete|erase|remove)\s+(?:all\s+)?my\s+(?:data|details|information|record)[.!\s]*$/i.test(text.trim()) || ['ನನ್ನ ಮಾಹಿತಿಯನ್ನು ಅಳಿಸಿ', 'ನನ್ನ ಡೇಟಾ ಅಳಿಸಿ', 'मेरा डेटा हटाएं', 'मेरी जानकारी हटाएं'].includes(text.trim()); }
export function leadCells(row, version) {
    const safe = (value) => { const text = String(value ?? ''); return /^[\s]*[=+@-]/.test(text) ? "'" + text : text; };
    if (row.erased)
        return Array.from({ length: 16 }, (_, i) => i === 14 ? row.id : i === 15 ? String(version) : '');
    return [row.firstContact, row.lastContact, row.name, row.phone, row.businessName, row.businessType, row.service, row.requirement, row.status, row.calendlyShared ? 'Yes' : 'No', row.appointment, row.lastMessage, row.notes, row.conversationId, row.id, String(version)].map((value, index) => index === 3 ? row.phone : safe(value));
}
//# sourceMappingURL=whatsapp-lead-register.js.map