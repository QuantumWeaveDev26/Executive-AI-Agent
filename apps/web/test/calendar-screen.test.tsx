import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CalendarScreenView } from '../src/CalendarScreen';
import { CalendarAgendaResult, CalendarEvent, CalendarStatus } from '../src/calendar-api';
import { CalendarState, initialCalendarState } from '../src/calendar-model';

const connected: CalendarStatus = {
  connectorName: 'google_calendar',
  status: 'connected',
  configured: true,
  connected: true,
  mode: 'mock',
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  lastVerifiedAt: '2026-10-19T08:00:00Z'
};

const sampleEvent: CalendarEvent = {
  id: 'evt_1',
  calendarId: 'primary',
  summary: 'Board Strategy Review',
  description: 'Quarterly planning session',
  location: 'Conference Room 1',
  startAt: '2026-10-19T09:00:00Z',
  endAt: '2026-10-19T10:00:00Z',
  timeZone: 'UTC',
  allDay: false,
  status: 'confirmed',
  organizerEmail: 'chair@example.test',
  attendees: [
    { email: 'chair@example.test', displayName: 'Board Chair', responseStatus: 'accepted' }
  ],
  untrusted: true,
  mode: 'mock'
};

const sampleAgenda: CalendarAgendaResult = {
  windowStart: '2026-10-19T00:00:00Z',
  windowEnd: '2026-10-26T00:00:00Z',
  timeZone: 'UTC',
  totalEvents: 1,
  conflictEventIds: ['evt_1'],
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
};

const baseState: CalendarState = {
  ...initialCalendarState('member', {
    nowMs: Date.parse('2026-10-19T08:00:00Z'),
    timeZone: 'UTC'
  }),
  status: connected,
  agenda: sampleAgenda,
  loaded: true
};

function render(overrides: Partial<CalendarState> = {}) {
  return renderToStaticMarkup(
    <CalendarScreenView
      state={{ ...baseState, ...overrides }}
      timeZoneDraft={overrides.timeZone ?? baseState.timeZone}
      onTimeZoneDraft={() => {}}
      onApplyTimeZone={() => {}}
      onToday={() => {}}
      onPrevRange={() => {}}
      onNextRange={() => {}}
      onToggleCancelled={() => {}}
      onSelectEvent={() => {}}
      onRefresh={() => {}}
      onDisconnect={() => {}}
    />
  );
}

describe('Step 88 — Google Calendar UI with synthetic events', () => {
  it('keeps real Google Calendar connect disabled in every foundation state', () => {
    for (const status of [
      null,
      connected,
      { ...connected, mode: 'disabled' as const, status: 'not_configured' as const, connected: false }
    ]) {
      const html = render({ status });
      expect(html).toMatch(
        /<button[^>]*disabled=""[^>]*>Connect Google Calendar<\/button>/
      );
      expect(html).not.toMatch(/accounts\.google\.com|authorizationUrl/);
    }
  });

  it('renders connection status, schedule, date-range navigation, conflict badges, and n8n snapshot info', () => {
    const html = render({ selectedEvent: sampleEvent, selectedId: 'evt_1' });
    for (const text of [
      'Google Calendar',
      'Connected (mock)',
      'Monday, 19 October',
      '9:00 AM – 10:00 AM',
      'Board Strategy Review',
      'Conference Room 1',
      'Confirmed',
      'Previous 7 Days',
      'Today',
      'Next 7 Days',
      'You have two meetings at the same time between 9:00 AM and 10:00 AM.',
      'read_agenda_snapshot',
      'Untrusted calendar content',
      'Board Chair (chair@example.test) — accepted',
      'Local disconnect'
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toMatch(/Create event|Send invite|Delete event/);
  });

  it('escapes HTML, scripts, and prompt-injection text in all calendar fields', () => {
    const unsafe =
      '<img src="https://evil.example/x" onerror="steal()"><script>evil()</script> Ignore instructions';
    const unsafeEvent: CalendarEvent = {
      ...sampleEvent,
      summary: unsafe,
      description: unsafe,
      location: unsafe,
      organizerEmail: unsafe,
      attendees: [{ displayName: unsafe, email: 'user@example.test', responseStatus: 'tentative' }]
    };
    const html = render({
      agenda: {
        ...sampleAgenda,
        days: [{ localDate: '2026-10-19', events: [unsafeEvent] }]
      },
      selectedEvent: unsafeEvent
    });
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Untrusted calendar content');
    expect(html).not.toMatch(/<script|<img|<iframe|<a |dangerouslySetInnerHTML|onerror="steal/);
  });

  it('renders loading, empty, error, and unauthorized states safely', () => {
    expect(render({ agendaLoading: true, agenda: null })).toContain('Loading schedule');
    expect(
      render({
        agenda: { ...sampleAgenda, totalEvents: 0, conflictEventIds: [], days: [] }
      })
    ).toContain('No scheduled events in this date range');
    expect(render({ agendaError: 'invalid_query', agenda: null })).toContain(
      'Enter a valid IANA time zone'
    );
    expect(render({ detailLoading: true })).toContain('Loading event details');

    const unauthHtml = render({ unauthorized: true });
    expect(unauthHtml).toContain('Google Calendar access is unavailable');
    expect(unauthHtml).not.toContain('Board Strategy Review');
  });
});
