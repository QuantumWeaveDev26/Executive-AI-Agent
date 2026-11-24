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
import { buildApp } from '../src/app.js';
import { generateCsrfToken } from '../src/crypto/csrf.js';
import {
  GOOGLE_CALENDAR_READONLY,
  GoogleCalendarVault,
  SyntheticCalendarEventRecord,
  SyntheticGoogleCalendarProvider
} from '../src/services/google-calendar.js';

describe('Step 87 — Google Calendar authenticated read-only API & RLS isolation', () => {
  let db: PGliteDatabase;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let disabledApp: Awaited<ReturnType<typeof buildApp>>;
  let userA: any;
  let userSameWsB: any;
  let userOtherWs: any;
  let viewer: any;
  let revoked: any;

  const records = new Map<string, string>();
  const csrf = generateCsrfToken();
  const logger = new Logger('error');
  const logSpy = vi.spyOn(logger, 'info');
  const errSpy = vi.spyOn(logger, 'error');

  const eventsForUserA: SyntheticCalendarEventRecord[] = [
    {
      id: 'evt_exec_sync',
      calendarId: 'primary',
      summary: 'Executive Strategy Sync',
      description: 'Confidential roadmap review',
      location: 'Room 401',
      startAt: '2026-10-18T09:00:00Z',
      endAt: '2026-10-18T10:00:00Z',
      timeZone: 'Asia/Kolkata',
      allDay: false,
      status: 'confirmed',
      organizerEmail: 'founder@example.test',
      attendees: [
        { email: 'founder@example.test', displayName: 'Founder', responseStatus: 'accepted', organizer: true }
      ],
      rawHtmlDescription: '<img src=x onerror=alert(1)>',
      conferenceJoinSecret: 'DO-NOT-EXPOSE-SECRET'
    }
  ];

  const baseProvider = new SyntheticGoogleCalendarProvider(
    new Map([['cal_tok_AUTH_CODE_CAL_PRIVATE', eventsForUserA]])
  );
  const provider = {
    mode: 'mock' as const,
    exchange: vi.fn((input) => baseProvider.exchange(input)),
    listEvents: vi.fn((input) => baseProvider.listEvents(input)),
    readEvent: vi.fn((input) => baseProvider.readEvent(input))
  };

  const vault = new GoogleCalendarVault(randomBytes(32), {
    get: (k) => records.get(k),
    set: (k, v) => {
      records.set(k, v);
    },
    take: (k) => {
      const val = records.get(k);
      records.delete(k);
      return val;
    },
    delete: (k) => {
      records.delete(k);
    }
  });

  const calendarOptions = {
    provider,
    vault,
    clientId: 'mock-calendar-client',
    redirectUri: 'https://thaara.example/api/v1/connectors/google-calendar/oauth/callback'
  };

  function headers(identity = userA) {
    return {
      cookie: `thaara_session=${identity.token}; thaara_csrf=${csrf}`,
      'x-csrf-token': csrf
    };
  }

  async function startOAuth(identity = userA) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/google-calendar/oauth/start',
      headers: headers(identity),
      payload: {}
    });
    expect(res.statusCode).toBe(200);
    return new URL(res.json().authorizationUrl).searchParams.get('state')!;
  }

  async function connectCalendar(identity = userA) {
    const state = await startOAuth(identity);
    const res = await app.inject({
      url:
        '/api/v1/connectors/google-calendar/oauth/callback?' +
        new URLSearchParams({ state, code: 'AUTH_CODE_CAL_PRIVATE' }),
      headers: headers(identity)
    });
    expect(res.statusCode).toBe(200);
    return res;
  }

  beforeAll(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());

    async function createIdentity(
      name: string,
      role: 'member' | 'viewer' = 'member',
      existingWorkspaceId?: string
    ) {
      const workspaceId =
        existingWorkspaceId ?? (await new WorkspaceRepository(db).create(name)).id;
      const user = await new UserRepository(db).create(
        `${name}@example.test`,
        'unused-hash',
        name
      );
      const token = generateSessionToken();
      const scope = {
        workspaceId,
        userId: user.id,
        role,
        sessionTokenHash: hashSessionToken(token)
      };
      await db.withScopedTransaction(scope, async (tx) => {
        await new MembershipRepository(tx).create(workspaceId, user.id, role);
        await new SessionRepository(tx).create(user.id, workspaceId, token);
      });
      return { ...scope, token };
    }

    userA = await createIdentity('cal-user-a');
    userSameWsB = await createIdentity('cal-user-b-same-ws', 'member', userA.workspaceId);
    userOtherWs = await createIdentity('cal-user-other-ws');
    viewer = await createIdentity('cal-viewer', 'viewer', userA.workspaceId);
    revoked = await createIdentity('cal-revoked');
    await db.query('UPDATE sessions SET revoked_at=NOW() WHERE token_hash=$1', [
      revoked.sessionTokenHash
    ]);
    await db.exec('SET ROLE thaara_app;');

    app = await buildApp({
      db,
      config: loadConfig({ NODE_ENV: 'test' }),
      googleCalendar: calendarOptions,
      logger
    });
    await app.ready();

    disabledApp = await buildApp({
      db,
      config: loadConfig({ NODE_ENV: 'test' }),
      logger
    });
    await disabledApp.ready();
  });

  beforeEach(() => {
    records.clear();
    logSpy.mockClear();
    errSpy.mockClear();
    provider.exchange.mockReset().mockImplementation((input) => baseProvider.exchange(input));
    provider.listEvents.mockReset().mockImplementation((input) => baseProvider.listEvents(input));
    provider.readEvent.mockReset().mockImplementation((input) => baseProvider.readEvent(input));
  });

  afterAll(async () => {
    await app?.close();
    await disabledApp?.close();
    await db?.close();
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('requires authentication on all routes and rejects revoked sessions', async () => {
    for (const path of [
      '/status',
      '/events/evt_exec_sync',
      '/oauth/callback?state=' + 's'.repeat(43) + '&code=secret'
    ]) {
      expect(
        (await app.inject({ url: `/api/v1/connectors/google-calendar${path}` })).statusCode
      ).toBe(401);
    }
    expect(
      (
        await app.inject({
          url: '/api/v1/connectors/google-calendar/status',
          headers: headers(revoked)
        })
      ).statusCode
    ).toBe(401);
  });

  it('requires CSRF token on POST and DELETE calendar routes', async () => {
    const cookieOnly = { cookie: headers().cookie };
    for (const [method, path, payload] of [
      ['POST', '/oauth/start', {}],
      [
        'POST',
        '/events/list',
        { windowStart: '2026-10-18T00:00:00Z', windowEnd: '2026-10-19T00:00:00Z' }
      ],
      [
        'POST',
        '/agenda',
        {
          windowStart: '2026-10-18T00:00:00Z',
          windowEnd: '2026-10-19T00:00:00Z',
          timeZone: 'UTC'
        }
      ],
      ['DELETE', '/connection', undefined]
    ] as const) {
      const res = await app.inject({
        method,
        url: `/api/v1/connectors/google-calendar${path}`,
        headers: cookieOnly,
        payload
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('CSRF_INVALID');
    }
    expect(provider.exchange).not.toHaveBeenCalled();
  });

  it('stays not_configured by default without injected mock infrastructure and blocks non-test injection', async () => {
    const statusRes = await disabledApp.inject({
      url: '/api/v1/connectors/google-calendar/status',
      headers: headers()
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json()).toMatchObject({
      connectorName: 'google_calendar',
      status: 'not_configured',
      mode: 'disabled',
      connected: false
    });
    expect(
      (
        await disabledApp.inject({
          method: 'POST',
          url: '/api/v1/connectors/google-calendar/oauth/start',
          headers: headers(),
          payload: {}
        })
      ).statusCode
    ).toBe(503);

    await expect(
      buildApp({
        db,
        config: { ...loadConfig({ NODE_ENV: 'test' }), NODE_ENV: 'development' },
        googleCalendar: calendarOptions
      })
    ).rejects.toThrow(/Google Calendar mock infrastructure is test-only/i);
  });

  it('completes OAuth, serves events and agenda with n8nContext, and isolates same-workspace and cross-workspace users', async () => {
    const connected = await connectCalendar(userA);
    expect(connected.json()).toMatchObject({
      connectorName: 'google_calendar',
      status: 'connected',
      connected: true,
      mode: 'mock',
      scopes: [GOOGLE_CALENDAR_READONLY]
    });
    expect(connected.headers['cache-control']).toBe('no-store');
    expect(connected.headers['referrer-policy']).toBe('no-referrer');
    expect(connected.body).not.toMatch(/cal_tok_|cal_ref_|AUTH_CODE_CAL_PRIVATE/);

    const listRes = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/google-calendar/events/list',
      headers: headers(userA),
      payload: {
        windowStart: '2026-10-18T00:00:00Z',
        windowEnd: '2026-10-19T00:00:00Z',
        timeZone: 'Asia/Kolkata'
      }
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toMatchObject({
      events: [{ id: 'evt_exec_sync', summary: 'Executive Strategy Sync', untrusted: true, mode: 'mock' }],
      timeZone: 'Asia/Kolkata',
      untrusted: true,
      mode: 'mock'
    });
    expect(listRes.body).not.toContain('DO-NOT-EXPOSE-SECRET');
    expect(listRes.body).not.toContain('<img');

    const eventRes = await app.inject({
      url: '/api/v1/connectors/google-calendar/events/evt_exec_sync',
      headers: headers(userA)
    });
    expect(eventRes.statusCode).toBe(200);
    expect(eventRes.json()).toMatchObject({
      id: 'evt_exec_sync',
      untrusted: true,
      mode: 'mock'
    });

    const agendaRes = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors/google-calendar/agenda',
      headers: headers(userA),
      payload: {
        windowStart: '2026-10-18T00:00:00Z',
        windowEnd: '2026-10-19T00:00:00Z',
        timeZone: 'Asia/Kolkata'
      }
    });
    expect(agendaRes.statusCode).toBe(200);
    expect(agendaRes.json()).toMatchObject({
      totalEvents: 1,
      days: [{ localDate: '2026-10-18', events: [{ id: 'evt_exec_sync' }] }],
      n8nContext: {
        connector: 'google_calendar',
        operation: 'read_agenda_snapshot',
        readOnly: true,
        timeZone: 'Asia/Kolkata',
        eventIds: ['evt_exec_sync']
      },
      untrusted: true,
      mode: 'mock'
    });

    // Same-workspace User B and other-workspace user cannot read User A's connected calendar
    expect(
      (
        await app.inject({
          url: '/api/v1/connectors/google-calendar/events/evt_exec_sync',
          headers: headers(userSameWsB)
        })
      ).statusCode
    ).toBe(409);
    expect(
      (
        await app.inject({
          url: '/api/v1/connectors/google-calendar/events/evt_exec_sync',
          headers: { ...headers(userOtherWs), 'x-workspace-id': userA.workspaceId }
        })
      ).statusCode
    ).toBe(409);

    // Viewer can read status but cannot start OAuth or read events/agenda
    expect(
      (
        await app.inject({
          url: '/api/v1/connectors/google-calendar/status',
          headers: headers(viewer)
        })
      ).statusCode
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/connectors/google-calendar/agenda',
          headers: headers(viewer),
          payload: {
            windowStart: '2026-10-18T00:00:00Z',
            windowEnd: '2026-10-19T00:00:00Z',
            timeZone: 'UTC'
          }
        })
      ).statusCode
    ).toBe(403);
  });

  it('validates inputs, revalidates permissions after provider work, and writes secret-free RLS audits with no mutation endpoints', async () => {
    await connectCalendar(userA);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/connectors/google-calendar/events/list',
          headers: headers(userA),
          payload: {
            windowStart: '2026-10-18T00:00:00Z',
            windowEnd: '2026-10-19T00:00:00Z',
            limit: 51
          }
        })
      ).statusCode
    ).toBe(400);

    expect(
      (
        await app.inject({
          url: '/api/v1/connectors/google-calendar/events/' + encodeURIComponent('../bad'),
          headers: headers(userA)
        })
      ).statusCode
    ).toBe(400);

    provider.readEvent.mockImplementationOnce(async () => {
      await db.exec('RESET ROLE;');
      await db.query(
        "UPDATE memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
        [userA.workspaceId, userA.userId]
      );
      await db.exec('SET ROLE thaara_app;');
      return {
        ...eventsForUserA[0],
        summary: 'WITHHELD-AFTER-ROLE-DOWNGRADE'
      };
    });

    const downgradedRes = await app.inject({
      url: '/api/v1/connectors/google-calendar/events/evt_exec_sync',
      headers: headers(userA)
    });
    expect(downgradedRes.statusCode).toBe(403);
    expect(downgradedRes.body).not.toContain('WITHHELD-AFTER-ROLE-DOWNGRADE');

    await db.exec('RESET ROLE;');
    await db.query(
      "UPDATE memberships SET role='member' WHERE workspace_id=$1 AND user_id=$2",
      [userA.workspaceId, userA.userId]
    );
    await db.exec('SET ROLE thaara_app;');

    const audits = await db.withScopedTransaction(userA, (tx) =>
      tx.query(
        "SELECT workspace_id,actor_user_id,action,payload FROM audit_events WHERE action LIKE 'calendar.%'"
      )
    );
    expect(audits.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits.rows)).not.toMatch(
      /cal_tok_|cal_ref_|AUTH_CODE_CAL_PRIVATE|DO-NOT-EXPOSE-SECRET/
    );

    const otherWsAudits = await db.withScopedTransaction(userOtherWs, (tx) =>
      tx.query('SELECT * FROM audit_events WHERE workspace_id=$1', [userA.workspaceId])
    );
    expect(otherWsAudits.rows).toEqual([]);

    // No direct unapproved create, update, or delete event endpoints exist
    for (const [method, path] of [
      ['PUT', '/events/evt_exec_sync'],
      ['POST', '/events'],
      ['DELETE', '/events/evt_exec_sync']
    ] as const) {
      expect(
        (
          await app.inject({
            method,
            url: `/api/v1/connectors/google-calendar${path}`,
            headers: headers(userA),
            payload: {}
          })
        ).statusCode
      ).toBe(404);
    }
  });
});
