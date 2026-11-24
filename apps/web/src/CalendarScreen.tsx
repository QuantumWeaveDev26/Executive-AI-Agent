import { useEffect, useRef, useState } from 'react';
import { decideApproval, getPlanWithSteps } from './api';
import {
  CalendarPreparedMutation,
  CalendarReminders,
  canCalendarStatusWrite,
  calendarMutationError,
  calendarMutationOutcomeFromPlan,
  cancelCalendarMutation,
  formatCalendarRemindersLabel,
  prepareCalendarCancel,
  prepareCalendarCreate,
  prepareCalendarReschedule,
} from './calendar-api';
import {
  CalendarState,
  canConnectCalendar,
  canDisconnectCalendar,
  canReadCalendar,
  createCalendarModel,
  initialCalendarState,
} from './calendar-model';
import { calendarMutationResultMessage } from './CalendarMutationCard';
import {
  CalendarRangePreset,
  CalendarStatusFilter,
  DEFAULT_WORKSPACE_TIMEZONE,
  filterCalendarAgendaDays,
  formatCalendarEventDayAndDate,
  formatCalendarSimpleStatus,
  formatFriendlyEventTimeRange,
  formatFriendlyWindowRange,
  getCalendarConflictDetails,
} from './integration-ui';

export function reminderSelectionToPayload(selection: string): CalendarReminders {
  if (selection === 'default') {
    return { useDefault: true };
  }
  if (selection === 'none') {
    return { useDefault: false, overrides: [] };
  }
  const minutes = Number(selection);
  const validMinutes = Number.isFinite(minutes) && minutes >= 0 && minutes <= 40320 ? minutes : 15;
  return {
    useDefault: false,
    overrides: [{ method: 'popup', minutes: validMinutes }],
  };
}

export function reminderPayloadToSelection(reminders?: CalendarReminders): string {
  if (!reminders) return '15';
  if (reminders.useDefault) return 'default';
  const overrides = reminders.overrides ?? [];
  if (overrides.length === 0) return 'none';
  const mins = overrides[0]?.minutes;
  if (mins === 10 || mins === 15 || mins === 30 || mins === 60) {
    return String(mins);
  }
  return '15';
}

export function extractDateAndTimeInZone(
  isoString: string,
  timeZone: string,
): { date: string; time: string } {
  const ms = Date.parse(isoString);
  const d = Number.isNaN(ms) ? new Date() : new Date(ms);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      time: `${get('hour')}:${get('minute')}`,
    };
  } catch {
    const iso = d.toISOString();
    return {
      date: iso.slice(0, 10),
      time: iso.slice(11, 16),
    };
  }
}

export function buildRfc3339FromDateAndTime(
  dateStr: string,
  timeStr: string,
  durationMinutes: number,
  timeZone: string,
): { startAt: string; endAt: string } | null {
  const dateMatch = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes < 5 ||
    durationMinutes > 720
  ) {
    return null;
  }
  const guessMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let startMs = guessMs;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(guessMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const zonedAsUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    );
    const offsetMs = zonedAsUtc - guessMs;
    startMs = guessMs - offsetMs;
  } catch {
    startMs = guessMs;
  }
  const endMs = startMs + Math.round(durationMinutes) * 60 * 1000;
  return {
    startAt: new Date(startMs).toISOString().replace('.000Z', 'Z'),
    endAt: new Date(endMs).toISOString().replace('.000Z', 'Z'),
  };
}

const statusLabels = {
  not_configured: 'Not configured',
  disconnected: 'Disconnected',
  connected: 'Connected (mock)',
  reconnect_required: 'Reconnect required',
};

function formatCalendarStatusBadgeText(state: CalendarState): string {
  if (state.connecting) return 'Connecting';
  if (!state.status) return 'Unavailable';
  if (state.status.status === 'connected') {
    return state.status.mode === 'live' ? 'Connected (LIVE)' : 'Connected (mock)';
  }
  return statusLabels[state.status.status] ?? 'Unavailable';
}

function formatConnectedCalendarIdentity(state: CalendarState): string | null {
  if (state.unauthorized || !state.status || !state.status.connected) {
    return null;
  }
  const email = state.status.connectedEmail?.trim();
  const summary = state.status.connectedCalendarSummary?.trim();
  if (email && summary && summary.toLowerCase() !== email.toLowerCase()) {
    return `${email} (${summary})`;
  }
  if (email) {
    return email;
  }
  if (summary) {
    return summary;
  }
  return null;
}

const eventStatusStyles: Record<
  'confirmed' | 'tentative' | 'cancelled',
  { label: 'Confirmed' | 'Maybe' | 'Cancelled'; cls: string }
> = {
  confirmed: { label: 'Confirmed', cls: 'badge badge-success' },
  tentative: { label: 'Maybe', cls: 'badge badge-warning' },
  cancelled: { label: 'Cancelled', cls: 'badge badge-danger' },
};

export interface CalendarScreenViewProps {
  state: CalendarState;
  timeZoneDraft: string;
  onTimeZoneDraft: (value: string) => void;
  onApplyTimeZone: () => void;
  onToday: () => void;
  onPrevRange: () => void;
  onNextRange: () => void;
  onSelectRangePreset?: (preset: CalendarRangePreset) => void;
  onToggleCancelled: (checked: boolean) => void;
  onSelectEvent: (id: string) => void;
  onRefresh: () => void;
  onDisconnect: () => void;
  onConnect?: () => void;
  statusFilter?: CalendarStatusFilter;
  onStatusFilter?: (value: CalendarStatusFilter) => void;
  searchQuery?: string;
  onSearchQuery?: (value: string) => void;
  nowMs?: number;
}

export function CalendarScreenView(p: CalendarScreenViewProps) {
  const s = p.state;
  const ready = canReadCalendar(s);
  const busy = s.connectionLoading || s.disconnecting || Boolean(s.connecting);
  const statusLabel = formatCalendarStatusBadgeText(s);
  const connectedAccountIdentity = formatConnectedCalendarIdentity(s);
  const canConnect = Boolean(p.onConnect && !busy && canConnectCalendar(s));
  const needsWritePermission =
    ready && s.status?.mode === 'live' && !canCalendarStatusWrite(s.status);
  const conflicts = new Set(s.agenda?.conflictEventIds ?? []);

  const [localStatusFilter, setLocalStatusFilter] = useState<CalendarStatusFilter>('all');
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const [rangePreset, setRangePreset] = useState<CalendarRangePreset>('today');
  const [ownershipFilter, setOwnershipFilter] = useState<'all' | 'owner_saved' | 'external'>('all');

  // Step 107.5 & 107.6: Schedule / Reschedule / Cancel UI state
  const defaultDateAndTime = extractDateAndTimeInZone(
    s.windowStart || new Date().toISOString(),
    s.timeZone || DEFAULT_WORKSPACE_TIMEZONE,
  );
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState(defaultDateAndTime.date);
  const [newTime, setNewTime] = useState('15:00');
  const [newDuration, setNewDuration] = useState('30');
  const [newReminder, setNewReminder] = useState('15');
  const [newAttendees, setNewAttendees] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState(defaultDateAndTime.date);
  const [rescheduleTime, setRescheduleTime] = useState('16:00');
  const [rescheduleDuration, setRescheduleDuration] = useState('30');
  const [rescheduleReminder, setRescheduleReminder] = useState('15');

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelSendUpdates, setCancelSendUpdates] = useState<'none' | 'all'>('none');

  const [mutationLoading, setMutationLoading] = useState(false);
  const [pendingMutation, setPendingMutation] = useState<CalendarPreparedMutation | null>(null);
  const [mutationError, setMutationError] = useState<{
    message: string;
    reconnect: boolean;
  } | null>(null);
  const [mutationOutcomeMessage, setMutationOutcomeMessage] = useState<string | null>(null);

  const openScheduleForm = () => {
    const base = extractDateAndTimeInZone(
      new Date(p.nowMs ?? Date.now()).toISOString(),
      s.timeZone || DEFAULT_WORKSPACE_TIMEZONE,
    );
    setNewDate(base.date);
    setNewTime('15:00');
    setNewDuration('30');
    setNewReminder('15');
    setScheduleOpen(true);
    setRescheduleOpen(false);
    setCancelOpen(false);
    setMutationError(null);
    setMutationOutcomeMessage(null);
  };

  const openRescheduleForm = () => {
    if (!s.selectedEvent) return;
    const base = extractDateAndTimeInZone(s.selectedEvent.startAt, s.timeZone);
    const durMin = Math.max(
      5,
      Math.round(
        (Date.parse(s.selectedEvent.endAt) - Date.parse(s.selectedEvent.startAt)) / 60_000,
      ) || 30,
    );
    setRescheduleDate(base.date);
    setRescheduleTime(base.time);
    setRescheduleDuration(String(durMin));
    setRescheduleReminder(reminderPayloadToSelection(s.selectedEvent.reminders));
    setRescheduleOpen(true);
    setCancelOpen(false);
    setScheduleOpen(false);
    setMutationError(null);
    setMutationOutcomeMessage(null);
  };

  const openCancelForm = () => {
    if (!s.selectedEvent) return;
    setCancelSendUpdates(s.selectedEvent.attendees.length > 0 ? 'all' : 'none');
    setCancelOpen(true);
    setRescheduleOpen(false);
    setScheduleOpen(false);
    setMutationError(null);
    setMutationOutcomeMessage(null);
  };

  const handlePrepareNewMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    setMutationError(null);
    setMutationOutcomeMessage(null);
    const trimmedTitle = newTitle.trim() || 'Meeting';
    const dur = Number(newDuration) || 30;
    const range = buildRfc3339FromDateAndTime(newDate, newTime, dur, s.timeZone);
    if (!range) {
      setMutationError({
        message: 'Please enter a valid date (YYYY-MM-DD), time (HH:MM), and duration.',
        reconnect: false,
      });
      return;
    }
    const attendeeList = newAttendees
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    setMutationLoading(true);
    try {
      const prepared = await prepareCalendarCreate({
        summary: trimmedTitle,
        startAt: range.startAt,
        endAt: range.endAt,
        timeZone: s.timeZone,
        ...(attendeeList.length > 0 ? { attendees: attendeeList } : {}),
        ...(newLocation.trim() ? { location: newLocation.trim() } : {}),
        ...(newDescription.trim() ? { description: newDescription.trim() } : {}),
        reminders: reminderSelectionToPayload(newReminder),
        origin: 'thaara_ui',
        sendUpdates: attendeeList.length > 0 ? 'all' : 'none',
      });
      setPendingMutation(prepared);
      setScheduleOpen(false);
    } catch (err) {
      setMutationError(calendarMutationError(err));
    } finally {
      setMutationLoading(false);
    }
  };

  const handlePrepareReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!s.selectedEvent) return;
    setMutationError(null);
    setMutationOutcomeMessage(null);
    const dur = Number(rescheduleDuration) || 30;
    const range = buildRfc3339FromDateAndTime(rescheduleDate, rescheduleTime, dur, s.timeZone);
    if (!range) {
      setMutationError({
        message: 'Please enter a valid date (YYYY-MM-DD), time (HH:MM), and duration.',
        reconnect: false,
      });
      return;
    }
    setMutationLoading(true);
    try {
      const prepared = await prepareCalendarReschedule({
        eventId: s.selectedEvent.id,
        newStartAt: range.startAt,
        newEndAt: range.endAt,
        timeZone: s.timeZone,
        reminders: reminderSelectionToPayload(rescheduleReminder),
        sendUpdates: s.selectedEvent.attendees.length > 0 ? 'all' : 'none',
      });
      setPendingMutation(prepared);
      setRescheduleOpen(false);
    } catch (err) {
      setMutationError(calendarMutationError(err));
    } finally {
      setMutationLoading(false);
    }
  };

  const handlePrepareCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!s.selectedEvent) return;
    setMutationError(null);
    setMutationOutcomeMessage(null);
    setMutationLoading(true);
    try {
      const prepared = await prepareCalendarCancel({
        eventId: s.selectedEvent.id,
        timeZone: s.timeZone,
        sendUpdates: cancelSendUpdates,
      });
      setPendingMutation(prepared);
      setCancelOpen(false);
    } catch (err) {
      setMutationError(calendarMutationError(err));
    } finally {
      setMutationLoading(false);
    }
  };

  const handleApprovePreparedMutation = async () => {
    if (!pendingMutation) return;
    const current = pendingMutation;
    setMutationLoading(true);
    setMutationError(null);
    try {
      await decideApproval(current.approvalId, 'approved');
      let outcome = calendarMutationOutcomeFromPlan(
        await getPlanWithSteps(current.planId),
        current.summary,
      );
      for (let i = 0; i < 6 && outcome.kind === 'pending'; i++) {
        await new Promise((r) => setTimeout(r, 250));
        outcome = calendarMutationOutcomeFromPlan(
          await getPlanWithSteps(current.planId),
          current.summary,
        );
      }
      setPendingMutation(null);
      setMutationOutcomeMessage(calendarMutationResultMessage(outcome));
      setNewTitle('');
      setNewAttendees('');
      setNewLocation('');
      setNewDescription('');
      p.onRefresh();
    } catch (err) {
      setMutationError(calendarMutationError(err));
    } finally {
      setMutationLoading(false);
    }
  };

  const handleCancelPreparedMutation = async () => {
    if (!pendingMutation) return;
    const current = pendingMutation;
    setMutationLoading(true);
    setMutationError(null);
    try {
      await cancelCalendarMutation(current);
      setPendingMutation(null);
      setMutationOutcomeMessage('No changes were made to your Google Calendar.');
    } catch (err) {
      setMutationError(calendarMutationError(err));
    } finally {
      setMutationLoading(false);
    }
  };

  const activeStatusFilter = p.statusFilter ?? localStatusFilter;
  const activeSearchQuery = p.searchQuery ?? localSearchQuery;
  const activeRangePreset = s.rangePreset ?? rangePreset;

  const handleStatusFilterChange = (next: CalendarStatusFilter) => {
    setLocalStatusFilter(next);
    p.onStatusFilter?.(next);
    if (next === 'cancelled' && !s.includeCancelled) {
      p.onToggleCancelled(true);
    }
  };

  const handleSearchChange = (next: string) => {
    setLocalSearchQuery(next);
    p.onSearchQuery?.(next);
  };

  const handleRangePresetChange = (preset: CalendarRangePreset) => {
    setRangePreset(preset);
    if (p.onSelectRangePreset) {
      p.onSelectRangePreset(preset);
      return;
    }
    if (preset === 'prev_7_days') {
      p.onPrevRange();
    } else if (preset === 'next_7_days') {
      p.onNextRange();
    } else {
      p.onToday();
    }
  };

  const allEvents = s.agenda ? s.agenda.days.flatMap((d) => d.events) : [];
  const baseFilteredDays = s.agenda
    ? filterCalendarAgendaDays(s.agenda.days, {
        statusFilter: activeStatusFilter,
        searchQuery: activeSearchQuery,
        windowStart: s.agenda.windowStart,
        windowEnd: s.agenda.windowEnd,
      })
    : [];
  const filteredDays =
    ownershipFilter === 'all'
      ? baseFilteredDays
      : baseFilteredDays
          .map((d) => ({
            ...d,
            events: d.events.filter((ev) =>
              ownershipFilter === 'owner_saved'
                ? ev.ownerSaved === true
                : ev.ownerSaved === false,
            ),
          }))
          .filter((d) => d.events.length > 0);
  const totalFilteredEvents = filteredDays.reduce((acc, d) => acc + d.events.length, 0);

  const statusBadgeClass =
    s.status?.status === 'connected'
      ? 'badge badge-success'
      : s.status?.status === 'disconnected'
        ? 'badge badge-danger'
        : 'badge badge-warning';

  const friendlyWindow = formatFriendlyWindowRange(s.windowStart, s.windowEnd, s.timeZone);
  const selectedConflictDetails = s.selectedEvent
    ? getCalendarConflictDetails(s.selectedEvent, allEvents, conflicts, s.timeZone)
    : null;

  return (
    <section
      className="integration-card"
      aria-labelledby="calendar-heading"
      data-testid="calendar-screen"
    >
      {/* Compact 1-Row Header — connection badge + Connected Calendar identity */}
      <div className="integration-header-bar">
        <div className="integration-header-left">
          <h2 id="calendar-heading" className="integration-title">
            Google Calendar
          </h2>
          {!s.unauthorized && (
            <span className={statusBadgeClass} data-testid="calendar-status-badge">
              {statusLabel}
            </span>
          )}
          {connectedAccountIdentity && (
            <span className="badge badge-info" data-testid="calendar-connected-account">
              Connected Calendar: {connectedAccountIdentity}
            </span>
          )}
        </div>

        <div className="integration-header-actions" style={{ display: 'flex', gap: '0.5rem' }}>
          {ready && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || mutationLoading}
              onClick={openScheduleForm}
              data-testid="calendar-schedule-open-btn"
              style={{ padding: '0.38rem 0.75rem', fontSize: '0.8rem' }}
            >
              + Schedule Meeting
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={p.onRefresh}
            style={{ padding: '0.38rem 0.75rem', fontSize: '0.8rem' }}
          >
            Refresh Calendar
          </button>
        </div>
      </div>

      {s.unauthorized ? (
        <p role="alert" className="error-banner" data-testid="calendar-unauthorized-banner">
          Google Calendar access is unavailable. Sign in with an authorized workspace account.
        </p>
      ) : (
        <>
          {s.connectionLoading && <p role="status">Loading Calendar connection…</p>}
          {s.connecting && <p role="status">Connecting to Google Calendar…</p>}
          {s.disconnecting && <p role="status">Disconnecting Calendar…</p>}
          {s.connectionError && (
            <p role="alert" className="error-banner">
              Unable to load or update Google Calendar. Refresh the connection to retry.
            </p>
          )}
          {needsWritePermission && (
            <div
              role="status"
              style={{
                margin: '0.5rem 0',
                padding: '0.65rem 0.9rem',
                borderRadius: '8px',
                background: 'var(--warning-bg)',
                border: '1px solid var(--warning-border)',
                fontSize: '0.83rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.75rem',
                flexWrap: 'wrap',
              }}
              data-testid="calendar-write-scope-banner"
            >
              <span>
                Read-only Calendar connection active. To schedule, reschedule, or cancel meetings,
                disconnect and reconnect Google Calendar to grant scheduling permission.
              </span>
            </div>
          )}
          {mutationError && (
            <p role="alert" className="error-banner" data-testid="calendar-mutation-error">
              {mutationError.message}
            </p>
          )}
          {mutationOutcomeMessage && (
            <div
              role="status"
              style={{
                margin: '0.5rem 0',
                padding: '0.65rem 0.9rem',
                borderRadius: '8px',
                background: 'var(--surface-muted)',
                border: '1px solid var(--border-color)',
                fontSize: '0.85rem',
              }}
              data-testid="calendar-mutation-outcome"
            >
              {mutationOutcomeMessage}
            </div>
          )}
          {pendingMutation && (
            <div
              role="region"
              aria-label="Review calendar change"
              style={{
                margin: '0.6rem 0',
                padding: '0.85rem 1rem',
                borderRadius: '8px',
                background: 'var(--warning-bg)',
                border: '1px solid var(--warning-border)',
                display: 'grid',
                gap: '0.45rem',
                fontSize: '0.85rem',
              }}
              data-testid="calendar-mutation-review"
            >
              <strong>
                {pendingMutation.operation === 'reschedule'
                  ? 'Your rescheduled meeting is ready. Shall I update it?'
                  : pendingMutation.operation === 'cancel'
                    ? 'Ready to cancel this meeting. Shall I proceed?'
                    : 'Your meeting is ready. Shall I schedule it?'}
              </strong>
              <div>
                <strong>Title:</strong> {pendingMutation.summary}
              </div>
              {pendingMutation.previousStartAt && pendingMutation.previousEndAt && (
                <div>
                  <strong>Old Time:</strong>{' '}
                  {formatCalendarEventDayAndDate(pendingMutation.previousStartAt, pendingMutation.timeZone)}
                </div>
              )}
              <div>
                <strong>When:</strong>{' '}
                {formatCalendarEventDayAndDate(pendingMutation.startAt, pendingMutation.timeZone)} (
                {pendingMutation.timeZone})
              </div>
              {pendingMutation.operation !== 'cancel' && (
                <div data-testid="calendar-mutation-review-reminder">
                  <strong>Reminder:</strong> {formatCalendarRemindersLabel(pendingMutation.reminders)}{' '}
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                    (saved to Google Calendar; notification delivery depends on your Google Calendar &amp;
                    device settings)
                  </span>
                </div>
              )}
              <div>
                <strong>Calendar:</strong> {pendingMutation.connectedEmail} (primary)
              </div>
              {pendingMutation.attendees && pendingMutation.attendees.length > 0 && (
                <div>
                  <strong>Attendees:</strong> {pendingMutation.attendees.join(', ')}
                </div>
              )}
              {pendingMutation.operation === 'cancel' && (
                <div>
                  <strong>Guest Notifications:</strong>{' '}
                  {pendingMutation.sendUpdates === 'all'
                    ? 'Guests will be notified'
                    : 'Do not notify guests'}
                </div>
              )}
              {pendingMutation.conflicts.length > 0 && (
                <div
                  style={{
                    padding: '0.45rem 0.65rem',
                    borderRadius: '6px',
                    background: 'var(--canvas-bg)',
                    border: '1px solid var(--warning-border)',
                  }}
                  data-testid="calendar-mutation-review-conflicts"
                >
                  <strong>Scheduling Conflict Warning:</strong> Overlaps with{' '}
                  {pendingMutation.conflicts
                    .map((c) => `"${c.summary}" (${c.localTimeRange})`)
                    .join(', ')}
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={mutationLoading}
                  onClick={() => void handleApprovePreparedMutation()}
                  data-testid="calendar-mutation-approve"
                >
                  {mutationLoading ? 'Updating…' : 'Approve'}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={mutationLoading}
                  onClick={() => void handleCancelPreparedMutation()}
                  data-testid="calendar-mutation-cancel"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {scheduleOpen && (
            <form
              onSubmit={(e) => void handlePrepareNewMeeting(e)}
              style={{
                margin: '0.6rem 0',
                padding: '0.9rem 1rem',
                borderRadius: '8px',
                background: 'var(--surface-muted)',
                border: '1px solid var(--border-color)',
                display: 'grid',
                gap: '0.6rem',
                fontSize: '0.84rem',
              }}
              data-testid="calendar-schedule-form"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Schedule New Meeting ({s.timeZone})</strong>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setScheduleOpen(false)}
                  style={{ padding: '0.25rem 0.55rem', fontSize: '0.76rem' }}
                >
                  Close
                </button>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: '0.5rem',
                }}
              >
                <label style={{ display: 'grid', gap: '0.2rem' }}>
                  <span>Meeting Title</span>
                  <input
                    type="text"
                    className="integration-search-input"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Strategy Sync"
                    required
                    data-testid="calendar-schedule-title"
                  />
                </label>
                <label style={{ display: 'grid', gap: '0.2rem' }}>
                  <span>Date (YYYY-MM-DD)</span>
                  <input
                    type="date"
                    className="integration-search-input"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    required
                    data-testid="calendar-schedule-date"
                  />
                </label>
                <label style={{ display: 'grid', gap: '0.2rem' }}>
                  <span>Start Time (HH:MM)</span>
                  <input
                    type="time"
                    className="integration-search-input"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    required
                    data-testid="calendar-schedule-time"
                  />
                </label>
                <label style={{ display: 'grid', gap: '0.2rem' }}>
                  <span>Duration (minutes)</span>
                  <input
                    type="number"
                    min={5}
                    max={720}
                    className="integration-search-input"
                    value={newDuration}
                    onChange={(e) => setNewDuration(e.target.value)}
                    data-testid="calendar-schedule-duration"
                  />
                </label>
                <label style={{ display: 'grid', gap: '0.2rem' }}>
                  <span>Reminder</span>
                  <select
                    className="integration-select"
                    value={newReminder}
                    onChange={(e) => setNewReminder(e.target.value)}
                    data-testid="calendar-schedule-reminder"
                  >
                    <option value="15">15 minutes before (popup)</option>
                    <option value="10">10 minutes before (popup)</option>
                    <option value="30">30 minutes before (popup)</option>
                    <option value="60">1 hour before (popup)</option>
                    <option value="default">Google Calendar default</option>
                    <option value="none">No reminder</option>
                  </select>
                </label>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '0.5rem',
                }}
              >
                <label style={{ display: 'grid', gap: '0.2rem' }}>
                  <span>Attendees (optional, comma-separated emails)</span>
                  <input
                    type="text"
                    className="integration-search-input"
                    value={newAttendees}
                    onChange={(e) => setNewAttendees(e.target.value)}
                    placeholder="alex@example.com, priya@example.com"
                    data-testid="calendar-schedule-attendees"
                  />
                </label>
                <label style={{ display: 'grid', gap: '0.2rem' }}>
                  <span>Location (optional)</span>
                  <input
                    type="text"
                    className="integration-search-input"
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    placeholder="Google Meet / Room A"
                    data-testid="calendar-schedule-location"
                  />
                </label>
              </div>
              <label style={{ display: 'grid', gap: '0.2rem' }}>
                <span>Notes / Description (optional)</span>
                <input
                  type="text"
                  className="integration-search-input"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Agenda and preparation notes"
                  data-testid="calendar-schedule-description"
                />
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={mutationLoading}
                  data-testid="calendar-schedule-prepare-btn"
                >
                  {mutationLoading ? 'Preparing…' : 'Prepare Meeting'}
                </button>
              </div>
            </form>
          )}

          {/* Collapsible Connection & Timezone Settings */}
          <details
            className="integration-settings-drawer"
            open={Boolean(s.status && s.status.status !== 'connected')}
            data-testid="calendar-connection-settings"
          >
            <summary>Connection &amp; Timezone Settings ({s.timeZone})</summary>
            <div className="integration-settings-body">
              <p style={{ margin: 0 }}>
                <strong>Connection:</strong> {statusLabel} · Mode:{' '}
                {s.status?.mode === 'live' ? 'LIVE (Google OAuth 2.0)' : 'DEMO / MOCK'} · Timezone:{' '}
                {s.timeZone}
                {connectedAccountIdentity
                  ? ` · Connected Calendar: ${connectedAccountIdentity}`
                  : ''}
              </p>
              <p style={{ margin: 0, fontSize: '0.78rem' }}>
                Untrusted calendar content is rendered as plain text only.
              </p>

              {ready && (
                <form
                  style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    p.onApplyTimeZone();
                  }}
                >
                  <label
                    htmlFor="calendar-timezone"
                    style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <span>Time zone</span>
                    <input
                      id="calendar-timezone"
                      className="integration-search-input"
                      style={{ width: '180px', minWidth: '140px', flex: 'none' }}
                      value={p.timeZoneDraft}
                      maxLength={64}
                      disabled={s.agendaLoading}
                      onChange={(e) => p.onTimeZoneDraft(e.target.value)}
                    />
                  </label>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={s.agendaLoading}
                    style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                  >
                    Apply time zone
                  </button>
                  <label
                    htmlFor="calendar-include-cancelled"
                    style={{
                      margin: '0 0 0 0.5rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      id="calendar-include-cancelled"
                      type="checkbox"
                      checked={s.includeCancelled}
                      disabled={s.agendaLoading}
                      onChange={(e) => p.onToggleCancelled(e.target.checked)}
                    />{' '}
                    Include cancelled
                  </label>
                </form>
              )}

              {s.agenda && (
                <p style={{ margin: 0, fontSize: '0.76rem' }}>
                  <small>
                    n8n snapshot: {s.agenda.n8nContext.operation} (read-only,{' '}
                    {s.agenda.n8nContext.eventIds.length} events)
                  </small>
                </p>
              )}

              <div className="integration-settings-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canConnect}
                  onClick={canConnect ? p.onConnect : undefined}
                >
                  Connect Google Calendar
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={p.onDisconnect}
                  disabled={busy || !canDisconnectCalendar(s)}
                >
                  Local disconnect
                </button>
              </div>
            </div>
          </details>

          {ready && (
            <>
              {/* Clean Controls Bar (Date range dropdown, Ownership dropdown, Status dropdown, Search field) */}
              <div className="integration-filter-bar" data-testid="calendar-filter-bar">
                <select
                  aria-label="Select date range"
                  data-testid="calendar-range-select"
                  className="integration-select"
                  value={activeRangePreset}
                  disabled={s.agendaLoading}
                  onChange={(e) => handleRangePresetChange(e.target.value as CalendarRangePreset)}
                >
                  <option value="prev_7_days">Previous 7 Days</option>
                  <option value="today">Today</option>
                  <option value="next_7_days">Next 7 Days</option>
                </select>

                <select
                  aria-label="Filter by meeting source"
                  data-testid="calendar-ownership-filter"
                  className="integration-select"
                  value={ownershipFilter}
                  disabled={s.agendaLoading}
                  onChange={(e) =>
                    setOwnershipFilter(e.target.value as 'all' | 'owner_saved' | 'external')
                  }
                >
                  <option value="all">All Calendar Events</option>
                  <option value="owner_saved">My Meetings (Saved in Thaara)</option>
                  <option value="external">Other Google Calendar Events</option>
                </select>

                <select
                  aria-label="Filter by event status"
                  data-testid="calendar-status-filter"
                  className="integration-select"
                  value={activeStatusFilter}
                  disabled={s.agendaLoading}
                  onChange={(e) => handleStatusFilterChange(e.target.value as CalendarStatusFilter)}
                >
                  <option value="all">All</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="tentative">Tentative</option>
                  <option value="cancelled">Cancelled</option>
                </select>

                <input
                  type="text"
                  className="integration-search-input"
                  value={activeSearchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search meetings or location..."
                  aria-label="Search calendar events"
                  data-testid="calendar-search-input"
                  disabled={s.agendaLoading}
                />

                {(activeSearchQuery || activeStatusFilter !== 'all' || ownershipFilter !== 'all') && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      handleSearchChange('');
                      handleStatusFilterChange('all');
                      setOwnershipFilter('all');
                    }}
                    data-testid="calendar-filter-clear"
                    style={{ padding: '0.42rem 0.7rem', fontSize: '0.78rem' }}
                  >
                    Clear
                  </button>
                )}
              </div>

              {s.agendaLoading && <p role="status">Loading schedule…</p>}
              {s.agendaError && (
                <p role="alert" className="error-banner">
                  {s.agendaError === 'invalid_query'
                    ? 'Enter a valid IANA time zone (for example, UTC or Asia/Kolkata).'
                    : 'Unable to load schedule. Refresh or try another range.'}
                </p>
              )}

              {/* Split-Pane Date-First Schedule & Event Detail */}
              <div className="integration-split-layout" data-testid="calendar-split-layout">
                {/* LEFT PANE: Date-First Event Cards */}
                <div className="integration-list-pane">
                  <div className="integration-pane-header">
                    <span data-testid="calendar-friendly-window">{friendlyWindow}</span>
                    <span>
                      {totalFilteredEvents} meeting{totalFilteredEvents === 1 ? '' : 's'}
                    </span>
                  </div>

                  {s.loaded &&
                    !s.agendaLoading &&
                    !s.agendaError &&
                    (s.agenda?.totalEvents === 0 || filteredDays.length === 0) && (
                      <p
                        style={{
                          padding: '1rem',
                          margin: 0,
                          color: 'var(--text-secondary)',
                          fontSize: '0.85rem',
                        }}
                      >
                        No scheduled events in this date range.
                      </p>
                    )}

                  {filteredDays.length > 0 && (
                    <div aria-label="Calendar agenda days">
                      {filteredDays.map((day) => {
                        const dayDateHeading = formatCalendarEventDayAndDate(
                          day.localDate,
                          s.timeZone,
                        );
                        return (
                          <div key={day.localDate}>
                            <ul
                              aria-label={`Events for ${day.localDate}`}
                              className="integration-list"
                            >
                              {day.events.map((ev) => {
                                const isSelected = s.selectedId === ev.id;
                                const statusStyle =
                                  eventStatusStyles[ev.status] ?? eventStatusStyles.confirmed;
                                const conflictDetails = getCalendarConflictDetails(
                                  ev,
                                  allEvents,
                                  conflicts,
                                  s.timeZone,
                                );

                                return (
                                  <li key={ev.id}>
                                    <button
                                      type="button"
                                      className={`integration-row-btn ${
                                        isSelected ? 'selected' : ''
                                      }`}
                                      aria-pressed={isSelected}
                                      onClick={() => p.onSelectEvent(ev.id)}
                                      data-testid={`calendar-event-row-${ev.id}`}
                                      style={{ gap: '0.28rem', padding: '0.85rem 0.95rem' }}
                                    >
                                      {/* 1. Day and date */}
                                      <div
                                        style={{
                                          fontSize: '0.78rem',
                                          fontWeight: 600,
                                          color: 'var(--text-secondary)',
                                        }}
                                        data-testid={`calendar-event-date-${ev.id}`}
                                      >
                                        {dayDateHeading}
                                      </div>

                                      {/* 2. Start and end time */}
                                      <div
                                        style={{
                                          fontSize: '0.84rem',
                                          fontWeight: 600,
                                          color: 'var(--primary-color, #2563EB)',
                                        }}
                                        data-testid={`calendar-event-time-${ev.id}`}
                                      >
                                        {formatFriendlyEventTimeRange(ev, s.timeZone)}
                                      </div>

                                      {/* 3. Meeting title */}
                                      <div
                                        style={{
                                          fontSize: '0.94rem',
                                          fontWeight: 700,
                                          color: 'var(--text-primary)',
                                        }}
                                        data-testid={`calendar-event-title-${ev.id}`}
                                      >
                                        {ev.summary}
                                      </div>

                                      {/* 4. Place / online meeting */}
                                      <div
                                        style={{
                                          fontSize: '0.8rem',
                                          color: 'var(--text-secondary)',
                                        }}
                                        data-testid={`calendar-event-location-${ev.id}`}
                                      >
                                        {ev.location || 'Online / No location specified'}
                                      </div>

                                      {/* 5. Simple status (Confirmed, Maybe, Cancelled) + Ownership badge */}
                                      <div
                                        style={{
                                          marginTop: '0.15rem',
                                          display: 'flex',
                                          gap: '0.35rem',
                                          flexWrap: 'wrap',
                                          alignItems: 'center',
                                        }}
                                      >
                                        <span
                                          className={statusStyle.cls}
                                          data-testid={`calendar-event-status-${ev.id}`}
                                        >
                                          {formatCalendarSimpleStatus(ev.status)}
                                        </span>
                                        {ev.ownerSaved !== undefined && (
                                          <span
                                            className={
                                              ev.ownerSaved
                                                ? 'badge badge-info'
                                                : 'badge badge-neutral'
                                            }
                                            data-testid={`calendar-event-origin-${ev.id}`}
                                          >
                                            {ev.ownerSaved
                                              ? 'Saved in Thaara'
                                              : 'External Calendar'}
                                          </span>
                                        )}
                                      </div>

                                      {/* 6. Clear scheduling warning if needed (explained once, clearly) */}
                                      {conflictDetails && (
                                        <div
                                          style={{
                                            marginTop: '0.35rem',
                                            padding: '0.45rem 0.65rem',
                                            borderRadius: '6px',
                                            background: 'var(--warning-bg)',
                                            border: '1px solid var(--warning-border)',
                                            color: 'var(--text-primary)',
                                            fontSize: '0.78rem',
                                            lineHeight: 1.45,
                                          }}
                                          data-testid={`calendar-event-conflict-${ev.id}`}
                                        >
                                          <div>{conflictDetails.warningText}</div>
                                          {conflictDetails.otherMeetingNote && (
                                            <div
                                              style={{
                                                marginTop: '0.15rem',
                                                color: 'var(--text-secondary)',
                                                fontSize: '0.75rem',
                                              }}
                                            >
                                              {conflictDetails.otherMeetingNote}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* RIGHT PANE: Selected Meeting Details */}
                <div className="integration-detail-pane" data-testid="calendar-detail-pane">
                  {s.detailLoading && (
                    <p
                      role="status"
                      style={{ padding: '1rem', margin: 0, color: 'var(--text-secondary)' }}
                    >
                      Loading event details…
                    </p>
                  )}
                  {s.detailError && (
                    <p role="alert" className="error-banner" style={{ margin: '1rem' }}>
                      Unable to load this event. Select it again to retry.
                    </p>
                  )}

                  {!s.detailLoading && !s.detailError && !s.selectedEvent && (
                    <div
                      style={{
                        padding: '1.5rem',
                        color: 'var(--text-secondary)',
                        fontSize: '0.88rem',
                      }}
                    >
                      Select a meeting on the left to view full details and attendees.
                    </div>
                  )}

                  {s.selectedEvent && (
                    <article
                      aria-label="Event details"
                      style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
                    >
                      <div
                        className="integration-detail-header"
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: '0.75rem',
                          flexWrap: 'wrap',
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: '0.8rem',
                              fontWeight: 600,
                              color: 'var(--text-secondary)',
                              marginBottom: '0.15rem',
                            }}
                          >
                            {formatCalendarEventDayAndDate(s.selectedEvent.startAt, s.timeZone)} ·{' '}
                            {formatFriendlyEventTimeRange(s.selectedEvent, s.timeZone)}
                          </div>
                          <h3
                            style={{
                              fontSize: '1.06rem',
                              fontWeight: 700,
                              margin: '0 0 0.35rem 0',
                              color: 'var(--text-primary)',
                            }}
                          >
                            {s.selectedEvent.summary}
                          </h3>
                          <span
                            className={
                              (
                                eventStatusStyles[s.selectedEvent.status] ??
                                eventStatusStyles.confirmed
                              ).cls
                            }
                          >
                            {formatCalendarSimpleStatus(s.selectedEvent.status)}
                          </span>
                        </div>
                        {s.selectedEvent.status !== 'cancelled' && (
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={mutationLoading}
                              onClick={openRescheduleForm}
                              data-testid="calendar-detail-reschedule-btn"
                              style={{ padding: '0.32rem 0.65rem', fontSize: '0.78rem' }}
                            >
                              Reschedule
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger"
                              disabled={mutationLoading}
                              onClick={openCancelForm}
                              data-testid="calendar-detail-cancel-btn"
                              style={{ padding: '0.32rem 0.65rem', fontSize: '0.78rem' }}
                            >
                              Cancel Meeting
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="integration-detail-body">
                        {rescheduleOpen && s.selectedEvent.status !== 'cancelled' && (
                          <form
                            onSubmit={(e) => void handlePrepareReschedule(e)}
                            style={{
                              padding: '0.75rem 0.9rem',
                              borderRadius: '8px',
                              background: 'var(--surface-muted)',
                              border: '1px solid var(--border-color)',
                              display: 'grid',
                              gap: '0.5rem',
                              fontSize: '0.84rem',
                            }}
                            data-testid="calendar-reschedule-form"
                          >
                            <strong>Reschedule "{s.selectedEvent.summary}"</strong>
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                                gap: '0.45rem',
                              }}
                            >
                              <label style={{ display: 'grid', gap: '0.2rem' }}>
                                <span>New Date</span>
                                <input
                                  type="date"
                                  className="integration-search-input"
                                  value={rescheduleDate}
                                  onChange={(e) => setRescheduleDate(e.target.value)}
                                  required
                                  data-testid="calendar-reschedule-date"
                                />
                              </label>
                              <label style={{ display: 'grid', gap: '0.2rem' }}>
                                <span>New Start Time</span>
                                <input
                                  type="time"
                                  className="integration-search-input"
                                  value={rescheduleTime}
                                  onChange={(e) => setRescheduleTime(e.target.value)}
                                  required
                                  data-testid="calendar-reschedule-time"
                                />
                              </label>
                              <label style={{ display: 'grid', gap: '0.2rem' }}>
                                <span>Duration (min)</span>
                                <input
                                  type="number"
                                  min={5}
                                  max={720}
                                  className="integration-search-input"
                                  value={rescheduleDuration}
                                  onChange={(e) => setRescheduleDuration(e.target.value)}
                                  data-testid="calendar-reschedule-duration"
                                />
                              </label>
                              <label style={{ display: 'grid', gap: '0.2rem' }}>
                                <span>Reminder</span>
                                <select
                                  className="integration-select"
                                  value={rescheduleReminder}
                                  onChange={(e) => setRescheduleReminder(e.target.value)}
                                  data-testid="calendar-reschedule-reminder"
                                >
                                  <option value="15">15 minutes before (popup)</option>
                                  <option value="10">10 minutes before (popup)</option>
                                  <option value="30">30 minutes before (popup)</option>
                                  <option value="60">1 hour before (popup)</option>
                                  <option value="default">Google Calendar default</option>
                                  <option value="none">No reminder</option>
                                </select>
                              </label>
                            </div>
                            <div style={{ display: 'flex', gap: '0.45rem' }}>
                              <button
                                type="submit"
                                className="btn btn-primary"
                                disabled={mutationLoading}
                                data-testid="calendar-reschedule-prepare-btn"
                                style={{ padding: '0.32rem 0.7rem', fontSize: '0.78rem' }}
                              >
                                {mutationLoading ? 'Preparing…' : 'Prepare Reschedule'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setRescheduleOpen(false)}
                                style={{ padding: '0.32rem 0.65rem', fontSize: '0.78rem' }}
                              >
                                Close
                              </button>
                            </div>
                          </form>
                        )}
                        {cancelOpen && s.selectedEvent.status !== 'cancelled' && (
                          <form
                            onSubmit={(e) => void handlePrepareCancel(e)}
                            style={{
                              padding: '0.75rem 0.9rem',
                              borderRadius: '8px',
                              background: 'var(--surface-muted)',
                              border: '1px solid var(--border-color)',
                              display: 'grid',
                              gap: '0.5rem',
                              fontSize: '0.84rem',
                            }}
                            data-testid="calendar-cancel-form"
                          >
                            <strong>Cancel "{s.selectedEvent.summary}"</strong>
                            <label style={{ display: 'grid', gap: '0.2rem' }}>
                              <span>Guest Notifications</span>
                              <select
                                className="integration-select"
                                value={cancelSendUpdates}
                                onChange={(e) =>
                                  setCancelSendUpdates(e.target.value as 'none' | 'all')
                                }
                                data-testid="calendar-cancel-send-updates"
                              >
                                <option value="none">Do not notify guests</option>
                                <option value="all">Notify guests</option>
                              </select>
                            </label>
                            <div style={{ display: 'flex', gap: '0.45rem' }}>
                              <button
                                type="submit"
                                className="btn btn-danger"
                                disabled={mutationLoading}
                                data-testid="calendar-cancel-prepare-btn"
                                style={{ padding: '0.32rem 0.7rem', fontSize: '0.78rem' }}
                              >
                                {mutationLoading ? 'Preparing…' : 'Prepare Cancellation'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setCancelOpen(false)}
                                style={{ padding: '0.32rem 0.65rem', fontSize: '0.78rem' }}
                              >
                                Close
                              </button>
                            </div>
                          </form>
                        )}
                        {/* Single Clear Scheduling Warning if overlapping */}
                        {selectedConflictDetails && (
                          <div
                            style={{
                              padding: '0.65rem 0.85rem',
                              borderRadius: '8px',
                              background: 'var(--warning-bg)',
                              border: '1px solid var(--warning-border)',
                              color: 'var(--text-primary)',
                              fontSize: '0.84rem',
                              lineHeight: 1.5,
                            }}
                            data-testid="calendar-detail-conflict-note"
                          >
                            <div>{selectedConflictDetails.warningText}</div>
                            {selectedConflictDetails.otherMeetingNote && (
                              <div
                                style={{
                                  marginTop: '0.2rem',
                                  color: 'var(--text-secondary)',
                                  fontSize: '0.8rem',
                                }}
                              >
                                {selectedConflictDetails.otherMeetingNote}
                              </div>
                            )}
                          </div>
                        )}

                        <div
                          style={{
                            padding: '0.75rem 0.9rem',
                            borderRadius: '8px',
                            background: 'var(--surface-muted)',
                            border: '1px solid var(--border-color)',
                            fontSize: '0.85rem',
                            display: 'grid',
                            gap: '0.35rem',
                          }}
                        >
                          <p style={{ margin: 0 }}>
                            <strong>Place:</strong>{' '}
                            {s.selectedEvent.location || 'Online / No location specified'}
                          </p>
                          <p style={{ margin: 0 }} data-testid="calendar-detail-reminder">
                            <strong>Reminder:</strong>{' '}
                            {formatCalendarRemindersLabel(s.selectedEvent.reminders)}
                          </p>
                          {s.selectedEvent.ownerSaved !== undefined && (
                            <p style={{ margin: 0 }} data-testid="calendar-detail-origin">
                              <strong>Source:</strong>{' '}
                              {s.selectedEvent.ownerSaved
                                ? 'Saved by you in Thaara'
                                : 'Existing Google Calendar event'}
                            </p>
                          )}
                          {s.selectedEvent.organizerEmail && (
                            <p style={{ margin: 0 }}>
                              <strong>Organizer:</strong> {s.selectedEvent.organizerEmail}
                            </p>
                          )}
                        </div>

                        {s.selectedEvent.attendees.length > 0 && (
                          <div style={{ fontSize: '0.84rem' }}>
                            <strong style={{ display: 'block', marginBottom: '0.35rem' }}>
                              Attendees ({s.selectedEvent.attendees.length}):
                            </strong>
                            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                              {s.selectedEvent.attendees.map((att, index) => (
                                <li key={`${att.email ?? att.displayName ?? 'att'}-${index}`}>
                                  {att.displayName || att.email || 'Participant'}
                                  {att.email && att.displayName ? ` (${att.email})` : ''}
                                  {att.responseStatus ? ` — ${att.responseStatus}` : ''}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <details
                          className="integration-settings-drawer"
                          open={
                            !s.selectedEvent.description ||
                            s.selectedEvent.description.length <= 160
                          }
                          data-testid="calendar-event-details-drawer"
                          style={{ margin: 0 }}
                        >
                          <summary>Details (Meeting notes &amp; description)</summary>
                          <div className="integration-settings-body">
                            <pre
                              style={{
                                margin: 0,
                                padding: '0.75rem 0.9rem',
                                borderRadius: '8px',
                                background: 'var(--canvas-bg)',
                                border: '1px solid var(--border-color)',
                                fontFamily: 'var(--font-sans)',
                                fontSize: '0.85rem',
                                whiteSpace: 'pre-wrap',
                                overflowWrap: 'anywhere',
                                maxHeight: '16rem',
                                overflow: 'auto',
                              }}
                            >
                              {s.selectedEvent.description || '(No meeting notes)'}
                            </pre>
                          </div>
                        </details>
                      </div>
                    </article>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

export function CalendarScreen({
  role,
  workspaceId,
  userId,
}: {
  role: string;
  workspaceId: string;
  userId: string;
}) {
  const subject = JSON.stringify([workspaceId, userId, role]);
  const [view, setView] = useState<{ subject: string; state: CalendarState }>(() => ({
    subject,
    state: initialCalendarState(role, {
      timeZone: DEFAULT_WORKSPACE_TIMEZONE,
      rangePreset: 'today',
    }),
  }));
  const [timeZoneDraft, setTimeZoneDraft] = useState(DEFAULT_WORKSPACE_TIMEZONE);
  const [statusFilter, setStatusFilter] = useState<CalendarStatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const model = useRef<ReturnType<typeof createCalendarModel> | null>(null);

  useEffect(() => {
    const current = createCalendarModel(
      role,
      (state) => setView({ subject, state }),
      undefined,
      { timeZone: DEFAULT_WORKSPACE_TIMEZONE, rangePreset: 'today' },
    );
    model.current = current;
    setView({
      subject,
      state: initialCalendarState(role, {
        timeZone: DEFAULT_WORKSPACE_TIMEZONE,
        rangePreset: 'today',
      }),
    });
    setTimeZoneDraft(DEFAULT_WORKSPACE_TIMEZONE);
    setStatusFilter('all');
    setSearchQuery('');
    void current.loadStatus();
    return () => {
      current.dispose();
      if (model.current === current) model.current = null;
    };
  }, [subject, role]);

  const currentState =
    view.subject === subject
      ? view.state
      : initialCalendarState(role, {
          timeZone: DEFAULT_WORKSPACE_TIMEZONE,
          rangePreset: 'today',
        });

  useEffect(() => {
    if (
      currentState.loaded &&
      !currentState.agendaLoading &&
      !currentState.selectedId &&
      !currentState.detailLoading &&
      currentState.agenda &&
      currentState.agenda.days.length > 0
    ) {
      const firstEvent = currentState.agenda.days[0]?.events[0];
      if (firstEvent) {
        void model.current?.selectEvent(firstEvent.id);
      }
    }
  }, [
    currentState.loaded,
    currentState.agendaLoading,
    currentState.selectedId,
    currentState.detailLoading,
    currentState.agenda,
  ]);

  return (
    <CalendarScreenView
      state={currentState}
      timeZoneDraft={view.subject === subject ? timeZoneDraft : DEFAULT_WORKSPACE_TIMEZONE}
      onTimeZoneDraft={setTimeZoneDraft}
      onApplyTimeZone={() => void model.current?.setTimeZone(timeZoneDraft)}
      onToday={() => void model.current?.resetToToday()}
      onPrevRange={() => void model.current?.selectRangePreset('prev_7_days')}
      onNextRange={() => void model.current?.selectRangePreset('next_7_days')}
      onSelectRangePreset={(preset) => void model.current?.selectRangePreset(preset)}
      onToggleCancelled={(checked) => void model.current?.toggleCancelled(checked)}
      onSelectEvent={(id) => void model.current?.selectEvent(id)}
      onRefresh={() => void model.current?.loadStatus()}
      onDisconnect={() => void model.current?.disconnect()}
      onConnect={() => {
        void model.current?.connect().then((url) => {
          if (url && typeof window !== 'undefined') {
            window.location.assign(url);
          }
        });
      }}
      statusFilter={statusFilter}
      onStatusFilter={setStatusFilter}
      searchQuery={searchQuery}
      onSearchQuery={setSearchQuery}
    />
  );
}
