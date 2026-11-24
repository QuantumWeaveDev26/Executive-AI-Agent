import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresDatabase, PostgresWhatsAppStateStore, WorkspaceRepository, UserRepository, MembershipRepository, SessionRepository, ApprovalRepository, generateSessionToken, hashSessionToken, type AuthenticatedScope } from '@thaara/db';
import { defaultPolicyGateway } from '@thaara/policy';
import { getIsolatedRuntimeConfig } from '../../../scripts/step74-runtime-guard.mjs';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { waBinding } from './helpers/whatsapp-durable-fixture.js';

// Deliberately not executed by normal tests. Runs only inside the owner-approved disposable 10825 fixture.
if (process.env.THAARA_STEP10825_RUNTIME_APPROVED !== 'yes') throw new Error('Step 108.25 needs explicit isolated-runtime approval.');
const isolated = getIsolatedRuntimeConfig(process.env);

describe('10825 isolated PostgreSQL acceptance: template/media drafts and contact management', () => {
  let admin: PostgresDatabase, app: PostgresDatabase, second: PostgresDatabase;
  let scope: AuthenticatedScope, foreign: AuthenticatedScope, peer: AuthenticatedScope;
  let binding: typeof waBinding, service: DurableWhatsAppService;
  async function identity(workspaceId?: string): Promise<AuthenticatedScope> {
    const id = randomUUID(), workspace = workspaceId ?? (await new WorkspaceRepository(admin).create('Synthetic 10825 ' + id)).id;
    const user = await new UserRepository(admin).create(id + '@10825.test', 'synthetic-unused', 'Synthetic owner');
    await new MembershipRepository(admin).create(workspace, user.id, 'owner');
    const token = generateSessionToken(); await new SessionRepository(admin).create(user.id, workspace, token);
    return { workspaceId: workspace, userId: user.id, role: 'owner', sessionTokenHash: hashSessionToken(token) };
  }
  const recipient = () => binding.recipients[0]!;
  const event = (hoursAgo = 0) => ({ field: 'messages', messaging_product: 'whatsapp', metadata: { phone_number_id: binding.phoneNumberId },
    messages: [{ id: 'wamid.' + randomUUID(), from: recipient().phoneE164.slice(1), timestamp: String(Math.floor((Date.now() - hoursAgo * 3600000) / 1000)), type: 'text', text: { body: 'Synthetic' } }] });
  const base = () => ({ connectionId: binding.connectionId, connectionRevision: 1, senderPhoneNumberId: binding.phoneNumberId, recipientId: recipient().id, idempotencyKey: 'k-' + randomUUID().replaceAll('-', '') });
  async function approve(draft: object) {
    const approval = await new ApprovalRepository(admin).create(scope.workspaceId, 'whatsapp.meta.messages.send', draft as any, scope.userId, 'high');
    await new ApprovalRepository(admin).transitionStatus(scope.workspaceId, approval.id, 'pending', 'approved', scope.userId);
    return approval.id;
  }
  /** Exercises only the CHECK constraint: triggers/FKs off inside a block that always rolls back. */
  async function shapeAccepted(draft: object): Promise<boolean> {
    const record = { id: randomUUID(), draft, parameterHash: 'a'.repeat(64), approvalId: randomUUID(), createdAt: 1000, expiresAt: 61000, claimedAt: null,
      receipt: { transport: 'n8n', mode: 'offline_test', dispatchId: '', providerMessageId: null, status: 'not_configured', verified: false } };
    record.receipt.dispatchId = record.id;
    const sql = `DO $$ BEGIN SET LOCAL session_replication_role = replica;
      INSERT INTO public.whatsapp_n8n_dispatches (workspace_id, owner_user_id, connection_id, dispatch_id, idempotency_key, parameter_hash, approval_id, created_at_ms, expires_at_ms, claimed_at_ms, provider_message_id, record, audit_id)
      VALUES ('${scope.workspaceId}', '${scope.userId}', ${quote((draft as any).connectionId)}, '${record.id}', ${quote((draft as any).idempotencyKey)}, '${'a'.repeat(64)}', '${record.approvalId}', 1000, 61000, NULL, NULL, ${quote(JSON.stringify(record))}::jsonb, '${randomUUID()}');
      RAISE EXCEPTION 'shape-ok-rollback'; END $$;`;
    try { await admin.query(sql); } catch (error) { const message = String((error as Error).message); if (message.includes('shape-ok-rollback')) return true; if (message.includes('whatsapp_n8n_dispatch_draft_10825_check')) return false; throw error; }
    throw new Error('unreachable');
  }
  const quote = (value: string) => "'" + String(value).replaceAll("'", "''") + "'";

  beforeAll(async () => {
    admin = new PostgresDatabase(isolated.migrationUrl); app = new PostgresDatabase(isolated.appUrl); second = new PostgresDatabase(isolated.appUrl);
    expect((await admin.query('SELECT current_database() AS name')).rows[0].name).toBe(isolated.databaseName);
    expect((await app.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
  beforeEach(async () => {
    scope = await identity(); foreign = await identity(); peer = await identity(scope.workspaceId);
    binding = { ...structuredClone(waBinding), workspaceId: scope.workspaceId, userId: scope.userId, connectionId: 'wa_10825_' + randomUUID().slice(0, 8) };
    await new PostgresWhatsAppStateStore(app).createOffline(scope, binding);
    service = new DurableWhatsAppService(new PostgresWhatsAppStateStore(app), defaultPolicyGateway);
  });
  afterAll(async () => { await second?.close(); await app?.close(); await admin?.close(); });

  it('installs exactly the reviewed objects and keeps RLS, function owners and old rows intact', async () => {
    const names = (await admin.query("SELECT conname FROM pg_constraint WHERE conname LIKE '%10825%' ORDER BY 1")).rows.map(r => r.conname);
    expect(names).toEqual(['whatsapp_n8n_audit_action_10825_check', 'whatsapp_n8n_dispatch_draft_10825_check']);
    expect((await admin.query("SELECT count(*) FROM pg_constraint WHERE conrelid='public.whatsapp_n8n_dispatches'::regclass AND pg_get_constraintdef(oid) LIKE '%replyToProviderMessageId%'")).rows[0].count).toBe('1');
    expect((await admin.query("SELECT pg_get_userbyid(proowner) AS owner, prosecdef FROM pg_proc WHERE oid='public.issue_whatsapp_audit_proof()'::regprocedure")).rows[0]).toEqual({ owner: 'thaara_whatsapp_audit_guard', prosecdef: true });
    const rls = (await admin.query("SELECT bool_and(relrowsecurity AND relforcerowsecurity) AS ok FROM pg_class WHERE oid IN ('public.whatsapp_n8n_connections'::regclass,'public.whatsapp_n8n_messages'::regclass,'public.whatsapp_n8n_dispatches'::regclass,'public.whatsapp_n8n_status_events'::regclass)")).rows[0];
    expect(rls.ok).toBe(true);
  });
  it('database CHECK accepts exactly one bounded content kind and rejects unsafe shapes', async () => {
    const text = { ...base(), bodyText: 'Hello' }, template = { ...base(), template: { name: 'meeting_reminder', language: 'en_US', bodyParams: ['11 AM'] } };
    const media = { ...base(), media: { kind: 'document', mediaId: '123', mimeType: 'application/pdf', sha256: 'b'.repeat(64), filename: 'Q3.pdf', caption: 'Report' } };
    for (const ok of [text, template, media, { ...base(), media: { kind: 'audio', mediaId: '1', mimeType: 'audio/ogg', sha256: 'c'.repeat(64) } }]) expect(await shapeAccepted(ok)).toBe(true);
    const bad = [{ ...text, template: template.template }, { ...base() }, { ...template, replyToProviderMessageId: 'wamid.x' },
      { ...template, template: { ...template.template, name: 'Bad Name' } }, { ...template, template: { ...template.template, bodyParams: Array(21).fill('x') } },
      { ...template, template: { ...template.template, bodyParams: [42] } }, { ...template, template: { ...template.template, extra: 1 } },
      { ...media, media: { ...media.media, kind: 'audio', filename: undefined } }, { ...media, media: { ...media.media, kind: 'image', caption: undefined } },
      { ...media, media: { ...media.media, url: 'https://evil.example' } }, { ...media, media: { ...media.media, mediaId: '../x' } }, { ...text, url: 'https://evil.example' },
      { ...media, media: { ...media.media, filename: 'a/b.pdf' } }, { ...text, bodyText: 'x'.repeat(4097) }];
    for (const b of bad) expect(await shapeAccepted(JSON.parse(JSON.stringify(b)))).toBe(false);
  });
  it('text drafts still reserve and claim inside the 24-hour window (regression)', async () => {
    await service.ingest(scope, binding.connectionId, event());
    const draft = { ...base(), bodyText: 'Regression text' }, receipt = await service.reserve(scope, binding.connectionId, draft, await approve(draft));
    expect(await service.claim(scope, binding.connectionId, receipt.dispatchId!, 1)).toMatchObject({ messageType: 'text', textBody: 'Regression text', dispatchEnabled: false });
  });
  it('database allows an approved template outside the window, refuses text there, and persists across pools', async () => {
    await service.ingest(scope, binding.connectionId, event(30));
    const text = { ...base(), bodyText: 'Too late' };
    await expect(service.reserve(scope, binding.connectionId, text, await approve(text))).rejects.toThrow();
    const template = { ...base(), template: { name: 'meeting_reminder', language: 'en_US', bodyParams: ['11 AM', 'Friday'] } };
    const receipt = await service.reserve(scope, binding.connectionId, template as any, await approve(template));
    const restarted = new DurableWhatsAppService(new PostgresWhatsAppStateStore(second), defaultPolicyGateway);
    expect((await restarted.inbox(scope, binding.connectionId)).messages.find(m => m.direction === 'outbound')?.textPreview).toBe('[Template: meeting_reminder (en_US)] 11 AM · Friday');
    expect(await restarted.claim(scope, binding.connectionId, receipt.dispatchId!, 1)).toMatchObject({ messageType: 'template', dispatchEnabled: false });
  });
  it('media drafts reserve and claim inside the window through the database path', async () => {
    await service.ingest(scope, binding.connectionId, event());
    const media = { ...base(), media: { kind: 'image', mediaId: '987654321', mimeType: 'image/jpeg', sha256: 'd'.repeat(64), caption: 'Site photo' } };
    const receipt = await service.reserve(scope, binding.connectionId, media as any, await approve(media));
    expect(await service.claim(scope, binding.connectionId, receipt.dispatchId!, 1)).toMatchObject({ messageType: 'media', media: media.media });
  });
  it('owner contact update is audited, bumps the revision, allows display names and fences old drafts', async () => {
    await service.ingest(scope, binding.connectionId, event());
    const old = { ...base(), bodyText: 'Old revision' }, pending = await service.reserve(scope, binding.connectionId, old, await approve(old));
    const contacts = [...binding.recipients.map(r => ({ ...r, displayName: 'Ram Kumar' })), { id: 'new_contact', phoneE164: '+919900000099', optedIn: true }];
    expect(await service.updateContacts(scope, binding.connectionId, contacts)).toMatchObject({ revision: 2, contacts: contacts.length });
    const audit = (await admin.query("SELECT count(*) FROM public.audit_events WHERE workspace_id=$1 AND action='whatsapp.durable.contacts_updated' AND target_id=$2", [scope.workspaceId, binding.connectionId])).rows[0];
    expect(audit.count).toBe('1');
    const row = (await admin.query('SELECT revision, binding FROM public.whatsapp_n8n_connections WHERE workspace_id=$1 AND connection_id=$2', [scope.workspaceId, binding.connectionId])).rows[0];
    expect(Number(row.revision)).toBe(2); expect(row.binding.recipients).toEqual(contacts);
    await expect(service.claim(scope, binding.connectionId, pending.dispatchId!, 1)).rejects.toThrow();
    expect((await service.contacts(scope, binding.connectionId)).contacts.map(c => c.contactName)).toContain('Ram Kumar');
  });
  it('rejects contact updates from other owners, other workspaces and tampered bindings', async () => {
    const contacts = [{ id: 'only', phoneE164: '+919900000077', optedIn: true }];
    for (const denied of [foreign, peer]) await expect(service.updateContacts(denied, binding.connectionId, contacts)).rejects.toThrow();
    const tampered = { withScopedTransaction: (s: AuthenticatedScope, operation: any) => app.withScopedTransaction(s, tx => operation({ query: (sql: string, params?: any[]) => {
      if (sql.includes('UPDATE public.whatsapp_n8n_connections')) { const copy = [...params!]; copy[4] = JSON.stringify({ ...JSON.parse(copy[4]), phoneNumberId: '999999999' }); return tx.query(sql, copy); }
      return tx.query(sql, params);
    } })) };
    await expect(new DurableWhatsAppService(new PostgresWhatsAppStateStore(tampered as any), defaultPolicyGateway).updateContacts(scope, binding.connectionId, contacts)).rejects.toThrow();
    const row = (await admin.query('SELECT revision FROM public.whatsapp_n8n_connections WHERE workspace_id=$1 AND connection_id=$2', [scope.workspaceId, binding.connectionId])).rows[0];
    expect(Number(row.revision)).toBe(1);
  });
});
