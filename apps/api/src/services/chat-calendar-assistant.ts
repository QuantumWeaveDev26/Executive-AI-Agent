import {
  GoogleCalendarCancelEventInput,
  GoogleCalendarCreateEventInput,
  GoogleCalendarEvent,
  GoogleCalendarEventOrigin,
  GoogleCalendarReminders,
  GoogleCalendarRescheduleEventInput
} from '@thaara/contracts';
import {
  AuthenticatedScope,
  ConversationMessageRepository,
  TransactionalDbClient
} from '@thaara/db';
import { AppError, ForbiddenError } from '@thaara/observability';
import { PolicyGateway, defaultPolicyGateway } from '@thaara/policy';
import { ChatAutomationStepSummary } from './chat-automation-orchestrator.js';
import {
  cancelGovernedCalendarMutation,
  createGovernedCalendarMutation,
  findLatestCalendarMutationPlan,
  normalizeAttendeeList
} from './calendar-mutation-governance.js';
import type { GmailFoundation } from './gmail.js';
import {
  DEFAULT_CALENDAR_REMINDERS,
  GOOGLE_CALENDAR_CANCEL_EVENT_ACTION,
  GOOGLE_CALENDAR_CREATE_EVENT_ACTION,
  GOOGLE_CALENDAR_RESCHEDULE_EVENT_ACTION,
  GoogleCalendarFoundation,
  computeCalendarRangeWindowInTimeZone,
  formatCalendarRemindersSummary,
  formatLocalDateInTimeZone,
  getZonedHourMs,
  validateIanaTimeZone
} from './google-calendar.js';
import type { JobQueueService } from '../routes/jobs.js';

export type CalendarDateRangePreset = 'today' | 'tomorrow' | 'next_7_days' | 'prev_7_days';
export type CalendarChatPartOfDay = 'all_day' | 'morning' | 'afternoon' | 'evening';

export type CalendarChatIntentKind =
  | 'agenda_read'
  | 'free_busy_check'
  | 'create_event'
  | 'create_event_from_gmail_explicit'
  | 'reschedule_event'
  | 'cancel_event'
  | 'cancel_pending_mutation';

export interface CalendarCreateEventDraft {
  summary: string;
  personName?: string;
  targetDate: 'today' | 'tomorrow' | string | null;
  startHour: number | null;
  startMinute: number | null;
  durationMinutes: number;
  durationWasDefaulted?: boolean;
  endHour?: number | null;
  endMinute?: number | null;
  attendees: string[];
  explicitInviteRequestedWithoutEmail?: boolean;
  location?: string;
  description?: string;
  sendUpdates?: 'all' | 'none';
  reminders: GoogleCalendarReminders;
  reminderWasExplicit?: boolean;
  origin?: GoogleCalendarEventOrigin;
}

export interface CalendarExplicitGmailEventDraft {
  emailQuery: string;
  targetDate: 'today' | 'tomorrow' | string | null;
  reminders: GoogleCalendarReminders;
}

export interface CalendarRescheduleEventDraft {
  targetDate: 'today' | 'tomorrow' | string | null;
  sourceHour: number | null;
  sourceMinute: number | null;
  newTargetDate?: 'today' | 'tomorrow' | string | null;
  newHour: number | null;
  newMinute: number | null;
  durationMinutes?: number;
  titleQuery?: string;
  disambiguationIndex?: number;
  sendUpdates?: 'all' | 'none';
  reminders?: GoogleCalendarReminders;
}

export interface CalendarCancelEventDraft {
  targetDate: 'today' | 'tomorrow' | string | null;
  sourceHour: number | null;
  sourceMinute: number | null;
  titleQuery?: string;
  disambiguationIndex?: number;
  sendUpdates?: 'all' | 'none';
}

export interface CalendarChatIntent {
  kind: CalendarChatIntentKind;
  range: CalendarDateRangePreset;
  partOfDay: CalendarChatPartOfDay;
  timeZone: string;
  createDraft?: CalendarCreateEventDraft;
  explicitGmailDraft?: CalendarExplicitGmailEventDraft;
  rescheduleDraft?: CalendarRescheduleEventDraft;
  cancelDraft?: CalendarCancelEventDraft;
}

export interface ChatCalendarExecutionOutcome {
  handled: boolean;
  status: 'completed' | 'disconnected' | 'failed' | 'awaiting_approval';
  responseText: string;
  planId?: string | null;
  planStatus?: string | null;
  approvalId?: string | null;
  steps?: ChatAutomationStepSummary[];
}

const DEFAULT_CHAT_CALENDAR_TIMEZONE = 'Asia/Kolkata';
const DEFAULT_MEETING_DURATION_MINUTES = 30;

const EXPLICIT_TIMEZONES = [
  'Asia/Kolkata',
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney'
] as const;

function detectExplicitTimeZone(text: string): string {
  for (const tz of EXPLICIT_TIMEZONES) {
    const escaped = tz.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(text)) {
      return tz;
    }
  }
  if (/\bIST\b/.test(text)) {
    return 'Asia/Kolkata';
  }
  return DEFAULT_CHAT_CALENDAR_TIMEZONE;
}

function getLocalPartsAtEpoch(epochMs: number, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(epochMs));
  const num = (type: string) =>
    Number.parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  return {
    year: num('year'),
    month: num('month'),
    day: num('day'),
    hour: num('hour') % 24,
    minute: num('minute'),
    second: num('second')
  };
}

export function formatZonedRfc3339(epochMs: number, timeZone: string): string {
  const tz = validateIanaTimeZone(timeZone);
  const parts = getLocalPartsAtEpoch(epochMs, tz);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  const offsetMinutes = Math.round((localAsUtc - epochMs) / 60000);
  const suffix =
    offsetMinutes === 0
      ? 'Z'
      : `${offsetMinutes >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0')}:${String(Math.abs(offsetMinutes) % 60).padStart(2, '0')}`;
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}${suffix}`;
}

export function resolveLocalDateYmd(
  targetDate: 'today' | 'tomorrow' | string,
  timeZone: string,
  nowMs = Date.now()
): { year: number; month: number; day: number; isoDate: string } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    const [y, m, d] = targetDate.split('-').map((n) => Number.parseInt(n, 10));
    return { year: y!, month: m!, day: d!, isoDate: targetDate };
  }
  const preset = targetDate === 'tomorrow' ? 'tomorrow' : 'today';
  const win = computeCalendarRangeWindowInTimeZone(preset, timeZone, nowMs);
  const [y, m, d] = win.localStartDate.split('-').map((n) => Number.parseInt(n, 10));
  return { year: y!, month: m!, day: d!, isoDate: win.localStartDate };
}

interface ParsedClockTime {
  hour: number;
  minute: number;
  matchedText: string;
}

function parseClockTimeExpression(
  rawHour: string,
  rawMin: string | undefined,
  rawMeridiem: string | undefined,
  contextText = ''
): { hour: number; minute: number } | null {
  let hour = Number.parseInt(rawHour, 10);
  const minute = rawMin ? Number.parseInt(rawMin, 10) : 0;
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null;
  }
  const mer = rawMeridiem?.toLowerCase().replace(/\./g, '');
  if (mer === 'pm') {
    if (hour < 1 || hour > 12) return null;
    if (hour !== 12) hour += 12;
  } else if (mer === 'am') {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
  } else {
    if (hour < 0 || hour > 23) {
      return null;
    }
    // When meridiem is omitted on a 1..11 hour (e.g. "today at 6"), infer sensibly from context or standard scheduling hours
    if (!rawMin && hour >= 1 && hour <= 11) {
      if (/\bmorning\b/i.test(contextText)) {
        // keep AM
      } else if (/\b(?:afternoon|evening|tonight|night)\b/i.test(contextText)) {
        hour += 12;
      } else if (hour >= 1 && hour <= 7) {
        hour += 12;
      }
    }
  }
  return { hour, minute };
}

function extractAllClockTimes(text: string): ParsedClockTime[] {
  const results: ParsedClockTime[] = [];
  const regex =
    /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b|\b(?:at|from|to)\s+([01]?\d|2[0-3]):(\d{2})\b|\b(?:at|from|to)\s+(\d{1,2})\b(?!\s*(?:minutes?|mins?|m\b|hours?|hrs?|h\b|days?|am|pm|a\.m\.|p\.m\.|:))/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      const parsed = parseClockTimeExpression(match[1], match[2], match[3], text);
      if (parsed) {
        results.push({ ...parsed, matchedText: match[0] });
      }
    } else if (match[4] && match[5]) {
      const parsed = parseClockTimeExpression(match[4], match[5], undefined, text);
      if (parsed) {
        results.push({ ...parsed, matchedText: match[0] });
      }
    } else if (match[6]) {
      const parsed = parseClockTimeExpression(match[6], undefined, undefined, text);
      if (parsed) {
        results.push({ ...parsed, matchedText: match[0] });
      }
    }
  }
  return results;
}

function extractTargetDateToken(text: string): 'today' | 'tomorrow' | string | null {
  const isoMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch?.[1]) return isoMatch[1];
  if (/\b(?:tomorrow|naale|nale)\b/i.test(text)) return 'tomorrow';
  if (/\b(?:today|tonight|ivattu|ivathu)\b/i.test(text)) return 'today';
  return null;
}

function extractDurationMinutes(text: string): number | null {
  const minMatch = text.match(
    /\b(?:for|duration(?:\s+of)?|make\s+it)\s+(\d{1,3})\s*(?:minutes?|mins?|m)\b/i
  );
  if (minMatch?.[1]) {
    const mins = Number.parseInt(minMatch[1], 10);
    if (mins >= 5 && mins <= 720) return mins;
  }
  const hrMinMatch = text.match(
    /\b(?:for|duration(?:\s+of)?|make\s+it)\s+(\d{1,2})(?:\.5)?\s*(?:hours?|hrs?|h)(?:\s*(?:and\s+)?(\d{1,2})\s*(?:minutes?|mins?))?\b/i
  );
  if (hrMinMatch?.[1]) {
    const isHalf = /\.5\s*(?:hours?|hrs?|h)/i.test(hrMinMatch[0]);
    const hours = Number.parseInt(hrMinMatch[1], 10);
    const extraMins = hrMinMatch[2] ? Number.parseInt(hrMinMatch[2], 10) : isHalf ? 30 : 0;
    const total = hours * 60 + extraMins;
    if (total >= 5 && total <= 720) return total;
  }
  return null;
}

export function extractReminderFromText(text: string): {
  reminders: GoogleCalendarReminders;
  explicit: boolean;
} {
  if (
    /\b(?:no\s+reminders?|without\s+(?:a\s+)?reminders?|don'?t\s+remind|do\s+not\s+remind|disable\s+reminders?)\b/i.test(
      text
    )
  ) {
    return {
      reminders: { useDefault: false, overrides: [] },
      explicit: true
    };
  }
  if (/\b(?:use\s+default\s+reminders?|default\s+calendar\s+reminders?|google\s+default\s+reminders?)\b/i.test(text)) {
    return {
      reminders: { useDefault: true },
      explicit: true
    };
  }
  const minBeforeMatch =
    text.match(
      /\b(?:remind(?:\s+me|\s+madi|\s+maadi)?|reminder(?:\s+for|\s+to)?|alert\s+me)\s+(?:at\s+)?(\d{1,4})\s*(?:minutes?|mins?|m)\s*(?:before|prior|early|earlier)?\b/i
    ) ??
    text.match(
      /\b(\d{1,4})\s*(?:minutes?|mins?|-minute)\s*(?:before\s+)?(?:popup\s+)?(?:reminder|alert)\b/i
    ) ??
    text.match(
      /\b(\d{1,4})\s*(?:minutes?|mins?)\s+before\b[\s\S]{0,30}\b(?:remind|reminder|alert)\b/i
    );
  if (minBeforeMatch?.[1]) {
    const minutes = Number.parseInt(minBeforeMatch[1], 10);
    if (minutes >= 0 && minutes <= 40320) {
      return {
        reminders: {
          useDefault: false,
          overrides: [{ method: 'popup', minutes }]
        },
        explicit: true
      };
    }
  }
  const hourBeforeMatch = text.match(
    /\b(?:remind(?:\s+me|\s+madi|\s+maadi)?|reminder)\s+(\d{1,2})\s*(?:hours?|hrs?)\s*(?:before|prior|early|earlier)?\b/i
  );
  if (hourBeforeMatch?.[1]) {
    const hours = Number.parseInt(hourBeforeMatch[1], 10);
    const minutes = hours * 60;
    if (minutes >= 0 && minutes <= 40320) {
      return {
        reminders: {
          useDefault: false,
          overrides: [{ method: 'popup', minutes }]
        },
        explicit: true
      };
    }
  }
  if (/\b(?:remind\s+me|remind\s+madi|remind\s+maadi|nenapu\s+madi|with\s+(?:a\s+)?reminder|set\s+(?:a\s+)?reminder)\b/i.test(text)) {
    return {
      reminders: DEFAULT_CALENDAR_REMINDERS,
      explicit: true
    };
  }
  return {
    reminders: DEFAULT_CALENDAR_REMINDERS,
    explicit: false
  };
}

function extractAttendeesFromText(text: string): string[] {
  const emails =
    text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  return normalizeAttendeeList(emails);
}

function detectExplicitInviteWithoutEmail(text: string, attendees: string[]): boolean {
  if (attendees.length > 0) return false;
  return /\b(?:invite\s+[A-Za-z]+|send\s+(?:an?\s+)?(?:calendar\s+)?(?:invite|invitation)\s+to\s+[A-Za-z]+)\b/i.test(
    text
  );
}

function extractSendUpdatesPreference(text: string, hasGuests: boolean): 'all' | 'none' {
  if (
    /\b(?:without\s+notifying|don'?t\s+notify|do\s+not\s+notify|no\s+notifications?|silently)\b/i.test(
      text
    )
  ) {
    return 'none';
  }
  if (/\b(?:notify\s+(?:guests?|attendees?|everyone)|send\s+(?:invites?|invitations?|updates?))\b/i.test(text)) {
    return 'all';
  }
  return hasGuests ? 'all' : 'none';
}

function extractDisambiguationIndex(text: string): number | undefined {
  const hashMatch = text.match(/(?:#|option\s+|number\s+|meeting\s+)([1-9]\d?)\b/i);
  if (hashMatch?.[1]) return Number.parseInt(hashMatch[1], 10);
  const bareMatch = text.trim().match(/^#?([1-9]\d?)$/);
  if (bareMatch?.[1]) return Number.parseInt(bareMatch[1], 10);
  if (/\b(?:the\s+)?first(?:\s+one|\s+meeting)?\b/i.test(text)) return 1;
  if (/\b(?:the\s+)?second(?:\s+one|\s+meeting)?\b/i.test(text)) return 2;
  if (/\b(?:the\s+)?third(?:\s+one|\s+meeting)?\b/i.test(text)) return 3;
  return undefined;
}

function formatPersonDisplayName(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((word) => (word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : ''))
    .join(' ');
}

function extractMeetingTitleAndPersonForCreate(text: string): {
  summary: string;
  personName?: string;
} {
  const quoted = text.match(/"([^"\r\n]{2,120})"/);
  if (quoted?.[1]?.trim()) {
    return { summary: quoted[1].trim() };
  }

  // Match "meeting with/wit/wid/w/ <Person>"
  const withPersonMatch = text.match(
    /\b(?:meeting|appointment|call|sync)\s+(?:with|wit|wid|w\/|jothe)\s+([A-Za-z][A-Za-z0-9 .'-]{0,50}?)(?=\s+(?:today|tomorrow|tonight|ivattu|ivathu|naale|nale|on\s+20\d{2}|at\s+\d|from\s+\d|for\s+\d|save\b|and\b|remind\b|please\b|in\s+Asia\/|in\s+UTC|ide\b|madi\b|maadi\b)|[.,;!?]|$)/i
  );
  if (withPersonMatch?.[1]?.trim() && !withPersonMatch[1].includes('@')) {
    const cleanedPerson = withPersonMatch[1]
      .replace(/\b(?:save\s+it|save|remind\s+me|remind|today|tomorrow|ivattu|naale)\b.*$/i, '')
      .trim();
    if (cleanedPerson && !/^(?:me|my|us|our|team|calendar|google)$/i.test(cleanedPerson)) {
      const personName = formatPersonDisplayName(cleanedPerson);
      return {
        summary: `Meeting with ${personName}`,
        personName
      };
    }
  }

  // Match Kanglish "<Person> jothe meeting"
  const jotheMatch = text.match(
    /\b([A-Za-z][A-Za-z0-9 .'-]{1,40}?)\s+jothe\s+(?:meeting|appointment|call|sync)\b/i
  );
  if (jotheMatch?.[1]?.trim()) {
    const tokens = jotheMatch[1]
      .trim()
      .split(/\s+/)
      .filter(
        (tok) =>
          !/^(?:thaara|ivattu|ivathu|naale|nale|today|tomorrow|tonight|am|pm|a\.m\.|p\.m\.|at|\d+)$/i.test(
            tok
          )
      );
    if (tokens.length > 0) {
      const personName = formatPersonDisplayName(tokens.join(' '));
      return {
        summary: `Meeting with ${personName}`,
        personName
      };
    }
  }

  const named = text.match(
    /\b(?:called|titled|named|about|regarding|for)\s+([A-Za-z0-9][A-Za-z0-9 &/_:-]{1,80}?)(?=\s+(?:today|tomorrow|ivattu|naale|on\s+20\d{2}|at\s+\d|from\s+\d|for\s+\d+\s*(?:min|hour|hr)|with\s+\S+@|in\s+Asia\/|in\s+UTC|save\b|and\s+remind\b)|[.,;!?]|$)/i
  );
  if (named?.[1]?.trim() && !/^\d+\s*(?:minutes?|mins?|hours?|hrs?)$/i.test(named[1].trim())) {
    return { summary: named[1].trim() };
  }
  const direct = text.match(
    /\b(?:schedule|book|create|add|set\s+up|save)\s+(?:a\s+|an\s+)?([A-Za-z0-9][A-Za-z0-9 &/_-]{1,60}?)\s+(?:meeting|call|sync|appointment)\b/i
  );
  if (
    direct?.[1]?.trim() &&
    !/^(?:new|my|our|google|calendar|quick|short|team)$/i.test(direct[1].trim())
  ) {
    return {
      summary: `${direct[1].trim()} Meeting`.replace(/\s+Meeting\s+Meeting$/i, ' Meeting')
    };
  }
  return { summary: 'Meeting' };
}

function extractTitleFilterForExistingEvent(text: string): string | undefined {
  const quoted = text.match(/"([^"\r\n]{2,120})"/);
  if (quoted?.[1]?.trim()) {
    return quoted[1].trim();
  }
  const withPerson = text.match(
    /\b(?:meeting|appointment|call|sync|event)\s+(?:with|wit|wid|w\/|jothe)\s+([A-Za-z][A-Za-z0-9 .'-]{1,40}?)(?=\s+(?:to|at|on|today|tomorrow|ivattu|naale|and\b|without\b)|[.,;!?]|$)/i
  );
  if (withPerson?.[1]?.trim()) {
    return withPerson[1].trim();
  }
  const afterMy = text.match(
    /\b(?:move|reschedule|cancel|delete|remove)\s+(?:my\s+|the\s+|our\s+)?(?:\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)\s+)?([A-Za-z][A-Za-z0-9 &/_-]{1,60}?)\s+(?:meeting|call|sync|appointment|event)\b/i
  );
  if (afterMy?.[1]?.trim()) {
    const candidate = afterMy[1].trim();
    if (
      !/^(?:my|the|our|a|an|this|that|current|scheduled|today|tomorrow|ivattu|naale|morning|afternoon|evening|upcoming|next|google|calendar)$/i.test(
        candidate
      )
    ) {
      return candidate;
    }
  }
  const calledMatch = text.match(
    /\b(?:meeting|event|appointment|call)\s+(?:called|titled|named|about)\s+([A-Za-z0-9][A-Za-z0-9 &/_-]{1,60}?)(?=\s+(?:to|at|on|today|tomorrow|and\b|without\b)|$)/i
  );
  if (calledMatch?.[1]?.trim()) {
    return calledMatch[1].trim();
  }
  return undefined;
}

export function detectCalendarChatRequest(userMessage: string): CalendarChatIntent | null {
  const normalized = userMessage.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > 600) return null;

  // Do not intercept n8n workflow/blueprint generation requests handled by chat-automation-orchestrator
  if (
    /\b(?:workflow|blueprint|n8n|automation)\b/i.test(normalized) &&
    /\b(?:prepare|create|build|generate|make|setup|set\s+up)\b/i.test(normalized)
  ) {
    return null;
  }

  const timeZone = detectExplicitTimeZone(normalized);

  // 0a. Detect explicit owner command to check a specific Gmail/email and add that meeting to Calendar
  const isExplicitGmailToCalendarCommand =
    /\b(?:gmail|emails?|mail|inbox)\b/i.test(normalized) &&
    /\b(?:add|save|schedule|create|put)\b[\s\S]{0,60}\b(?:meeting|appointment|event|calendar)\b/i.test(
      normalized
    );

  if (isExplicitGmailToCalendarCommand) {
    const fromPossessive = normalized.match(
      /\b(?:check|read|find|use|from)\s+([A-Za-z][A-Za-z0-9 .'-]{1,40}?)(?:'s|\s+s)?\s+(?:gmail|email|mail)\b/i
    );
    const emailFrom = normalized.match(
      /\b(?:email|mail)\s+from\s+([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|[A-Za-z][A-Za-z0-9 .'-]{1,40}?)(?=\s+(?:and|to|about|on|in)|[.,;!?]|$)/i
    );
    const emailQuery = (fromPossessive?.[1] ?? emailFrom?.[1] ?? 'meeting').trim();
    const { reminders } = extractReminderFromText(normalized);
    const targetDate = extractTargetDateToken(normalized);
    return {
      kind: 'create_event_from_gmail_explicit',
      range: targetDate === 'tomorrow' ? 'tomorrow' : 'today',
      partOfDay: 'all_day',
      timeZone,
      explicitGmailDraft: {
        emailQuery,
        targetDate,
        reminders
      }
    };
  }

  // Do not intercept other Gmail commands
  if (
    /\b(?:gmail|email|emails|inbox|mail)\b/i.test(normalized) &&
    !/\b(?:calendar|meeting|meetings|appointment|appointments|reschedule)\b/i.test(normalized)
  ) {
    return null;
  }

  // Do not intercept general workload/prioritization advice prompts
  if (/\b(?:hectic|prioriti[sz]e|deadlines?|overwhelm(?:ed)?)\b/i.test(normalized)) {
    return null;
  }

  // 0b. Cancel pending calendar draft / proposal
  if (
    /^(?:please\s+)?(?:cancel|discard|abort|drop)\s+(?:the\s+|my\s+)?(?:pending|prepared|staged)\s+(?:meeting|calendar|reschedule|cancellation)\b/i.test(
      normalized
    )
  ) {
    return {
      kind: 'cancel_pending_mutation',
      range: 'today',
      partOfDay: 'all_day',
      timeZone
    };
  }

  // 1. Detect Reschedule / Move meeting or Update existing meeting reminder intent
  const isRescheduleCommand =
    /\b(?:reschedule|move|shift|push\s+back|change\s+the\s+time\s+of|postpone)\b[\s\S]{0,80}\b(?:meeting|appointment|event|call|sync)\b/i.test(
      normalized
    ) ||
    /\b(?:meeting|appointment|event|call|sync)\b[\s\S]{0,60}\b(?:move|reschedule|postpone|shift)\s+(?:madi|maadi)\b/i.test(
      normalized
    ) ||
    /\b(?:reschedule|move)\s+(?:my\s+|the\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)/i.test(
      normalized
    ) ||
    /\b(?:change|update|edit)\s+(?:the\s+)?reminder\s+(?:for|on)\s+(?:my\s+|the\s+)?(?:meeting|appointment|event|call)\b/i.test(
      normalized
    );

  if (isRescheduleCommand) {
    const times = extractAllClockTimes(normalized);
    const toTimeMatch = normalized.match(
      /\bto\s+(?:(?:today|tomorrow|ivattu|naale|20\d{2}-\d{2}-\d{2})\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b(?!\s*(?:minutes?|mins?|hours?|hrs?))/i
    );
    const parsedToTime = toTimeMatch?.[1]
      ? parseClockTimeExpression(toTimeMatch[1], toTimeMatch[2], toTimeMatch[3], normalized)
      : times.length >= 2
        ? { hour: times[times.length - 1]!.hour, minute: times[times.length - 1]!.minute }
        : times.length === 1 && /\bto\s+\d/i.test(normalized)
          ? { hour: times[0]!.hour, minute: times[0]!.minute }
          : null;

    const sourceTime =
      times.length >= 2
        ? { hour: times[0]!.hour, minute: times[0]!.minute }
        : times.length === 1 && !/\bto\s+\d/i.test(normalized)
          ? { hour: times[0]!.hour, minute: times[0]!.minute }
          : null;

    const targetDate = extractTargetDateToken(normalized);
    const durationMinutes = extractDurationMinutes(normalized) ?? undefined;
    const titleQuery = extractTitleFilterForExistingEvent(normalized);
    const disambiguationIndex = extractDisambiguationIndex(normalized);
    const extractedReminder = extractReminderFromText(normalized);

    return {
      kind: 'reschedule_event',
      range: targetDate === 'tomorrow' ? 'tomorrow' : 'today',
      partOfDay: 'all_day',
      timeZone,
      rescheduleDraft: {
        targetDate,
        sourceHour: sourceTime?.hour ?? null,
        sourceMinute: sourceTime?.minute ?? null,
        newTargetDate: targetDate,
        newHour: parsedToTime?.hour ?? null,
        newMinute: parsedToTime?.minute ?? null,
        ...(durationMinutes ? { durationMinutes } : {}),
        ...(titleQuery ? { titleQuery } : {}),
        ...(disambiguationIndex ? { disambiguationIndex } : {}),
        ...(extractedReminder.explicit ? { reminders: extractedReminder.reminders } : {})
      }
    };
  }

  // 2. Detect Cancel / Delete meeting intent
  const isCancelMeetingCommand =
    /\b(?:cancel|delete|remove|call\s+off)\b[\s\S]{0,80}\b(?:my\s+|the\s+|our\s+)?(?:[A-Za-z0-9 &/_"-]{0,40}\s+)?(?:meeting|appointment|event|call|sync)\b/i.test(
      normalized
    ) ||
    /\b(?:meeting|appointment|event|call|sync)\b[\s\S]{0,60}\b(?:cancel|delete|remove)\s+(?:madi|maadi)\b/i.test(
      normalized
    );

  if (isCancelMeetingCommand) {
    const times = extractAllClockTimes(normalized);
    const sourceTime = times[0] ?? null;
    const targetDate = extractTargetDateToken(normalized);
    const titleQuery = extractTitleFilterForExistingEvent(normalized);
    const disambiguationIndex = extractDisambiguationIndex(normalized);
    const hasExplicitNotify =
      /\b(?:without\s+notifying|don'?t\s+notify|do\s+not\s+notify|notify\s+guests|notify\s+attendees)\b/i.test(
        normalized
      );

    return {
      kind: 'cancel_event',
      range: targetDate === 'tomorrow' ? 'tomorrow' : 'today',
      partOfDay: 'all_day',
      timeZone,
      cancelDraft: {
        targetDate,
        sourceHour: sourceTime?.hour ?? null,
        sourceMinute: sourceTime?.minute ?? null,
        ...(titleQuery ? { titleQuery } : {}),
        ...(disambiguationIndex ? { disambiguationIndex } : {}),
        ...(hasExplicitNotify
          ? { sendUpdates: extractSendUpdatesPreference(normalized, true) }
          : {})
      }
    };
  }

  // 3. Detect Create / Schedule / Save meeting intent
  const isReadQuestionPrefix =
    /^(?:thaara[\s,:]*)?(?:what|which|when|do\s+i\s+have|am\s+i|show|list|check|read)\b/i.test(
      normalized
    ) && !/\b(?:save|add|schedule|book|create|remind)\b/i.test(normalized);

  const isCreateMeetingCommand =
    !isReadQuestionPrefix &&
    (/\b(?:schedule|book|create|add|set\s+up|arrange|organize|plan|save|keep|note)\b[\s\S]{0,80}\b(?:a\s+|an\s+|new\s+|my\s+|our\s+)?(?:[A-Za-z0-9 &/_"-]{0,40}\s+)?(?:meeting|appointment|event|call|sync)\b/i.test(
      normalized
    ) ||
      /\b(?:meeting|appointment|event|call|sync)\b[\s\S]{0,80}\b(?:save|add|schedule|book|create|remind\s+me|save\s+madi|save\s+maadi|add\s+madi|add\s+maadi|schedule\s+madi|remind\s+madi|remind\s+maadi|nenapu\s+madi)\b/i.test(
        normalized
      ) ||
      /\b(?:i\s+have|i've\s+got|i\s+got)\s+(?:a\s+|an\s+)?(?:meeting|appointment|call|sync)\b[\s\S]{0,80}\b(?:save|add|remind|schedule|at\s+\d|\d{1,2}\s*(?:am|pm))\b/i.test(
        normalized
      ) ||
      /\b(?:today|tomorrow|tonight|ivattu|ivathu|naale|nale|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b[\s\S]{0,50}\b(?:meeting|appointment|call|sync)\s+(?:with|wit|wid|w\/|jothe)\s+[A-Za-z]/i.test(
        normalized
      ) ||
      /\b[A-Za-z]+\s+jothe\s+(?:meeting|appointment|call)\b[\s\S]{0,50}\b(?:save|add|schedule|remind|ide)\b/i.test(
        normalized
      ) ||
      /\b(?:put|add|save)\s+["']?[^"'\r\n]{2,60}["']?\s+(?:on|to|in)\s+my\s+calendar\b/i.test(
        normalized
      ));

  if (isCreateMeetingCommand) {
    const times = extractAllClockTimes(normalized);
    const startTime = times[0] ?? null;
    const rangeEndTime =
      times.length >= 2 && /\b(?:from|between)\b[\s\S]+\b(?:to|and|-)\b/i.test(normalized)
        ? times[1]
        : null;
    const targetDate = extractTargetDateToken(normalized);
    const explicitDuration = extractDurationMinutes(normalized);
    const durationMinutes = explicitDuration ?? DEFAULT_MEETING_DURATION_MINUTES;
    const durationWasDefaulted = explicitDuration === null && !rangeEndTime;
    const attendees = extractAttendeesFromText(normalized);
    const explicitInviteRequestedWithoutEmail = detectExplicitInviteWithoutEmail(
      normalized,
      attendees
    );
    const { summary, personName } = extractMeetingTitleAndPersonForCreate(normalized);
    const sendUpdates = extractSendUpdatesPreference(normalized, attendees.length > 0);
    const extractedReminder = extractReminderFromText(normalized);

    return {
      kind: 'create_event',
      range: targetDate === 'tomorrow' ? 'tomorrow' : 'today',
      partOfDay: 'all_day',
      timeZone,
      createDraft: {
        summary,
        ...(personName ? { personName } : {}),
        targetDate,
        startHour: startTime?.hour ?? null,
        startMinute: startTime?.minute ?? null,
        durationMinutes,
        durationWasDefaulted,
        ...(rangeEndTime ? { endHour: rangeEndTime.hour, endMinute: rangeEndTime.minute } : {}),
        attendees,
        ...(explicitInviteRequestedWithoutEmail
          ? { explicitInviteRequestedWithoutEmail: true }
          : {}),
        sendUpdates,
        reminders: extractedReminder.reminders,
        reminderWasExplicit: extractedReminder.explicit,
        origin: 'thaara_chat'
      }
    };
  }

  // 4. Read-only availability & agenda intents (Step 107)
  let partOfDay: CalendarChatPartOfDay = 'all_day';
  if (/\bmorning\b/i.test(normalized)) {
    partOfDay = 'morning';
  } else if (/\bafternoon\b/i.test(normalized)) {
    partOfDay = 'afternoon';
  } else if (/\b(?:evening|tonight)\b/i.test(normalized)) {
    partOfDay = 'evening';
  }

  let range: CalendarDateRangePreset | null = null;
  if (/\b(?:next\s+7\s+days|next\s+seven\s+days|upcoming\s+7\s+days)\b/i.test(normalized)) {
    range = 'next_7_days';
  } else if (
    /\b(?:prev(?:ious)?\s+7\s+days|last\s+7\s+days|past\s+7\s+days)\b/i.test(normalized)
  ) {
    range = 'prev_7_days';
  } else if (/\b(?:tomorrow|naale|nale)\b/i.test(normalized)) {
    range = 'tomorrow';
  } else if (/\b(?:today|tonight|ivattu|ivathu)\b/i.test(normalized)) {
    range = 'today';
  }

  const isAvailabilityQuestion =
    /\b(?:am\s+i\s+(?:free|available|busy)|do\s+i\s+have\s+free\s+time|check\s+(?:my\s+)?availability|when\s+am\s+i\s+free)\b/i.test(
      normalized
    );

  if (isAvailabilityQuestion) {
    return {
      kind: 'free_busy_check',
      range: range ?? 'today',
      partOfDay,
      timeZone
    };
  }

  const isExplicitSummarizeRange =
    /\b(?:summarize|summary\s+of)\s+(?:my\s+)?(?:next\s+7\s+days|previous\s+7\s+days|last\s+7\s+days|calendar|meetings?|schedule|agenda)\b/i.test(
      normalized
    );

  if (isExplicitSummarizeRange) {
    return {
      kind: 'agenda_read',
      range: range ?? 'next_7_days',
      partOfDay,
      timeZone
    };
  }

  const isExplicitCalendarRead =
    /\b(?:what\s+(?:meetings?|events?|appointments?)\s+do\s+i\s+have|what(?:'s|\s+is|\s+are)\s+on\s+my\s+(?:calendar|schedule|agenda)|show\s+(?:me\s+)?(?:my\s+)?(?:calendar|meetings?|schedule|agenda|events?|appointments?)|list\s+(?:my\s+)?(?:calendar|meetings?|schedule|agenda|events?|appointments?)|check\s+(?:my\s+)?(?:calendar|meetings?|schedule|agenda)|read\s+(?:my\s+)?(?:calendar|meetings?|schedule|agenda)|do\s+i\s+have\s+(?:any\s+)?(?:meetings?|events?|appointments?)|(?:meetings?|calendar|schedule)\s+(?:torisi|thorisi))\b/i.test(
      normalized
    );

  if (isExplicitCalendarRead) {
    return {
      kind: 'agenda_read',
      range: range ?? 'today',
      partOfDay,
      timeZone
    };
  }

  return null;
}

/**
 * Resolves single-turn or multi-turn Calendar chat commands (e.g., when Thaara previously asked
 * for a missing time/date or asked the user to disambiguate between #1 and #2).
 */
export async function resolveCalendarChatRequest(
  scope: AuthenticatedScope,
  userMessage: string,
  options: {
    db?: TransactionalDbClient;
    conversationId?: string;
  } = {}
): Promise<CalendarChatIntent | null> {
  const direct = detectCalendarChatRequest(userMessage);
  if (direct) return direct;

  if (!options.db || !options.conversationId) return null;
  const trimmed = userMessage.trim();
  if (!trimmed || trimmed.length > 240) return null;

  const messageRepo = new ConversationMessageRepository(options.db);
  const recent = await messageRepo.listByConversation(scope, options.conversationId, { limit: 6 });
  if (recent.length < 2) return null;

  // Find the most recent assistant message and the user message right before it
  let lastAssistantIdx = -1;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i]!.sender_type === 'assistant') {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx <= 0) return null;
  const lastAssistantText = recent[lastAssistantIdx]!.content ?? '';
  const prevUserText = recent[lastAssistantIdx - 1]?.content ?? '';

  // Case A: Assistant asked for missing meeting time/date or guest email during create_event
  if (
    /What time should I schedule|When should I schedule the meeting|What email address should I invite/i.test(
      lastAssistantText
    )
  ) {
    const prevIntent = detectCalendarChatRequest(prevUserText);
    if (prevIntent?.kind === 'create_event' && prevIntent.createDraft) {
      const times = extractAllClockTimes(trimmed);
      const newDate = extractTargetDateToken(trimmed) ?? prevIntent.createDraft.targetDate ?? 'today';
      const explicitDuration = extractDurationMinutes(trimmed);
      const newDuration = explicitDuration ?? prevIntent.createDraft.durationMinutes;
      const newAttendees = extractAttendeesFromText(trimmed);
      const extractedReminder = extractReminderFromText(trimmed);
      if (times[0] || newAttendees.length > 0) {
        return {
          ...prevIntent,
          createDraft: {
            ...prevIntent.createDraft,
            targetDate: newDate,
            startHour: times[0]?.hour ?? prevIntent.createDraft.startHour,
            startMinute: times[0]?.minute ?? prevIntent.createDraft.startMinute,
            durationMinutes: newDuration,
            durationWasDefaulted:
              explicitDuration !== null ? false : prevIntent.createDraft.durationWasDefaulted,
            attendees:
              newAttendees.length > 0 ? newAttendees : prevIntent.createDraft.attendees,
            explicitInviteRequestedWithoutEmail: false,
            reminders: extractedReminder.explicit
              ? extractedReminder.reminders
              : prevIntent.createDraft.reminders
          }
        };
      }
    }
  }

  // Case B: Assistant prepared a meeting ("Your meeting ... is ready") and user follows up to adjust duration, reminder, or time
  if (/Your meeting.*is ready/i.test(lastAssistantText)) {
    const prevIntent = detectCalendarChatRequest(prevUserText);
    if (prevIntent?.kind === 'create_event' && prevIntent.createDraft) {
      const times = extractAllClockTimes(trimmed);
      const newDate = extractTargetDateToken(trimmed);
      const explicitDuration = extractDurationMinutes(trimmed);
      const extractedReminder = extractReminderFromText(trimmed);
      if (times[0] || newDate || explicitDuration !== null || extractedReminder.explicit) {
        return {
          ...prevIntent,
          createDraft: {
            ...prevIntent.createDraft,
            targetDate: newDate ?? prevIntent.createDraft.targetDate,
            startHour: times[0]?.hour ?? prevIntent.createDraft.startHour,
            startMinute: times[0]?.minute ?? prevIntent.createDraft.startMinute,
            durationMinutes: explicitDuration ?? prevIntent.createDraft.durationMinutes,
            durationWasDefaulted:
              explicitDuration !== null ? false : prevIntent.createDraft.durationWasDefaulted,
            reminders: extractedReminder.explicit
              ? extractedReminder.reminders
              : prevIntent.createDraft.reminders,
            reminderWasExplicit:
              extractedReminder.explicit || prevIntent.createDraft.reminderWasExplicit
          }
        };
      }
    }
  }

  // Case C: Assistant asked to disambiguate multiple matching meetings (#1, #2, etc.)
  if (/Which (?:one|meeting) would you like to (?:reschedule|cancel)/i.test(lastAssistantText)) {
    const chosenIdx = extractDisambiguationIndex(trimmed);
    const prevIntent = detectCalendarChatRequest(prevUserText);
    if (chosenIdx && prevIntent) {
      if (prevIntent.kind === 'reschedule_event' && prevIntent.rescheduleDraft) {
        return {
          ...prevIntent,
          rescheduleDraft: {
            ...prevIntent.rescheduleDraft,
            disambiguationIndex: chosenIdx
          }
        };
      }
      if (prevIntent.kind === 'cancel_event' && prevIntent.cancelDraft) {
        return {
          ...prevIntent,
          cancelDraft: {
            ...prevIntent.cancelDraft,
            disambiguationIndex: chosenIdx
          }
        };
      }
    }
  }

  return null;
}

function formatFriendlyDateLabel(isoDate: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const utcMidday = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0)
  );
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(utcMidday);
}

function formatFriendlyClockTime(isoTimestamp: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(new Date(isoTimestamp));
}

function formatFriendlyEventTime(ev: GoogleCalendarEvent, timeZone: string): string {
  if (ev.allDay) return 'All day';
  return `${formatFriendlyClockTime(ev.startAt, timeZone)} – ${formatFriendlyClockTime(ev.endAt, timeZone)}`;
}

function formatConnectedCalendarBadge(status: {
  connectedEmail?: string;
  connectedCalendarSummary?: string;
}): string | null {
  if (
    status.connectedEmail &&
    status.connectedCalendarSummary &&
    status.connectedCalendarSummary !== status.connectedEmail
  ) {
    return `Connected Calendar: ${status.connectedCalendarSummary} (${status.connectedEmail})`;
  }
  if (status.connectedEmail) {
    return `Connected Calendar: ${status.connectedEmail}`;
  }
  if (status.connectedCalendarSummary) {
    return `Connected Calendar: ${status.connectedCalendarSummary}`;
  }
  return null;
}

function getPartOfDayWindowBounds(
  localDate: string,
  partOfDay: CalendarChatPartOfDay,
  timeZone: string
): { startMs: number; endMs: number; label: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  const year = Number(match?.[1] ?? 2026);
  const month = Number(match?.[2] ?? 1);
  const day = Number(match?.[3] ?? 1);

  if (partOfDay === 'morning') {
    return {
      startMs: getZonedHourMs(year, month, day, 6, 0, timeZone),
      endMs: getZonedHourMs(year, month, day, 12, 0, timeZone),
      label: 'morning (6:00 AM – 12:00 PM)'
    };
  }
  if (partOfDay === 'afternoon') {
    return {
      startMs: getZonedHourMs(year, month, day, 12, 0, timeZone),
      endMs: getZonedHourMs(year, month, day, 17, 0, timeZone),
      label: 'afternoon (12:00 PM – 5:00 PM)'
    };
  }
  if (partOfDay === 'evening') {
    return {
      startMs: getZonedHourMs(year, month, day, 17, 0, timeZone),
      endMs: getZonedHourMs(year, month, day, 21, 0, timeZone),
      label: 'evening (5:00 PM – 9:00 PM)'
    };
  }
  return {
    startMs: getZonedHourMs(year, month, day, 0, 0, timeZone),
    endMs: getZonedHourMs(year, month, day, 24, 0, timeZone),
    label: 'all day'
  };
}

function describeRangeLabel(range: CalendarDateRangePreset): string {
  switch (range) {
    case 'today':
      return 'today';
    case 'tomorrow':
      return 'tomorrow';
    case 'next_7_days':
      return 'the next 7 days';
    case 'prev_7_days':
      return 'the previous 7 days';
  }
}

function findMatchingCalendarEvents(
  events: GoogleCalendarEvent[],
  filter: {
    sourceHour: number | null;
    sourceMinute: number | null;
    titleQuery?: string;
    timeZone: string;
  }
): GoogleCalendarEvent[] {
  const active = events.filter((ev) => ev.status !== 'cancelled' && !ev.allDay);
  return active.filter((ev) => {
    if (filter.sourceHour !== null) {
      const parts = getLocalPartsAtEpoch(Date.parse(ev.startAt), filter.timeZone);
      const minuteMatches =
        filter.sourceMinute === null || filter.sourceMinute === 0
          ? parts.minute === (filter.sourceMinute ?? 0) || parts.hour === filter.sourceHour
          : parts.minute === filter.sourceMinute;
      if (parts.hour !== filter.sourceHour || !minuteMatches) {
        return false;
      }
      if (filter.sourceMinute !== null && parts.minute !== filter.sourceMinute) {
        return false;
      }
    }
    if (filter.titleQuery) {
      const needle = filter.titleQuery.toLowerCase();
      if (!ev.summary.toLowerCase().includes(needle)) {
        return false;
      }
    }
    return true;
  });
}

async function handleCreateEventChatIntent(
  scope: AuthenticatedScope,
  intent: CalendarChatIntent,
  deps: {
    db?: TransactionalDbClient;
    googleCalendar: GoogleCalendarFoundation;
    conversationId?: string;
    streamId?: string;
    nowMs?: number;
  }
): Promise<ChatCalendarExecutionOutcome> {
  const draft = intent.createDraft!;
  const readiness = await deps.googleCalendar.writeReadiness(scope, 'create');
  if (!readiness.ready || !readiness.connectedCalendar) {
    if (readiness.reason === 'write_permission_missing') {
      return {
        handled: true,
        status: 'failed',
        responseText:
          'Your Google Calendar is connected with read-only access. To schedule meetings, please open the Google Calendar tab, click Disconnect, and reconnect Google Calendar to grant scheduling permission (calendar.events.owned).'
      };
    }
    if (readiness.reason === 'disconnected' || readiness.reason === 'reconnect_required') {
      return {
        handled: true,
        status: 'disconnected',
        responseText:
          'Google Calendar is not connected. Please open the Google Calendar tab and click Connect Google Calendar first.'
      };
    }
    return {
      handled: true,
      status: 'failed',
      responseText: 'Meeting could not be scheduled because Google Calendar is not ready.'
    };
  }

  if (draft.explicitInviteRequestedWithoutEmail && draft.attendees.length === 0) {
    const targetPerson = draft.personName ?? 'the guest';
    return {
      handled: true,
      status: 'completed',
      responseText: `Please share the email address I should invite for ${targetPerson}. (Or if you just want to save "${draft.summary}" on your calendar without sending an email invite, say "save without invite".)`
    };
  }

  if (draft.startHour === null || draft.startMinute === null) {
    const dayHint = draft.targetDate ? ` for ${draft.targetDate}` : '';
    return {
      handled: true,
      status: 'completed',
      responseText: `What time should I schedule "${draft.summary}"${dayHint}? For example, say "tomorrow at 3 PM for 30 minutes".`
    };
  }

  const targetDateToken = draft.targetDate ?? 'today';
  const ymd = resolveLocalDateYmd(targetDateToken, intent.timeZone, deps.nowMs);
  const startMs = getZonedHourMs(
    ymd.year,
    ymd.month,
    ymd.day,
    draft.startHour,
    draft.startMinute,
    intent.timeZone
  );
  const endMs =
    draft.endHour !== undefined &&
    draft.endHour !== null &&
    draft.endMinute !== undefined &&
    draft.endMinute !== null
      ? getZonedHourMs(
          ymd.year,
          ymd.month,
          ymd.day,
          draft.endHour,
          draft.endMinute,
          intent.timeZone
        )
      : startMs + draft.durationMinutes * 60 * 1000;

  if (endMs <= startMs) {
    return {
      handled: true,
      status: 'failed',
      responseText: 'Meeting could not be scheduled because the end time must be after the start time.'
    };
  }

  const startAt = formatZonedRfc3339(startMs, intent.timeZone);
  const endAt = formatZonedRfc3339(endMs, intent.timeZone);
  const conflicts = await deps.googleCalendar.findConflicts(scope, {
    startAt,
    endAt,
    timeZone: intent.timeZone
  });

  if (!deps.db) {
    return {
      handled: true,
      status: 'failed',
      responseText: 'Meeting could not be scheduled right now.'
    };
  }

  // If there was a previous awaiting_approval create plan in this conversation, supersede it cleanly
  if (deps.conversationId) {
    const prevPending = await findLatestCalendarMutationPlan(deps.db, scope, {
      conversationId: deps.conversationId,
      onlyAwaitingApproval: true
    });
    if (prevPending && prevPending.step.action_name === GOOGLE_CALENDAR_CREATE_EVENT_ACTION) {
      await cancelGovernedCalendarMutation(
        deps.db,
        scope,
        prevPending.plan.id,
        'Superseded by updated meeting draft in chat'
      );
    }
  }

  const sendUpdates: 'all' | 'none' =
    draft.sendUpdates ?? (draft.attendees.length > 0 ? 'all' : 'none');
  const reminders: GoogleCalendarReminders = draft.reminders ?? DEFAULT_CALENDAR_REMINDERS;
  const origin: GoogleCalendarEventOrigin = draft.origin ?? 'thaara_chat';

  const params: GoogleCalendarCreateEventInput = {
    connectedCalendar: readiness.connectedCalendar,
    summary: draft.summary.slice(0, 250),
    ...(draft.description ? { description: draft.description } : {}),
    ...(draft.location ? { location: draft.location } : {}),
    startAt,
    endAt,
    timeZone: intent.timeZone,
    ...(draft.attendees.length > 0 ? { attendees: draft.attendees } : {}),
    sendUpdates,
    reminders,
    origin
  };

  const created = await createGovernedCalendarMutation(deps.db, scope, {
    actionName: GOOGLE_CALENDAR_CREATE_EVENT_ACTION,
    params: params as unknown as Record<string, unknown>,
    title: `Schedule meeting: ${params.summary}`,
    description: 'Approval-gated Google Calendar meeting creation from Chat',
    metadata: {
      origin: 'chat_calendar_assistant',
      thaaraOrigin: origin,
      conversationId: deps.conversationId ?? null,
      streamId: deps.streamId ?? null,
      connectedCalendar: readiness.connectedCalendar,
      operation: 'create',
      summary: params.summary,
      startAt,
      endAt,
      timeZone: intent.timeZone,
      ...(draft.attendees.length > 0 ? { attendees: draft.attendees } : {}),
      sendUpdates,
      reminders,
      conflictCount: conflicts.length
    },
    auditAction: 'calendar.events.create_prepared',
    auditPayload: {
      summary: params.summary,
      startAt,
      endAt,
      timeZone: intent.timeZone,
      attendeeCount: draft.attendees.length,
      sendUpdates,
      reminders,
      conflictCount: conflicts.length,
      connectedCalendar: readiness.connectedCalendar,
      origin: 'chat_calendar_assistant',
      thaaraOrigin: origin
    }
  });

  const actualDurationMinutes = Math.max(5, Math.round((endMs - startMs) / 60000));
  const friendlyDate = formatFriendlyDateLabel(ymd.isoDate, intent.timeZone);
  const friendlyStart = formatFriendlyClockTime(startAt, intent.timeZone);
  const friendlyEnd = formatFriendlyClockTime(endAt, intent.timeZone);
  const reminderSummary = formatCalendarRemindersSummary(reminders);
  const lines: string[] = [
    `Connected Calendar: ${readiness.connectedCalendar}`,
    `Title: ${params.summary}`,
    `Date: ${friendlyDate}`,
    `Time: ${friendlyStart} – ${friendlyEnd} (${intent.timeZone})`,
    `Duration: ${actualDurationMinutes} minutes${draft.durationWasDefaulted ? ' (default, editable)' : ''}`,
    `Reminder: ${reminderSummary} (editable) — Google Calendar notification delivery depends on your Google Calendar and device settings.`
  ];
  if (draft.attendees.length > 0) {
    lines.push(
      `Attendees: ${draft.attendees.join(', ')} (${sendUpdates === 'all' ? 'invitations will be sent' : 'no email notifications'})`
    );
  }
  if (conflicts.length > 0) {
    const conflictNames = conflicts
      .map((c) => `"${c.summary}" (${c.localTimeRange})`)
      .join(', ');
    lines.push(`Warning: Conflict detected with ${conflictNames}.`);
  }
  if (draft.personName) {
    lines.push(`Your meeting with ${draft.personName} is ready. Please check and approve. Shall I schedule it?`);
  } else {
    lines.push('Your meeting is ready. Shall I schedule it? Please check and approve.');
  }

  return {
    handled: true,
    status: 'awaiting_approval',
    responseText: lines.join('\n'),
    planId: created.planId,
    planStatus: 'awaiting_approval',
    approvalId: created.approvalId,
    steps: [
      {
        stepId: created.stepId,
        stepOrder: 0,
        actionName: GOOGLE_CALENDAR_CREATE_EVENT_ACTION,
        status: 'awaiting_approval',
        receiptStatus: null,
        receiptId: null,
        verificationMethod: null,
        proof: null,
        error: null
      }
    ]
  };
}

async function handleCreateEventFromGmailExplicitChatIntent(
  scope: AuthenticatedScope,
  intent: CalendarChatIntent,
  deps: {
    db?: TransactionalDbClient;
    googleCalendar: GoogleCalendarFoundation;
    gmail?: GmailFoundation;
    conversationId?: string;
    streamId?: string;
    nowMs?: number;
  }
): Promise<ChatCalendarExecutionOutcome> {
  const explicitDraft = intent.explicitGmailDraft!;
  const readiness = await deps.googleCalendar.writeReadiness(scope, 'create');
  if (!readiness.ready || !readiness.connectedCalendar) {
    if (readiness.reason === 'write_permission_missing') {
      return {
        handled: true,
        status: 'failed',
        responseText:
          'Your Google Calendar is connected with read-only access. To schedule meetings from an email, please open the Google Calendar tab, click Disconnect, and reconnect Google Calendar to grant scheduling permission (calendar.events.owned).'
      };
    }
    return {
      handled: true,
      status: 'disconnected',
      responseText:
        'Google Calendar is not connected. Please open the Google Calendar tab and click Connect Google Calendar first.'
    };
  }

  if (!deps.gmail) {
    return {
      handled: true,
      status: 'disconnected',
      responseText:
        'Gmail is not configured or connected. Please connect Gmail first so I can check that email.'
    };
  }

  const gmailStatus = await deps.gmail.status(scope);
  if (!gmailStatus.connected) {
    return {
      handled: true,
      status: 'disconnected',
      responseText:
        'Gmail is not connected yet. Please open the Gmail tab and click Connect Gmail so I can check the email you requested.'
    };
  }

  const listed = await deps.gmail.search(scope, {
    query: explicitDraft.emailQuery,
    limit: 5
  });

  if (listed.messages.length === 0) {
    return {
      handled: true,
      status: 'completed',
      responseText: `I checked your Gmail for "${explicitDraft.emailQuery}", but I could not find a matching email.`
    };
  }

  const msg = await deps.gmail.read(scope, listed.messages[0]!.id);
  const combinedUntrustedText = `${msg.subject ?? ''} ${msg.snippet ?? ''} ${msg.bodyText ?? ''}`
    .replace(/\s+/g, ' ')
    .trim();
  const times = extractAllClockTimes(combinedUntrustedText);
  const startTime = times[0] ?? { hour: 18, minute: 0 };
  const targetDate =
    explicitDraft.targetDate ?? extractTargetDateToken(combinedUntrustedText) ?? 'today';
  const durationMinutes =
    extractDurationMinutes(combinedUntrustedText) ?? DEFAULT_MEETING_DURATION_MINUTES;
  const senderDisplay = (msg.from ?? explicitDraft.emailQuery)
    .replace(/<[^>]*>/g, '')
    .replace(/["']/g, '')
    .trim();
  const summary =
    msg.subject && msg.subject.trim() && !/^re:/i.test(msg.subject.trim())
      ? msg.subject.trim().slice(0, 120)
      : `Meeting with ${formatPersonDisplayName(senderDisplay || explicitDraft.emailQuery)}`;

  return handleCreateEventChatIntent(
    scope,
    {
      ...intent,
      kind: 'create_event',
      createDraft: {
        summary,
        personName: formatPersonDisplayName(explicitDraft.emailQuery),
        targetDate,
        startHour: startTime.hour,
        startMinute: startTime.minute,
        durationMinutes,
        durationWasDefaulted: true,
        attendees: [],
        description: `Prepared from email "${(msg.subject ?? 'No subject').slice(0, 120)}" (${(msg.from ?? 'unknown sender').slice(0, 120)}) at owner request.`,
        sendUpdates: 'none',
        reminders: explicitDraft.reminders ?? DEFAULT_CALENDAR_REMINDERS,
        origin: 'thaara_gmail_explicit'
      }
    },
    deps
  );
}

async function handleRescheduleEventChatIntent(
  scope: AuthenticatedScope,
  intent: CalendarChatIntent,
  deps: {
    db?: TransactionalDbClient;
    googleCalendar: GoogleCalendarFoundation;
    conversationId?: string;
    streamId?: string;
    nowMs?: number;
  }
): Promise<ChatCalendarExecutionOutcome> {
  const draft = intent.rescheduleDraft!;
  const readiness = await deps.googleCalendar.writeReadiness(scope, 'reschedule');
  if (!readiness.ready || !readiness.connectedCalendar) {
    if (readiness.reason === 'write_permission_missing') {
      return {
        handled: true,
        status: 'failed',
        responseText:
          'Your Google Calendar is connected with read-only access. To reschedule meetings, please open the Google Calendar tab, click Disconnect, and reconnect Google Calendar to grant scheduling permission (calendar.events.owned).'
      };
    }
    if (readiness.reason === 'disconnected' || readiness.reason === 'reconnect_required') {
      return {
        handled: true,
        status: 'disconnected',
        responseText:
          'Google Calendar is not connected. Please open the Google Calendar tab and click Connect Google Calendar first.'
      };
    }
    return {
      handled: true,
      status: 'failed',
      responseText: 'Meeting could not be rescheduled because Google Calendar is not ready.'
    };
  }

  if ((draft.newHour === null || draft.newMinute === null) && !draft.reminders) {
    return {
      handled: true,
      status: 'completed',
      responseText:
        'What new time should I move the meeting to? For example, say "move my 3 PM meeting to 4 PM".'
    };
  }

  const searchRange: CalendarDateRangePreset =
    draft.targetDate === 'tomorrow'
      ? 'tomorrow'
      : draft.targetDate === 'today'
        ? 'today'
        : 'next_7_days';
  const win = computeCalendarRangeWindowInTimeZone(searchRange, intent.timeZone, deps.nowMs);
  const listed = await deps.googleCalendar.listEvents(scope, {
    windowStart: win.windowStart,
    windowEnd: win.windowEnd,
    timeZone: intent.timeZone,
    includeCancelled: false,
    limit: 50
  });

  const candidates = findMatchingCalendarEvents(listed.events, {
    sourceHour: draft.sourceHour,
    sourceMinute: draft.sourceMinute,
    titleQuery: draft.titleQuery,
    timeZone: intent.timeZone
  });

  if (candidates.length === 0) {
    return {
      handled: true,
      status: 'completed',
      responseText:
        'I could not find a matching meeting on your Google Calendar to reschedule. Please check the meeting title or time and try again.'
    };
  }

  let selectedEvent: GoogleCalendarEvent | undefined;
  if (candidates.length === 1) {
    selectedEvent = candidates[0];
  } else if (
    draft.disambiguationIndex &&
    draft.disambiguationIndex >= 1 &&
    draft.disambiguationIndex <= candidates.length
  ) {
    selectedEvent = candidates[draft.disambiguationIndex - 1];
  } else {
    const lines: string[] = [
      `Connected Calendar: ${readiness.connectedCalendar}`,
      `Multiple meetings match your request:`
    ];
    candidates.slice(0, 5).forEach((ev, idx) => {
      const localDate = formatLocalDateInTimeZone(ev.startAt, intent.timeZone);
      lines.push(
        `${idx + 1}. ${ev.summary} — ${formatFriendlyDateLabel(localDate, intent.timeZone)}, ${formatFriendlyEventTime(ev, intent.timeZone)}`
      );
    });
    lines.push('Which meeting would you like to reschedule? Reply with #1 or #2.');
    return {
      handled: true,
      status: 'completed',
      responseText: lines.join('\n')
    };
  }

  const origStartMs = Date.parse(selectedEvent!.startAt);
  const origEndMs = Date.parse(selectedEvent!.endAt);
  const origDurationMs = Math.max(15 * 60 * 1000, origEndMs - origStartMs);
  const eventLocalDate = formatLocalDateInTimeZone(selectedEvent!.startAt, intent.timeZone);
  const targetDateForNewSlot = draft.newTargetDate ?? eventLocalDate;
  const newYmd = resolveLocalDateYmd(targetDateForNewSlot, intent.timeZone, deps.nowMs);
  const newStartMs =
    draft.newHour !== null && draft.newMinute !== null
      ? getZonedHourMs(
          newYmd.year,
          newYmd.month,
          newYmd.day,
          draft.newHour,
          draft.newMinute,
          intent.timeZone
        )
      : origStartMs;
  const newEndMs = draft.durationMinutes
    ? newStartMs + draft.durationMinutes * 60 * 1000
    : newStartMs + origDurationMs;

  const newStartAt = formatZonedRfc3339(newStartMs, intent.timeZone);
  const newEndAt = formatZonedRfc3339(newEndMs, intent.timeZone);

  const conflicts = await deps.googleCalendar.findConflicts(scope, {
    startAt: newStartAt,
    endAt: newEndAt,
    timeZone: intent.timeZone,
    excludeEventId: selectedEvent!.id
  });

  if (!deps.db) {
    return {
      handled: true,
      status: 'failed',
      responseText: 'Meeting could not be rescheduled right now.'
    };
  }

  const hasGuests = selectedEvent!.attendees.some((a) => !a.self && a.email);
  const sendUpdates: 'all' | 'none' =
    draft.sendUpdates ?? (hasGuests ? 'all' : 'none');
  const reminders = draft.reminders ?? selectedEvent!.reminders;

  const params: GoogleCalendarRescheduleEventInput = {
    eventId: selectedEvent!.id,
    connectedCalendar: readiness.connectedCalendar,
    summary: selectedEvent!.summary,
    expectedStartAt: selectedEvent!.startAt,
    expectedEndAt: selectedEvent!.endAt,
    expectedStatus: selectedEvent!.status === 'tentative' ? 'tentative' : 'confirmed',
    newStartAt,
    newEndAt,
    timeZone: intent.timeZone,
    sendUpdates,
    ...(reminders ? { reminders } : {})
  };

  const created = await createGovernedCalendarMutation(deps.db, scope, {
    actionName: GOOGLE_CALENDAR_RESCHEDULE_EVENT_ACTION,
    params: params as unknown as Record<string, unknown>,
    title: `Reschedule meeting: ${selectedEvent!.summary}`,
    description: 'Approval-gated Google Calendar meeting reschedule from Chat',
    metadata: {
      origin: 'chat_calendar_assistant',
      conversationId: deps.conversationId ?? null,
      streamId: deps.streamId ?? null,
      connectedCalendar: readiness.connectedCalendar,
      operation: 'reschedule',
      eventId: selectedEvent!.id,
      summary: selectedEvent!.summary,
      previousStartAt: selectedEvent!.startAt,
      previousEndAt: selectedEvent!.endAt,
      startAt: newStartAt,
      endAt: newEndAt,
      timeZone: intent.timeZone,
      sendUpdates,
      ...(reminders ? { reminders } : {}),
      conflictCount: conflicts.length
    },
    auditAction: 'calendar.events.reschedule_prepared',
    auditPayload: {
      eventId: selectedEvent!.id,
      summary: selectedEvent!.summary,
      previousStartAt: selectedEvent!.startAt,
      previousEndAt: selectedEvent!.endAt,
      newStartAt,
      newEndAt,
      timeZone: intent.timeZone,
      sendUpdates,
      ...(reminders ? { reminders } : {}),
      conflictCount: conflicts.length,
      connectedCalendar: readiness.connectedCalendar,
      origin: 'chat_calendar_assistant'
    }
  });

  const oldDateLabel = formatFriendlyDateLabel(eventLocalDate, intent.timeZone);
  const newDateLabel = formatFriendlyDateLabel(newYmd.isoDate, intent.timeZone);
  const lines: string[] = [
    `Connected Calendar: ${readiness.connectedCalendar}`,
    `Meeting: ${selectedEvent!.summary}`,
    `Current Time: ${oldDateLabel}, ${formatFriendlyClockTime(selectedEvent!.startAt, intent.timeZone)} – ${formatFriendlyClockTime(selectedEvent!.endAt, intent.timeZone)}`,
    `New Time: ${newDateLabel}, ${formatFriendlyClockTime(newStartAt, intent.timeZone)} – ${formatFriendlyClockTime(newEndAt, intent.timeZone)} (${intent.timeZone})`
  ];
  if (reminders) {
    lines.push(
      `Reminder: ${formatCalendarRemindersSummary(reminders)} — Google Calendar notification delivery depends on your Google Calendar and device settings.`
    );
  }
  if (conflicts.length > 0) {
    const conflictNames = conflicts
      .map((c) => `"${c.summary}" (${c.localTimeRange})`)
      .join(', ');
    lines.push(`Warning: Conflict detected with ${conflictNames}.`);
  }
  lines.push('Your meeting is ready to be rescheduled. Please check and approve. Shall I schedule it?');

  return {
    handled: true,
    status: 'awaiting_approval',
    responseText: lines.join('\n'),
    planId: created.planId,
    planStatus: 'awaiting_approval',
    approvalId: created.approvalId,
    steps: [
      {
        stepId: created.stepId,
        stepOrder: 0,
        actionName: GOOGLE_CALENDAR_RESCHEDULE_EVENT_ACTION,
        status: 'awaiting_approval',
        receiptStatus: null,
        receiptId: null,
        verificationMethod: null,
        proof: null,
        error: null
      }
    ]
  };
}

async function handleCancelEventChatIntent(
  scope: AuthenticatedScope,
  intent: CalendarChatIntent,
  deps: {
    db?: TransactionalDbClient;
    googleCalendar: GoogleCalendarFoundation;
    conversationId?: string;
    streamId?: string;
    nowMs?: number;
  }
): Promise<ChatCalendarExecutionOutcome> {
  const draft = intent.cancelDraft!;
  const readiness = await deps.googleCalendar.writeReadiness(scope, 'cancel');
  if (!readiness.ready || !readiness.connectedCalendar) {
    if (readiness.reason === 'write_permission_missing') {
      return {
        handled: true,
        status: 'failed',
        responseText:
          'Your Google Calendar is connected with read-only access. To cancel meetings, please open the Google Calendar tab, click Disconnect, and reconnect Google Calendar to grant scheduling permission (calendar.events.owned).'
      };
    }
    if (readiness.reason === 'disconnected' || readiness.reason === 'reconnect_required') {
      return {
        handled: true,
        status: 'disconnected',
        responseText:
          'Google Calendar is not connected. Please open the Google Calendar tab and click Connect Google Calendar first.'
      };
    }
    return {
      handled: true,
      status: 'failed',
      responseText: 'Meeting could not be cancelled because Google Calendar is not ready.'
    };
  }

  const searchRange: CalendarDateRangePreset =
    draft.targetDate === 'tomorrow'
      ? 'tomorrow'
      : draft.targetDate === 'today'
        ? 'today'
        : 'next_7_days';
  const win = computeCalendarRangeWindowInTimeZone(searchRange, intent.timeZone, deps.nowMs);
  const listed = await deps.googleCalendar.listEvents(scope, {
    windowStart: win.windowStart,
    windowEnd: win.windowEnd,
    timeZone: intent.timeZone,
    includeCancelled: false,
    limit: 50
  });

  const candidates = findMatchingCalendarEvents(listed.events, {
    sourceHour: draft.sourceHour,
    sourceMinute: draft.sourceMinute,
    titleQuery: draft.titleQuery,
    timeZone: intent.timeZone
  });

  if (candidates.length === 0) {
    return {
      handled: true,
      status: 'completed',
      responseText:
        'I could not find a matching meeting on your Google Calendar to cancel.'
    };
  }

  let selectedEvent: GoogleCalendarEvent | undefined;
  if (candidates.length === 1) {
    selectedEvent = candidates[0];
  } else if (
    draft.disambiguationIndex &&
    draft.disambiguationIndex >= 1 &&
    draft.disambiguationIndex <= candidates.length
  ) {
    selectedEvent = candidates[draft.disambiguationIndex - 1];
  } else {
    const lines: string[] = [
      `Connected Calendar: ${readiness.connectedCalendar}`,
      `Multiple meetings match your cancellation request:`
    ];
    candidates.slice(0, 5).forEach((ev, idx) => {
      const localDate = formatLocalDateInTimeZone(ev.startAt, intent.timeZone);
      lines.push(
        `${idx + 1}. ${ev.summary} — ${formatFriendlyDateLabel(localDate, intent.timeZone)}, ${formatFriendlyEventTime(ev, intent.timeZone)}`
      );
    });
    lines.push('Which meeting would you like to cancel? Reply with #1 or #2.');
    return {
      handled: true,
      status: 'completed',
      responseText: lines.join('\n')
    };
  }

  if (!deps.db) {
    return {
      handled: true,
      status: 'failed',
      responseText: 'Meeting could not be cancelled right now.'
    };
  }

  const guestEmails = selectedEvent!.attendees
    .filter((a) => !a.self && typeof a.email === 'string' && a.email.trim())
    .map((a) => a.email!);
  const sendUpdates: 'all' | 'none' =
    draft.sendUpdates ?? (guestEmails.length > 0 ? 'all' : 'none');

  const params: GoogleCalendarCancelEventInput = {
    eventId: selectedEvent!.id,
    connectedCalendar: readiness.connectedCalendar,
    summary: selectedEvent!.summary,
    expectedStartAt: selectedEvent!.startAt,
    expectedEndAt: selectedEvent!.endAt,
    expectedStatus: selectedEvent!.status === 'tentative' ? 'tentative' : 'confirmed',
    timeZone: intent.timeZone,
    sendUpdates
  };

  const created = await createGovernedCalendarMutation(deps.db, scope, {
    actionName: GOOGLE_CALENDAR_CANCEL_EVENT_ACTION,
    params: params as unknown as Record<string, unknown>,
    title: `Cancel meeting: ${selectedEvent!.summary}`,
    description: 'Approval-gated Google Calendar meeting cancellation from Chat',
    metadata: {
      origin: 'chat_calendar_assistant',
      conversationId: deps.conversationId ?? null,
      streamId: deps.streamId ?? null,
      connectedCalendar: readiness.connectedCalendar,
      operation: 'cancel',
      eventId: selectedEvent!.id,
      summary: selectedEvent!.summary,
      startAt: selectedEvent!.startAt,
      endAt: selectedEvent!.endAt,
      timeZone: intent.timeZone,
      ...(guestEmails.length > 0 ? { attendees: guestEmails } : {}),
      sendUpdates
    },
    auditAction: 'calendar.events.cancel_prepared',
    auditPayload: {
      eventId: selectedEvent!.id,
      summary: selectedEvent!.summary,
      expectedStartAt: selectedEvent!.startAt,
      expectedEndAt: selectedEvent!.endAt,
      timeZone: intent.timeZone,
      sendUpdates,
      guestCount: guestEmails.length,
      connectedCalendar: readiness.connectedCalendar,
      origin: 'chat_calendar_assistant'
    }
  });

  const eventLocalDate = formatLocalDateInTimeZone(selectedEvent!.startAt, intent.timeZone);
  const dateLabel = formatFriendlyDateLabel(eventLocalDate, intent.timeZone);
  const guestNotice =
    guestEmails.length > 0
      ? sendUpdates === 'all'
        ? `Guests (${guestEmails.join(', ')}) will be notified.`
        : `Guests (${guestEmails.join(', ')}) will not be notified.`
      : 'No other guests are on this meeting.';

  const lines: string[] = [
    `Connected Calendar: ${readiness.connectedCalendar}`,
    `Cancel Meeting: ${selectedEvent!.summary}`,
    `Scheduled Time: ${dateLabel}, ${formatFriendlyClockTime(selectedEvent!.startAt, intent.timeZone)} – ${formatFriendlyClockTime(selectedEvent!.endAt, intent.timeZone)} (${intent.timeZone})`,
    `Guest Notification: ${guestNotice}`,
    `Please confirm and approve below to cancel this meeting.`
  ];

  return {
    handled: true,
    status: 'awaiting_approval',
    responseText: lines.join('\n'),
    planId: created.planId,
    planStatus: 'awaiting_approval',
    approvalId: created.approvalId,
    steps: [
      {
        stepId: created.stepId,
        stepOrder: 0,
        actionName: GOOGLE_CALENDAR_CANCEL_EVENT_ACTION,
        status: 'awaiting_approval',
        receiptStatus: null,
        receiptId: null,
        verificationMethod: null,
        proof: null,
        error: null
      }
    ]
  };
}

export async function executeChatCalendarRequest(
  scope: AuthenticatedScope,
  intent: CalendarChatIntent,
  deps: {
    db?: TransactionalDbClient;
    googleCalendar?: GoogleCalendarFoundation;
    gmail?: GmailFoundation;
    policyGateway?: PolicyGateway;
    queueService?: JobQueueService;
    conversationId?: string;
    streamId?: string;
    nowMs?: number;
  }
): Promise<ChatCalendarExecutionOutcome> {
  const googleCalendar = deps.googleCalendar;
  const policy = deps.policyGateway ?? defaultPolicyGateway;

  if (!googleCalendar) {
    return {
      handled: true,
      status: 'disconnected',
      responseText:
        'Google Calendar is not configured on this server yet. Please configure Google OAuth credentials first.'
    };
  }

  try {
    if (intent.kind === 'cancel_pending_mutation') {
      if (!deps.db) {
        return {
          handled: true,
          status: 'completed',
          responseText: 'There is no pending calendar request to cancel.'
        };
      }
      const latest = await findLatestCalendarMutationPlan(deps.db, scope, {
        conversationId: deps.conversationId,
        onlyAwaitingApproval: true
      });
      if (!latest) {
        return {
          handled: true,
          status: 'completed',
          responseText: 'There is no pending calendar request awaiting approval.'
        };
      }
      await cancelGovernedCalendarMutation(
        deps.db,
        scope,
        latest.plan.id,
        'Cancelled by user in chat'
      );
      return {
        handled: true,
        status: 'completed',
        responseText: 'Cancelled the pending Google Calendar request. No changes were made to your calendar.'
      };
    }

    if (intent.kind === 'create_event_from_gmail_explicit') {
      return await handleCreateEventFromGmailExplicitChatIntent(scope, intent, {
        ...deps,
        googleCalendar
      });
    }

    if (intent.kind === 'create_event') {
      return await handleCreateEventChatIntent(scope, intent, {
        ...deps,
        googleCalendar
      });
    }

    if (intent.kind === 'reschedule_event') {
      return await handleRescheduleEventChatIntent(scope, intent, {
        ...deps,
        googleCalendar
      });
    }

    if (intent.kind === 'cancel_event') {
      return await handleCancelEventChatIntent(scope, intent, {
        ...deps,
        googleCalendar
      });
    }

    const window = computeCalendarRangeWindowInTimeZone(
      intent.range,
      intent.timeZone,
      deps.nowMs
    );

    const agendaInput = {
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      timeZone: intent.timeZone,
      includeCancelled: false,
      limit: 50
    };

    const agendaDecision = policy.evaluate(scope, {
      actionName: 'calendar.agenda.read',
      parameters: agendaInput
    });
    if (!agendaDecision.allowed) {
      throw new ForbiddenError('Google Calendar action denied by policy.');
    }

    const statusDecision = policy.evaluate(scope, {
      actionName: 'calendar.connection.status',
      parameters: {}
    });
    if (!statusDecision.allowed) {
      throw new ForbiddenError('Google Calendar action denied by policy.');
    }

    const calendarStatus = await googleCalendar.status(scope);
    if (!calendarStatus.configured) {
      return {
        handled: true,
        status: 'disconnected',
        responseText:
          'Google Calendar is not configured on this server yet. Please configure Google OAuth credentials first.'
      };
    }

    if (!calendarStatus.connected) {
      const reason =
        calendarStatus.status === 'reconnect_required'
          ? 'Your Google Calendar authorization has expired. Please open the Google Calendar tab and click Reconnect Google Calendar.'
          : 'Google Calendar is not connected yet. Please open the Google Calendar tab and click Connect Google Calendar to authorize access.';
      return {
        handled: true,
        status: 'disconnected',
        responseText: reason
      };
    }

    const agenda = await googleCalendar.readAgenda(scope, agendaInput);

    const seenIds = new Set<string>();
    const activeEvents: Array<{ localDate: string; event: GoogleCalendarEvent }> = [];
    for (const day of agenda.days) {
      for (const ev of day.events) {
        if (ev.status === 'cancelled' || seenIds.has(ev.id)) continue;
        seenIds.add(ev.id);
        activeEvents.push({ localDate: day.localDate, event: ev });
      }
    }

    const identityLine = formatConnectedCalendarBadge(calendarStatus);
    const conflictSet = new Set(agenda.conflictEventIds);

    if (intent.kind === 'free_busy_check') {
      const dayLabel = describeRangeLabel(intent.range);
      const targetLocalDate = window.localStartDate;
      const friendlyDate = formatFriendlyDateLabel(targetLocalDate, intent.timeZone);

      if (
        intent.partOfDay !== 'all_day' &&
        (intent.range === 'today' || intent.range === 'tomorrow')
      ) {
        const subWindow = getPartOfDayWindowBounds(
          targetLocalDate,
          intent.partOfDay,
          intent.timeZone
        );
        const matching = activeEvents.filter(({ event }) => {
          if (event.allDay) return true;
          const evStart = Date.parse(event.startAt);
          const evEnd = Date.parse(event.endAt);
          return evEnd > subWindow.startMs && evStart < subWindow.endMs;
        });

        const lines: string[] = [];
        if (identityLine) {
          lines.push(identityLine);
        }

        if (matching.length === 0) {
          lines.push(
            `Yes, you are free ${dayLabel} ${subWindow.label} (${friendlyDate}). You have no meetings scheduled during that time.`
          );
          if (activeEvents.length > 0) {
            lines.push(
              `Note: You have ${activeEvents.length} other meeting${activeEvents.length === 1 ? '' : 's'} at different times on ${friendlyDate}:`
            );
            for (const { event } of activeEvents) {
              const loc = event.location ? ` (${event.location})` : '';
              lines.push(
                `- ${event.summary} — ${formatFriendlyEventTime(event, intent.timeZone)}${loc}`
              );
            }
          }
        } else {
          lines.push(
            `You are busy ${dayLabel} ${subWindow.label} (${friendlyDate}). You have ${matching.length} scheduled meeting${matching.length === 1 ? '' : 's'} during that window:`
          );
          for (const { event } of matching) {
            const loc = event.location ? ` (${event.location})` : '';
            const conflictNote = conflictSet.has(event.id) ? ' [Overlapping time]' : '';
            lines.push(
              `- ${event.summary} — ${formatFriendlyEventTime(event, intent.timeZone)}${loc}${conflictNote}`
            );
          }
        }

        return {
          handled: true,
          status: 'completed',
          responseText: lines.join('\n')
        };
      }

      const lines: string[] = [];
      if (identityLine) {
        lines.push(identityLine);
      }
      if (activeEvents.length === 0) {
        lines.push(
          `Yes, you are completely free for ${dayLabel} (${friendlyDate}). You have no scheduled meetings.`
        );
      } else {
        lines.push(
          `You have ${activeEvents.length} meeting${activeEvents.length === 1 ? '' : 's'} scheduled for ${dayLabel} (${friendlyDate}):`
        );
        for (const { event } of activeEvents) {
          const loc = event.location ? ` (${event.location})` : '';
          const conflictNote = conflictSet.has(event.id) ? ' [Overlapping time]' : '';
          lines.push(
            `- ${event.summary} — ${formatFriendlyEventTime(event, intent.timeZone)}${loc}${conflictNote}`
          );
        }
      }
      return {
        handled: true,
        status: 'completed',
        responseText: lines.join('\n')
      };
    }

    const rangeLabel = describeRangeLabel(intent.range);
    const lines: string[] = [];
    if (identityLine) {
      lines.push(identityLine);
    }

    if (activeEvents.length === 0) {
      if (intent.range === 'today' || intent.range === 'tomorrow') {
        const friendlyDate = formatFriendlyDateLabel(window.localStartDate, intent.timeZone);
        lines.push(`You have no meetings scheduled for ${rangeLabel} (${friendlyDate}).`);
      } else if (intent.range === 'prev_7_days') {
        lines.push(`You had no meetings scheduled in ${rangeLabel}.`);
      } else {
        lines.push(`You have no meetings scheduled for ${rangeLabel}.`);
      }
      return {
        handled: true,
        status: 'completed',
        responseText: lines.join('\n')
      };
    }

    if (intent.range === 'today' || intent.range === 'tomorrow') {
      const friendlyDate = formatFriendlyDateLabel(window.localStartDate, intent.timeZone);
      lines.push(
        `You have ${activeEvents.length} meeting${activeEvents.length === 1 ? '' : 's'} scheduled for ${rangeLabel} (${friendlyDate}):`
      );
      for (const { event } of activeEvents) {
        const loc = event.location ? ` — Location: ${event.location}` : '';
        const statusNote = event.status === 'tentative' ? ' (Tentative)' : '';
        const conflictNote = conflictSet.has(event.id) ? ' [Overlapping time]' : '';
        const originBadge = event.ownerSaved ? ' [Saved in Thaara]' : '';
        lines.push(
          `- ${event.summary}: ${formatFriendlyEventTime(event, intent.timeZone)}${loc}${statusNote}${conflictNote}${originBadge}`
        );
      }
    } else {
      lines.push(
        `Here is your schedule for ${rangeLabel} (${activeEvents.length} meeting${activeEvents.length === 1 ? '' : 's'}):`
      );
      for (const day of agenda.days) {
        const dayActive = day.events.filter((ev) => ev.status !== 'cancelled');
        if (dayActive.length === 0) continue;
        lines.push(`\n${formatFriendlyDateLabel(day.localDate, intent.timeZone)}:`);
        for (const event of dayActive) {
          const loc = event.location ? ` — Location: ${event.location}` : '';
          const statusNote = event.status === 'tentative' ? ' (Tentative)' : '';
          const conflictNote = conflictSet.has(event.id) ? ' [Overlapping time]' : '';
          const originBadge = event.ownerSaved ? ' [Saved in Thaara]' : '';
          lines.push(
            `- ${event.summary}: ${formatFriendlyEventTime(event, intent.timeZone)}${loc}${statusNote}${conflictNote}${originBadge}`
          );
        }
      }
    }

    if (conflictSet.size > 0) {
      lines.push(`\nNote: ${conflictSet.size} of your meetings have overlapping times.`);
    }

    return {
      handled: true,
      status: 'completed',
      responseText: lines.join('\n')
    };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      const isReadIntent =
        intent.kind === 'agenda_read' || intent.kind === 'free_busy_check';
      return {
        handled: true,
        status: 'failed',
        responseText: isReadIntent
          ? "You don't have permission to read Google Calendar in this workspace."
          : "You don't have permission to perform this Google Calendar action in this workspace."
      };
    }
    const code = err instanceof AppError ? err.code : (err as { code?: string })?.code;
    if (code === 'CALENDAR_DISCONNECTED' || code === 'CALENDAR_RECONNECT_REQUIRED') {
      return {
        handled: true,
        status: 'disconnected',
        responseText:
          'Google Calendar is not connected. Please open the Google Calendar tab and click Connect Google Calendar first.'
      };
    }
    if (code === 'CALENDAR_WRITE_SCOPE_REQUIRED') {
      return {
        handled: true,
        status: 'failed',
        responseText:
          'Your Google Calendar connection only has read-only access. Please disconnect and reconnect Google Calendar to grant scheduling permission (calendar.events.owned).'
      };
    }
    return {
      handled: true,
      status: 'failed',
      responseText:
        'I could not complete that Google Calendar action right now. Please check your Google Calendar connection and try again.'
    };
  }
}
