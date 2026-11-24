import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AuthenticatedScope } from '@thaara/db';
import { defaultPolicyGateway } from '@thaara/policy';
import {
  GOOGLE_CALENDAR_READONLY,
  GoogleCalendarFoundation,
  GoogleCalendarVault,
  computeCalendarRangeWindowInTimeZone,
  getZonedMidnightMs,
  parseIsoDateToZonedMidnightIso
} from '../src/services/google-calendar.js';
import { LiveGoogleCalendarProvider } from '../src/services/google-live.js';
import {
  detectCalendarChatRequest,
  executeChatCalendarRequest
} from '../src/services/chat-calendar-assistant.js';

function createMemoryStore() {
  const map = new Map<string, string>();
  return {
    store: {
      get: (k: string) => map.get(k),
      set: (k: string, v: string) => {
        map.set(k, v);
      },
      take: (k: string) => {
        const v = map.get(k);
        map.delete(k);
        return v;
      },
      delete: (k: string) => {
        map.delete(k);
      }
    }
  };
}

const scopeUserA: AuthenticatedScope = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'owner',
  sessionId: '33333333-3333-4333-8333-333333333333',
  sessionTokenHash: 'a'.repeat(64)
};

const scopeUserB: AuthenticatedScope = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  userId: '44444444-4444-4444-8444-444444444444',
  role: 'member',
  sessionId: '55555555-5555-4555-8555-555555555555',
  sessionTokenHash: 'b'.repeat(64)
};

const scopeViewer: AuthenticatedScope = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  userId: '66666666-6666-4666-8666-666666666666',
  role: 'viewer',
  sessionId: '77777777-7777-4777-8777-777777777777',
  sessionTokenHash: 'c'.repeat(64)
};

describe('Step 107 — Google Calendar Live Account Identity, Date Ranges, Timezone Boundaries & Chat Read', () => {
  it('retrieves primary calendar identity via calendars/primary, distinguishes it from Thaara login, clears on disconnect, and isolates users', async () => {
    const { store } = createMemoryStore();
    const vault = new GoogleCalendarVault(randomBytes(32), store);
    let nowMs = Date.parse('2026-10-24T06:00:00Z');
    let primaryPayload: Record<string, unknown> = {
      id: 'calendar.owner@gmail.com',
      summary: 'Executive Primary Calendar',
      timeZone: 'Asia/Kolkata'
    };

    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://oauth2.googleapis.com/token') {
        const params = new URLSearchParams(String(init?.body ?? ''));
        if (params.get('grant_type') === 'authorization_code') {
          return new Response(
            JSON.stringify({
              access_token: 'ya29.secret_calendar_token_do_not_expose',
              refresh_token: '1//0g_secret_refresh_token',
              scope: GOOGLE_CALENDAR_READONLY,
              expires_in: 3600
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
      }
      if (url === 'https://www.googleapis.com/calendar/v3/calendars/primary') {
        return new Response(JSON.stringify(primaryPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (url === 'https://oauth2.googleapis.com/revoke') {
        return new Response('', { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    const provider = new LiveGoogleCalendarProvider({
      clientId: 'google-live-client-id',
      clientSecret: 'google-live-client-secret',
      fetchFn: mockFetch as unknown as typeof fetch
    });

    const service = new GoogleCalendarFoundation({
      provider,
      vault,
      clientId: 'google-live-client-id',
      redirectUri: 'http://localhost:5173/api/v1/connectors/google-calendar/oauth/callback',
      allowLocalhostRedirect: true,
      now: () => nowMs,
      policyGateway: defaultPolicyGateway,
      audit: async () => {}
    });

    const started = await service.start(scopeUserA);
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    const completed = await service.complete(scopeUserA, { state, code: 'code_123' });

    expect(completed.connected).toBe(true);
    expect(completed.connectedEmail).toBe('calendar.owner@gmail.com');
    expect(completed.connectedCalendarSummary).toBe('Executive Primary Calendar');
    expect(JSON.stringify(completed)).not.toContain('ya29.secret_calendar_token_do_not_expose');
    expect(JSON.stringify(completed)).not.toContain('1//0g_secret_refresh_token');

    // User B in the same workspace remains disconnected and never sees User A's calendar identity
    const userBStatus = await service.status(scopeUserB);
    expect(userBStatus.connected).toBe(false);
    expect(userBStatus.connectedEmail).toBeUndefined();
    expect(userBStatus.connectedCalendarSummary).toBeUndefined();

    // Disconnect User A -> immediately clears connectedEmail and connectedCalendarSummary
    const disconnected = await service.disconnect(scopeUserA);
    expect(disconnected.connected).toBe(false);
    expect(disconnected.connectedEmail).toBeUndefined();
    expect(disconnected.connectedCalendarSummary).toBeUndefined();

    // Fallback when primary calendar id is an opaque group ID instead of an email
    primaryPayload = {
      id: 'opaque_calendar_id_without_email',
      summary: 'Verified Team Schedule'
    };
    const started2 = await service.start(scopeUserA);
    const state2 = new URL(started2.authorizationUrl).searchParams.get('state')!;
    const completed2 = await service.complete(scopeUserA, { state: state2, code: 'code_456' });
    expect(completed2.connected).toBe(true);
    expect(completed2.connectedEmail).toBeUndefined();
    expect(completed2.connectedCalendarSummary).toBe('Verified Team Schedule');
  });

  it('computes exact local date boundaries for Today, Tomorrow, Next 7 Days, and Previous 7 Days in Asia/Kolkata and UTC', () => {
    // 2026-10-24T06:00:00Z is 2026-10-24 11:30:00 IST in Asia/Kolkata
    const nowMs = Date.parse('2026-10-24T06:00:00Z');

    const todayIst = computeCalendarRangeWindowInTimeZone('today', 'Asia/Kolkata', nowMs);
    expect(todayIst).toEqual({
      windowStart: '2026-10-23T18:30:00Z',
      windowEnd: '2026-10-24T18:30:00Z',
      localStartDate: '2026-10-24',
      localEndDate: '2026-10-24'
    });

    const tomorrowIst = computeCalendarRangeWindowInTimeZone('tomorrow', 'Asia/Kolkata', nowMs);
    expect(tomorrowIst).toEqual({
      windowStart: '2026-10-24T18:30:00Z',
      windowEnd: '2026-10-25T18:30:00Z',
      localStartDate: '2026-10-25',
      localEndDate: '2026-10-25'
    });

    const next7Ist = computeCalendarRangeWindowInTimeZone('next_7_days', 'Asia/Kolkata', nowMs);
    expect(next7Ist).toEqual({
      windowStart: '2026-10-23T18:30:00Z',
      windowEnd: '2026-10-30T18:30:00Z',
      localStartDate: '2026-10-24',
      localEndDate: '2026-10-30'
    });

    const prev7Ist = computeCalendarRangeWindowInTimeZone('prev_7_days', 'Asia/Kolkata', nowMs);
    expect(prev7Ist).toEqual({
      windowStart: '2026-10-16T18:30:00Z',
      windowEnd: '2026-10-23T18:30:00Z',
      localStartDate: '2026-10-17',
      localEndDate: '2026-10-23'
    });

    // All-day event date parsing in Asia/Kolkata vs UTC
    expect(parseIsoDateToZonedMidnightIso('2026-10-24', 'Asia/Kolkata')).toBe(
      '2026-10-23T18:30:00Z'
    );
    expect(parseIsoDateToZonedMidnightIso('2026-10-24', 'UTC')).toBe('2026-10-24T00:00:00Z');
    expect(getZonedMidnightMs(2026, 10, 24, 'Asia/Kolkata')).toBe(
      Date.parse('2026-10-23T18:30:00Z')
    );
  });

  it('normalizes all-day and multi-day events in Asia/Kolkata without duplicates or out-of-window exclusions', async () => {
    const { store } = createMemoryStore();
    const vault = new GoogleCalendarVault(randomBytes(32), store);
    const nowMs = Date.parse('2026-10-24T06:00:00Z');

    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://oauth2.googleapis.com/token') {
        const params = new URLSearchParams(String(init?.body ?? ''));
        if (params.get('grant_type') === 'authorization_code') {
          return new Response(
            JSON.stringify({
              access_token: 'ya29.cal_token',
              scope: GOOGLE_CALENDAR_READONLY,
              expires_in: 3600
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
      }
      if (url === 'https://www.googleapis.com/calendar/v3/calendars/primary') {
        return new Response(
          JSON.stringify({ id: 'exec@company.example', summary: 'Exec Calendar' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events')) {
        return new Response(
          JSON.stringify({
            items: [
              // All-day event on 2026-10-24
              {
                id: 'evt_all_day_1',
                status: 'confirmed',
                summary: 'Founder Offsite Day',
                start: { date: '2026-10-24' },
                end: { date: '2026-10-25' }
              },
              // Multi-day event that started yesterday (2026-10-23) and ends tomorrow (2026-10-25)
              {
                id: 'evt_multiday_1',
                status: 'confirmed',
                summary: 'Global Summit (Multi-day)',
                start: { date: '2026-10-23' },
                end: { date: '2026-10-25' }
              },
              // Duplicate item with same ID from upstream (should be deduplicated)
              {
                id: 'evt_all_day_1',
                status: 'confirmed',
                summary: 'Founder Offsite Day',
                start: { date: '2026-10-24' },
                end: { date: '2026-10-25' }
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const provider = new LiveGoogleCalendarProvider({
      clientId: 'google-live-client-id',
      clientSecret: 'google-live-client-secret',
      fetchFn: mockFetch as unknown as typeof fetch
    });

    const service = new GoogleCalendarFoundation({
      provider,
      vault,
      clientId: 'google-live-client-id',
      redirectUri: 'http://localhost:5173/api/v1/connectors/google-calendar/oauth/callback',
      allowLocalhostRedirect: true,
      now: () => nowMs,
      policyGateway: defaultPolicyGateway,
      audit: async () => {}
    });

    const started = await service.start(scopeUserA);
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    await service.complete(scopeUserA, { state, code: 'code_allday' });

    const todayWindow = computeCalendarRangeWindowInTimeZone('today', 'Asia/Kolkata', nowMs);
    const agenda = await service.readAgenda(scopeUserA, {
      windowStart: todayWindow.windowStart,
      windowEnd: todayWindow.windowEnd,
      timeZone: 'Asia/Kolkata'
    });

    expect(agenda.totalEvents).toBe(2);
    expect(agenda.days).toHaveLength(1);
    expect(agenda.days[0]?.localDate).toBe('2026-10-24');
    expect(agenda.days[0]?.events.map((e) => e.id)).toEqual(['evt_multiday_1', 'evt_all_day_1']);
  });

  it('supports natural-language Calendar read and availability queries in Thaara Chat with PolicyGateway and user isolation', async () => {
    const { store } = createMemoryStore();
    const vault = new GoogleCalendarVault(randomBytes(32), store);
    const nowMs = Date.parse('2026-10-24T06:00:00Z');

    // Verify intent detection for all required prompts
    expect(detectCalendarChatRequest('Thaara, what meetings do I have today?')).toEqual({
      kind: 'agenda_read',
      range: 'today',
      partOfDay: 'all_day',
      timeZone: 'Asia/Kolkata'
    });
    expect(detectCalendarChatRequest('Show my meetings tomorrow.')).toEqual({
      kind: 'agenda_read',
      range: 'tomorrow',
      partOfDay: 'all_day',
      timeZone: 'Asia/Kolkata'
    });
    expect(detectCalendarChatRequest('Am I free tomorrow afternoon?')).toEqual({
      kind: 'free_busy_check',
      range: 'tomorrow',
      partOfDay: 'afternoon',
      timeZone: 'Asia/Kolkata'
    });
    expect(detectCalendarChatRequest('Summarize my next 7 days.')).toEqual({
      kind: 'agenda_read',
      range: 'next_7_days',
      partOfDay: 'all_day',
      timeZone: 'Asia/Kolkata'
    });
    // Does not intercept n8n workflow blueprint generation or Gmail commands
    expect(detectCalendarChatRequest('Prepare a calendar briefing workflow for n8n')).toBeNull();
    expect(detectCalendarChatRequest('Read my unread emails')).toBeNull();

    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://oauth2.googleapis.com/token') {
        const params = new URLSearchParams(String(init?.body ?? ''));
        if (params.get('grant_type') === 'authorization_code') {
          return new Response(
            JSON.stringify({
              access_token: 'ya29.chat_cal_token',
              scope: GOOGLE_CALENDAR_READONLY,
              expires_in: 3600
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
      }
      if (url === 'https://www.googleapis.com/calendar/v3/calendars/primary') {
        return new Response(
          JSON.stringify({
            id: 'founder@thaara.example',
            summary: 'Founder Calendar'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events')) {
        const parsed = new URL(url);
        const timeMin = parsed.searchParams.get('timeMin');
        // Tomorrow in Asia/Kolkata starts 2026-10-24T18:30:00Z (2026-10-25 IST)
        if (timeMin === '2026-10-24T18:30:00Z') {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 'tmrw_morning_evt',
                  status: 'confirmed',
                  summary: 'Product Roadmap Sync',
                  location: 'Room 302',
                  // 10:00 AM - 11:00 AM IST on 2026-10-25 -> 04:30Z - 05:30Z
                  start: { dateTime: '2026-10-25T04:30:00Z', timeZone: 'Asia/Kolkata' },
                  end: { dateTime: '2026-10-25T05:30:00Z', timeZone: 'Asia/Kolkata' }
                }
              ]
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        // Today in Asia/Kolkata (2026-10-24 IST)
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'today_evt_1',
                status: 'confirmed',
                summary: 'Customer Architecture Review',
                location: 'Google Meet',
                // 2:00 PM - 3:00 PM IST on 2026-10-24 -> 08:30Z - 09:30Z
                start: { dateTime: '2026-10-24T08:30:00Z', timeZone: 'Asia/Kolkata' },
                end: { dateTime: '2026-10-24T09:30:00Z', timeZone: 'Asia/Kolkata' }
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const provider = new LiveGoogleCalendarProvider({
      clientId: 'google-live-client-id',
      clientSecret: 'google-live-client-secret',
      fetchFn: mockFetch as unknown as typeof fetch
    });

    const googleCalendar = new GoogleCalendarFoundation({
      provider,
      vault,
      clientId: 'google-live-client-id',
      redirectUri: 'http://localhost:5173/api/v1/connectors/google-calendar/oauth/callback',
      allowLocalhostRedirect: true,
      now: () => nowMs,
      policyGateway: defaultPolicyGateway,
      audit: async () => {}
    });

    // Disconnected user gets truthful disconnected message
    const disconnectedRes = await executeChatCalendarRequest(
      scopeUserA,
      detectCalendarChatRequest('Thaara, what meetings do I have today?')!,
      { googleCalendar, policyGateway: defaultPolicyGateway, nowMs }
    );
    expect(disconnectedRes.status).toBe('disconnected');
    expect(disconnectedRes.responseText).toContain('Google Calendar is not connected yet');

    // Connect User A
    const started = await googleCalendar.start(scopeUserA);
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    await googleCalendar.complete(scopeUserA, { state, code: 'code_chat' });

    // 1. "Thaara, what meetings do I have today?"
    const todayRes = await executeChatCalendarRequest(
      scopeUserA,
      detectCalendarChatRequest('Thaara, what meetings do I have today?')!,
      { googleCalendar, policyGateway: defaultPolicyGateway, nowMs }
    );
    expect(todayRes.status).toBe('completed');
    expect(todayRes.responseText).toContain(
      'Connected Calendar: Founder Calendar (founder@thaara.example)'
    );
    expect(todayRes.responseText).toContain('Customer Architecture Review');
    expect(todayRes.responseText).toContain('Google Meet');

    // 2. "Am I free tomorrow afternoon?" (Tomorrow has only a 10:00 AM morning meeting, so afternoon is free)
    const freeRes = await executeChatCalendarRequest(
      scopeUserA,
      detectCalendarChatRequest('Am I free tomorrow afternoon?')!,
      { googleCalendar, policyGateway: defaultPolicyGateway, nowMs }
    );
    expect(freeRes.status).toBe('completed');
    expect(freeRes.responseText).toContain('Yes, you are free tomorrow afternoon');
    expect(freeRes.responseText).toContain('Product Roadmap Sync');

    // 3. User B in the same workspace cannot read User A's calendar
    const userBRes = await executeChatCalendarRequest(
      scopeUserB,
      detectCalendarChatRequest('Thaara, what meetings do I have today?')!,
      { googleCalendar, policyGateway: defaultPolicyGateway, nowMs }
    );
    expect(userBRes.status).toBe('disconnected');
    expect(userBRes.responseText).not.toContain('Customer Architecture Review');

    // 4. Viewer role is denied by PolicyGateway
    const viewerRes = await executeChatCalendarRequest(
      scopeViewer,
      detectCalendarChatRequest('Thaara, what meetings do I have today?')!,
      { googleCalendar, policyGateway: defaultPolicyGateway, nowMs }
    );
    expect(viewerRes.status).toBe('failed');
    expect(viewerRes.responseText).toContain("You don't have permission to read Google Calendar");
  });
});
