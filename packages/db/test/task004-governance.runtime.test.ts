import { getIsolatedRuntimeConfig, assertIsolatedPostgresUrl } from '../../../scripts/step74-runtime-guard.mjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import pg from 'pg';
import { PostgresDatabase } from '../src/client.js';
import { Migrator } from '../src/migrator.js';
import { WorkspaceRepository } from '../src/repositories/workspaces.js';
import { UserRepository } from '../src/repositories/users.js';
import { SessionRepository, hashSessionToken } from '../src/repositories/sessions.js';
import { provisionTask004Fresh } from '../scripts/provision-task004-fresh.js';

const { Client } = pg;

const isolated = getIsolatedRuntimeConfig();

describe('Task 004 Phase B — Governed Capabilities & Personas (Real PostgreSQL 16)', () => {
  const allowOffline = process.env.ALLOW_OFFLINE_RUNTIME_SKIP === 'true';
  const rawMigrationUrl = isolated.migrationUrl;
  const rawAppDbUrl = isolated.appUrl;

  function safeHostAndDb(urlStr?: string): string {
    if (!urlStr) return '(none)';
    try {
      const parsed = new URL(urlStr);
      return `${parsed.host}${parsed.pathname}`;
    } catch {
      return '[REDACTED_HOST]';
    }
  }

  let isLive = false;
  let activeMigrationUrl = rawMigrationUrl;
  let activeAppUrl = rawAppDbUrl;

  let adminDb: PostgresDatabase | null = null;
  let appDb: PostgresDatabase | null = null;

  let legacyWorkspaceId: string;
  let legacyUserId: string;
  let legacyPlanId: string;

  let workspaceAId: string;
  let workspaceBId: string;
  let userAAdminId: string;
  let userAMemberId: string;
  let userBAdminId: string;

  const rawTokenAdminA = 'rt-adm-a-' + crypto.randomBytes(8).toString('hex');
  const rawTokenMemberA = 'rt-mem-a-' + crypto.randomBytes(8).toString('hex');
  const rawTokenAdminB = 'rt-adm-b-' + crypto.randomBytes(8).toString('hex');

  let tokenHashAdminA: string;
  let tokenHashMemberA: string;
  let tokenHashAdminB: string;

  beforeAll(async () => {
    if (!rawMigrationUrl) {
      if (!allowOffline) {
        throw new Error(
          '[Runtime Proof Failure] Administrative database URL is missing. ' +
            'Set TASK004_MIGRATION_DATABASE_URL or MIGRATION_DATABASE_URL. ' +
            'Hardcoded postgres:postgres credentials have been removed. ' +
            'To run in explicit offline diagnostic mode, set ALLOW_OFFLINE_RUNTIME_SKIP=true.'
        );
      }
      console.warn(
        '[Task 004 Runtime Suite] No migration database URL configured. ' +
          'ALLOW_OFFLINE_RUNTIME_SKIP=true is set; running in offline diagnostic mode. Skipping live queries.'
      );
      return;
    }

    // 1. Unconditional Probe: Real PostgreSQL MUST be available. Never silently skip in CI.
    const probeClient = new Client({
      connectionString: rawMigrationUrl,
      connectionTimeoutMillis: 3000
    });

    try {
      await probeClient.connect();
      const { rows: probeRows } = await probeClient.query(`
        SELECT rolname, rolsuper, rolcreaterole
        FROM pg_catalog.pg_roles
        WHERE rolname = CURRENT_USER;
      `);
      await probeClient.end();
      isLive = true;

      // If probe was initiated by a superuser (e.g. local root postgres), provision an isolated
      // database and dedicated non-superuser migration identity with CREATEROLE from empty state.
      if (probeRows[0]?.rolsuper === true) {
        const provisioned = await provisionTask004Fresh(rawMigrationUrl, assertIsolatedPostgresUrl);
        activeMigrationUrl = provisioned.migratorUrl;
        activeAppUrl = provisioned.appUrl;
      }
    } catch (err) {
      if (!allowOffline) {
        throw new Error(
          `[Runtime Proof Failure] PostgreSQL runtime service is unavailable at ${safeHostAndDb(rawMigrationUrl)}. ` +
            `Real PostgreSQL is required for runtime verification. ` +
            `Verify the disposable Step 74 services and explicit test settings. ` +
            `To run in explicit offline diagnostic mode, set ALLOW_OFFLINE_RUNTIME_SKIP=true. ` +
            `Underlying error: ${(err as Error).message}`
        );
      }
      console.warn(
        `[Task 004 Runtime Suite] PostgreSQL is not reachable at ${safeHostAndDb(rawMigrationUrl)}. ` +
          `ALLOW_OFFLINE_RUNTIME_SKIP=true is set; running in offline diagnostic mode. Skipping live queries.`
      );
      return;
    }

    // Connect admin DB with non-superuser migration identity
    adminDb = new PostgresDatabase(activeMigrationUrl);
  });

  afterAll(async () => {
    if (appDb) await appDb.close();
    if (adminDb) await adminDb.close();
  });

  describe('1. Non-Superuser Migration Identity & CREATEROLE Authority', () => {
    it('proves the migration identity is non-superuser with CREATEROLE capability', async () => {
      if (!isLive || !adminDb) return;

      const { rows } = await adminDb.query(`
        SELECT rolname, rolsuper, rolcreaterole
        FROM pg_catalog.pg_roles
        WHERE rolname = CURRENT_USER;
      `);

      expect(rows[0]?.rolsuper).toBe(false);
      expect(rows[0]?.rolcreaterole).toBe(true);
    });
  });

  describe('2. Fresh-Database Migrations 0001-0011, Legacy Seeding & 0012 Backfill', () => {
    it('applies migrations 0001 through 0011 cleanly on empty isolated database', async () => {
      if (!isLive || !adminDb) return;

      const migrator = new Migrator(adminDb);
      const allFiles = migrator.loadMigrationFiles();
      const files0001to0011 = allFiles.filter((f) => f.version <= '0011');

      await migrator.migrate(files0001to0011);

      const { rows } = await adminDb.query(`
        SELECT version FROM schema_migrations ORDER BY version ASC;
      `);
      expect(rows.length).toBe(11);
      expect(rows.map((r) => r.version)).toContain('0001');
      expect(rows.map((r) => r.version)).toContain('0011');
    });

    it('seeds pre-existing plans in legacy state without governance_version', async () => {
      if (!isLive || !adminDb) return;

      const wsRepo = new WorkspaceRepository(adminDb);
      const userRepo = new UserRepository(adminDb);

      const legacyWs = await wsRepo.create('Legacy Tenant Workspace');
      const legacyUser = await userRepo.create(
        `legacy_${Date.now()}@alpha.com`,
        'hash',
        'Legacy User'
      );
      legacyWorkspaceId = legacyWs.id;
      legacyUserId = legacyUser.id;

      const planRes = await adminDb.query(
        `INSERT INTO plans (workspace_id, created_by_user_id, title)
         VALUES ($1, $2, 'Pre-Task-004 Legacy Plan') RETURNING id;`,
        [legacyWorkspaceId, legacyUserId]
      );
      legacyPlanId = planRes.rows[0]?.id;
      expect(legacyPlanId).toBeDefined();

      // Verify governance_version column does not exist yet prior to migration 0012
      const colCheck = await adminDb.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'governance_version';
      `);
      expect(colCheck.rows.length).toBe(0);
    });

    it('verifies MEMBER and SET ROLE authority and applies migration 0012 cleanly', async () => {
      if (!isLive || !adminDb) return;

      const migrator = new Migrator(adminDb);
      const allFiles = migrator.loadMigrationFiles();
      const file0012 = allFiles.filter((f) => f.version === '0012');

      await migrator.migrate(file0012);

      // Verify thaara_platform_owner and thaara_definer roles
      const rolesRes = await adminDb.query(`
        SELECT rolname FROM pg_catalog.pg_roles
        WHERE rolname IN ('thaara_platform_owner', 'thaara_definer');
      `);
      expect(rolesRes.rows.map((r) => r.rolname).sort()).toEqual([
        'thaara_definer',
        'thaara_platform_owner'
      ]);

      // Verify migration identity possesses verified MEMBER and SET authority on roles
      const authCheck = await adminDb.query(`
        SELECT
          pg_catalog.pg_has_role(CURRENT_USER, 'thaara_platform_owner', 'MEMBER') AS po_member,
          pg_catalog.pg_has_role(CURRENT_USER, 'thaara_platform_owner', 'SET') AS po_set,
          pg_catalog.pg_has_role(CURRENT_USER, 'thaara_definer', 'MEMBER') AS def_member,
          pg_catalog.pg_has_role(CURRENT_USER, 'thaara_definer', 'SET') AS def_set;
      `);
      expect(authCheck.rows[0]?.po_member).toBe(true);
      expect(authCheck.rows[0]?.po_set).toBe(true);
      expect(authCheck.rows[0]?.def_member).toBe(true);
      expect(authCheck.rows[0]?.def_set).toBe(true);
    });

    it('proves pre-existing plans were backfilled to governance_version = 1', async () => {
      if (!isLive || !adminDb) return;

      const { rows } = await adminDb.query(
        `SELECT governance_version FROM plans WHERE id = $1;`,
        [legacyPlanId]
      );
      expect(rows[0]?.governance_version).toBe(1);
    });

    it('proves new plans default to governance_version = 2', async () => {
      if (!isLive || !adminDb) return;

      const { rows } = await adminDb.query(
        `INSERT INTO plans (workspace_id, created_by_user_id, title)
         VALUES ($1, $2, 'Post-Migration Governed Plan') RETURNING id, governance_version;`,
        [legacyWorkspaceId, legacyUserId]
      );
      expect(rows[0]?.governance_version).toBe(2);
    });

    it('rejects runtime INSERT of plan with legacy governance_version = 1', async () => {
      if (!isLive || !adminDb) return;

      await expect(
        adminDb.query(
          `INSERT INTO plans (workspace_id, created_by_user_id, title, governance_version)
           VALUES ($1, $2, 'Forbidden Legacy Plan', 1);`,
          [legacyWorkspaceId, legacyUserId]
        )
      ).rejects.toThrow(/Legacy governance_version 1 is prohibited/);
    });

    it('rejects runtime UPDATE attempting to modify or downgrade governance_version', async () => {
      if (!isLive || !adminDb) return;

      const { rows } = await adminDb.query(
        `INSERT INTO plans (workspace_id, created_by_user_id, title)
         VALUES ($1, $2, 'Plan for Downgrade Test') RETURNING id;`,
        [legacyWorkspaceId, legacyUserId]
      );
      const planId = rows[0]?.id;

      await expect(
        adminDb.query(
          `UPDATE plans SET governance_version = 1, version = version + 1 WHERE id = $1;`,
          [planId]
        )
      ).rejects.toThrow(
        /Immutable field violation: governance_version cannot be modified or downgraded/
      );
    });
  });

  describe('3. Platform Schema & Preset Catalog Governance in PostgreSQL 16', () => {
    it('proves platform schema and preset_catalog are seeded then owned by thaara_platform_owner', async () => {
      if (!isLive || !adminDb) return;

      const schemaRes = await adminDb.query(`
        SELECT pg_catalog.pg_get_userbyid(nspowner) AS owner
        FROM pg_catalog.pg_namespace
        WHERE nspname = 'platform';
      `);
      expect(schemaRes.rows[0]?.owner).toBe('thaara_platform_owner');

      const tableRes = await adminDb.query(`
        SELECT pg_catalog.pg_get_userbyid(c.relowner) AS owner
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'platform' AND c.relname = 'preset_catalog';
      `);
      expect(tableRes.rows[0]?.owner).toBe('thaara_platform_owner');

      // Verify preset_thaara_v2 is seeded
      const catalogRes = await adminDb.query(`
        SELECT preset_id, name, preset_version FROM platform.preset_catalog WHERE preset_id = 'preset_thaara_v2';
      `);
      expect(catalogRes.rows.length).toBe(1);
      expect(catalogRes.rows[0]?.name).toBe('Thaara');
      expect(catalogRes.rows[0]?.preset_version).toBe(1);
    });

    it('proves runtime roles have zero table privileges on platform.preset_catalog', async () => {
      if (!isLive || !adminDb) return;

      const roles = ['thaara_app', 'thaara_worker', 'thaara_definer'];
      const privs = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES', 'TRIGGER', 'TRUNCATE'];

      for (const role of roles) {
        for (const priv of privs) {
          const { rows } = await adminDb.query(
            `SELECT pg_catalog.has_table_privilege($1, 'platform.preset_catalog', $2) AS has_priv;`,
            [role, priv]
          );
          expect(rows[0]?.has_priv).toBe(false);
        }
      }
    });

    it('proves platform.preset_catalog rejects UPDATE and DELETE via immutability trigger', async () => {
      if (!isLive || !adminDb) return;

      await expect(
        adminDb.query(
          "UPDATE platform.preset_catalog SET name = 'Tampered' WHERE preset_id = 'preset_thaara_v2';"
        )
      ).rejects.toThrow(/Immutable relation violation/);

      await expect(
        adminDb.query(
          "DELETE FROM platform.preset_catalog WHERE preset_id = 'preset_thaara_v2';"
        )
      ).rejects.toThrow(/Immutable relation violation/);
    });
  });

  describe('4. Trigger Function Security & Privilege Boundary in PostgreSQL 16', () => {
    it('proves trigger functions are SECURITY INVOKER with zero direct runtime EXECUTE grants', async () => {
      if (!isLive || !adminDb) return;

      const funcs = ['reject_mutation_on_immutable_table', 'guard_plan_governance_version'];
      for (const fn of funcs) {
        const { rows } = await adminDb.query(
          `
          SELECT p.prosecdef, pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = $1;
        `,
          [fn]
        );

        expect(rows[0]?.prosecdef).toBe(false);
        expect(rows[0]?.public_exec).toBe(false);

        for (const role of ['thaara_app', 'thaara_worker', 'thaara_definer']) {
          const privCheck = await adminDb.query(
            `SELECT pg_catalog.has_function_privilege($1, $2, 'EXECUTE') AS has_exec;`,
            [role, `public.${fn}()`]
          );
          expect(privCheck.rows[0]?.has_exec).toBe(false);
        }
      }
    });
  });

  describe('5. Public Schema Hardening & Dedicated Client Role-Switch Tests', () => {
    it('verifies CREATE on schema public is denied to PUBLIC, thaara_app, thaara_worker, thaara_definer', async () => {
      if (!isLive || !adminDb) return;

      const publicPriv = await adminDb.query(
        `SELECT pg_catalog.has_schema_privilege('public', 'public', 'CREATE') AS has_priv;`
      );
      expect(publicPriv.rows[0]?.has_priv).toBe(false);

      for (const role of ['thaara_app', 'thaara_worker', 'thaara_definer']) {
        const rolePriv = await adminDb.query(
          `SELECT pg_catalog.has_schema_privilege($1, 'public', 'CREATE') AS has_priv;`,
          [role]
        );
        expect(rolePriv.rows[0]?.has_priv).toBe(false);
      }
    });

    it('proves thaara_definer cannot CREATE TABLE in public using dedicated checked-out client with BEGIN/SET LOCAL ROLE/ROLLBACK', async () => {
      if (!isLive) return;

      const client = new Client({ connectionString: activeMigrationUrl });
      await client.connect();
      try {
        await client.query('BEGIN;');
        await client.query('SET LOCAL ROLE thaara_definer;');
        await expect(
          client.query('CREATE TABLE public.regress_definer_table (id INT);')
        ).rejects.toThrow(/permission denied for schema public/);
        await client.query('ROLLBACK;');
      } finally {
        await client.end();
      }
    });

    it('proves thaara_worker cannot CREATE TABLE in public using dedicated checked-out client with BEGIN/SET LOCAL ROLE/ROLLBACK', async () => {
      if (!isLive) return;

      const client = new Client({ connectionString: activeMigrationUrl });
      await client.connect();
      try {
        await client.query('BEGIN;');
        await client.query('SET LOCAL ROLE thaara_worker;');
        await expect(
          client.query('CREATE TABLE public.regress_worker_table (id INT);')
        ).rejects.toThrow(/permission denied for schema public/);
        await client.query('ROLLBACK;');
      } finally {
        await client.end();
      }
    });

    it('proves thaara_app cannot CREATE TABLE in public via app connection', async () => {
      if (!isLive) return;

      // Connect as thaara_app
      if (activeAppUrl) {
        const appClient = new Client({ connectionString: activeAppUrl });
        await appClient.connect();
        try {
          await expect(
            appClient.query('CREATE TABLE public.regress_app_table (id INT);')
          ).rejects.toThrow(/permission denied for schema public/);
        } finally {
          await appClient.end();
        }
      }
    });
  });

  describe('6. SECURITY DEFINER Stored Procedures & App Runtime Verification', () => {
    beforeAll(async () => {
      if (!isLive || !adminDb) return;

      if (activeAppUrl) {
        appDb = new PostgresDatabase(activeAppUrl);
      }

      const wsRepo = new WorkspaceRepository(adminDb);
      const userRepo = new UserRepository(adminDb);
      const sessionRepo = new SessionRepository(adminDb);

      const wsA = await wsRepo.create('Runtime Tenant Alpha');
      const wsB = await wsRepo.create('Runtime Tenant Beta');
      workspaceAId = wsA.id;
      workspaceBId = wsB.id;

      const uAAdmin = await userRepo.create(`adminA_${Date.now()}@alpha.com`, 'hash', 'Admin A');
      const uAMember = await userRepo.create(`memberA_${Date.now()}@alpha.com`, 'hash', 'Member A');
      const uBAdmin = await userRepo.create(`adminB_${Date.now()}@beta.com`, 'hash', 'Admin B');
      userAAdminId = uAAdmin.id;
      userAMemberId = uAMember.id;
      userBAdminId = uBAdmin.id;

      await adminDb.query(
        `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'admin');`,
        [workspaceAId, userAAdminId]
      );
      await adminDb.query(
        `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member');`,
        [workspaceAId, userAMemberId]
      );
      await adminDb.query(
        `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'admin');`,
        [workspaceBId, userBAdminId]
      );

      await sessionRepo.create(userAAdminId, workspaceAId, rawTokenAdminA);
      await sessionRepo.create(userAMemberId, workspaceAId, rawTokenMemberA);
      await sessionRepo.create(userBAdminId, workspaceBId, rawTokenAdminB);

      tokenHashAdminA = hashSessionToken(rawTokenAdminA);
      tokenHashMemberA = hashSessionToken(rawTokenMemberA);
      tokenHashAdminB = hashSessionToken(rawTokenAdminB);
    });

    it('verifies all 9 procedures are SECURITY DEFINER owned by thaara_definer and granted to thaara_app only', async () => {
      if (!isLive || !adminDb) return;

      const procNames = [
        'create_workspace_persona',
        'update_workspace_persona',
        'archive_workspace_persona',
        'set_default_workspace_persona',
        'grant_workspace_capability',
        'revoke_workspace_capability',
        'set_workspace_policy_override',
        'bind_conversation_persona_atomic',
        'bind_plan_step_policy_atomic'
      ];

      for (const name of procNames) {
        const { rows } = await adminDb.query(
          `
          SELECT p.prosecdef, pg_catalog.pg_get_userbyid(p.proowner) AS owner,
                 pg_catalog.has_function_privilege('thaara_app', p.oid, 'EXECUTE') AS app_exec,
                 pg_catalog.has_function_privilege('thaara_worker', p.oid, 'EXECUTE') AS worker_exec,
                 pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = $1;
        `,
          [name]
        );

        expect(rows[0]?.prosecdef).toBe(true);
        expect(rows[0]?.owner).toBe('thaara_definer');
        expect(rows[0]?.app_exec).toBe(true);
        expect(rows[0]?.worker_exec).toBe(false);
        expect(rows[0]?.public_exec).toBe(false);
      }
    });

    it('proves thaara_worker cannot invoke persona/governance procedures', async () => {
      if (!isLive) return;

      const client = new Client({ connectionString: activeMigrationUrl });
      await client.connect();
      try {
        await client.query('BEGIN;');
        await client.query('SET LOCAL ROLE thaara_worker;');
        await expect(
          client.query(`SELECT public.create_workspace_persona('dummy', 'Test');`)
        ).rejects.toThrow(/permission denied for function create_workspace_persona/);
        await client.query('ROLLBACK;');
      } finally {
        await client.end();
      }
    });

    it('creates workspace persona via appDb with scope-spoofing prevention', async () => {
      if (!isLive || !appDb) return;

      const { rows } = await appDb.query(
        `SELECT public.create_workspace_persona(
           $1, $2, 'en', 'executive', 'concise', ARRAY['ops']::text[], NULL, 'guidance', ARRAY['test.task']::text[], true, 'preset_thaara_v2', 1
         ) AS persona_id;`,
        [tokenHashAdminA, 'Runtime Alpha Persona']
      );
      const personaId = rows[0]?.persona_id;
      expect(personaId).toBeDefined();

      const checkRes = await adminDb!.query(
        `SELECT workspace_id, is_default FROM workspace_personas WHERE id = $1;`,
        [personaId]
      );
      expect(checkRes.rows[0]?.workspace_id).toBe(workspaceAId);
      expect(checkRes.rows[0]?.is_default).toBe(true);
    });

    it('denies persona creation when token is invalid or caller is non-admin', async () => {
      if (!isLive || !appDb) return;

      await expect(
        appDb.query(`SELECT public.create_workspace_persona($1, $2);`, ['bad-hash', 'Test'])
      ).rejects.toThrow(/Authentication failure/);

      await expect(
        appDb.query(`SELECT public.create_workspace_persona($1, $2);`, [tokenHashMemberA, 'Test'])
      ).rejects.toThrow(/admin or owner role required/);
    });

    it('binds plan step policy atomically and constructs policy snapshot strictly from scalar params', async () => {
      if (!isLive || !appDb) return;

      const planRes = await adminDb!.query(
        `INSERT INTO plans (workspace_id, created_by_user_id, title) VALUES ($1, $2, 'Runtime Plan') RETURNING id;`,
        [workspaceAId, userAAdminId]
      );
      const planId = planRes.rows[0]?.id;

      const stepRes = await adminDb!.query(
        `INSERT INTO plan_steps (workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode, parameters, parameter_hash)
         VALUES ($1, $2, 0, 'runtime.step', 'write', 'medium', 'explicit', '{}'::jsonb, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
         RETURNING id;`,
        [workspaceAId, planId]
      );
      const stepId = stepRes.rows[0]?.id;

      const dummyHash = 'b'.repeat(64);
      const { rows: bindRes } = await appDb.query(
        `SELECT public.bind_plan_step_policy_atomic(
           $1, $2, $3, NULL, 'preset_thaara_v2', 1,
           '1.0.0', 'runtime.step.v1', 'runtime.step', 'write', 'medium', 'explicit', 'admin',
           true, true, 45000, $4, $4, $4, 'base.v1', 0
         ) AS binding_id;`,
        [tokenHashAdminA, planId, stepId, dummyHash]
      );
      const bindingId = bindRes[0]?.binding_id;
      expect(bindingId).toBeDefined();

      const check = await adminDb!.query(
        `SELECT policy_snapshot FROM plan_step_policy_bindings WHERE id = $1;`,
        [bindingId]
      );
      expect(check.rows[0]?.policy_snapshot?.actionName).toBe('runtime.step');
      expect(check.rows[0]?.policy_snapshot?.timeoutMs).toBe(45000);
    });

    it('strictly isolates tenant personas under RLS via thaara_app', async () => {
      if (!isLive || !appDb) return;

      await appDb.query(
        `SELECT pg_catalog.set_config('app.workspace_id', '${workspaceAId}', false);`
      );
      const { rows: rowsA } = await appDb.query(`SELECT id FROM workspace_personas;`);

      await appDb.query(
        `SELECT pg_catalog.set_config('app.workspace_id', '${workspaceBId}', false);`
      );
      const { rows: rowsB } = await appDb.query(`SELECT id FROM workspace_personas;`);

      await appDb.query(`SELECT pg_catalog.set_config('app.workspace_id', '', false);`);

      const setA = new Set(rowsA.map((r) => r.id));
      for (const b of rowsB) {
        expect(setA.has(b.id)).toBe(false);
      }
    });

    it('prohibits UPDATE and DELETE on plan_step_policy_bindings via immutability trigger', async () => {
      if (!isLive || !adminDb) return;

      const { rows } = await adminDb.query(
        `SELECT id FROM plan_step_policy_bindings LIMIT 1;`
      );
      if (rows.length > 0) {
        const id = rows[0]?.id;
        await expect(
          adminDb.query(`UPDATE plan_step_policy_bindings SET action_name = 'x' WHERE id = $1;`, [id])
        ).rejects.toThrow(/Immutable relation violation/);
        await expect(
          adminDb.query(`DELETE FROM plan_step_policy_bindings WHERE id = $1;`, [id])
        ).rejects.toThrow(/Immutable relation violation/);
      }
    });

    it('blocks direct workspace deletion when governed records exist (ON DELETE RESTRICT)', async () => {
      if (!isLive || !adminDb) return;

      await expect(
        adminDb.query(`DELETE FROM workspaces WHERE id = $1;`, [workspaceAId])
      ).rejects.toThrow(/foreign key constraint/);
    });
  });
});
