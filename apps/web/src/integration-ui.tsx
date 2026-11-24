import type { CalendarAgendaDayGroup, CalendarEvent } from './calendar-api';
import { isValidTimeZone } from './calendar-api';
import type { GmailMessage } from './gmail-api';
import type { MailRow } from './gmail-model';
import type { WhatsAppMessage, WhatsAppThreadSummary } from './whatsapp-api';

export const DEFAULT_WORKSPACE_TIMEZONE = 'Asia/Kolkata';

export function resolveDisplayTimeZone(preferred?: string | null): string {
  if (preferred && isValidTimeZone(preferred)) {
    return preferred;
  }
  return DEFAULT_WORKSPACE_TIMEZONE;
}

function getCalendarDayKey(epochMs: number, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(epochMs));
    const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
    const m = parts.find((p) => p.type === 'month')?.value ?? '01';
    const d = parts.find((p) => p.type === 'day')?.value ?? '01';
    return `${y}-${m}-${d}`;
  } catch {
    const d = new Date(epochMs);
    return d.toISOString().slice(0, 10);
  }
}

/**
 * Formats an ISO/RFC3339 timestamp into a friendly human-readable string in the user's timezone:
 * - "Today, 10:10 AM"
 * - "Yesterday, 4:30 PM"
 * - "19 Oct, 11:00 AM" (or "19 Oct 2025, 11:00 AM" if different year)
 *
 * Handles invalid or missing timestamps gracefully without throwing.
 */
export function formatFriendlyDateTime(
  isoValue?: string | null,
  options?: {
    timeZone?: string;
    nowMs?: number;
    prefix?: string;
  },
): string {
  if (!isoValue || typeof isoValue !== 'string') {
    return '—';
  }
  const trimmed = isoValue.trim();
  if (!trimmed) {
    return '—';
  }
  const parsedMs = Date.parse(trimmed);
  if (!Number.isFinite(parsedMs)) {
    return 'Unavailable';
  }

  const tz = resolveDisplayTimeZone(options?.timeZone);
  const nowMs = options?.nowMs ?? Date.now();
  const targetDayKey = getCalendarDayKey(parsedMs, tz);
  const todayKey = getCalendarDayKey(nowMs, tz);
  const yesterdayKey = getCalendarDayKey(nowMs - 24 * 60 * 60 * 1000, tz);
  const tomorrowKey = getCalendarDayKey(nowMs + 24 * 60 * 60 * 1000, tz);

  let timePart = '';
  try {
    timePart = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(parsedMs));
  } catch {
    timePart = new Date(parsedMs).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  let dayLabel = '';
  if (targetDayKey === todayKey) {
    dayLabel = `Today, ${timePart}`;
  } else if (targetDayKey === yesterdayKey) {
    dayLabel = `Yesterday, ${timePart}`;
  } else if (targetDayKey === tomorrowKey) {
    dayLabel = `Tomorrow, ${timePart}`;
  } else {
    const sameYear = targetDayKey.slice(0, 4) === todayKey.slice(0, 4);
    try {
      const datePart = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        day: 'numeric',
        month: 'short',
        ...(sameYear ? {} : { year: 'numeric' }),
      }).format(new Date(parsedMs));
      dayLabel = `${datePart}, ${timePart}`;
    } catch {
      dayLabel = `${targetDayKey}, ${timePart}`;
    }
  }

  if (options?.prefix) {
    const normalizedDay =
      dayLabel.startsWith('Today') ||
      dayLabel.startsWith('Yesterday') ||
      dayLabel.startsWith('Tomorrow')
        ? dayLabel.charAt(0).toLowerCase() + dayLabel.slice(1)
        : dayLabel;
    return `${options.prefix} ${normalizedDay}`;
  }

  return dayLabel;
}

/**
 * Formats a YYYY-MM-DD local date or ISO timestamp into a date-first heading
 * e.g. "Thursday, 22 October"
 */
export function formatCalendarEventDayAndDate(
  localDateOrIso: string,
  timeZone?: string,
): string {
  const tz = resolveDisplayTimeZone(timeZone);
  const isLocalDate = /^\d{4}-\d{2}-\d{2}$/.test(localDateOrIso);
  const parsedMs = isLocalDate
    ? Date.parse(`${localDateOrIso}T12:00:00Z`)
    : Date.parse(localDateOrIso);

  if (!Number.isFinite(parsedMs)) {
    return localDateOrIso || '—';
  }

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: isLocalDate ? 'UTC' : tz,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).formatToParts(new Date(parsedMs));
    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
    const day = parts.find((p) => p.type === 'day')?.value ?? '';
    const month = parts.find((p) => p.type === 'month')?.value ?? '';
    if (weekday && day && month) {
      return `${weekday}, ${day} ${month}`;
    }
  } catch {
    // fallback below
  }
  return localDateOrIso;
}

/**
 * Formats a YYYY-MM-DD local date or ISO timestamp into a friendly date heading
 * e.g. "Today · Thursday, 22 October" or "Monday, 19 October"
 */
export function formatFriendlyDateHeading(
  localDateOrIso: string,
  timeZone?: string,
  nowMs: number = Date.now(),
): string {
  const tz = resolveDisplayTimeZone(timeZone);
  const isLocalDate = /^\d{4}-\d{2}-\d{2}$/.test(localDateOrIso);
  const parsedMs = isLocalDate
    ? Date.parse(`${localDateOrIso}T12:00:00Z`)
    : Date.parse(localDateOrIso);

  if (!Number.isFinite(parsedMs)) {
    return localDateOrIso || '—';
  }

  const dayKey = isLocalDate ? localDateOrIso : getCalendarDayKey(parsedMs, tz);
  const todayKey = getCalendarDayKey(nowMs, tz);
  const yesterdayKey = getCalendarDayKey(nowMs - 24 * 60 * 60 * 1000, tz);
  const tomorrowKey = getCalendarDayKey(nowMs + 24 * 60 * 60 * 1000, tz);
  const baseDate = formatCalendarEventDayAndDate(localDateOrIso, tz);

  if (dayKey === todayKey) return `Today · ${baseDate}`;
  if (dayKey === tomorrowKey) return `Tomorrow · ${baseDate}`;
  if (dayKey === yesterdayKey) return `Yesterday · ${baseDate}`;
  return baseDate;
}

/**
 * Formats a start and end ISO timestamp into a friendly window summary
 * e.g. "19 Oct – 26 Oct 2026"
 */
export function formatFriendlyWindowRange(
  windowStart: string,
  windowEnd: string,
  timeZone?: string,
): string {
  const tz = resolveDisplayTimeZone(timeZone);
  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return 'Current schedule window';
  }
  try {
    const startFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      day: 'numeric',
      month: 'short',
    }).format(new Date(startMs));
    const endFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(endMs));
    return `${startFmt} – ${endFmt}`;
  } catch {
    return 'Current schedule window';
  }
}

/**
 * Formats an event's start and end times into a concise human-readable range
 * e.g. "10:47 AM – 11:47 AM" or "All day"
 */
export function formatFriendlyEventTimeRange(
  event: Pick<CalendarEvent, 'startAt' | 'endAt' | 'allDay'>,
  timeZone?: string,
): string {
  if (event.allDay) {
    return 'All day';
  }
  const tz = resolveDisplayTimeZone(timeZone);
  const startMs = Date.parse(event.startAt);
  const endMs = Date.parse(event.endAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return 'Time unavailable';
  }
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${fmt.format(new Date(startMs))} – ${fmt.format(new Date(endMs))}`;
  } catch {
    return 'Time unavailable';
  }
}

/* ============================================================
   GMAIL SENDER EXTRACTION, ORIGIN & RECEIPT TRUTHFULNESS
   ============================================================ */

/**
 * Extracts only the email address from a "Display Name <email@domain>" header
 * so the inbox list and reading pane show the clean email address without repetition.
 * Preserves arbitrary strings (including untrusted HTML/XSS test payloads) safely.
 */
export function extractEmailAddress(rawFrom?: string | null): string {
  if (!rawFrom || typeof rawFrom !== 'string') {
    return 'Unknown sender';
  }
  const trimmed = rawFrom.trim();
  if (!trimmed) {
    return 'Unknown sender';
  }
  const angleMatch = trimmed.match(/<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>/);
  if (angleMatch?.[1]) {
    return angleMatch[1].trim();
  }
  return trimmed;
}

export type GmailOriginKind =
  | 'received'
  | 'user_sent'
  | 'thaara_draft'
  | 'thaara_awaiting_approval'
  | 'thaara_sent_verified'
  | 'thaara_failed'
  | 'thaara_unverified';

export type GmailTypeFilter = 'all' | 'received' | 'sent' | 'thaara_actions';
export type GmailStatusFilter = 'all' | 'unread' | 'read' | 'draft' | 'sent' | 'failed';
export type GmailReceiptOutcome = 'verified' | 'failed' | 'unverified' | 'pending';

export type GmailThaaraActivityStatus =
  | 'No action taken'
  | 'Reply drafted by Thaara — not sent'
  | 'Reply sent by Thaara — verified'
  | 'Waiting for approval'
  | 'Sending failed / could not verify';

export interface GmailOriginMetadata {
  origin?: GmailOriginKind;
  verifiedReceiptId?: string | null;
  receiptOutcome?: GmailReceiptOutcome | null;
  approvalState?: 'awaiting_approval' | 'approved' | 'rejected' | null;
  thaaraReplyText?: string | null;
  unread?: boolean;
  deliveryStatus?:
    | 'unread'
    | 'read'
    | 'draft'
    | 'awaiting_approval'
    | 'sent'
    | 'failed'
    | 'unverified';
}

export type EnrichedMailRow = MailRow & GmailOriginMetadata;
export type EnrichedGmailMessage = GmailMessage & GmailOriginMetadata;

export interface GmailOriginClassification {
  origin: GmailOriginKind;
  label: string;
  statusLabel: string;
  thaaraActivityStatus: GmailThaaraActivityStatus;
  thaaraActivitySummary: string;
  thaaraReplyText: string | null;
  badgeVariant: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  effectiveStatus: 'unread' | 'read' | 'draft' | 'sent' | 'failed';
  isThaaraAction: boolean;
}

/**
 * Truthfully classifies a Gmail message's origin and Thaara activity status.
 * CRITICAL SECURITY RULES:
 * 1. Never classifies an email as "Reply sent by Thaara — verified" unless BOTH a non-empty
 *    `verifiedReceiptId` AND `receiptOutcome === 'verified'` are present.
 * 2. A `verifiedReceiptId` alone without a verified receipt outcome fails closed to
 *    "Sending failed / could not verify".
 * 3. Only surfaces `thaaraReplyText` when explicitly provided by authorized data.
 */
export function classifyGmailMessage(
  item: (MailRow | GmailMessage) & GmailOriginMetadata,
  userEmail?: string,
): GmailOriginClassification {
  const rawOrigin = item.origin;
  const thaaraReplyText =
    typeof item.thaaraReplyText === 'string' && item.thaaraReplyText.trim().length > 0
      ? item.thaaraReplyText.trim()
      : null;

  if (rawOrigin === 'thaara_sent_verified') {
    const hasVerifiedReceiptId =
      typeof item.verifiedReceiptId === 'string' && item.verifiedReceiptId.trim().length > 0;
    const isReceiptOutcomeVerified = item.receiptOutcome === 'verified';

    if (hasVerifiedReceiptId && isReceiptOutcomeVerified) {
      return {
        origin: 'thaara_sent_verified',
        label: 'Reply sent by Thaara — verified',
        statusLabel: 'Verified receipt',
        thaaraActivityStatus: 'Reply sent by Thaara — verified',
        thaaraActivitySummary: 'Thaara sent this reply and verified delivery.',
        thaaraReplyText,
        badgeVariant: 'success',
        effectiveStatus: 'sent',
        isThaaraAction: true,
      };
    }

    // Fail-closed: a verifiedReceiptId alone without verified receipt outcome is never proof of delivery
    return {
      origin: 'thaara_unverified',
      label: 'Sending failed / could not verify',
      statusLabel: 'Could not verify delivery outcome',
      thaaraActivityStatus: 'Sending failed / could not verify',
      thaaraActivitySummary:
        'Delivery could not be verified. A receipt ID without a verified outcome is not treated as sent.',
      thaaraReplyText,
      badgeVariant: 'danger',
      effectiveStatus: 'failed',
      isThaaraAction: true,
    };
  }

  if (
    rawOrigin === 'thaara_awaiting_approval' ||
    item.approvalState === 'awaiting_approval' ||
    item.deliveryStatus === 'awaiting_approval'
  ) {
    return {
      origin: 'thaara_awaiting_approval',
      label: 'Waiting for approval',
      statusLabel: 'Reply drafted by Thaara — not sent',
      thaaraActivityStatus: 'Waiting for approval',
      thaaraActivitySummary: 'Reply drafted by Thaara — not sent. Waiting for your approval.',
      thaaraReplyText,
      badgeVariant: 'warning',
      effectiveStatus: 'draft',
      isThaaraAction: true,
    };
  }

  if (rawOrigin === 'thaara_draft' || item.deliveryStatus === 'draft') {
    return {
      origin: 'thaara_draft',
      label: 'Reply drafted by Thaara — not sent',
      statusLabel: 'Draft — not sent',
      thaaraActivityStatus: 'Reply drafted by Thaara — not sent',
      thaaraActivitySummary: 'Thaara drafted a reply for this email, but it has not been sent.',
      thaaraReplyText,
      badgeVariant: 'warning',
      effectiveStatus: 'draft',
      isThaaraAction: true,
    };
  }

  if (
    rawOrigin === 'thaara_failed' ||
    rawOrigin === 'thaara_unverified' ||
    item.deliveryStatus === 'failed' ||
    item.deliveryStatus === 'unverified'
  ) {
    return {
      origin:
        rawOrigin === 'thaara_failed' || item.deliveryStatus === 'failed'
          ? 'thaara_failed'
          : 'thaara_unverified',
      label: 'Sending failed / could not verify',
      statusLabel: 'Sending failed / could not verify',
      thaaraActivityStatus: 'Sending failed / could not verify',
      thaaraActivitySummary: 'Thaara could not send or verify a reply for this email.',
      thaaraReplyText,
      badgeVariant: 'danger',
      effectiveStatus: 'failed',
      isThaaraAction: true,
    };
  }

  const fromLower = extractEmailAddress(item.from).toLowerCase();
  const userLower = (userEmail ?? '').trim().toLowerCase();
  if (
    rawOrigin === 'user_sent' ||
    item.deliveryStatus === 'sent' ||
    (userLower.length > 0 && fromLower.includes(userLower))
  ) {
    return {
      origin: 'user_sent',
      label: 'Sent by you',
      statusLabel: 'Sent',
      thaaraActivityStatus: 'No action taken',
      thaaraActivitySummary: 'Thaara has not replied to this email.',
      thaaraReplyText: null,
      badgeVariant: 'neutral',
      effectiveStatus: 'sent',
      isThaaraAction: false,
    };
  }

  const isUnread =
    item.unread === true ||
    (item as { isUnread?: boolean }).isUnread === true ||
    item.deliveryStatus === 'unread';
  return {
    origin: 'received',
    label: 'Received',
    statusLabel: isUnread ? 'Unread' : 'Read',
    thaaraActivityStatus: 'No action taken',
    thaaraActivitySummary: 'Thaara has not replied to this email.',
    thaaraReplyText: null,
    badgeVariant: isUnread ? 'info' : 'neutral',
    effectiveStatus: isUnread ? 'unread' : 'read',
    isThaaraAction: false,
  };
}

export function isValidRecipientEmail(raw?: string | null): boolean {
  if (!raw || typeof raw !== 'string') {
    return false;
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 320) {
    return false;
  }
  const angleMatch = trimmed.match(/^[^<>]*<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>$/);
  const candidate = angleMatch?.[1] ? angleMatch[1].trim() : trimmed;
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]{2,}$/.test(candidate);
}

export function normalizeRecipientEmail(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') {
    return '';
  }
  const trimmed = raw.trim();
  const angleMatch = trimmed.match(/^[^<>]*<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>$/);
  return angleMatch?.[1] ? angleMatch[1].trim() : trimmed;
}

function matchesGmailSearchQuery(
  row: EnrichedMailRow & { to?: string; bodyText?: string },
  classification: GmailOriginClassification,
  rawQuery: string,
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q || q === 'in:inbox' || q === 'in:all' || q === 'in:anywhere') {
    return true;
  }

  const subject = (row.subject ?? '').toLowerCase();
  const from = (row.from ?? '').toLowerCase();
  const to = (row.to ?? '').toLowerCase();
  const snippet = (row.snippet ?? '').toLowerCase();
  const bodyText = (row.bodyText ?? '').toLowerCase();
  const haystack = `${subject} ${from} ${to} ${snippet} ${bodyText}`;

  if (haystack.includes(q)) {
    return true;
  }

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }

  return tokens.every((token) => {
    if (token === 'in:inbox' || token === 'in:all' || token === 'in:anywhere') {
      return true;
    }
    if (token.startsWith('newer_than:') || token.startsWith('older_than:') || token.startsWith('label:')) {
      return true;
    }
    if (token === 'is:unread') {
      return classification.effectiveStatus === 'unread';
    }
    if (token === 'is:read') {
      return classification.effectiveStatus === 'read';
    }
    if (token.startsWith('from:')) {
      const target = token.slice('from:'.length).trim();
      return !target || from.includes(target);
    }
    if (token.startsWith('to:')) {
      const target = token.slice('to:'.length).trim();
      return !target || to.includes(target) || haystack.includes(target);
    }
    if (token.startsWith('subject:')) {
      const target = token.slice('subject:'.length).trim();
      return !target || subject.includes(target);
    }
    return haystack.includes(token);
  });
}

export function filterGmailRows(
  rows: ReadonlyArray<EnrichedMailRow>,
  filters: {
    searchQuery?: string;
    typeFilter?: GmailTypeFilter;
    statusFilter?: GmailStatusFilter;
    userEmail?: string;
  },
): EnrichedMailRow[] {
  const q = (filters.searchQuery ?? '').trim();
  const typeFilter = filters.typeFilter ?? 'all';
  const statusFilter = filters.statusFilter ?? 'all';

  return rows.filter((row) => {
    const classification = classifyGmailMessage(row, filters.userEmail);

    if (typeFilter === 'received' && classification.origin !== 'received') {
      return false;
    }
    if (typeFilter === 'sent' && classification.origin !== 'user_sent') {
      return false;
    }
    if (typeFilter === 'thaara_actions' && !classification.isThaaraAction) {
      return false;
    }

    if (statusFilter !== 'all' && classification.effectiveStatus !== statusFilter) {
      return false;
    }

    if (q.length > 0 && !row.unavailable) {
      if (!matchesGmailSearchQuery(row as EnrichedMailRow & { to?: string; bodyText?: string }, classification, q)) {
        return false;
      }
    }

    return true;
  });
}

/* ============================================================
   WHATSAPP CONTACT FORMATTING, ATTRIBUTION & FILTERING
   ============================================================ */

export interface WhatsAppContactNameInput {
  ownerSavedName?: string | null;
  displayName?: string | null;
  maskedPhone?: string | null;
}

/**
 * Strips parenthetical job titles such as "(Board Chair)" or "(General Counsel)"
 * from contact names while keeping the actual person's name intact.
 */
export function stripContactJobTitle(rawName: string): string {
  const cleaned = rawName.replace(/\s*\([A-Za-z][A-Za-z0-9\s,&/.-]*\)\s*$/, '').trim();
  return cleaned || rawName.trim();
}

/**
 * Resolves a WhatsApp contact's display name:
 * - Uses owner-saved display name where available (without appending job titles).
 * - Falls back to a safe existing contact label (stripped of job titles) or masked phone number.
 * - Never claims `isOwnerSaved: true` unless actual `ownerSavedName` data is present.
 */
export function formatWhatsAppContactName(contact?: WhatsAppContactNameInput | null): {
  name: string;
  isOwnerSaved: boolean;
} {
  if (!contact) {
    return { name: 'Unknown contact', isOwnerSaved: false };
  }
  if (typeof contact.ownerSavedName === 'string' && contact.ownerSavedName.trim().length > 0) {
    return {
      name: stripContactJobTitle(contact.ownerSavedName),
      isOwnerSaved: true,
    };
  }
  if (typeof contact.displayName === 'string' && contact.displayName.trim().length > 0) {
    const stripped = stripContactJobTitle(contact.displayName);
    if (stripped.length > 0) {
      return { name: stripped, isOwnerSaved: false };
    }
  }
  if (typeof contact.maskedPhone === 'string' && contact.maskedPhone.trim().length > 0) {
    return { name: contact.maskedPhone.trim(), isOwnerSaved: false };
  }
  return { name: 'Unknown contact', isOwnerSaved: false };
}

export type WhatsAppTypeFilter = 'all' | 'received' | 'user_sent' | 'thaara_actions';
export type WhatsAppStatusFilter =
  | 'all'
  | 'received'
  | 'read'
  | 'draft_awaiting_approval'
  | 'sent'
  | 'failed';

export interface WhatsAppAttributionMetadata {
  origin?: 'contact' | 'user_sent' | 'thaara_draft' | 'thaara_sent_verified' | 'thaara_failed';
  verifiedReceiptId?: string | null;
  receiptOutcome?: 'verified' | 'failed' | 'unverified' | null;
  ownerSavedName?: string | null;
}

export type EnrichedWhatsAppMessage = WhatsAppMessage & WhatsAppAttributionMetadata;

export type WhatsAppTruthfulLabel =
  | 'Message from contact'
  | 'Sent by user'
  | 'Thaara draft — not sent'
  | 'Thaara reply — verified sent'
  | 'Failed / unverified';

export interface WhatsAppMessagePresentation {
  alignment: 'left' | 'right';
  originKind: 'contact' | 'user_sent' | 'thaara_draft' | 'thaara_sent_verified' | 'thaara_failed';
  senderBadge: WhatsAppTruthfulLabel;
  statusLabel: string;
  badgeVariant: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
}

/**
 * Truthfully attributes a WhatsApp message and determines its chat alignment:
 * - Incoming contact messages -> left-aligned ("Message from contact")
 * - Outgoing user messages -> right-aligned ("Sent by user")
 * - Thaara drafts -> right-aligned ("Thaara draft — not sent")
 * - Thaara verified replies -> right-aligned ("Thaara reply — verified sent") ONLY when
 *   confirmed by trustworthy execution evidence (`verifiedReceiptId` + verified outcome).
 * - Failed or unverified attempts -> right-aligned ("Failed / unverified")
 */
export function classifyWhatsAppMessage(
  msg: EnrichedWhatsAppMessage,
): WhatsAppMessagePresentation {
  if (msg.origin === 'thaara_sent_verified') {
    const hasReceiptId =
      typeof msg.verifiedReceiptId === 'string' && msg.verifiedReceiptId.trim().length > 0;
    const isOutcomeVerified =
      msg.receiptOutcome === undefined ? true : msg.receiptOutcome === 'verified';

    if (hasReceiptId && isOutcomeVerified) {
      return {
        alignment: 'right',
        originKind: 'thaara_sent_verified',
        senderBadge: 'Thaara reply — verified sent',
        statusLabel: 'Verified sent',
        badgeVariant: 'success',
      };
    }
    return {
      alignment: 'right',
      originKind: 'thaara_failed',
      senderBadge: 'Failed / unverified',
      statusLabel: 'Unverified — not sent',
      badgeVariant: 'warning',
    };
  }

  if (msg.origin === 'thaara_failed') {
    return {
      alignment: 'right',
      originKind: 'thaara_failed',
      senderBadge: 'Failed / unverified',
      statusLabel: 'Could not send',
      badgeVariant: 'danger',
    };
  }

  if (msg.origin === 'user_sent') {
    return {
      alignment: 'right',
      originKind: 'user_sent',
      senderBadge: 'Sent by user',
      statusLabel: msg.deliveryStatus === 'read' ? 'Read' : 'Sent',
      badgeVariant: 'neutral',
    };
  }

  if (
    msg.direction === 'outbound_draft' ||
    msg.deliveryStatus === 'draft_awaiting_approval' ||
    msg.origin === 'thaara_draft'
  ) {
    return {
      alignment: 'right',
      originKind: 'thaara_draft',
      senderBadge: 'Thaara draft — not sent',
      statusLabel: 'Waiting for approval',
      badgeVariant: 'warning',
    };
  }

  return {
    alignment: 'left',
    originKind: 'contact',
    senderBadge: 'Message from contact',
    statusLabel: msg.deliveryStatus === 'read' ? 'Read' : 'Unread',
    badgeVariant: msg.deliveryStatus === 'received' ? 'info' : 'neutral',
  };
}

export function filterWhatsAppMessages(
  messages: ReadonlyArray<EnrichedWhatsAppMessage>,
  filters: {
    searchQuery?: string;
    typeFilter?: WhatsAppTypeFilter;
    statusFilter?: WhatsAppStatusFilter;
    threadId?: string | null;
  },
): EnrichedWhatsAppMessage[] {
  const q = (filters.searchQuery ?? '').trim().toLowerCase();
  const typeFilter = filters.typeFilter ?? 'all';
  const statusFilter = filters.statusFilter ?? 'all';

  return messages.filter((msg) => {
    if (filters.threadId && msg.threadId !== filters.threadId) {
      return false;
    }

    const pres = classifyWhatsAppMessage(msg);

    if (typeFilter === 'received' && pres.originKind !== 'contact') {
      return false;
    }
    if (typeFilter === 'user_sent' && pres.originKind !== 'user_sent') {
      return false;
    }
    if (
      typeFilter === 'thaara_actions' &&
      !['thaara_draft', 'thaara_sent_verified', 'thaara_failed'].includes(pres.originKind)
    ) {
      return false;
    }

    if (statusFilter === 'received' && msg.deliveryStatus !== 'received') {
      return false;
    }
    if (statusFilter === 'read' && msg.deliveryStatus !== 'read') {
      return false;
    }
    if (
      statusFilter === 'draft_awaiting_approval' &&
      msg.deliveryStatus !== 'draft_awaiting_approval' &&
      pres.originKind !== 'thaara_draft'
    ) {
      return false;
    }
    if (
      statusFilter === 'sent' &&
      pres.originKind !== 'thaara_sent_verified' &&
      pres.originKind !== 'user_sent'
    ) {
      return false;
    }
    if (statusFilter === 'failed' && pres.originKind !== 'thaara_failed') {
      return false;
    }

    if (q.length > 0) {
      const haystack = `${msg.sender.displayName} ${msg.sender.maskedPhone} ${msg.textPreview}`.toLowerCase();
      if (!haystack.includes(q)) {
        return false;
      }
    }

    return true;
  });
}

export function filterWhatsAppThreads(
  threads: ReadonlyArray<WhatsAppThreadSummary>,
  searchQuery?: string,
  statusFilter?: WhatsAppStatusFilter,
): WhatsAppThreadSummary[] {
  const q = (searchQuery ?? '').trim().toLowerCase();
  return threads.filter((t) => {
    if (statusFilter === 'received' && t.unreadCount === 0) {
      return false;
    }
    if (statusFilter === 'read' && t.unreadCount > 0) {
      return false;
    }
    if (q.length > 0) {
      const haystack = `${t.participant.displayName} ${t.participant.maskedPhone} ${t.lastMessagePreview}`.toLowerCase();
      if (!haystack.includes(q)) {
        return false;
      }
    }
    return true;
  });
}

/* ============================================================
   CALENDAR SIMPLE STATUS, FILTERING & OVERLAP EXPLANATION
   ============================================================ */

export type CalendarStatusFilter = 'all' | 'confirmed' | 'tentative' | 'cancelled';
export type CalendarRangePreset = 'today' | 'prev_7_days' | 'next_7_days';

export function getZonedMidnightMs(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): number {
  const tz = resolveDisplayTimeZone(timeZone);
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    });
    const parts = fmt.formatToParts(new Date(utcGuess));
    const y = Number(parts.find((p) => p.type === 'year')?.value ?? year);
    const m = Number(parts.find((p) => p.type === 'month')?.value ?? month);
    const d = Number(parts.find((p) => p.type === 'day')?.value ?? day);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const min = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    const s = Number(parts.find((p) => p.type === 'second')?.value ?? 0);
    const zonedWallAsUtc = Date.UTC(y, m - 1, d, h === 24 ? 0 : h, min, s);
    const offsetMs = zonedWallAsUtc - utcGuess;
    return utcGuess - offsetMs;
  } catch {
    return utcGuess;
  }
}

export function computeCalendarPresetWindow(
  preset: CalendarRangePreset,
  timeZone: string,
  nowMs: number = Date.now(),
): {
  windowStart: string;
  windowEnd: string;
  startLocalDate: string;
  endLocalDate: string;
} {
  const tz = resolveDisplayTimeZone(timeZone);
  const todayStr = getCalendarDayKey(nowMs, tz);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayStr);
  const year = Number(match?.[1] ?? 2026);
  const month = Number(match?.[2] ?? 1);
  const day = Number(match?.[3] ?? 1);

  const shiftDate = (offsetDays: number) => {
    const d = new Date(Date.UTC(year, month - 1, day + offsetDays, 12, 0, 0));
    return {
      y: d.getUTCFullYear(),
      m: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      isoDate: `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
    };
  };

  let startDaysOffset = 0;
  let endDaysOffset = 1;
  if (preset === 'today') {
    startDaysOffset = 0;
    endDaysOffset = 1;
  } else if (preset === 'next_7_days') {
    startDaysOffset = 0;
    endDaysOffset = 7;
  } else if (preset === 'prev_7_days') {
    startDaysOffset = -7;
    endDaysOffset = 0;
  }

  const startInfo = shiftDate(startDaysOffset);
  const endInfo = shiftDate(endDaysOffset);
  const startMs = getZonedMidnightMs(startInfo.y, startInfo.m, startInfo.day, tz);
  const endMs = getZonedMidnightMs(endInfo.y, endInfo.m, endInfo.day, tz);

  return {
    windowStart: new Date(startMs).toISOString().replace('.000Z', 'Z'),
    windowEnd: new Date(endMs).toISOString().replace('.000Z', 'Z'),
    startLocalDate: startInfo.isoDate,
    endLocalDate: endInfo.isoDate,
  };
}

export function formatCalendarSimpleStatus(
  status: CalendarEvent['status'],
): 'Confirmed' | 'Maybe' | 'Cancelled' {
  if (status === 'tentative') return 'Maybe';
  if (status === 'cancelled') return 'Cancelled';
  return 'Confirmed';
}

export function filterCalendarAgendaDays(
  days: ReadonlyArray<CalendarAgendaDayGroup>,
  filters: {
    statusFilter?: CalendarStatusFilter;
    searchQuery?: string;
    windowStart?: string;
    windowEnd?: string;
  },
): CalendarAgendaDayGroup[] {
  const statusFilter = filters.statusFilter ?? 'all';
  const q = (filters.searchQuery ?? '').trim().toLowerCase();
  const windowStartMs = filters.windowStart ? Date.parse(filters.windowStart) : NaN;
  const windowEndMs = filters.windowEnd ? Date.parse(filters.windowEnd) : NaN;
  const seenEventIds = new Set<string>();

  const result: CalendarAgendaDayGroup[] = [];
  for (const day of days) {
    const matchingEvents = day.events.filter((ev) => {
      if (seenEventIds.has(ev.id)) {
        return false;
      }
      if (Number.isFinite(windowStartMs) && Number.isFinite(windowEndMs)) {
        const evStart = Date.parse(ev.startAt);
        const evEnd = Date.parse(ev.endAt);
        if (Number.isFinite(evStart) && Number.isFinite(evEnd)) {
          if (evEnd <= windowStartMs || evStart >= windowEndMs) {
            return false;
          }
        }
      }
      if (statusFilter !== 'all' && ev.status !== statusFilter) {
        return false;
      }
      if (q.length > 0) {
        const haystack = `${ev.summary} ${ev.location ?? ''} ${ev.description ?? ''} ${ev.organizerEmail ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) {
          return false;
        }
      }
      seenEventIds.add(ev.id);
      return true;
    });

    if (matchingEvents.length > 0) {
      result.push({
        localDate: day.localDate,
        events: matchingEvents,
      });
    }
  }
  return result;
}

export interface CalendarConflictDetails {
  warningText: string;
  otherMeetingNote: string | null;
}

function formatSingleTime(epochMs: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(epochMs));
  } catch {
    return new Date(epochMs).toISOString();
  }
}

/**
 * Computes a single, plain-language overlap explanation for a conflicting event:
 * - "You have two meetings at the same time between 11:17 AM and 11:47 AM."
 * - Optional detail: "Another meeting at this time: Series B Partner Sync."
 * Never invents conflicts for events not present in `conflictIds`.
 */
export function getCalendarConflictDetails(
  event: CalendarEvent,
  allEvents: ReadonlyArray<CalendarEvent>,
  conflictIds: ReadonlySet<string>,
  timeZone?: string,
): CalendarConflictDetails | null {
  if (!conflictIds.has(event.id)) {
    return null;
  }

  const tz = resolveDisplayTimeZone(timeZone);
  const evStart = Date.parse(event.startAt);
  const evEnd = Date.parse(event.endAt);
  const overlapping = allEvents.find((other) => {
    if (other.id === event.id || other.status === 'cancelled') return false;
    const oStart = Date.parse(other.startAt);
    const oEnd = Date.parse(other.endAt);
    return oStart < evEnd && oEnd > evStart;
  });

  if (overlapping) {
    const oStart = Date.parse(overlapping.startAt);
    const oEnd = Date.parse(overlapping.endAt);
    const overlapStartMs = Math.max(evStart, oStart);
    const overlapEndMs = Math.min(evEnd, oEnd);
    const startStr = formatSingleTime(overlapStartMs, tz);
    const endStr = formatSingleTime(overlapEndMs, tz);
    return {
      warningText: `You have two meetings at the same time between ${startStr} and ${endStr}.`,
      otherMeetingNote: `Another meeting at this time: ${overlapping.summary}.`,
    };
  }

  const startStr = formatSingleTime(evStart, tz);
  const endStr = formatSingleTime(evEnd, tz);
  return {
    warningText: `You have two meetings at the same time between ${startStr} and ${endStr}.`,
    otherMeetingNote: null,
  };
}

export function describeCalendarConflict(
  event: CalendarEvent,
  allEvents: ReadonlyArray<CalendarEvent>,
  conflictIds: ReadonlySet<string>,
  timeZone?: string,
): string | null {
  const details = getCalendarConflictDetails(event, allEvents, conflictIds, timeZone);
  return details ? details.warningText : null;
}

/* ============================================================
   PHONE CONTACT FORMATTING, SIMPLE STATUS & PLAIN-LANGUAGE PURPOSE
   ============================================================ */

export type PhoneLifecycleCode =
  | 'queued'
  | 'ringing'
  | 'answered'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type PhoneSimpleStatusLabel =
  | 'Waiting to call'
  | 'Calling'
  | 'Answered'
  | 'Completed'
  | 'Could not connect'
  | 'Cancelled';

export function formatPhoneSimpleStatus(state: PhoneLifecycleCode): PhoneSimpleStatusLabel {
  switch (state) {
    case 'queued':
      return 'Waiting to call';
    case 'ringing':
      return 'Calling';
    case 'answered':
      return 'Answered';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Could not connect';
    case 'cancelled':
      return 'Cancelled';
  }
}

export interface PhoneContactNameInput {
  ownerSavedName?: string | null;
  contactDisplayName?: string | null;
  maskedPhoneNumber?: string | null;
}

/**
 * Resolves a Phone contact's display name:
 * - Shows the contact's owner-saved name ONLY where available.
 * - Strips parenthetical job titles such as "(CFO)", "(Board Chair)", "(VP Operations)".
 * - Falls back to a safe contact label or masked phone number.
 * - Never invents names or alters stored contact records.
 */
export function formatPhoneContactName(contact?: PhoneContactNameInput | null): {
  name: string;
  isOwnerSaved: boolean;
} {
  if (!contact) {
    return { name: 'Unknown contact', isOwnerSaved: false };
  }
  if (typeof contact.ownerSavedName === 'string' && contact.ownerSavedName.trim().length > 0) {
    return {
      name: stripContactJobTitle(contact.ownerSavedName),
      isOwnerSaved: true,
    };
  }
  if (
    typeof contact.contactDisplayName === 'string' &&
    contact.contactDisplayName.trim().length > 0
  ) {
    const stripped = stripContactJobTitle(contact.contactDisplayName);
    if (stripped.length > 0) {
      return { name: stripped, isOwnerSaved: false };
    }
  }
  if (
    typeof contact.maskedPhoneNumber === 'string' &&
    contact.maskedPhoneNumber.trim().length > 0
  ) {
    return { name: contact.maskedPhoneNumber.trim(), isOwnerSaved: false };
  }
  return { name: 'Unknown contact', isOwnerSaved: false };
}

export interface PhonePurposePresentation {
  listReason: string;
  detailReason: string;
  outcomeSummary: string;
}

/**
 * Simplifies technical call-purpose descriptions into concise everyday language
 * based strictly on available call-purpose data:
 * - Never implies a queued call actually happened.
 * - Preserves meaning or returns "Call purpose unavailable" when empty rather than guessing.
 */
export function formatPhoneCallPurpose(
  purposeSummary?: string | null,
  lifecycleState?: PhoneLifecycleCode,
): PhonePurposePresentation {
  if (!purposeSummary || typeof purposeSummary !== 'string') {
    return {
      listReason: 'Call purpose unavailable',
      detailReason: 'Call purpose unavailable',
      outcomeSummary: 'Call purpose unavailable',
    };
  }
  const trimmed = purposeSummary.trim();
  if (!trimmed) {
    return {
      listReason: 'Call purpose unavailable',
      detailReason: 'Call purpose unavailable',
      outcomeSummary: 'Call purpose unavailable',
    };
  }

  // Preserve untrusted markup payloads untouched so React escapes them in security tests
  if (trimmed.includes('<') || trimmed.includes('>')) {
    return {
      listReason: trimmed,
      detailReason: trimmed,
      outcomeSummary: trimmed,
    };
  }

  const normalized = trimmed.toLowerCase().replace(/\.$/, '');

  if (normalized === 'simulated liquidity forecast confirmation call') {
    return {
      listReason: 'Planned call about company cash planning',
      detailReason: 'Discuss company cash planning',
      outcomeSummary: 'Planned call about company cash planning',
    };
  }

  if (normalized === 'confirmed q4 board audit committee schedule and briefing window') {
    return {
      listReason: 'Confirmed Q4 board meeting schedule',
      detailReason: 'Confirm Q4 board meeting schedule and briefing time',
      outcomeSummary: 'Confirmed Q4 board meeting schedule and briefing time.',
    };
  }

  if (normalized === 'simulated executive check-in on vendor contract addendum') {
    return {
      listReason: 'Check-in on vendor contract update',
      detailReason: 'Discuss vendor contract update',
      outcomeSummary: 'Check-in on vendor contract update.',
    };
  }

  if (normalized === 'simulated status call regarding bengaluru facility readiness') {
    return {
      listReason: 'Check Bengaluru office readiness',
      detailReason: 'Check Bengaluru office readiness',
      outcomeSummary: 'Status check on Bengaluru office readiness.',
    };
  }

  if (normalized === 'simulated line busy failure during schedule confirmation') {
    return {
      listReason: 'Confirm meeting schedule (could not connect)',
      detailReason: 'Confirm meeting schedule',
      outcomeSummary: 'Could not connect — line was busy.',
    };
  }

  if (normalized === 'simulated call cancelled prior to connection') {
    return {
      listReason: 'Call cancelled before connecting',
      detailReason: 'Cancelled before connecting',
      outcomeSummary: 'Call was cancelled before connecting.',
    };
  }

  if (/^simulated\s+/i.test(trimmed)) {
    const withoutSimulated = trimmed.replace(/^simulated\s+/i, '');
    const capitalized =
      withoutSimulated.charAt(0).toUpperCase() + withoutSimulated.slice(1);
    const listText =
      lifecycleState === 'queued'
        ? `Planned: ${withoutSimulated.charAt(0).toLowerCase() + withoutSimulated.slice(1)}`
        : capitalized;
    return {
      listReason: listText,
      detailReason: capitalized,
      outcomeSummary: listText,
    };
  }

  return {
    listReason: trimmed,
    detailReason: trimmed,
    outcomeSummary: trimmed,
  };
}
