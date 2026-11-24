import type { AuthenticatedScope } from '@thaara/db';
import { ForbiddenError } from '@thaara/observability';
const DEFAULT_WORKSPACE_TIMEZONE = 'Asia/Kolkata';
import type { DurableWhatsAppService } from './whatsapp-durable.js';
import { matchConversationsByContact, type ChatWhatsAppReplyOutcome } from './chat-whatsapp-assistant.js';
import { extractWhatsAppCustomerEnquiry, type WhatsAppCustomerEnquiry } from './whatsapp-enquiries.js';
import { formatWhatsAppContactName } from './whatsapp-inbox.js';

/** Read-only WhatsApp chat commands. Never sends, prepares or summarizes with a model; shows saved records only. */
export interface WhatsAppReadChatIntent {
  kind: 'whatsapp_read';
  mode: 'latest' | 'recent' | 'conversation' | 'delivery_status' | 'callbacks' | 'enquiries';
  recipientQuery?: string;
  checkReply?: boolean;
}

const WA = '(?:whats\\s?app|ವಾಟ್ಸಾಪ್\\S*)';

const DELIVERY_STATUS = [
  new RegExp(`\\b(?:did|was|has)\\s+(?:my\\s+|the\\s+)?${WA}\\s+message\\s+to\\s+(.{1,80}?)\\s+(?:get\\s+delivered|delivered|be\\s+delivered|been\\s+delivered|go\\s+through|get\\s+read|been\\s+read)\\s*[.?!]*$`, 'iu'),
  new RegExp(`\\b(?:what\\s+is\\s+the\\s+|check\\s+(?:the\\s+)?|show\\s+(?:the\\s+)?)(?:delivery\\s+)?status\\s+of\\s+(?:my\\s+|the\\s+)?${WA}\\s+message\\s+to\\s+(.{1,80}?)\\s*[.?!]*$`, 'iu'),
  new RegExp(`\\bdid\\s+(.{1,80}?)\\s+(?:receive|get|read)\\s+my\\s+${WA}\\s+message\\s*[.?!]*$`, 'iu')
];

const REPLY_STATUS = [
  new RegExp(`\\b(?:check\\s+(?:whether|if)|did|has)\\s+(.{1,80}?)\\s+repl(?:ied|y)\\s+(?:to\\s+(?:my|the)\\s+${WA}\\s+message|to\\s+me|on\\s+${WA})?\\s*[.?!]*$`, 'iu'),
  new RegExp(`\\b(?:check\\s+(?:whether|if)|did|has)\\s+(.{1,80}?)\\s+repl(?:ied|y)\\s*[.?!]*$`, 'iu')
];

const REQUIREMENTS = [
  new RegExp(`\\b(?:summari[sz]e|show|get|what\\s+are)\\s+(?:this\\s+customer['’]s|the\\s+customer['’]s|(.{1,80}?)['’]s)\\s+requirements\\s*[.?!]*$`, 'iu'),
  new RegExp(`\\b(?:summari[sz]e|show|check)\\s+(?:the\\s+)?requirements\\s+(?:for|of)\\s+(.{1,80}?)\\s*[.?!]*$`, 'iu'),
  new RegExp(`\\bsummari[sz]e\\s+(?:this\\s+|the\\s+)?customer['’]s?\\s+requirements\\s*[.?!]*$`, 'iu')
];

const DELIVERY_STATUS_SINGLE = [
  new RegExp(`\\b(?:did|was|has)\\s+(?:my\\s+|the\\s+)?(?:last\\s+|latest\\s+)?${WA}\\s+(?:message|reply)\\s+(?:get\\s+delivered|delivered|be\\s+delivered|been\\s+delivered|go\\s+through|get\\s+read|been\\s+read)\\s*[.?!]*$`, 'iu'),
  new RegExp(`\\b(?:what\\s+is\\s+the\\s+|check\\s+(?:the\\s+)?|show\\s+(?:the\\s+)?)(?:delivery\\s+)?status\\s+of\\s+(?:my\\s+|the\\s+)?(?:last\\s+|latest\\s+)?${WA}\\s+(?:message|reply)\\s*[.?!]*$`, 'iu')
];

const CALLBACKS = [
  new RegExp(`\\b(?:show|list|which|who)\\b[\\s\\S]{0,40}${WA}[\\s\\S]{0,40}\\b(?:callback|call\\s*back|call\\s+requests?|requested\\s+a\\s+call)`, 'iu'),
  new RegExp(`\\b(?:callback|call\\s*back)\\b[\\s\\S]{0,40}${WA}`, 'iu')
];

const ENQUIRIES = [
  new RegExp(`\\b(?:show|list|give|get|check)\\b[\\s\\S]{0,40}${WA}[\\s\\S]{0,40}\\b(?:enquir(?:y|ies)|leads?|customer\\s+enquir(?:y|ies)|customer\\s+reports?|reports?|appointments?)`, 'iu'),
  new RegExp(`\\b(?:enquir(?:y|ies)|customer\\s+reports?|appointment\\s+requests?)\\b[\\s\\S]{0,40}${WA}`, 'iu'),
  new RegExp(`\\b(?:show|list|check|what\\s+are)\\s+(?:me\\s+)?(?:today['’]s\\s+|pending\\s+)?(?:${WA}\\s+)?(?:appointment\\s+requests?|appointments?|discovery\\s+calls?)\\b`, 'iu')
];

const CONVERSATION = [
  new RegExp(`\\b(?:open|show|summari[sz]e|read|check)\\b\\s+(?:me\\s+)?(?:my\\s+|the\\s+)?(?:latest\\s+|recent\\s+)?(?:${WA}\\s+)?(?:conversation|chat|messages?)\\s+(?:with|from)\\s+(.{1,80}?)\\s*[.?!]*$`, 'iu'),
  new RegExp(`^(?:${WA}\\s+)?messages?\\s+from\\s+(.{1,80}?)\\s*[.?!]*$`, 'iu'),
  new RegExp(`\\b(?:open|show|summari[sz]e|read|check)\\s+(?:me\\s+)?(.{1,80}?)['’]s\\s+(?:${WA}\\s+)?(?:conversation|chat|messages?)\\s*[.?!]*$`, 'iu'),
  new RegExp(`^\\s*${WA}\\s*(?:alli|nalli)?\\s+(.{1,80}?)\\s+(?:chat|conversation|messages?)\\s+(?:open\\s+madu|thorisu|torisu)\\s*[.?!]*$`, 'iu'),
  new RegExp(`^\\s*${WA}\\S*\\s+(.{1,80}?)\\s*(?:ಅವರ|ರ)?\\s*(?:ಸಂಭಾಷಣೆ|ಚಾಟ್)\\s*(?:ತೆರೆ|ತೋರಿಸು)\\s*[.?!]*$`, 'u')
];
const RECENT = [new RegExp(`\\bunread\\b.{0,30}${WA}|${WA}.{0,30}\\bunread\\b`, 'iu'), new RegExp(`${WA}.{0,20}(?:odilla|odade)`, 'iu')];
const LATEST = [
  new RegExp(`\\b(?:show|list|check|read|any|what)\\b.{0,30}${WA}\\s+(?:messages?|chats?|inbox)`, 'iu'),
  new RegExp(`\\b(?:latest|recent|new)\\b.{0,20}${WA}\\s+(?:messages?|chats?)`, 'iu'),
  new RegExp(`${WA}\\s+(?:messages?|message\\s+galu|chats?)\\s+(?:thorisu|torisu|nodu|check\\s+madu)`, 'iu'),
  new RegExp(`${WA}.{0,20}(?:ಸಂದೇಶ\\S*)\\s*(?:ತೋರಿಸು|ನೋಡು)`, 'u')
];

export function detectWhatsAppReadChatRequest(message: string): WhatsAppReadChatIntent | null {
  const text = message.normalize('NFKC').trim().replace(/^(?:hey\s+|hi\s+)?thaara[,:]?\s*/i, '');
  if (!text || text.length > 300) return null;
  for (const pattern of REPLY_STATUS) {
    const match = pattern.exec(text);
    const name = match?.[1]?.replace(/^(?:my|the)\s+/i, '').trim();
    if (name) return { kind: 'whatsapp_read', mode: 'delivery_status', recipientQuery: name, checkReply: true };
  }
  for (const pattern of REQUIREMENTS) {
    const match = pattern.exec(text);
    if (match) {
      const name = match[1]?.replace(/^(?:my|the)\s+/i, '').trim();
      return { kind: 'whatsapp_read', mode: 'enquiries', recipientQuery: name || 'this customer' };
    }
  }
  for (const pattern of DELIVERY_STATUS) {
    const match = pattern.exec(text);
    const name = match?.[1]?.replace(/^(?:my|the)\s+/i, '').trim();
    if (name) return { kind: 'whatsapp_read', mode: 'delivery_status', recipientQuery: name };
  }
  if (DELIVERY_STATUS_SINGLE.some(p => p.test(text))) {
    return { kind: 'whatsapp_read', mode: 'delivery_status' };
  }
  if (CALLBACKS.some(p => p.test(text))) return { kind: 'whatsapp_read', mode: 'callbacks' };
  if (ENQUIRIES.some(p => p.test(text))) return { kind: 'whatsapp_read', mode: 'enquiries' };
  for (const pattern of CONVERSATION) {
    const match = pattern.exec(text);
    const name = match?.[1]?.replace(/^(?:my|the)\s+/i, '').trim();
    if (name && !/^(?:latest|recent|new|unread|all)\b/i.test(name)) return { kind: 'whatsapp_read', mode: 'conversation', recipientQuery: name };
  }
  if (RECENT.some(p => p.test(text))) return { kind: 'whatsapp_read', mode: 'recent' };
  if (LATEST.some(p => p.test(text))) return { kind: 'whatsapp_read', mode: 'latest' };
  return null;
}

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: DEFAULT_WORKSPACE_TIMEZONE, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const formatMessageTime = (iso: string) =>
  new Date(iso)
    .toLocaleTimeString('en-IN', {
      timeZone: DEFAULT_WORKSPACE_TIMEZONE,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
    .replace(/\b(am|pm)\b/i, m => m.toUpperCase());
const clip = (text: string) => { const flat = text.replace(/\s+/g, ' ').trim(); return flat.length > 140 ? flat.slice(0, 139) + '…' : flat; };

function formatMessageBody(m: {
  textPreview: string;
  attachment?: { kind: 'image' | 'document' | 'audio'; filename?: string };
}): string {
  const flat = m.textPreview.replace(/\s+/g, ' ').trim();
  const body = flat.length > 200 ? flat.slice(0, 199) + '…' : flat;
  if (!m.attachment) return body || '[Message]';
  const label =
    m.attachment.kind === 'image'
      ? '[Image]'
      : m.attachment.kind === 'audio'
        ? '[Audio]'
        : m.attachment.filename
          ? `[Document: ${m.attachment.filename}]`
          : '[Document]';
  if (!body || /^\[(image|document|audio|media|file)\b/i.test(body)) {
    return label;
  }
  return `${label} ${body}`;
}

function formatGroupedMessages(
  messages: Array<{
    recipientId: string;
    direction: 'inbound' | 'outbound';
    status: string;
    textPreview: string;
    timestamp: string;
    attachment?: { kind: 'image' | 'document' | 'audio'; filename?: string };
  }>,
  conversations: Array<{ recipientId: string; contactName?: string; maskedPhone: string }>,
  options?: { prefixOutbound?: boolean }
): string {
  const sorted = [...messages].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const groups = new Map<string, typeof sorted>();
  for (const msg of sorted) {
    const list = groups.get(msg.recipientId);
    if (list) list.push(msg);
    else groups.set(msg.recipientId, [msg]);
  }
  const contactHeading = (recipientId: string) => {
    const c = conversations.find(x => x.recipientId === recipientId);
    return c?.contactName ?? c?.maskedPhone ?? formatWhatsAppContactName(recipientId);
  };
  const blocks: string[] = [];
  for (const [recipientId, items] of groups.entries()) {
    const lines = items.map(m => {
      const prefix = options?.prefixOutbound && m.direction === 'outbound' ? 'You: ' : '';
      return `${prefix}${formatMessageBody(m)} — ${formatMessageTime(m.timestamp)}`;
    });
    blocks.push(`${contactHeading(recipientId)}\n${lines.join('\n')}`);
  }
  return blocks.join('\n\n');
}

export async function executeChatWhatsAppRead(scope: AuthenticatedScope, intent: WhatsAppReadChatIntent, deps: { durable?: DurableWhatsAppService; now?: number }): Promise<ChatWhatsAppReplyOutcome> {
  const done = (text: string, status: ChatWhatsAppReplyOutcome['status'] = 'answered'): ChatWhatsAppReplyOutcome => ({ handled: true, status, assistantResponseText: text });
  if (!deps.durable) return done('WhatsApp is not connected to Thaara in this environment, so I cannot show messages.', 'not_configured');
  let connections;
  try { connections = (await deps.durable.connections(scope)).connections.filter(c => !c.disconnected); }
  catch (error) { return error instanceof ForbiddenError ? done('Your account is not allowed to read WhatsApp messages.', 'denied') : done('WhatsApp storage is not available right now. Please try again shortly.', 'not_configured'); }
  if (!connections.length) return done('There is no connected WhatsApp inbox yet.', 'not_configured');

  try {
    if (intent.mode === 'callbacks' || intent.mode === 'enquiries') {
      const collected: WhatsAppCustomerEnquiry[] = [];
      for (const conn of connections) {
        const all = await deps.durable.inbox(scope, conn.connectionId, { pageSize: 50 });
        if (!all) continue;
        for (const c of all.conversations) {
          const extracted = extractWhatsAppCustomerEnquiry({
            connectionId: conn.connectionId,
            recipientId: c.recipientId,
            contactName: c.contactName ?? formatWhatsAppContactName(c.recipientId),
            maskedPhone: c.maskedPhone,
            ...(c.enquiry?.contactOptedIn !== undefined ? { optedIn: c.enquiry.contactOptedIn } : {}),
            ...(c.enquiry?.autoReplyStatus ? { autoReplyStatus: c.enquiry.autoReplyStatus } : {}),
            messages: all.messages.filter(m => m.recipientId === c.recipientId)
          });
          if (extracted) collected.push(extracted);
        }
      }
      let list = intent.mode === 'callbacks'
        ? collected.filter(e => e.callbackRequested || e.leadStatus === 'Callback requested')
        : collected;
      if (intent.recipientQuery && list.length > 0) {
        const matches = matchConversationsByContact(
          list.map(e => ({ recipientId: e.recipientId, contactName: e.customerName, maskedPhone: e.maskedPhone })),
          intent.recipientQuery
        );
        if (matches.length > 0) {
          const matchIds = new Set(matches.map(m => m.recipientId));
          list = list.filter(e => matchIds.has(e.recipientId));
        } else if (list.length === 1 && /^(?:this\s+|the\s+)?customer$/i.test(intent.recipientQuery.trim())) {
          // Keep the single customer
        }
      }
      if (list.length === 0) {
        return done(
          intent.mode === 'callbacks'
            ? 'No WhatsApp customers have requested a callback in your saved conversations yet.'
            : (intent.recipientQuery
                ? `No customer enquiries found matching “${clip(intent.recipientQuery)}”.`
                : 'No customer enquiries were found in your saved WhatsApp conversations yet.')
        );
      }
      if (list.length === 1 && intent.recipientQuery) {
        const e = list[0]!;
        const apptStatus = e.leadStatus === 'Booked appointment'
          ? 'CONFIRMED'
          : (e.callbackRequested || e.appointmentInterest ? 'REQUESTED (30-min discovery call — awaiting slot confirmation)' : 'None');
        const card = [
          `Customer Requirements Summary:`,
          `• Customer: ${e.customerName} (${e.maskedPhone})`,
          ...(e.businessType || e.businessName ? [`• Business: ${e.businessName ?? e.businessType}`] : []),
          `• Service: ${e.requestedService ?? 'General Quantum Weave Enquiry'}`,
          `• Requirements: ${e.businessProblem ?? 'Not specified yet'}`,
          `• Lead Status: ${e.leadStatus}`,
          `• Appointment: ${apptStatus}`,
          ...(e.preferredCallbackTime ? [`• Preferred Time: ${e.preferredCallbackTime}`] : []),
          `• Summary: ${e.enquirySummary}`
        ].join('\n');
        return done(card);
      }
      const lines = list.map(e => {
        const details = [
          `Status: ${e.leadStatus}`,
          ...(e.autoReplyStatus === 'expired_reservation'
            ? ['Auto-reply: expired unsent reservation (requires owner attention)']
            : e.autoReplyStatus === 'recovery_attention_required'
              ? ['Auto-reply: recovery failed (requires owner attention)']
              : []),
          ...(e.latestCustomerMessage ? [`Customer messaged: "${e.latestCustomerMessage}"`] : []),
          `Service: ${e.requestedService ?? 'General Quantum Weave Enquiry'}`,
          ...(e.businessProblem ? [`Requirements: ${e.businessProblem}`] : []),
          ...(e.businessName ? [`Business: ${e.businessName}`] : []),
          ...(e.businessCategory ? [`Category: ${e.businessCategory}`] : []),
          ...(e.callbackRequested || e.appointmentInterest
            ? [
                e.leadStatus === 'Booked appointment'
                  ? 'Appointment: CONFIRMED'
                  : 'Appointment: REQUESTED (30-min discovery call — awaiting slot confirmation)'
              ]
            : []),
          ...(e.preferredCallbackTime ? [`Preferred time: ${e.preferredCallbackTime}`] : []),
          `Summary: ${e.enquirySummary}`
        ].join(' · ');
        return `• ${e.customerName} (${e.maskedPhone}) — ${details}`;
      });
      const heading = intent.mode === 'callbacks'
        ? 'WhatsApp customers who requested a callback:'
        : 'Saved WhatsApp customer enquiries:';
      return done(`${heading}\n${lines.join('\n')}\n\nCustomer messages are untrusted external data. Appointments are only marked as "Booked appointment" when a verified calendar receipt exists.`);
    }

    let id = connections[0]!.connectionId;
    if (connections.length > 1) {
      if (intent.recipientQuery) {
        const matchedConns: Array<{ connectionId: string; live: boolean }> = [];
        for (const conn of connections) {
          const inbox = await deps.durable.inbox(scope, conn.connectionId, { pageSize: 50 });
          if (!inbox) continue;
          const matches = matchConversationsByContact(inbox.conversations, intent.recipientQuery);
          if (matches.length > 0) matchedConns.push({ connectionId: conn.connectionId, live: inbox.liveSendingEnabled === true });
        }
        const liveMatches = matchedConns.filter(m => m.live);
        const chosen = liveMatches.length === 1 ? liveMatches : matchedConns;
        if (chosen.length === 1) {
          id = chosen[0]!.connectionId;
        } else {
          return done('You have more than one WhatsApp inbox. Please open the WhatsApp screen and choose one.', 'ambiguous');
        }
      } else {
        const liveConns: string[] = [];
        for (const conn of connections) {
          const inbox = await Promise.resolve(deps.durable.inbox(scope, conn.connectionId, { pageSize: 1 })).catch(() => null);
          if (inbox?.liveSendingEnabled === true) liveConns.push(conn.connectionId);
        }
        if (liveConns.length === 1) {
          id = liveConns[0]!;
        } else {
          return done('You have more than one WhatsApp inbox. Please open the WhatsApp screen and choose one.', 'ambiguous');
        }
      }
    }

    const all = await deps.durable.inbox(scope, id, { pageSize: 50 });

    if (intent.mode === 'delivery_status') {
      const matches = intent.recipientQuery
        ? matchConversationsByContact(all.conversations, intent.recipientQuery)
        : all.conversations.length === 1
          ? [all.conversations[0]!]
          : [];
      if (!matches.length) return done(intent.recipientQuery ? `I could not find a WhatsApp conversation with “${clip(intent.recipientQuery)}”. I only show your saved, authorized contacts.` : 'Please specify which WhatsApp contact to check delivery status for.', 'ambiguous');
      if (matches.length > 1) return done(`More than one contact matches “${clip(intent.recipientQuery ?? '')}”: ${matches.map(m => m.contactName ?? m.maskedPhone).join(', ')}. Which one do you mean?`, 'ambiguous');
      const target = matches[0]!;
      const chat = await deps.durable.inbox(scope, id, { recipientId: target.recipientId, pageSize: 20 });
      const outbound = chat.messages.find(m => m.direction === 'outbound');
      const display = `${target.contactName ?? target.maskedPhone}${target.contactName && target.maskedPhone ? ` (${target.maskedPhone})` : ''}`;
      if (intent.checkReply) {
        const latestInbound = chat.messages.find(m => m.direction === 'inbound');
        const replied = latestInbound && (!outbound || Date.parse(latestInbound.timestamp) > Date.parse(outbound.timestamp));
        if (replied) {
          return done(`Yes — ${display} replied to your WhatsApp message: “${clip(latestInbound.textPreview)}” at ${when(latestInbound.timestamp)}.`);
        }
        if (outbound) {
          const preview = clip(outbound.textPreview);
          return done(`Not yet — ${display} has not replied to your WhatsApp message yet. The latest message to them (“${preview}” at ${when(outbound.timestamp)}) has status: ${outbound.status}.`);
        }
        return done(`No WhatsApp messages found for ${display}.`);
      }
      if (!outbound) {
        return done(`There are no outgoing WhatsApp messages saved for ${display}.`);
      }
      const preview = clip(outbound.textPreview);
      const failedEvent = outbound.deliveryEvents?.find(e => e.status === 'failed');
      const failureDetail = failedEvent?.errorCode || failedEvent?.errorTitle
        ? ` Reason: Meta error ${failedEvent.errorCode ?? 'unknown'}${failedEvent.errorTitle ? ` (${failedEvent.errorTitle})` : ''}${failedEvent.errorDetails ? ` — ${failedEvent.errorDetails}` : ''}.`
        : '';
      if (outbound.status === 'delivered') {
        return done(`Yes — your latest WhatsApp message to ${display} (“${preview}” at ${when(outbound.timestamp)}) has status: delivered (double tick confirmed by WhatsApp webhook).`);
      }
      if (outbound.status === 'read') {
        return done(`Yes — your latest WhatsApp message to ${display} (“${preview}” at ${when(outbound.timestamp)}) was delivered and read by the recipient.`);
      }
      if (outbound.status === 'sent') {
        return done(`Not yet confirmed as delivered — your latest WhatsApp message to ${display} (“${preview}” at ${when(outbound.timestamp)}) was accepted by WhatsApp (status: sent / single tick), but device delivery has not been confirmed yet.`);
      }
      if (outbound.status === 'failed') {
        return done(`No — your latest WhatsApp message to ${display} (“${preview}” at ${when(outbound.timestamp)}) failed delivery (status: failed).${failureDetail}`);
      }
      if (outbound.status === 'reserved' && all.liveSendingEnabled) {
        return done(`Queued — your latest WhatsApp message to ${display} (“${preview}” at ${when(outbound.timestamp)}) is queued for WhatsApp dispatch and awaiting Meta confirmation.`);
      }
      if (outbound.status === 'unverified') {
        return done(`Delivery is not confirmed — your latest WhatsApp message to ${display} (“${preview}” at ${when(outbound.timestamp)}) has status: outcome unknown (claimed by the outbound workflow, awaiting WhatsApp delivery webhook).`);
      }
      return done(`No — your latest WhatsApp message to ${display} (“${preview}” at ${when(outbound.timestamp)}) has status: prepared, not sent.`);
    }

    if (intent.mode === 'conversation') {
      const matches = matchConversationsByContact(all.conversations, intent.recipientQuery ?? '');
      if (!matches.length) return done(`I could not find a WhatsApp conversation with “${clip(intent.recipientQuery ?? '')}”. I only show your saved, authorized contacts.`, 'ambiguous');
      if (matches.length > 1) return done(`More than one contact matches “${clip(intent.recipientQuery ?? '')}”: ${matches.map(m => m.contactName ?? m.maskedPhone).join(', ')}. Which one do you mean?`, 'ambiguous');
      const chat = await deps.durable.inbox(scope, id, { recipientId: matches[0]!.recipientId, pageSize: 10 });
      const inbound = chat.messages.filter(m => m.direction === 'inbound');
      const selected = inbound.length > 0 ? inbound : chat.messages;
      if (selected.length === 0) {
        return done(`No WhatsApp messages found for ${matches[0]!.contactName ?? matches[0]!.maskedPhone}.`);
      }
      return done(formatGroupedMessages(selected, all.conversations, { prefixOutbound: inbound.length === 0 }));
    }
    if (intent.mode === 'recent') {
      const since = (deps.now ?? Date.now()) - 24 * 3600000;
      const recent = all.messages.filter(m => m.direction === 'inbound' && Date.parse(m.timestamp) >= since).slice(0, 15);
      if (recent.length === 0) {
        return done('No incoming WhatsApp messages in the last 24 hours.');
      }
      return done(formatGroupedMessages(recent, all.conversations));
    }
    const inbound = all.messages.filter(m => m.direction === 'inbound').slice(0, 15);
    if (inbound.length === 0) {
      return done(all.messages.length === 0 ? 'No WhatsApp messages found.' : 'No incoming WhatsApp messages found.');
    }
    return done(formatGroupedMessages(inbound, all.conversations));
  } catch (error) {
    return error instanceof ForbiddenError ? done('Your account is not allowed to read this WhatsApp inbox.', 'denied') : done('WhatsApp storage is not available right now. Please try again shortly.', 'not_configured');
  }
}
