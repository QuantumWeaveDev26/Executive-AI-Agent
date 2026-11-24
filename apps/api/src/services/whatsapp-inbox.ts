import { createHash } from 'node:crypto';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { N8nWhatsAppInboxQuerySchema, whatsappDraftPreview, type MetaWhatsAppTestConfig, type N8nWhatsAppInbox, type N8nWhatsAppInboxQuery } from '@thaara/contracts';
import type { AuthenticatedScope, WhatsAppDurableState } from '@thaara/db';
import { AppError } from '@thaara/observability';
import { maskPhoneNumber, sanitizeWhatsAppText } from './whatsapp.js';
import { buildAutoReplyIdempotencyKey, extractWhatsAppCustomerEnquiry, toConversationEnquirySummary, type WhatsAppAutoReplyStatus } from './whatsapp-enquiries.js';

const Query = TypeCompiler.Compile(N8nWhatsAppInboxQuerySchema);
const invalid = () => new AppError('Invalid WhatsApp inbox query.', 'WHATSAPP_INBOX_INVALID', 400);
const changed = () => new AppError('The conversation list changed. Refresh it to continue.', 'WHATSAPP_INBOX_CHANGED', 409);

export interface SanitizedDeliveryFailureDetail {
  code: number | null;
  title: string;
  details: string;
}

type SavedDeliveryEvent = NonNullable<N8nWhatsAppInbox['messages'][number]['deliveryEvents']>[number];
function savedDeliveryEvents(
  state: WhatsAppDurableState,
  dispatch: WhatsAppDurableState['dispatches'][number],
  failures?: ReadonlyMap<string, SanitizedDeliveryFailureDetail>
): SavedDeliveryEvent[] {
  if (dispatch.claimedAt === null || !dispatch.receipt.providerMessageId) return [];
  const recipient = state.binding.recipients.find(r => r.id === dispatch.draft.recipientId);
  if (!recipient) return [];
  const order = { sent: 0, failed: 1, delivered: 2, read: 3 };
  const matching: SavedDeliveryEvent[] = [];
  for (const event of state.events) {
    if (event.providerMessageId !== dispatch.receipt.providerMessageId || event.recipientAddress !== recipient.phoneE164.slice(1) || !Object.hasOwn(order, event.status) || !/^\d+$/.test(event.timestamp)) continue;
    const seconds = Number(event.timestamp), date = new Date(seconds * 1000);
    if (!Number.isSafeInteger(seconds) || seconds <= 0 || !Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) continue;
    const failure = event.status === 'failed' ? (event.failure ?? failures?.get(dispatch.receipt.providerMessageId)) : undefined;
    matching.push({
      status: event.status,
      timestamp: date.toISOString(),
      ...(failure?.code && Number.isSafeInteger(failure.code) && failure.code > 0 ? { errorCode: failure.code } : {}),
      ...(failure?.title ? { errorTitle: failure.title.slice(0, 160) } : {}),
      ...(failure?.details ? { errorDetails: failure.details.slice(0, 160) } : {})
    });
  }
  matching.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || order[a.status] - order[b.status]);
  const seen = new Set<string>();
  return matching.filter(event => { if (seen.has(event.status)) return false; seen.add(event.status); return true; });
}

export function formatWhatsAppContactName(recipientId: string, displayName?: string): string {
  const custom = typeof displayName === 'string' ? sanitizeWhatsAppText(displayName).trim().slice(0, 80) : '';
  if (custom && !/\+?\d{7,}/.test(custom) && !/^c_\d+$/i.test(custom)) return custom;
  if (/^c_\d+$/i.test(recipientId)) return '';
  const words = recipientId.replace(/[_-]+/g, ' ').trim();
  return (words ? words.replace(/\b[a-z]/g, c => c.toUpperCase()) : recipientId).slice(0, 80);
}

export interface WhatsAppInboxRecoveryAttention {
  startupRecoveryFailed?: boolean;
  failedMessageIds?: ReadonlySet<string>;
}

/** A projection only. Never mutates stored state, creates messages or treats offline receipts as verified. */
export function projectWhatsAppInbox(
  scope: AuthenticatedScope,
  state: WhatsAppDurableState,
  query: N8nWhatsAppInboxQuery,
  failures?: ReadonlyMap<string, SanitizedDeliveryFailureDetail>,
  now = Date.now(),
  recoveryAttention?: WhatsAppInboxRecoveryAttention,
  dynamicRecipients?: ReadonlyMap<string, MetaWhatsAppTestConfig['recipients'][number]>
): N8nWhatsAppInbox {
  if (!Query.Check(query)) throw invalid();
  const b = state.binding, pageSize = query.pageSize ?? 20;
  const contacts = new Map(b.recipients.map(r => [r.id, maskPhoneNumber(r.phoneE164)]));
  const fullPhones = new Map(b.recipients.map(r => [r.id, r.phoneE164]));
  const optedInMap = new Map(b.recipients.map(r => [r.id, r.optedIn]));
  const names = new Map(b.recipients.map(r => [r.id, formatWhatsAppContactName(r.id, r.displayName)]));
  for (const m of state.messages) {
    if (!contacts.has(m.recipientId) && m.recipientId.startsWith('c_')) {
      const cleanDigits = m.recipientId.slice(2);
      contacts.set(m.recipientId, maskPhoneNumber('+' + cleanDigits));
      fullPhones.set(m.recipientId, '+' + cleanDigits);
      optedInMap.set(m.recipientId, true);
      const dyn = dynamicRecipients?.get(m.recipientId);
      contacts.set(m.recipientId, maskPhoneNumber(dyn?.phoneE164 ?? ('+' + cleanDigits)));
      fullPhones.set(m.recipientId, dyn?.phoneE164 ?? ('+' + cleanDigits));
      optedInMap.set(m.recipientId, true);
      names.set(m.recipientId, formatWhatsAppContactName(m.recipientId, dyn?.displayName));
    }
  }
  const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase('en');
  const search = normalize(query.query ?? '').trim();
  const searchDigits = search.replace(/\D+/g, '');
  const matchesPhoneSearch = (recipientId: string, maskedPhone: string) => {
    if (!searchDigits || searchDigits.length < 4) return false;
    const last4 = searchDigits.slice(-4);
    const full = (fullPhones.get(recipientId) ?? '').replace(/\D+/g, '');
    const maskedDigits = maskedPhone.replace(/\D+/g, '');
    return (full.length >= 4 && (full.includes(searchDigits) || full.slice(-4) === last4)) || (maskedDigits.length >= 4 && maskedDigits.slice(-4) === last4);
  };
  const messages: N8nWhatsAppInbox['messages'] = state.messages.map(m => ({
    id: 'in:' + m.providerMessageId, providerMessageId: m.providerMessageId, recipientId: m.recipientId,
    maskedPhone: contacts.get(m.recipientId) ?? '+** ****0000', direction: 'inbound', textPreview: sanitizeWhatsAppText(m.textPreview),
    timestamp: m.timestamp, status: 'received', mode: 'offline_test', verified: false, untrusted: true,
    ...(m.media ? { attachment: { kind: m.media.kind, mimeType: m.media.mimeType, downloadStatus: 'not_downloaded' as const, ...(m.media.filename ? { filename: m.media.filename } : {}) } } : {})
  }));
  for (const d of state.dispatches) {
    const deliveryEvents = savedDeliveryEvents(state, d, failures);
    messages.push({
    id: 'out:' + d.id, providerMessageId: d.receipt.providerMessageId, recipientId: d.draft.recipientId,
    maskedPhone: contacts.get(d.draft.recipientId) ?? '+** ****0000', direction: 'outbound', textPreview: sanitizeWhatsAppText(whatsappDraftPreview(d.draft)).slice(0, 2048),
    timestamp: new Date(d.createdAt).toISOString(), status: d.receipt.status === 'not_configured' ? (d.claimedAt === null ? 'reserved' : 'unverified') : d.receipt.status,
    mode: 'offline_test', verified: false, untrusted: true, ...(deliveryEvents.length ? { deliveryEvents } : {})
    });
  }
  messages.sort((a, c) => c.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(c.id));
  const filtered = messages.filter(m => (!query.recipientId || m.recipientId === query.recipientId) && (!search || normalize(m.textPreview).includes(search) || normalize(names.get(m.recipientId) ?? m.recipientId).includes(search) || normalize(m.recipientId).includes(search) || matchesPhoneSearch(m.recipientId, m.maskedPhone)));
  const summaries = new Map<string, N8nWhatsAppInbox['conversations'][number]>();
  for (const m of filtered) {
    const old = summaries.get(m.recipientId);
    if (old) old.messageCount++;
    else {
      const contactName = names.get(m.recipientId) ?? formatWhatsAppContactName(m.recipientId);
      const recipientInbound = state.messages
        .filter(x => x.recipientId === m.recipientId)
        .sort((a, c) => a.timestamp.localeCompare(c.timestamp));
      const latestInboundRaw = recipientInbound[recipientInbound.length - 1];
      const latestAutoReplyKey = latestInboundRaw ? buildAutoReplyIdempotencyKey(latestInboundRaw.providerMessageId) : null;
      const latestAutoReplyDispatches = latestInboundRaw
        ? state.dispatches.filter(
            d =>
              d.draft.recipientId === m.recipientId &&
              (d.draft.idempotencyKey === latestAutoReplyKey ||
                ('replyToProviderMessageId' in d.draft && d.draft.replyToProviderMessageId === latestInboundRaw.providerMessageId))
          )
        : [];
      const latestDispatch = latestAutoReplyDispatches[latestAutoReplyDispatches.length - 1];
      const anyActiveOrClaimedAutoReplyDispatch = state.dispatches.some(
        d =>
          d.draft.recipientId === m.recipientId &&
          d.draft.idempotencyKey.startsWith('auto-reply-') &&
          d.receipt.status !== 'failed' &&
          !(d.claimedAt === null && d.receipt.status === 'not_configured' && now >= d.expiresAt)
      );
      let resolvedAutoReplyStatus: WhatsAppAutoReplyStatus | undefined;
      if (latestDispatch) {
        if (latestDispatch.receipt.status === 'failed') {
          resolvedAutoReplyStatus = 'skipped_failure_guard';
        } else if (
          latestDispatch.claimedAt === null &&
          latestDispatch.receipt.status === 'not_configured' &&
          now >= latestDispatch.expiresAt
        ) {
          // WA-01: Expired unclaimed reservation after 60s was never sent; surface as requiring owner attention and never report as 'replied'.
          resolvedAutoReplyStatus = 'expired_reservation';
        } else {
          resolvedAutoReplyStatus = 'replied';
        }
      } else if (latestInboundRaw?.autoReply) {
        if (
          latestInboundRaw.autoReply.status === 'pending' &&
          (recoveryAttention?.startupRecoveryFailed === true ||
            recoveryAttention?.failedMessageIds?.has(latestInboundRaw.providerMessageId) === true)
        ) {
          resolvedAutoReplyStatus = 'recovery_attention_required';
        } else {
          resolvedAutoReplyStatus = latestInboundRaw.autoReply.status;
        }
      } else if (anyActiveOrClaimedAutoReplyDispatch) {
        resolvedAutoReplyStatus = 'replied';
      }
      let recipient = b.recipients.find(r => r.id === m.recipientId);
      if (!recipient && m.recipientId.startsWith('c_')) {
        const cleanDigits = m.recipientId.slice(2);
        recipient = {
          id: m.recipientId,
          phoneE164: `+${cleanDigits}`,
          optedIn: true
        };
      }
      const extracted = extractWhatsAppCustomerEnquiry({
        connectionId: b.connectionId,
        recipientId: m.recipientId,
        contactName,
        maskedPhone: m.maskedPhone,
        optedIn: optedInMap.get(m.recipientId),
        ...((recipient as any)?.appointment ? { appointmentRecord: (recipient as any).appointment } : {}),
        ...(resolvedAutoReplyStatus ? { autoReplyStatus: resolvedAutoReplyStatus } : {}),
        messages: messages.filter(x => x.recipientId === m.recipientId)
      });
      const resolvedContactName = (contactName && contactName.trim().length > 0) ? contactName : (extracted?.customerName && !/\+?\d{7,}/.test(extracted.customerName) && !extracted.customerName.includes('[number]')) ? extracted.customerName : undefined;
      summaries.set(m.recipientId, {
        recipientId: m.recipientId,
        ...(resolvedContactName ? { contactName: resolvedContactName } : {}),
        maskedPhone: m.maskedPhone,
        messageCount: 1,
        lastMessageAt: m.timestamp,
        lastMessagePreview: m.textPreview,
        untrusted: true,
        ...(extracted ? { enquiry: toConversationEnquirySummary(extracted) } : {})
      });
    }
  }
  // This is consistency binding, not authorization. Scope always comes from the authenticated session;
  // a cursor cannot select a tenant/owner/connection. Any altered state or filter invalidates the page.
  const snapshot = createHash('sha256').update(JSON.stringify([scope.workspaceId, scope.userId, b.connectionId, b.revision, query.recipientId ?? '', search, pageSize, filtered])).digest('hex');
  let offset = 0;
  if (query.pageToken) {
    const [hash, value] = query.pageToken.split('.'); offset = Number(value);
    if (hash !== snapshot || !Number.isSafeInteger(offset) || offset < 1 || offset >= filtered.length || offset % pageSize !== 0) throw changed();
  }
  const end = offset + pageSize;
  return {
    transport: 'n8n',
    mode: 'offline_test',
    liveSendingEnabled: false as boolean,
    ...(recoveryAttention?.startupRecoveryFailed === true ? { startupRecoveryFailed: true } : {}),
    verified: false,
    connectionId: b.connectionId,
    revision: b.revision,
    conversations: [...summaries.values()],
    messages: filtered.slice(offset, end),
    nextPageToken: end < filtered.length ? snapshot + '.' + end : null
  };
}
