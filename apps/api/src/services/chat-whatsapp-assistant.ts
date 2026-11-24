import { computeCanonicalParameterHash, type MetaWhatsAppSendInput } from '@thaara/contracts';
import {
  ApprovalRepository,
  AuditEventRepository,
  MembershipRepository,
  PlanRepository,
  PlanStepApprovalBindingRepository,
  PlanStepRepository,
  type AuthenticatedScope,
  type TransactionalDbClient
} from '@thaara/db';
import { ForbiddenError } from '@thaara/observability';
import type { ActionAdapter, ActionExecutionContext, ActionResult } from '@thaara/policy';
import type { ChatAutomationStepSummary } from './chat-automation-orchestrator.js';
import type { DurableWhatsAppService } from './whatsapp-durable.js';

import { formatWhatsAppContactName } from './whatsapp-inbox.js';

export const WHATSAPP_SEND_ACTION = 'whatsapp.meta.messages.send';
const APPROVAL_TTL_SECONDS = 3600;

export interface WhatsAppReplyChatIntent { kind: 'whatsapp_reply'; bodyText: string; recipientQuery?: string }
export interface ChatWhatsAppReplyOutcome {
  handled: true;
  status: 'awaiting_approval' | 'not_configured' | 'ambiguous' | 'denied' | 'answered';
  planId?: string; planStatus?: string; approvalId?: string; steps?: ChatAutomationStepSummary[];
  assistantResponseText: string;
}

const NAMED_PATTERNS = [
  /^\s*(?:please\s+)?(?:send\s+(?:a\s+)?)?(?:reply|respond|answer)\s+to\s+([^\n:–\-]{1,80}?)\s+(?:on|via|in|through)\s+whats\s?app\s*[:\-–]\s*([\s\S]+)$/i,
  /^\s*(?:please\s+)?whats\s?app\s+(?:reply|response)\s+to\s+([^\n:–\-]{1,80}?)\s*[:\-–]\s*([\s\S]+)$/i,
  /^\s*whats\s?app\s*(?:alli|nalli|li)\s+([^\n:–\-]{1,80}?)\s+ge\s+(?:reply|uttara)\s+(?:madu|maadu|kodu|kalisu)\s*[:\-–]\s*([\s\S]+)$/i,
  /^\s*([^\n:–\-]{1,80}?)\s+ge\s+whats\s?app\s*(?:alli|nalli|li)\s+(?:reply|uttara)\s+(?:madu|maadu|kodu|kalisu)\s*[:\-–]\s*([\s\S]+)$/i,
  /^\s*(?:ವಾಟ್ಸ್?ಆ್ಯಪ್|ವಾಟ್ಸಾಪ್)(?:‌?ನಲ್ಲಿ|ಲ್ಲಿ)\s+([^\n:–\-]{1,80}?)(?:‌?ಗೆ|ಗೆ|‌?ನಿಗೆ|ನಿಗೆ)\s+(?:ಉತ್ತರಿಸು|ಉತ್ತರ\s+ಕೊಡು|ರಿಪ್ಲೈ\s+ಮಾಡು)\s*[:\-–]\s*([\s\S]+)$/u,
  /^\s*([^\n:–\-]{1,80}?)(?:‌?ಗೆ|ಗೆ|‌?ನಿಗೆ|ನಿಗೆ)\s+(?:ವಾಟ್ಸ್?ಆ್ಯಪ್|ವಾಟ್ಸಾಪ್)(?:‌?ನಲ್ಲಿ|ಲ್ಲಿ)\s+(?:ಉತ್ತರಿಸು|ಉತ್ತರ\s+ಕೊಡು|ರಿಪ್ಲೈ\s+ಮಾಡು)\s*[:\-–]\s*([\s\S]+)$/u
];

// English, Kanglish and Kannada forms. The reply text must follow an explicit separator so ordinary
// conversation about WhatsApp never becomes a reply draft.
const PATTERNS = [
  /^\s*(?:please\s+)?(?:reply|respond|answer)\s+(?:on|via|in|through)\s+whats\s?app\s*[:\-–]\s*([\s\S]+)$/i,
  /^\s*whats\s?app\s+(?:reply|response)\s*[:\-–]\s*([\s\S]+)$/i,
  /^\s*whats\s?app\s*(?:alli|nalli|li)\s+(?:reply|uttara)\s+(?:madu|maadu|kodu|kalisu)\s*[:\-–]\s*([\s\S]+)$/i,
  /^\s*(?:ವಾಟ್ಸ್?ಆ್ಯಪ್|ವಾಟ್ಸಾಪ್)(?:‌?ನಲ್ಲಿ|ಲ್ಲಿ)\s+(?:ಉತ್ತರಿಸು|ಉತ್ತರ\s+ಕೊಡು|ರಿಪ್ಲೈ\s+ಮಾಡು)\s*[:\-–]\s*([\s\S]+)$/u
];

const KN_CONSONANTS: Record<string, string> = {
  ಕ: 'k', ಖ: 'kh', ಗ: 'g', ಘ: 'gh', ಚ: 'ch', ಜ: 'j', ಟ: 't', ಡ: 'd', ಣ: 'n', ತ: 't', ದ: 'd', ಧ: 'dh', ನ: 'n',
  ಪ: 'p', ಫ: 'ph', ಬ: 'b', ಭ: 'bh', ಮ: 'm', ಯ: 'y', ರ: 'r', ಲ: 'l', ವ: 'v', ಶ: 'sh', ಷ: 'sh', ಸ: 's', ಹ: 'h', ಳ: 'l'
};
const KN_VOWELS: Record<string, string> = { ಅ: 'a', ಆ: 'a', ಇ: 'i', ಈ: 'i', ಉ: 'u', ಊ: 'u', ಎ: 'e', ಏ: 'e', ಒ: 'o', ಓ: 'o' };
const KN_SIGNS: Record<string, string> = { 'ಾ': 'a', 'ಿ': 'i', 'ೀ': 'i', 'ು': 'u', 'ೂ': 'u', 'ೆ': 'e', 'ೇ': 'e', 'ೊ': 'o', 'ೋ': 'o', 'ೌ': 'au' };

function romanizeKannada(input: string): string {
  if (!/[\u0C80-\u0CFF]/.test(input)) return '';
  let out = '';
  for (const ch of input.replace(/[\u200C\u200D]/g, '')) {
    if (KN_CONSONANTS[ch]) out += KN_CONSONANTS[ch] + 'a';
    else if (KN_VOWELS[ch]) out += KN_VOWELS[ch];
    else if (KN_SIGNS[ch]) out = out.replace(/a$/, '') + KN_SIGNS[ch];
    else if (ch === '್') out = out.replace(/a$/, '');
    else if (ch === 'ಂ') out += 'm';
    else if (/\s/.test(ch)) out += ' ';
  }
  return out.trim();
}

function normalizeContactKey(value: string): string {
  return value.normalize('NFKC').replace(/[\u200C\u200D]/g, '').toLocaleLowerCase('en').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function matchConversationsByContact<T extends { recipientId: string; contactName?: string; enquiry?: { customerName?: string } }>(conversations: T[], query: string): T[] {
  const keys = [normalizeContactKey(query), normalizeContactKey(romanizeKannada(query))].filter(Boolean);
  if (!keys.length) return [];
  const exact = conversations.filter(c => {
    const name = normalizeContactKey(c.contactName ?? formatWhatsAppContactName(c.recipientId));
    const id = normalizeContactKey(c.recipientId);
    const enquiryName = c.enquiry?.customerName ? normalizeContactKey(c.enquiry.customerName) : '';
    return keys.some(k => name === k || id === k || enquiryName === k);
  });
  if (exact.length > 0) return exact;
  return conversations.filter(c => {
    const tokens = new Set([
      ...normalizeContactKey(c.contactName ?? formatWhatsAppContactName(c.recipientId)).split(' '),
      ...normalizeContactKey(c.recipientId).split(' '),
      ...(c.enquiry?.customerName ? normalizeContactKey(c.enquiry.customerName).split(' ') : [])
    ].filter(Boolean));
    return keys.some(k => tokens.has(k));
  });
}

export function detectWhatsAppReplyChatRequest(message: string): WhatsAppReplyChatIntent | null {
  if (typeof message !== 'string' || message.length > 4500) return null;
  for (const pattern of NAMED_PATTERNS) {
    const match = pattern.exec(message);
    const recipientQuery = match?.[1]?.trim(), bodyText = match?.[2]?.trim();
    if (recipientQuery && bodyText && bodyText.length <= 4096) return { kind: 'whatsapp_reply', recipientQuery, bodyText };
  }
  for (const pattern of PATTERNS) {
    const match = pattern.exec(message);
    const bodyText = match?.[1]?.trim();
    if (bodyText && bodyText.length <= 4096) return { kind: 'whatsapp_reply', bodyText };
  }
  return null;
}

/**
 * Prepares a reply to a stored WhatsApp conversation (matched by contact name or single active thread)
 * as an approval-bound plan step. Approval runs the reserve-only adapter below: the reply is saved as
 * "Prepared, not sent". Nothing is sent.
 */
export async function executeChatWhatsAppReply(
  scope: AuthenticatedScope,
  intent: WhatsAppReplyChatIntent,
  deps: { db: TransactionalDbClient; durable?: DurableWhatsAppService; conversationId?: string }
): Promise<ChatWhatsAppReplyOutcome> {
  const notReady = (text: string, status: ChatWhatsAppReplyOutcome['status'] = 'not_configured'): ChatWhatsAppReplyOutcome => ({ handled: true, status, assistantResponseText: text });
  if (!deps.durable) return notReady('WhatsApp is not connected to Thaara in this environment, so I cannot prepare a reply. Nothing was sent.');
  let connections;
  try { connections = (await deps.durable.connections(scope)).connections.filter(c => !c.disconnected); }
  catch (error) {
    if (error instanceof ForbiddenError) return notReady('Your account is not allowed to prepare WhatsApp replies. Nothing was sent.', 'denied');
    return notReady('WhatsApp storage is not available right now, so I cannot prepare a reply. Nothing was sent.');
  }
  if (!connections.length) return notReady('There is no connected WhatsApp inbox to reply from. Nothing was sent.');
  if (connections.length > 1) return notReady('You have more than one WhatsApp inbox, so please prepare this reply from the WhatsApp inbox screen. Nothing was sent.', 'ambiguous');
  const connectionId = connections[0]!.connectionId;
  let draft: MetaWhatsAppSendInput;
  let targetLabel = '';
  let live = false;
  try {
    const inbox = await deps.durable.inbox(scope, connectionId, { pageSize: intent.recipientQuery ? 50 : 1 });
    let selected = inbox.conversations[0];
    live = inbox.liveSendingEnabled === true;
    if (intent.recipientQuery) {
      const matches = matchConversationsByContact(inbox.conversations, intent.recipientQuery);
      if (matches.length === 0) return notReady(`I could not find a WhatsApp conversation matching "${intent.recipientQuery}". Please check the WhatsApp inbox screen. Nothing was sent.`, 'ambiguous');
      if (matches.length > 1) return notReady(`More than one WhatsApp conversation matches "${intent.recipientQuery}". Please use the WhatsApp inbox screen to choose who to reply to. Nothing was sent.`, 'ambiguous');
      selected = matches[0]!;
      targetLabel = ` to ${selected.contactName ?? formatWhatsAppContactName(selected.recipientId)}`;
    } else if (inbox.conversations.length !== 1) {
      return notReady('I can only reply from chat when there is exactly one WhatsApp conversation, or when you name the contact (for example: "reply to Ram on WhatsApp: …"). Please use the WhatsApp inbox screen to choose who to reply to. Nothing was sent.', 'ambiguous');
    }
    const recipientId = selected!.recipientId;
    const lastInbound = inbox.messages.find(m => m.direction === 'inbound' && m.recipientId === recipientId && m.providerMessageId);
    draft = (await deps.durable.replyDraft(scope, connectionId, { recipientId, bodyText: intent.bodyText, ...(lastInbound?.providerMessageId ? { replyToProviderMessageId: lastInbound.providerMessageId } : {}) })).draft;
  } catch (error) {
    if (error instanceof ForbiddenError) return notReady('This WhatsApp reply is not allowed for your account or contact. Nothing was sent.', 'denied');
    return notReady('I could not prepare the WhatsApp reply. Nothing was sent.');
  }
  const created = await deps.db.withScopedTransaction(scope, async tx => {
    const membership = await new MembershipRepository(tx).findByUserAndWorkspace(scope.workspaceId, scope.userId);
    if (!membership || membership.role === 'viewer') throw new ForbiddenError('Your workspace role is not permitted to prepare WhatsApp replies.');
    const plans = new PlanRepository(tx), steps = new PlanStepRepository(tx);
    const plan = await plans.create(scope.workspaceId, scope.userId, 'Prepare WhatsApp reply', live ? 'Owner-approved WhatsApp reply; approval queues it for the authorized n8n send workflow.' : 'Owner-approved WhatsApp reply; sending is disabled, approval only reserves it.', {
      source: 'chat_automation_orchestrator', workflowKind: 'whatsapp_reply', connectionId, ...(deps.conversationId ? { conversationId: deps.conversationId } : {})
    });
    const params = draft as unknown as Record<string, unknown>;
    const step = await steps.create(scope.workspaceId, plan.id, 0, WHATSAPP_SEND_ACTION, 'write', 'high', 'explicit', params, computeCanonicalParameterHash(params));
    await steps.transitionStatus(scope.workspaceId, step.id, ['ready', 'blocked'], 'awaiting_approval');
    await plans.transitionStatus(scope.workspaceId, plan.id, 'draft', 'awaiting_approval');
    const approval = await new ApprovalRepository(tx).create(scope.workspaceId, WHATSAPP_SEND_ACTION, params, scope.userId, 'high', APPROVAL_TTL_SECONDS);
    await new PlanStepApprovalBindingRepository(tx).create(scope.workspaceId, plan.id, step.id, approval.id, step.parameter_hash);
    await new AuditEventRepository(tx).create(scope.workspaceId, 'whatsapp.chat.reply_prepared', 'plan_step', { planId: plan.id, stepId: step.id, approvalId: approval.id, connectionId }, scope.userId, step.id);
    return { planId: plan.id, stepId: step.id, approvalId: approval.id };
  });
  return {
    handled: true, status: 'awaiting_approval', planId: created.planId, planStatus: 'awaiting_approval', approvalId: created.approvalId,
    steps: [{ stepId: created.stepId, stepOrder: 0, actionName: WHATSAPP_SEND_ACTION, status: 'awaiting_approval', receiptId: null, receiptStatus: null, verificationMethod: null, proof: null, error: null }],
    assistantResponseText: `I prepared this WhatsApp reply${targetLabel}:\n\n"${intent.bodyText}"\n\n${live ? 'Approve it to send this exact message on WhatsApp. Nothing is sent until you approve; the inbox shows sent, delivered and read when WhatsApp confirms.' : 'Approve it to save it as "Prepared, not sent". Sending is disabled, so nothing will be sent to WhatsApp.'}`
  };
}

/** Approval-time adapter: reserves the exact approved draft. It never calls a provider; outcome stays unverified. */
export function createWhatsAppReserveAdapter(durable: DurableWhatsAppService): ActionAdapter {
  return {
    name: WHATSAPP_SEND_ACTION,
    idempotencySupport: 'native',
    async execute(context: ActionExecutionContext): Promise<ActionResult> {
      const scope = context.scope as AuthenticatedScope | undefined, approved = context.approvedRequest as { id?: string } | undefined;
      const draft = context.parameters as unknown as MetaWhatsAppSendInput;
      if (!scope?.sessionTokenHash || typeof approved?.id !== 'string' || typeof draft?.connectionId !== 'string') {
        return { success: false, status: 'failed', verificationMethod: 'policy_gateway_context_check', proof: { sent: false }, error: 'Missing authenticated owner scope or approved request context' };
      }
      try {
        const receipt = await durable.reserve(scope, draft.connectionId, draft, approved.id);
        return { success: true, status: 'unverified', verificationMethod: 'durable_reservation_only', proof: { reserved: true, sent: false, transport: 'not_configured', dispatchId: receipt.dispatchId, receiptStatus: receipt.status } };
      } catch {
        return { success: false, status: 'failed', verificationMethod: 'durable_reservation_only', proof: { reserved: false, sent: false }, error: 'WhatsApp reply reservation was refused' };
      }
    }
  };
}
