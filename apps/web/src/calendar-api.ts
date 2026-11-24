import { ApiRequestError, PlanWithStepsItem, decideApproval, request } from './api';

export const CALENDAR_PAGE_SIZE = 20;
export const GOOGLE_CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
export const GOOGLE_CALENDAR_EVENTS_OWNED_SCOPE =
  'https://www.googleapis.com/auth/calendar.events.owned';
export const CALENDAR_CREATE_EVENT_ACTION = 'calendar.events.create';
export const CALENDAR_RESCHEDULE_EVENT_ACTION = 'calendar.events.reschedule';
export const CALENDAR_CANCEL_EVENT_ACTION = 'calendar.events.cancel';

const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const RFC3339_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface CalendarStatus {
  connectorName: 'google_calendar';
  status: 'not_configured' | 'disconnected' | 'connected' | 'reconnect_required';
  configured: boolean;
  connected: boolean;
  mode: 'disabled' | 'mock' | 'live';
  scopes: string[];
  lastVerifiedAt: string | null;
  connectedEmail?: string;
  connectedCalendarSummary?: string;
}

export interface CalendarOAuthStartResult {
  authorizationUrl: string;
  expiresAt: string;
  mode: 'mock' | 'live';
}

export interface CalendarApiOptions {
  allowLiveMode?: boolean;
}

export interface CalendarReminderOverride {
  method: 'popup' | 'email';
  minutes: number;
}

export interface CalendarReminders {
  useDefault: boolean;
  overrides?: CalendarReminderOverride[];
}

export type CalendarEventOrigin =
  | 'thaara_chat'
  | 'thaara_ui'
  | 'thaara_gmail_explicit'
  | 'external_calendar';

export interface CalendarAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  organizer?: boolean;
  self?: boolean;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  summary: string;
  description?: string;
  location?: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  allDay: boolean;
  status: 'confirmed' | 'tentative' | 'cancelled';
  organizerEmail?: string;
  attendees: CalendarAttendee[];
  reminders?: CalendarReminders;
  thaaraOrigin?: CalendarEventOrigin;
  ownerSaved?: boolean;
  untrusted: true;
  mode: 'mock' | 'live';
}

export interface CalendarAgendaDayGroup {
  localDate: string;
  events: CalendarEvent[];
}

export interface CalendarN8nContext {
  connector: 'google_calendar';
  operation: 'read_agenda_snapshot';
  readOnly: true;
  timeZone: string;
  windowStart: string;
  windowEnd: string;
  eventIds: string[];
}

export interface CalendarAgendaResult {
  windowStart: string;
  windowEnd: string;
  timeZone: string;
  totalEvents: number;
  conflictEventIds: string[];
  days: CalendarAgendaDayGroup[];
  n8nContext: CalendarN8nContext;
  untrusted: true;
  mode: 'mock' | 'live';
}

export interface CalendarConflictSummary {
  id: string;
  summary: string;
  startAt: string;
  endAt: string;
  localTimeRange: string;
}

export interface CalendarPreparedMutation {
  planId: string;
  approvalId: string;
  status: 'awaiting_approval';
  operation: 'create' | 'reschedule' | 'cancel';
  connectedEmail: string;
  connectedCalendar?: string;
  eventId?: string;
  summary: string;
  description?: string;
  location?: string;
  startAt: string;
  endAt: string;
  previousStartAt?: string;
  previousEndAt?: string;
  timeZone: string;
  attendees?: string[];
  reminders?: CalendarReminders;
  origin?: CalendarEventOrigin;
  sendUpdates: 'all' | 'none';
  conflicts: CalendarConflictSummary[];
  expiresAt: string;
}

export type CalendarMutationOutcome =
  | {
      kind: 'completed';
      operation: 'create' | 'reschedule' | 'cancel';
      summary: string;
      startAt: string;
      endAt: string;
      timeZone: string;
      providerEventId: string;
      reminders?: CalendarReminders;
    }
  | { kind: 'pending'; summary: string }
  | { kind: 'cancelled'; summary: string }
  | { kind: 'unverified'; summary: string }
  | { kind: 'failed'; summary: string; reason?: string };

const base = '/api/v1/connectors/google-calendar';
const invalid = () => new ApiRequestError(502, 'Google Calendar data is unavailable.');
const idValid = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(id);
const uuidValid = (id: unknown): id is string =>
  typeof id === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

export function canCalendarStatusWrite(status: CalendarStatus | null | undefined): boolean {
  if (!status || !status.configured || !status.connected || status.status !== 'connected') {
    return false;
  }
  const hasWriteScope = status.scopes.includes(GOOGLE_CALENDAR_EVENTS_OWNED_SCOPE);
  const hasIdentity = Boolean(status.connectedEmail || status.connectedCalendarSummary);
  return hasWriteScope && hasIdentity;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  if (!/^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function isValidRfc3339(value: unknown): value is string {
  if (typeof value !== 'string' || !RFC3339_REGEX.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function sanitizeStatus(value: CalendarStatus, options?: CalendarApiOptions): CalendarStatus {
  const allowedModes = options?.allowLiveMode ? ['disabled', 'mock', 'live'] : ['disabled', 'mock'];
  if (
    !value ||
    value.connectorName !== 'google_calendar' ||
    !['not_configured', 'disconnected', 'connected', 'reconnect_required'].includes(value.status) ||
    !allowedModes.includes(value.mode) ||
    typeof value.connected !== 'boolean' ||
    typeof value.configured !== 'boolean'
  ) {
    throw invalid();
  }
  const connectedEmail =
    value.connected &&
    typeof value.connectedEmail === 'string' &&
    value.connectedEmail.trim().length >= 3 &&
    value.connectedEmail.trim().length <= 320 &&
    /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.connectedEmail.trim())
      ? value.connectedEmail.trim()
      : undefined;
  const connectedCalendarSummary =
    value.connected &&
    typeof value.connectedCalendarSummary === 'string' &&
    value.connectedCalendarSummary.trim().length >= 1 &&
    value.connectedCalendarSummary.trim().length <= 256
      ? value.connectedCalendarSummary.trim()
      : undefined;
  return {
    connectorName: 'google_calendar',
    status: value.status,
    configured: value.configured,
    connected: value.connected,
    mode: value.mode,
    scopes: Array.isArray(value.scopes)
      ? value.scopes.filter(
          (v) => v === GOOGLE_CALENDAR_READONLY_SCOPE || v === GOOGLE_CALENDAR_EVENTS_OWNED_SCOPE
        )
      : [],
    lastVerifiedAt:
      typeof value.lastVerifiedAt === 'string' && !Number.isNaN(Date.parse(value.lastVerifiedAt))
        ? value.lastVerifiedAt
        : null,
    ...(connectedEmail ? { connectedEmail } : {}),
    ...(connectedCalendarSummary ? { connectedCalendarSummary } : {})
  };
}

function sanitizeAttendee(raw: unknown): CalendarAttendee {
  if (!raw || typeof raw !== 'object') throw invalid();
  const a = raw as Record<string, unknown>;
  const result: CalendarAttendee = {};
  if (a.email !== undefined) {
    if (typeof a.email !== 'string' || a.email.length < 3 || a.email.length > 320) throw invalid();
    result.email = a.email;
  }
  if (a.displayName !== undefined) {
    if (typeof a.displayName !== 'string' || !a.displayName || a.displayName.length > 256)
      throw invalid();
    result.displayName = a.displayName;
  }
  if (a.responseStatus !== undefined) {
    if (!['needsAction', 'declined', 'tentative', 'accepted'].includes(String(a.responseStatus)))
      throw invalid();
    result.responseStatus = a.responseStatus as CalendarAttendee['responseStatus'];
  }
  if (a.organizer !== undefined) {
    if (typeof a.organizer !== 'boolean') throw invalid();
    result.organizer = a.organizer;
  }
  if (a.self !== undefined) {
    if (typeof a.self !== 'boolean') throw invalid();
    result.self = a.self;
  }
  return result;
}

export function sanitizeCalendarReminders(raw: unknown): CalendarReminders | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.useDefault !== 'boolean') return undefined;
  if (r.useDefault) {
    return { useDefault: true };
  }
  const overrides = Array.isArray(r.overrides)
    ? r.overrides
        .map((item): CalendarReminderOverride | null => {
          if (!item || typeof item !== 'object') return null;
          const o = item as Record<string, unknown>;
          const method = o.method === 'email' ? 'email' : o.method === 'popup' ? 'popup' : null;
          const minutes = typeof o.minutes === 'number' && Number.isFinite(o.minutes) ? Math.round(o.minutes) : -1;
          if (!method || minutes < 0 || minutes > 40320) return null;
          return { method, minutes };
        })
        .filter((x): x is CalendarReminderOverride => x !== null)
        .slice(0, 5)
    : [];
  return {
    useDefault: false,
    ...(overrides.length > 0 ? { overrides } : {})
  };
}

export function formatCalendarRemindersLabel(reminders?: CalendarReminders): string {
  if (!reminders) return '15 minutes before (popup)';
  if (reminders.useDefault) return 'Google Calendar default reminder';
  const overrides = reminders.overrides ?? [];
  if (overrides.length === 0) return 'No reminder';
  return overrides
    .map((o) => {
      const m = o.minutes;
      if (m === 0) return `At time of event (${o.method})`;
      if (m % 60 === 0 && m >= 60) {
        const hrs = m / 60;
        return `${hrs} hour${hrs === 1 ? '' : 's'} before (${o.method})`;
      }
      return `${m} minute${m === 1 ? '' : 's'} before (${o.method})`;
    })
    .join(', ');
}

export function sanitizeCalendarEvent(raw: unknown, options?: CalendarApiOptions): CalendarEvent {
  if (!raw || typeof raw !== 'object') throw invalid();
  const e = raw as Record<string, unknown>;
  const allowedModes = options?.allowLiveMode ? ['mock', 'live'] : ['mock'];
  if (
    !idValid(e.id) ||
    typeof e.calendarId !== 'string' ||
    !e.calendarId ||
    e.calendarId.length > 256 ||
    typeof e.summary !== 'string' ||
    !e.summary ||
    e.summary.length > 1024 ||
    !isValidRfc3339(e.startAt) ||
    !isValidRfc3339(e.endAt) ||
    Date.parse(e.endAt) <= Date.parse(e.startAt) ||
    !isValidTimeZone(e.timeZone) ||
    typeof e.allDay !== 'boolean' ||
    !['confirmed', 'tentative', 'cancelled'].includes(String(e.status)) ||
    !Array.isArray(e.attendees) ||
    e.attendees.length > 50 ||
    e.untrusted !== true ||
    !allowedModes.includes(String(e.mode))
  ) {
    throw invalid();
  }
  const event: CalendarEvent = {
    id: e.id,
    calendarId: e.calendarId,
    summary: e.summary,
    startAt: e.startAt,
    endAt: e.endAt,
    timeZone: e.timeZone,
    allDay: e.allDay,
    status: e.status as CalendarEvent['status'],
    attendees: e.attendees.map(sanitizeAttendee),
    untrusted: true,
    mode: e.mode as 'mock' | 'live'
  };
  if (e.description !== undefined) {
    if (typeof e.description !== 'string' || e.description.length > 8192) throw invalid();
    event.description = e.description;
  }
  if (e.location !== undefined) {
    if (typeof e.location !== 'string' || e.location.length > 1024) throw invalid();
    event.location = e.location;
  }
  if (e.organizerEmail !== undefined) {
    if (
      typeof e.organizerEmail !== 'string' ||
      e.organizerEmail.length < 3 ||
      e.organizerEmail.length > 320
    ) {
      throw invalid();
    }
    event.organizerEmail = e.organizerEmail;
  }
  const cleanReminders = sanitizeCalendarReminders(e.reminders);
  if (cleanReminders) {
    event.reminders = cleanReminders;
  }
  if (
    e.thaaraOrigin === 'thaara_chat' ||
    e.thaaraOrigin === 'thaara_ui' ||
    e.thaaraOrigin === 'thaara_gmail_explicit' ||
    e.thaaraOrigin === 'external_calendar'
  ) {
    event.thaaraOrigin = e.thaaraOrigin;
  }
  if (typeof e.ownerSaved === 'boolean') {
    event.ownerSaved = e.ownerSaved;
  }
  return event;
}

export async function getCalendarStatus(
  signal?: AbortSignal,
  options?: CalendarApiOptions
): Promise<CalendarStatus> {
  return sanitizeStatus(await request<CalendarStatus>(`${base}/status`, { signal }), options);
}

export async function startCalendarOAuth(
  signal?: AbortSignal,
  options?: CalendarApiOptions
): Promise<CalendarOAuthStartResult> {
  const allowedModes = options?.allowLiveMode ? ['mock', 'live'] : ['mock'];
  const value = await request<CalendarOAuthStartResult>(`${base}/oauth/start`, {
    method: 'POST',
    body: '{}',
    signal
  });
  if (
    !value ||
    typeof value.authorizationUrl !== 'string' ||
    !value.authorizationUrl.startsWith('https://accounts.google.com/o/oauth2/v2/auth?') ||
    typeof value.expiresAt !== 'string' ||
    Number.isNaN(Date.parse(value.expiresAt)) ||
    !allowedModes.includes(value.mode)
  ) {
    throw invalid();
  }
  return {
    authorizationUrl: value.authorizationUrl,
    expiresAt: value.expiresAt,
    mode: value.mode
  };
}

export async function getCalendarAgenda(
  input: {
    windowStart: string;
    windowEnd: string;
    timeZone: string;
    includeCancelled?: boolean;
  },
  signal?: AbortSignal,
  options?: CalendarApiOptions
): Promise<CalendarAgendaResult> {
  if (!isValidRfc3339(input.windowStart) || !isValidRfc3339(input.windowEnd)) {
    throw new ApiRequestError(400, 'Invalid calendar date range.');
  }
  const startMs = Date.parse(input.windowStart);
  const endMs = Date.parse(input.windowEnd);
  if (endMs <= startMs || endMs - startMs > MAX_WINDOW_MS || !isValidTimeZone(input.timeZone)) {
    throw new ApiRequestError(400, 'Invalid calendar query.');
  }
  const allowedModes = options?.allowLiveMode ? ['mock', 'live'] : ['mock'];
  const value = await request<CalendarAgendaResult>(`${base}/agenda`, {
    method: 'POST',
    signal,
    body: JSON.stringify({
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      timeZone: input.timeZone,
      includeCancelled: Boolean(input.includeCancelled),
      limit: CALENDAR_PAGE_SIZE
    })
  });
  if (
    !value ||
    !allowedModes.includes(value.mode) ||
    value.untrusted !== true ||
    value.windowStart !== input.windowStart ||
    value.windowEnd !== input.windowEnd ||
    value.timeZone !== input.timeZone ||
    typeof value.totalEvents !== 'number' ||
    value.totalEvents < 0 ||
    value.totalEvents > CALENDAR_PAGE_SIZE ||
    !Array.isArray(value.conflictEventIds) ||
    value.conflictEventIds.some((id) => !idValid(id)) ||
    !Array.isArray(value.days) ||
    value.days.length > 32 ||
    !value.n8nContext ||
    value.n8nContext.connector !== 'google_calendar' ||
    value.n8nContext.operation !== 'read_agenda_snapshot' ||
    value.n8nContext.readOnly !== true ||
    !Array.isArray(value.n8nContext.eventIds) ||
    value.n8nContext.eventIds.some((id) => !idValid(id))
  ) {
    throw invalid();
  }
  const seenIds = new Set<string>();
  const days: CalendarAgendaDayGroup[] = value.days.map((day) => {
    if (
      !day ||
      typeof day.localDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(day.localDate) ||
      !Array.isArray(day.events)
    ) {
      throw invalid();
    }
    const events = day.events.map((ev) => {
      const clean = sanitizeCalendarEvent(ev, options);
      if (clean.mode !== value.mode || seenIds.has(clean.id)) throw invalid();
      seenIds.add(clean.id);
      return clean;
    });
    return { localDate: day.localDate, events };
  });
  if (seenIds.size !== value.totalEvents || seenIds.size > CALENDAR_PAGE_SIZE) {
    throw invalid();
  }
  return {
    windowStart: value.windowStart,
    windowEnd: value.windowEnd,
    timeZone: value.timeZone,
    totalEvents: value.totalEvents,
    conflictEventIds: [...new Set(value.conflictEventIds)],
    days,
    n8nContext: {
      connector: 'google_calendar',
      operation: 'read_agenda_snapshot',
      readOnly: true,
      timeZone: value.timeZone,
      windowStart: value.windowStart,
      windowEnd: value.windowEnd,
      eventIds: value.n8nContext.eventIds
    },
    untrusted: true,
    mode: value.mode
  };
}

export async function readCalendarEvent(
  eventId: string,
  signal?: AbortSignal,
  options?: CalendarApiOptions
): Promise<CalendarEvent> {
  if (!idValid(eventId)) {
    throw new ApiRequestError(400, 'Invalid calendar event selection.');
  }
  const value = await request<CalendarEvent>(`${base}/events/${encodeURIComponent(eventId)}`, {
    signal
  });
  const clean = sanitizeCalendarEvent(value, options);
  if (clean.id !== eventId) throw invalid();
  return clean;
}

export async function disconnectCalendar(
  signal?: AbortSignal,
  options?: CalendarApiOptions
): Promise<CalendarStatus> {
  const value = sanitizeStatus(
    await request<CalendarStatus>(`${base}/connection`, {
      method: 'DELETE',
      body: '{}',
      signal
    }),
    options
  );
  if (value.connected || !['disconnected', 'not_configured'].includes(value.status)) {
    throw invalid();
  }
  return value;
}

export function calendarError(
  error: unknown
): 'unauthorized' | 'reconnect' | 'invalid_query' | 'unavailable' {
  if (error instanceof ApiRequestError) {
    if ([401, 403].includes(error.status)) return 'unauthorized';
    if ([409, 503].includes(error.status)) return 'reconnect';
    if (error.status === 400) return 'invalid_query';
  }
  return 'unavailable';
}

export function formatCalendarEventWindow(event: CalendarEvent, displayTimeZone: string): string {
  const tz = isValidTimeZone(displayTimeZone) ? displayTimeZone : 'UTC';
  if (event.allDay) {
    return `All day (${ tz })`;
  }
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return `${fmt.format(new Date(event.startAt))} – ${fmt.format(new Date(event.endAt))} (${tz})`;
}

function sanitizePreparedMutation(value: CalendarPreparedMutation): CalendarPreparedMutation {
  const calendarIdentity =
    typeof value?.connectedEmail === 'string' && value.connectedEmail.trim()
      ? value.connectedEmail.trim()
      : typeof value?.connectedCalendar === 'string' && value.connectedCalendar.trim()
        ? value.connectedCalendar.trim()
        : '';
  if (
    !value ||
    !uuidValid(value.planId) ||
    !uuidValid(value.approvalId) ||
    value.status !== 'awaiting_approval' ||
    !['create', 'reschedule', 'cancel'].includes(value.operation) ||
    !calendarIdentity ||
    typeof value.summary !== 'string' ||
    !value.summary.trim() ||
    !isValidRfc3339(value.startAt) ||
    !isValidRfc3339(value.endAt) ||
    !isValidTimeZone(value.timeZone) ||
    !['all', 'none'].includes(value.sendUpdates) ||
    !Array.isArray(value.conflicts)
  ) {
    throw invalid();
  }
  const cleanReminders = sanitizeCalendarReminders(value.reminders);
  const cleanOrigin: CalendarEventOrigin | undefined =
    value.origin === 'thaara_chat' ||
    value.origin === 'thaara_ui' ||
    value.origin === 'thaara_gmail_explicit' ||
    value.origin === 'external_calendar'
      ? value.origin
      : undefined;
  return {
    planId: value.planId,
    approvalId: value.approvalId,
    status: 'awaiting_approval',
    operation: value.operation,
    connectedEmail: calendarIdentity,
    connectedCalendar: calendarIdentity,
    ...(typeof value.eventId === 'string' && value.eventId ? { eventId: value.eventId } : {}),
    summary: value.summary.trim(),
    ...(typeof value.description === 'string' && value.description
      ? { description: value.description }
      : {}),
    ...(typeof value.location === 'string' && value.location ? { location: value.location } : {}),
    startAt: value.startAt,
    endAt: value.endAt,
    ...(typeof value.previousStartAt === 'string' && value.previousStartAt
      ? { previousStartAt: value.previousStartAt }
      : {}),
    ...(typeof value.previousEndAt === 'string' && value.previousEndAt
      ? { previousEndAt: value.previousEndAt }
      : {}),
    timeZone: value.timeZone,
    ...(Array.isArray(value.attendees) && value.attendees.length > 0
      ? { attendees: value.attendees.filter((a): a is string => typeof a === 'string') }
      : {}),
    ...(cleanReminders ? { reminders: cleanReminders } : {}),
    ...(cleanOrigin ? { origin: cleanOrigin } : {}),
    sendUpdates: value.sendUpdates,
    conflicts: value.conflicts.map((c) => ({
      id: String(c.id ?? ''),
      summary: String(c.summary ?? 'Busy'),
      startAt: String(c.startAt ?? ''),
      endAt: String(c.endAt ?? ''),
      localTimeRange: String(c.localTimeRange ?? '')
    })),
    expiresAt: String(value.expiresAt)
  };
}

export async function prepareCalendarCreate(
  input: {
    summary: string;
    description?: string;
    location?: string;
    startAt: string;
    endAt: string;
    timeZone?: string;
    attendees?: string[];
    reminders?: CalendarReminders;
    origin?: CalendarEventOrigin;
    sendUpdates?: 'all' | 'none';
  },
  signal?: AbortSignal
): Promise<CalendarPreparedMutation> {
  const value = await request<CalendarPreparedMutation>(`${base}/events/create`, {
    method: 'POST',
    signal,
    body: JSON.stringify({
      summary: input.summary.trim(),
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      ...(input.location?.trim() ? { location: input.location.trim() } : {}),
      startAt: input.startAt,
      endAt: input.endAt,
      timeZone: input.timeZone ?? 'Asia/Kolkata',
      ...(input.attendees && input.attendees.length > 0 ? { attendees: input.attendees } : {}),
      ...(input.reminders ? { reminders: input.reminders } : {}),
      ...(input.origin ? { origin: input.origin } : {}),
      ...(input.sendUpdates ? { sendUpdates: input.sendUpdates } : {})
    })
  });
  return sanitizePreparedMutation(value);
}

export async function prepareCalendarReschedule(
  input: {
    eventId: string;
    newStartAt: string;
    newEndAt: string;
    timeZone?: string;
    reminders?: CalendarReminders;
    sendUpdates?: 'all' | 'none';
  },
  signal?: AbortSignal
): Promise<CalendarPreparedMutation> {
  const value = await request<CalendarPreparedMutation>(`${base}/events/reschedule`, {
    method: 'POST',
    signal,
    body: JSON.stringify({
      eventId: input.eventId,
      newStartAt: input.newStartAt,
      newEndAt: input.newEndAt,
      timeZone: input.timeZone ?? 'Asia/Kolkata',
      ...(input.reminders ? { reminders: input.reminders } : {}),
      ...(input.sendUpdates ? { sendUpdates: input.sendUpdates } : {})
    })
  });
  return sanitizePreparedMutation(value);
}

export async function prepareCalendarCancel(
  input: {
    eventId: string;
    timeZone?: string;
    sendUpdates?: 'all' | 'none';
  },
  signal?: AbortSignal
): Promise<CalendarPreparedMutation> {
  const value = await request<CalendarPreparedMutation>(`${base}/events/cancel`, {
    method: 'POST',
    signal,
    body: JSON.stringify({
      eventId: input.eventId,
      timeZone: input.timeZone ?? 'Asia/Kolkata',
      ...(input.sendUpdates ? { sendUpdates: input.sendUpdates } : {})
    })
  });
  return sanitizePreparedMutation(value);
}

export function calendarMutationOutcomeFromPlan(
  plan: PlanWithStepsItem,
  fallbackSummary = 'Meeting'
): CalendarMutationOutcome {
  const step = plan.steps.find(
    (s) =>
      s.action_name === CALENDAR_CREATE_EVENT_ACTION ||
      s.action_name === CALENDAR_RESCHEDULE_EVENT_ACTION ||
      s.action_name === CALENDAR_CANCEL_EVENT_ACTION
  );
  const summary =
    typeof step?.parameters?.summary === 'string' ? step.parameters.summary : fallbackSummary;
  if (!step) return { kind: 'failed', summary };
  const receipt = plan.receipts.find((r) => r.plan_step_id === step.id);
  const proof = (receipt?.proof ?? {}) as Record<string, unknown>;
  if (
    step.status === 'verified' &&
    receipt?.status === 'verified' &&
    typeof proof.providerEventId === 'string' &&
    ['event_created', 'event_rescheduled', 'event_cancelled'].includes(String(proof.status))
  ) {
    const operation: 'create' | 'reschedule' | 'cancel' =
      proof.operation === 'reschedule'
        ? 'reschedule'
        : proof.operation === 'cancel'
          ? 'cancel'
          : 'create';
    const reminders =
      sanitizeCalendarReminders(proof.reminders) ??
      sanitizeCalendarReminders(step.parameters?.reminders);
    return {
      kind: 'completed',
      operation,
      summary: typeof proof.summary === 'string' ? proof.summary : summary,
      startAt: typeof proof.startAt === 'string' ? proof.startAt : '',
      endAt: typeof proof.endAt === 'string' ? proof.endAt : '',
      timeZone: typeof proof.timeZone === 'string' ? proof.timeZone : 'Asia/Kolkata',
      providerEventId: proof.providerEventId,
      ...(reminders ? { reminders } : {})
    };
  }
  if (
    step.status === 'unverified' ||
    receipt?.status === 'unverified' ||
    step.status === 'verified' ||
    receipt?.status === 'verified'
  ) {
    return { kind: 'unverified', summary };
  }
  if (
    step.status === 'cancelled' ||
    plan.status === 'cancelled' ||
    receipt?.verification_method === 'approval_gateway' ||
    receipt?.verification_method === 'user_cancellation'
  ) {
    return { kind: 'cancelled', summary };
  }
  if (
    ['failed', 'not_configured'].includes(step.status) ||
    receipt?.status === 'failed' ||
    receipt?.status === 'not_configured'
  ) {
    return {
      kind: 'failed',
      summary,
      ...(typeof proof.code === 'string' ? { reason: proof.code } : {})
    };
  }
  return { kind: 'pending', summary };
}

export async function cancelCalendarMutation(
  prepared: Pick<CalendarPreparedMutation, 'approvalId'>
): Promise<void> {
  await decideApproval(prepared.approvalId, 'rejected');
}

export function calendarMutationError(error: unknown): { message: string; reconnect: boolean } {
  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case 'CALENDAR_WRITE_SCOPE_REQUIRED':
        return {
          message:
            'Google Calendar scheduling is not allowed yet. Please disconnect and reconnect Google Calendar to grant scheduling permission.',
          reconnect: true
        };
      case 'CALENDAR_DISCONNECTED':
        return {
          message: 'Google Calendar is not connected. Please connect Google Calendar first.',
          reconnect: true
        };
      case 'CALENDAR_RECONNECT_REQUIRED':
      case 'CALENDAR_ACCOUNT_UNVERIFIED':
        return {
          message: 'Please reconnect Google Calendar and try again.',
          reconnect: true
        };
      case 'CALENDAR_EVENT_CHANGED_SINCE_PREVIEW':
        return {
          message:
            'This meeting changed in Google Calendar after your preview was prepared. Please refresh and try again.',
          reconnect: false
        };
      case 'CALENDAR_INVALID_ATTENDEE':
      case 'CALENDAR_INVALID_INPUT':
      case 'CALENDAR_INVALID_RANGE':
        return {
          message: error.message || 'Please check the meeting details and try again.',
          reconnect: false
        };
      default:
        break;
    }
    if (error.status === 401) {
      return { message: 'Your session ended. Please sign in again.', reconnect: false };
    }
  }
  return { message: 'Meeting could not be scheduled. Please try again.', reconnect: false };
}
