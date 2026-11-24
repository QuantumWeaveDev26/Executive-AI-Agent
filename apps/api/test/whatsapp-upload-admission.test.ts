import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { PGliteDatabase, Migrator, WorkspaceRepository, UserRepository, MembershipRepository, SessionRepository, generateSessionToken, hashSessionToken, ApprovalRepository, type AuthenticatedScope } from '@thaara/db';
import { WHATSAPP_MEDIA_UPLOAD_ACTION, type WhatsAppUploadIntent } from '@thaara/contracts';
import { defaultPolicyGateway } from '@thaara/policy';
import { createWhatsAppUploadAdmission } from '../src/services/whatsapp-upload-admission.js';
import { approvalRoutes } from '../src/routes/approvals.js';

// Only the already-authorized existing in-memory base fixture migrations. No10825/new SQL or external database.
describe('upload approval and admission on existing in-memory base schema', () => {
  let db: PGliteDatabase, owner: AuthenticatedScope, other: AuthenticatedScope;
  const intent = (): WhatsAppUploadIntent => ({ connectionId: 'wa_upload_test', connectionRevision: 1, senderPhoneNumberId: '123456', filename: 'photo.jpg', mimeType: 'image/jpeg', bytes: 8, sha256: 'a'.repeat(64), idempotencyKey: randomUUID() });
  beforeAll(async () => {
    db = new PGliteDatabase(); const migrator = new Migrator(db); await migrator.migrate(migrator.loadMigrationFiles());
    const workspace = await new WorkspaceRepository(db).create('Synthetic upload security');
    async function identity(name: string): Promise<AuthenticatedScope> {
      const user = await new UserRepository(db).create(name + '@upload.test', 'unused', name), token = generateSessionToken();
      const scope = { workspaceId: workspace.id, userId: user.id, role: 'owner' as const, sessionTokenHash: hashSessionToken(token) };
      await db.withScopedTransaction(scope, async tx => { await new MembershipRepository(tx).create(workspace.id, user.id, 'owner'); await new SessionRepository(tx).create(user.id, workspace.id, token); }); return scope;
    }
    owner = await identity('owner'); other = await identity('other'); await db.exec('SET ROLE thaara_app');
  });
  afterAll(async () => { await db?.close(); });
  async function approval(input: WhatsAppUploadIntent, status: 'approved' | 'pending' = 'approved', action = WHATSAPP_MEDIA_UPLOAD_ACTION as string) {
    return db.withScopedTransaction(owner, async tx => {
      const repo = new ApprovalRepository(tx), a = await repo.create(owner.workspaceId, action, input, owner.userId, 'high', 3600);
      if (status === 'approved') await repo.transitionStatus(owner.workspaceId, a.id, 'pending', 'approved', owner.userId); return a.id;
    });
  }
  it('requires an approved exact personal intent; rejects foreign actor, changed bytes, missing and pending approvals', async () => {
    const guard = createWhatsAppUploadAdmission(db, defaultPolicyGateway), input = intent(), id = await approval(input);
    await expect(guard.begin(other, input, id)).rejects.toThrow(); await expect(guard.begin(owner, { ...input, bytes: 9 }, id)).rejects.toThrow();
    await expect(guard.begin(owner, input, randomUUID())).rejects.toThrow(); await expect(guard.begin(owner, input, await approval(input, 'pending'))).rejects.toThrow();
    expect(await guard.begin(owner, input, id)).toEqual({ fresh: true });
  });
  it('serializes concurrent claims and persists the one-use fence across guard instances', async () => {
    const input = intent(), id = await approval(input), one = createWhatsAppUploadAdmission(db, defaultPolicyGateway), two = createWhatsAppUploadAdmission(db, defaultPolicyGateway);
    const claims = await Promise.allSettled([one.begin(owner, input, id), two.begin(owner, input, id)]);
    expect(claims.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect(claims.filter(x => x.status === 'rejected')).toHaveLength(1);
    await expect(createWhatsAppUploadAdmission(db, defaultPolicyGateway).begin(owner, input, id)).rejects.toMatchObject({ code: 'WHATSAPP_UPLOAD_REPLAY' });
    const result = { media: { kind: 'image' as const, mediaId: '123456', mimeType: input.mimeType, sha256: input.sha256 } };
    await one.complete(owner, input, id, result); expect(await two.begin(owner, input, id)).toEqual({ fresh: false, result });
  });
  it('rolls back admission when its audit fails; a post-transfer audit failure keeps retries fenced', async () => {
    const input = intent(), id = await approval(input), bad = { withScopedTransaction: (scope: AuthenticatedScope, work: any) => db.withScopedTransaction(scope, tx => work({ ...tx, query: (sql: string, params?: any[]) => sql.includes('INSERT INTO audit_events') ? Promise.reject(new Error('synthetic audit failure')) : tx.query(sql, params) })) };
    await expect(createWhatsAppUploadAdmission(bad, defaultPolicyGateway).begin(owner, input, id)).rejects.toThrow();
    const good = createWhatsAppUploadAdmission(db, defaultPolicyGateway); expect(await good.begin(owner, input, id)).toEqual({ fresh: true });
    await expect(createWhatsAppUploadAdmission(bad, defaultPolicyGateway).complete(owner, input, id, { media: { kind: 'image', mediaId: '123456', mimeType: input.mimeType, sha256: input.sha256 } })).rejects.toThrow();
    await expect(good.begin(owner, input, id)).rejects.toMatchObject({ code: 'WHATSAPP_UPLOAD_REPLAY' });
  });
  it('allows only the personal WhatsApp requester decision, retains other high-risk two-person rules', async () => {
    const app = Fastify({ logger: false }), authorizePersonalApproval = vi.fn(async () => undefined);
    app.decorateRequest('scope', undefined); app.decorate('requireAuth', async (req: any) => { req.scope = req.headers.cookie === 'fixture=other' ? other : owner; });
    app.setErrorHandler((error: any, _req, reply) => reply.code(error.statusCode ?? 500).send({ error: { code: error.code ?? 'ERROR', message: error.message } }));
    await app.register(async child => approvalRoutes(child, { db, whatsappDurable: { authorizePersonalApproval } as any }), { prefix: '/api/v1' });
    try {
      const input = intent(), id = await approval(input, 'pending');
      const foreign = await app.inject({ method: 'POST', url: '/api/v1/approvals/' + id + '/decide', headers: { cookie: 'fixture=other' }, payload: { status: 'approved' } }); expect(foreign.statusCode, foreign.body).toBe(403);
      const ok = await app.inject({ method: 'POST', url: '/api/v1/approvals/' + id + '/decide', payload: { status: 'approved' } });
      expect(ok.statusCode).toBe(200); expect(ok.json().status).toBe('approved'); expect(authorizePersonalApproval).toHaveBeenCalledWith(owner, input.connectionId, id);
      const high = await approval(intent(), 'pending', 'other.high.risk');
      expect((await app.inject({ method: 'POST', url: '/api/v1/approvals/' + high + '/decide', payload: { status: 'approved' } })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
  it('rejects expired approval and revoked sessions without claiming an operation', async () => {
    const input = intent(), id = await approval(input);
    await db.withScopedTransaction(owner, tx => tx.query("UPDATE approval_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [id]));
    await expect(createWhatsAppUploadAdmission(db, defaultPolicyGateway).begin(owner, input, id)).rejects.toThrow();
    const valid = await approval(intent());
    await db.withScopedTransaction(owner, tx => tx.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1', [owner.sessionTokenHash]));
    await expect(createWhatsAppUploadAdmission(db, defaultPolicyGateway).begin(owner, input, valid)).rejects.toThrow();
  });
});
