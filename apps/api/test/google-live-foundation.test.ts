import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { defaultPolicyGateway } from '@thaara/policy';
import { GMAIL_LIVE_SCOPES, GMAIL_READONLY, GmailFoundation } from '../src/services/gmail.js';
import { GmailVault } from '../src/services/gmail-vault.js';
import {
  GOOGLE_CALENDAR_READONLY,
  GoogleCalendarFoundation,
  GoogleCalendarVault
} from '../src/services/google-calendar.js';
import {
  LiveGmailProvider,
  LiveGoogleCalendarProvider,
  REAL_INTEGRATION_REQUIREMENTS_CHECKLIST,
  createLiveGoogleIntegrationFromEnv
} from '../src/services/google-live.js';

const scopeUserA = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'member' as const,
  sessionTokenHash: 'session-live-user-a'
};

const scopeUserB = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  userId: '33333333-3333-4333-8333-333333333333',
  role: 'member' as const,
  sessionTokenHash: 'session-live-user-b'
};

function createMemoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    store: {
      get: (k: string) => map.get(k),
      set: (k: string, v: string) => {
        map.set(k, v);
      },
      take: (k: string) => {
        const val = map.get(k);
        map.delete(k);
        return val;
      },
      delete: (k: string) => {
        map.delete(k);
      }
    }
  };
}

describe('Step 101 — Real Google OAuth 2.0 & Live Read-Only Integration Foundation', () => {
  it('completes live Gmail OAuth PKCE exchange, parses real MIME messages with UNREAD status, refreshes expired tokens, and revokes on disconnect', async () => {
    const { map, store } = createMemoryStore();
    const vault = new GmailVault(randomBytes(32), store);
    let nowMs = Date.parse('2026-10-22T08:00:00Z');
    const audits: Array<{ action: string; payload: Record<string, unknown> }> = [];

    const plainBodyBase64Url = Buffer.from(
      'Please review the attached Q3 numbers before 4 PM.',
      'utf8'
    ).toString('base64url');

    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://oauth2.googleapis.com/token') {
        const params = new URLSearchParams(String(init?.body ?? ''));
        if (params.get('grant_type') === 'authorization_code') {
          return new Response(
            JSON.stringify({
              access_token: 'ya29.live_access_initial',
              refresh_token: '1//0g_live_refresh_token',
              scope: GMAIL_READONLY,
              expires_in: 3600
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        if (params.get('grant_type') === 'refresh_token') {
          return new Response(
            JSON.stringify({
              access_token: 'ya29.live_access_refreshed',
              scope: GMAIL_READONLY,
              expires_in: 3600
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
      }
      if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) {
        return new Response(
          JSON.stringify({
            messages: [{ id: 'msg_live_101', threadId: 'thr_live_101' }],
            nextPageToken: 'page_2_token'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (
        url.startsWith(
          'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_live_101'
        )
      ) {
        return new Response(
          JSON.stringify({
            id: 'msg_live_101',
            threadId: 'thr_live_101',
            labelIds: ['INBOX', 'UNREAD'],
            snippet: 'Please review the attached Q3 numbers',
            payload: {
              headers: [
                { name: 'Subject', value: 'Q3 Financial Closing' },
                { name: 'From', value: 'Anita Rao <anita@company.example>' },
                { name: 'To', value: 'exec@company.example' },
                { name: 'Date', value: 'Thu, 22 Oct 2026 09:15:00 +0530' }
              ],
              parts: [
                {
                  mimeType: 'text/plain',
                  body: { data: plainBodyBase64Url }
                }
              ]
            }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') {
        return new Response(
          JSON.stringify({
            emailAddress: 'authorized.exec@company.example',
            messagesTotal: 142,
            threadsTotal: 98,
            historyId: '99120'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url === 'https://oauth2.googleapis.com/revoke') {
        return new Response('', { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    const provider = new LiveGmailProvider({
      clientId: 'google-live-client-id',
      clientSecret: 'google-live-client-secret',
      fetchFn: mockFetch as unknown as typeof fetch
    });

    const service = new GmailFoundation({
      provider,
      vault,
      clientId: 'google-live-client-id',
      redirectUri: 'https://thaara.example/api/v1/connectors/gmail/oauth/callback',
      now: () => nowMs,
      policyGateway: defaultPolicyGateway,
      audit: async (_scope, action, payload) => {
        audits.push({ action, payload });
      }
    });

    const startRes = await service.start(scopeUserA);
    expect(startRes.mode).toBe('live');
    const authUrl = new URL(startRes.authorizationUrl);
    const state = authUrl.searchParams.get('state')!;
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('scope')).toBe(GMAIL_LIVE_SCOPES);

    const connectedStatus = await service.complete(scopeUserA, {
      state,
      code: '4/0AeanS_live_auth_code'
    });
    expect(connectedStatus).toMatchObject({
      connectorName: 'gmail',
      status: 'connected',
      configured: true,
      connected: true,
      mode: 'live',
      scopes: [GMAIL_READONLY],
      connectedEmail: 'authorized.exec@company.example'
    });

    // Verify encrypted vault does not leak tokens or plaintext email
    const serializedVault = JSON.stringify([...map.entries()]);
    expect(serializedVault).not.toContain('ya29.live_access_initial');
    expect(serializedVault).not.toContain('1//0g_live_refresh_token');
    expect(serializedVault).not.toContain('authorized.exec@company.example');

    // Cross-user isolation check: User B does not see User A's connection or connectedEmail
    const statusUserB = await service.status(scopeUserB);
    expect(statusUserB.status).toBe('disconnected');
    expect(statusUserB.connectedEmail).toBeUndefined();

    // Search and read live Gmail message
    const searchRes = await service.search(scopeUserA, { query: 'in:inbox', limit: 10 });
    expect(searchRes).toEqual({
      messages: [{ id: 'msg_live_101', threadId: 'thr_live_101' }],
      nextPageToken: 'page_2_token',
      untrusted: true,
      mode: 'live'
    });

    const messageRes = await service.read(scopeUserA, 'msg_live_101');
    expect(messageRes).toEqual({
      id: 'msg_live_101',
      threadId: 'thr_live_101',
      subject: 'Q3 Financial Closing',
      from: 'Anita Rao <anita@company.example>',
      to: 'exec@company.example',
      date: 'Thu, 22 Oct 2026 09:15:00 +0530',
      snippet: 'Please review the attached Q3 numbers',
      bodyText: 'Please review the attached Q3 numbers before 4 PM.',
      isUnread: true,
      untrusted: true,
      mode: 'live'
    });

    // Advance past token expiry -> automatic refresh should occur transparently and preserve connectedEmail
    nowMs += 3700 * 1000;
    const refreshedStatus = await service.status(scopeUserA);
    expect(refreshedStatus.status).toBe('connected');
    expect(refreshedStatus.mode).toBe('live');
    expect(refreshedStatus.connectedEmail).toBe('authorized.exec@company.example');
    expect(audits.some((a) => a.action === 'gmail.oauth.refreshed')).toBe(true);

    // Disconnect wipes local vault, clears connectedEmail, and invokes Google OAuth revoke endpoint
    const disconnected = await service.disconnect(scopeUserA);
    expect(disconnected.status).toBe('disconnected');
    expect(disconnected.connectedEmail).toBeUndefined();
    expect(
      mockFetch.mock.calls.some(([u]) => String(u) === 'https://oauth2.googleapis.com/revoke')
    ).toBe(true);
  });

  it('completes live Google Calendar OAuth, normalizes timed and all-day events, and never falls back to mock data on API failure', async () => {
    const { store } = createMemoryStore();
    const vault = new GoogleCalendarVault(randomBytes(32), store);
    let nowMs = Date.parse('2026-10-22T08:00:00Z');
    let failCalendarApi = false;

    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://oauth2.googleapis.com/token') {
        const params = new URLSearchParams(String(init?.body ?? ''));
        if (params.get('grant_type') === 'authorization_code') {
          return new Response(
            JSON.stringify({
              access_token: 'ya29.cal_live_token',
              refresh_token: '1//0g_cal_refresh',
              scope: GOOGLE_CALENDAR_READONLY,
              expires_in: 3600
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
      }
      if (url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events')) {
        if (failCalendarApi) {
          return new Response('Upstream error', { status: 503 });
        }
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'cal_live_evt_1',
                status: 'confirmed',
                summary: 'Board Strategy Call',
                description: '<p>Discuss FY27 expansion</p>',
                location: 'Google Meet',
                organizer: { email: 'chair@company.example' },
                start: { dateTime: '2026-10-22T10:00:00Z', timeZone: 'Asia/Kolkata' },
                end: { dateTime: '2026-10-22T11:00:00Z', timeZone: 'Asia/Kolkata' },
                attendees: [
                  {
                    email: 'chair@company.example',
                    displayName: 'Board Chair',
                    responseStatus: 'accepted',
                    organizer: true
                  }
                ]
              },
              {
                id: 'cal_live_evt_2',
                status: 'tentative',
                summary: 'Investor Follow-up',
                location: 'Zoom',
                start: { dateTime: '2026-10-22T10:30:00Z', timeZone: 'Asia/Kolkata' },
                end: { dateTime: '2026-10-22T11:15:00Z', timeZone: 'Asia/Kolkata' },
                attendees: []
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
      redirectUri: 'https://thaara.example/api/v1/connectors/google-calendar/oauth/callback',
      now: () => nowMs,
      policyGateway: defaultPolicyGateway,
      audit: async () => {}
    });

    const started = await service.start(scopeUserA);
    expect(started.mode).toBe('live');
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    const completed = await service.complete(scopeUserA, { state, code: 'cal_auth_code' });
    expect(completed.mode).toBe('live');
    expect(completed.status).toBe('connected');

    const agenda = await service.readAgenda(scopeUserA, {
      windowStart: '2026-10-22T00:00:00Z',
      windowEnd: '2026-10-23T00:00:00Z',
      timeZone: 'Asia/Kolkata'
    });
    expect(agenda.mode).toBe('live');
    expect(agenda.totalEvents).toBe(2);
    expect(agenda.conflictEventIds).toEqual(['cal_live_evt_1', 'cal_live_evt_2']);
    expect(agenda.days[0]?.events[0]?.description).toBe('Discuss FY27 expansion');

    // When live Google API fails, it must fail closed with CALENDAR_PROVIDER_ERROR and never return synthetic events
    failCalendarApi = true;
    await expect(
      service.readAgenda(scopeUserA, {
        windowStart: '2026-10-22T00:00:00Z',
        windowEnd: '2026-10-23T00:00:00Z',
        timeZone: 'Asia/Kolkata'
      })
    ).rejects.toMatchObject({
      code: 'CALENDAR_PROVIDER_ERROR',
      statusCode: 502
    });
  });

  it('builds live integration options from env only when credentials exist and exposes the real integration checklist', () => {
    expect(createLiveGoogleIntegrationFromEnv({})).toEqual({});

    const configured = createLiveGoogleIntegrationFromEnv({
      NODE_ENV: 'development',
      CORS_ORIGIN: 'http://localhost:5173',
      GOOGLE_CLIENT_ID: 'client-123',
      GOOGLE_CLIENT_SECRET: 'secret-456',
      GOOGLE_VAULT_KEY: createHash('sha256').update('test-seed').digest('hex')
    });
    expect(configured.gmail?.provider?.mode).toBe('live');
    expect(configured.gmail?.redirectUri).toBe(
      'http://localhost:5173/api/v1/connectors/gmail/oauth/callback'
    );
    expect(configured.googleCalendar?.provider?.mode).toBe('live');
    expect(configured.googleCalendar?.redirectUri).toBe(
      'http://localhost:5173/api/v1/connectors/google-calendar/oauth/callback'
    );
    expect(REAL_INTEGRATION_REQUIREMENTS_CHECKLIST.googleOAuthReadOnly.scopes).toEqual([
      GMAIL_READONLY,
      GOOGLE_CALENDAR_READONLY
    ]);
  });
});
