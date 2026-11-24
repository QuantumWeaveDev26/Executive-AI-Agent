import {
  GmailMessage,
  GmailSendNewInput,
  GmailSendReplyInput,
  GmailStatus
} from '@thaara/contracts';
import { AuthenticatedScope, PlanRepository, PlanStepRepository, ReceiptRepository, TransactionalDbClient } from '@thaara/db';
import { AppError, ForbiddenError } from '@thaara/observability';
import {
  ActionAdapter,
  PolicyGateway,
  defaultActionAdapters,
  defaultPolicyGateway
} from '@thaara/policy';
import {
  ChatAutomationStepSummary,
  reconcileGovernedPlanExecution,
  waitForChatPlanBackgroundExecution
} from './chat-automation-orchestrator.js';
import {
  GMAIL_SEND,
  GMAIL_SEND_NEW_ACTION,
  GMAIL_SEND_REPLY_ACTION,
  GmailFoundation,
  GmailSendReadinessReason
} from './gmail.js';
import {
  GovernedGmailSendSnapshot,
  cancelGovernedGmailSend,
  createGovernedGmailSend,
  findLatestGmailSendPlan,
  normalizeGmailRecipient
} from './gmail-send-governance.js';
import type { JobQueueService } from '../routes/jobs.js';

export type GmailChatIntentKind =
  | 'read_latest'
  | 'read_unread'
  | 'search_emails'
  | 'summarize_emails'
  | 'prepare_reply'
  | 'compose_new_email'
  | 'edit_pending_email'
  | 'send_approved_reply'
  | 'cancel_pending_reply';

export interface GmailChatReplyRequest {
  targetType: 'sender' | 'last_email' | 'message_id';
  senderFilter?: string;
  targetMessageId?: string;
  disambiguationIndex?: number;
  forceLatest: boolean;
  replyInstruction: string;
  /** True when the user asked to reply without saying what to write; Thaara drafts a short acknowledgement. */
  generatedBody?: boolean;
}

export interface GmailChatComposeRequest {
  to: string | null;
  subject: string | null;
  body: string | null;
  generated?: 'thank_you';
}

export interface GmailChatEditRequest {
  field: 'body' | 'subject' | 'to';
  value: string;
}

export interface GmailChatIntent {
  kind: GmailChatIntentKind;
  query: string;
  limit: number;
  senderFilter?: string;
  recipientFilter?: string;
  topicFilter?: string;
  /** Set for "Did I receive…?" style questions so the answer can start with Yes/No. */
  asksYesNo?: boolean;
  /** Set when a short generic phrase ("send it", "cancel it") matched; such intents fall back to normal chat when no Gmail draft exists. */
  generic?: boolean;
  replyRequest?: GmailChatReplyRequest;
  compose?: GmailChatComposeRequest;
  edit?: GmailChatEditRequest;
}

export interface GmailChatExecutionOptions {
  db?: TransactionalDbClient;
  gmail?: GmailFoundation;
  policyGateway?: PolicyGateway;
  queueService?: JobQueueService;
  conversationId?: string;
  streamId?: string;
}

export interface GmailChatExecutionOutcome {
  handled: boolean;
  intentKind: GmailChatIntentKind;
  connectorStatus: GmailStatus['status'] | 'policy_denied' | 'provider_error';
  mode: GmailStatus['mode'];
  connectedEmail: string | null;
  query: string | null;
  messageCount: number;
  assistantResponseText: string;
  planId?: string | null;
  planStatus?: string | null;
  approvalId?: string | null;
  steps?: ChatAutomationStepSummary[];
}

const EMAIL_SRC = '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}';
const POLITE = '(?:please\\s+|kindly\\s+|can\\s+you\\s+|could\\s+you\\s+|would\\s+you\\s+)?';
const DRAFT_NOUN = '(?:email|e-mail|mail|message|draft|reply)';

const EXCLUDED_WORKFLOW_OR_OTHER_CHANNEL_PATTERNS: RegExp[] = [
  /\b(?:email\s+(?:automation|workflow)|automated\s+email(?:\s+workflow)?|n8n)\b/i,
  /\b(?:calendar\s+(?:briefing|agenda)|whatsapp\s+(?:briefing|digest|summary)|phone\s+(?:briefing|digest|summary|call))\b/i
];

const SEND_APPROVED_REPLY_PATTERNS: RegExp[] = [
  /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:send|dispatch|deliver|execute)\s+(?:the\s+|my\s+)?(?:approved|pending|prepared|staged)\s+(?:gmail\s+|email\s+)?(?:reply|email|mail|message|draft)\b/i,
  /^(?:please\s+)?approve\s+and\s+send\s+(?:the\s+|my\s+)?(?:gmail\s+|email\s+)?(?:reply|email|mail|message|draft)\b/i,
  /^(?:(?:yes|yeah|yep|ok|okay|sure)[\s,.!]+)?(?:please\s+)?(?:go\s+ahead\s+and\s+)?(?:send|confirm\s+and\s+send|confirm)\s+(?:the\s+|my\s+)(?:gmail\s+)?(?:email|e-mail|mail|reply)(?:\s+now)?\s*[.!]*$/i,
  /^(?:(?:yes|yeah|yep|ok|okay|sure|alright)[\s,.!]+)(?:please\s+)?(?:go\s+ahead\s+and\s+)?send(?:\s+(?:it|this|that|now))+\s*[.!]*$/i
];

// Short follow-ups such as "Send it.", "okay send it", "yes", or "Yes, send the draft." (never sends by themselves; see handler).
const SEND_PENDING_GENERIC_PATTERNS: RegExp[] = [
  new RegExp(
    `^(?:(?:yes|yeah|yep|ok|okay|sure|alright)[\\s,.!]+)?(?:please\\s+)?(?:go\\s+ahead\\s+and\\s+)?(?:send|confirm\\s+and\\s+send|approve\\s+and\\s+send|approve\\s*&\\s*send|confirm|approve)\\s+(?:it|this|that|the\\s+${DRAFT_NOUN}|my\\s+${DRAFT_NOUN})(?:\\s+now)?\\s*[.!]*$`,
    'i'
  ),
  /^(?:yes|yeah|yep|ok|okay|sure|alright)[\s,.!]+(?:please\s+)?(?:go\s+ahead\s+and\s+)?send(?:\s+it)?(?:\s+now)?\s*[.!]*$/i,
  /^(?:yes|yeah|yep|ok|okay|sure|confirm|approve(?:\s*(?:&|and)\s*send)?)\s*[.!]*$/i
];

const CANCEL_PENDING_REPLY_PATTERNS: RegExp[] = [
  /^(?:please\s+|can\s+you\s+)?(?:cancel|discard|abort|reject)\s+(?:the\s+|my\s+)?(?:pending|prepared|staged|email|gmail)?\s*reply\b/i,
  /^(?:please\s+|can\s+you\s+)?(?:cancel|discard|abort|reject)\s+(?:the\s+|my\s+)?(?:pending|prepared|staged|new)\s+(?:email|mail|message|draft)\b/i,
  /^(?:please\s+)?(?:cancel|discard|delete|scrap|drop|stop)\s+(?:the\s+|my\s+)?(?:gmail\s+)?(?:email|e-mail|mail|reply|draft)\s*[.!]*$/i
];

const CANCEL_PENDING_GENERIC_PATTERNS: RegExp[] = [
  new RegExp(
    `^(?:please\\s+)?(?:cancel|discard|delete|scrap|drop|stop)\\s+(?:it|this|that|the\\s+${DRAFT_NOUN}|my\\s+${DRAFT_NOUN})\\s*[.!]*$`,
    'i'
  ),
  new RegExp(
    `^(?:no[,.!\\s]+)?(?:don'?t|do\\s+not)\\s+send\\s+(?:it|this|that|the\\s+${DRAFT_NOUN})\\s*[.!]*$`,
    'i'
  )
];

const REPLY_INTENT_START_PATTERN =
  /^(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+)?reply\b/i;

const SEND_EMAIL_PATTERNS: RegExp[] = [
  /^(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+)?(?:send|write|compose|draft|create|prepare|dispatch|shoot)\b[\s\S]{0,60}\b(?:an?\s+)?(?:emails?|g-?mail|mail)\b/i,
  /\b(?:send|write|compose|draft|create|prepare)\s+(?:an?\s+)?(?:emails?|g-?mail|mail)(?:\s+draft)?\s+(?:to|for)\b/i
];

const INBOUND_QUESTION_EXCLUSION_PATTERNS: RegExp[] = [
  /\b(?:did\s+i\s+(?:receive|get)|have\s+i\s+(?:received|got|gotten)|did\s+anyone\s+send\s+me|did\s+[^\s]+\s+send\s+me)\b/i
];

const GMAIL_MENTION_PATTERN =
  /\b(?:emails?|g-?mail|inbox|unread\s+messages?)\b/i;

const SUMMARIZE_INTENT_PATTERN =
  /\b(?:summarize|summarise|summary\s+of|digest\s+of|brief\s+me\s+on|give\s+me\s+a\s+summary\s+of)\b/i;

const UNREAD_INTENT_PATTERN = /\b(?:unread|un-read|new\s+unread)\b/i;

const READ_OR_SEARCH_VERB_PATTERN =
  /\b(?:check|show|list|read|view|fetch|get|see|open|look\s+at|find|search|look\s+for|any|do\s+i\s+have|did\s+i\s+(?:receive|get)|have\s+i\s+(?:received|got|gotten)|what\s+are\s+my|latest|recent|last|unread)\b/i;

const DEFAULT_REPLY_ACKNOWLEDGEMENT = "Thanks for your email. I'll get back to you soon.";

function clampLimit(value: number | undefined, fallback: number, max = 20): number {
  if (!value || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.trunc(value)));
}

function extractRequestedLimit(text: string): number | undefined {
  const afterKeyword = text.match(
    /\b(?:latest|last|recent|top|first|unread)\s+(\d{1,2})\s+(?:unread\s+|latest\s+|recent\s+)?(?:emails?|messages?|mails?)\b/i
  );
  if (afterKeyword?.[1]) {
    return Number.parseInt(afterKeyword[1], 10);
  }
  const beforeKeyword = text.match(
    /\b(\d{1,2})\s+(?:latest|last|recent|unread|new)\s+(?:emails?|messages?|mails?)\b/i
  );
  if (beforeKeyword?.[1]) {
    return Number.parseInt(beforeKeyword[1], 10);
  }
  if (/\b(?:latest|last|most\s+recent)\s+(?:unread\s+)?(?:email|message|mail)\b/i.test(text)) {
    return 1;
  }
  return undefined;
}

function cleanQueryFragment(raw: string): string {
  return raw
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+(?:in\s+(?:my\s+)?(?:g-?mail|inbox|emails?)|please|for\s+me|right\s+now)\s*[?.!,;]*$/i, '')
    .replace(/^[?.!,;:\s]+|[?.!,;:\s]+$/g, '')
    .trim()
    .slice(0, 200);
}

function extractSenderFilter(text: string): string | undefined {
  const emailFromMatch = text.match(
    /\bfrom\s+(?:mailto:)?<?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>?/i
  );
  if (emailFromMatch?.[1]) {
    return emailFromMatch[1].trim();
  }
  const namedSenderMatch = text.match(
    /\b(?:emails?|messages?|mail)\s+from\s+"?([A-Za-z0-9][A-Za-z0-9 ._-]{0,60}?)"?(?:\s+(?:about|regarding|concerning|on|with\s+subject|in\s+my)\b|[?.!,;]|$)/i
  );
  if (namedSenderMatch?.[1]) {
    const cleaned = cleanQueryFragment(namedSenderMatch[1]);
    if (cleaned && !/^(?:my|the|an?|inbox|gmail)$/i.test(cleaned)) {
      return cleaned;
    }
  }
  return undefined;
}

function extractRecipientFilter(text: string): string | undefined {
  const match = text.match(
    new RegExp(`\\b(?:emails?|messages?|mails?)\\s+(?:that\\s+)?(?:i\\s+)?(?:sent\\s+|have\\s+sent\\s+)?to\\s+<?(${EMAIL_SRC})>?`, 'i')
  );
  return match?.[1]?.trim();
}

function extractTopicFilter(text: string): string | undefined {
  const quotedMatch = text.match(
    /\b(?:about|regarding|concerning|for|subject|matching|query)\s*:?\s*"([^"]{1,160})"/i
  );
  if (quotedMatch?.[1]) {
    const cleaned = cleanQueryFragment(quotedMatch[1]);
    if (cleaned) return cleaned;
  }

  const aboutMatch = text.match(
    /\b(?:emails?|messages?|g-?mail|inbox)\s+(?:from\s+[^\s]+\s+)?(?:about|regarding|concerning|on|with\s+subject|related\s+to)\s+([^\r\n]{2,160})/i
  );
  if (aboutMatch?.[1]) {
    const cleaned = cleanQueryFragment(aboutMatch[1]);
    if (cleaned) return cleaned;
  }

  const searchForMatch = text.match(
    /\b(?:search|find|look\s+for)\s+(?:my\s+)?(?:g-?mail|emails?|inbox|messages?)\s+(?:for|about|regarding|matching)\s+([^\r\n]{2,160})/i
  );
  if (searchForMatch?.[1]) {
    const cleaned = cleanQueryFragment(searchForMatch[1]);
    if (cleaned) return cleaned;
  }

  return undefined;
}

function stripWrappingQuotes(raw: string): string {
  return raw.trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim();
}

/** Capitalizes the first letter and keeps the user's own words and punctuation. */
function formatMessageBody(raw: string): string {
  const cleaned = stripWrappingQuotes(raw).replace(/\r\n/g, '\n').trim().slice(0, 50000);
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatSubject(raw: string): string {
  const cleaned = stripWrappingQuotes(raw).replace(/[\r\n]+/g, ' ').replace(/[.]+$/, '').trim().slice(0, 998);
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : '';
}

function normalizeReplyBodyFromInstruction(rawInstruction: string): string {
  const cleaned = rawInstruction
    .trim()
    .replace(/^["“”']+|["“”']+$/g, '')
    .replace(/^(?:that\s+says|saying(?:\s+that)?|with\s+(?:the\s+)?message|with|and\s+say(?:ing)?|to\s+say)\s+/i, '')
    .trim();

  if (!cleaned) {
    return '';
  }

  // Handle common natural-language shorthand like "thank them" or "thank him/her"
  if (/^thank\s+(?:them|him|her)(?:\s+for\s+([^\r\n.!?]+))?[.!?]*$/i.test(cleaned)) {
    const match = cleaned.match(/^thank\s+(?:them|him|her)(?:\s+for\s+([^\r\n.!?]+))?[.!?]*$/i);
    if (match?.[1]) {
      return `Thank you for ${match[1].trim()}.`;
    }
    return 'Thank you for your email.';
  }

  const capitalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function parseReplyChatRequest(text: string): GmailChatIntent | null {
  if (!REPLY_INTENT_START_PATTERN.test(text)) {
    return null;
  }

  // Exclude WhatsApp / SMS replies if explicitly mentioned
  if (/\b(?:whatsapp|sms|text\s+message)\b/i.test(text) && !/\b(?:email|g-?mail)\b/i.test(text)) {
    return null;
  }

  const indexMatch = text.match(/\b(?:#|number\s+|option\s+|email\s+#?)(\d{1,2})\b/i);
  const disambiguationIndex = indexMatch?.[1] ? Number.parseInt(indexMatch[1], 10) : undefined;

  const messageIdMatch = text.match(/\bmessage(?:\s+id)?\s+([a-zA-Z0-9_-]{4,128})\b/i);
  const targetMessageId = messageIdMatch?.[1]?.trim();

  const senderQuery = (sender: string) => (sender.includes(' ') ? `from:"${sender}"` : `from:${sender}`);

  // Pattern A: "Reply to the last/latest email (from X) saying/and ..."
  const lastEmailMatch = text.match(
    /^(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+)?reply\s+to\s+(?:the\s+|my\s+)?(?:latest|last|most\s+recent|previous|that|this)\s+(?:email|message|mail)(?:\s+from\s+(?:mailto:)?<?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|[A-Za-z0-9][A-Za-z0-9 ._-]{0,50}?)>?)?(?:\s+(?:saying(?:\s+that)?|that\s+says|with(?:\s+(?:the\s+)?message)?|and\s+say(?:ing)?|and|telling\s+(?:them|him|her))\s+|\s*:\s*)([\s\S]+)$/i
  );
  if (lastEmailMatch) {
    const senderRaw = lastEmailMatch[1] ? cleanQueryFragment(lastEmailMatch[1]) : undefined;
    const instruction = normalizeReplyBodyFromInstruction(lastEmailMatch[2] ?? '');
    if (instruction) {
      return {
        kind: 'prepare_reply',
        query: senderRaw ? senderQuery(senderRaw) : 'in:inbox',
        limit: 5,
        ...(senderRaw ? { senderFilter: senderRaw } : {}),
        replyRequest: {
          targetType: senderRaw ? 'sender' : 'last_email',
          ...(senderRaw ? { senderFilter: senderRaw } : {}),
          ...(disambiguationIndex ? { disambiguationIndex } : {}),
          forceLatest: true,
          replyInstruction: instruction
        }
      };
    }
  }

  // Pattern A2: "Reply to the latest email (from X)." with no message → short editable acknowledgement
  const lastEmailNoBody = text.match(
    new RegExp(
      `^(?:please\\s+|can\\s+you\\s+|could\\s+you\\s+|would\\s+you\\s+)?reply\\s+to\\s+(?:the\\s+|my\\s+)?(?:latest|last|most\\s+recent|newest)\\s+(?:email|message|mail)(?:\\s+from\\s+<?(${EMAIL_SRC}|[A-Za-z0-9][A-Za-z0-9 ._-]{0,50}?)>?)?\\s*[.!?]*$`,
      'i'
    )
  );
  if (lastEmailNoBody) {
    const senderRaw = lastEmailNoBody[1] ? cleanQueryFragment(lastEmailNoBody[1]) : undefined;
    return {
      kind: 'prepare_reply',
      query: senderRaw ? senderQuery(senderRaw) : 'in:inbox',
      limit: 5,
      ...(senderRaw ? { senderFilter: senderRaw } : {}),
      replyRequest: {
        targetType: senderRaw ? 'sender' : 'last_email',
        ...(senderRaw ? { senderFilter: senderRaw } : {}),
        forceLatest: true,
        replyInstruction: DEFAULT_REPLY_ACKNOWLEDGEMENT,
        generatedBody: true
      }
    };
  }

  // Pattern B: "Reply to message <id> saying ..."
  if (targetMessageId) {
    const instructionMatch = text.match(
      /\b(?:saying(?:\s+that)?|that\s+says|with(?:\s+message)?|and\s+say(?:ing)?|and\s+thank)\s*([\s\S]+)$/i
    );
    const rawInstr = instructionMatch?.[0]
      ? instructionMatch[0].replace(/^(?:saying(?:\s+that)?|that\s+says|with(?:\s+message)?|and\s+say(?:ing)?|and)\s+/i, '')
      : '';
    const instruction = normalizeReplyBodyFromInstruction(rawInstr);
    if (instruction) {
      return {
        kind: 'prepare_reply',
        query: 'in:inbox',
        limit: 1,
        replyRequest: {
          targetType: 'message_id',
          targetMessageId,
          forceLatest: true,
          replyInstruction: instruction
        }
      };
    }
  }

  // Pattern C: "Reply to <Sender/Email> (email #N) saying / that / and thank..."
  const senderReplyMatch = text.match(
    /^(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+)?reply\s+to\s+(?:the\s+email\s+from\s+|email\s+from\s+)?(?:\[([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\]\(mailto:[^)]+\)|(?:mailto:)?<?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>?|"?([A-Za-z0-9][A-Za-z0-9 ._-]{0,50}?)"?)(?:\s+(?:#\d{1,2}|email\s+#?\d{1,2}|option\s+\d{1,2}))?\s+(?:(?:saying(?:\s+that)?|that\s+says|with(?:\s+message)?|and\s+say(?:ing)?|and)\s+)([\s\S]+)$/i
  );
  if (senderReplyMatch) {
    const rawSender =
      senderReplyMatch[1] ?? senderReplyMatch[2] ?? senderReplyMatch[3] ?? '';
    const senderFilter = cleanQueryFragment(rawSender.replace(/'s\s+email$/i, ''));
    const instruction = normalizeReplyBodyFromInstruction(senderReplyMatch[4] ?? '');
    if (senderFilter && instruction) {
      const forceLatest =
        /\b(?:latest|last|most\s+recent)\b/i.test(text) || Boolean(disambiguationIndex);
      return {
        kind: 'prepare_reply',
        query: senderQuery(senderFilter),
        limit: 5,
        senderFilter,
        replyRequest: {
          targetType: 'sender',
          senderFilter,
          ...(disambiguationIndex ? { disambiguationIndex } : {}),
          forceLatest,
          replyInstruction: instruction
        }
      };
    }
  }

  return null;
}

function parseSubjectAndBody(rest: string): { subject: string | null; body: string | null } {
  let remaining = rest.trim();
  let subject: string | null = null;

  const quotedSubject = remaining.match(
    /\b(?:with\s+(?:the\s+)?subject(?:\s+line)?|subject(?:\s+line)?)\s*:?\s*["“']([^"”']{1,200})["”']/i
  );
  if (quotedSubject && quotedSubject.index !== undefined) {
    subject = quotedSubject[1]!;
    remaining = `${remaining.slice(0, quotedSubject.index)} ${remaining.slice(quotedSubject.index + quotedSubject[0].length)}`.trim();
  } else {
    const plainSubject = remaining.match(
      /\b(?:with\s+(?:the\s+)?subject(?:\s+line)?|subject(?:\s+line)?)\s*:?\s*([^\r\n]{1,200}?)(?=\s*(?:,|\band\s+(?:say|saying|message|body)\b|\bsaying\b|\bthat\s+says\b|\blike\b|\bmessage\s*:|\bbody\s*:|$))/i
    );
    if (plainSubject && plainSubject.index !== undefined) {
      subject = plainSubject[1]!;
      remaining = `${remaining.slice(0, plainSubject.index)} ${remaining.slice(plainSubject.index + plainSubject[0].length)}`.trim();
    } else {
      const about = remaining.match(
        /^\s*(?:about|regarding)\s+([^\r\n]{2,120}?)(?=\s*(?:,|\band\s+say(?:ing)?\b|\bsaying\b|\bthat\s+says\b|\blike\b|$))/i
      );
      if (about && about.index !== undefined) {
        subject = about[1]!;
        remaining = remaining.slice(about.index + about[0].length).trim();
      }
    }
  }

  remaining = remaining.replace(/^[,;\s]+/, '');
  const bodyMatch = remaining.match(
    /^(?:and\s+)?(?:saying(?:\s+that)?|that\s+says|to\s+say|and\s+say|say|like|as|and\s+tell\s+(?:them|him|her)|telling\s+(?:them|him|her)|with\s+(?:the\s+)?(?:message|body|text)|message\s*:|body\s*:|:|-)\s*([\s\S]+)$/i
  );
  let rawBody = bodyMatch?.[1]?.trim() ?? '';
  if (!rawBody && remaining) {
    const cleanedRemaining = remaining.replace(/^[.!?]+|[.!?]+$/g, '').trim();
    const isFillerOnly =
      /^(?:please|now|right\s+now|today|for\s+me|(?:via|on|in|by|using)\s+(?:g-?mail|e-?mail))(?:\s+please|\s+now|\s+right\s+now|\s+for\s+me)*$/i.test(
        cleanedRemaining
      );
    if (cleanedRemaining && !isFillerOnly) {
      rawBody = remaining;
    }
  }
  const body = rawBody ? formatMessageBody(rawBody) : '';
  const formattedSubject = subject ? formatSubject(subject) : '';
  return { subject: formattedSubject || null, body: body || null };
}

/** Parses "send … to name@example.com" style requests into a new-email draft. */
export function parseComposeRequest(text: string): GmailChatComposeRequest | null {
  const thankYou = text.match(
    new RegExp(
      `^${POLITE}(?:send|write|draft|compose)\\s+(?:a\\s+|an\\s+)?(?:short\\s+|quick\\s+|nice\\s+)?thank[\\s-]?you\\s+(?:email|e-mail|mail|g-?mail|note|message)\\s+to\\s+<?(${EMAIL_SRC})>?(?:\\s+for\\s+([^\\r\\n]{2,200}?))?\\s*[.!?]*$`,
      'i'
    )
  );
  if (thankYou) {
    const reason = thankYou[2] ? thankYou[2].trim().replace(/[.!?]+$/, '') : '';
    return {
      to: thankYou[1]!,
      subject: 'Thank you',
      body: reason
        ? `Thank you so much for ${reason}. I really appreciate it.`
        : 'Thank you so much. I really appreciate it.',
      generated: 'thank_you'
    };
  }

  const emailTo = text.match(
    new RegExp(
      `^${POLITE}(?:send|write|compose|draft|shoot)\\s+(?:me\\s+)?(?:an?\\s+|a\\s+new\\s+|new\\s+)?(?:email|e-mail|mail|message|g-?mail|note)\\s+(?:to|for)\\s+<?(${EMAIL_SRC})>?([\\s\\S]*)$`,
      'i'
    )
  );
  if (emailTo) {
    return { to: emailTo[1]!, ...parseSubjectAndBody(emailTo[2] ?? '') };
  }

  const emailVerb = text.match(
    new RegExp(`^${POLITE}(?:e-?mail|g-?mail|mail)\\s+(?:to\\s+)?<?(${EMAIL_SRC})>?([\\s\\S]*)$`, 'i')
  );
  if (emailVerb) {
    return { to: emailVerb[1]!, ...parseSubjectAndBody(emailVerb[2] ?? '') };
  }

  const sendBodyTo = text.match(
    new RegExp(
      `^${POLITE}(?:send|say)\\s+([\\s\\S]{1,2000}?)\\s+to\\s+<?(${EMAIL_SRC})>?(?:\\s+(?:by|via|on|in)\\s+(?:e-?mail|g-?mail))?\\s*[.!]*$`,
      'i'
    )
  );
  if (sendBodyTo && !/^(?:an?\s+)?(?:new\s+)?(?:email|e-mail|mail|message|g-?mail|note)$/i.test(sendBodyTo[1]!.trim())) {
    const rawBody = sendBodyTo[1]!
      .trim()
      .replace(/^(?:an?\s+)?(?:email|e-mail|mail|g-?mail|message|note)\s+(?:saying|that\s+says|like)\s+/i, '');
    const body = formatMessageBody(rawBody);
    return { to: sendBodyTo[2]!, subject: null, body: body || null };
  }

  return null;
}

/** Parses follow-up edits to the draft that is waiting for approval in this conversation. */
export function parseEditRequest(text: string): GmailChatEditRequest | null {
  const toInstead = text.match(
    new RegExp(`^(?:please\\s+)?send\\s+(?:it|the\\s+${DRAFT_NOUN})\\s+to\\s+<?(${EMAIL_SRC})>?\\s+instead\\s*[.!]*$`, 'i')
  );
  if (toInstead) return { field: 'to', value: toInstead[1]! };

  const recipient = text.match(
    new RegExp(
      `^(?:please\\s+)?(?:change|set|update|switch)\\s+(?:the\\s+)?(?:recipient|to(?:\\s+address)?|email\\s+address|address)\\s+(?:to\\s+)?<?(${EMAIL_SRC})>?\\s*[.!]*$`,
      'i'
    )
  );
  if (recipient) return { field: 'to', value: recipient[1]! };

  const removeSubject = text.match(/^(?:please\s+)?(?:remove|delete|drop|clear)\s+(?:the\s+)?subject(?:\s+line)?\s*[.!]*$/i);
  if (removeSubject) return { field: 'subject', value: '' };

  const subject =
    text.match(/^(?:please\s+)?(?:change|set|update|make)\s+(?:the\s+)?subject(?:\s+line)?\s+(?:to|as)\s*:?\s*([\s\S]{1,200})$/i) ??
    text.match(/^(?:please\s+)?(?:add|use)\s+(?:the\s+|a\s+)?subject(?:\s+line)?\s*:?\s*([\s\S]{1,200})$/i);
  if (subject) {
    const value = formatSubject(subject[1]!);
    return value ? { field: 'subject', value } : null;
  }

  const body =
    text.match(
      new RegExp(
        `^(?:please\\s+)?(?:change|edit|update|make|rewrite|set)\\s+(?:it|this|that|(?:the\\s+|my\\s+)?(?:${DRAFT_NOUN.slice(3, -1)}|body|text))\\s+(?:to\\s+say|to\\s+read|so\\s+it\\s+says|saying|say|like|to)\\s*:?\\s*([\\s\\S]{1,5000})$`,
        'i'
      )
    ) ?? text.match(/^(?:please\s+)?(?:make\s+it\s+say|say)\s+([\s\S]{1,5000}?)\s+instead\s*[.!]*$/i);
  if (body) {
    const raw = stripWrappingQuotes(body[1]!);
    const asAddress = normalizeGmailRecipient(raw.replace(/[.!]+$/, ''));
    if (asAddress) return { field: 'to', value: asAddress };
    const value = formatMessageBody(raw);
    return value ? { field: 'body', value } : null;
  }
  return null;
}

/**
 * Normalizes chat text before intent detection: markdown mailto links become plain addresses, a
 * leading "Thaara," salutation is removed, and conversational prefixes like "yes Send an email..."
 * are stripped when followed by a Gmail command. The original text is never executed or trusted as policy.
 */
export function normalizeGmailChatText(raw: string): string {
  return raw
    .replace(/\[([^\]\r\n]{1,320})\]\(mailto:([^)\s]{3,320})\)/gi, (_m, label: string, addr: string) => {
      const address = addr.split('?')[0]!.trim();
      return address.includes('@') ? address : label;
    })
    .replace(/<mailto:([^>\s]+)>/gi, '$1')
    .replace(/\bmailto:(?=[A-Za-z0-9._%+-]+@)/gi, '')
    .replace(/^\s*(?:(?:hey|hi|hello|ok|okay|yes|yeah|yep|sure|alright)[\s,:;!.-]+)?thaara[\s,:;!.-]+/i, '')
    .replace(
      /^\s*(?:yes|yeah|yep|ok|okay|sure|alright)[\s,:;!.-]+(?=(?:please\s+|kindly\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+|thaara[\s,:;!.-]+)*(?:(?:send|write|compose|draft|shoot)\s+(?:me\s+)?(?:an?\s+|a\s+new\s+|new\s+)?(?:email|e-mail|mail|message|g-?mail|note|thank)|(?:send|say)\s+[^\r\n]+\s+to\s+[^\s@]+@|(?:e-?mail|g-?mail)\s+|reply\s+to\s+|(?:change|edit|update|make|set|cancel|discard|delete|abort)\s+))/i,
      ''
    )
    .trim();
}

interface PendingComposeDraftContext {
  to: string | null;
  subject: string | null;
  body: string | null;
  updatedAt: number;
}

const pendingComposeByConversation = new Map<string, PendingComposeDraftContext>();

function composeConversationKey(scope: AuthenticatedScope, conversationId?: string): string | null {
  if (!conversationId) return null;
  return `${scope.workspaceId}:${scope.userId}:${conversationId}`;
}

export function clearPendingComposeContext(scope: AuthenticatedScope, conversationId?: string): void {
  const key = composeConversationKey(scope, conversationId);
  if (key) pendingComposeByConversation.delete(key);
}

/**
 * Deterministically detects whether a chat message is asking Thaara to read, search, summarize,
 * reply to, compose, edit, send or cancel Gmail email. Detection only proposes work; sending
 * always requires an explicit approval decision by the requesting user.
 */
export function detectGmailChatRequest(userMessage: string): GmailChatIntent | null {
  const trimmed = normalizeGmailChatText(userMessage);
  if (!trimmed) {
    return null;
  }

  if (EXCLUDED_WORKFLOW_OR_OTHER_CHANNEL_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return null;
  }

  // Do not match prompts focused on WhatsApp or Phone calls unless Gmail/email is explicitly requested
  if (/\b(?:whatsapp|phone\s+call|outbound\s+call|sms)\b/i.test(trimmed) && !/\b(?:g-?mail|e-?mail)\b/i.test(trimmed)) {
    return null;
  }

  if (SEND_APPROVED_REPLY_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { kind: 'send_approved_reply', query: 'in:inbox', limit: 1 };
  }
  if (SEND_PENDING_GENERIC_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { kind: 'send_approved_reply', query: 'in:inbox', limit: 1, generic: true };
  }

  if (CANCEL_PENDING_REPLY_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { kind: 'cancel_pending_reply', query: 'in:inbox', limit: 1 };
  }
  if (CANCEL_PENDING_GENERIC_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { kind: 'cancel_pending_reply', query: 'in:inbox', limit: 1, generic: true };
  }

  const edit = parseEditRequest(trimmed);
  if (edit) {
    return { kind: 'edit_pending_email', query: 'in:inbox', limit: 1, generic: true, edit };
  }

  const replyIntent = parseReplyChatRequest(trimmed);
  if (replyIntent) {
    return replyIntent;
  }

  const isInboundQuestion = INBOUND_QUESTION_EXCLUSION_PATTERNS.some((pattern) =>
    pattern.test(trimmed)
  );
  if (!isInboundQuestion) {
    const compose = parseComposeRequest(trimmed);
    if (compose) {
      return { kind: 'compose_new_email', query: 'in:inbox', limit: 1, compose };
    }
    if (SEND_EMAIL_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      const toMatch = trimmed.match(new RegExp(`\\b(?:to|for)\\s+<?(${EMAIL_SRC})>?([\\s\\S]*)$`, 'i'));
      const looseTo = toMatch?.[1] ?? null;
      const parsed = toMatch?.[2] ? parseSubjectAndBody(toMatch[2]) : { subject: null, body: null };
      return {
        kind: 'compose_new_email',
        query: 'in:inbox',
        limit: 1,
        compose: { to: looseTo, ...parsed }
      };
    }
  }

  if (!GMAIL_MENTION_PATTERN.test(trimmed)) {
    return null;
  }

  if (!READ_OR_SEARCH_VERB_PATTERN.test(trimmed) && !SUMMARIZE_INTENT_PATTERN.test(trimmed)) {
    return null;
  }

  const requestedLimit = extractRequestedLimit(trimmed);
  const senderFilter = extractSenderFilter(trimmed);
  const recipientFilter = senderFilter ? undefined : extractRecipientFilter(trimmed);
  const topicFilter = extractTopicFilter(trimmed);
  const isUnread = UNREAD_INTENT_PATTERN.test(trimmed);
  const isSummarize = SUMMARIZE_INTENT_PATTERN.test(trimmed);

  const queryParts: string[] = [];
  if (senderFilter) {
    queryParts.push(
      senderFilter.includes(' ') ? `from:"${senderFilter}"` : `from:${senderFilter}`
    );
  }
  if (recipientFilter) {
    queryParts.push(`to:${recipientFilter}`);
  }
  if (isUnread) {
    queryParts.push('is:unread');
  }
  if (topicFilter) {
    queryParts.push(topicFilter);
  }
  const query = queryParts.length > 0 ? queryParts.join(' ') : 'in:inbox';
  const extras = {
    ...(senderFilter ? { senderFilter } : {}),
    ...(recipientFilter ? { recipientFilter } : {}),
    ...(topicFilter ? { topicFilter } : {}),
    ...(isInboundQuestion ? { asksYesNo: true } : {})
  };

  if (isSummarize) {
    return { kind: 'summarize_emails', query, limit: clampLimit(requestedLimit, 5, 10), ...extras };
  }

  if (senderFilter || recipientFilter || topicFilter) {
    return { kind: 'search_emails', query, limit: clampLimit(requestedLimit, 10, 20), ...extras };
  }

  if (isUnread) {
    return {
      kind: 'read_unread',
      query: 'is:unread',
      limit: clampLimit(requestedLimit, 10, 20),
      ...(isInboundQuestion ? { asksYesNo: true } : {})
    };
  }

  return {
    kind: 'read_latest',
    query: 'in:inbox',
    limit: clampLimit(requestedLimit, 5, 20),
    ...(isInboundQuestion ? { asksYesNo: true } : {})
  };
}

/**
 * Resolves a Gmail chat intent using both single-turn detection and multi-turn conversation context
 * (incomplete compose prompts or an active awaiting-approval draft in the same conversation).
 */
export async function resolveGmailChatRequest(
  scope: AuthenticatedScope,
  userMessage: string,
  options: { db?: TransactionalDbClient; conversationId?: string } = {}
): Promise<GmailChatIntent | null> {
  const direct = detectGmailChatRequest(userMessage);
  const convKey = composeConversationKey(scope, options.conversationId);
  const pendingCompose = convKey ? pendingComposeByConversation.get(convKey) : undefined;

  if (direct) {
    if (
      direct.kind === 'compose_new_email' &&
      direct.compose &&
      !direct.compose.to &&
      pendingCompose?.to
    ) {
      return {
        ...direct,
        compose: {
          to: pendingCompose.to,
          subject: direct.compose.subject ?? pendingCompose.subject,
          body: direct.compose.body
        }
      };
    }
    return direct;
  }

  const trimmed = normalizeGmailChatText(userMessage);
  if (!trimmed) return null;
  if (EXCLUDED_WORKFLOW_OR_OTHER_CHANNEL_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return null;
  }
  if (/\b(?:whatsapp|phone\s+call|outbound\s+call|sms)\b/i.test(trimmed) && !/\b(?:g-?mail|e-?mail)\b/i.test(trimmed)) {
    return null;
  }

  // 1. Follow-up to an incomplete compose turn in the same conversation (e.g. recipient was given, now user provides the body).
  if (pendingCompose?.to && !pendingCompose.body) {
    const cleanedBody = trimmed
      .replace(/^(?:it\s+should\s+say|say(?:ing)?|that\s+says|like|message\s*:|body\s*:)\s+/i, '')
      .trim();
    const formatted = formatMessageBody(cleanedBody);
    if (formatted) {
      return {
        kind: 'compose_new_email',
        query: 'in:inbox',
        limit: 1,
        compose: {
          to: pendingCompose.to,
          subject: pendingCompose.subject,
          body: formatted
        }
      };
    }
  }

  // 2. Follow-up where body was given first and user now supplies the recipient address.
  if (pendingCompose && !pendingCompose.to) {
    const addrMatch = trimmed.match(new RegExp(`^<?(${EMAIL_SRC})>?(?:\\s+([\\s\\S]+))?$`, 'i'));
    if (addrMatch?.[1]) {
      const parsedRest = addrMatch[2] ? parseSubjectAndBody(addrMatch[2]) : { subject: null, body: null };
      return {
        kind: 'compose_new_email',
        query: 'in:inbox',
        limit: 1,
        compose: {
          to: addrMatch[1],
          subject: parsedRest.subject ?? pendingCompose.subject,
          body: parsedRest.body ?? pendingCompose.body
        }
      };
    }
  }

  // 3. Follow-up plain message body when a new-email draft in this conversation is currently awaiting approval.
  if (options.db && options.conversationId) {
    const pendingPlan = await findLatestGmailSendPlan(options.db, scope, {
      conversationId: options.conversationId,
      workflowKinds: ['gmail_new_email'],
      onlyAwaitingApproval: true
    });
    if (pendingPlan && pendingPlan.approval && pendingPlan.approval.status === 'pending') {
      const cleanedBody = trimmed
        .replace(/^(?:it\s+should\s+say|say(?:ing)?|that\s+says|like|message\s*:|body\s*:)\s+/i, '')
        .trim();
      const formatted = formatMessageBody(cleanedBody);
      if (formatted) {
        return {
          kind: 'edit_pending_email',
          query: 'in:inbox',
          limit: 1,
          edit: { field: 'body', value: formatted }
        };
      }
    }
  }

  return null;
}

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above|system|developer)\s+instructions?/gi,
  /disregard\s+(?:all\s+)?(?:previous|prior|above|system|developer)\s+instructions?/gi,
  /system\s+override/gi,
  /new\s+system\s+prompt\s*:/gi,
  /reveal\s+(?:your\s+)?(?:oauth|access|refresh|secret)\s+tokens?/gi
];

const SECRET_TOKEN_PATTERNS: RegExp[] = [
  /\bya29\.[A-Za-z0-9._-]+/g,
  /\b1\/\/[A-Za-z0-9._-]+/g,
  /\bBearer\s+[A-Za-z0-9._-]+/gi
];

/**
 * Sanitizes untrusted email fields (subject, sender, snippet, body) so they cannot inject
 * HTML/scripts, leak OAuth token patterns, or execute prompt-injection directives.
 */
export function sanitizeUntrustedEmailField(
  raw: string | undefined | null,
  maxLength = 240
): string {
  if (!raw || typeof raw !== 'string') {
    return '';
  }
  let cleaned = raw
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(?!([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>)\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ');

  for (const tokenPattern of SECRET_TOKEN_PATTERNS) {
    cleaned = cleaned.replace(tokenPattern, '[REDACTED_TOKEN]');
  }

  for (const injectionPattern of PROMPT_INJECTION_PATTERNS) {
    cleaned = cleaned.replace(
      injectionPattern,
      '[untrusted instruction-like text neutralized]'
    );
  }

  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (cleaned.length > maxLength) {
    return `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
  }
  return cleaned;
}

export function extractValidEmailAddress(rawHeader: string | undefined | null): string | null {
  if (!rawHeader || typeof rawHeader !== 'string') {
    return null;
  }
  const angleMatch = rawHeader.match(/<([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>/);
  const candidate = angleMatch?.[1]
    ? angleMatch[1].trim()
    : rawHeader.match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/)?.[1]?.trim() ?? '';
  if (
    !candidate ||
    candidate.length < 3 ||
    candidate.length > 320 ||
    !/^[^\s@\r\n<>]+@[^\s@\r\n<>]+\.[^\s@\r\n<>]+$/.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

export function normalizeReplySubject(originalSubject: string | undefined | null): string {
  const cleaned = sanitizeUntrustedEmailField(originalSubject, 200) || '(No subject)';
  if (/^re\s*:/i.test(cleaned)) {
    return cleaned;
  }
  return `Re: ${cleaned}`;
}

/* ----------------------------- Plain-English helpers ----------------------------- */

const DISPLAY_TIME_ZONE = 'Asia/Kolkata';

function friendlyDate(raw: string | undefined): string {
  const parsed = raw ? Date.parse(raw) : Number.NaN;
  if (Number.isNaN(parsed)) {
    return sanitizeUntrustedEmailField(raw, 64);
  }
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: DISPLAY_TIME_ZONE,
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(parsed));
  } catch {
    return sanitizeUntrustedEmailField(raw, 64);
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function formatEmailListItem(index: number, msg: GmailMessage): string {
  const from = sanitizeUntrustedEmailField(msg.from, 120) || 'Unknown sender';
  const subject = sanitizeUntrustedEmailField(msg.subject, 140) || '(No subject)';
  const date = friendlyDate(msg.date);
  const preview = sanitizeUntrustedEmailField(msg.snippet || msg.bodyText || '', 160);
  return [
    `${index + 1}. ${subject}${msg.isUnread ? ' (unread)' : ''}`,
    `   From ${from}${date ? ` · ${date}` : ''}`,
    ...(preview ? [`   ${preview}`] : [])
  ].join('\n');
}

function draftPreviewLines(draft: { to: string; subject?: string | null; bodyText: string }): string[] {
  return [
    `To: ${draft.to}`,
    `Subject: ${draft.subject ? draft.subject : '(none)'}`,
    'Message:',
    draft.bodyText
  ];
}

const APPROVAL_FOOTER =
  'Press Approve & Send (Confirm & Send) below to send it, or Cancel to stop. No email has been sent yet.';

function readinessMessage(reason: GmailSendReadinessReason): string {
  switch (reason) {
    case 'not_configured':
      return 'Please connect Gmail to send emails. Gmail sending is not set up yet, so no email was sent.';
    case 'disconnected':
      return 'Please connect Gmail to send emails. Open the Gmail page and press Connect Gmail. No email was sent.';
    case 'reconnect_required':
      return 'Please connect Gmail to send emails. Your Gmail connection has expired. Please reconnect Gmail on the Gmail page. No email was sent.';
    case 'send_permission_missing':
      return 'Please connect Gmail to send emails. Thaara can read your Gmail, but it is not allowed to send email yet. Open the Gmail page, press Disconnect, then Connect Gmail and allow sending. No email was sent.';
    default:
      return "Please connect Gmail to send emails. I couldn't confirm which Gmail account is connected. Please reconnect Gmail on the Gmail page. No email was sent.";
  }
}

function sendFailureHint(proof: Record<string, unknown>): string | null {
  switch (proof.code) {
    case 'GMAIL_SEND_SCOPE_REQUIRED':
      return 'Gmail sending is not allowed yet. Please reconnect Gmail and allow sending.';
    case 'GMAIL_ACCOUNT_MISMATCH':
      return 'Your connected Gmail account changed. Please prepare the email again.';
    case 'GMAIL_DISCONNECTED':
    case 'GMAIL_RECONNECT_REQUIRED':
      return 'Please reconnect Gmail and try again.';
    default:
      return null;
  }
}

function outcome(
  intent: GmailChatIntent,
  base: Partial<GmailChatExecutionOutcome> & { assistantResponseText: string }
): GmailChatExecutionOutcome {
  return {
    handled: true,
    intentKind: intent.kind,
    connectorStatus: 'connected',
    mode: 'disabled',
    connectedEmail: null,
    query: null,
    messageCount: 0,
    ...base
  };
}

function notHandled(intent: GmailChatIntent, fallbackText = ''): GmailChatExecutionOutcome {
  return outcome(intent, { handled: false, assistantResponseText: fallbackText });
}

function stepSummaryFrom(
  step: GovernedGmailSendSnapshot['step'],
  receipt: GovernedGmailSendSnapshot['receipt']
): ChatAutomationStepSummary {
  return {
    stepId: step.id,
    stepOrder: step.step_index,
    actionName: step.action_name,
    status: step.status,
    receiptId: receipt?.id ?? null,
    receiptStatus: receipt?.status ?? null,
    verificationMethod: receipt?.verification_method ?? null,
    proof: receipt?.proof ?? null,
    error: (step.error as { error?: string } | null)?.error ?? null
  };
}

function awaitingApprovalSummary(stepId: string, actionName: string): ChatAutomationStepSummary {
  return {
    stepId,
    stepOrder: 0,
    actionName,
    status: 'awaiting_approval',
    receiptId: null,
    receiptStatus: null,
    verificationMethod: null,
    proof: null,
    error: null
  };
}

async function safeStatus(scope: AuthenticatedScope, gmail?: GmailFoundation): Promise<GmailStatus | null> {
  if (!gmail) return null;
  try {
    return await gmail.status(scope);
  } catch {
    return null;
  }
}

/* --------------------------------- Reply preparation --------------------------------- */

async function handlePrepareGmailReply(
  scope: AuthenticatedScope,
  intent: GmailChatIntent,
  status: GmailStatus,
  options: GmailChatExecutionOptions
): Promise<GmailChatExecutionOutcome> {
  const gmail = options.gmail!;
  const db = options.db;
  const replyReq = intent.replyRequest!;
  const connectedEmail = status.connectedEmail
    ? sanitizeUntrustedEmailField(status.connectedEmail, 120)
    : null;
  const base = { mode: status.mode, connectedEmail, query: intent.query };

  if (!status.scopes.includes(GMAIL_SEND)) {
    return outcome(intent, {
      ...base,
      assistantResponseText:
        'Thaara can read your Gmail, but it is not allowed to send email yet. Open the Gmail page, press Disconnect, then Connect Gmail and allow sending. No reply was sent.'
    });
  }

  if (!connectedEmail) {
    return outcome(intent, {
      ...base,
      assistantResponseText:
        "I couldn't confirm which Gmail account is connected, so I didn't prepare a reply. Please reconnect Gmail on the Gmail page."
    });
  }

  let candidateMessages: GmailMessage[] = [];
  if (replyReq.targetType === 'message_id' && replyReq.targetMessageId) {
    candidateMessages = [await gmail.read(scope, replyReq.targetMessageId)];
  } else {
    const searchRes = await gmail.search(scope, { query: intent.query, limit: intent.limit });
    for (const stub of searchRes.messages.slice(0, Math.min(intent.limit, 5))) {
      candidateMessages.push(await gmail.read(scope, stub.id));
    }
  }

  const who = replyReq.senderFilter ? sanitizeUntrustedEmailField(replyReq.senderFilter, 120) : null;

  if (candidateMessages.length === 0) {
    return outcome(intent, {
      ...base,
      assistantResponseText: who
        ? `I couldn't find any email from ${who} to reply to. No reply was prepared.`
        : "I couldn't find an email to reply to. No reply was prepared."
    });
  }

  // Several matches and the user did not say "latest" or pick one: ask which one.
  if (candidateMessages.length > 1 && !replyReq.forceLatest && replyReq.disambiguationIndex === undefined) {
    const lines = candidateMessages.map((m, idx) => {
      const subj = sanitizeUntrustedEmailField(m.subject, 120) || '(No subject)';
      const date = friendlyDate(m.date);
      return `${idx + 1}. ${subj}${date ? ` (${date})` : ''}`;
    });
    const name = who ?? 'them';
    return outcome(intent, {
      ...base,
      messageCount: candidateMessages.length,
      assistantResponseText: [
        `I found ${plural(candidateMessages.length, 'email')} from ${name}. Which one should I reply to?`,
        '',
        ...lines,
        '',
        `Say, for example: "Reply to ${name} #2 saying ${sanitizeUntrustedEmailField(replyReq.replyInstruction, 80)}" or "Reply to the latest email from ${name} saying …".`
      ].join('\n')
    });
  }

  const selectedIndex =
    replyReq.disambiguationIndex !== undefined
      ? Math.max(0, Math.min(candidateMessages.length - 1, replyReq.disambiguationIndex - 1))
      : 0;
  const sourceMessage = candidateMessages[selectedIndex]!;

  // Recipient comes only from the verified Reply-To/From headers, never from email body text.
  const recipientEmail =
    extractValidEmailAddress(sourceMessage.replyTo) ?? extractValidEmailAddress(sourceMessage.from);
  if (!recipientEmail) {
    return outcome(intent, {
      ...base,
      messageCount: 1,
      assistantResponseText: "I found the email, but I couldn't find a valid address to reply to. No reply was prepared."
    });
  }

  const threadId = sourceMessage.threadId || sourceMessage.id;
  const replySubject = normalizeReplySubject(sourceMessage.subject);
  const inReplyTo = sourceMessage.messageIdHeader
    ? sourceMessage.messageIdHeader.replace(/[\r\n]+/g, ' ').trim()
    : undefined;
  const references = sourceMessage.referencesHeader
    ? sourceMessage.messageIdHeader
      ? `${sourceMessage.referencesHeader.replace(/[\r\n]+/g, ' ').trim()} ${sourceMessage.messageIdHeader.replace(/[\r\n]+/g, ' ').trim()}`
      : sourceMessage.referencesHeader.replace(/[\r\n]+/g, ' ').trim()
    : inReplyTo;

  const replyInput: GmailSendReplyInput = {
    sourceMessageId: sourceMessage.id,
    threadId,
    connectedEmail,
    to: recipientEmail,
    subject: replySubject,
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(references ? { references } : {}),
    bodyText: replyReq.replyInstruction
  };

  const preview = draftPreviewLines({ to: recipientEmail, subject: replySubject, bodyText: replyInput.bodyText });
  const intro = replyReq.generatedBody
    ? 'I wrote a short reply. Shall I send it? You can change it by saying "Change it to …".'
    : 'Your reply is ready. Shall I send it?';

  if (!db) {
    return outcome(intent, {
      ...base,
      messageCount: 1,
      assistantResponseText: [intro, '', ...preview, '', 'No email has been sent yet.'].join('\n')
    });
  }

  const created = await createGovernedGmailSend(db, scope, {
    actionName: GMAIL_SEND_REPLY_ACTION,
    params: replyInput as unknown as Record<string, unknown>,
    title: `Gmail Reply to ${recipientEmail}`,
    description: `Approval-gated Gmail reply to message ${sourceMessage.id} (${replySubject})`,
    metadata: {
      conversationId: options.conversationId ?? null,
      streamId: options.streamId ?? null,
      sourceMessageId: sourceMessage.id,
      threadId,
      connectedEmail,
      to: recipientEmail,
      subject: replySubject
    },
    auditAction: 'gmail.messages.reply_prepared',
    auditPayload: { sourceMessageId: sourceMessage.id, threadId, to: recipientEmail, connectedEmail }
  });

  return outcome(intent, {
    ...base,
    messageCount: 1,
    planId: created.planId,
    planStatus: 'awaiting_approval',
    approvalId: created.approvalId,
    steps: [awaitingApprovalSummary(created.stepId, GMAIL_SEND_REPLY_ACTION)],
    assistantResponseText: [intro, '', ...preview, '', APPROVAL_FOOTER].join('\n')
  });
}

/* ------------------------------ New email (compose) ------------------------------ */

async function handleComposeNewEmail(
  scope: AuthenticatedScope,
  intent: GmailChatIntent,
  options: GmailChatExecutionOptions
): Promise<GmailChatExecutionOutcome> {
  const compose = intent.compose ?? { to: null, subject: null, body: null };
  const gmail = options.gmail;
  if (!gmail) {
    return outcome(intent, { connectorStatus: 'not_configured', assistantResponseText: readinessMessage('not_configured') });
  }

  const convKey = composeConversationKey(scope, options.conversationId);
  const previousCompose = convKey ? pendingComposeByConversation.get(convKey) : undefined;

  const rawTo = compose.to ?? previousCompose?.to ?? null;
  const to = rawTo ? normalizeGmailRecipient(rawTo) : null;
  const effectiveSubject = compose.subject ?? previousCompose?.subject ?? null;
  const effectiveBody = compose.body ?? previousCompose?.body ?? null;

  if (!to) {
    if (convKey && (effectiveBody || effectiveSubject)) {
      pendingComposeByConversation.set(convKey, {
        to: null,
        subject: effectiveSubject,
        body: effectiveBody,
        updatedAt: Date.now()
      });
    }
    return outcome(intent, {
      assistantResponseText: compose.to
        ? `"${sanitizeUntrustedEmailField(compose.to, 120)}" doesn't look like a valid email address. Please check it and try again.`
        : 'Who should I send it to? Please include their email address, for example: "Send hi to name@example.com".'
    });
  }
  if (!effectiveBody) {
    if (convKey) {
      pendingComposeByConversation.set(convKey, {
        to,
        subject: effectiveSubject,
        body: null,
        updatedAt: Date.now()
      });
    }
    return outcome(intent, {
      assistantResponseText: `What should the email to ${to} say? For example: "Send an email to ${to} saying Hi, will you come tomorrow?"`
    });
  }

  const readiness = await gmail.sendReadiness(scope, 'new');
  const status = readiness.status;
  if (!readiness.ready || !readiness.connectedEmail) {
    return outcome(intent, {
      connectorStatus: status.status,
      mode: status.mode,
      connectedEmail: readiness.connectedEmail,
      assistantResponseText: readinessMessage(readiness.reason)
    });
  }

  const params: GmailSendNewInput = {
    connectedEmail: readiness.connectedEmail,
    to,
    ...(effectiveSubject ? { subject: effectiveSubject.slice(0, 998) } : {}),
    bodyText: effectiveBody.slice(0, 50000)
  };

  if (convKey) {
    pendingComposeByConversation.delete(convKey);
  }

  const preview = draftPreviewLines({ to, subject: params.subject ?? null, bodyText: params.bodyText });
  if (!options.db) {
    return outcome(intent, {
      mode: status.mode,
      connectedEmail: readiness.connectedEmail,
      assistantResponseText: ['Your email is ready.', '', ...preview, '', 'No email has been sent.'].join('\n')
    });
  }

  // If this conversation already has an unapproved draft waiting, cancel it cleanly before creating the new one.
  if (options.conversationId) {
    const existingPending = await findLatestGmailSendPlan(options.db, scope, {
      conversationId: options.conversationId,
      workflowKinds: ['gmail_new_email', 'gmail_reply'],
      onlyAwaitingApproval: true
    });
    if (existingPending) {
      await cancelGovernedGmailSend(
        options.db,
        scope,
        existingPending.plan.id,
        'Replaced by a newer draft in the same conversation'
      );
    }
  }

  const created = await createGovernedGmailSend(options.db, scope, {
    actionName: GMAIL_SEND_NEW_ACTION,
    params: params as unknown as Record<string, unknown>,
    title: `Email to ${to}`,
    description: 'Approval-gated new Gmail email prepared in Thaara Chat',
    metadata: {
      origin: 'thaara_chat',
      conversationId: options.conversationId ?? null,
      streamId: options.streamId ?? null,
      connectedEmail: readiness.connectedEmail,
      to,
      ...(params.subject ? { subject: params.subject } : {})
    },
    auditAction: 'gmail.messages.send_new_prepared',
    auditPayload: { to, connectedEmail: readiness.connectedEmail, origin: 'thaara_chat' }
  });

  return outcome(intent, {
    mode: status.mode,
    connectedEmail: readiness.connectedEmail,
    messageCount: 1,
    planId: created.planId,
    planStatus: 'awaiting_approval',
    approvalId: created.approvalId,
    steps: [awaitingApprovalSummary(created.stepId, GMAIL_SEND_NEW_ACTION)],
    assistantResponseText: ['Your email is ready. Shall I send it?', '', ...preview, '', APPROVAL_FOOTER].join('\n')
  });
}

/* ------------------------------- Edit pending draft ------------------------------- */

async function handleEditPendingEmail(
  scope: AuthenticatedScope,
  intent: GmailChatIntent,
  options: GmailChatExecutionOptions
): Promise<GmailChatExecutionOutcome> {
  const db = options.db;
  const gmail = options.gmail;
  const edit = intent.edit!;
  if (!db) return notHandled(intent);

  const pending = await findLatestGmailSendPlan(db, scope, {
    conversationId: options.conversationId,
    workflowKinds: ['gmail_new_email', 'gmail_reply'],
    onlyAwaitingApproval: true
  });
  if (!pending || !pending.approval || pending.approval.status !== 'pending') {
    const convKey = composeConversationKey(scope, options.conversationId);
    const pendingCompose = convKey ? pendingComposeByConversation.get(convKey) : undefined;
    if (pendingCompose?.to && edit.field === 'body') {
      return handleComposeNewEmail(
        scope,
        {
          kind: 'compose_new_email',
          query: 'in:inbox',
          limit: 1,
          compose: { to: pendingCompose.to, subject: pendingCompose.subject, body: edit.value }
        },
        options
      );
    }
    // Nothing of ours to edit: let normal chat handle the message when configured.
    return notHandled(
      intent,
      'There is no email waiting to be changed. Tell me who to email and what to say first.'
    );
  }
  if (!gmail) {
    return outcome(intent, { connectorStatus: 'not_configured', assistantResponseText: readinessMessage('not_configured') });
  }

  const isReply = pending.workflowKind === 'gmail_reply';
  if (isReply && edit.field !== 'body') {
    return outcome(intent, {
      planId: pending.plan.id,
      planStatus: pending.plan.status,
      approvalId: pending.approval.id,
      assistantResponseText:
        "A reply always goes back to the person who wrote to you, so I can only change the message. Say, for example: \"Change it to I'll be there at 10.\""
    });
  }

  const readiness = await gmail.sendReadiness(scope, isReply ? 'reply' : 'new');
  if (!readiness.ready || !readiness.connectedEmail) {
    return outcome(intent, {
      connectorStatus: readiness.status.status,
      mode: readiness.status.mode,
      assistantResponseText: readinessMessage(readiness.reason)
    });
  }

  const previous = pending.step.parameters as Record<string, unknown>;
  let nextParams: Record<string, unknown>;
  if (isReply) {
    nextParams = { ...previous, connectedEmail: readiness.connectedEmail, bodyText: edit.value.slice(0, 50000) };
  } else {
    const base: GmailSendNewInput = {
      connectedEmail: readiness.connectedEmail,
      to: String(previous.to ?? ''),
      ...(typeof previous.subject === 'string' && previous.subject ? { subject: previous.subject } : {}),
      bodyText: String(previous.bodyText ?? '')
    };
    if (edit.field === 'to') {
      const to = normalizeGmailRecipient(edit.value);
      if (!to) {
        return outcome(intent, { assistantResponseText: "That doesn't look like a valid email address. Please check it and try again." });
      }
      base.to = to;
    } else if (edit.field === 'subject') {
      if (edit.value) base.subject = edit.value.slice(0, 998);
      else delete base.subject;
    } else {
      base.bodyText = edit.value.slice(0, 50000);
    }
    nextParams = base as unknown as Record<string, unknown>;
  }

  // Approvals are bound to exact content, so an edit replaces the waiting approval with a new one.
  const cancelled = await cancelGovernedGmailSend(db, scope, pending.plan.id, 'Replaced by an edited draft');
  if (!cancelled) {
    return outcome(intent, {
      assistantResponseText: 'That email is no longer waiting for approval, so I can\'t change it. Ask me to prepare a new one.'
    });
  }

  const meta = (pending.plan.metadata ?? {}) as Record<string, unknown>;
  const created = await createGovernedGmailSend(db, scope, {
    actionName: isReply ? GMAIL_SEND_REPLY_ACTION : GMAIL_SEND_NEW_ACTION,
    params: nextParams,
    title: pending.plan.title,
    description: pending.plan.description ?? 'Edited Gmail draft',
    metadata: {
      ...meta,
      conversationId: options.conversationId ?? meta.conversationId ?? null,
      streamId: options.streamId ?? null,
      connectedEmail: readiness.connectedEmail,
      to: nextParams.to,
      replacesPlanId: pending.plan.id
    },
    auditAction: isReply ? 'gmail.messages.reply_edited' : 'gmail.messages.send_new_edited',
    auditPayload: { replacesPlanId: pending.plan.id, field: edit.field, to: nextParams.to }
  });

  const preview = draftPreviewLines({
    to: String(nextParams.to),
    subject: typeof nextParams.subject === 'string' ? nextParams.subject : null,
    bodyText: String(nextParams.bodyText)
  });
  return outcome(intent, {
    mode: readiness.status.mode,
    connectedEmail: readiness.connectedEmail,
    messageCount: 1,
    planId: created.planId,
    planStatus: 'awaiting_approval',
    approvalId: created.approvalId,
    steps: [awaitingApprovalSummary(created.stepId, isReply ? GMAIL_SEND_REPLY_ACTION : GMAIL_SEND_NEW_ACTION)],
    assistantResponseText: [`I updated your ${isReply ? 'reply' : 'email'}. Shall I send it?`, '', ...preview, '', APPROVAL_FOOTER].join('\n')
  });
}

/* --------------------------- Send pending / report result --------------------------- */

async function handleSendPendingEmail(
  scope: AuthenticatedScope,
  intent: GmailChatIntent,
  options: GmailChatExecutionOptions
): Promise<GmailChatExecutionOutcome> {
  const db = options.db;
  const gmail = options.gmail;
  const noEmailMsg =
    'There is no email waiting to be sent. Tell me who to email and what to say, for example: "Send hi to name@example.com".';
  if (!db) return intent.generic ? notHandled(intent, noEmailMsg) : outcome(intent, { assistantResponseText: 'There is no email waiting to be sent.' });

  const latest = await findLatestGmailSendPlan(db, scope, {
    conversationId: options.conversationId,
    workflowKinds: ['gmail_new_email', 'gmail_reply']
  });
  if (!latest || !latest.approval) {
    const convKey = composeConversationKey(scope, options.conversationId);
    const pendingCompose = convKey ? pendingComposeByConversation.get(convKey) : undefined;
    if (pendingCompose?.to && !pendingCompose.body) {
      return outcome(intent, {
        assistantResponseText: `What should the email to ${pendingCompose.to} say? For example: "Send an email to ${pendingCompose.to} saying Hi, will you come tomorrow?"`
      });
    }
    return intent.generic
      ? notHandled(intent, noEmailMsg)
      : outcome(intent, {
          assistantResponseText: noEmailMsg
        });
  }

  const { plan, step, approval, receipt } = latest;
  const isReply = latest.workflowKind === 'gmail_reply';
  const noun = isReply ? 'reply' : 'email';
  const to = String((step.parameters as Record<string, unknown>).to ?? '');
  const ids = { planId: plan.id, approvalId: approval.id };

  // A chat message is never an approval. Only the Approve & Send (Confirm & Send) button decides the approval.
  if (approval.status === 'pending' && new Date(approval.expires_at) > new Date()) {
    return outcome(intent, {
      ...ids,
      planStatus: 'awaiting_approval',
      steps: [stepSummaryFrom(step, receipt)],
      assistantResponseText: `Your ${noun} to ${to} is ready but has not been sent. Please check it and press Approve & Send (Confirm & Send) below.`
    });
  }

  if (approval.status === 'rejected' || plan.status === 'cancelled' || step.status === 'cancelled') {
    return outcome(intent, {
      ...ids,
      planStatus: plan.status,
      assistantResponseText: `This ${noun} was cancelled, so it was not sent. Ask me to prepare a new one if you still want to send it.`
    });
  }

  if (approval.status === 'expired' || (approval.status === 'pending' && new Date(approval.expires_at) <= new Date())) {
    return outcome(intent, {
      ...ids,
      planStatus: 'failed',
      assistantResponseText: `This ${noun} draft expired and was not sent. Please ask me to prepare it again.`
    });
  }

  // Approved: report the governed execution result (running it only if it has not started yet).
  await waitForChatPlanBackgroundExecution(plan.id);
  if (gmail) {
    const adapters = new Map<string, ActionAdapter>(defaultActionAdapters);
    for (const [name, adapter] of gmail.createSendAdapters()) adapters.set(name, adapter);
    await reconcileGovernedPlanExecution(db, scope, plan.id, {
      policyGateway: options.policyGateway,
      queueService: options.queueService,
      adapters
    });
    await waitForChatPlanBackgroundExecution(plan.id);
  }

  const finalState = await db.withScopedTransaction(scope, async (txClient) => {
    const freshPlan = await new PlanRepository(txClient).findById(scope.workspaceId, plan.id);
    const freshStep = await new PlanStepRepository(txClient).findById(scope.workspaceId, step.id);
    const freshReceipt = await new ReceiptRepository(txClient).findByStepId(scope.workspaceId, step.id);
    return { plan: freshPlan ?? plan, step: freshStep ?? step, receipt: freshReceipt ?? receipt };
  });
  const summary = stepSummaryFrom(finalState.step, finalState.receipt);
  const proof = (finalState.receipt?.proof ?? {}) as Record<string, unknown>;

  if (finalState.step.status === 'verified' && finalState.receipt?.status === 'verified' && proof.status === 'accepted_by_gmail') {
    const sentTo = typeof proof.to === 'string' ? proof.to : to;
    return outcome(intent, {
      ...ids,
      planStatus: 'completed',
      messageCount: 1,
      steps: [summary],
      assistantResponseText: isReply
        ? `Reply sent using Gmail to ${sentTo}. Gmail accepted it for delivery.`
        : `Email sent to ${sentTo}.`
    });
  }

  if (finalState.step.status === 'unverified' || finalState.receipt?.status === 'unverified') {
    return outcome(intent, {
      ...ids,
      connectorStatus: 'provider_error',
      planStatus: 'unverified',
      steps: [summary],
      assistantResponseText: `I couldn't confirm whether Gmail sent this ${noun}. Please check your Gmail Sent folder before trying again. I won't retry automatically, so it won't be sent twice.`
    });
  }

  if (finalState.step.status === 'failed' || finalState.receipt?.status === 'failed' || finalState.step.status === 'not_configured') {
    const hint = sendFailureHint(proof);
    return outcome(intent, {
      ...ids,
      connectorStatus: 'provider_error',
      planStatus: finalState.plan.status,
      steps: [summary],
      assistantResponseText: ['Email could not be sent. Please try again.', ...(hint ? [hint] : [])].join(' ')
    });
  }

  return outcome(intent, {
    ...ids,
    planStatus: finalState.plan.status,
    steps: [summary],
    assistantResponseText: `Your ${noun} is approved and is being sent. I'll show the result here when Gmail answers.`
  });
}

async function handleCancelPendingEmail(
  scope: AuthenticatedScope,
  intent: GmailChatIntent,
  options: GmailChatExecutionOptions
): Promise<GmailChatExecutionOutcome> {
  const db = options.db;
  const convKey = composeConversationKey(scope, options.conversationId);
  const hadIncompleteCompose = convKey ? pendingComposeByConversation.delete(convKey) : false;
  const noCancelMsg = 'There is no email waiting for approval, so there is nothing to cancel.';
  if (!db) {
    if (hadIncompleteCompose) {
      return outcome(intent, { assistantResponseText: 'Okay, I cancelled the email. No email was sent.' });
    }
    return intent.generic ? notHandled(intent, noCancelMsg) : outcome(intent, { assistantResponseText: 'There is no email waiting to be cancelled.' });
  }

  const pending = await findLatestGmailSendPlan(db, scope, {
    conversationId: options.conversationId,
    workflowKinds: ['gmail_new_email', 'gmail_reply'],
    onlyAwaitingApproval: true
  });
  if (!pending) {
    if (hadIncompleteCompose) {
      return outcome(intent, { assistantResponseText: 'Okay, I cancelled the email. No email was sent.' });
    }
    return intent.generic
      ? notHandled(intent, noCancelMsg)
      : outcome(intent, { assistantResponseText: noCancelMsg });
  }
  const cancelled = await cancelGovernedGmailSend(db, scope, pending.plan.id, 'Cancelled by user in Thaara Chat');
  if (!cancelled) {
    return outcome(intent, {
      planId: pending.plan.id,
      assistantResponseText: 'That email is no longer waiting for approval, so it could not be cancelled.'
    });
  }
  return outcome(intent, {
    planId: pending.plan.id,
    planStatus: 'cancelled',
    approvalId: cancelled.approvalId,
    assistantResponseText: `Okay, I cancelled the ${pending.workflowKind === 'gmail_reply' ? 'reply' : 'email'}. No email was sent.`
  });
}

/* ------------------------------------ Entry point ------------------------------------ */

/**
 * Executes a Gmail chat intent against the authenticated user's own `GmailFoundation` and
 * `PolicyGateway`. Reads are tenant/user isolated and never substitute mock data in LIVE mode.
 * Every outbound email is prepared as an approval-gated plan; nothing is sent from chat text alone.
 */
export async function executeChatGmailRequest(
  scope: AuthenticatedScope,
  intent: GmailChatIntent,
  options: GmailChatExecutionOptions = {}
): Promise<GmailChatExecutionOutcome> {
  const policyGateway = options.policyGateway ?? defaultPolicyGateway;
  const gmail = options.gmail;

  const isSendFamily =
    intent.kind === 'compose_new_email' ||
    intent.kind === 'edit_pending_email' ||
    intent.kind === 'send_approved_reply' ||
    intent.kind === 'cancel_pending_reply';

  if (isSendFamily) {
    if (scope.role === 'viewer') {
      if (intent.generic) return notHandled(intent);
      return outcome(intent, {
        connectorStatus: 'policy_denied',
        assistantResponseText: "You don't have permission to send email from this workspace."
      });
    }
    try {
      if (intent.kind === 'compose_new_email') return await handleComposeNewEmail(scope, intent, options);
      if (intent.kind === 'edit_pending_email') return await handleEditPendingEmail(scope, intent, options);
      if (intent.kind === 'send_approved_reply') return await handleSendPendingEmail(scope, intent, options);
      return await handleCancelPendingEmail(scope, intent, options);
    } catch (err) {
      if (err instanceof ForbiddenError) {
        return outcome(intent, {
          connectorStatus: 'policy_denied',
          assistantResponseText: "You don't have permission to send email from this workspace. No email was sent."
        });
      }
      if (err instanceof AppError && (err.code === 'GMAIL_DISCONNECTED' || err.code === 'GMAIL_RECONNECT_REQUIRED')) {
        return outcome(intent, {
          connectorStatus: err.code === 'GMAIL_DISCONNECTED' ? 'disconnected' : 'reconnect_required',
          assistantResponseText: readinessMessage(err.code === 'GMAIL_DISCONNECTED' ? 'disconnected' : 'reconnect_required')
        });
      }
      const status = await safeStatus(scope, gmail);
      return outcome(intent, {
        connectorStatus: 'provider_error',
        mode: status?.mode ?? 'disabled',
        assistantResponseText: 'Something went wrong while preparing your email. No email was sent. Please try again.'
      });
    }
  }

  // Reads and reply preparation need Gmail search permission.
  const searchDecision = policyGateway.evaluate(scope, {
    actionName: 'gmail.messages.search',
    parameters: { query: intent.query, limit: intent.limit }
  });
  if (!searchDecision.allowed) {
    return outcome(intent, {
      connectorStatus: 'policy_denied',
      query: intent.query,
      assistantResponseText: "You don't have permission to read Gmail in this workspace."
    });
  }

  if (!gmail) {
    return outcome(intent, {
      connectorStatus: 'not_configured',
      query: intent.query,
      assistantResponseText: 'Gmail is not set up yet, so I could not check your email.'
    });
  }

  let status: GmailStatus;
  try {
    status = await gmail.status(scope);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return outcome(intent, {
        connectorStatus: 'policy_denied',
        query: intent.query,
        assistantResponseText: "You don't have permission to read Gmail in this workspace."
      });
    }
    throw err;
  }

  if (!status.configured || status.status === 'not_configured') {
    return outcome(intent, {
      connectorStatus: 'not_configured',
      mode: status.mode,
      query: intent.query,
      assistantResponseText: 'Gmail is not set up yet, so I could not check your email.'
    });
  }

  if (status.status === 'disconnected') {
    return outcome(intent, {
      connectorStatus: 'disconnected',
      mode: status.mode,
      query: intent.query,
      assistantResponseText: 'Gmail is not connected yet. Open the Gmail page and press Connect Gmail. I did not read or send any email.'
    });
  }

  if (status.status === 'reconnect_required') {
    return outcome(intent, {
      connectorStatus: 'reconnect_required',
      mode: status.mode,
      query: intent.query,
      assistantResponseText: 'Your Gmail connection has expired. Please reconnect Gmail on the Gmail page. I did not read or send any email.'
    });
  }

  const connectedEmail = status.connectedEmail
    ? sanitizeUntrustedEmailField(status.connectedEmail, 120)
    : null;
  const base = { mode: status.mode, connectedEmail, query: intent.query };

  try {
    if (intent.kind === 'prepare_reply' && intent.replyRequest) {
      return await handlePrepareGmailReply(scope, intent, status, options);
    }

    const searchRes = await gmail.search(scope, { query: intent.query, limit: intent.limit });
    const stubs = searchRes.messages.slice(0, Math.min(intent.limit, 10));
    const sender = intent.senderFilter ? sanitizeUntrustedEmailField(intent.senderFilter, 120) : null;
    const recipient = intent.recipientFilter ? sanitizeUntrustedEmailField(intent.recipientFilter, 120) : null;
    const topic = intent.topicFilter ? sanitizeUntrustedEmailField(intent.topicFilter, 120) : null;
    const accountLine = connectedEmail ? `Gmail account: ${connectedEmail}` : null;

    if (stubs.length === 0) {
      const empty =
        sender
          ? intent.asksYesNo
            ? `No, I couldn't find any emails from ${sender}.`
            : `No emails found from ${sender}.`
          : recipient
            ? `No emails found to ${recipient}.`
            : topic
              ? `No emails found about "${topic}".`
              : intent.kind === 'read_unread'
                ? 'You have no unread emails.'
                : 'No emails found.';
      return outcome(intent, {
        ...base,
        assistantResponseText: [empty, ...(accountLine ? ['', accountLine] : [])].join('\n')
      });
    }

    const detailedMessages: GmailMessage[] = [];
    for (const stub of stubs) {
      detailedMessages.push(await gmail.read(scope, stub.id));
    }
    const count = detailedMessages.length;
    const items = detailedMessages.map((msg, idx) => formatEmailListItem(idx, msg));

    let heading: string[];
    if (intent.kind === 'summarize_emails') {
      const unreadCount = detailedMessages.filter((m) => m.isUnread).length;
      const senders = Array.from(
        new Set(detailedMessages.map((m) => sanitizeUntrustedEmailField(m.from, 80)).filter(Boolean))
      );
      heading = [
        `Here's a quick summary of your latest ${plural(count, 'email')}:`,
        `- ${unreadCount === 0 ? 'None are unread.' : `${unreadCount} ${unreadCount === 1 ? 'is' : 'are'} unread.`}`,
        `- From: ${senders.length > 0 ? senders.join(', ') : 'Unknown'}`
      ];
    } else if (sender) {
      heading = [`${intent.asksYesNo ? 'Yes. ' : ''}I found ${plural(count, 'email')} from ${sender}:`];
    } else if (recipient) {
      heading = [`I found ${plural(count, 'email')} to ${recipient}:`];
    } else if (topic) {
      heading = [`I found ${plural(count, 'email')} about "${topic}":`];
    } else if (intent.kind === 'read_unread') {
      heading = [count === 1 ? 'Here is your unread email:' : `Here are your ${count} unread emails:`];
    } else {
      heading = [count === 1 ? 'Here is your latest email:' : `Here are your latest ${count} emails:`];
    }

    return outcome(intent, {
      ...base,
      messageCount: count,
      assistantResponseText: [...heading, '', ...items, ...(accountLine ? ['', accountLine] : [])].join('\n')
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return outcome(intent, {
        ...base,
        connectorStatus: 'policy_denied',
        assistantResponseText: "You don't have permission to read Gmail in this workspace."
      });
    }
    if (err instanceof AppError) {
      if (err.code === 'GMAIL_DISCONNECTED') {
        return outcome(intent, {
          ...base,
          connectorStatus: 'disconnected',
          connectedEmail: null,
          assistantResponseText: 'Gmail is not connected yet. Open the Gmail page and press Connect Gmail.'
        });
      }
      if (err.code === 'GMAIL_RECONNECT_REQUIRED') {
        return outcome(intent, {
          ...base,
          connectorStatus: 'reconnect_required',
          connectedEmail: null,
          assistantResponseText: 'Your Gmail connection has expired. Please reconnect Gmail on the Gmail page.'
        });
      }
    }
    return outcome(intent, {
      ...base,
      connectorStatus: 'provider_error',
      assistantResponseText: "I couldn't reach Gmail right now. Please try again in a moment."
    });
  }
}
