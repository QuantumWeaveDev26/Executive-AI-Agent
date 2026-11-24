import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../src/api';
import {
  CALENDAR_PAGE_SIZE,
  calendarError,
  disconnectCalendar,
  formatCalendarEventWindow,
  getCalendarAgenda,
  getCalendarStatus,
  readCalendarEvent
} from '../src/calendar-api';

const baseStatus = {
  connectorName: 'google_calendar' as const,
  status: 'connected' as const,
  connected: true,
  configured: true,
  mode: 'mock' as const,
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  lastVerifiedAt: '2026-10-19T00:00:00Z'
};

const sampleEvent = {
  id: 'evt_1',
  calendarId: 'primary',
  summary: 'Executive Review',
  description: 'Review Q4 metrics',
  location: 'Boardroom',
  startAt: '2026-10-19T14:00:00Z',
  endAt: '2026-10-19T15:00:00Z',
  timeZone: 'UTC',
  allDay: false,
  status: 'confirmed' as const,
  organizerEmail: 'ceo@example.test',
  attendees: [{ email: 'ceo@example.test', displayName: 'CEO', responseStatus: 'accepted' as const }],
  untrusted: true as const,
  mode: 'mock' as const
};

const fetcher = vi.fn();
beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal('document', { cookie: 'thaara_csrf=cal-csrf-token' });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());

const respond = (value: unknown) =>
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => value });

describe('Step 88 — Google Calendar browser API safety', () => {
  it('uses cookie authentication and CSRF for POST agenda and DELETE connection', async () => {
    respond({
      windowStart: '2026-10-19T00:00:00Z',
      windowEnd: '2026-10-26T00:00:00Z',
      timeZone: 'UTC',
      totalEvents: 1,
      conflictEventIds: [],
      days: [{ localDate: '2026-10-19', events: [sampleEvent] }],
      n8nContext: {
        connector: 'google_calendar',
        operation: 'read_agenda_snapshot',
        readOnly: true,
        timeZone: 'UTC',
        windowStart: '2026-10-19T00:00:00Z',
        windowEnd: '2026-10-26T00:00:00Z',
        eventIds: ['evt_1']
      },
      untrusted: true,
      mode: 'mock'
    });

    await getCalendarAgenda({
      windowStart: '2026-10-19T00:00:00Z',
      windowEnd: '2026-10-26T00:00:00Z',
      timeZone: 'UTC'
    });
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe('/api/v1/connectors/google-calendar/agenda');
    expect(options.credentials).toBe('include');
    expect(options.method).toBe('POST');
    expect(new Headers(options.headers).get('x-csrf-token')).toBe('cal-csrf-token');
    expect(JSON.parse(options.body)).toEqual({
      windowStart: '2026-10-19T00:00:00Z',
      windowEnd: '2026-10-26T00:00:00Z',
      timeZone: 'UTC',
      includeCancelled: false,
      limit: CALENDAR_PAGE_SIZE
    });

    respond({ ...baseStatus, status: 'disconnected', connected: false });
    await disconnectCalendar();
    const delOpts = fetcher.mock.calls[1]![1];
    expect(delOpts.method).toBe('DELETE');
    expect(delOpts.body).toBe('{}');
    expect(new Headers(delOpts.headers).get('x-csrf-token')).toBe('cal-csrf-token');
  });

  it.each(['../secret', 'https://evil.example', 'evt%2F1', ''])(
    'rejects unsafe event ID %s before any fetch',
    async (id) => {
      await expect(readCalendarEvent(id)).rejects.toMatchObject({ status: 400 });
      expect(fetcher).not.toHaveBeenCalled();
    }
  );

  it('rejects invalid date ranges and invalid IANA timezones before fetching', async () => {
    await expect(
      getCalendarAgenda({
        windowStart: '2026-10-20T00:00:00Z',
        windowEnd: '2026-10-19T00:00:00Z',
        timeZone: 'UTC'
      })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      getCalendarAgenda({
        windowStart: '2026-10-19T00:00:00Z',
        windowEnd: '2026-10-20T00:00:00Z',
        timeZone: 'Invalid/Timezone'
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('strips unknown HTML/secret fields and rejects live-mode or mismatched event responses', async () => {
    respond({ ...sampleEvent, id: 'wrong_id' });
    await expect(readCalendarEvent('evt_1')).rejects.toMatchObject({ status: 502 });

    respond({ ...sampleEvent, mode: 'live' });
    await expect(readCalendarEvent('evt_1')).rejects.toMatchObject({ status: 502 });

    respond({ ...sampleEvent, untrusted: false });
    await expect(readCalendarEvent('evt_1')).rejects.toMatchObject({ status: 502 });

    respond({
      ...sampleEvent,
      rawHtml: '<script>evil()</script>',
      accessToken: 'SECRET-ACCESS-TOKEN'
    });
    const clean = await readCalendarEvent('evt_1');
    expect(clean).not.toHaveProperty('rawHtml');
    expect(clean).not.toHaveProperty('accessToken');
    expect(clean.summary).toBe('Executive Review');
  });

  it('rejects live-mode status and formats event windows in the target timezone', async () => {
    respond({ ...baseStatus, mode: 'live' });
    await expect(getCalendarStatus()).rejects.toMatchObject({ status: 502 });

    const formatted = formatCalendarEventWindow(sampleEvent, 'Asia/Kolkata');
    expect(formatted).toContain('Asia/Kolkata');
    expect(formatted).toContain('19:30');
  });

  it('redacts server error strings into safe error categories', () => {
    expect(calendarError(new ApiRequestError(403, 'secret-db-error'))).toBe('unauthorized');
    expect(calendarError(new ApiRequestError(409, 'epoch-mismatch'))).toBe('reconnect');
    expect(calendarError(new ApiRequestError(400, 'bad-input'))).toBe('invalid_query');
    expect(calendarError(new Error('private-stack'))).toBe('unavailable');
  });
});
