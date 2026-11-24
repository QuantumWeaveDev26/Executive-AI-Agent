import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApprovalRepository, MembershipRepository, Migrator, PGliteDatabase, SessionRepository, UserRepository, WorkspaceRepository, generateSessionToken, hashSessionToken } from '@thaara/db';
import { loadConfig } from '@thaara/config';
import { Logger } from '@thaara/observability';
import { buildApp } from '../src/app.js';
import { generateCsrfToken } from '../src/crypto/csrf.js';

// Decide-route behaviour for personal WhatsApp approvals on the real app over in-memory PostgreSQL.
// The base schema has no durable WhatsApp tables, so any approval re-validation fails closed: that proves
// approving always needs the durable authority while rejecting never does.
describe('personal WhatsApp approval decisions', () => {
  let db: PGliteDatabase, app: Awaited<ReturnType<typeof buildApp>>;
  type Identity = { userId: string; workspaceId: string; token: string };
  let owner: Identity, member: Identity;
  const csrf = generateCsrfToken();
  const headers = (identity: Identity) => ({ cookie: `thaara_session=${identity.token}; thaara_csrf=${csrf}`, 'x-csrf-token': csrf });
  const decide = (id: string, status: 'approved' | 'rejected', identity = owner) => app.inject({ method: 'POST', url: `/api/v1/approvals/${id}/decide`, headers: headers(identity), payload: { status } });
  const draft = { connectionId: 'wa_decide_test', connectionRevision: 1, senderPhoneNumberId: '100020003000', recipientId: 'ram', bodyText: 'Hello', idempotencyKey: 'decide-test-0001' };
  async function pending(actionName = 'whatsapp.meta.messages.send', params: Record<string, unknown> = draft, requester = owner) {
    return (await new ApprovalRepository(db).create(requester.workspaceId, actionName, params, requester.userId, 'high')).id;
  }

  beforeAll(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());
    const make = async (email: string, role: 'owner' | 'member', wsId?: string): Promise<Identity> => {
      const workspaceId = wsId ?? (await new WorkspaceRepository(db).create(`ws-${email}`)).id;
      const user = await new UserRepository(db).create(email, 'hash', email);
      const token = generateSessionToken(), scope = { workspaceId, userId: user.id, role, sessionTokenHash: hashSessionToken(token) };
      await db.withScopedTransaction(scope, async tx => { await new MembershipRepository(tx).create(workspaceId, user.id, role); await new SessionRepository(tx).create(user.id, workspaceId, token); });
      return { userId: user.id, workspaceId, token };
    };
    owner = await make('owner-decide@a.test', 'owner');
    member = await make('member-decide@a.test', 'member', owner.workspaceId);
    app = await buildApp({ db, logger: new Logger('error'), config: loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's'.repeat(32), CORS_ORIGIN: 'http://localhost:5173' }) });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); });

  it('lets the requester reject (cancel) a WhatsApp send even when the durable authority cannot be re-validated', async () => {
    const id = await pending();
    const res = await decide(id, 'rejected');
    expect(res.statusCode).toBe(200); expect(res.json().status).toBe('rejected');
  });
  it('lets the requester reject an upload authorization the same way', async () => {
    const id = await pending('whatsapp.meta.media.upload', { ...draft, bodyText: undefined, fileSha256: 'a'.repeat(64) });
    expect((await decide(id, 'rejected')).json().status).toBe('rejected');
  });
  it('never approves without the durable send authority (fails closed), and leaves the request pending', async () => {
    const id = await pending();
    const res = await decide(id, 'approved');
    expect(res.statusCode).not.toBe(200);
    expect((await new ApprovalRepository(db).findById(owner.workspaceId, id))?.status).toBe('pending');
  });
  it('refuses decisions by anyone other than the requester, for approve and reject alike', async () => {
    const id = await pending();
    for (const status of ['approved', 'rejected'] as const) expect((await decide(id, status, member)).statusCode).toBe(403);
    expect((await new ApprovalRepository(db).findById(owner.workspaceId, id))?.status).toBe('pending');
  });
});
