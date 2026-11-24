import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import {
  ApprovalRequest,
  GoogleCalendarAgendaQuery,
  GoogleCalendarAgendaResponse,
  GoogleCalendarAgendaResponseSchema,
  GoogleCalendarBriefingAppointment,
  GoogleCalendarBriefingQuery,
  GoogleCalendarBriefingResponse,
  GoogleCalendarBriefingResponseSchema,
  GoogleCalendarCallback,
  GoogleCalendarCancelEventInput,
  GoogleCalendarCancelEventInputSchema,
  GoogleCalendarConflictSummary,
  GoogleCalendarCreateEventInput,
  GoogleCalendarCreateEventInputSchema,
  GoogleCalendarEvent,
  GoogleCalendarEventOrigin,
  GoogleCalendarEventSchema,
  GoogleCalendarListEvents,
  GoogleCalendarListEventsResponse,
  GoogleCalendarListEventsResponseSchema,
  GoogleCalendarMutationReceipt,
  GoogleCalendarMutationReceiptSchema,
  GoogleCalendarN8nContext,
  GoogleCalendarReminders,
  GoogleCalendarRescheduleEventInput,
  GoogleCalendarRescheduleEventInputSchema,
  GoogleCalendarStatus,
  N8nWorkflowBlueprint,
  RequestScope,
  computeCanonicalParameterHash
} from '@thaara/contracts';
import { AuthenticatedScope } from '@thaara/db';
import { AppError, ForbiddenError } from '@thaara/observability';
import {
  ActionAdapter,
  ActionExecutionContext,
  ActionResult,
  PolicyGateway,
  detectWorkflowSecurityViolations,
  validateN8nWorkflowBlueprint
} from '@thaara/policy';

export const GOOGLE_CALENDAR_READONLY = 'https://www.googleapis.com/auth/calendar.readonly';
export const GOOGLE_CALENDAR_EVENTS_OWNED = 'https://www.googleapis.com/auth/calendar.events.owned';
export const GOOGLE_CALENDAR_LIVE_SCOPES = `${GOOGLE_CALENDAR_READONLY} ${GOOGLE_CALENDAR_EVENTS_OWNED}`;
export const GOOGLE_CALENDAR_CREATE_EVENT_ACTION = 'calendar.events.create';
export const GOOGLE_CALENDAR_RESCHEDULE_EVENT_ACTION = 'calendar.events.reschedule';
export const GOOGLE_CALENDAR_CANCEL_EVENT_ACTION = 'calendar.events.cancel';
export const GOOGLE_CALENDAR_MUTATION_ACTIONS = [
  GOOGLE_CALENDAR_CREATE_EVENT_ACTION,
  GOOGLE_CALENDAR_RESCHEDULE_EVENT_ACTION,
  GOOGLE_CALENDAR_CANCEL_EVENT_ACTION
] as const;

export const DEFAULT_CALENDAR_REMINDERS: GoogleCalendarReminders = {
  useDefault: false,
  overrides: [{ method: 'popup', minutes: 15 }]
};

export function formatCalendarRemindersSummary(reminders?: GoogleCalendarReminders): string {
  if (!reminders) {
    return 'Google Calendar default reminders';
  }
  if (reminders.useDefault) {
    return 'Google Calendar default reminders';
  }
  if (!reminders.overrides || reminders.overrides.length === 0) {
    return 'No reminder';
  }
  return reminders.overrides
    .map((ov) => `${ov.minutes} minute${ov.minutes === 1 ? '' : 's'} before (${ov.method})`)
    .join(', ');
}

export function isCalendarMutationAction(
  name: unknown
): name is (typeof GOOGLE_CALENDAR_MUTATION_ACTIONS)[number] {
  return (
    name === GOOGLE_CALENDAR_CREATE_EVENT_ACTION ||
    name === GOOGLE_CALENDAR_RESCHEDULE_EVENT_ACTION ||
    name === GOOGLE_CALENDAR_CANCEL_EVENT_ACTION
  );
}

export type GoogleCalendarWriteReadinessReason =
  | 'ready'
  | 'not_configured'
  | 'disconnected'
  | 'reconnect_required'
  | 'write_permission_missing'
  | 'account_unverified';

export interface GoogleCalendarWriteReadiness {
  ready: boolean;
  reason: GoogleCalendarWriteReadinessReason;
  connectedCalendar: string | null;
  status: GoogleCalendarStatus;
}

const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const RFC3339_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface GoogleCalendarCiphertextStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  take(key: string): string | undefined;
  delete(key: string): void;
}

export class GoogleCalendarVault {
  #key: Buffer;
  constructor(key: Buffer, private store: GoogleCalendarCiphertextStore) {
    if (key.length !== 32) {
      throw new Error('Google Calendar vault requires a dedicated 256-bit encryption key.');
    }
    this.#key = Buffer.from(key);
  }
  private partition(scope: RequestScope, purpose: string): string {
    if (!scope.workspaceId || !scope.userId) {
      throw new Error('Google Calendar vault requires an authenticated subject.');
    }
    return (
      'google_calendar:' +
      purpose +
      ':' +
      createHash('sha256')
        .update(JSON.stringify([scope.workspaceId, scope.userId, purpose]))
        .digest('hex')
    );
  }
  set(scope: RequestScope, purpose: string, value: unknown): void {
    const key = this.partition(scope, purpose);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    cipher.setAAD(Buffer.from(key));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    this.store.set(key, Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url'));
  }
  private open<T>(key: string, value: string | undefined): T | undefined {
    if (value === undefined) return undefined;
    try {
      const data = Buffer.from(value, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', this.#key, data.subarray(0, 12));
      decipher.setAAD(Buffer.from(key));
      decipher.setAuthTag(data.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')
      ) as T;
    } catch {
      throw new AppError(
        'Google Calendar credentials are unavailable.',
        'CALENDAR_CREDENTIALS_INVALID',
        503
      );
    }
  }
  get<T>(scope: RequestScope, purpose: string): T | undefined {
    const key = this.partition(scope, purpose);
    return this.open<T>(key, this.store.get(key));
  }
  take<T>(scope: RequestScope, purpose: string): T | undefined {
    const key = this.partition(scope, purpose);
    return this.open<T>(key, this.store.take(key));
  }
  delete(scope: RequestScope, purpose: string): void {
    this.store.delete(this.partition(scope, purpose));
  }
}

export interface GoogleCalendarTokens {
  accessToken: string;
  refreshToken?: string;
  scope: string;
  expiresIn: number;
}

export interface GoogleCalendarPrimaryMetadata {
  id?: string;
  summary?: string;
  timeZone?: string;
}

export interface GoogleCalendarProvider {
  readonly mode: 'mock' | 'live';
  exchange(input: {
    code: string;
    codeVerifier: string;
    clientId: string;
    redirectUri: string;
  }): Promise<GoogleCalendarTokens>;
  refresh?(input: {
    refreshToken: string;
    clientId: string;
  }): Promise<GoogleCalendarTokens>;
  revoke?(input: { token: string }): Promise<void>;
  getPrimaryCalendar?(input: { accessToken: string }): Promise<GoogleCalendarPrimaryMetadata>;
  listEvents(input: {
    accessToken: string;
    windowStart: string;
    windowEnd: string;
    timeZone: string;
    query?: string;
    includeCancelled: boolean;
    limit: number;
    pageToken?: string;
  }): Promise<unknown>;
  readEvent(input: { accessToken: string; eventId: string }): Promise<unknown>;
  createEvent?(input: {
    accessToken: string;
    summary: string;
    description?: string;
    location?: string;
    startAt: string;
    endAt: string;
    timeZone: string;
    attendees?: string[];
    sendUpdates: 'all' | 'none';
    reminders?: GoogleCalendarReminders;
    origin?: GoogleCalendarEventOrigin;
  }): Promise<{ id?: string; status?: string; reminders?: GoogleCalendarReminders }>;
  updateEvent?(input: {
    accessToken: string;
    eventId: string;
    summary: string;
    newStartAt: string;
    newEndAt: string;
    timeZone: string;
    sendUpdates: 'all' | 'none';
    reminders?: GoogleCalendarReminders;
  }): Promise<{ id?: string; status?: string; reminders?: GoogleCalendarReminders }>;
  cancelEvent?(input: {
    accessToken: string;
    eventId: string;
    sendUpdates: 'all' | 'none';
  }): Promise<{ id?: string; status?: string }>;
}

export interface GoogleCalendarOptions {
  provider?: GoogleCalendarProvider;
  vault?: GoogleCalendarVault;
  clientId?: string;
  redirectUri?: string;
  allowLocalhostRedirect?: boolean;
  allowWriteScope?: boolean;
  now?: () => number;
}

type Audit = (
  scope: AuthenticatedScope,
  action: string,
  payload: Record<string, unknown>
) => Promise<void>;

interface Pending {
  stateHash: string;
  sessionHash: string;
  verifier: string;
  expiresAt: number;
  epoch: string;
}

interface Connection {
  tokens: GoogleCalendarTokens;
  expiresAt: number;
  verifiedAt: string;
  epoch: string;
  connectedEmail?: string | null;
  connectedCalendarSummary?: string | null;
}

const eventCheck = TypeCompiler.Compile(GoogleCalendarEventSchema);
const listResponseCheck = TypeCompiler.Compile(GoogleCalendarListEventsResponseSchema);
const agendaResponseCheck = TypeCompiler.Compile(GoogleCalendarAgendaResponseSchema);
const briefingResponseCheck = TypeCompiler.Compile(GoogleCalendarBriefingResponseSchema);
const createEventInputCheck = TypeCompiler.Compile(GoogleCalendarCreateEventInputSchema);
const rescheduleEventInputCheck = TypeCompiler.Compile(GoogleCalendarRescheduleEventInputSchema);
const cancelEventInputCheck = TypeCompiler.Compile(GoogleCalendarCancelEventInputSchema);
const mutationReceiptCheck = TypeCompiler.Compile(GoogleCalendarMutationReceiptSchema);

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const calendarError = (code: string, message: string, status = 409) =>
  new AppError(message, code, status);

function normalizeConnectedCalendarEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < 3 || trimmed.length > 320 || !/^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]{2,}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function sanitizeCalendarSummary(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 256);
  return cleaned.length > 0 ? cleaned : null;
}

function parseGrantedCalendarScopes(
  rawScope: string | undefined,
  allowWrite: boolean
): string[] | null {
  if (typeof rawScope !== 'string' || !rawScope.trim()) return null;
  const tokens = rawScope.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const allowed = allowWrite
    ? new Set([GOOGLE_CALENDAR_READONLY, GOOGLE_CALENDAR_EVENTS_OWNED])
    : new Set([GOOGLE_CALENDAR_READONLY]);
  const seen = new Set<string>();
  for (const t of tokens) {
    if (!allowed.has(t) || seen.has(t)) return null;
    seen.add(t);
  }
  if (!seen.has(GOOGLE_CALENDAR_READONLY)) return null;
  const ordered: string[] = [GOOGLE_CALENDAR_READONLY];
  if (seen.has(GOOGLE_CALENDAR_EVENTS_OWNED)) ordered.push(GOOGLE_CALENDAR_EVENTS_OWNED);
  return ordered;
}

export function parseStrictRfc3339(value: string, fieldName: string): number {
  if (!RFC3339_REGEX.test(value)) {
    throw calendarError(
      'CALENDAR_INVALID_INPUT',
      `${fieldName} must be a valid RFC3339 timestamp with explicit offset.`,
      400
    );
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw calendarError('CALENDAR_INVALID_INPUT', `${fieldName} is not a valid calendar date.`, 400);
  }
  return ms;
}

export function validateIanaTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(0));
    return timeZone;
  } catch {
    throw calendarError('CALENDAR_INVALID_TIMEZONE', 'Invalid IANA timeZone.', 400);
  }
}

export function formatLocalDateInTimeZone(isoTimestamp: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(isoTimestamp));
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!year || !month || !day) {
    throw calendarError('CALENDAR_INVALID_TIMEZONE', 'Unable to format local date in timeZone.', 400);
  }
  return `${year}-${month}-${day}`;
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
  const num = (type: string) => Number.parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  return {
    year: num('year'),
    month: num('month'),
    day: num('day'),
    hour: num('hour') % 24,
    minute: num('minute'),
    second: num('second')
  };
}

/**
 * Computes the exact UTC epoch milliseconds for local midnight (00:00:00.000) on (year, month, day)
 * in the specified IANA `timeZone` (e.g., Asia/Kolkata -> UTC-5h30m from UTC midnight).
 */
export function getZonedMidnightMs(
  year: number,
  month: number,
  day: number,
  timeZone: string
): number {
  const tz = validateIanaTimeZone(timeZone);
  const targetAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const firstPass = getLocalPartsAtEpoch(targetAsUtc, tz);
  const firstOffsetMs =
    Date.UTC(
      firstPass.year,
      firstPass.month - 1,
      firstPass.day,
      firstPass.hour,
      firstPass.minute,
      firstPass.second
    ) - targetAsUtc;
  const candidateMs = targetAsUtc - firstOffsetMs;
  const secondPass = getLocalPartsAtEpoch(candidateMs, tz);
  const secondOffsetMs =
    Date.UTC(
      secondPass.year,
      secondPass.month - 1,
      secondPass.day,
      secondPass.hour,
      secondPass.minute,
      secondPass.second
    ) - candidateMs;
  return targetAsUtc - secondOffsetMs;
}

export function getZonedHourMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): number {
  const tz = validateIanaTimeZone(timeZone);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstPass = getLocalPartsAtEpoch(targetAsUtc, tz);
  const firstOffsetMs =
    Date.UTC(
      firstPass.year,
      firstPass.month - 1,
      firstPass.day,
      firstPass.hour,
      firstPass.minute,
      firstPass.second
    ) - targetAsUtc;
  const candidateMs = targetAsUtc - firstOffsetMs;
  const secondPass = getLocalPartsAtEpoch(candidateMs, tz);
  const secondOffsetMs =
    Date.UTC(
      secondPass.year,
      secondPass.month - 1,
      secondPass.day,
      secondPass.hour,
      secondPass.minute,
      secondPass.second
    ) - candidateMs;
  return targetAsUtc - secondOffsetMs;
}

/**
 * Converts a YYYY-MM-DD date string into an ISO 8601 timestamp representing 00:00:00 in `timeZone`.
 */
export function parseIsoDateToZonedMidnightIso(dateStr: string, timeZone: string): string {
  const match = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  const day = Number.parseInt(match[3]!, 10);
  try {
    const ms = getZonedMidnightMs(year, month, day, timeZone);
    return new Date(ms).toISOString().replace('.000Z', 'Z');
  } catch {
    return `${dateStr.trim()}T00:00:00Z`;
  }
}

export function computeCalendarRangeWindowInTimeZone(
  preset: 'today' | 'tomorrow' | 'next_7_days' | 'prev_7_days',
  timeZone: string,
  nowMs = Date.now()
): {
  windowStart: string;
  windowEnd: string;
  localStartDate: string;
  localEndDate: string;
} {
  const tz = validateIanaTimeZone(timeZone);
  const nowParts = getLocalPartsAtEpoch(nowMs, tz);
  const { year, month, day } = nowParts;

  let startDayOffset = 0;
  let endDayOffset = 1;
  if (preset === 'tomorrow') {
    startDayOffset = 1;
    endDayOffset = 2;
  } else if (preset === 'next_7_days') {
    startDayOffset = 0;
    endDayOffset = 7;
  } else if (preset === 'prev_7_days') {
    startDayOffset = -7;
    endDayOffset = 0;
  }

  const startMs = getZonedMidnightMs(year, month, day + startDayOffset, tz);
  const endMs = getZonedMidnightMs(year, month, day + endDayOffset, tz);
  const windowStart = new Date(startMs).toISOString().replace('.000Z', 'Z');
  const windowEnd = new Date(endMs).toISOString().replace('.000Z', 'Z');
  const localStartDate = formatLocalDateInTimeZone(windowStart, tz);
  const localEndDate = formatLocalDateInTimeZone(new Date(Math.max(startMs, endMs - 1000)).toISOString(), tz);

  return {
    windowStart,
    windowEnd,
    localStartDate,
    localEndDate
  };
}

function sanitizeEvent(raw: unknown, mode: 'mock' | 'live' = 'mock'): GoogleCalendarEvent {
  const source = raw as Record<string, unknown> | null;
  const rawAttendees = Array.isArray(source?.attendees) ? source.attendees : [];
  const rawReminders =
    source?.reminders && typeof source.reminders === 'object'
      ? (source.reminders as { useDefault?: unknown; overrides?: unknown })
      : undefined;
  const sanitizedReminders =
    rawReminders && typeof rawReminders.useDefault === 'boolean'
      ? {
          useDefault: rawReminders.useDefault,
          ...(Array.isArray(rawReminders.overrides)
            ? {
                overrides: rawReminders.overrides
                  .filter(
                    (ov): ov is { method: 'popup' | 'email'; minutes: number } =>
                      Boolean(ov) &&
                      typeof ov === 'object' &&
                      ((ov as { method?: unknown }).method === 'popup' ||
                        (ov as { method?: unknown }).method === 'email') &&
                      typeof (ov as { minutes?: unknown }).minutes === 'number' &&
                      Number.isInteger((ov as { minutes: number }).minutes) &&
                      (ov as { minutes: number }).minutes >= 0 &&
                      (ov as { minutes: number }).minutes <= 40320
                  )
                  .slice(0, 5)
                  .map((ov) => ({ method: ov.method, minutes: ov.minutes }))
              }
            : {})
        }
      : undefined;
  const rawOrigin = source?.thaaraOrigin;
  const sanitizedOrigin =
    rawOrigin === 'thaara_chat' ||
    rawOrigin === 'thaara_ui' ||
    rawOrigin === 'thaara_gmail_explicit' ||
    rawOrigin === 'external_calendar'
      ? rawOrigin
      : undefined;
  const candidate = {
    id: source?.id,
    calendarId: source?.calendarId,
    summary: source?.summary,
    description: source?.description,
    location: source?.location,
    startAt: source?.startAt,
    endAt: source?.endAt,
    timeZone: source?.timeZone,
    allDay: source?.allDay,
    status: source?.status,
    organizerEmail: source?.organizerEmail,
    attendees: rawAttendees.map((att: unknown) => {
      const a = att as Record<string, unknown> | null;
      return {
        ...(a?.email !== undefined ? { email: a.email } : {}),
        ...(a?.displayName !== undefined ? { displayName: a.displayName } : {}),
        ...(a?.responseStatus !== undefined ? { responseStatus: a.responseStatus } : {}),
        ...(a?.organizer !== undefined ? { organizer: a.organizer } : {}),
        ...(a?.self !== undefined ? { self: a.self } : {})
      };
    }),
    ...(sanitizedReminders ? { reminders: sanitizedReminders } : {}),
    ...(sanitizedOrigin ? { thaaraOrigin: sanitizedOrigin } : {}),
    ...(typeof source?.ownerSaved === 'boolean' ? { ownerSaved: source.ownerSaved } : {}),
    untrusted: true as const,
    mode
  };
  if (!eventCheck.Check(candidate)) {
    throw calendarError(
      'CALENDAR_PROVIDER_INVALID',
      'Google Calendar provider returned an invalid event.',
      502
    );
  }
  let startMs: number;
  let endMs: number;
  try {
    validateIanaTimeZone(candidate.timeZone);
    startMs = parseStrictRfc3339(candidate.startAt, 'event.startAt');
    endMs = parseStrictRfc3339(candidate.endAt, 'event.endAt');
  } catch {
    throw calendarError(
      'CALENDAR_PROVIDER_INVALID',
      'Google Calendar provider returned invalid event timestamps or timezone.',
      502
    );
  }
  if (endMs <= startMs) {
    throw calendarError(
      'CALENDAR_PROVIDER_INVALID',
      'Google Calendar provider returned an event with endAt before startAt.',
      502
    );
  }
  return candidate;
}

export class GoogleCalendarFoundation {
  private readonly now: () => number;
  private readonly ready: boolean;

  constructor(private options: GoogleCalendarOptions & { policyGateway: PolicyGateway; audit: Audit }) {
    this.now = options.now ?? Date.now;
    this.ready = Boolean(
      options.provider && options.vault && options.clientId && options.redirectUri
    );
    if (this.ready) {
      const uri = new URL(options.redirectUri!);
      const isAllowedLocal = Boolean(
        options.allowLocalhostRedirect &&
          uri.protocol === 'http:' &&
          (uri.hostname === 'localhost' || uri.hostname === '127.0.0.1')
      );
      if (
        (uri.protocol !== 'https:' && !isAllowedLocal) ||
        uri.username ||
        uri.password ||
        uri.search ||
        uri.hash ||
        (options.provider!.mode !== 'mock' && options.provider!.mode !== 'live')
      ) {
        throw new Error(
          'Google Calendar foundation requires a fixed HTTPS callback and valid provider.'
        );
      }
    }
  }

  private get activeMode(): 'mock' | 'live' {
    return this.options.provider?.mode === 'live' ? 'live' : 'mock';
  }

  private get supportsWriteScope(): boolean {
    return (
      this.activeMode === 'live' ||
      Boolean(this.options.allowWriteScope) ||
      typeof this.options.provider?.createEvent === 'function' ||
      typeof this.options.provider?.updateEvent === 'function' ||
      typeof this.options.provider?.cancelEvent === 'function'
    );
  }

  private authorize(
    scope: AuthenticatedScope,
    actionName: string,
    parameters: Record<string, unknown> = {},
    approvedRequest?: ApprovalRequest,
    idempotencyKey?: string
  ) {
    if (!scope.sessionTokenHash || !scope.workspaceId || !scope.userId) {
      throw new ForbiddenError();
    }
    const result = this.options.policyGateway.evaluate(
      scope,
      { actionName, parameters, ...(idempotencyKey ? { idempotencyKey } : {}) },
      approvedRequest,
      scope.userId
    );
    if (!result.allowed) {
      throw new ForbiddenError('Google Calendar action denied by policy.');
    }
  }

  private configured() {
    if (!this.ready) {
      throw calendarError(
        'CALENDAR_NOT_CONFIGURED',
        'Google Calendar integration is not configured.',
        503
      );
    }
  }

  private epoch(scope: AuthenticatedScope): string {
    let value = this.options.vault!.get<string>(scope, 'epoch');
    if (!value) {
      value = randomBytes(32).toString('base64url');
      this.options.vault!.set(scope, 'epoch', value);
    }
    return value;
  }

  private unchanged(scope: AuthenticatedScope, epoch: string) {
    if (this.epoch(scope) !== epoch) {
      throw calendarError(
        'CALENDAR_CONNECTION_CHANGED',
        'Google Calendar connection changed during the request.'
      );
    }
  }

  private validateWindow(windowStart: string, windowEnd: string): { startMs: number; endMs: number } {
    const startMs = parseStrictRfc3339(windowStart, 'windowStart');
    const endMs = parseStrictRfc3339(windowEnd, 'windowEnd');
    if (endMs <= startMs) {
      throw calendarError(
        'CALENDAR_INVALID_RANGE',
        'windowEnd must be strictly after windowStart.',
        400
      );
    }
    if (endMs - startMs > MAX_WINDOW_MS) {
      throw calendarError(
        'CALENDAR_INVALID_RANGE',
        'Date range cannot exceed 31 days.',
        400
      );
    }
    return { startMs, endMs };
  }

  private async resolveCalendarIdentity(accessToken: string): Promise<{
    connectedEmail?: string;
    connectedCalendarSummary?: string;
  }> {
    const provider = this.options.provider;
    if (!provider || typeof provider.getPrimaryCalendar !== 'function') return {};
    try {
      const primary = await provider.getPrimaryCalendar({ accessToken });
      const connectedEmail =
        normalizeConnectedCalendarEmail(primary?.id) ??
        normalizeConnectedCalendarEmail(primary?.summary) ??
        undefined;
      const connectedCalendarSummary =
        sanitizeCalendarSummary(primary?.summary) ??
        (!connectedEmail ? sanitizeCalendarSummary(primary?.id) : null) ??
        undefined;
      return {
        ...(connectedEmail ? { connectedEmail } : {}),
        ...(connectedCalendarSummary ? { connectedCalendarSummary } : {})
      };
    } catch {
      return {};
    }
  }

  private async tryRefresh(
    scope: AuthenticatedScope,
    connection: Connection
  ): Promise<Connection | undefined> {
    const provider = this.options.provider;
    if (
      !provider ||
      provider.mode !== 'live' ||
      typeof provider.refresh !== 'function' ||
      !connection.tokens.refreshToken
    ) {
      return undefined;
    }
    try {
      const refreshed = await provider.refresh({
        refreshToken: connection.tokens.refreshToken,
        clientId: this.options.clientId!
      });
      if (
        !refreshed ||
        typeof refreshed.accessToken !== 'string' ||
        !refreshed.accessToken ||
        refreshed.accessToken.length > 16384 ||
        !Number.isFinite(refreshed.expiresIn) ||
        refreshed.expiresIn <= 0 ||
        refreshed.expiresIn > 86400
      ) {
        return undefined;
      }
      this.unchanged(scope, connection.epoch);
      const identity =
        connection.connectedEmail || connection.connectedCalendarSummary
          ? {
              ...(connection.connectedEmail ? { connectedEmail: connection.connectedEmail } : {}),
              ...(connection.connectedCalendarSummary
                ? { connectedCalendarSummary: connection.connectedCalendarSummary }
                : {})
            }
          : await this.resolveCalendarIdentity(refreshed.accessToken);
      this.unchanged(scope, connection.epoch);
      const grantedScopes =
        parseGrantedCalendarScopes(refreshed.scope || connection.tokens.scope, true) ??
        parseGrantedCalendarScopes(connection.tokens.scope, true) ?? [GOOGLE_CALENDAR_READONLY];
      const updated: Connection = {
        tokens: {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken ?? connection.tokens.refreshToken,
          scope: grantedScopes.join(' '),
          expiresIn: refreshed.expiresIn
        },
        expiresAt: this.now() + refreshed.expiresIn * 1000,
        verifiedAt: new Date(this.now()).toISOString(),
        epoch: connection.epoch,
        ...identity
      };
      this.options.vault!.set(scope, 'connection', updated);
      await this.options.audit(scope, 'calendar.oauth.refreshed', { mode: this.activeMode });
      return updated;
    } catch {
      return undefined;
    }
  }

  async status(scope: AuthenticatedScope): Promise<GoogleCalendarStatus> {
    this.authorize(scope, 'calendar.connection.status');
    let connection = this.ready
      ? this.options.vault!.get<Connection>(scope, 'connection')
      : undefined;
    if (connection && connection.expiresAt <= this.now()) {
      const refreshed = await this.tryRefresh(scope, connection);
      if (refreshed) connection = refreshed;
    }
    const connected = Boolean(connection && connection.expiresAt > this.now());
    if (
      connected &&
      connection &&
      !connection.connectedEmail &&
      !connection.connectedCalendarSummary &&
      typeof this.options.provider?.getPrimaryCalendar === 'function'
    ) {
      const identity = await this.resolveCalendarIdentity(connection.tokens.accessToken);
      if (identity.connectedEmail || identity.connectedCalendarSummary) {
        this.unchanged(scope, connection.epoch);
        connection = {
          ...connection,
          ...identity
        };
        this.options.vault!.set(scope, 'connection', connection);
      }
    }
    const grantedScopes = connection
      ? parseGrantedCalendarScopes(connection.tokens.scope, true) ?? [GOOGLE_CALENDAR_READONLY]
      : [];
    return {
      connectorName: 'google_calendar',
      status: !this.ready
        ? 'not_configured'
        : !connection
          ? 'disconnected'
          : connected
            ? 'connected'
            : 'reconnect_required',
      configured: this.ready,
      connected,
      mode: this.ready ? this.activeMode : 'disabled',
      scopes: grantedScopes,
      lastVerifiedAt: connection?.verifiedAt ?? null,
      ...(connected && connection?.connectedEmail
        ? { connectedEmail: connection.connectedEmail }
        : {}),
      ...(connected && connection?.connectedCalendarSummary
        ? { connectedCalendarSummary: connection.connectedCalendarSummary }
        : {})
    };
  }

  async start(scope: AuthenticatedScope) {
    this.authorize(scope, 'calendar.connection.start');
    this.configured();
    const epoch = this.epoch(scope);
    const mode = this.activeMode;
    await this.options.audit(scope, 'calendar.oauth.requested', { mode });
    this.unchanged(scope, epoch);
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + 300000;
    this.options.vault!.set(scope, 'pending', {
      stateHash: hash(state),
      sessionHash: scope.sessionTokenHash,
      verifier,
      expiresAt,
      epoch
    });
    const requestedScope = this.supportsWriteScope
      ? GOOGLE_CALENDAR_LIVE_SCOPES
      : GOOGLE_CALENDAR_READONLY;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.options.clientId!,
      redirect_uri: this.options.redirectUri!,
      response_type: 'code',
      scope: requestedScope,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'false',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256'
    }).toString();
    return {
      authorizationUrl: url.href,
      expiresAt: new Date(expiresAt).toISOString(),
      mode
    };
  }

  async complete(scope: AuthenticatedScope, input: GoogleCalendarCallback): Promise<GoogleCalendarStatus> {
    this.authorize(scope, 'calendar.connection.complete', input);
    this.configured();
    const mode = this.activeMode;
    const pending = this.options.vault!.get<Pending>(scope, 'pending');
    if (
      !pending ||
      pending.expiresAt <= this.now() ||
      !equal(pending.stateHash, hash(input.state)) ||
      !equal(pending.sessionHash, scope.sessionTokenHash)
    ) {
      throw calendarError(
        'CALENDAR_OAUTH_INVALID',
        'Google Calendar OAuth state is invalid or expired.',
        400
      );
    }
    this.options.vault!.take(scope, 'pending');
    this.unchanged(scope, pending.epoch);
    if (input.error) {
      await this.options.audit(scope, 'calendar.oauth.denied', { mode });
      throw calendarError('CALENDAR_OAUTH_DENIED', 'Google Calendar consent was not granted.', 400);
    }
    if (!input.code) {
      throw calendarError(
        'CALENDAR_OAUTH_INVALID',
        'Google Calendar authorization code is required.',
        400
      );
    }
    await this.options.audit(scope, 'calendar.oauth.exchange_requested', { mode });
    this.unchanged(scope, pending.epoch);
    const tokens = await this.providerCall(() =>
      this.options.provider!.exchange({
        code: input.code!,
        codeVerifier: pending.verifier,
        clientId: this.options.clientId!,
        redirectUri: this.options.redirectUri!
      })
    );
    const grantedScopes = tokens
      ? parseGrantedCalendarScopes(tokens.scope, this.supportsWriteScope)
      : null;
    if (
      !tokens ||
      typeof tokens.accessToken !== 'string' ||
      !tokens.accessToken ||
      tokens.accessToken.length > 16384 ||
      (tokens.refreshToken !== undefined &&
        (typeof tokens.refreshToken !== 'string' ||
          !tokens.refreshToken ||
          tokens.refreshToken.length > 16384)) ||
      !grantedScopes ||
      !Number.isFinite(tokens.expiresIn) ||
      tokens.expiresIn <= 0 ||
      tokens.expiresIn > 86400
    ) {
      throw calendarError(
        'CALENDAR_PROVIDER_INVALID',
        'Google Calendar provider returned an invalid authorization result.',
        502
      );
    }
    const identity = await this.resolveCalendarIdentity(tokens.accessToken);
    await this.options.audit(scope, 'calendar.oauth.authorized', { mode, scopes: grantedScopes });
    this.unchanged(scope, pending.epoch);
    const epoch = randomBytes(32).toString('base64url');
    this.options.vault!.set(scope, 'epoch', epoch);
    this.options.vault!.set(scope, 'connection', {
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        scope: grantedScopes.join(' '),
        expiresIn: tokens.expiresIn
      },
      expiresAt: this.now() + tokens.expiresIn * 1000,
      verifiedAt: new Date(this.now()).toISOString(),
      epoch,
      ...identity
    });
    return this.status(scope);
  }

  async disconnect(scope: AuthenticatedScope): Promise<GoogleCalendarStatus> {
    this.authorize(scope, 'calendar.connection.disconnect');
    if (!this.ready) return this.status(scope);
    const mode = this.activeMode;
    const previous = this.options.vault!.get<Connection>(scope, 'connection');
    this.options.vault!.set(scope, 'epoch', randomBytes(32).toString('base64url'));
    this.options.vault!.delete(scope, 'connection');
    this.options.vault!.delete(scope, 'pending');
    if (mode === 'live' && previous && typeof this.options.provider?.revoke === 'function') {
      try {
        await this.options.provider.revoke({
          token: previous.tokens.refreshToken ?? previous.tokens.accessToken
        });
      } catch {
        // Best-effort provider revocation; local vault wipe already completed.
      }
    }
    await this.options.audit(scope, 'calendar.connection.disconnected', {
      mode,
      localOnly: mode === 'mock'
    });
    return this.status(scope);
  }

  private async connection(scope: AuthenticatedScope): Promise<Connection> {
    this.configured();
    let connection = this.options.vault!.get<Connection>(scope, 'connection');
    if (!connection) {
      throw calendarError('CALENDAR_DISCONNECTED', 'Google Calendar is disconnected.');
    }
    if (connection.expiresAt <= this.now()) {
      const refreshed = await this.tryRefresh(scope, connection);
      if (!refreshed) {
        throw calendarError(
          'CALENDAR_RECONNECT_REQUIRED',
          'Google Calendar connection requires authorization.'
        );
      }
      connection = refreshed;
    }
    this.unchanged(scope, connection.epoch);
    return connection;
  }

  private async providerCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw calendarError(
        'CALENDAR_PROVIDER_ERROR',
        'Google Calendar provider request failed.',
        502
      );
    }
  }

  private recordOwnerSavedEvent(
    scope: AuthenticatedScope,
    eventId: string,
    origin: GoogleCalendarEventOrigin = 'thaara_chat',
    reminders?: GoogleCalendarReminders
  ): void {
    if (!this.options.vault || !eventId) return;
    const existing =
      this.options.vault.get<
        Record<
          string,
          {
            origin: GoogleCalendarEventOrigin;
            savedAt: string;
            reminders?: GoogleCalendarReminders;
          }
        >
      >(scope, 'owner_events') ?? {};
    const safeOrigin =
      origin === 'thaara_chat' ||
      origin === 'thaara_ui' ||
      origin === 'thaara_gmail_explicit'
        ? origin
        : 'thaara_chat';
    existing[eventId] = {
      origin: safeOrigin,
      savedAt: new Date(this.now()).toISOString(),
      ...(reminders ? { reminders } : existing[eventId]?.reminders ? { reminders: existing[eventId]!.reminders } : {})
    };
    this.options.vault.set(scope, 'owner_events', existing);
  }

  private enrichEventOwnership(
    scope: AuthenticatedScope,
    event: GoogleCalendarEvent
  ): GoogleCalendarEvent {
    const ledger = this.options.vault?.get<
      Record<
        string,
        {
          origin: GoogleCalendarEventOrigin;
          savedAt: string;
          reminders?: GoogleCalendarReminders;
        }
      >
    >(scope, 'owner_events');
    const entry = ledger?.[event.id];
    const providerOrigin =
      event.thaaraOrigin === 'thaara_chat' ||
      event.thaaraOrigin === 'thaara_ui' ||
      event.thaaraOrigin === 'thaara_gmail_explicit'
        ? event.thaaraOrigin
        : undefined;
    const resolvedOrigin: GoogleCalendarEventOrigin =
      entry?.origin ?? providerOrigin ?? 'external_calendar';
    const ownerSaved = resolvedOrigin !== 'external_calendar';
    const resolvedReminders = event.reminders ?? entry?.reminders;
    return {
      ...event,
      thaaraOrigin: resolvedOrigin,
      ownerSaved,
      ...(resolvedReminders ? { reminders: resolvedReminders } : {})
    };
  }

  async listEvents(
    scope: AuthenticatedScope,
    input: GoogleCalendarListEvents
  ): Promise<GoogleCalendarListEventsResponse> {
    this.authorize(scope, 'calendar.events.list', input);
    const { startMs, endMs } = this.validateWindow(input.windowStart, input.windowEnd);
    const timeZone = validateIanaTimeZone(input.timeZone ?? 'UTC');
    const limit = input.limit ?? 20;
    const includeCancelled = input.includeCancelled ?? false;
    const connection = await this.connection(scope);
    const mode = this.activeMode;
    await this.options.audit(scope, 'calendar.events.list_requested', {
      mode,
      timeZone,
      includeCancelled
    });
    this.unchanged(scope, connection.epoch);
    const raw = await this.providerCall(() =>
      this.options.provider!.listEvents({
        accessToken: connection.tokens.accessToken,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        timeZone,
        query: input.query,
        includeCancelled,
        limit,
        pageToken: input.pageToken
      })
    );
    const source = raw as Record<string, unknown> | null;
    if (!source || !Array.isArray(source.events)) {
      throw calendarError(
        'CALENDAR_PROVIDER_INVALID',
        'Google Calendar provider returned an invalid event list.',
        502
      );
    }
    const rawEvents = source.events.map((item) =>
      this.enrichEventOwnership(scope, sanitizeEvent(item, mode))
    );
    const seenEventIds = new Set<string>();
    const events: GoogleCalendarEvent[] = [];
    for (const ev of rawEvents) {
      if (seenEventIds.has(ev.id)) continue;
      seenEventIds.add(ev.id);
      events.push(ev);
    }
    for (const ev of events) {
      const evStart = Date.parse(ev.startAt);
      const evEnd = Date.parse(ev.endAt);
      if (evEnd <= startMs || evStart >= endMs) {
        throw calendarError(
          'CALENDAR_PROVIDER_INVALID',
          'Google Calendar provider returned an event outside the requested window.',
          502
        );
      }
      if (!includeCancelled && ev.status === 'cancelled') {
        throw calendarError(
          'CALENDAR_PROVIDER_INVALID',
          'Google Calendar provider returned cancelled events when includeCancelled is false.',
          502
        );
      }
    }
    const sorted = [...events].sort(
      (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.id.localeCompare(b.id)
    );
    const result: GoogleCalendarListEventsResponse = {
      events: sorted,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      timeZone,
      ...(source.nextPageToken !== undefined
        ? { nextPageToken: source.nextPageToken as string }
        : {}),
      untrusted: true,
      mode
    };
    if (!listResponseCheck.Check(result) || result.events.length > limit) {
      throw calendarError(
        'CALENDAR_PROVIDER_INVALID',
        'Google Calendar provider returned an invalid event list response.',
        502
      );
    }
    await this.options.audit(scope, 'calendar.events.list_completed', {
      mode,
      count: result.events.length
    });
    this.unchanged(scope, connection.epoch);
    return result;
  }

  async readEvent(scope: AuthenticatedScope, eventId: string): Promise<GoogleCalendarEvent> {
    this.authorize(scope, 'calendar.events.read', { eventId });
    const connection = await this.connection(scope);
    const mode = this.activeMode;
    await this.options.audit(scope, 'calendar.events.read_requested', { mode });
    this.unchanged(scope, connection.epoch);
    const raw = await this.providerCall(() =>
      this.options.provider!.readEvent({
        accessToken: connection.tokens.accessToken,
        eventId
      })
    );
    const event = this.enrichEventOwnership(scope, sanitizeEvent(raw, mode));
    if (event.id !== eventId) {
      throw calendarError(
        'CALENDAR_PROVIDER_INVALID',
        'Google Calendar provider returned a mismatched event ID.',
        502
      );
    }
    await this.options.audit(scope, 'calendar.events.read_completed', { mode });
    this.unchanged(scope, connection.epoch);
    return event;
  }

  async readAgenda(
    scope: AuthenticatedScope,
    input: GoogleCalendarAgendaQuery
  ): Promise<GoogleCalendarAgendaResponse> {
    this.authorize(scope, 'calendar.agenda.read', input);
    const { startMs, endMs } = this.validateWindow(input.windowStart, input.windowEnd);
    const timeZone = validateIanaTimeZone(input.timeZone);
    const limit = input.limit ?? 50;
    const includeCancelled = input.includeCancelled ?? false;
    const connection = await this.connection(scope);
    const mode = this.activeMode;
    await this.options.audit(scope, 'calendar.agenda.read_requested', {
      mode,
      timeZone,
      includeCancelled
    });
    this.unchanged(scope, connection.epoch);
    const raw = await this.providerCall(() =>
      this.options.provider!.listEvents({
        accessToken: connection.tokens.accessToken,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        timeZone,
        includeCancelled,
        limit
      })
    );
    const source = raw as Record<string, unknown> | null;
    if (!source || !Array.isArray(source.events)) {
      throw calendarError(
        'CALENDAR_PROVIDER_INVALID',
        'Google Calendar provider returned an invalid agenda payload.',
        502
      );
    }
    const rawEvents = source.events.map((item) =>
      this.enrichEventOwnership(scope, sanitizeEvent(item, mode))
    );
    const seenEventIds = new Set<string>();
    const events: GoogleCalendarEvent[] = [];
    for (const ev of rawEvents) {
      if (seenEventIds.has(ev.id)) continue;
      seenEventIds.add(ev.id);
      events.push(ev);
    }
    for (const ev of events) {
      const evStart = Date.parse(ev.startAt);
      const evEnd = Date.parse(ev.endAt);
      if (evEnd <= startMs || evStart >= endMs) {
        throw calendarError(
          'CALENDAR_PROVIDER_INVALID',
          'Google Calendar provider returned an agenda event outside the requested window.',
          502
        );
      }
      if (!includeCancelled && ev.status === 'cancelled') {
        throw calendarError(
          'CALENDAR_PROVIDER_INVALID',
          'Google Calendar provider returned cancelled agenda events when includeCancelled is false.',
          502
        );
      }
    }
    const sorted = [...events].sort(
      (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.id.localeCompare(b.id)
    );
    const activeTimed = sorted.filter((ev) => !ev.allDay && ev.status !== 'cancelled');
    const conflictIds = new Set<string>();
    for (let i = 0; i < activeTimed.length; i++) {
      const current = activeTimed[i]!;
      const curEnd = Date.parse(current.endAt);
      for (let j = i + 1; j < activeTimed.length; j++) {
        const next = activeTimed[j]!;
        if (Date.parse(next.startAt) < curEnd) {
          conflictIds.add(current.id);
          conflictIds.add(next.id);
        } else {
          break;
        }
      }
    }
    const dayMap = new Map<string, GoogleCalendarEvent[]>();
    for (const ev of sorted) {
      const anchorIso =
        Date.parse(ev.startAt) < startMs ? new Date(startMs).toISOString() : ev.startAt;
      const localDate = formatLocalDateInTimeZone(anchorIso, timeZone);
      const group = dayMap.get(localDate) ?? [];
      group.push(ev);
      dayMap.set(localDate, group);
    }
    const days = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([localDate, dayEvents]) => ({ localDate, events: dayEvents }));

    const result: GoogleCalendarAgendaResponse = {
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      timeZone,
      totalEvents: sorted.length,
      conflictEventIds: Array.from(conflictIds),
      days,
      n8nContext: {
        connector: 'google_calendar',
        operation: 'read_agenda_snapshot',
        readOnly: true,
        timeZone,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        eventIds: sorted.map((ev) => ev.id)
      },
      untrusted: true,
      mode
    };
    if (!agendaResponseCheck.Check(result) || result.totalEvents > limit) {
      throw calendarError(
        'CALENDAR_PROVIDER_INVALID',
        'Google Calendar provider returned an invalid agenda response.',
        502
      );
    }
    await this.options.audit(scope, 'calendar.agenda.read_completed', {
      mode,
      totalEvents: result.totalEvents,
      conflictCount: result.conflictEventIds.length
    });
    this.unchanged(scope, connection.epoch);
    return result;
  }

  async prepareBriefing(
    scope: AuthenticatedScope,
    input: GoogleCalendarBriefingQuery
  ): Promise<GoogleCalendarBriefingResponse> {
    this.authorize(scope, 'calendar.briefing.prepare', input);
    const { startMs, endMs } = this.validateWindow(input.windowStart, input.windowEnd);
    const timeZone = validateIanaTimeZone(input.timeZone);
    const limit = input.limit ?? 50;
    const includeCancelled = input.includeCancelled ?? false;
    const generateBlueprint = input.generateWorkflowBlueprint ?? true;
    const workflowName = (input.workflowName ?? 'Daily Executive Calendar Briefing').trim();
    if (
      workflowName.length < 3 ||
      workflowName.length > 120 ||
      detectWorkflowSecurityViolations([workflowName]).length > 0
    ) {
      throw calendarError(
        'CALENDAR_INVALID_INPUT',
        'Invalid or unsafe calendar briefing workflowName.',
        400
      );
    }

    const connection = await this.connection(scope);
    const mode = this.activeMode;
    await this.options.audit(scope, 'calendar.briefing.requested', {
      mode,
      timeZone,
      includeCancelled,
      generateBlueprint
    });
    this.unchanged(scope, connection.epoch);

    const raw = await this.providerCall(() =>
      this.options.provider!.listEvents({
        accessToken: connection.tokens.accessToken,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        timeZone,
        includeCancelled,
        limit
      })
    );
    const source = raw as Record<string, unknown> | null;
    if (!source || !Array.isArray(source.events)) {
      throw calendarError(
        'CALENDAR_PROVIDER_INVALID',
        'Google Calendar provider returned an invalid briefing payload.',
        502
      );
    }
    const rawEvents = source.events.map((item) => sanitizeEvent(item, mode));
    const seenEventIds = new Set<string>();
    const events: GoogleCalendarEvent[] = [];
    for (const ev of rawEvents) {
      if (seenEventIds.has(ev.id)) continue;
      seenEventIds.add(ev.id);
      events.push(ev);
    }
    for (const ev of events) {
      const evStart = Date.parse(ev.startAt);
      const evEnd = Date.parse(ev.endAt);
      if (evEnd <= startMs || evStart >= endMs) {
        throw calendarError(
          'CALENDAR_PROVIDER_INVALID',
          'Google Calendar provider returned a briefing event outside the requested window.',
          502
        );
      }
      if (!includeCancelled && ev.status === 'cancelled') {
        throw calendarError(
          'CALENDAR_PROVIDER_INVALID',
          'Google Calendar provider returned cancelled briefing events when includeCancelled is false.',
          502
        );
      }
    }
    const sorted = [...events].sort(
      (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.id.localeCompare(b.id)
    );
    const activeTimed = sorted.filter((ev) => !ev.allDay && ev.status !== 'cancelled');
    const conflictIds = new Set<string>();
    for (let i = 0; i < activeTimed.length; i++) {
      const current = activeTimed[i]!;
      const curEnd = Date.parse(current.endAt);
      for (let j = i + 1; j < activeTimed.length; j++) {
        const next = activeTimed[j]!;
        if (Date.parse(next.startAt) < curEnd) {
          conflictIds.add(current.id);
          conflictIds.add(next.id);
        } else {
          break;
        }
      }
    }

    const appointments: GoogleCalendarBriefingAppointment[] = sorted.map((ev) => {
      const snippet = sanitizeUntrustedDescriptionSnippet(ev.description);
      const anchorIso =
        Date.parse(ev.startAt) < startMs ? new Date(startMs).toISOString() : ev.startAt;
      return {
        id: ev.id,
        summary: ev.summary,
        startAt: ev.startAt,
        endAt: ev.endAt,
        localDate: formatLocalDateInTimeZone(anchorIso, timeZone),
        localTimeRange: formatLocalTimeRangeInTimeZone(ev, timeZone),
        ...(ev.location !== undefined ? { location: ev.location } : {}),
        status: ev.status,
        hasConflict: conflictIds.has(ev.id),
        attendeeCount: ev.attendees.length,
        ...(snippet !== undefined ? { descriptionSnippet: snippet } : {}),
        untrusted: true
      };
    });

    const n8nContext: GoogleCalendarN8nContext = {
      connector: 'google_calendar',
      operation: 'read_agenda_snapshot',
      readOnly: true,
      timeZone,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      eventIds: sorted.map((ev) => ev.id)
    };

    const conflictEventIds = Array.from(conflictIds);
    const headline =
      sorted.length === 0
        ? `No scheduled appointments in ${timeZone}.`
        : `${sorted.length} appointment${sorted.length === 1 ? '' : 's'} scheduled in ${timeZone} (${conflictEventIds.length} overlapping conflict${conflictEventIds.length === 1 ? '' : 's'}).`;

    const blueprintResult = generateBlueprint
      ? buildCalendarBriefingN8nBlueprint({
          workflowName,
          n8nContext,
          conflictEventIds
        })
      : undefined;

    const result: GoogleCalendarBriefingResponse = {
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      timeZone,
      totalEvents: sorted.length,
      conflictCount: conflictEventIds.length,
      conflictEventIds,
      headline,
      appointments,
      n8nContext,
      ...(blueprintResult
        ? {
            n8nBlueprint: blueprintResult.blueprint,
            workflowHash: blueprintResult.workflowHash
          }
        : {}),
      untrusted: true,
      mode
    };

    if (!briefingResponseCheck.Check(result) || result.totalEvents > limit) {
      throw calendarError(
        'CALENDAR_PROVIDER_INVALID',
        'Google Calendar provider returned an invalid briefing response.',
        502
      );
    }

    await this.options.audit(scope, 'calendar.briefing.completed', {
      mode,
      totalEvents: result.totalEvents,
      conflictCount: result.conflictCount,
      blueprintGenerated: Boolean(blueprintResult)
    });
    this.unchanged(scope, connection.epoch);
    return result;
  }

  private resolveConnectedCalendarIdentityFromStatus(status: GoogleCalendarStatus): string | null {
    return (
      normalizeConnectedCalendarEmail(status.connectedEmail) ??
      sanitizeCalendarSummary(status.connectedCalendarSummary)
    );
  }

  private async ensureConnectionCalendarIdentity(
    scope: AuthenticatedScope,
    connection: Connection
  ): Promise<{ connection: Connection; connectedCalendar: string | null }> {
    let current = connection;
    let connectedCalendar =
      normalizeConnectedCalendarEmail(current.connectedEmail) ??
      sanitizeCalendarSummary(current.connectedCalendarSummary);
    if (!connectedCalendar && typeof this.options.provider?.getPrimaryCalendar === 'function') {
      const identity = await this.resolveCalendarIdentity(current.tokens.accessToken);
      if (
        (identity.connectedEmail || identity.connectedCalendarSummary) &&
        this.epoch(scope) === current.epoch
      ) {
        current = {
          ...current,
          ...identity
        };
        this.options.vault!.set(scope, 'connection', current);
        connectedCalendar =
          normalizeConnectedCalendarEmail(current.connectedEmail) ??
          sanitizeCalendarSummary(current.connectedCalendarSummary);
      }
    }
    return { connection: current, connectedCalendar };
  }

  async writeReadiness(
    scope: AuthenticatedScope,
    kind: 'create' | 'reschedule' | 'cancel' = 'create'
  ): Promise<GoogleCalendarWriteReadiness> {
    const status = await this.status(scope);
    const providerSupports =
      kind === 'create'
        ? typeof this.options.provider?.createEvent === 'function'
        : kind === 'reschedule'
          ? typeof this.options.provider?.updateEvent === 'function'
          : typeof this.options.provider?.cancelEvent === 'function';
    if (!status.configured || status.status === 'not_configured' || !providerSupports) {
      return { ready: false, reason: 'not_configured', connectedCalendar: null, status };
    }
    if (status.status === 'disconnected') {
      return { ready: false, reason: 'disconnected', connectedCalendar: null, status };
    }
    if (status.status === 'reconnect_required') {
      return { ready: false, reason: 'reconnect_required', connectedCalendar: null, status };
    }
    const connectedCalendar = this.resolveConnectedCalendarIdentityFromStatus(status);
    if (!status.scopes.includes(GOOGLE_CALENDAR_EVENTS_OWNED)) {
      return {
        ready: false,
        reason: 'write_permission_missing',
        connectedCalendar,
        status
      };
    }
    if (!connectedCalendar) {
      return { ready: false, reason: 'account_unverified', connectedCalendar: null, status };
    }
    return { ready: true, reason: 'ready', connectedCalendar, status };
  }

  async findConflicts(
    scope: AuthenticatedScope,
    input: {
      startAt: string;
      endAt: string;
      timeZone: string;
      excludeEventId?: string;
    }
  ): Promise<GoogleCalendarConflictSummary[]> {
    const timeZone = validateIanaTimeZone(input.timeZone);
    const startMs = parseStrictRfc3339(input.startAt, 'startAt');
    const endMs = parseStrictRfc3339(input.endAt, 'endAt');
    if (endMs <= startMs) {
      throw calendarError(
        'CALENDAR_INVALID_RANGE',
        'endAt must be strictly after startAt.',
        400
      );
    }
    const windowStart = new Date(startMs - 12 * 60 * 60 * 1000).toISOString().replace('.000Z', 'Z');
    const windowEnd = new Date(
      Math.min(startMs + MAX_WINDOW_MS - 12 * 60 * 60 * 1000, endMs + 12 * 60 * 60 * 1000)
    )
      .toISOString()
      .replace('.000Z', 'Z');
    const listed = await this.listEvents(scope, {
      windowStart,
      windowEnd,
      timeZone,
      includeCancelled: false,
      limit: 50
    });
    return listed.events
      .filter((ev) => {
        if (ev.allDay || ev.status === 'cancelled') return false;
        if (input.excludeEventId && ev.id === input.excludeEventId) return false;
        const evStart = Date.parse(ev.startAt);
        const evEnd = Date.parse(ev.endAt);
        return evStart < endMs && evEnd > startMs;
      })
      .map((ev) => ({
        id: ev.id,
        summary: ev.summary,
        startAt: ev.startAt,
        endAt: ev.endAt,
        localTimeRange: formatLocalTimeRangeInTimeZone(ev, timeZone)
      }));
  }

  async createEvent(
    scope: AuthenticatedScope,
    input: GoogleCalendarCreateEventInput,
    approvedRequest: ApprovalRequest,
    idempotencyKey: string
  ): Promise<GoogleCalendarMutationReceipt> {
    if (!createEventInputCheck.Check(input)) {
      throw calendarError('CALENDAR_INVALID_INPUT', 'Meeting details failed validation.', 400);
    }
    const timeZone = validateIanaTimeZone(input.timeZone);
    const startMs = parseStrictRfc3339(input.startAt, 'startAt');
    const endMs = parseStrictRfc3339(input.endAt, 'endAt');
    if (endMs <= startMs) {
      throw calendarError(
        'CALENDAR_INVALID_RANGE',
        'Meeting end time must be after start time.',
        400
      );
    }
    if (
      !approvedRequest ||
      approvedRequest.workspaceId !== scope.workspaceId ||
      approvedRequest.requesterUserId !== scope.userId ||
      approvedRequest.actionName !== GOOGLE_CALENDAR_CREATE_EVENT_ACTION
    ) {
      throw new ForbiddenError('Calendar approval is bound to a different user, workspace, or action.');
    }
    const canonicalHash = computeCanonicalParameterHash(input as unknown as Record<string, unknown>);
    const approvedHash = computeCanonicalParameterHash(approvedRequest.actionParams ?? {});
    if (approvedHash !== canonicalHash || approvedRequest.status !== 'approved') {
      throw new ForbiddenError(
        'Calendar approval does not match the exact meeting payload or is not approved.'
      );
    }
    this.authorize(
      scope,
      GOOGLE_CALENDAR_CREATE_EVENT_ACTION,
      input as unknown as Record<string, unknown>,
      approvedRequest,
      idempotencyKey
    );

    const rawConnection = await this.connection(scope);
    const mode = this.activeMode;
    const grantedScopes = parseGrantedCalendarScopes(rawConnection.tokens.scope, true) ?? [];
    if (!grantedScopes.includes(GOOGLE_CALENDAR_EVENTS_OWNED)) {
      await this.options.audit(scope, 'calendar.events.create_denied_scope', {
        mode,
        scopes: grantedScopes
      });
      throw calendarError(
        'CALENDAR_WRITE_SCOPE_REQUIRED',
        'Your Google Calendar connection only has read-only access. Please disconnect and reconnect Google Calendar to grant scheduling permission (calendar.events.owned).',
        403
      );
    }
    const { connection, connectedCalendar } = await this.ensureConnectionCalendarIdentity(
      scope,
      rawConnection
    );
    if (
      !connectedCalendar ||
      connectedCalendar.toLowerCase() !== input.connectedCalendar.toLowerCase()
    ) {
      await this.options.audit(scope, 'calendar.events.create_denied_account', {
        mode,
        expectedCalendar: input.connectedCalendar,
        actualCalendar: connectedCalendar
      });
      throw calendarError(
        'CALENDAR_ACCOUNT_MISMATCH',
        'Connected Google Calendar account changed after this meeting was prepared. Please prepare it again.',
        409
      );
    }
    if (typeof this.options.provider?.createEvent !== 'function') {
      throw calendarError(
        'CALENDAR_WRITE_NOT_SUPPORTED',
        'Google Calendar provider does not support creating meetings.',
        503
      );
    }

    const lockKey = `cal_mut_lock:${approvedRequest.id}`;
    if (this.options.vault!.get<{ status: string }>(scope, lockKey)) {
      throw calendarError(
        'CALENDAR_MUTATION_ALREADY_PROCESSED',
        'This approved meeting was already processed and cannot be scheduled again.',
        409
      );
    }
    this.options.vault!.set(scope, lockKey, {
      status: 'in_flight',
      startedAt: new Date(this.now()).toISOString()
    });
    await this.options.audit(scope, 'calendar.events.create_requested', {
      mode,
      approvalId: approvedRequest.id,
      summary: input.summary,
      startAt: input.startAt,
      endAt: input.endAt,
      timeZone,
      attendeeCount: input.attendees?.length ?? 0,
      sendUpdates: input.sendUpdates,
      ...(input.reminders ? { reminders: input.reminders } : {}),
      ...(input.origin ? { origin: input.origin } : {}),
      connectedCalendar
    });
    this.unchanged(scope, connection.epoch);

    try {
      const raw = await this.options.provider.createEvent({
        accessToken: connection.tokens.accessToken,
        summary: input.summary,
        ...(input.description ? { description: input.description } : {}),
        ...(input.location ? { location: input.location } : {}),
        startAt: input.startAt,
        endAt: input.endAt,
        timeZone,
        ...(input.attendees && input.attendees.length > 0 ? { attendees: input.attendees } : {}),
        sendUpdates: input.sendUpdates,
        ...(input.reminders ? { reminders: input.reminders } : {}),
        ...(input.origin ? { origin: input.origin } : {})
      });
      const providerEventId =
        typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : undefined;
      if (!providerEventId) {
        this.options.vault!.set(scope, lockKey, { status: 'unverified' });
        await this.options.audit(scope, 'calendar.events.create_unverified', {
          mode,
          approvalId: approvedRequest.id,
          reason: 'missing_provider_event_id'
        });
        throw calendarError(
          'CALENDAR_MUTATION_UNVERIFIED',
          'Google Calendar did not confirm this meeting. Automatic retry is blocked to prevent a duplicate meeting.',
          502
        );
      }
      const savedReminders = raw?.reminders ?? input.reminders;
      const savedOrigin: GoogleCalendarEventOrigin = input.origin ?? 'thaara_chat';
      this.recordOwnerSavedEvent(scope, providerEventId, savedOrigin, savedReminders);
      const reminderNote = savedReminders
        ? ` Reminder saved in Google Calendar (${formatCalendarRemindersSummary(savedReminders)}); actual notification delivery depends on your Google Calendar and device notification settings.`
        : '';
      const receipt: GoogleCalendarMutationReceipt = {
        connectorName: 'google_calendar',
        mode,
        operation: 'create',
        status: 'event_created',
        providerEventId,
        summary: input.summary,
        startAt: input.startAt,
        endAt: input.endAt,
        timeZone,
        ...(input.attendees && input.attendees.length > 0 ? { attendees: input.attendees } : {}),
        sendUpdates: input.sendUpdates,
        ...(savedReminders ? { reminders: savedReminders } : {}),
        origin: savedOrigin,
        connectedCalendar,
        completedAt: new Date(this.now()).toISOString(),
        note: `Google Calendar confirmed creation of the event (events.insert).${reminderNote}`
      };
      if (!mutationReceiptCheck.Check(receipt)) {
        this.options.vault!.set(scope, lockKey, { status: 'unverified' });
        throw calendarError(
          'CALENDAR_MUTATION_UNVERIFIED',
          'Google Calendar creation receipt failed verification.',
          502
        );
      }
      this.options.vault!.set(scope, lockKey, { status: 'completed', receipt });
      await this.options.audit(scope, 'calendar.events.create_completed', {
        mode,
        approvalId: approvedRequest.id,
        providerEventId,
        status: receipt.status,
        ...(savedReminders ? { reminders: savedReminders } : {}),
        origin: savedOrigin
      });
      return receipt;
    } catch (err) {
      if (err instanceof AppError && err.code === 'CALENDAR_MUTATION_UNVERIFIED') throw err;
      const statusHint = (err as { statusCode?: number })?.statusCode;
      const uncertain =
        Boolean((err as { uncertain?: boolean })?.uncertain) ||
        (statusHint !== undefined && statusHint >= 500);
      if (uncertain) {
        this.options.vault!.set(scope, lockKey, { status: 'unverified' });
        await this.options.audit(scope, 'calendar.events.create_unverified', {
          mode,
          approvalId: approvedRequest.id,
          reason: err instanceof Error ? err.message : 'provider_uncertain_outcome'
        });
        throw calendarError(
          'CALENDAR_MUTATION_UNVERIFIED',
          'We could not confirm whether Google Calendar created this meeting. Automatic retry is disabled to prevent a duplicate meeting.',
          502
        );
      }
      this.options.vault!.set(scope, lockKey, { status: 'failed' });
      await this.options.audit(scope, 'calendar.events.create_failed', {
        mode,
        approvalId: approvedRequest.id,
        reason: err instanceof Error ? err.message : 'provider_rejected'
      });
      throw calendarError(
        'CALENDAR_MUTATION_FAILED',
        err instanceof AppError ? err.message : 'Google Calendar rejected the meeting creation.',
        err instanceof AppError ? err.statusCode : 502
      );
    }
  }

  async rescheduleEvent(
    scope: AuthenticatedScope,
    input: GoogleCalendarRescheduleEventInput,
    approvedRequest: ApprovalRequest,
    idempotencyKey: string
  ): Promise<GoogleCalendarMutationReceipt> {
    if (!rescheduleEventInputCheck.Check(input)) {
      throw calendarError('CALENDAR_INVALID_INPUT', 'Reschedule details failed validation.', 400);
    }
    const timeZone = validateIanaTimeZone(input.timeZone);
    const expectedStartMs = parseStrictRfc3339(input.expectedStartAt, 'expectedStartAt');
    const expectedEndMs = parseStrictRfc3339(input.expectedEndAt, 'expectedEndAt');
    const newStartMs = parseStrictRfc3339(input.newStartAt, 'newStartAt');
    const newEndMs = parseStrictRfc3339(input.newEndAt, 'newEndAt');
    if (expectedEndMs <= expectedStartMs || newEndMs <= newStartMs) {
      throw calendarError(
        'CALENDAR_INVALID_RANGE',
        'Meeting end time must be after start time.',
        400
      );
    }
    if (
      !approvedRequest ||
      approvedRequest.workspaceId !== scope.workspaceId ||
      approvedRequest.requesterUserId !== scope.userId ||
      approvedRequest.actionName !== GOOGLE_CALENDAR_RESCHEDULE_EVENT_ACTION
    ) {
      throw new ForbiddenError('Calendar approval is bound to a different user, workspace, or action.');
    }
    const canonicalHash = computeCanonicalParameterHash(input as unknown as Record<string, unknown>);
    const approvedHash = computeCanonicalParameterHash(approvedRequest.actionParams ?? {});
    if (approvedHash !== canonicalHash || approvedRequest.status !== 'approved') {
      throw new ForbiddenError(
        'Calendar approval does not match the exact reschedule payload or is not approved.'
      );
    }
    this.authorize(
      scope,
      GOOGLE_CALENDAR_RESCHEDULE_EVENT_ACTION,
      input as unknown as Record<string, unknown>,
      approvedRequest,
      idempotencyKey
    );

    const rawConnection = await this.connection(scope);
    const mode = this.activeMode;
    const grantedScopes = parseGrantedCalendarScopes(rawConnection.tokens.scope, true) ?? [];
    if (!grantedScopes.includes(GOOGLE_CALENDAR_EVENTS_OWNED)) {
      await this.options.audit(scope, 'calendar.events.reschedule_denied_scope', {
        mode,
        scopes: grantedScopes
      });
      throw calendarError(
        'CALENDAR_WRITE_SCOPE_REQUIRED',
        'Your Google Calendar connection only has read-only access. Please disconnect and reconnect Google Calendar to grant scheduling permission (calendar.events.owned).',
        403
      );
    }
    const { connection, connectedCalendar } = await this.ensureConnectionCalendarIdentity(
      scope,
      rawConnection
    );
    if (
      !connectedCalendar ||
      connectedCalendar.toLowerCase() !== input.connectedCalendar.toLowerCase()
    ) {
      await this.options.audit(scope, 'calendar.events.reschedule_denied_account', {
        mode,
        expectedCalendar: input.connectedCalendar,
        actualCalendar: connectedCalendar
      });
      throw calendarError(
        'CALENDAR_ACCOUNT_MISMATCH',
        'Connected Google Calendar account changed after this reschedule was prepared. Please prepare it again.',
        409
      );
    }
    if (typeof this.options.provider?.updateEvent !== 'function') {
      throw calendarError(
        'CALENDAR_WRITE_NOT_SUPPORTED',
        'Google Calendar provider does not support rescheduling meetings.',
        503
      );
    }

    const lockKey = `cal_mut_lock:${approvedRequest.id}`;
    if (this.options.vault!.get<{ status: string }>(scope, lockKey)) {
      throw calendarError(
        'CALENDAR_MUTATION_ALREADY_PROCESSED',
        'This approved reschedule was already processed and cannot be applied again.',
        409
      );
    }
    this.options.vault!.set(scope, lockKey, {
      status: 'in_flight',
      startedAt: new Date(this.now()).toISOString()
    });
    this.unchanged(scope, connection.epoch);

    let currentEvent: GoogleCalendarEvent;
    try {
      const rawCurrent = await this.options.provider!.readEvent({
        accessToken: connection.tokens.accessToken,
        eventId: input.eventId
      });
      currentEvent = sanitizeEvent(rawCurrent, mode);
    } catch {
      this.options.vault!.set(scope, lockKey, { status: 'failed' });
      await this.options.audit(scope, 'calendar.events.reschedule_denied_stale', {
        mode,
        approvalId: approvedRequest.id,
        eventId: input.eventId,
        reason: 'event_not_found_or_unreadable'
      });
      throw calendarError(
        'CALENDAR_EVENT_CHANGED_SINCE_PREVIEW',
        'This meeting could not be found or changed in Google Calendar since your preview was prepared.',
        409
      );
    }

    if (
      currentEvent.id !== input.eventId ||
      currentEvent.status === 'cancelled' ||
      currentEvent.status !== input.expectedStatus ||
      Date.parse(currentEvent.startAt) !== expectedStartMs ||
      Date.parse(currentEvent.endAt) !== expectedEndMs ||
      currentEvent.summary.trim() !== input.summary.trim()
    ) {
      this.options.vault!.set(scope, lockKey, { status: 'failed' });
      await this.options.audit(scope, 'calendar.events.reschedule_denied_stale', {
        mode,
        approvalId: approvedRequest.id,
        eventId: input.eventId,
        expectedStartAt: input.expectedStartAt,
        actualStartAt: currentEvent.startAt,
        expectedEndAt: input.expectedEndAt,
        actualEndAt: currentEvent.endAt,
        expectedStatus: input.expectedStatus,
        actualStatus: currentEvent.status
      });
      throw calendarError(
        'CALENDAR_EVENT_CHANGED_SINCE_PREVIEW',
        'This meeting changed in Google Calendar after your preview was prepared. Please review the updated calendar and try again.',
        409
      );
    }

    await this.options.audit(scope, 'calendar.events.reschedule_requested', {
      mode,
      approvalId: approvedRequest.id,
      eventId: input.eventId,
      previousStartAt: input.expectedStartAt,
      previousEndAt: input.expectedEndAt,
      newStartAt: input.newStartAt,
      newEndAt: input.newEndAt,
      timeZone,
      sendUpdates: input.sendUpdates,
      ...(input.reminders ? { reminders: input.reminders } : {}),
      connectedCalendar
    });
    this.unchanged(scope, connection.epoch);

    try {
      const raw = await this.options.provider.updateEvent({
        accessToken: connection.tokens.accessToken,
        eventId: input.eventId,
        summary: input.summary,
        newStartAt: input.newStartAt,
        newEndAt: input.newEndAt,
        timeZone,
        sendUpdates: input.sendUpdates,
        ...(input.reminders ? { reminders: input.reminders } : {})
      });
      const providerEventId =
        typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : undefined;
      if (!providerEventId) {
        this.options.vault!.set(scope, lockKey, { status: 'unverified' });
        await this.options.audit(scope, 'calendar.events.reschedule_unverified', {
          mode,
          approvalId: approvedRequest.id,
          eventId: input.eventId,
          reason: 'missing_provider_event_id'
        });
        throw calendarError(
          'CALENDAR_MUTATION_UNVERIFIED',
          'Google Calendar did not confirm this reschedule. Automatic retry is blocked to prevent duplicate updates.',
          502
        );
      }
      const savedReminders = raw?.reminders ?? input.reminders;
      if (savedReminders) {
        const ledger = this.options.vault?.get<
          Record<
            string,
            {
              origin: GoogleCalendarEventOrigin;
              savedAt: string;
              reminders?: GoogleCalendarReminders;
            }
          >
        >(scope, 'owner_events');
        if (ledger?.[providerEventId]) {
          this.recordOwnerSavedEvent(
            scope,
            providerEventId,
            ledger[providerEventId]!.origin,
            savedReminders
          );
        }
      }
      const reminderNote = savedReminders
        ? ` Reminder saved in Google Calendar (${formatCalendarRemindersSummary(savedReminders)}); actual notification delivery depends on your Google Calendar and device notification settings.`
        : '';
      const receipt: GoogleCalendarMutationReceipt = {
        connectorName: 'google_calendar',
        mode,
        operation: 'reschedule',
        status: 'event_rescheduled',
        providerEventId,
        summary: input.summary,
        startAt: input.newStartAt,
        endAt: input.newEndAt,
        previousStartAt: input.expectedStartAt,
        previousEndAt: input.expectedEndAt,
        timeZone,
        sendUpdates: input.sendUpdates,
        ...(savedReminders ? { reminders: savedReminders } : {}),
        connectedCalendar,
        completedAt: new Date(this.now()).toISOString(),
        note: `Google Calendar confirmed rescheduling of the event (events.patch).${reminderNote}`
      };
      if (!mutationReceiptCheck.Check(receipt)) {
        this.options.vault!.set(scope, lockKey, { status: 'unverified' });
        throw calendarError(
          'CALENDAR_MUTATION_UNVERIFIED',
          'Google Calendar reschedule receipt failed verification.',
          502
        );
      }
      this.options.vault!.set(scope, lockKey, { status: 'completed', receipt });
      await this.options.audit(scope, 'calendar.events.reschedule_completed', {
        mode,
        approvalId: approvedRequest.id,
        providerEventId,
        status: receipt.status,
        ...(savedReminders ? { reminders: savedReminders } : {})
      });
      return receipt;
    } catch (err) {
      if (err instanceof AppError && err.code === 'CALENDAR_MUTATION_UNVERIFIED') throw err;
      const statusHint = (err as { statusCode?: number })?.statusCode;
      const uncertain =
        Boolean((err as { uncertain?: boolean })?.uncertain) ||
        (statusHint !== undefined && statusHint >= 500);
      if (uncertain) {
        this.options.vault!.set(scope, lockKey, { status: 'unverified' });
        await this.options.audit(scope, 'calendar.events.reschedule_unverified', {
          mode,
          approvalId: approvedRequest.id,
          eventId: input.eventId,
          reason: err instanceof Error ? err.message : 'provider_uncertain_outcome'
        });
        throw calendarError(
          'CALENDAR_MUTATION_UNVERIFIED',
          'We could not confirm whether Google Calendar updated this meeting. Automatic retry is disabled.',
          502
        );
      }
      this.options.vault!.set(scope, lockKey, { status: 'failed' });
      await this.options.audit(scope, 'calendar.events.reschedule_failed', {
        mode,
        approvalId: approvedRequest.id,
        eventId: input.eventId,
        reason: err instanceof Error ? err.message : 'provider_rejected'
      });
      throw calendarError(
        'CALENDAR_MUTATION_FAILED',
        err instanceof AppError ? err.message : 'Google Calendar rejected the reschedule request.',
        err instanceof AppError ? err.statusCode : 502
      );
    }
  }

  async cancelEvent(
    scope: AuthenticatedScope,
    input: GoogleCalendarCancelEventInput,
    approvedRequest: ApprovalRequest,
    idempotencyKey: string
  ): Promise<GoogleCalendarMutationReceipt> {
    if (!cancelEventInputCheck.Check(input)) {
      throw calendarError('CALENDAR_INVALID_INPUT', 'Cancellation details failed validation.', 400);
    }
    const timeZone = validateIanaTimeZone(input.timeZone);
    const expectedStartMs = parseStrictRfc3339(input.expectedStartAt, 'expectedStartAt');
    const expectedEndMs = parseStrictRfc3339(input.expectedEndAt, 'expectedEndAt');
    if (expectedEndMs <= expectedStartMs) {
      throw calendarError(
        'CALENDAR_INVALID_RANGE',
        'Expected meeting end time must be after start time.',
        400
      );
    }
    if (
      !approvedRequest ||
      approvedRequest.workspaceId !== scope.workspaceId ||
      approvedRequest.requesterUserId !== scope.userId ||
      approvedRequest.actionName !== GOOGLE_CALENDAR_CANCEL_EVENT_ACTION
    ) {
      throw new ForbiddenError('Calendar approval is bound to a different user, workspace, or action.');
    }
    const canonicalHash = computeCanonicalParameterHash(input as unknown as Record<string, unknown>);
    const approvedHash = computeCanonicalParameterHash(approvedRequest.actionParams ?? {});
    if (approvedHash !== canonicalHash || approvedRequest.status !== 'approved') {
      throw new ForbiddenError(
        'Calendar approval does not match the exact cancellation payload or is not approved.'
      );
    }
    this.authorize(
      scope,
      GOOGLE_CALENDAR_CANCEL_EVENT_ACTION,
      input as unknown as Record<string, unknown>,
      approvedRequest,
      idempotencyKey
    );

    const rawConnection = await this.connection(scope);
    const mode = this.activeMode;
    const grantedScopes = parseGrantedCalendarScopes(rawConnection.tokens.scope, true) ?? [];
    if (!grantedScopes.includes(GOOGLE_CALENDAR_EVENTS_OWNED)) {
      await this.options.audit(scope, 'calendar.events.cancel_denied_scope', {
        mode,
        scopes: grantedScopes
      });
      throw calendarError(
        'CALENDAR_WRITE_SCOPE_REQUIRED',
        'Your Google Calendar connection only has read-only access. Please disconnect and reconnect Google Calendar to grant scheduling permission (calendar.events.owned).',
        403
      );
    }
    const { connection, connectedCalendar } = await this.ensureConnectionCalendarIdentity(
      scope,
      rawConnection
    );
    if (
      !connectedCalendar ||
      connectedCalendar.toLowerCase() !== input.connectedCalendar.toLowerCase()
    ) {
      await this.options.audit(scope, 'calendar.events.cancel_denied_account', {
        mode,
        expectedCalendar: input.connectedCalendar,
        actualCalendar: connectedCalendar
      });
      throw calendarError(
        'CALENDAR_ACCOUNT_MISMATCH',
        'Connected Google Calendar account changed after this cancellation was prepared. Please prepare it again.',
        409
      );
    }
    if (typeof this.options.provider?.cancelEvent !== 'function') {
      throw calendarError(
        'CALENDAR_WRITE_NOT_SUPPORTED',
        'Google Calendar provider does not support cancelling meetings.',
        503
      );
    }

    const lockKey = `cal_mut_lock:${approvedRequest.id}`;
    if (this.options.vault!.get<{ status: string }>(scope, lockKey)) {
      throw calendarError(
        'CALENDAR_MUTATION_ALREADY_PROCESSED',
        'This approved cancellation was already processed and cannot be applied again.',
        409
      );
    }
    this.options.vault!.set(scope, lockKey, {
      status: 'in_flight',
      startedAt: new Date(this.now()).toISOString()
    });
    this.unchanged(scope, connection.epoch);

    let currentEvent: GoogleCalendarEvent;
    try {
      const rawCurrent = await this.options.provider!.readEvent({
        accessToken: connection.tokens.accessToken,
        eventId: input.eventId
      });
      currentEvent = sanitizeEvent(rawCurrent, mode);
    } catch {
      this.options.vault!.set(scope, lockKey, { status: 'failed' });
      await this.options.audit(scope, 'calendar.events.cancel_denied_stale', {
        mode,
        approvalId: approvedRequest.id,
        eventId: input.eventId,
        reason: 'event_not_found_or_unreadable'
      });
      throw calendarError(
        'CALENDAR_EVENT_CHANGED_SINCE_PREVIEW',
        'This meeting could not be found or changed in Google Calendar since your preview was prepared.',
        409
      );
    }

    if (
      currentEvent.id !== input.eventId ||
      currentEvent.status === 'cancelled' ||
      currentEvent.status !== input.expectedStatus ||
      Date.parse(currentEvent.startAt) !== expectedStartMs ||
      Date.parse(currentEvent.endAt) !== expectedEndMs ||
      currentEvent.summary.trim() !== input.summary.trim()
    ) {
      this.options.vault!.set(scope, lockKey, { status: 'failed' });
      await this.options.audit(scope, 'calendar.events.cancel_denied_stale', {
        mode,
        approvalId: approvedRequest.id,
        eventId: input.eventId,
        expectedStartAt: input.expectedStartAt,
        actualStartAt: currentEvent.startAt,
        expectedEndAt: input.expectedEndAt,
        actualEndAt: currentEvent.endAt,
        expectedStatus: input.expectedStatus,
        actualStatus: currentEvent.status
      });
      throw calendarError(
        'CALENDAR_EVENT_CHANGED_SINCE_PREVIEW',
        'This meeting changed in Google Calendar after your preview was prepared. Please review the updated calendar and try again.',
        409
      );
    }

    await this.options.audit(scope, 'calendar.events.cancel_requested', {
      mode,
      approvalId: approvedRequest.id,
      eventId: input.eventId,
      summary: input.summary,
      expectedStartAt: input.expectedStartAt,
      expectedEndAt: input.expectedEndAt,
      timeZone,
      sendUpdates: input.sendUpdates,
      connectedCalendar
    });
    this.unchanged(scope, connection.epoch);

    try {
      const raw = await this.options.provider.cancelEvent({
        accessToken: connection.tokens.accessToken,
        eventId: input.eventId,
        sendUpdates: input.sendUpdates
      });
      const providerEventId =
        typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : undefined;
      if (!providerEventId) {
        this.options.vault!.set(scope, lockKey, { status: 'unverified' });
        await this.options.audit(scope, 'calendar.events.cancel_unverified', {
          mode,
          approvalId: approvedRequest.id,
          eventId: input.eventId,
          reason: 'missing_provider_event_id'
        });
        throw calendarError(
          'CALENDAR_MUTATION_UNVERIFIED',
          'Google Calendar did not confirm this cancellation. Automatic retry is blocked.',
          502
        );
      }
      const receipt: GoogleCalendarMutationReceipt = {
        connectorName: 'google_calendar',
        mode,
        operation: 'cancel',
        status: 'event_cancelled',
        providerEventId,
        summary: input.summary,
        startAt: input.expectedStartAt,
        endAt: input.expectedEndAt,
        timeZone,
        sendUpdates: input.sendUpdates,
        connectedCalendar,
        completedAt: new Date(this.now()).toISOString(),
        note: 'Google Calendar confirmed cancellation of the event (events.delete).'
      };
      if (!mutationReceiptCheck.Check(receipt)) {
        this.options.vault!.set(scope, lockKey, { status: 'unverified' });
        throw calendarError(
          'CALENDAR_MUTATION_UNVERIFIED',
          'Google Calendar cancellation receipt failed verification.',
          502
        );
      }
      this.options.vault!.set(scope, lockKey, { status: 'completed', receipt });
      await this.options.audit(scope, 'calendar.events.cancel_completed', {
        mode,
        approvalId: approvedRequest.id,
        providerEventId,
        status: receipt.status
      });
      return receipt;
    } catch (err) {
      if (err instanceof AppError && err.code === 'CALENDAR_MUTATION_UNVERIFIED') throw err;
      const statusHint = (err as { statusCode?: number })?.statusCode;
      const uncertain =
        Boolean((err as { uncertain?: boolean })?.uncertain) ||
        (statusHint !== undefined && statusHint >= 500);
      if (uncertain) {
        this.options.vault!.set(scope, lockKey, { status: 'unverified' });
        await this.options.audit(scope, 'calendar.events.cancel_unverified', {
          mode,
          approvalId: approvedRequest.id,
          eventId: input.eventId,
          reason: err instanceof Error ? err.message : 'provider_uncertain_outcome'
        });
        throw calendarError(
          'CALENDAR_MUTATION_UNVERIFIED',
          'We could not confirm whether Google Calendar cancelled this meeting. Automatic retry is disabled.',
          502
        );
      }
      this.options.vault!.set(scope, lockKey, { status: 'failed' });
      await this.options.audit(scope, 'calendar.events.cancel_failed', {
        mode,
        approvalId: approvedRequest.id,
        eventId: input.eventId,
        reason: err instanceof Error ? err.message : 'provider_rejected'
      });
      throw calendarError(
        'CALENDAR_MUTATION_FAILED',
        err instanceof AppError ? err.message : 'Google Calendar rejected the cancellation request.',
        err instanceof AppError ? err.statusCode : 502
      );
    }
  }

  private buildMutationAdapter<TInput>(
    actionName: string,
    verificationMethod: string,
    run: (
      scope: AuthenticatedScope,
      input: TInput,
      approvedRequest: ApprovalRequest,
      idempotencyKey: string
    ) => Promise<GoogleCalendarMutationReceipt>
  ): ActionAdapter {
    return {
      name: actionName,
      idempotencySupport: 'none',
      async execute(context: ActionExecutionContext): Promise<ActionResult> {
        const scope = context.scope as AuthenticatedScope | undefined;
        const approvedRequest = context.approvedRequest as ApprovalRequest | undefined;
        if (!scope || !approvedRequest) {
          return {
            success: false,
            status: 'failed',
            verificationMethod: 'policy_gateway_context_check',
            proof: { error: 'Missing authenticated user scope or approved request context' },
            error: 'Missing authenticated user scope or approved request context'
          };
        }
        try {
          const receipt = await run(
            scope,
            context.parameters as unknown as TInput,
            approvedRequest,
            context.idempotencyKey
          );
          return {
            success: true,
            status: 'verified',
            verificationMethod,
            proof: receipt as unknown as Record<string, unknown>
          };
        } catch (err) {
          if (err instanceof AppError && err.code === 'CALENDAR_NOT_CONFIGURED') {
            return {
              success: false,
              status: 'not_configured',
              verificationMethod: 'calendar_configuration_check',
              proof: { code: err.code, message: err.message },
              error: err.message
            };
          }
          if (err instanceof AppError && err.code === 'CALENDAR_MUTATION_UNVERIFIED') {
            return {
              success: false,
              status: 'unverified',
              verificationMethod: 'calendar_api_mutation_uncertain',
              proof: { code: err.code, message: err.message, idempotencyKey: context.idempotencyKey },
              error: err.message
            };
          }
          const message = err instanceof Error ? err.message : 'Google Calendar mutation failed.';
          const code = err instanceof AppError ? err.code : 'CALENDAR_MUTATION_FAILED';
          return {
            success: false,
            status: 'failed',
            verificationMethod: 'calendar_api_mutation_error',
            proof: { code, message, idempotencyKey: context.idempotencyKey },
            error: message
          };
        }
      }
    };
  }

  createMutationAdapters(): Array<[string, ActionAdapter]> {
    return [
      [
        GOOGLE_CALENDAR_CREATE_EVENT_ACTION,
        this.buildMutationAdapter<GoogleCalendarCreateEventInput>(
          GOOGLE_CALENDAR_CREATE_EVENT_ACTION,
          'google_calendar_api_events_insert_receipt',
          (scope, input, approvedRequest, idempotencyKey) =>
            this.createEvent(scope, input, approvedRequest, idempotencyKey)
        )
      ],
      [
        GOOGLE_CALENDAR_RESCHEDULE_EVENT_ACTION,
        this.buildMutationAdapter<GoogleCalendarRescheduleEventInput>(
          GOOGLE_CALENDAR_RESCHEDULE_EVENT_ACTION,
          'google_calendar_api_events_patch_receipt',
          (scope, input, approvedRequest, idempotencyKey) =>
            this.rescheduleEvent(scope, input, approvedRequest, idempotencyKey)
        )
      ],
      [
        GOOGLE_CALENDAR_CANCEL_EVENT_ACTION,
        this.buildMutationAdapter<GoogleCalendarCancelEventInput>(
          GOOGLE_CALENDAR_CANCEL_EVENT_ACTION,
          'google_calendar_api_events_delete_receipt',
          (scope, input, approvedRequest, idempotencyKey) =>
            this.cancelEvent(scope, input, approvedRequest, idempotencyKey)
        )
      ]
    ];
  }
}

export function formatLocalTimeRangeInTimeZone(
  event: GoogleCalendarEvent,
  timeZone: string
): string {
  if (event.allDay) {
    return `All day (${timeZone})`;
  }
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return `${fmt.format(new Date(event.startAt))}–${fmt.format(new Date(event.endAt))} (${timeZone})`;
}

export function sanitizeUntrustedDescriptionSnippet(description?: string): string | undefined {
  if (!description) return undefined;
  const plain = description
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return undefined;
  return plain.length > 280 ? `${plain.slice(0, 277)}...` : plain;
}

export function buildCalendarBriefingN8nBlueprint(input: {
  workflowName: string;
  n8nContext: GoogleCalendarN8nContext;
  conflictEventIds: string[];
}): { blueprint: N8nWorkflowBlueprint; workflowHash: string } {
  const workflowHash = computeCanonicalParameterHash({
    schema: 'thaara.calendar_briefing_workflow.v1',
    workflowName: input.workflowName,
    timeZone: input.n8nContext.timeZone,
    windowStart: input.n8nContext.windowStart,
    windowEnd: input.n8nContext.windowEnd,
    eventIds: input.n8nContext.eventIds,
    conflictEventIds: input.conflictEventIds
  });
  const suffix = workflowHash.slice(0, 8);
  const triggerNode = 'Daily_Schedule_Trigger';
  const conflictCheckNode = 'Check_Schedule_Conflicts';
  const composeBriefingNode = 'Compose_Calendar_Briefing_Draft';

  const blueprint: N8nWorkflowBlueprint = {
    name: input.workflowName,
    active: false,
    versionId: `v1-${workflowHash.slice(0, 16)}`,
    nodes: [
      {
        id: `node-cal-trigger-${suffix}`,
        name: triggerNode,
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1,
        position: [240, 300],
        parameters: {
          mode: 'everyDay',
          timeZone: input.n8nContext.timeZone,
          connector: 'google_calendar',
          operation: 'read_agenda_snapshot',
          readOnly: true
        }
      },
      {
        id: `node-cal-conflict-${suffix}`,
        name: conflictCheckNode,
        type: 'n8n-nodes-base.if',
        typeVersion: 1,
        position: [480, 300],
        parameters: {
          field: 'conflict_count',
          operator: 'not_equals',
          value: '0'
        }
      },
      {
        id: `node-cal-briefing-${suffix}`,
        name: composeBriefingNode,
        type: 'n8n-nodes-base.set',
        typeVersion: 1,
        position: [720, 300],
        parameters: {
          timeZone: input.n8nContext.timeZone,
          windowStart: input.n8nContext.windowStart,
          windowEnd: input.n8nContext.windowEnd,
          eventIds: input.n8nContext.eventIds,
          conflictEventIds: input.conflictEventIds,
          untrustedEventData: true,
          deliveryMode: 'offline_briefing_draft_only_no_live_execution'
        }
      }
    ],
    connections: {
      [triggerNode]: {
        main: [[{ node: conflictCheckNode, type: 'main', index: 0 }]]
      },
      [conflictCheckNode]: {
        main: [[{ node: composeBriefingNode, type: 'main', index: 0 }]]
      }
    },
    settings: {
      executionOrder: 'v1',
      saveManualExecutions: false
    },
    meta: {
      generatedBy: 'thaara-v2-offline-workflow-builder',
      importReadiness: 'offline_schema_validated_not_live_verified',
      externallyVerifiedWithLiveN8n: false
    }
  };

  const validation = validateN8nWorkflowBlueprint(blueprint);
  if (!validation.valid) {
    throw calendarError(
      'CALENDAR_BLUEPRINT_INVALID',
      `Failed to validate offline calendar n8n blueprint: ${validation.errors.join('; ')}`,
      500
    );
  }
  return { blueprint, workflowHash };
}

export interface SyntheticCalendarEventRecord extends Omit<GoogleCalendarEvent, 'untrusted' | 'mode'> {
  rawHtmlDescription?: string;
  conferenceJoinSecret?: string;
}

export class SyntheticGoogleCalendarProvider implements GoogleCalendarProvider {
  readonly mode = 'mock' as const;
  constructor(
    private readonly eventsByToken: ReadonlyMap<string, readonly SyntheticCalendarEventRecord[]>,
    private readonly tokenByCode: ReadonlyMap<string, GoogleCalendarTokens> = new Map()
  ) {}

  async exchange(input: {
    code: string;
    codeVerifier: string;
    clientId: string;
    redirectUri: string;
  }): Promise<GoogleCalendarTokens> {
    const custom = this.tokenByCode.get(input.code);
    if (custom) return custom;
    return {
      accessToken: `cal_tok_${input.code}`,
      refreshToken: `cal_ref_${input.code}`,
      scope: GOOGLE_CALENDAR_READONLY,
      expiresIn: 3600
    };
  }

  async listEvents(input: {
    accessToken: string;
    windowStart: string;
    windowEnd: string;
    timeZone: string;
    query?: string;
    includeCancelled: boolean;
    limit: number;
    pageToken?: string;
  }): Promise<unknown> {
    const records = this.eventsByToken.get(input.accessToken) ?? [];
    const startMs = Date.parse(input.windowStart);
    const endMs = Date.parse(input.windowEnd);
    const needle = input.query?.toLowerCase();
    const filtered = records
      .filter((ev) => {
        if (!input.includeCancelled && ev.status === 'cancelled') return false;
        const evStart = Date.parse(ev.startAt);
        const evEnd = Date.parse(ev.endAt);
        if (evEnd <= startMs || evStart >= endMs) return false;
        if (needle) {
          const text = `${ev.summary} ${ev.description ?? ''} ${ev.location ?? ''}`.toLowerCase();
          if (!text.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.id.localeCompare(b.id));

    const offset = input.pageToken ? Number.parseInt(input.pageToken, 10) : 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > filtered.length) {
      throw new Error('Invalid pageToken');
    }
    const slice = filtered.slice(offset, offset + input.limit);
    const nextOffset = offset + slice.length;
    return {
      events: slice,
      ...(nextOffset < filtered.length ? { nextPageToken: String(nextOffset) } : {})
    };
  }

  async readEvent(input: { accessToken: string; eventId: string }): Promise<unknown> {
    const records = this.eventsByToken.get(input.accessToken) ?? [];
    const found = records.find((ev) => ev.id === input.eventId);
    if (!found) {
      throw new Error('Event not found');
    }
    return found;
  }
}
