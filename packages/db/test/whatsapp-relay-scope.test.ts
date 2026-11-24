import { describe, expect, it, vi } from 'vitest';
import { PostgresDatabase } from '../src/client.js';
const actor = { workspace_id: '11111111-1111-4111-8111-111111111111', user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'member', principal_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', connection_id: 'wa_test', revision: '1', relay_operation: 'events' };
function fixture(unsafeRole = false, revoke = false) {
  const calls: any[] = []; let resolutions = 0;
  const client = { release: vi.fn(), query: vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes('pg_catalog.pg_roles')) return { rows: [{ app_member: true, elevated: unsafeRole, rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false }] };
    if (sql.includes('current_whatsapp_runtime_scope')) return { rows: revoke && ++resolutions > 1 ? [] : [actor] };
    return { rows: [] };
  }) };
  return { db: new PostgresDatabase({ connect: async () => client } as any), client, calls };
}
describe('WhatsApp callback transaction admission; query harness only', () => {
  it('resolves one explicit principal and never invents a browser session', async () => {
    const f = fixture();
    const result = await (f.db as any).withWhatsAppRelayTransaction('a'.repeat(64), 'wa_test', 'events', async (_tx: any, scope: any) => {
      expect(scope).toMatchObject({ workspaceId: actor.workspace_id, userId: actor.user_id, principalId: actor.principal_id, connectionId: 'wa_test', revision: 1 });
      expect(scope).not.toHaveProperty('sessionTokenHash'); return 'accepted';
    });
    expect(result).toBe('accepted'); expect(f.calls.some(c => c.sql === 'COMMIT;')).toBe(true); expect(f.client.release).toHaveBeenCalledOnce();
    expect(f.calls.find(c => c.sql.includes("'app.session_token_hash'"))?.params).toEqual(['']);
  });
  it('denies an elevated database role before resolving a principal', async () => {
    const f = fixture(true), work = vi.fn(); await expect((f.db as any).withWhatsAppRelayTransaction('a'.repeat(64), 'wa_test', 'events', work)).rejects.toThrow();
    expect(work).not.toHaveBeenCalled(); expect(f.calls.some(c => c.sql.includes('current_whatsapp_runtime_scope'))).toBe(false);
  });
  it('rolls back if authorization disappears before commit', async () => {
    const f = fixture(false, true); await expect((f.db as any).withWhatsAppRelayTransaction('a'.repeat(64), 'wa_test', 'events', async () => 'accepted')).rejects.toThrow();
    expect(f.calls.some(c => c.sql === 'ROLLBACK;')).toBe(true); expect(f.calls.some(c => c.sql === 'COMMIT;')).toBe(false);
  });
  it('rejects unsupported operations and malformed hashes without opening a transaction', async () => {
    const f = fixture();
    for (const [hash, op] of [['raw-secret', 'events'], ['a'.repeat(64), 'disconnect']]) await expect((f.db as any).withWhatsAppRelayTransaction(hash, 'wa_test', op, async () => undefined)).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
});
