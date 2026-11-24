import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Migrator, PGliteDatabase, WorkspaceRepository, UserRepository, MembershipRepository, SessionRepository,
  generateSessionToken, hashSessionToken, ApprovalRepository, type AuthenticatedScope } from '@thaara/db';
import { createCallbackCapture, createCallbackNotificationDispatcher, projectCallbackRequest } from '../src/services/phone-callback-notification.js';
import { PhoneCallbackNotificationRepository } from '../src/services/phone-callback-notification-store.js';
import { createPhoneCallbackMailTransport, PHONE_CALLBACK_RECIPIENT, PHONE_CALLBACK_SENDER } from '../src/services/phone-callback-mail.js';
import { createPhoneCallbackQueue } from '../src/services/phone-callback-queue.js';
import { readCallbackReports } from '../src/services/phone-callback-reports.js';
import { vi } from 'vitest';
import { createPhoneCallbackRuntime } from '../src/services/phone-callback-runtime.js';

describe.skipIf(process.env.THAARA_PHONE115_SQL_TEST_APPROVED !== 'in-memory-only')('Step 115 reviewed callback storage', () => {
  let db: PGliteDatabase;
  let owner: AuthenticatedScope;
  let foreign: AuthenticatedScope;
  let store: PhoneCallbackNotificationRepository;
  const root = fileURLToPath(new URL('../../../', import.meta.url));

  beforeAll(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles(root + 'packages/db/src/migrations'));
    async function identity(label: string): Promise<AuthenticatedScope> {
      const workspace = await new WorkspaceRepository(db).create(label);
      const user = await new UserRepository(db).create(label + '@example.test', 'unused', label);
      const token = generateSessionToken();
      const scope = { workspaceId: workspace.id, userId: user.id, role: 'owner' as const, sessionTokenHash: hashSessionToken(token) };
      await db.withScopedTransaction(scope, async tx => {
        await new MembershipRepository(tx).create(workspace.id, user.id, 'owner');
        await new SessionRepository(tx).create(user.id, workspace.id, token);
      });
      return scope;
    }
    owner = await identity('callback-owner');
    foreign = await identity('callback-foreign');
    await db.query("SELECT set_config('thaara.step115_review_approved','in-memory-only',false),set_config('thaara.step115_target_database',current_database(),false)");
    await db.exec(readFileSync(root + 'docs/migrations/115-phone-callback-notification.review.sql', 'utf8'));
    await db.exec(readFileSync(root + 'docs/migrations/115g-phone-callback-grants.review.sql', 'utf8'));
    await db.exec('SET ROLE thaara_app');
    store = new PhoneCallbackNotificationRepository(db, owner);
  }, 60_000);

  afterAll(async () => { if (db) await db.close(); });

  function sample(callId: string) {
    return projectCallbackRequest({ workspaceId: owner.workspaceId, userId: owner.userId, callId, direction: 'inbound',
      verifiedNumber: '+919000000001', occurredAt: '2026-11-09T00:00:00Z',
      turns: [{ speaker: 'agent', text: 'Synthetic Caller, Synthetic Business, Automation. May I save a callback request?' }, { speaker: 'caller', text: 'Yes' }],
    }, { requested: true, name: 'Synthetic Caller', business: 'Synthetic Business', service: 'Automation' })!;
  }

  it('persists a confirmed callback and isolates the record from a different workspace', async () => {
    const request = sample('isolation');
    await store.save(request);
    const reopened = new PhoneCallbackNotificationRepository(db, owner);
    expect(await reopened.read(owner, request.id)).toMatchObject({ id: request.id, phoneNumber: request.phoneNumber });
    expect(await new PhoneCallbackNotificationRepository(db, foreign).read(foreign, request.id)).toBeNull();
    const result = await db.withScopedTransaction(foreign, tx => tx.query('SELECT request_id FROM public.phone_callback_requests'));
    expect(result.rows).toHaveLength(0);
  });

  it('deduplicates identical provider replay and rejects changed details', async () => {
    const request = sample('replay');
    const first = await store.save(request);
    expect(await store.save(request)).toEqual(first);
    await expect(store.save({ ...request, name: 'Changed' })).rejects.toThrow('differs');
  });

  it('commits the claimed attempt and preserves its terminal outcome', async () => {
    const request = sample('claim');
    await store.save(request);
    const attempt = randomUUID();
    expect(await store.claim(owner, request.id, attempt)).toBe(1);
    expect(await store.claim(owner, request.id, randomUUID())).toBeNull();
    await expect(store.finish(owner, request.id, randomUUID(), 'submitted')).rejects.toThrow('no longer matches');
    await store.finish(owner, request.id, attempt, 'unverified');
    expect(await store.read(owner, request.id)).toMatchObject({ notificationStatus: 'unverified', attempts: 1, status: 'requested' });
  });

  it.each(['inbound', 'outbound'] as const)('connects admitted %s capture, durable queue, Resend mock and owner report', async direction => {
    for (const id of await store.pending(owner)) {
      const attempt = randomUUID();
      await store.claim(owner, id, attempt);
      await store.finish(owner, id, attempt, 'failed');
    }
    const request = sample('integrated-' + direction);
    const capture = createCallbackCapture({ repository: store, admit: async (token: string) => token === 'fixture-admitted' ? {
      ...owner, callId: request.callId, direction, occurredAt: request.occurredAt, verifiedNumber: request.phoneNumber,
      turns: [{ speaker: 'agent' as const, text: 'Synthetic Caller, Synthetic Business, Automation. Should I share your callback request with our team?' },
        { speaker: 'caller' as const, text: 'Yes' }],
    } : null });
    const details = { requested: true, name: request.name, business: request.business, service: request.service };
    const receipt = await capture('fixture-admitted', details);
    expect(receipt.saved).toBe(true);
    expect(await capture('fixture-admitted', details)).toEqual(receipt);
    await expect(capture('rejected', details)).rejects.toThrow();
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'synthetic-provider-' + direction }));
    let ready = false;
    const transport = createPhoneCallbackMailTransport({ sender: PHONE_CALLBACK_SENDER, sendingEnabled: true,
      apiKey: async () => { if (!ready) throw Error('Fixture domain pending'); return 'synthetic-only'; }, fetch: send });
    const notify = createCallbackNotificationDispatcher({ repository: store, transport, currentOwnerGrant: async () => ({
      ...owner, enabled: true, approvedByUserId: owner.userId, recipient: PHONE_CALLBACK_RECIPIENT,
      sender: PHONE_CALLBACK_SENDER, expiresAt: '2099-01-01T00:00:00Z',
    }) });
    const drain = createPhoneCallbackQueue({ repository: store, notify });
    await drain(owner);
    expect(send).not.toHaveBeenCalled();
    ready = true;
    await drain(owner);
    await drain(owner);
    const id = receipt.saved ? receipt.requestId : '';
    const report = (await readCallbackReports(owner, scope => store.list(scope))).reports.find(row => row.requestId === id);
    expect(report).toMatchObject({ direction, callbackConfirmed: true, notificationStatus: 'submitted', phoneNumber: request.phoneNumber });
    expect(report?.notificationMeaning).toContain('inbox delivery unconfirmed');
    expect(send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(send.mock.calls[0]![1]!.body as string);
    expect(payload).toMatchObject({ from: PHONE_CALLBACK_SENDER, to: [PHONE_CALLBACK_RECIPIENT], subject: 'Thaara AI — New Callback Request' });
    await expect(readCallbackReports(foreign, async () => [request])).rejects.toThrow();
    const runtime = createPhoneCallbackRuntime({ repository: store, transport,
      currentOwnerGrant: async () => null, admit: async () => null });
    expect((await runtime.reports(owner)).reports.find(row => row.requestId === id)?.notificationStatus).toBe('submitted');
    await expect(runtime.receive('unadmitted-event', details)).rejects.toThrow();
    expect(await runtime.drain(owner)).toEqual([]);
  });

  it('holds interrupted submissions for review across a repository restart', async () => {
    const request = sample('interrupted');
    await store.save(request);
    await store.claim(owner, request.id, randomUUID());
    await db.withScopedTransaction(owner, tx => tx.query("UPDATE public.phone_callback_requests SET sending_started_at='2000-01-01' WHERE request_id=$1", [request.id]));
    const reopened = new PhoneCallbackNotificationRepository(db, owner);
    await reopened.recoverInterrupted(owner);
    expect(await reopened.read(owner, request.id)).toMatchObject({ notificationStatus: 'unverified' });
    expect(await reopened.pending(owner)).not.toContain(request.id);
  });

  it('persists a fixed-destination grant only after exact owner approval passes policy', async () => {
    expect(await store.currentOwnerGrant(owner)).toBeNull();
    const proposal = await store.prepareNotificationGrant(owner, new Date(Date.now() + 86_400_000).toISOString());
    await expect(store.activateNotificationGrant(owner, proposal.approvalId)).rejects.toThrow();
    await db.withScopedTransaction(owner, tx => new ApprovalRepository(tx).transitionStatus(owner.workspaceId, proposal.approvalId,
      'pending', 'approved', owner.userId));
    await store.activateNotificationGrant(owner, proposal.approvalId);
    await expect(store.activateNotificationGrant(owner, proposal.approvalId)).resolves.toMatchObject({ enabled: true });
    const reopened = new PhoneCallbackNotificationRepository(db, owner);
    expect(await reopened.currentOwnerGrant(owner)).toMatchObject({ ...proposal.parameters, workspaceId: owner.workspaceId,
      userId: owner.userId, approvedByUserId: owner.userId });
    expect(await new PhoneCallbackNotificationRepository(db, foreign).currentOwnerGrant(foreign)).toBeNull();
  });

  it('keeps revocation idempotent and prevents an old approval from re-enabling it', async () => {
    const proposal = await store.prepareNotificationGrant(owner, new Date(Date.now() + 86_400_000).toISOString());
    await db.withScopedTransaction(owner, tx => new ApprovalRepository(tx).transitionStatus(owner.workspaceId, proposal.approvalId,
      'pending', 'approved', owner.userId));
    await store.activateNotificationGrant(owner, proposal.approvalId);
    await store.revokeNotificationGrant(owner);
    await store.revokeNotificationGrant(owner);
    expect(await store.currentOwnerGrant(owner)).toBeNull();
    await expect(store.activateNotificationGrant(owner, proposal.approvalId)).rejects.toThrow('new approval');
    expect(() => store.activateNotificationGrant(foreign, proposal.approvalId)).toThrow();
    const replacement = await store.prepareNotificationGrant(owner, new Date(Date.now() + 86_400_000).toISOString());
    await db.withScopedTransaction(owner, tx => new ApprovalRepository(tx).transitionStatus(owner.workspaceId, replacement.approvalId,
      'pending', 'approved', owner.userId));
    await store.activateNotificationGrant(owner, replacement.approvalId);
    await expect(db.withScopedTransaction(owner, tx => tx.query('DELETE FROM public.phone_callback_notification_grant_uses WHERE approval_id=$1',
      [proposal.approvalId]))).rejects.toThrow('permission denied');
    await expect(store.activateNotificationGrant(owner, proposal.approvalId)).rejects.toThrow('historical approval replay');
    expect((await store.currentOwnerGrant(owner))?.approvalId).toBe(replacement.approvalId);
  });

  it('enforces typed mailbox approval in policy and SQL even for an authenticated owner', async () => {
    const wrong = { enabled: true, sender: PHONE_CALLBACK_SENDER, recipient: 'wrong@example.test',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
    const approval = await db.withScopedTransaction(owner, async tx => {
      const approvals = new ApprovalRepository(tx);
      const row = await approvals.create(owner.workspaceId, 'phone.callback.authorize_notifications', wrong, owner.userId, 'high', 900);
      await approvals.transitionStatus(owner.workspaceId, row.id, 'pending', 'approved', owner.userId);
      return row;
    });
    await expect(store.activateNotificationGrant(owner, approval.id)).rejects.toThrow('policy');
    await expect(db.withScopedTransaction(owner, tx => tx.query(`INSERT INTO public.phone_callback_notification_grants
      (workspace_id,owner_user_id,approval_id,approved_params,expires_at) VALUES($1,$2,$3,$4::jsonb,$5)`,
    [owner.workspaceId, owner.userId, approval.id, JSON.stringify(wrong), wrong.expiresAt]))).rejects.toThrow('approval denied');
    expect(() => store.prepareNotificationGrant(owner, new Date(Date.now() - 1000).toISOString())).toThrow();
    expect(() => store.prepareNotificationGrant(owner, new Date(Date.now() + 31 * 86_400_000).toISOString())).toThrow();
  });

  it('dispatches through the durable owner grant and retains pending work after revocation', async () => {
    const proposal = await store.prepareNotificationGrant(owner, new Date(Date.now() + 86_400_000).toISOString());
    await db.withScopedTransaction(owner, tx => new ApprovalRepository(tx).transitionStatus(owner.workspaceId, proposal.approvalId,
      'pending', 'approved', owner.userId));
    await store.activateNotificationGrant(owner, proposal.approvalId);
    const first = sample('real-grant-first');
    const next = sample('real-grant-next');
    await store.save(first);
    await store.save(next);
    const send = vi.fn(async () => ({ acceptedId: 'synthetic-grant-accepted' }));
    const notify = createCallbackNotificationDispatcher({ repository: store,
      transport: { sender: PHONE_CALLBACK_SENDER, send }, currentOwnerGrant: scope => store.currentOwnerGrant(scope) });
    expect(await notify(owner, first.id)).toBe('submitted');
    const stale = await store.currentOwnerGrant(owner);
    await store.revokeNotificationGrant(owner);
    expect(await notify(owner, next.id)).toBe('awaiting_owner_authorization');
    expect(send).toHaveBeenCalledTimes(1);
    expect(await store.read(owner, next.id)).toMatchObject({ notificationStatus: 'pending', attempts: 0 });
    const staleNotify = createCallbackNotificationDispatcher({ repository: store,
      transport: { sender: PHONE_CALLBACK_SENDER, send }, currentOwnerGrant: async () => stale });
    expect(await staleNotify(owner, next.id)).toBe('not_eligible');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
