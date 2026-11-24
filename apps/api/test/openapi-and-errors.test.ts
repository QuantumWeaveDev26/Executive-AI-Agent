import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { PGliteDatabase, Migrator, WorkspaceRepository, UserRepository, MembershipRepository, SessionRepository, generateSessionToken, hashSessionToken } from '@thaara/db';
import { loadConfig } from '@thaara/config';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE_NAME } from '../src/plugins/auth.js';

describe('OpenAPI, Validation Errors, and Truthful Adapters', () => {
  let app: FastifyInstance;
  let db: PGliteDatabase;
  let sessionToken: string;

  beforeEach(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());

    const wsRepo = new WorkspaceRepository(db);
    const userRepo = new UserRepository(db);
    const memberRepo = new MembershipRepository(db);
    const sessionRepo = new SessionRepository(db);

    const ws = await wsRepo.create('Workspace Primary');
    const user = await userRepo.create('dev@thaara.ai', 'hash', 'Dev');
    sessionToken = generateSessionToken();
    const scope = {
      workspaceId: ws.id,
      userId: user.id,
      role: 'owner' as const,
      sessionTokenHash: hashSessionToken(sessionToken)
    };
    await db.withScopedTransaction(scope, async (tx) => {
      const mRepo = new MembershipRepository(tx);
      const sRepo = new SessionRepository(tx);
      await mRepo.create(ws.id, user.id, 'owner');
      await sRepo.create(user.id, ws.id, sessionToken);
    });

    const config = loadConfig({ NODE_ENV: 'test' });
    app = await buildApp({ db, config });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves OpenAPI schema matching shared TypeBox contracts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/docs/json'
    });

    expect(res.statusCode).toBe(200);
    const spec = JSON.parse(res.body);
    expect(spec.openapi).toBeDefined();
    expect(spec.paths['/api/v1/health']).toBeDefined();
    expect(spec.paths['/api/v1/bootstrap']).toBeDefined();
    expect(spec.paths['/api/v1/auth/login']).toBeDefined();
    expect(spec.paths['/api/v1/policy/evaluate']).toBeDefined();
    expect(spec.paths['/api/v1/conversations']).toBeDefined();
    expect(spec.paths['/api/v1/conversations/{id}/stream']).toBeDefined();
    expect(spec.paths['/api/v1/memories']).toBeDefined();
    expect(spec.paths['/api/v1/privacy/purge']).toBeDefined();
    expect(spec.paths['/api/v1/admin/inspect']).toBeDefined();
  });

  it('returns stable sanitized validation error responses on invalid payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bootstrap',
      payload: {
        // Missing required fields
        email: 'not-an-email'
      }
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toBeDefined();
    // No stack trace in response
    expect((body as any).stack).toBeUndefined();
  });

  it('truthfully returns not_configured for unconfigured test connector adapter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/connectors/status',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.connectorName).toBe('test_unconfigured_service');
    expect(body.status).toBe('not_configured');
    expect(body.connected).toBe(false);
    expect(body.configured).toBe(false);
  });
});
