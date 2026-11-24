import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MembershipRepository,
  Migrator,
  PGliteDatabase,
  SessionRepository,
  UserRepository,
  WorkspaceRepository,
  generateSessionToken,
  hashSessionToken
} from '@thaara/db';
import { loadConfig } from '@thaara/config';
import { Logger } from '@thaara/observability';
import { ApprovalRequest } from '@thaara/contracts';
import { defaultPolicyGateway } from '@thaara/policy';
import { buildApp } from '../src/app.js';
import { generateCsrfToken } from '../src/crypto/csrf.js';
import {
  GOOGLE_CALENDAR_EVENTS_OWNED,
  GOOGLE_CALENDAR_LIVE_SCOPES,
  GOOGLE_CALENDAR_READONLY,
  GoogleCalendarFoundation,
  GoogleCalendarVault
} from '../src/services/google-calendar.js';
import { LiveGoogleCalendarProvider } from '../src/services/google-live.js';
import { waitForChatPlanBackgroundExecution } from '../src/services/chat-automation-orchestrator.js';
import { detectCalendarChatRequest } from '../src/services/chat-calendar-assistant.js';

describe('Step 107.5 — Real Google Calendar Scheduling, Rescheduling & Cancellation with Approval', () => {
  let db: PGliteDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;

  type Identity = {
    userId: string;
    workspaceId: string;
    token: string;
    scope: {
      workspaceId: string;
      userId: string;
      role: 'owner' | 'member' | 'viewer';
      sessionId: string;
      sessionTokenHash: string;
    };
  };

  let owner: Identity;
  let member: Identity;
  let viewer: Identity;
  let otherWorkspaceOwner: Identity;

  const vaultRecords = new Map<string, string>();
  const csrf = generateCsrfToken();
  let primaryEmail = 'calendar.owner@gmail.com';
  let writeMode: 'ok' | 'uncertain503' | 'rejected400' = 'ok';

  interface StoredGoogleEvent {
    id: string;
    summary: string;
    description?: string;
    location?: string;
    status: 'confirmed' | 'tentative' | 'cancelled';
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
    organizer: { email: string; self: boolean };
    attendees?: Array<{ email: string; responseStatus?: string }>;
    reminders?: {
      useDefault?: boolean;
      overrides?: Array<{ method?: string; minutes?: number }>;
    };
    extendedProperties?: {
      private?: Record<string, string>;
    };
  }

  let googleEvents: StoredGoogleEvent[] = [];
  const createRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const patchRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const deleteRequests: Array<{ url: string }> = [];

  function resetDefaultEvents() {
    // Base reference time: 2026-10-24 (Saturday) in Asia/Kolkata (+05:30)
    // 3:00 PM IST on 2026-10-24 = 2026-10-24T09:30:00Z
    // 4:00 PM IST on 2026-10-24 = 2026-10-24T10:30:00Z
    googleEvents = [
      {
        id: 'evt_3pm_board_sync',
        summary: 'Board Sync',
        location: 'Google Meet',
        status: 'confirmed',
        start: { dateTime: '2026-10-24T09:30:00Z', timeZone: 'Asia/Kolkata' },
        end: { dateTime: '2026-10-24T10:00:00Z', timeZone: 'Asia/Kolkata' },
        organizer: { email: primaryEmail, self: true },
        attendees: [{ email: 'director@partner.example', responseStatus: 'accepted' }]
      },
      {
        id: 'evt_4pm_design_review',
        summary: 'Design Review',
        location: 'Room B',
        status: 'confirmed',
        start: { dateTime: '2026-10-24T10:30:00Z', timeZone: 'Asia/Kolkata' },
        end: { dateTime: '2026-10-24T11:00:00Z', timeZone: 'Asia/Kolkata' },
        organizer: { email: primaryEmail, self: true },
        attendees: []
      }
    ];
  }

  const liveFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
      });

    if (url === 'https://oauth2.googleapis.com/token') {
      const params = new URLSearchParams(String(init?.body ?? ''));
      const readonlyOnly = params.get('code') === 'code_readonly';
      return json({
        access_token: readonlyOnly ? 'ya29.cal_readonly_token' : 'ya29.cal_full_write_token',
        refresh_token: '1//0g_cal_refresh_secret',
        scope: readonlyOnly ? GOOGLE_CALENDAR_READONLY : GOOGLE_CALENDAR_LIVE_SCOPES,
        expires_in: 3600
      });
    }

    if (url === 'https://oauth2.googleapis.com/revoke') {
      return new Response('', { status: 200 });
    }

    if (url === 'https://www.googleapis.com/calendar/v3/calendars/primary') {
      return json({
        id: primaryEmail,
        summary: 'Executive Primary Calendar',
        timeZone: 'Asia/Kolkata'
      });
    }

    // List events: GET /calendars/primary/events?...
    if (
      method === 'GET' &&
      url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events?')
    ) {
      const parsed = new URL(url);
      const timeMinMs = Date.parse(parsed.searchParams.get('timeMin') ?? '');
      const timeMaxMs = Date.parse(parsed.searchParams.get('timeMax') ?? '');
      const showDeleted = parsed.searchParams.get('showDeleted') === 'true';
      const items = googleEvents.filter((ev) => {
        if (!showDeleted && ev.status === 'cancelled') return false;
        const startMs = Date.parse(ev.start.dateTime);
        const endMs = Date.parse(ev.end.dateTime);
        return endMs > timeMinMs && startMs < timeMaxMs;
      });
      return json({ items });
    }

    // Create event: POST /calendars/primary/events?...
    if (
      method === 'POST' &&
      url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events')
    ) {
      if (writeMode === 'uncertain503') {
        return new Response('upstream gateway timeout', { status: 503 });
      }
      if (writeMode === 'rejected400') {
        return json({ error: { code: 400, message: 'Invalid calendar payload' } }, 400);
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      createRequests.push({ url, body });
      const newEvent: StoredGoogleEvent = {
        id: `evt_created_${createRequests.length}`,
        summary: String(body.summary ?? 'Meeting'),
        ...(typeof body.description === 'string' ? { description: body.description } : {}),
        ...(typeof body.location === 'string' ? { location: body.location } : {}),
        status: 'confirmed',
        start: body.start as { dateTime: string; timeZone: string },
        end: body.end as { dateTime: string; timeZone: string },
        organizer: { email: primaryEmail, self: true },
        attendees: Array.isArray(body.attendees)
          ? (body.attendees as Array<{ email: string }>)
          : [],
        ...(body.reminders && typeof body.reminders === 'object'
          ? { reminders: body.reminders as StoredGoogleEvent['reminders'] }
          : {}),
        ...(body.extendedProperties && typeof body.extendedProperties === 'object'
          ? { extendedProperties: body.extendedProperties as StoredGoogleEvent['extendedProperties'] }
          : {})
      };
      googleEvents.push(newEvent);
      return json(newEvent);
    }

    // Single event GET / PATCH / DELETE: /calendars/primary/events/:eventId
    const eventMatch = url.match(
      /^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/primary\/events\/([^?]+)/
    );
    if (eventMatch) {
      const eventId = decodeURIComponent(eventMatch[1]!);
      const found = googleEvents.find((e) => e.id === eventId);

      if (method === 'GET') {
        if (!found) return json({ error: { code: 404, message: 'Not found' } }, 404);
        return json(found);
      }

      if (method === 'PATCH') {
        if (writeMode === 'uncertain503') {
          return new Response('upstream gateway timeout', { status: 503 });
        }
        if (writeMode === 'rejected400') {
          return json({ error: { code: 400, message: 'Invalid update' } }, 400);
        }
        if (!found) return json({ error: { code: 404, message: 'Not found' } }, 404);
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        patchRequests.push({ url, body });
        if (body.start) found.start = body.start as { dateTime: string; timeZone: string };
        if (body.end) found.end = body.end as { dateTime: string; timeZone: string };
        if (typeof body.summary === 'string') found.summary = body.summary;
        if (body.reminders && typeof body.reminders === 'object') {
          found.reminders = body.reminders as StoredGoogleEvent['reminders'];
        }
        return json(found);
      }

      if (method === 'DELETE') {
        if (writeMode === 'uncertain503') {
          return new Response('upstream gateway timeout', { status: 503 });
        }
        if (writeMode === 'rejected400') {
          return json({ error: { code: 400, message: 'Cannot delete' } }, 400);
        }
        if (!found) return json({ error: { code: 404, message: 'Not found' } }, 404);
        deleteRequests.push({ url });
        found.status = 'cancelled';
        return new Response(null, { status: 204 });
      }
    }

    return new Response('Not found', { status: 404 });
  });

  const provider = new LiveGoogleCalendarProvider({
    clientId: 'cal-client-id',
    clientSecret: 'cal-client-secret',
    fetchFn: liveFetch as unknown as typeof fetch
  });

  const vault = new GoogleCalendarVault(randomBytes(32), {
    get: (k) => vaultRecords.get(k),
    set: (k, v) => {
      vaultRecords.set(k, v);
    },
    take: (k) => {
      const v = vaultRecords.get(k);
      vaultRecords.delete(k);
      return v;
    },
    delete: (k) => {
      vaultRecords.delete(k);
    }
  });

  const foundation = new GoogleCalendarFoundation({
    provider,
    vault,
    clientId: 'cal-client-id',
    redirectUri: 'http://localhost:5173/api/v1/connectors/google-calendar/oauth/callback',
    allowLocalhostRedirect: true,
    allowWriteScope: true,
    policyGateway: defaultPolicyGateway,
    audit: async () => {}
  });

  const headers = (identity: { token: string } = owner) => ({
    cookie: `thaara_session=${identity.token}; thaara_csrf=${csrf}`,
    'x-csrf-token': csrf
  });

  async function connectCalendar(identity: Identity = owner, code = 'code_full') {
    const start = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/google-calendar/oauth/start',
      headers: headers(identity),
      payload: {}
    });
    expect(start.statusCode).toBe(200);
    const authUrl = new URL(start.json().authorizationUrl);
    expect(authUrl.searchParams.get('scope')).toContain(GOOGLE_CALENDAR_READONLY);
    expect(authUrl.searchParams.get('scope')).toContain(GOOGLE_CALENDAR_EVENTS_OWNED);
    const state = authUrl.searchParams.get('state')!;
    const cb = await app.inject({
      method: 'GET',
      url: `/api/v1/connectors/google-calendar/oauth/callback?state=${encodeURIComponent(state)}&code=${code}`,
      headers: headers(identity)
    });
    expect(cb.statusCode).toBe(200);
    return cb.json();
  }

  async function decide(
    approvalId: string,
    status: 'approved' | 'rejected',
    identity: Identity = owner
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/decide`,
      headers: headers(identity),
      payload: { status }
    });
  }

  async function getPlan(planId: string, identity: Identity = owner) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/plans/${planId}`,
      headers: headers(identity)
    });
    return { statusCode: res.statusCode, body: res.json() };
  }

  async function createConversation(identity: Identity, title: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: headers(identity),
      payload: { title }
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  let turn = 0;
  async function sendChat(identity: Identity, conversationId: string, content: string) {
    const stream = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/stream`,
      headers: headers(identity),
      payload: { content, idempotency_key: `step1075-turn-${++turn}` }
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.body).toContain('event: done');
    const msgs = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: headers(identity)
    });
    const list = msgs.json() as Array<{
      sender_type: string;
      content: string;
      metadata: Record<string, unknown>;
    }>;
    const last = [...list].reverse().find((m) => m.sender_type === 'assistant')!;
    return { text: last.content, metadata: last.metadata ?? {}, rawStream: stream.body };
  }

  beforeAll(async () => {
    // Match the dated event fixtures: 10 AM on 24 October in Asia/Kolkata.
    // Fake Date only so database, streaming and background-worker timers stay real.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T04:30:00Z'));
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());

    const makeIdentity = async (
      email: string,
      role: 'owner' | 'member' | 'viewer',
      wsId?: string
    ): Promise<Identity> => {
      const workspaceId = wsId ?? (await new WorkspaceRepository(db).create(`ws-${email}`)).id;
      const user = await new UserRepository(db).create(email, 'hash', email);
      const token = generateSessionToken();
      let sessionId = '';
      const tempScope = {
        workspaceId,
        userId: user.id,
        role,
        sessionTokenHash: hashSessionToken(token)
      };
      await db.withScopedTransaction(tempScope, async (tx) => {
        await new MembershipRepository(tx).create(workspaceId, user.id, role);
        const sess = await new SessionRepository(tx).create(user.id, workspaceId, token);
        sessionId = sess.id;
      });
      return {
        userId: user.id,
        workspaceId,
        token,
        scope: { ...tempScope, sessionId }
      };
    };

    owner = await makeIdentity('owner-1075@a.test', 'owner');
    member = await makeIdentity('member-1075@a.test', 'member', owner.workspaceId);
    viewer = await makeIdentity('viewer-1075@a.test', 'viewer', owner.workspaceId);
    otherWorkspaceOwner = await makeIdentity('owner-1075@b.test', 'owner');

    app = await buildApp({
      db,
      logger: new Logger('error'),
      config: loadConfig({
        NODE_ENV: 'test',
        SESSION_SECRET: 's'.repeat(32),
        CORS_ORIGIN: 'http://localhost:5173'
      }),
      googleCalendar: {
        provider,
        vault,
        clientId: 'cal-client-id',
        redirectUri: 'http://localhost:5173/api/v1/connectors/google-calendar/oauth/callback',
        allowLocalhostRedirect: true
      }
    });
    await app.ready();
  });

  beforeEach(() => {
    vi.setSystemTime(new Date('2026-10-24T04:30:00Z'));
    vaultRecords.clear();
    liveFetch.mockClear();
    createRequests.length = 0;
    patchRequests.length = 0;
    deleteRequests.length = 0;
    writeMode = 'ok';
    primaryEmail = 'calendar.owner@gmail.com';
    resetDefaultEvents();
  });

  afterAll(async () => {
    try {
      if (app) await app.close();
      if (db) await db.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('requires calendar.events.owned write permission and never bypasses a read-only connection', async () => {
    const status = await connectCalendar(owner, 'code_readonly');
    expect(status.connected).toBe(true);
    expect(status.scopes).toEqual([GOOGLE_CALENDAR_READONLY]);

    // Reading agenda still works with calendar.readonly
    const agenda = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/google-calendar/agenda',
      headers: headers(owner),
      payload: {
        windowStart: '2026-10-23T18:30:00Z',
        windowEnd: '2026-10-24T18:30:00Z',
        timeZone: 'Asia/Kolkata'
      }
    });
    expect(agenda.statusCode).toBe(200);

    // Preparing a new meeting fails closed with CALENDAR_WRITE_SCOPE_REQUIRED
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/google-calendar/events/create',
      headers: headers(owner),
      payload: {
        summary: 'Unauthorized Write Attempt',
        startAt: '2026-10-24T12:00:00Z',
        endAt: '2026-10-24T12:30:00Z',
        timeZone: 'Asia/Kolkata'
      }
    });
    expect(createRes.statusCode).toBe(403);
    expect(createRes.json().error.code).toBe('CALENDAR_WRITE_SCOPE_REQUIRED');
    expect(createRequests).toHaveLength(0);

    // Chat scheduling also asks the user to reconnect and grant permission
    const convId = await createConversation(owner, 'Readonly Calendar Chat');
    const reply = await sendChat(
      owner,
      convId,
      'Thaara, schedule a meeting tomorrow at 3 PM for 30 minutes.'
    );
    expect(reply.text).toContain('reconnect Google Calendar');
    expect(reply.metadata.plan_id).toBeUndefined();
    expect(createRequests).toHaveLength(0);
  });

  it('prepares a new meeting with conflict detection, requires explicit approval, and records a verified event_created receipt', async () => {
    const status = await connectCalendar(owner, 'code_full');
    expect(status.scopes).toContain(GOOGLE_CALENDAR_EVENTS_OWNED);

    // Prepare a meeting overlapping the 3:00 PM IST Board Sync (2026-10-24T09:30:00Z - 10:00:00Z)
    const prep = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/google-calendar/events/create',
      headers: headers(owner),
      payload: {
        summary: 'Investor Call',
        location: 'Zoom',
        startAt: '2026-10-24T09:30:00Z',
        endAt: '2026-10-24T10:00:00Z',
        timeZone: 'Asia/Kolkata',
        attendees: ['Investor <investor@fund.example>'],
        sendUpdates: 'all'
      }
    });
    expect(prep.statusCode).toBe(200);
    const body = prep.json();
    expect(body).toMatchObject({
      status: 'awaiting_approval',
      operation: 'create',
      connectedCalendar: 'calendar.owner@gmail.com',
      summary: 'Investor Call',
      startAt: '2026-10-24T09:30:00Z',
      endAt: '2026-10-24T10:00:00Z',
      timeZone: 'Asia/Kolkata',
      attendees: ['investor@fund.example'],
      sendUpdates: 'all'
    });
    // Conflict with Board Sync is reported in preview
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].summary).toBe('Board Sync');

    // No event created before explicit approval
    expect(createRequests).toHaveLength(0);

    // Other user in same workspace cannot approve owner's personal calendar mutation
    const crossUserApprove = await decide(body.approvalId, 'approved', member);
    expect(crossUserApprove.statusCode).toBe(403);
    expect(createRequests).toHaveLength(0);

    // Viewer cannot approve
    const viewerApprove = await decide(body.approvalId, 'approved', viewer);
    expect(viewerApprove.statusCode).toBe(403);

    // Requester approves -> executes once and records verified receipt
    const approved = await decide(body.approvalId, 'approved', owner);
    expect(approved.statusCode).toBe(200);
    await waitForChatPlanBackgroundExecution(body.planId);

    expect(createRequests).toHaveLength(1);
    expect(createRequests[0]!.url).toContain('sendUpdates=all');
    expect(createRequests[0]!.body).toMatchObject({
      summary: 'Investor Call',
      location: 'Zoom',
      start: { dateTime: '2026-10-24T09:30:00Z', timeZone: 'Asia/Kolkata' },
      end: { dateTime: '2026-10-24T10:00:00Z', timeZone: 'Asia/Kolkata' },
      attendees: [{ email: 'investor@fund.example' }]
    });

    const plan = await getPlan(body.planId);
    expect(plan.body.steps[0].action_name).toBe('calendar.events.create');
    expect(plan.body.steps[0].status).toBe('verified');
    expect(plan.body.receipts[0].status).toBe('verified');
    expect(plan.body.receipts[0].proof).toMatchObject({
      status: 'event_created',
      operation: 'create',
      providerEventId: 'evt_created_1',
      summary: 'Investor Call',
      connectedCalendar: 'calendar.owner@gmail.com'
    });
  });

  it('supports natural-language meeting creation and missing-time follow-up in Thaara Chat', async () => {
    await connectCalendar(owner, 'code_full');
    const convId = await createConversation(owner, 'Chat Create Meeting');

    // 1. User asks to schedule a meeting without specifying a start time
    const turn1 = await sendChat(owner, convId, 'Thaara, schedule a meeting titled Quarterly Review');
    expect(turn1.text).toContain('What time should I schedule "Quarterly Review"');
    expect(turn1.metadata.plan_id).toBeUndefined();

    // 2. User provides the time in the follow-up message
    const turn2 = await sendChat(owner, convId, 'Tomorrow at 3 PM for 45 minutes');
    expect(turn2.text).toContain('Your meeting is ready. Shall I schedule it?');
    expect(turn2.text).toContain('Quarterly Review');
    expect(typeof turn2.metadata.plan_id).toBe('string');
    expect(typeof turn2.metadata.approval_id).toBe('string');
    expect(createRequests).toHaveLength(0);

    // 3. Approve the chat-prepared meeting
    const approved = await decide(String(turn2.metadata.approval_id), 'approved', owner);
    expect(approved.statusCode).toBe(200);
    await waitForChatPlanBackgroundExecution(String(turn2.metadata.plan_id));
    expect(createRequests).toHaveLength(1);
    expect(createRequests[0]!.body.summary).toBe('Quarterly Review');
  });

  it('reschedules a real meeting with approval and blocks stale updates when the event changed since preview', async () => {
    await connectCalendar(owner, 'code_full');

    // Prepare rescheduling Board Sync from 3:00 PM IST to 5:00 PM IST (2026-10-24T11:30:00Z - 12:00:00Z)
    const prep = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/google-calendar/events/reschedule',
      headers: headers(owner),
      payload: {
        eventId: 'evt_3pm_board_sync',
        newStartAt: '2026-10-24T11:30:00Z',
        newEndAt: '2026-10-24T12:00:00Z',
        timeZone: 'Asia/Kolkata',
        sendUpdates: 'all'
      }
    });
    expect(prep.statusCode).toBe(200);
    const body = prep.json();
    expect(body).toMatchObject({
      status: 'awaiting_approval',
      operation: 'reschedule',
      eventId: 'evt_3pm_board_sync',
      summary: 'Board Sync',
      previousStartAt: '2026-10-24T09:30:00Z',
      previousEndAt: '2026-10-24T10:00:00Z',
      startAt: '2026-10-24T11:30:00Z',
      endAt: '2026-10-24T12:00:00Z'
    });
    expect(patchRequests).toHaveLength(0);

    // Approve -> updates Google Calendar event and records event_rescheduled receipt
    const approved = await decide(body.approvalId, 'approved', owner);
    expect(approved.statusCode).toBe(200);
    await waitForChatPlanBackgroundExecution(body.planId);

    expect(patchRequests).toHaveLength(1);
    const plan = await getPlan(body.planId);
    expect(plan.body.steps[0].status).toBe('verified');
    expect(plan.body.receipts[0].proof).toMatchObject({
      status: 'event_rescheduled',
      operation: 'reschedule',
      providerEventId: 'evt_3pm_board_sync'
    });

    // Now test stale-event protection: prepare another reschedule, then mutate the event in Google before approval
    const prepStale = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/google-calendar/events/reschedule',
      headers: headers(owner),
      payload: {
        eventId: 'evt_4pm_design_review',
        newStartAt: '2026-10-24T13:00:00Z',
        newEndAt: '2026-10-24T13:30:00Z',
        timeZone: 'Asia/Kolkata'
      }
    });
    expect(prepStale.statusCode).toBe(200);
    const staleBody = prepStale.json();

    // Simulate external change in Google Calendar after preview was prepared
    googleEvents.find((e) => e.id === 'evt_4pm_design_review')!.start.dateTime =
      '2026-10-24T10:45:00Z';

    const approveStale = await decide(staleBody.approvalId, 'approved', owner);
    expect(approveStale.statusCode).toBe(200);
    await waitForChatPlanBackgroundExecution(staleBody.planId);

    // PATCH must NOT have been called a second time
    expect(patchRequests).toHaveLength(1);
    const stalePlan = await getPlan(staleBody.planId);
    expect(stalePlan.body.steps[0].status).toBe('failed');
    expect(stalePlan.body.receipts[0].proof.code).toBe('CALENDAR_EVENT_CHANGED_SINCE_PREVIEW');
  });

  it('handles ambiguous events in Chat without automatic mutation and allows selecting #1 or #2', async () => {
    await connectCalendar(owner, 'code_full');
    const convId = await createConversation(owner, 'Ambiguous Cancel Chat');

    // Both Board Sync (3 PM) and Design Review (4 PM) are in the next 7 days.
    // Asking to cancel "my meeting" without specifying which one must list both and ask.
    const turn1 = await sendChat(owner, convId, 'Thaara, cancel my meeting');
    expect(turn1.text).toContain('Multiple meetings match your cancellation request:');
    expect(turn1.text).toContain('1. Board Sync');
    expect(turn1.text).toContain('2. Design Review');
    expect(turn1.metadata.plan_id).toBeUndefined();
    expect(deleteRequests).toHaveLength(0);

    // User replies "#2" to select Design Review
    const turn2 = await sendChat(owner, convId, '#2');
    expect(turn2.text).toContain('Please confirm and approve below to cancel this meeting.');
    expect(turn2.text).toContain('Design Review');
    expect(typeof turn2.metadata.plan_id).toBe('string');
    expect(typeof turn2.metadata.approval_id).toBe('string');
    expect(deleteRequests).toHaveLength(0);

    // Approve cancellation
    const approved = await decide(String(turn2.metadata.approval_id), 'approved', owner);
    expect(approved.statusCode).toBe(200);
    await waitForChatPlanBackgroundExecution(String(turn2.metadata.plan_id));

    expect(deleteRequests).toHaveLength(1);
    expect(deleteRequests[0]!.url).toContain('evt_4pm_design_review');
    const plan = await getPlan(String(turn2.metadata.plan_id));
    expect(plan.body.steps[0].status).toBe('verified');
    expect(plan.body.receipts[0].proof).toMatchObject({
      status: 'event_cancelled',
      operation: 'cancel',
      providerEventId: 'evt_4pm_design_review'
    });
  });

  it('enforces replay lock and records unverified on uncertain 503 provider failure without retrying', async () => {
    await connectCalendar(owner, 'code_full');

    // 1. Uncertain 503 failure -> unverified receipt, zero retries
    writeMode = 'uncertain503';
    const prep503 = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/google-calendar/events/create',
      headers: headers(owner),
      payload: {
        summary: 'Uncertain Sync',
        startAt: '2026-10-24T14:00:00Z',
        endAt: '2026-10-24T14:30:00Z',
        timeZone: 'Asia/Kolkata'
      }
    });
    expect(prep503.statusCode).toBe(200);
    const body503 = prep503.json();

    await decide(body503.approvalId, 'approved', owner);
    await waitForChatPlanBackgroundExecution(body503.planId);

    const plan503 = await getPlan(body503.planId);
    expect(plan503.body.steps[0].status).toBe('unverified');
    expect(plan503.body.receipts[0].status).toBe('unverified');
    expect(plan503.body.receipts[0].proof.code).toBe('CALENDAR_MUTATION_UNVERIFIED');

    // 2. Direct replay against foundation with the same approvalId is blocked by the per-approval lock
    writeMode = 'ok';
    const approvalRes = await app.inject({
      method: 'GET',
      url: '/api/v1/approvals',
      headers: headers(owner)
    });
    const approvals = approvalRes.json() as ApprovalRequest[];
    const usedApproval = approvals.find((a) => a.id === body503.approvalId)!;

    await expect(
      foundation.createEvent(
        owner.scope,
        usedApproval.actionParams as never,
        usedApproval,
        `replay:${usedApproval.id}`
      )
    ).rejects.toMatchObject({
      code: 'CALENDAR_MUTATION_ALREADY_PROCESSED'
    });
  });

  it('Step 107.6 Task 1 & Task 2: supports exact command "thaara today at 6pm i have meeting wit ram save it and remind me" with 30m default, 15m popup reminder, no email required, no Gmail access, and real Google Calendar reminder persistence', async () => {
    await connectCalendar(owner, 'code_full');
    const convId = await createConversation(owner, 'Exact Ram Meeting Command');

    const reply = await sendChat(
      owner,
      convId,
      'thaara today at 6pm i have meeting wit ram save it and remind me'
    );

    expect(reply.text).toContain('Your meeting with Ram is ready. Please check and approve.');
    expect(reply.text).toContain('Title: Meeting with Ram');
    expect(reply.text).toContain('6:00 PM – 6:30 PM');
    expect(reply.text).toContain('Duration: 30 minutes (default, editable)');
    expect(reply.text).toContain('Reminder: 15 minutes before (popup)');
    expect(reply.text).toContain(
      'Google Calendar notification delivery depends on your Google Calendar and device settings.'
    );
    expect(typeof reply.metadata.plan_id).toBe('string');
    expect(typeof reply.metadata.approval_id).toBe('string');

    // No event created before explicit approval and zero Gmail URLs ever touched
    expect(createRequests).toHaveLength(0);
    const gmailCalls = liveFetch.mock.calls.filter(([u]) => String(u).includes('gmail.googleapis.com'));
    expect(gmailCalls).toHaveLength(0);

    // Multi-turn edit before approval: user says "remind me 10 minutes before"
    const edited = await sendChat(owner, convId, 'remind me 10 minutes before');
    expect(edited.text).toContain('Your meeting with Ram is ready. Please check and approve.');
    expect(edited.text).toContain('Reminder: 10 minutes before (popup)');
    expect(typeof edited.metadata.approval_id).toBe('string');
    expect(edited.metadata.approval_id).not.toBe(reply.metadata.approval_id);

    // Approve the updated meeting proposal
    const approved = await decide(String(edited.metadata.approval_id), 'approved', owner);
    expect(approved.statusCode).toBe(200);
    await waitForChatPlanBackgroundExecution(String(edited.metadata.plan_id));

    expect(createRequests).toHaveLength(1);
    expect(createRequests[0]!.body).toMatchObject({
      summary: 'Meeting with Ram',
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 10 }]
      },
      extendedProperties: {
        private: {
          thaaraOrigin: 'thaara_chat'
        }
      }
    });

    const plan = await getPlan(String(edited.metadata.plan_id));
    expect(plan.body.steps[0].status).toBe('verified');
    expect(plan.body.receipts[0].status).toBe('verified');
    expect(plan.body.receipts[0].proof).toMatchObject({
      status: 'event_created',
      operation: 'create',
      summary: 'Meeting with Ram',
      origin: 'thaara_chat',
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 10 }]
      }
    });
    expect(String(plan.body.receipts[0].proof.note)).toContain(
      'Google Calendar and device notification settings'
    );
  });

  it('Step 107.6 Task 3: supports natural chat commands, bare clock hours, Kanglish meeting commands, and asks for email only when explicitly asked to invite', async () => {
    await connectCalendar(owner, 'code_full');
    const convId = await createConversation(owner, 'Natural & Kanglish Chat Scheduling');

    // 1. "Thaara, add a meeting with Ram today at 6." -> 6:00 PM
    const addAt6 = await sendChat(owner, convId, 'Thaara, add a meeting with Ram today at 6.');
    expect(addAt6.text).toContain('Your meeting with Ram is ready. Please check and approve.');
    expect(addAt6.text).toContain('6:00 PM – 6:30 PM');

    // 2. "Tomorrow 10 AM meeting with Rahul, remind me 10 minutes before."
    const rahul10am = await sendChat(
      owner,
      convId,
      'Tomorrow 10 AM meeting with Rahul, remind me 10 minutes before.'
    );
    expect(rahul10am.text).toContain('Your meeting with Rahul is ready. Please check and approve.');
    expect(rahul10am.text).toContain('10:00 AM – 10:30 AM');
    expect(rahul10am.text).toContain('Reminder: 10 minutes before (popup)');

    // 3. "Save a meeting at 4 PM today."
    const save4pm = await sendChat(owner, convId, 'Save a meeting at 4 PM today.');
    expect(save4pm.text).toContain('Your meeting is ready. Shall I schedule it?');
    expect(save4pm.text).toContain('4:00 PM – 4:30 PM');

    // 4. Kanglish: "Ivattu 6 PM Ram jothe meeting ide save madi"
    const kanglish = await sendChat(
      owner,
      convId,
      'Ivattu 6 PM Ram jothe meeting ide save madi'
    );
    expect(kanglish.text).toContain('Your meeting with Ram is ready. Please check and approve.');
    expect(kanglish.text).toContain('6:00 PM – 6:30 PM');

    // 5. Explicit invite without email -> asks for email address instead of guessing
    const explicitInvite = await sendChat(
      owner,
      convId,
      'Thaara, schedule a meeting with Ram today at 6 PM and invite him'
    );
    expect(explicitInvite.text).toContain('Please share');
    expect(explicitInvite.text).toContain('email address');
    expect(explicitInvite.metadata.plan_id).toBeUndefined();

    // 6. "Show my meetings today."
    const showToday = await sendChat(owner, convId, 'Show my meetings today.');
    expect(showToday.text).toContain('Board Sync');
    expect(showToday.text).toContain('Design Review');
  });

  it('Step 107.6 Task 5 & Additional Requirement: tracks owner-saved meetings via encrypted vault & extendedProperties (never inferring from description/attendees) and never automatically imports Gmail meetings', async () => {
    await connectCalendar(owner, 'code_full');

    // Add an external calendar event whose description and attendee list pretend to be Thaara-created
    googleEvents.push({
      id: 'evt_external_spoof',
      summary: 'Auto-Added Webinar from Email',
      description: 'Created by Thaara Chat thaaraOrigin:thaara_chat',
      status: 'confirmed',
      start: { dateTime: '2026-10-24T11:30:00Z', timeZone: 'Asia/Kolkata' },
      end: { dateTime: '2026-10-24T12:00:00Z', timeZone: 'Asia/Kolkata' },
      organizer: { email: 'marketing@external.example', self: false },
      attendees: [{ email: primaryEmail, responseStatus: 'accepted' }]
    });

    // Create a genuine owner-saved meeting via Calendar UI endpoint
    const prepUi = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/google-calendar/events/create',
      headers: headers(owner),
      payload: {
        summary: 'Owner Saved Strategy Sync',
        startAt: '2026-10-24T12:30:00Z',
        endAt: '2026-10-24T13:00:00Z',
        timeZone: 'Asia/Kolkata',
        reminders: {
          useDefault: false,
          overrides: [{ method: 'popup', minutes: 30 }]
        },
        origin: 'thaara_ui'
      }
    });
    expect(prepUi.statusCode).toBe(200);
    const prepBody = prepUi.json();
    expect(prepBody.origin).toBe('thaara_ui');
    expect(prepBody.reminders).toEqual({
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 30 }]
    });

    await decide(prepBody.approvalId, 'approved', owner);
    await waitForChatPlanBackgroundExecution(prepBody.planId);

    // Fetch agenda: verify genuine owner-saved event has ownerSaved=true & thaaraOrigin='thaara_ui',
    // while external events (including the spoofed description one) have ownerSaved=false & thaaraOrigin='external_calendar'
    const agendaRes = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/google-calendar/agenda',
      headers: headers(owner),
      payload: {
        windowStart: '2026-10-23T18:30:00Z',
        windowEnd: '2026-10-24T18:30:00Z',
        timeZone: 'Asia/Kolkata'
      }
    });
    expect(agendaRes.statusCode).toBe(200);
    const agendaEvents = agendaRes.json().days.flatMap((d: { events: Array<Record<string, unknown>> }) => d.events);

    const ownerEvent = agendaEvents.find((e: Record<string, unknown>) => e.summary === 'Owner Saved Strategy Sync');
    expect(ownerEvent).toBeDefined();
    expect(ownerEvent.ownerSaved).toBe(true);
    expect(ownerEvent.thaaraOrigin).toBe('thaara_ui');
    expect(ownerEvent.reminders).toEqual({
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 30 }]
    });

    const spoofEvent = agendaEvents.find((e: Record<string, unknown>) => e.id === 'evt_external_spoof');
    expect(spoofEvent).toBeDefined();
    expect(spoofEvent.ownerSaved).toBe(false);
    expect(spoofEvent.thaaraOrigin).toBe('external_calendar');

    // Verify Chat agenda distinguishes owner-saved meetings ([Saved in Thaara]) from external Google Calendar events
    const convId = await createConversation(owner, 'Owner vs External Agenda');
    const chatAgenda = await sendChat(owner, convId, 'Show my meetings today.');
    expect(chatAgenda.text).toContain('Owner Saved Strategy Sync: 6:00 PM – 6:30 PM [Saved in Thaara]');
    expect(chatAgenda.text).toContain('Auto-Added Webinar from Email: 5:00 PM – 5:30 PM');
    expect(chatAgenda.text).not.toContain('Auto-Added Webinar from Email: 5:00 PM – 5:30 PM [Saved in Thaara]');

    // Zero Gmail API requests were made during any calendar read or write
    const gmailCalls = liveFetch.mock.calls.filter(([u]) => String(u).includes('gmail.googleapis.com'));
    expect(gmailCalls).toHaveLength(0);

    // Explicit owner command to check a specific email is detected as create_event_from_gmail_explicit
    const explicitGmailIntent = detectCalendarChatRequest(
      "Thaara, check Ram's email and add that meeting to my calendar."
    );
    expect(explicitGmailIntent?.kind).toBe('create_event_from_gmail_explicit');
    expect(explicitGmailIntent?.explicitGmailDraft?.emailQuery).toBe('Ram');
  });
});
