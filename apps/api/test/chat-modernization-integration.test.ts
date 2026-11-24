import { describe, it, expect, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import {
  PGliteDatabase,
  Migrator,
  WorkspaceRepository,
  UserRepository,
  MembershipRepository,
  SessionRepository,
  ConversationRepository,
  generateSessionToken,
  hashSessionToken
} from '@thaara/db';
import { loadConfig } from '@thaara/config';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE_NAME, CSRF_COOKIE_NAME } from '../src/plugins/auth.js';
import { generateCsrfToken } from '../src/crypto/csrf.js';

describe('Thaara Chat Modernization Integration Tests', () => {
  let app: FastifyInstance;
  let db: PGliteDatabase;

  let workspaceAId: string;
  let workspaceBId: string;
  let userAId: string;
  let sessionTokenA: string;
  let sessionTokenB: string;
  let csrfTokenA: string;
  let csrfTokenB: string;
  let convAId: string;

  beforeEach(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());

    const wsRepo = new WorkspaceRepository(db);
    const userRepo = new UserRepository(db);

    // Tenant A
    const wsA = await wsRepo.create('Tenant A Corp');
    workspaceAId = wsA.id;
    const userA = await userRepo.create('alice@tenanta.com', 'hashA', 'Alice Executive');
    userAId = userA.id;
    sessionTokenA = generateSessionToken();
    const scopeA = {
      workspaceId: wsA.id,
      userId: userA.id,
      role: 'owner' as const,
      sessionTokenHash: hashSessionToken(sessionTokenA)
    };
    await db.withScopedTransaction(scopeA, async (tx) => {
      const mRepo = new MembershipRepository(tx);
      const sRepo = new SessionRepository(tx);
      const cRepo = new ConversationRepository(tx);
      await mRepo.create(wsA.id, userA.id, 'owner');
      await sRepo.create(userA.id, wsA.id, sessionTokenA);
      const c = await cRepo.create(scopeA, { title: 'Executive Chat Turn' });
      convAId = c.id;
    });

    // Tenant B
    const wsB = await wsRepo.create('Tenant B Corp');
    workspaceBId = wsB.id;
    const userB = await userRepo.create('bob@tenantb.com', 'hashB', 'Bob Executive');
    sessionTokenB = generateSessionToken();
    const scopeB = {
      workspaceId: wsB.id,
      userId: userB.id,
      role: 'owner' as const,
      sessionTokenHash: hashSessionToken(sessionTokenB)
    };
    await db.withScopedTransaction(scopeB, async (tx) => {
      const mRepo = new MembershipRepository(tx);
      const sRepo = new SessionRepository(tx);
      await mRepo.create(wsB.id, userB.id, 'owner');
      await sRepo.create(userB.id, wsB.id, sessionTokenB);
    });

    csrfTokenA = generateCsrfToken();
    csrfTokenB = generateCsrfToken();

    const config = loadConfig();
    app = await buildApp({
      config: {
        ...config,
        auth: {
          ...config.auth,
          cookieSecret: 'test-secret-at-least-32-chars-long-for-security'
        }
      },
      db
    });
  });

  it('uploads valid text and csv attachments with magic byte validation', async () => {
    const csvContent = 'Item,Quantity,Price\nWidget,10,25.00\nGadget,5,50.00';
    const csvBase64 = Buffer.from(csvContent, 'utf8').toString('base64');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convAId}/attachments`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
        'x-csrf-token': csrfTokenA,
        'content-type': 'application/json'
      },
      payload: {
        filename: 'inventory.csv',
        mimeType: 'text/csv',
        contentBase64: csvBase64
      }
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBeDefined();
    expect(body.filename).toBe('inventory.csv');
    expect(body.mimeType).toBe('text/csv');
    expect(body.extractedTextLength).toBeGreaterThan(10);
  });

  it('rejects attachments with mismatched magic bytes (e.g. fake PDF)', async () => {
    // Content is plain ASCII text pretending to be PDF
    const fakePdfBase64 = Buffer.from('This is not a real PDF file header', 'utf8').toString('base64');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convAId}/attachments`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
        'x-csrf-token': csrfTokenA,
        'content-type': 'application/json'
      },
      payload: {
        filename: 'fake.pdf',
        mimeType: 'application/pdf',
        contentBase64: fakePdfBase64
      }
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(['ATTACHMENT_VALIDATION_FAILED', 'ATTACHMENT_UNSUPPORTED']).toContain(body.error.code);
  });

  it('enforces tenant workspace isolation on attachments', async () => {
    // Upload under Tenant A
    const textBase64 = Buffer.from('Confidential Tenant A Financials', 'utf8').toString('base64');
    const uploadRes = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convAId}/attachments`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
        'x-csrf-token': csrfTokenA,
        'content-type': 'application/json'
      },
      payload: {
        filename: 'financials.txt',
        mimeType: 'text/plain',
        contentBase64: textBase64
      }
    });
    expect(uploadRes.statusCode).toBe(201);
    const attId = JSON.parse(uploadRes.body).id;

    // Tenant B attempts to fetch Tenant A's attachment
    const leakRes = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${convAId}/attachments/${attId}`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenB}; ${CSRF_COOKIE_NAME}=${csrfTokenB}`,
        'x-csrf-token': csrfTokenB
      }
    });
    expect(leakRes.statusCode).toBe(403);
  });

  it('returns zero-LLM token deterministic redirection for out-of-scope queries in chat stream', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convAId}/stream`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
        'x-csrf-token': csrfTokenA,
        'content-type': 'application/json',
        accept: 'text/event-stream'
      },
      payload: {
        content: 'Tell me a joke about dogs',
        idempotency_key: 'stream-joke-01'
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(body).toContain('event: token');
    expect(body).toContain('business');
    expect(body).toContain('event: done');
  });

  it('returns verified company knowledge with Linktree for service inquiries', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convAId}/stream`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
        'x-csrf-token': csrfTokenA,
        'content-type': 'application/json',
        accept: 'text/event-stream'
      },
      payload: {
        content: 'What services do you provide?',
        idempotency_key: 'stream-services-01'
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(body).toContain('event: token');
    expect(body).toContain('https://linktr.ee/team.quantumweaveai');
    expect(body).toContain('WhatsApp Automation');
    expect(body).toContain('AI Agents & Assistants');
    expect(body).toContain('event: done');
  });

  it('answers tech terms with executive business framing deterministically', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convAId}/stream`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
        'x-csrf-token': csrfTokenA,
        'content-type': 'application/json',
        accept: 'text/event-stream'
      },
      payload: {
        content: 'Explain Python',
        idempotency_key: 'stream-tech-01'
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(body).toContain('event: token');
    expect(body).toContain('automation');
    expect(body).toContain('business');
    expect(body).toContain('event: done');
  });
});
