import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../src/api';
import { CalendarAgendaResult, CalendarEvent, CalendarStatus } from '../src/calendar-api';
import { createCalendarModel } from '../src/calendar-model';

const fixedNow = Date.parse('2026-10-19T08:00:00Z');

const connectedStatus: CalendarStatus = {
  connectorName: 'google_calendar',
  status: 'connected',
  mode: 'mock',
  configured: true,
  connected: true,
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  lastVerifiedAt: '2026-10-19T08:00:00Z'
};

function makeEvent(id: string): CalendarEvent {
  return {
    id,
    calendarId: 'primary',
    summary: `Event ${id}`,
    description: `Description for ${id}`,
    location: 'Room A',
    startAt: '2026-10-19T09:00:00Z',
    endAt: '2026-10-19T10:00:00Z',
    timeZone: 'UTC',
    allDay: false,
    status: 'confirmed',
    attendees: [],
    untrusted: true,
    mode: 'mock'
  };
}

function makeAgenda(
  ids: string[],
  overrides: Partial<CalendarAgendaResult> = {}
): CalendarAgendaResult {
  return {
    windowStart: '2026-10-19T00:00:00Z',
    windowEnd: '2026-10-26T00:00:00Z',
    timeZone: 'UTC',
    totalEvents: ids.length,
    conflictEventIds: ids.length > 1 ? ids : [],
    days: ids.length ? [{ localDate: '2026-10-19', events: ids.map(makeEvent) }] : [],
    n8nContext: {
      connector: 'google_calendar',
      operation: 'read_agenda_snapshot',
      readOnly: true,
      timeZone: 'UTC',
      windowStart: '2026-10-19T00:00:00Z',
      windowEnd: '2026-10-26T00:00:00Z',
      eventIds: ids
    },
    untrusted: true,
    mode: 'mock',
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function createFixture(role = 'member') {
  const api = {
    status: vi.fn(async () => connectedStatus),
    agenda: vi.fn(async (input) =>
      makeAgenda(['evt_1'], {
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        timeZone: input.timeZone
      })
    ),
    readEvent: vi.fn(async (id: string) => makeEvent(id)),
    disconnect: vi.fn(async () => ({
      ...connectedStatus,
      status: 'disconnected' as const,
      connected: false
    }))
  };
  const publish = vi.fn();
  const model = createCalendarModel(role, publish, api, { nowMs: fixedNow, timeZone: 'UTC' });
  return { api, publish, model };
}

describe('Step 88 — Google Calendar view lifecycle and subject fencing', () => {
  it('blocks viewer access without dispatching any Calendar requests', async () => {
    const f = createFixture('viewer');
    await f.model.loadStatus();
    await f.model.loadAgenda();
    expect(f.model.getState().unauthorized).toBe(true);
    expect(f.api.status).not.toHaveBeenCalled();
    expect(f.api.agenda).not.toHaveBeenCalled();
  });

  it('does not request agenda for an unconfigured connection', async () => {
    const f = createFixture();
    f.api.status.mockResolvedValueOnce({
      ...connectedStatus,
      status: 'not_configured',
      mode: 'disabled',
      configured: false,
      connected: false
    });
    await f.model.loadStatus();
    expect(f.api.agenda).not.toHaveBeenCalled();
    expect(f.model.getState().agenda).toBeNull();
  });

  it('loads schedule, navigates date ranges, switches timezones, and fetches event details', async () => {
    const f = createFixture();
    await f.model.loadStatus();
    expect(f.api.agenda).toHaveBeenCalledWith(
      {
        windowStart: '2026-10-19T00:00:00Z',
        windowEnd: '2026-10-26T00:00:00Z',
        timeZone: 'UTC',
        includeCancelled: false
      },
      expect.any(AbortSignal)
    );

    await f.model.selectEvent('evt_1');
    expect(f.model.getState().selectedEvent?.id).toBe('evt_1');

    // Shifting window clears selected event and queries new 7-day range
    await f.model.shiftWindow(7);
    expect(f.model.getState().selectedEvent).toBeNull();
    expect(f.model.getState().windowStart).toBe('2026-10-26T00:00:00Z');
    expect(f.model.getState().windowEnd).toBe('2026-11-02T00:00:00Z');

    await f.model.setTimeZone('Asia/Kolkata');
    expect(f.model.getState().timeZone).toBe('Asia/Kolkata');
  });

  it('rejects unknown event IDs and invalid timezones without calling the backend', async () => {
    const f = createFixture();
    await f.model.loadStatus();
    const readCount = f.api.readEvent.mock.calls.length;
    await f.model.selectEvent('unknown_event');
    expect(f.api.readEvent).toHaveBeenCalledTimes(readCount);

    const agendaCount = f.api.agenda.mock.calls.length;
    await f.model.setTimeZone('Invalid/Zone');
    expect(f.api.agenda).toHaveBeenCalledTimes(agendaCount);
    expect(f.model.getState().agendaError).toBe('invalid_query');
  });

  it('ignores stale agenda and detail responses and clears private data immediately on disconnect', async () => {
    const f = createFixture();
    await f.model.loadStatus();

    const slowDetail = deferred<CalendarEvent>();
    f.api.readEvent.mockImplementationOnce(() => slowDetail.promise);
    const pendingSelect = f.model.selectEvent('evt_1');

    await f.model.disconnect();
    expect(f.model.getState().agenda).toBeNull();
    expect(f.model.getState().selectedEvent).toBeNull();

    slowDetail.resolve(makeEvent('evt_1'));
    await pendingSelect;
    expect(f.model.getState().selectedEvent).toBeNull();
    expect(f.model.getState().status?.status).toBe('disconnected');
  });

  it.each([401, 403])(
    'clears all cached schedule data on HTTP %s authorization failure',
    async (httpStatus) => {
      const f = createFixture();
      await f.model.loadStatus();
      f.api.readEvent.mockRejectedValueOnce(new ApiRequestError(httpStatus, 'PRIVATE'));
      await f.model.selectEvent('evt_1');
      expect(f.model.getState()).toMatchObject({
        unauthorized: true,
        agenda: null,
        selectedEvent: null,
        status: null
      });
    }
  );
});
