import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresDatabase, PostgresWhatsAppStateStore, WorkspaceRepository, UserRepository, MembershipRepository, SessionRepository, generateSessionToken, hashSessionToken, type AuthenticatedScope } from '@thaara/db';
import { defaultPolicyGateway } from '@thaara/policy';
import { getIsolatedRuntimeConfig } from '../../../scripts/step74-runtime-guard.mjs';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { waBinding } from './helpers/whatsapp-durable-fixture.js';

// Deliberately not executed by normal tests. New SQL and disposable infrastructure need separate approval.
if (process.env.THAARA_STEP10821_RUNTIME_APPROVED !== 'yes') throw new Error('Step 108.21 needs explicit isolated-runtime approval.');
const isolated = getIsolatedRuntimeConfig(process.env); // localhost:15432 / thaara_step74_test only; no URL overrides.

describe('108.21 isolated PostgreSQL media acceptance; new SQL must already be approved/applied', () => {
  let admin: PostgresDatabase, app: PostgresDatabase, second: PostgresDatabase;
  let scope: AuthenticatedScope, foreign: AuthenticatedScope, peer: AuthenticatedScope;
  let binding: typeof waBinding, service: DurableWhatsAppService;
  async function identity(workspaceId?: string): Promise<AuthenticatedScope> {
    const id = randomUUID(), workspace = workspaceId ?? (await new WorkspaceRepository(admin).create('Synthetic media ' + id)).id;
    const user = await new UserRepository(admin).create(id + '@media.test', 'synthetic-unused', 'Synthetic media owner');
    await new MembershipRepository(admin).create(workspace, user.id, 'owner');
    const token = generateSessionToken(); await new SessionRepository(admin).create(user.id, workspace, token);
    return { workspaceId: workspace, userId: user.id, role: 'owner', sessionTokenHash: hashSessionToken(token) };
  }
  const event = (kind: 'image' | 'document' | 'audio' = 'image') => ({ field: 'messages', messaging_product: 'whatsapp', metadata: { phone_number_id: binding.phoneNumberId }, messages: [{ id: 'wamid.' + randomUUID(), from: binding.recipients[0]!.phoneE164.slice(1), timestamp: String(Math.floor(Date.now() / 1000)), type: kind, [kind]: { id: '123456789', mime_type: kind === 'image' ? 'image/jpeg' : kind === 'document' ? 'application/pdf' : 'audio/ogg; codecs=opus', sha256: 'a'.repeat(64) } }] });
  const count = async () => Number((await admin.query('SELECT count(*) FROM public.whatsapp_n8n_messages WHERE workspace_id=$1 AND owner_user_id=$2 AND connection_id=$3', [scope.workspaceId, scope.userId, binding.connectionId])).rows[0].count);
  beforeAll(async () => {
    admin = new PostgresDatabase(isolated.migrationUrl); app = new PostgresDatabase(isolated.appUrl); second = new PostgresDatabase(isolated.appUrl);
    expect((await admin.query('SELECT current_database() AS name')).rows[0].name).toBe(isolated.databaseName);
    expect((await app.query('SELECT current_user AS name')).rows[0].name).toBe('thaara_app');
    expect((await app.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const table = (await admin.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.whatsapp_n8n_messages'::regclass")).rows[0];
    expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect((await admin.query("SELECT count(*) FROM pg_constraint WHERE conrelid='public.whatsapp_n8n_messages'::regclass AND conname='whatsapp_n8n_media_metadata_10821_check'")).rows[0].count).toBe('1');
  });
  beforeEach(async () => {
    scope = await identity(); foreign = await identity(); peer = await identity(scope.workspaceId);
    binding = { ...structuredClone(waBinding), workspaceId: scope.workspaceId, userId: scope.userId, connectionId: 'wa_media_' + randomUUID() };
    const store = new PostgresWhatsAppStateStore(app); await store.createOffline(scope, binding);
    service = new DurableWhatsAppService(store, defaultPolicyGateway);
  });
  afterAll(async () => { await second?.close(); await app?.close(); await admin?.close(); });
  it('retains image/document/audio metadata across independent service/pool instances', async () => {
    for (const kind of ['image', 'document', 'audio'] as const) await service.ingest(scope, binding.connectionId, event(kind));
    const restarted = new DurableWhatsAppService(new PostgresWhatsAppStateStore(second), defaultPolicyGateway);
    const history = await restarted.history(scope, binding.connectionId);
    expect(history.map(m => m.media?.kind).sort()).toEqual(['audio', 'document', 'image']);
    expect(history.every(m => m.media?.downloadStatus === 'not_downloaded')).toBe(true);
    expect(await count()).toBe(3);
  });
  it('enforces owner/workspace isolation in repositories and actual restricted-role RLS', async () => {
    await service.ingest(scope, binding.connectionId, event());
    for (const denied of [foreign, peer]) {
      await expect(service.history(denied, binding.connectionId)).rejects.toThrow();
      const rows = await app.withScopedTransaction(denied, tx => tx.query('SELECT media_metadata FROM public.whatsapp_n8n_messages WHERE connection_id=$1', [binding.connectionId]));
      expect(rows.rows).toHaveLength(0);
    }
  });
  it('database constraint rejects corrupt metadata after application validation', async () => {
    const tampered = { withScopedTransaction: (s: AuthenticatedScope, operation: any) => app.withScopedTransaction(s, tx => operation({ query: (sql: string, params?: any[]) => {
      if (sql.includes('INSERT INTO public.whatsapp_n8n_messages')) { const copy = [...params!]; copy[7] = JSON.stringify({ ...JSON.parse(copy[7]), mimeType: 'text/html' }); return tx.query(sql, copy); }
      return tx.query(sql, params);
    } })) };
    const bad = new DurableWhatsAppService(new PostgresWhatsAppStateStore(tampered), defaultPolicyGateway);
    await expect(bad.ingest(scope, binding.connectionId, event())).rejects.toThrow(); expect(await count()).toBe(0);
  });
  it('audit failure rolls back message and metadata together', async () => {
    const failing = { withScopedTransaction: (s: AuthenticatedScope, operation: any) => app.withScopedTransaction(s, tx => operation({ query: (sql: string, params?: any[]) => sql.includes('INSERT INTO audit_events') ? tx.query('SELECT 1/0') : tx.query(sql, params) })) };
    const bad = new DurableWhatsAppService(new PostgresWhatsAppStateStore(failing), defaultPolicyGateway);
    await expect(bad.ingest(scope, binding.connectionId, event())).rejects.toThrow(); expect(await count()).toBe(0);
  });
  it('deduplicates concurrent media delivery across independent pools', async () => {
    const another = new DurableWhatsAppService(new PostgresWhatsAppStateStore(second), defaultPolicyGateway), payload = event();
    const results = await Promise.all([service.ingest(scope, binding.connectionId, payload), another.ingest(scope, binding.connectionId, payload)]);
    expect(results.reduce((sum, r) => sum + r.acceptedMessages, 0)).toBe(1); expect(await count()).toBe(1);
  });
  it('disconnect fences subsequent ingestion and hides retained metadata', async () => {
    await service.ingest(scope, binding.connectionId, event()); await service.disconnect(scope, binding.connectionId);
    await expect(service.ingest(scope, binding.connectionId, event())).rejects.toThrow();
    await expect(service.inbox(scope, binding.connectionId)).rejects.toThrow(); expect(await count()).toBe(1);
  });
  it('never fetches media, exposes upstream IDs/hashes or claims verified files', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    try {
      await service.ingest(scope, binding.connectionId, event());
      const inbox = await service.inbox(scope, binding.connectionId), json = JSON.stringify(inbox);
      expect(inbox.messages[0]).toMatchObject({ attachment: { downloadStatus: 'not_downloaded' }, verified: false });
      expect(json).not.toContain('123456789'); expect(json).not.toContain('a'.repeat(64)); expect(fetcher).not.toHaveBeenCalled();
    } finally { fetcher.mockRestore(); }
  });
});
