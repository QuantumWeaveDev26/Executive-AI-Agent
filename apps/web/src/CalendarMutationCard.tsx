import type { ApprovalRequestItem, PlanWithStepsItem } from './api';
import {
  CALENDAR_CANCEL_EVENT_ACTION,
  CALENDAR_CREATE_EVENT_ACTION,
  CALENDAR_RESCHEDULE_EVENT_ACTION,
  CalendarMutationOutcome,
  calendarMutationOutcomeFromPlan,
  formatCalendarRemindersLabel,
  sanitizeCalendarReminders,
} from './calendar-api';
import { formatCalendarEventDayAndDate, formatFriendlyDateTime } from './integration-ui';

export interface CalendarMutationChatCardProps {
  approval?: ApprovalRequestItem;
  plan?: PlanWithStepsItem;
  canDecide: boolean;
  decideReason?: string;
  deciding: boolean;
  refreshing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onRefresh: () => void;
}

type CardState =
  | 'waiting'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'unverified'
  | 'cancelled'
  | 'expired';

export function calendarMutationResultMessage(outcome: CalendarMutationOutcome): string {
  switch (outcome.kind) {
    case 'completed': {
      const when = outcome.startAt
        ? formatFriendlyDateTime(outcome.startAt, {
            timeZone: outcome.timeZone || 'Asia/Kolkata',
          })
        : '';
      const reminderSuffix = outcome.reminders
        ? ` Reminder saved in Google Calendar: ${formatCalendarRemindersLabel(outcome.reminders)}.`
        : '';
      if (outcome.operation === 'reschedule') {
        return when
          ? `Meeting scheduled for ${when} (rescheduled "${outcome.summary}").${reminderSuffix}`
          : `Meeting "${outcome.summary}" rescheduled.${reminderSuffix}`;
      }
      if (outcome.operation === 'cancel') {
        return `Meeting "${outcome.summary}" was cancelled.`;
      }
      return when
        ? `Meeting scheduled for ${when}.${reminderSuffix}`
        : `Meeting "${outcome.summary}" scheduled.${reminderSuffix}`;
    }
    case 'unverified':
      return "We couldn't confirm whether Google Calendar completed this change. Please refresh your calendar before trying again. Thaara will not retry automatically.";
    case 'cancelled':
      return 'No changes were made to your Google Calendar.';
    case 'pending':
      return 'Approved. Updating your Google Calendar…';
    default: {
      if (outcome.reason === 'CALENDAR_EVENT_CHANGED_SINCE_PREVIEW') {
        return 'Meeting could not be scheduled because the event changed in Google Calendar after your preview was prepared.';
      }
      if (outcome.reason === 'CALENDAR_WRITE_SCOPE_REQUIRED') {
        return 'Meeting could not be scheduled. Please reconnect Google Calendar to grant scheduling permission.';
      }
      return 'Meeting could not be scheduled.';
    }
  }
}

function formatTimeRangeInZone(startIso: string, endIso: string, timeZone: string): string {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return `${startIso} – ${endIso}`;
  }
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${fmt.format(new Date(startMs))} – ${fmt.format(new Date(endMs))}`;
  } catch {
    return `${startIso} – ${endIso}`;
  }
}

export function CalendarMutationChatCard(p: CalendarMutationChatCardProps) {
  const step = p.plan?.steps.find(
    (s) =>
      s.action_name === CALENDAR_CREATE_EVENT_ACTION ||
      s.action_name === CALENDAR_RESCHEDULE_EVENT_ACTION ||
      s.action_name === CALENDAR_CANCEL_EVENT_ACTION,
  );
  const actionName =
    p.approval?.actionName ?? step?.action_name ?? CALENDAR_CREATE_EVENT_ACTION;
  const operation: 'create' | 'reschedule' | 'cancel' =
    actionName === CALENDAR_RESCHEDULE_EVENT_ACTION
      ? 'reschedule'
      : actionName === CALENDAR_CANCEL_EVENT_ACTION
        ? 'cancel'
        : 'create';

  const params = (p.approval?.actionParams ?? step?.parameters ?? {}) as Record<string, unknown>;
  const summary = typeof params.summary === 'string' && params.summary ? params.summary : 'Meeting';
  const timeZone =
    typeof params.timeZone === 'string' && params.timeZone ? params.timeZone : 'Asia/Kolkata';
  const startAt =
    typeof params.newStartAt === 'string'
      ? params.newStartAt
      : typeof params.startAt === 'string'
        ? params.startAt
        : typeof params.expectedStartAt === 'string'
          ? params.expectedStartAt
          : '';
  const endAt =
    typeof params.newEndAt === 'string'
      ? params.newEndAt
      : typeof params.endAt === 'string'
        ? params.endAt
        : typeof params.expectedEndAt === 'string'
          ? params.expectedEndAt
          : '';
  const previousStartAt =
    typeof params.expectedStartAt === 'string' ? params.expectedStartAt : '';
  const previousEndAt = typeof params.expectedEndAt === 'string' ? params.expectedEndAt : '';
  const connectedEmail =
    typeof params.connectedCalendar === 'string' && params.connectedCalendar
      ? params.connectedCalendar
      : typeof params.connectedEmail === 'string' && params.connectedEmail
        ? params.connectedEmail
        : null;
  const location =
    typeof params.location === 'string' && params.location ? params.location : null;
  const attendees = Array.isArray(params.attendees)
    ? params.attendees.filter((a): a is string => typeof a === 'string')
    : [];
  const reminders = sanitizeCalendarReminders(params.reminders);
  const durationMinutes =
    startAt && endAt
      ? Math.max(5, Math.round((Date.parse(endAt) - Date.parse(startAt)) / 60_000) || 30)
      : null;
  const sendUpdates = params.sendUpdates === 'all' ? 'all' : 'none';

  const outcome = p.plan ? calendarMutationOutcomeFromPlan(p.plan, summary) : null;
  const expired = Boolean(
    p.approval &&
      p.approval.status === 'pending' &&
      new Date(p.approval.expiresAt) < new Date(),
  );

  let state: CardState;
  if (outcome && outcome.kind !== 'pending') {
    state = outcome.kind;
  } else if (p.approval?.status === 'rejected') {
    state = 'cancelled';
  } else if (p.approval?.status === 'expired' || expired) {
    state = 'expired';
  } else if (p.approval?.status === 'approved') {
    state = 'executing';
  } else {
    state = 'waiting';
  }

  const badgeLabel =
    state === 'completed'
      ? operation === 'reschedule'
        ? { text: 'Rescheduled', className: 'badge badge-success' }
        : operation === 'cancel'
          ? { text: 'Cancelled Event', className: 'badge badge-success' }
          : { text: 'Scheduled', className: 'badge badge-success' }
      : state === 'waiting'
        ? { text: 'Waiting for approval', className: 'badge badge-warning' }
        : state === 'executing'
          ? { text: 'Updating Calendar…', className: 'badge badge-info' }
          : state === 'failed'
            ? { text: 'Not scheduled', className: 'badge badge-danger' }
            : state === 'unverified'
              ? { text: 'Could not confirm', className: 'badge badge-danger' }
              : state === 'expired'
                ? { text: 'Expired', className: 'badge badge-neutral' }
                : { text: 'Cancelled', className: 'badge badge-neutral' };

  const headerTitle =
    operation === 'reschedule'
      ? `Reschedule Meeting: ${summary}`
      : operation === 'cancel'
        ? `Cancel Meeting: ${summary}`
        : `Schedule Meeting: ${summary}`;

  const confirmButtonText =
    operation === 'reschedule'
      ? 'Approve & Reschedule'
      : operation === 'cancel'
        ? 'Approve & Cancel Meeting'
        : 'Approve & Schedule';

  const receipt = step ? p.plan?.receipts.find((r) => r.plan_step_id === step.id) : undefined;
  const resultText =
    outcome && outcome.kind !== 'pending'
      ? calendarMutationResultMessage(outcome)
      : state === 'failed' || state === 'unverified' || state === 'cancelled'
        ? calendarMutationResultMessage({ kind: state, summary })
        : state === 'expired'
          ? 'This calendar request expired. No changes were made to your calendar.'
          : state === 'executing'
            ? 'Approved. Waiting for Google Calendar…'
            : null;

  return (
    <div className="chat-plan-card" data-testid="calendar-mutation-chat-card">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        <strong>{headerTitle}</strong>
        <span className={badgeLabel.className} data-testid="calendar-mutation-chat-status">
          {badgeLabel.text}
        </span>
      </div>

      <div style={{ display: 'grid', gap: '0.25rem', fontSize: '0.84rem' }}>
        {connectedEmail && (
          <div>
            <strong>Calendar:</strong> {connectedEmail} (primary)
          </div>
        )}
        <div>
          <strong>Title:</strong> {summary}
        </div>
        {operation === 'reschedule' && previousStartAt && previousEndAt && (
          <div>
            <strong>Previous Time:</strong>{' '}
            {formatCalendarEventDayAndDate(previousStartAt, timeZone)} ·{' '}
            {formatTimeRangeInZone(previousStartAt, previousEndAt, timeZone)} ({timeZone})
          </div>
        )}
        {startAt && endAt && (
          <div>
            <strong>{operation === 'reschedule' ? 'New Time:' : 'When:'}</strong>{' '}
            {formatCalendarEventDayAndDate(startAt, timeZone)} ·{' '}
            {formatTimeRangeInZone(startAt, endAt, timeZone)} ({timeZone})
          </div>
        )}
        {operation !== 'cancel' && durationMinutes && (
          <div data-testid="calendar-mutation-chat-duration">
            <strong>Duration:</strong> {durationMinutes} minutes
          </div>
        )}
        {operation !== 'cancel' && (
          <div data-testid="calendar-mutation-chat-reminder">
            <strong>Reminder:</strong> {formatCalendarRemindersLabel(reminders)}{' '}
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
              (saved to Google Calendar; notification delivery depends on your Google Calendar &amp;
              device settings)
            </span>
          </div>
        )}
        {location && (
          <div>
            <strong>Location:</strong> {location}
          </div>
        )}
        {attendees.length > 0 && (
          <div>
            <strong>Attendees:</strong> {attendees.join(', ')}
          </div>
        )}
        {operation === 'cancel' && (
          <div>
            <strong>Guest Notifications:</strong>{' '}
            {sendUpdates === 'all' ? 'Guests will be notified' : 'Do not notify guests'}
          </div>
        )}
      </div>

      {state === 'waiting' &&
        (p.canDecide ? (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={p.deciding}
              onClick={p.onConfirm}
              data-testid="calendar-mutation-chat-confirm"
              style={{ padding: '0.35rem 0.8rem', fontSize: '0.8rem' }}
            >
              {p.deciding ? 'Updating…' : confirmButtonText}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={p.deciding}
              onClick={p.onCancel}
              data-testid="calendar-mutation-chat-cancel"
              style={{ padding: '0.35rem 0.8rem', fontSize: '0.8rem' }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ fontSize: '0.78rem', color: 'var(--warning)', marginTop: '0.5rem' }}>
            {p.decideReason ||
              'Only the person who prepared this calendar change can approve or cancel it.'}
          </div>
        ))}

      {resultText && (
        <p
          style={{ margin: '0.6rem 0 0', fontSize: '0.84rem' }}
          role="status"
          data-testid="calendar-mutation-chat-result"
        >
          {resultText}
        </p>
      )}

      {state === 'executing' && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={p.refreshing}
          onClick={p.onRefresh}
          style={{ marginTop: '0.4rem', padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
        >
          {p.refreshing ? 'Checking…' : 'Check again'}
        </button>
      )}

      <details style={{ marginTop: '0.6rem', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
        <summary>Technical details</summary>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            display: 'grid',
            gap: '0.15rem',
            marginTop: '0.3rem',
          }}
        >
          {p.plan && (
            <div>
              Plan: {p.plan.id} ({p.plan.status})
            </div>
          )}
          {p.approval && (
            <div>
              Approval: {p.approval.id} ({p.approval.status})
            </div>
          )}
          <div>Action: {actionName}</div>
          {step && <div>Step: {step.status}</div>}
          {receipt && (
            <div>
              Receipt: {receipt.status} via {receipt.verification_method}
            </div>
          )}
          {outcome?.kind === 'completed' && (
            <div>Google Event ID: {outcome.providerEventId}</div>
          )}
        </div>
      </details>
    </div>
  );
}
