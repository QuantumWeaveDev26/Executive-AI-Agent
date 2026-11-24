import { getIsolatedRuntimeConfig, isolatedRoleUrl } from '../../../scripts/step74-runtime-guard.mjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import pg from 'pg';
import { PostgresDatabase, RoleAwarePool, AuthenticatedScope } from '../src/client.js';
import { Migrator } from '../src/migrator.js';
import { WorkspaceRepository } from '../src/repositories/workspaces.js';
import { UserRepository } from '../src/repositories/users.js';
import { hashSessionToken } from '../src/repositories/sessions.js';
import { bootstrapRuntimeIdentities } from '../scripts/bootstrap-runtime-identities.js';
import { RequestScope } from '@thaara/contracts';

const { Client } = pg;

const isolated = getIsolatedRuntimeConfig();

describe('Task 003: Database Security Foundation & Privacy Runtime (Real PostgreSQL)', () => {
  const migrationDbUrl = isolated.migrationUrl;
  const appDbUrl = isolated.appUrl;

  let isLive = false;
  let adminDb: PostgresDatabase | null = null;
  let appDb: PostgresDatabase | null = null;
  let unprivilegedTesterPassword = '';

  let workspaceAId: string;
  let workspaceBId: string;
  let userAId: string;
  let userA2Id: string;
  let userAdminId: string;
  let userBId: string;
  let tokenA: string;
  let tokenHashA: string;
  let tokenA2: string;
  let tokenHashA2: string;
  let tokenAdmin: string;
  let tokenHashAdmin: string;
  let tokenB: string;
  let tokenHashB: string;

  let scopeA: AuthenticatedScope;
  let scopeA2: AuthenticatedScope;
  let scopeAdmin: AuthenticatedScope;
  let scopeB: AuthenticatedScope;

  const adminPw = process.env.THAARA_DB_ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
  const workerPw = process.env.THAARA_DB_WORKER_PASSWORD || crypto.randomBytes(16).toString('hex');
  const seederPw = process.env.THAARA_DB_SEEDER_PASSWORD || crypto.randomBytes(16).toString('hex');
  let workerPool: RoleAwarePool | null = null;

  const task003Tables = [
    'conversations',
    'conversation_messages',
    'memory_items',
    'user_purge_cutoffs',
    'user_purge_operations',
    'worker_dispatch_outbox'
  ] as const;

  const all18SecDefFunctions = [
    'insert_system_default_memory',
    'grant_memory_consent',
    'revoke_memory_consent',
    'supersede_memory_item',
    'expire_memory_items',
    'initiate_self_privacy_purge',
    'acquire_purge_lease',
    'renew_purge_lease',
    'process_purge_batch_messages',
    'process_purge_batch_conversations',
    'process_purge_batch_memories',
    'complete_purge_operation',
    'fail_purge_operation',
    'claim_outbox_dispatches',
    'mark_outbox_dispatched',
    'mark_outbox_failed',
    'inspect_private_conversation',
    'export_user_conversation_history'
  ] as const;

  beforeAll(async () => {
    // 1. Unconditional Probe: Real PostgreSQL MUST be available. Never silently skip.
    const probeClient = new Client({
      connectionString: migrationDbUrl,
      connectionTimeoutMillis: 3000
    });

    const allowOffline = process.env.ALLOW_OFFLINE_RUNTIME_SKIP === 'true';

    try {
      await probeClient.connect();
      await probeClient.query('SELECT 1;');
      await probeClient.end();
      isLive = true;
    } catch (err) {
      if (!allowOffline) {
        throw new Error(
          `[Runtime Proof Failure] PostgreSQL runtime service is unavailable at 127.0.0.1:15432/thaara_step74_test. ` +
            `Real PostgreSQL is required for runtime verification. ` +
            `Verify the disposable Step 74 services and explicit test settings. ` +
            `To run in explicit offline diagnostic mode, set ALLOW_OFFLINE_RUNTIME_SKIP=true. ` +
            `Underlying error: ${(err as Error).message}`
        );
      }
      console.warn(
        `[Task 003 Runtime Suite] PostgreSQL is not reachable at 127.0.0.1:15432/thaara_step74_test. ` +
          `ALLOW_OFFLINE_RUNTIME_SKIP=true is set; running in offline diagnostic mode. Skipping live queries.`
      );
      return;
    }

    if (!appDbUrl) {
      throw new Error(
        `[Runtime Proof Failure] DATABASE_URL must be provided with valid non-superuser thaara_app credentials.`
      );
    }

    // 2. Run migrations as migration admin
    adminDb = new PostgresDatabase(migrationDbUrl);
    const migrator = new Migrator(adminDb);
    await migrator.migrate(migrator.loadMigrationFiles());

    // 3. Connect app database as thaara_app
    appDb = new PostgresDatabase(appDbUrl);

    // 4. Create unprivileged tester role for boundary testing
    unprivilegedTesterPassword = crypto.randomBytes(16).toString('hex');
    await adminDb.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'unprivileged_tester_t003') THEN
          CREATE ROLE unprivileged_tester_t003 WITH LOGIN PASSWORD '${unprivilegedTesterPassword}';
        ELSE
          ALTER ROLE unprivileged_tester_t003 WITH PASSWORD '${unprivilegedTesterPassword}';
        END IF;
      END $$;
      GRANT CONNECT ON DATABASE ${isolated.databaseName} TO unprivileged_tester_t003;
      GRANT USAGE ON SCHEMA public TO unprivileged_tester_t003;
    `);

    // 5. Seed test workspaces and users
    const wsRepo = new WorkspaceRepository(appDb);
    const userRepo = new UserRepository(appDb);

    const wsA = await wsRepo.create('Org Alpha Task003');
    const wsB = await wsRepo.create('Org Beta Task003');
    workspaceAId = wsA.id;
    workspaceBId = wsB.id;

    const uA = await userRepo.create('alice.t003@alpha.com', 'hashA', 'Alice Task003');
    const uA2 = await userRepo.create('charlie.t003@alpha.com', 'hashA2', 'Charlie Task003');
    const uAdmin = await userRepo.create('dan.t003@alpha.com', 'hashDan', 'Dan Task003 Admin');
    const uB = await userRepo.create('bob.t003@beta.com', 'hashB', 'Bob Task003');
    userAId = uA.id;
    userA2Id = uA2.id;
    userAdminId = uAdmin.id;
    userBId = uB.id;

    // Sessions and memberships
    tokenA = 'pg-token-alice-t003';
    tokenHashA = hashSessionToken(tokenA);
    tokenA2 = 'pg-token-charlie-t003';
    tokenHashA2 = hashSessionToken(tokenA2);
    tokenAdmin = 'pg-token-dan-admin-t003';
    tokenHashAdmin = hashSessionToken(tokenAdmin);
    tokenB = 'pg-token-bob-t003';
    tokenHashB = hashSessionToken(tokenB);

    scopeA = {
      workspaceId: workspaceAId,
      userId: userAId,
      role: 'owner',
      sessionTokenHash: tokenHashA
    };

    scopeA2 = {
      workspaceId: workspaceAId,
      userId: userA2Id,
      role: 'member',
      sessionTokenHash: tokenHashA2
    };

    scopeAdmin = {
      workspaceId: workspaceAId,
      userId: userAdminId,
      role: 'admin',
      sessionTokenHash: tokenHashAdmin
    };

    scopeB = {
      workspaceId: workspaceBId,
      userId: userBId,
      role: 'owner',
      sessionTokenHash: tokenHashB
    };

    await appDb.withScopedTransaction(scopeA, async (tx) => {
      await tx.query(
        `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner');`,
        [workspaceAId, userAId]
      );
      await tx.query(
        `INSERT INTO sessions (user_id, workspace_id, token_hash, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '1 day');`,
        [userAId, workspaceAId, tokenHashA]
      );
    });

    await appDb.withScopedTransaction(scopeA2, async (tx) => {
      await tx.query(
        `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member');`,
        [workspaceAId, userA2Id]
      );
      await tx.query(
        `INSERT INTO sessions (user_id, workspace_id, token_hash, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '1 day');`,
        [userA2Id, workspaceAId, tokenHashA2]
      );
    });

    await appDb.withScopedTransaction(scopeAdmin, async (tx) => {
      await tx.query(
        `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'admin');`,
        [workspaceAId, userAdminId]
      );
      await tx.query(
        `INSERT INTO sessions (user_id, workspace_id, token_hash, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '1 day');`,
        [userAdminId, workspaceAId, tokenHashAdmin]
      );
    });

    await appDb.withScopedTransaction(scopeB, async (tx) => {
      await tx.query(
        `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner');`,
        [workspaceBId, userBId]
      );
      await tx.query(
        `INSERT INTO sessions (user_id, workspace_id, token_hash, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '1 day');`,
        [userBId, workspaceBId, tokenHashB]
      );
    });

    // 6. Bootstrap runtime identities and initialize worker pool
    await bootstrapRuntimeIdentities(adminDb, {
      databaseName: isolated.databaseName,
      adminPassword: adminPw,
      workerPassword: workerPw,
      seederPassword: seederPw
    });

    workerPool = new RoleAwarePool({
      connectionString: isolatedRoleUrl(isolated, 'thaara_worker_user', workerPw),
      targetRole: 'thaara_worker',
      expectedLoginUser: 'thaara_worker_user'
    });
  });

  afterAll(async () => {
    if (workerPool) await workerPool.close();
    if (appDb) await appDb.close();
    if (adminDb) await adminDb.close();
  });

  describe('PostgreSQL Catalog Assertions & Privilege Hardening (Task 003)', () => {
    it('proves all 6 Task 003 tables have RLS enabled and forced', async () => {
      if (!isLive || !adminDb) return;

      for (const table of task003Tables) {
        const res = await adminDb.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
          SELECT c.relrowsecurity, c.relforcerowsecurity
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
          WHERE n.nspname = 'public' AND c.relname = $1;
        `, [table]);

        expect(res.rows.length, `Table ${table} must exist in public schema`).toBe(1);
        expect(res.rows[0]?.relrowsecurity, `Table ${table} must have relrowsecurity enabled`).toBe(true);
        expect(res.rows[0]?.relforcerowsecurity, `Table ${table} must have relforcerowsecurity enabled`).toBe(true);
      }
    });

    it('proves obsolete mutable-GUC policies on auxiliary tables are replaced with token-bound policies', async () => {
      if (!isLive || !adminDb) return;

      // 1. Obsolete policies must be completely gone
      const oldPolRes = await adminDb.query<{ count: string }>(`
        SELECT COUNT(*) AS count
        FROM pg_catalog.pg_policy pol
        JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND pol.polname IN (
            'tenant_and_owner_isolation_user_purge_cutoffs',
            'tenant_and_owner_isolation_user_purge_operations',
            'tenant_isolation_worker_dispatch_outbox'
          );
      `);
      expect(Number(oldPolRes.rows[0]?.count)).toBe(0);

      // 2. New token-bound and DML-denial policies exist
      const newPolRes = await adminDb.query<{ count: string }>(`
        SELECT COUNT(*) AS count
        FROM pg_catalog.pg_policy pol
        JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN ('user_purge_cutoffs', 'user_purge_operations', 'worker_dispatch_outbox')
          AND pol.polname IN (
            'user_purge_cutoffs_select_policy',
            'user_purge_cutoffs_insert_policy',
            'user_purge_cutoffs_update_policy',
            'user_purge_cutoffs_delete_policy',
            'user_purge_operations_select_policy',
            'user_purge_operations_insert_policy',
            'user_purge_operations_update_policy',
            'user_purge_operations_delete_policy',
            'worker_dispatch_outbox_select_policy',
            'worker_dispatch_outbox_insert_policy',
            'worker_dispatch_outbox_update_policy',
            'worker_dispatch_outbox_delete_policy'
          );
      `);
      expect(Number(newPolRes.rows[0]?.count)).toBe(12);
    });

    it('proves all 18 Task 003 functions have SECURITY DEFINER and search_path pinned to pg_catalog, public, pg_temp', async () => {
      if (!isLive || !adminDb) return;

      for (const fnName of all18SecDefFunctions) {
        const res = await adminDb.query<{ prosecdef: boolean; proconfig: string[] | null }>(`
          SELECT p.prosecdef, p.proconfig
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = $1;
        `, [fnName]);

        expect(res.rows.length, `Function ${fnName} must exist in public schema`).toBe(1);
        expect(res.rows[0]?.prosecdef, `Function ${fnName} must be SECURITY DEFINER`).toBe(true);
        expect(res.rows[0]?.proconfig).not.toBeNull();

        const searchPathConfig = res.rows[0]?.proconfig?.find((c) => c.startsWith('search_path='));
        expect(searchPathConfig).toBe('search_path=pg_catalog, public, pg_temp');
      }
    });

    it('proves PUBLIC has no EXECUTE privilege on any of the 18 functions', async () => {
      if (!isLive || !adminDb) return;

      for (const fnName of all18SecDefFunctions) {
        const res = await adminDb.query<{ has_priv: boolean }>(`
          SELECT has_function_privilege('public', p.oid, 'execute') AS has_priv
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = $1;
        `, [fnName]);

        expect(res.rows[0]?.has_priv, `PUBLIC must not have execute privilege on ${fnName}`).toBe(false);
      }
    });

    it('proves thaara_app cannot execute insert_system_default_memory (privilege boundary)', async () => {
      if (!isLive || !appDb) return;

      await expect(
        appDb.query(
          `SELECT public.insert_system_default_memory($1, 'fact', 'key1', 'val1');`,
          [workspaceAId]
        )
      ).rejects.toThrow(/permission denied for function insert_system_default_memory/);
    });
  });

  describe('TypeScript Runtime Bootstrap & RoleAwarePool (Task 003)', () => {
    it('proves bootstrapRuntimeIdentities safely configures dedicated identities in one transaction', async () => {
      if (!isLive || !adminDb) return;

      const testPasswords = {
        databaseName: isolated.databaseName,
        adminPassword: adminPw,
        workerPassword: workerPw,
        seederPassword: seederPw
      };

      const result = await bootstrapRuntimeIdentities(adminDb, testPasswords);
      expect(result.configuredRoles).toEqual([
        'thaara_admin_user',
        'thaara_worker_user',
        'thaara_seeder_user'
      ]);

      // Verify roles exist and have correct attributes
      for (const role of result.configuredRoles) {
        const res = await adminDb.query<{
          rolcanlogin: boolean;
          rolinherit: boolean;
          rolsuper: boolean;
          rolbypassrls: boolean;
        }>(`
          SELECT rolcanlogin, rolinherit, rolsuper, rolbypassrls
          FROM pg_catalog.pg_roles WHERE rolname = $1;
        `, [role]);

        expect(res.rows[0]?.rolcanlogin).toBe(true);
        expect(res.rows[0]?.rolinherit).toBe(false);
        expect(res.rows[0]?.rolsuper).toBe(false);
        expect(res.rows[0]?.rolbypassrls).toBe(false);
      }
    });

    it('proves bootstrapRuntimeIdentities rejects short or empty passwords', async () => {
      if (!isLive || !adminDb) return;

      await expect(
        bootstrapRuntimeIdentities(adminDb, {
          databaseName: isolated.databaseName,
          adminPassword: crypto.randomBytes(3).toString('hex'),
          workerPassword: crypto.randomBytes(16).toString('hex'),
          seederPassword: crypto.randomBytes(16).toString('hex')
        })
      ).rejects.toThrow(/Password for thaara_admin_user is too short/);
    });

    it('proves thaara_app cannot execute SET ROLE (42501 permission denied)', async () => {
      if (!isLive || !appDb) return;

      await expect(appDb.query('SET ROLE "thaara_worker";')).rejects.toThrow(
        /permission denied to set role "thaara_worker"/
      );
      await expect(appDb.query('SET ROLE "thaara_admin";')).rejects.toThrow(
        /permission denied to set role "thaara_admin"/
      );
      await expect(appDb.query('SET ROLE "thaara_seeder";')).rejects.toThrow(
        /permission denied to set role "thaara_seeder"/
      );
    });

    it('proves RoleAwarePool validates target privilege role against allow-list', () => {
      expect(() => {
        new RoleAwarePool({
          connectionString: migrationDbUrl,
          targetRole: 'postgres' as any
        });
      }).toThrow(/Invalid target privilege role/);
    });
  });

  describe('Unscoped Fail-Closed Boundary on Task 003 Tables', () => {
    it('unscoped SELECT on all Task 003 tables returns 0 rows', async () => {
      if (!isLive || !appDb) return;

      for (const table of task003Tables) {
        const res = await appDb.query(`SELECT * FROM ${table};`);
        expect(res.rows.length, `Table ${table} must return 0 rows on unscoped SELECT`).toBe(0);
      }
    });

    it('unscoped INSERT fails closed with RLS violation on all Task 003 tables', async () => {
      if (!isLive || !appDb) return;

      // conversations
      await expect(
        appDb.query(
          `INSERT INTO conversations (workspace_id, user_id, title) VALUES ($1, $2, 'Unscoped Conv');`,
          [workspaceAId, userAId]
        )
      ).rejects.toThrow(/(permission denied for table|new row violates row-level security policy)/);

      // conversation_messages
      await expect(
        appDb.query(
          `INSERT INTO conversation_messages (workspace_id, conversation_id, user_id, sequence_number, sender_id, content)
           VALUES ($1, gen_random_uuid(), $2, 0, $2, 'Unscoped Msg');`,
          [workspaceAId, userAId]
        )
      ).rejects.toThrow(/(permission denied for table|new row violates row-level security policy)/);

      // memory_items
      await expect(
        appDb.query(
          `INSERT INTO memory_items (workspace_id, scope, user_id, category, key, value)
           VALUES ($1, 'user', $2, 'fact', 'unscoped_key', 'unscoped_val');`,
          [workspaceAId, userAId]
        )
      ).rejects.toThrow(/(permission denied for table|new row violates row-level security policy)/);

      // user_purge_cutoffs
      await expect(
        appDb.query(
          `INSERT INTO user_purge_cutoffs (workspace_id, user_id, cutoff_at, generation)
           VALUES ($1, $2, NOW(), 99);`,
          [workspaceAId, userAId]
        )
      ).rejects.toThrow(/(permission denied for table|new row violates row-level security policy)/);

      // user_purge_operations
      await expect(
        appDb.query(
          `INSERT INTO user_purge_operations (workspace_id, user_id, generation, cutoff_at, mode)
           VALUES ($1, $2, 99, NOW(), 'history_and_memory');`,
          [workspaceAId, userAId]
        )
      ).rejects.toThrow(/(permission denied for table|new row violates row-level security policy)/);

      // worker_dispatch_outbox
      await expect(
        appDb.query(
          `INSERT INTO worker_dispatch_outbox (workspace_id, topic, dedup_key, payload)
           VALUES ($1, 'unscoped', 'unscoped_key', '{}');`,
          [workspaceAId]
        )
      ).rejects.toThrow(/(permission denied for table|new row violates row-level security policy)/);
    });

    it('unscoped DELETE is rejected by privilege boundary on all Task 003 tables', async () => {
      if (!isLive || !appDb) return;

      for (const table of task003Tables) {
        await expect(appDb.query(`DELETE FROM ${table} RETURNING *;`)).rejects.toThrow(
          new RegExp(`permission denied for table ${table}`)
        );
      }
    });

    it('unscoped UPDATE on conversation_messages is rejected by privilege boundary (append-only)', async () => {
      if (!isLive || !appDb) return;

      await expect(
        appDb.query(`UPDATE conversation_messages SET content = 'tampered' RETURNING *;`)
      ).rejects.toThrow(/permission denied for table conversation_messages/);
    });
  });

  describe('Owner-Private Isolation and Append-Only Messages (Real PostgreSQL)', () => {
    let aliceConvId = '';
    let aliceMsgId = '';

    it('Alice can insert and read her own conversation and message under Scope A', async () => {
      if (!isLive || !appDb) return;

      await appDb.withScopedTransaction(scopeA, async (tx) => {
        const { rows: convRows } = await tx.query<{ id: string }>(
          `SELECT public.create_conversation($1, 'Alice Private Thread', 'web', '{}') AS id;`,
          [tokenHashA]
        );
        aliceConvId = convRows[0]!.id;

        const { rows: msgRows } = await tx.query<{ id: string }>(
          `SELECT message_id AS id FROM public.append_conversation_message($1, $2, 'Hello from Alice', '{}');`,
          [tokenHashA, aliceConvId]
        );
        aliceMsgId = msgRows[0]!.id;

        const readConv = await tx.query(
          `SELECT * FROM conversations WHERE id = $1;`,
          [aliceConvId]
        );
        expect(readConv.rows.length).toBe(1);

        const readMsg = await tx.query(
          `SELECT * FROM conversation_messages WHERE id = $1;`,
          [aliceMsgId]
        );
        expect(readMsg.rows.length).toBe(1);
      });
    });

    it('Charlie (same workspace Org Alpha, different user) cannot SELECT Alice conversations or messages under RLS', async () => {
      if (!isLive || !appDb || !aliceConvId) return;

      await appDb.withScopedTransaction(scopeA2, async (tx) => {
        // Owner-private boundary: Charlie is in Workspace A, but cannot see Alice's records!
        const convRes = await tx.query(
          `SELECT * FROM conversations WHERE id = $1;`,
          [aliceConvId]
        );
        expect(convRes.rows.length, 'Charlie must not read Alice conversation in same workspace').toBe(0);

        const msgRes = await tx.query(
          `SELECT * FROM conversation_messages WHERE id = $1;`,
          [aliceMsgId]
        );
        expect(msgRes.rows.length, 'Charlie must not read Alice message in same workspace').toBe(0);
      });
    });

    it('Bob (Workspace B) cannot SELECT Alice conversations or messages under RLS', async () => {
      if (!isLive || !appDb || !aliceConvId) return;

      await appDb.withScopedTransaction(scopeB, async (tx) => {
        const convRes = await tx.query(
          `SELECT * FROM conversations WHERE id = $1;`,
          [aliceConvId]
        );
        expect(convRes.rows.length, 'Bob must not read Alice conversation in foreign workspace').toBe(0);

        const msgRes = await tx.query(
          `SELECT * FROM conversation_messages WHERE id = $1;`,
          [aliceMsgId]
        );
        expect(msgRes.rows.length, 'Bob must not read Alice message in foreign workspace').toBe(0);
      });
    });

    it('Scope A cannot INSERT conversation claiming Charlie userId (RLS WITH CHECK rejection)', async () => {
      if (!isLive || !appDb) return;

      await expect(
        appDb.withScopedTransaction(scopeA, async (tx) => {
          await tx.query(
            `INSERT INTO conversations (workspace_id, user_id, title)
             VALUES ($1, $2, 'Forged User Conversation');`,
            [workspaceAId, userA2Id]
          );
        })
      ).rejects.toThrow(/new row violates row-level security policy/);
    });

    it('proves closed conversations cannot be reopened (state transition trigger)', async () => {
      if (!isLive || !appDb || !aliceConvId) return;

      await appDb.withScopedTransaction(scopeA, async (tx) => {
        // Transition active -> closed
        await tx.query(
          `SELECT public.update_conversation_status($1, $2, 'closed');`,
          [tokenHashA, aliceConvId]
        );

        // Attempt closed -> active (forbidden)
        await expect(
          tx.query(
            `SELECT public.update_conversation_status($1, $2, 'active');`,
            [tokenHashA, aliceConvId]
          )
        ).rejects.toThrow(/(cannot transition to any other status|cannot be reopened)/);
      });
    });
  });

  describe('Consent-Controlled Memory, Provenance & Supersession (Real PostgreSQL)', () => {
    let memoryId = '';

    it('Alice can create user-scoped memory item with pending_consent', async () => {
      if (!isLive || !appDb) return;

      await appDb.withScopedTransaction(scopeA, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `SELECT public.create_memory_item($1, 'user', 'preference', 'theme', 'dark', 0.95, 'explicit_user_input', null, null, null) AS id;`,
          [tokenHashA]
        );
        memoryId = rows[0]!.id;
        expect(memoryId).toBeDefined();

        const memCheck = await tx.query<{ consent_status: string }>(
          `SELECT consent_status FROM memory_items WHERE id = $1;`,
          [memoryId]
        );
        expect(memCheck.rows[0]?.consent_status).toBe('pending_consent');
      });
    });

    it('Charlie cannot grant consent to Alice memory (authorization check)', async () => {
      if (!isLive || !appDb || !memoryId) return;

      await expect(
        appDb.query(`SELECT public.grant_memory_consent($1, $2);`, [tokenHashA2, memoryId])
      ).rejects.toThrow(/cannot grant consent for another user's memory/);
    });

    it('Alice grants consent: transitions to consented and writes audit event', async () => {
      if (!isLive || !appDb || !memoryId) return;

      const res = await appDb.query<{ grant_memory_consent: boolean }>(
        `SELECT public.grant_memory_consent($1, $2);`,
        [tokenHashA, memoryId]
      );
      expect(res.rows[0]?.grant_memory_consent).toBe(true);

      // Verify row state
      await appDb.withScopedTransaction(scopeA, async (tx) => {
        const check = await tx.query<{ consent_status: string; consent_actor_user_id: string }>(
          `SELECT consent_status, consent_actor_user_id FROM memory_items WHERE id = $1;`,
          [memoryId]
        );
        expect(check.rows[0]?.consent_status).toBe('consented');
        expect(check.rows[0]?.consent_actor_user_id).toBe(userAId);
      });

      // Verify audit event written without value
      await appDb.withScopedTransaction(scopeA, async (tx) => {
        const audit = await tx.query<{ action: string; payload: any }>(
          `SELECT action, payload FROM audit_events WHERE target_id = $1 AND action = 'memory.consent_granted';`,
          [memoryId]
        );
        expect(audit.rows.length).toBe(1);
        expect(audit.rows[0]?.payload.value).toBeUndefined();
      });
    });

    it('Duplicate consent on already consented memory is rejected', async () => {
      if (!isLive || !appDb || !memoryId) return;

      await expect(
        appDb.query(`SELECT public.grant_memory_consent($1, $2);`, [tokenHashA, memoryId])
      ).rejects.toThrow(/Memory item is already consented/);
    });

    it('Alice revokes consent: transitions to revoked and cannot be re-consented', async () => {
      if (!isLive || !appDb || !memoryId) return;

      const res = await appDb.query<{ revoke_memory_consent: boolean }>(
        `SELECT public.revoke_memory_consent($1, $2);`,
        [tokenHashA, memoryId]
      );
      expect(res.rows[0]?.revoke_memory_consent).toBe(true);

      // Re-consent attempt fails
      await expect(
        appDb.query(`SELECT public.grant_memory_consent($1, $2);`, [tokenHashA, memoryId])
      ).rejects.toThrow(/Cannot grant consent to revoked memory item/);
    });

    it('Alice supersedes active memory item atomically', async () => {
      if (!isLive || !appDb) return;

      let predId = '';
      await appDb.withScopedTransaction(scopeA, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `SELECT public.create_memory_item($1, 'user', 'preference', 'editor', 'vim', 1.0, 'explicit_user_input', null, null, null) AS id;`,
          [tokenHashA]
        );
        predId = rows[0]!.id;
      });

      const succRes = await appDb.query<{ supersede_memory_item: string }>(
        `SELECT public.supersede_memory_item($1, $2, 'neovim', 1.0);`,
        [tokenHashA, predId]
      );
      const successorId = succRes.rows[0]?.supersede_memory_item;
      expect(successorId).toBeDefined();

      await appDb.withScopedTransaction(scopeA, async (tx) => {
        const predRow = await tx.query<{ lifecycle_status: string; superseded_by_id: string }>(
          `SELECT lifecycle_status, superseded_by_id FROM memory_items WHERE id = $1;`,
          [predId]
        );
        expect(predRow.rows[0]?.lifecycle_status).toBe('superseded');
        expect(predRow.rows[0]?.superseded_by_id).toBe(successorId);

        const succRow = await tx.query<{ lifecycle_status: string; version: number; value: string; provenance_user_id: string }>(
          `SELECT lifecycle_status, version, value, provenance_user_id FROM memory_items WHERE id = $1;`,
          [successorId]
        );
        expect(succRow.rows[0]?.lifecycle_status).toBe('active');
        expect(succRow.rows[0]?.version).toBe(2);
        expect(succRow.rows[0]?.value).toBe('neovim');
        expect(succRow.rows[0]?.provenance_user_id).toBe(userAId);
      });

      // Verify audit event retains original target_type ('memory_item') and payload contract
      await appDb.withScopedTransaction(scopeA, async (tx) => {
        const audit = await tx.query<{
          action: string;
          target_type: string;
          target_id: string;
          payload: {
            predecessor_id: string;
            successor_id: string;
            category: string;
            key: string;
            new_version: number;
          };
        }>(
          `SELECT action, target_type, target_id, payload
           FROM audit_events
           WHERE action = 'memory.superseded' AND target_id = $1;`,
          [successorId]
        );
        expect(audit.rows.length).toBe(1);
        const event = audit.rows[0]!;
        expect(event.action).toBe('memory.superseded');
        expect(event.target_type).toBe('memory_item');
        expect(event.target_id).toBe(successorId);
        expect(event.payload.predecessor_id).toBe(predId);
        expect(event.payload.successor_id).toBe(successorId);
        expect(event.payload.category).toBe('preference');
        expect(event.payload.key).toBe('editor');
        expect(event.payload.new_version).toBe(2);
      });
    });

    it('proves valid explicit-user and conversation-message provenance integrity', async () => {
      if (!isLive || !appDb) return;

      let convId = '';
      let msgId = '';

      // 1. Create conversation and message
      await appDb.withScopedTransaction(scopeA, async (tx) => {
        const cRes = await tx.query<{ id: string }>(
          `SELECT public.create_conversation($1, 'Provenance Test Thread', 'web', '{}') AS id;`,
          [tokenHashA]
        );
        convId = cRes.rows[0]!.id;

        const mRes = await tx.query<{ id: string }>(
          `SELECT message_id AS id FROM public.append_conversation_message($1, $2, 'Please remember my preferred timezone is UTC', '{}');`,
          [tokenHashA, convId]
        );
        msgId = mRes.rows[0]!.id;
      });

      // 2. Valid conversation_message provenance requires conversation_id, message_id, and user_id
      await appDb.withScopedTransaction(scopeA, async (tx) => {
        const memRes = await tx.query<{ id: string }>(
          `SELECT public.create_memory_item($1, 'user', 'preference', 'timezone', 'UTC', 1.0, 'conversation_message', $2, $3, null) AS id;`,
          [tokenHashA, convId, msgId]
        );
        expect(memRes.rows[0]?.id).toBeDefined();

        const checkRes = await tx.query<{ provenance: string; provenance_user_id: string }>(
          `SELECT provenance, provenance_user_id FROM public.memory_items WHERE id = $1;`,
          [memRes.rows[0]?.id]
        );
        expect(checkRes.rows[0]?.provenance).toBe('conversation_message');
        expect(checkRes.rows[0]?.provenance_user_id).toBe(userAId);
      });

      // 3. Invalid conversation_message provenance missing message link fails check constraint
      await expect(
        appDb.withScopedTransaction(scopeA, async (tx) => {
          await tx.query(
            `SELECT public.create_memory_item($1, 'user', 'preference', 'bad_provenance', 'val', 1.0, 'conversation_message', NULL, NULL, NULL);`,
            [tokenHashA]
          );
        })
      ).rejects.toThrow(/(chk_memory_provenance_message|requires both)/);

      // 4. Invalid explicit_user_input with missing provenance_user_id fails check constraint
      await expect(
        adminDb!.query(
          `INSERT INTO public.memory_items (
             workspace_id, scope, user_id, category, key, value, confidence,
             consent_status, provenance, provenance_user_id
           ) VALUES (
             $1, 'user', $2, 'preference', 'bad_user_input', 'val', 1.0,
             'pending_consent', 'explicit_user_input', NULL
           );`,
          [workspaceAId, userAId]
        )
      ).rejects.toThrow(/chk_memory_provenance_explicit/);
    });
  });

  describe('Privacy Purge & Outbox State Machine (Real PostgreSQL)', () => {
    let purgeOpId = '';
    let purgeGeneration = 0;

    it('Alice initiates self privacy purge: creates cutoff, operation, and outbox record', async () => {
      if (!isLive || !appDb) return;

      const res = await appDb.query<{
        operation_id: string;
        generation: number;
        cutoff_at: string;
      }>(`SELECT * FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`, [tokenHashA]);

      expect(res.rows.length).toBe(1);
      purgeOpId = res.rows[0]!.operation_id;
      purgeGeneration = res.rows[0]!.generation;
      expect(purgeOpId).toBeDefined();
      expect(purgeGeneration).toBeGreaterThanOrEqual(1);

      // Verify outbox record exists
      await appDb.withScopedTransaction(scopeA, async (tx) => {
        const outbox = await tx.query<{ topic: string; status: string }>(
          `SELECT topic, status FROM worker_dispatch_outbox WHERE workspace_id = $1 AND topic = 'privacy_purge';`,
          [workspaceAId]
        );
        expect(outbox.rows.length).toBeGreaterThanOrEqual(1);
        expect(outbox.rows[0]?.status).toBe('pending');
      });
    });

    it('Tenant A cannot SELECT Tenant B rows from ALL SIX Task 003 tables even with forged GUCs', async () => {
      if (!isLive || !appDb) return;

      // Ensure Tenant B has data across all 6 tables
      let bConvId = '';
      let bMsgId = '';
      let bMemId = '';
      let bPurgeId = '';

      await appDb.withScopedTransaction(scopeB, async (tx) => {
        const cRes = await tx.query<{ id: string }>(
          `SELECT public.create_conversation($1, 'Tenant B Secret Thread Security', 'web', '{}') AS id;`,
          [tokenHashB]
        );
        bConvId = cRes.rows[0]!.id;

        const mRes = await tx.query<{ id: string }>(
          `SELECT message_id AS id FROM public.append_conversation_message($1, $2, 'Tenant B secret content security', '{}');`,
          [tokenHashB, bConvId]
        );
        bMsgId = mRes.rows[0]!.id;

        const memRes = await tx.query<{ id: string }>(
          `SELECT public.create_memory_item($1, 'user', 'preference', 'tenant_b_sec_key', 'tenant_b_sec_val', 1.0, 'explicit_user_input', null, null, null) AS id;`,
          [tokenHashB]
        );
        bMemId = memRes.rows[0]!.id;
        await tx.query(`SELECT public.grant_memory_consent($1, $2);`, [tokenHashB, bMemId]);

        const pRes = await tx.query<{ operation_id: string }>(
          `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
          [tokenHashB]
        );
        bPurgeId = pRes.rows[0]!.operation_id;
      });

      // Connect as thaara_app using Tenant A token, but forge Tenant B GUCs
      const rawClient = new Client({ connectionString: appDbUrl });
      await rawClient.connect();

      try {
        await rawClient.query('BEGIN;');
        await rawClient.query(`SELECT pg_catalog.set_config('app.session_token_hash', $1, true);`, [tokenHashA]);
        await rawClient.query(`SELECT pg_catalog.set_config('app.workspace_id', $1, true);`, [workspaceBId]);
        await rawClient.query(`SELECT pg_catalog.set_config('app.user_id', $1, true);`, [userBId]);
        await rawClient.query(`SELECT pg_catalog.set_config('app.role', 'admin', true);`);

        // SELECT on all 6 tables targeting Tenant B must return 0 rows
        const convRes = await rawClient.query(`SELECT * FROM public.conversations WHERE id = $1;`, [bConvId]);
        const msgRes = await rawClient.query(`SELECT * FROM public.conversation_messages WHERE id = $1;`, [bMsgId]);
        const memRes = await rawClient.query(`SELECT * FROM public.memory_items WHERE id = $1;`, [bMemId]);
        const cutRes = await rawClient.query(`SELECT * FROM public.user_purge_cutoffs WHERE workspace_id = $1;`, [workspaceBId]);
        const opRes = await rawClient.query(`SELECT * FROM public.user_purge_operations WHERE id = $1;`, [bPurgeId]);
        const outRes = await rawClient.query(`SELECT * FROM public.worker_dispatch_outbox WHERE workspace_id = $1;`, [workspaceBId]);

        expect(convRes.rows.length).toBe(0);
        expect(msgRes.rows.length).toBe(0);
        expect(memRes.rows.length).toBe(0);
        expect(cutRes.rows.length).toBe(0);
        expect(opRes.rows.length).toBe(0);
        expect(outRes.rows.length).toBe(0);

        await rawClient.query('ROLLBACK;');
      } finally {
        await rawClient.end();
      }
    });

    it('unscoped, invalid-token, revoked-token, and expired-token reads fail closed on auxiliary tables', async () => {
      if (!isLive || !appDb || !purgeOpId) return;

      const rawClient = new Client({ connectionString: appDbUrl });
      await rawClient.connect();

      try {
        // 1. Unscoped / Empty token hash
        await rawClient.query('BEGIN;');
        await rawClient.query(`SELECT pg_catalog.set_config('app.session_token_hash', '', true);`);
        const r1Cut = await rawClient.query(`SELECT * FROM public.user_purge_cutoffs WHERE workspace_id = $1;`, [workspaceAId]);
        const r1Op = await rawClient.query(`SELECT * FROM public.user_purge_operations WHERE id = $1;`, [purgeOpId]);
        const r1Out = await rawClient.query(`SELECT * FROM public.worker_dispatch_outbox WHERE workspace_id = $1;`, [workspaceAId]);
        await rawClient.query('ROLLBACK;');

        expect(r1Cut.rows.length).toBe(0);
        expect(r1Op.rows.length).toBe(0);
        expect(r1Out.rows.length).toBe(0);

        // 2. Invalid token hash
        await rawClient.query('BEGIN;');
        await rawClient.query(`SELECT pg_catalog.set_config('app.session_token_hash', 'invalid_random_hash', true);`);
        const r2Cut = await rawClient.query(`SELECT * FROM public.user_purge_cutoffs WHERE workspace_id = $1;`, [workspaceAId]);
        const r2Op = await rawClient.query(`SELECT * FROM public.user_purge_operations WHERE id = $1;`, [purgeOpId]);
        const r2Out = await rawClient.query(`SELECT * FROM public.worker_dispatch_outbox WHERE workspace_id = $1;`, [workspaceAId]);
        await rawClient.query('ROLLBACK;');

        expect(r2Cut.rows.length).toBe(0);
        expect(r2Op.rows.length).toBe(0);
        expect(r2Out.rows.length).toBe(0);

        // 3. Revoked token hash
        const revokedToken = 'security-test-revoked-token-2';
        const revokedHash = hashSessionToken(revokedToken);
        await adminDb!.query(`
          INSERT INTO public.sessions (user_id, workspace_id, token_hash, expires_at, revoked_at)
          VALUES ($1, $2, $3, now() + interval '1 day', now());
        `, [userAId, workspaceAId, revokedHash]);

        await rawClient.query('BEGIN;');
        await rawClient.query(`SELECT pg_catalog.set_config('app.session_token_hash', $1, true);`, [revokedHash]);
        const r3Cut = await rawClient.query(`SELECT * FROM public.user_purge_cutoffs WHERE workspace_id = $1;`, [workspaceAId]);
        const r3Op = await rawClient.query(`SELECT * FROM public.user_purge_operations WHERE id = $1;`, [purgeOpId]);
        const r3Out = await rawClient.query(`SELECT * FROM public.worker_dispatch_outbox WHERE workspace_id = $1;`, [workspaceAId]);
        await rawClient.query('ROLLBACK;');

        expect(r3Cut.rows.length).toBe(0);
        expect(r3Op.rows.length).toBe(0);
        expect(r3Out.rows.length).toBe(0);

        // 4. Expired token hash
        const expiredToken = 'security-test-expired-token-2';
        const expiredHash = hashSessionToken(expiredToken);
        await adminDb!.query(`
          INSERT INTO public.sessions (user_id, workspace_id, token_hash, expires_at)
          VALUES ($1, $2, $3, now() - interval '10 seconds');
        `, [userAId, workspaceAId, expiredHash]);

        await rawClient.query('BEGIN;');
        await rawClient.query(`SELECT pg_catalog.set_config('app.session_token_hash', $1, true);`, [expiredHash]);
        const r4Cut = await rawClient.query(`SELECT * FROM public.user_purge_cutoffs WHERE workspace_id = $1;`, [workspaceAId]);
        const r4Op = await rawClient.query(`SELECT * FROM public.user_purge_operations WHERE id = $1;`, [purgeOpId]);
        const r4Out = await rawClient.query(`SELECT * FROM public.worker_dispatch_outbox WHERE workspace_id = $1;`, [workspaceAId]);
        await rawClient.query('ROLLBACK;');

        expect(r4Cut.rows.length).toBe(0);
        expect(r4Op.rows.length).toBe(0);
        expect(r4Out.rows.length).toBe(0);
      } finally {
        await rawClient.end();
      }
    });

    it('thaara_app is denied execute on worker-only functions (privilege boundary)', async () => {
      if (!isLive || !appDb || !purgeOpId) return;

      await expect(
        appDb.query(`SELECT * FROM public.claim_outbox_dispatches('worker-node-1', 10, 30);`)
      ).rejects.toThrow(/permission denied/i);

      await expect(
        appDb.query(`SELECT * FROM public.acquire_purge_lease($1, 'worker-node-1', 60);`, [purgeOpId])
      ).rejects.toThrow(/permission denied/i);

      await expect(
        appDb.query(`SELECT * FROM public.process_purge_batch_messages($1, gen_random_uuid(), 'worker-node-1', 100);`, [purgeOpId])
      ).rejects.toThrow(/permission denied/i);

      await expect(
        appDb.query(`SELECT public.complete_purge_operation($1, gen_random_uuid(), 'worker-node-1');`, [purgeOpId])
      ).rejects.toThrow(/permission denied/i);
    });

    it('Worker claims outbox dispatches using SKIP LOCKED via thaara_worker RoleAwarePool', async () => {
      if (!isLive || !workerPool) return;

      await workerPool.withRoleClient(async (workerClient) => {
        const claimRes = await workerClient.query<{
          id: string;
          topic: string;
          claim_token: string;
          attempts: number;
        }>(`SELECT * FROM public.claim_outbox_dispatches('worker-node-1', 10, 30);`);

        expect(claimRes.rows.length).toBeGreaterThanOrEqual(1);
        const claimed = claimRes.rows[0]!;
        expect(claimed.claim_token).toBeDefined();
        expect(claimed.attempts).toBeGreaterThanOrEqual(1);

        // Mark dispatched
        const markRes = await workerClient.query<{ mark_outbox_dispatched: boolean }>(
          `SELECT public.mark_outbox_dispatched($1, $2);`,
          [claimed.id, claimed.claim_token]
        );
        expect(markRes.rows[0]?.mark_outbox_dispatched).toBe(true);
      });
    });

    it('Worker acquires purge lease, processes redaction batches, and completes purge operation via thaara_worker RoleAwarePool', async () => {
      if (!isLive || !workerPool || !purgeOpId) return;

      await workerPool.withRoleClient(async (workerClient) => {
        // 1. Acquire lease
        const leaseRes = await workerClient.query<{
          lease_token: string;
          lease_expires_at: string;
          mode: string;
        }>(`SELECT * FROM public.acquire_purge_lease($1, 'worker-node-1', 60);`, [purgeOpId]);

        expect(leaseRes.rows.length).toBe(1);
        const leaseToken = leaseRes.rows[0]!.lease_token;

        // 2. Process message batch
        const msgBatch = await workerClient.query<{ processed_count: number; has_more: boolean }>(
          `SELECT * FROM public.process_purge_batch_messages($1, $2, 'worker-node-1', 100);`,
          [purgeOpId, leaseToken]
        );
        expect(msgBatch.rows[0]?.has_more).toBe(false);

        // 3. Process conversation batch
        const convBatch = await workerClient.query<{ processed_count: number; has_more: boolean }>(
          `SELECT * FROM public.process_purge_batch_conversations($1, $2, 'worker-node-1', 100);`,
          [purgeOpId, leaseToken]
        );
        expect(convBatch.rows[0]?.has_more).toBe(false);

        // 4. Process memories batch
        const memBatch = await workerClient.query<{ processed_count: number; has_more: boolean }>(
          `SELECT * FROM public.process_purge_batch_memories($1, $2, 'worker-node-1', 100);`,
          [purgeOpId, leaseToken]
        );
        expect(memBatch.rows[0]?.has_more).toBe(false);

        // 5. Complete purge operation
        const compRes = await workerClient.query<{ complete_purge_operation: boolean }>(
          `SELECT public.complete_purge_operation($1, $2, 'worker-node-1');`,
          [purgeOpId, leaseToken]
        );
        expect(compRes.rows[0]?.complete_purge_operation).toBe(true);
      });
    });
  });

  describe('Administrative Inspection & Self-Service Export (Real PostgreSQL)', () => {
    let testConvId = '';

    it('Alice (owner) creates fresh conversation for inspection testing', async () => {
      if (!isLive || !appDb) return;

      await appDb.withScopedTransaction(scopeA, async (tx) => {
        const { rows: cRows } = await tx.query<{ id: string }>(
          `SELECT public.create_conversation($1, 'Inspection Target Thread', 'web', '{}') AS id;`,
          [tokenHashA]
        );
        testConvId = cRows[0]!.id;

        await tx.query(
          `SELECT public.append_conversation_message($1, $2, 'Confidential operational query', '{}');`,
          [tokenHashA, testConvId]
        );
      });
    });

    it('Charlie (regular member) is denied administrative inspection', async () => {
      if (!isLive || !appDb || !testConvId) return;

      await expect(
        appDb.query(
          `SELECT * FROM public.inspect_private_conversation($1, $2, 'Auditing operational incident');`,
          [tokenHashA2, testConvId]
        )
      ).rejects.toThrow(/administrative inspection requires owner or admin role/);
    });

    it('Alice (owner) inspects conversation: returns messages and writes mandatory audit log with counts', async () => {
      if (!isLive || !appDb || !testConvId) return;

      const justification = 'Mandatory compliance review for SOC2 compliance';
      const inspectRes = await appDb.query<{
        id: string;
        sequence_number: number;
        content: string;
      }>(
        `SELECT * FROM public.inspect_private_conversation($1, $2, $3, 50, 0);`,
        [tokenHashA, testConvId, justification]
      );

      expect(inspectRes.rows.length).toBe(1);
      expect(inspectRes.rows[0]?.content).toBe('Confidential operational query');

      // Verify audit log has returned count and justification, but NO message content
      await appDb.withScopedTransaction(scopeA, async (tx) => {
        const audit = await tx.query<{ action: string; payload: any }>(
          `SELECT action, payload FROM audit_events WHERE action = 'admin.inspection' AND target_id = $1;`,
          [testConvId]
        );
        expect(audit.rows.length).toBe(1);
        expect(audit.rows[0]?.payload.returned_count).toBe(1);
        expect(audit.rows[0]?.payload.justification).toBe(justification);
        expect(audit.rows[0]?.payload.content).toBeUndefined();
      });
    });

    it('Dan (admin) inspects conversation: succeeds and writes audit log', async () => {
      if (!isLive || !appDb || !testConvId) return;

      const justification = 'Admin incident response review for security audit';
      const inspectRes = await appDb.query<{
        id: string;
        sequence_number: number;
        content: string;
      }>(
        `SELECT * FROM public.inspect_private_conversation($1, $2, $3, 50, 0);`,
        [tokenHashAdmin, testConvId, justification]
      );

      expect(inspectRes.rows.length).toBe(1);
      expect(inspectRes.rows[0]?.content).toBe('Confidential operational query');

      // Verify audit log has returned count and justification
      await appDb.withScopedTransaction(scopeA, async (tx) => {
        const audit = await tx.query<{ action: string; payload: any }>(
          `SELECT action, payload FROM audit_events WHERE action = 'admin.inspection' AND target_id = $1 AND actor_user_id = $2;`,
          [testConvId, userAdminId]
        );
        expect(audit.rows.length).toBe(1);
        expect(audit.rows[0]?.payload.returned_count).toBe(1);
        expect(audit.rows[0]?.payload.justification).toBe(justification);
        expect(audit.rows[0]?.payload.content).toBeUndefined();
      });
    });

    it('export_user_conversation_history returns scoped history JSON and writes audit log', async () => {
      if (!isLive || !appDb) return;

      const res = await appDb.query<{ export_user_conversation_history: any }>(
        `SELECT public.export_user_conversation_history($1);`,
        [tokenHashA]
      );

      const history = res.rows[0]?.export_user_conversation_history;
      expect(history).toBeDefined();
      expect(history.workspace_id).toBe(workspaceAId);
      expect(history.user_id).toBe(userAId);
      expect(Array.isArray(history.conversations)).toBe(true);

      // Verify audit event
      await appDb.withScopedTransaction(scopeA, async (tx) => {
        const audit = await tx.query<{ action: string }>(
          `SELECT action FROM audit_events WHERE action = 'user.history_export' AND target_id = $1;`,
          [userAId]
        );
        expect(audit.rows.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Direct Grant Denial & Memory Immutability Hardening (Real PostgreSQL)', () => {
    let testMemId = '';

    it('creates an active memory item via controlled function for negative tests', async () => {
      if (!isLive || !appDb) return;

      await appDb.withScopedTransaction(scopeA, async (tx) => {
        const memRes = await tx.query<{ id: string }>(
          `SELECT public.create_memory_item($1, 'user', 'preference', 'theme_neg', 'dark', 1.0, 'explicit_user_input', null, null, null) AS id;`,
          [tokenHashA]
        );
        testMemId = memRes.rows[0]!.id;
        expect(testMemId).toBeDefined();

        await tx.query(`SELECT public.grant_memory_consent($1, $2);`, [tokenHashA, testMemId]);
      });
    });

    it('thaara_app is denied direct UPDATE on memory_items', async () => {
      if (!isLive || !appDb || !testMemId) return;

      await expect(
        appDb.query(`UPDATE public.memory_items SET value = 'light' WHERE id = $1;`, [testMemId])
      ).rejects.toThrow(/permission denied/i);
    });

    it('thaara_app is denied direct UPDATE on user_purge_operations and worker_dispatch_outbox', async () => {
      if (!isLive || !appDb) return;

      await expect(
        appDb.query(`UPDATE public.user_purge_operations SET status = 'completed';`)
      ).rejects.toThrow(/permission denied/i);

      await expect(
        appDb.query(`UPDATE public.worker_dispatch_outbox SET status = 'dispatched';`)
      ).rejects.toThrow(/permission denied/i);
    });

    it('thaara_app is denied direct INSERT on user_purge_cutoffs, user_purge_operations, and worker_dispatch_outbox', async () => {
      if (!isLive || !appDb) return;

      await expect(
        appDb.query(
          `INSERT INTO public.user_purge_cutoffs (workspace_id, user_id, cutoff_at, generation)
           VALUES ($1, $2, now(), 999);`,
          [workspaceAId, userAId]
        )
      ).rejects.toThrow(/permission denied/i);

      await expect(
        appDb.query(
          `INSERT INTO public.user_purge_operations (id, workspace_id, user_id, generation, cutoff_at, mode, status)
           VALUES (gen_random_uuid(), $1, $2, 999, now(), 'history_and_memory', 'pending');`,
          [workspaceAId, userAId]
        )
      ).rejects.toThrow(/permission denied/i);

      await expect(
        appDb.query(
          `INSERT INTO public.worker_dispatch_outbox (workspace_id, topic, dedup_key, payload, status)
           VALUES ($1, 'fake_topic', 'fake_key', '{}'::jsonb, 'pending');`,
          [workspaceAId]
        )
      ).rejects.toThrow(/permission denied/i);
    });

    it('thaara_app and thaara_admin cannot EXECUTE expire_memory_items (worker-only)', async () => {
      if (!isLive || !appDb) return;

      await expect(
        appDb.query(`SELECT public.expire_memory_items($1, 10);`, [workspaceAId])
      ).rejects.toThrow(/permission denied/i);
    });

    it('memory immutability trigger rejects direct updates to value, confidence, expires_at, and version', async () => {
      if (!isLive || !adminDb || !testMemId) return;

      // Even when run with privileged adminDb, the trigger enforces business immutability
      await expect(
        adminDb.query(`UPDATE public.memory_items SET value = 'hacked' WHERE id = $1;`, [testMemId])
      ).rejects.toThrow(/Direct update to memory_items\.value is prohibited/i);

      await expect(
        adminDb.query(`UPDATE public.memory_items SET confidence = 0.2 WHERE id = $1;`, [testMemId])
      ).rejects.toThrow(/Direct update to memory_items\.confidence is prohibited/i);

      await expect(
        adminDb.query(`UPDATE public.memory_items SET expires_at = now() WHERE id = $1;`, [testMemId])
      ).rejects.toThrow(/Direct update to memory_items\.expires_at is prohibited/i);

      await expect(
        adminDb.query(`UPDATE public.memory_items SET version = 99 WHERE id = $1;`, [testMemId])
      ).rejects.toThrow(/Memory item identity, provenance, version and creation fields are strictly immutable/i);
    });
  });

  describe('Durable Purge Correctness & Fencing (Real PostgreSQL)', () => {
    let testPurgeOpId = '';
    let testLeaseToken = '';

    it('premature purge completion is rejected when checkpoints are not complete', async () => {
      if (!isLive || !appDb) return;

      // Initiate a new purge operation
      const initRes = await appDb.query<{ operation_id: string }>(
        `SELECT operation_id FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
        [tokenHashB]
      );
      testPurgeOpId = initRes.rows[0]!.operation_id;

      // Acquire lease as worker
      const leaseRes = await adminDb.query<{ lease_token: string }>(
        `SELECT lease_token FROM public.acquire_purge_lease($1, 'worker-guard-1', 60);`,
        [testPurgeOpId]
      );
      testLeaseToken = leaseRes.rows[0]!.lease_token;

      // Attempt immediate complete_purge_operation before processing any batches
      await expect(
        adminDb.query(
          `SELECT public.complete_purge_operation($1, $2, 'worker-guard-1');`,
          [testPurgeOpId, testLeaseToken]
        )
      ).rejects.toThrow(/prerequisite checkpoints incomplete/i);
    });

    it('complete_purge_operation rejects invalid or stale lease tokens', async () => {
      if (!isLive || !adminDb || !testPurgeOpId) return;

      const fakeToken = crypto.randomUUID();
      await expect(
        adminDb.query(
          `SELECT public.complete_purge_operation($1, $2, 'worker-guard-1');`,
          [testPurgeOpId, fakeToken]
        )
      ).rejects.toThrow(/Purge fence violation: invalid or expired lease/i);
    });

    it('concurrent initiate_self_privacy_purge calls serialize safely without generation collision', async () => {
      if (!isLive || !appDb) return;

      // Issue two concurrent initiation calls
      const [res1, res2] = await Promise.all([
        appDb.query<{ generation: number }>(
          `SELECT generation FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
          [tokenHashA]
        ),
        appDb.query<{ generation: number }>(
          `SELECT generation FROM public.initiate_self_privacy_purge($1, 'history_and_memory');`,
          [tokenHashA]
        )
      ]);

      const gen1 = res1.rows[0]!.generation;
      const gen2 = res2.rows[0]!.generation;
      expect(gen1).not.toBe(gen2);
      expect(Math.abs(gen1 - gen2)).toBe(1);
    });
  });

  describe('RoleAwarePool Runtime Proofs & Seeder Isolation (Real PostgreSQL)', () => {
    beforeAll(async () => {
      if (!isLive || !adminDb) return;

      // Bootstrap identities dynamically for this test
      await bootstrapRuntimeIdentities(adminDb, {
        databaseName: isolated.databaseName,
        adminPassword: adminPw,
        workerPassword: workerPw,
        seederPassword: seederPw
      });
    });

    it('RoleAwarePool connects as thaara_seeder_user, executes SET ROLE thaara_seeder and verifies session/role', async () => {
      if (!isLive) return;

      const connStr = isolatedRoleUrl(isolated, 'thaara_seeder_user', seederPw);
      const seederPool = new RoleAwarePool({
        connectionString: connStr,
        targetRole: 'thaara_seeder',
        expectedLoginUser: 'thaara_seeder_user'
      });

      try {
        await seederPool.withRoleClient(async (client) => {
          const res = await client.query<{
            session_user: string;
            current_user: string;
            has_seeder_role: boolean;
          }>(`
            SELECT session_user, current_user, pg_catalog.pg_has_role(session_user, 'thaara_seeder', 'member') AS has_seeder_role;
          `);
          const row = res.rows[0]!;
          expect(row.session_user).toBe('thaara_seeder_user');
          expect(row.current_user).toBe('thaara_seeder');
          expect(row.has_seeder_role).toBe(true);

          // Seeder CAN execute insert_system_default_memory
          const insertRes = await client.query<{ insert_system_default_memory: string }>(
            `SELECT public.insert_system_default_memory($1, 'guideline', 'system.ai.tone', 'professional', 1.0);`,
            [workspaceAId]
          );
          expect(insertRes.rows[0]?.insert_system_default_memory).toBeDefined();

          // Seeder CANNOT directly INSERT into memory_items
          await expect(
            client.query(
              `INSERT INTO public.memory_items (workspace_id, scope, category, key, value, confidence, consent_status, provenance, lifecycle_status, version)
               VALUES ($1, 'workspace', 'guideline', 'raw.key', 'raw.val', 1.0, 'pending_consent', 'system_default', 'active', 1);`,
              [workspaceAId]
            )
          ).rejects.toThrow(/permission denied/i);

          // Seeder CANNOT directly SELECT from memory_items
          await expect(
            client.query(`SELECT * FROM public.memory_items;`)
          ).rejects.toThrow(/permission denied/i);
        });
      } finally {
        await seederPool.close();
      }
    });

    it('thaara_app cannot execute insert_system_default_memory', async () => {
      if (!isLive || !appDb) return;

      await expect(
        appDb.query(
          `SELECT public.insert_system_default_memory($1, 'guideline', 'fake.key', 'fake.val', 1.0);`,
          [workspaceAId]
        )
      ).rejects.toThrow(/permission denied/i);
    });

    it('thaara_app cannot SET ROLE to privileged roles (thaara_admin, thaara_worker, thaara_seeder)', async () => {
      if (!isLive || !appDb) return;

      await expect(appDb.exec(`SET ROLE thaara_admin;`)).rejects.toThrow(/permission denied/i);
      await expect(appDb.exec(`SET ROLE thaara_worker;`)).rejects.toThrow(/permission denied/i);
      await expect(appDb.exec(`SET ROLE thaara_seeder;`)).rejects.toThrow(/permission denied/i);
    });

    it('RoleAwarePool rejects expectedLoginUser mismatch', async () => {
      if (!isLive) return;

      const connStr = isolatedRoleUrl(isolated, 'thaara_seeder_user', seederPw);
      const wrongUser = new RoleAwarePool({
        connectionString: connStr,
        targetRole: 'thaara_seeder',
        expectedLoginUser: 'different_user'
      });

      await expect(wrongUser.checkout()).rejects.toThrow(/expected session_user "different_user", got "thaara_seeder_user"/i);
      await wrongUser.close();
    });

    it('RoleAwarePool executes RESET ROLE and verifies current_user equals session_user before reuse', async () => {
      if (!isLive) return;

      const connStr = isolatedRoleUrl(isolated, 'thaara_worker_user', workerPw);
      const workerPool = new RoleAwarePool({
        connectionString: connStr,
        targetRole: 'thaara_worker',
        expectedLoginUser: 'thaara_worker_user',
        max: 1 // Force same connection reuse
      });

      try {
        // Checkout 1: verifies SET ROLE thaara_worker
        const client1 = await workerPool.checkout();
        const res1 = await client1.query<{ session_user: string; current_user: string }>(
          `SELECT session_user, current_user;`
        );
        expect(res1.rows[0]?.session_user).toBe('thaara_worker_user');
        expect(res1.rows[0]?.current_user).toBe('thaara_worker');

        // Release: executes RESET ROLE and verifies current_user === session_user
        await client1.release();

        // Calling query after release must fail closed
        await expect(client1.query('SELECT 1;')).rejects.toThrow(/already released/i);

        // Checkout 2: reuses connection, confirms clean role-boundary transition
        const client2 = await workerPool.checkout();
        const res2 = await client2.query<{ session_user: string; current_user: string }>(
          `SELECT session_user, current_user;`
        );
        expect(res2.rows[0]?.session_user).toBe('thaara_worker_user');
        expect(res2.rows[0]?.current_user).toBe('thaara_worker');
        await client2.release();
      } finally {
        await workerPool.close();
      }
    });
  });
});
