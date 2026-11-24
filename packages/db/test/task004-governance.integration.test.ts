import { describe, it, expect, beforeAll } from 'vitest';
import { PGliteDatabase } from '../src/pglite.js';
import { Migrator } from '../src/migrator.js';
import { WorkspaceRepository } from '../src/repositories/workspaces.js';
import { UserRepository } from '../src/repositories/users.js';
import { SessionRepository, hashSessionToken } from '../src/repositories/sessions.js';
import { AuthenticatedScope } from '../src/client.js';

describe('Task 004 Phase B — Governed Capabilities & Personas (Integration)', () => {
  let db: PGliteDatabase;
  let migrator: Migrator;

  let workspaceAId: string;
  let workspaceBId: string;
  let userAAdminId: string;
  let userAMemberId: string;
  let userBAdminId: string;

  const rawTokenAdminA = 'raw-token-admin-a';
  const rawTokenMemberA = 'raw-token-member-a';
  const rawTokenAdminB = 'raw-token-admin-b';

  let tokenHashAdminA: string;
  let tokenHashMemberA: string;
  let tokenHashAdminB: string;

  let scopeAdminA: AuthenticatedScope;
  let scopeAdminB: AuthenticatedScope;

  beforeAll(async () => {
    db = new PGliteDatabase();
    migrator = new Migrator(db);

    // Apply all migrations (0001 through 0012)
    const files = migrator.loadMigrationFiles();
    const result = await migrator.migrate(files);
    expect(result.applied).toContain('0012');

    // Seed test workspaces and users
    const wsRepo = new WorkspaceRepository(db);
    const userRepo = new UserRepository(db);
    const sessionRepo = new SessionRepository(db);

    const wsA = await wsRepo.create('Tenant Alpha');
    const wsB = await wsRepo.create('Tenant Beta');
    workspaceAId = wsA.id;
    workspaceBId = wsB.id;

    const uAAdmin = await userRepo.create('adminA@alpha.com', 'hashA', 'Admin Alpha');
    const uAMember = await userRepo.create('memberA@alpha.com', 'hashM', 'Member Alpha');
    const uBAdmin = await userRepo.create('adminB@beta.com', 'hashB', 'Admin Beta');
    userAAdminId = uAAdmin.id;
    userAMemberId = uAMember.id;
    userBAdminId = uBAdmin.id;

    // Memberships
    await db.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'admin');`, [workspaceAId, userAAdminId]);
    await db.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member');`, [workspaceAId, userAMemberId]);
    await db.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'admin');`, [workspaceBId, userBAdminId]);

    // Sessions
    await sessionRepo.create(userAAdminId, workspaceAId, rawTokenAdminA);
    await sessionRepo.create(userAMemberId, workspaceAId, rawTokenMemberA);
    await sessionRepo.create(userBAdminId, workspaceBId, rawTokenAdminB);

    tokenHashAdminA = hashSessionToken(rawTokenAdminA);
    tokenHashMemberA = hashSessionToken(rawTokenMemberA);
    tokenHashAdminB = hashSessionToken(rawTokenAdminB);

    scopeAdminA = {
      workspaceId: workspaceAId,
      userId: userAAdminId,
      role: 'admin',
      sessionTokenHash: tokenHashAdminA
    };

    scopeAdminB = {
      workspaceId: workspaceBId,
      userId: userBAdminId,
      role: 'admin',
      sessionTokenHash: tokenHashAdminB
    };
  });

  describe('1. Migration Ordering & Idempotent Rerun', () => {
    it('second run of all migrations is an idempotent no-op', async () => {
      const files = migrator.loadMigrationFiles();
      const rerun = await migrator.migrate(files);
      expect(rerun.applied.length).toBe(0);
      expect(rerun.skipped.length).toBe(files.length);
    });

    it('asserts post-migration security state is intact after rerun', async () => {
      const { rows } = await db.query(`
        SELECT n.nspname, pg_catalog.pg_get_userbyid(n.nspowner) as owner
        FROM pg_catalog.pg_namespace n
        WHERE n.nspname = 'platform';
      `);
      expect(rows.length).toBe(1);
      expect(rows[0]?.owner).toBe('thaara_platform_owner');
    });
  });

  describe('2. Managed Role Prerequisites & Fail-Closed Rerun Ownership', () => {
    it('verifies thaara_platform_owner and thaara_definer exist with safe attributes', async () => {
      const { rows } = await db.query(`
        SELECT rolname, rolcanlogin, rolsuper, rolbypassrls
        FROM pg_catalog.pg_roles
        WHERE rolname IN ('thaara_platform_owner', 'thaara_definer')
        ORDER BY rolname ASC;
      `);
      expect(rows.length).toBe(2);
      for (const row of rows) {
        expect(row.rolcanlogin).toBe(false);
        expect(row.rolsuper).toBe(false);
        expect(row.rolbypassrls).toBe(false);
      }
    });

    it('fails closed when platform schema is owned by an unauthorized role', async () => {
      const isolatedDb = new PGliteDatabase();
      const isolatedMigrator = new Migrator(isolatedDb);
      const files = isolatedMigrator.loadMigrationFiles();
      // Apply up to 0011
      const preFiles = files.filter(f => f.version !== '0012');
      await isolatedMigrator.migrate(preFiles);

      // Create unauthorized third-party role and schema platform owned by it
      await isolatedDb.exec(`
        CREATE ROLE unauthorized_attacker WITH NOLOGIN NOSUPERUSER NOBYPASSRLS;
        CREATE SCHEMA platform;
        ALTER SCHEMA platform OWNER TO unauthorized_attacker;
      `);

      const file0012 = files.filter(f => f.version === '0012');
      await expect(isolatedMigrator.migrate(file0012)).rejects.toThrow(/Schema platform is owned by unauthorized role/);
    });

    it('fails closed when platform.preset_catalog is owned by an unauthorized role', async () => {
      const isolatedDb = new PGliteDatabase();
      const isolatedMigrator = new Migrator(isolatedDb);
      const files = isolatedMigrator.loadMigrationFiles();
      const preFiles = files.filter(f => f.version !== '0012');
      await isolatedMigrator.migrate(preFiles);

      // Create unauthorized role and preset_catalog owned by it
      await isolatedDb.exec(`
        CREATE ROLE unauthorized_attacker2 WITH NOLOGIN NOSUPERUSER NOBYPASSRLS;
        CREATE SCHEMA platform;
        CREATE TABLE platform.preset_catalog (id text primary key);
        ALTER TABLE platform.preset_catalog OWNER TO unauthorized_attacker2;
      `);

      const file0012 = files.filter(f => f.version === '0012');
      await expect(isolatedMigrator.migrate(file0012)).rejects.toThrow(/Table platform.preset_catalog is owned by unauthorized role/);
    });
  });

  describe('3. Platform Ownership & Zero Runtime Table Privileges', () => {
    it('seeds Thaara V2 default preset', async () => {
      const { rows } = await db.query(`
        SELECT preset_id, preset_version, name, language, tone, working_style, is_active
        FROM platform.preset_catalog
        WHERE preset_id = 'preset_thaara_v2';
      `);
      expect(rows.length).toBe(1);
      expect(rows[0]?.preset_id).toBe('preset_thaara_v2');
      expect(rows[0]?.preset_version).toBe(1);
      expect(rows[0]?.name).toBe('Thaara');
      expect(rows[0]?.is_active).toBe(true);
    });

    it('proves platform.preset_catalog is owned by thaara_platform_owner', async () => {
      const { rows } = await db.query(`
        SELECT c.relname, pg_catalog.pg_get_userbyid(c.relowner) AS owner
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'platform' AND c.relname = 'preset_catalog';
      `);
      expect(rows.length).toBe(1);
      expect(rows[0]?.owner).toBe('thaara_platform_owner');
    });

    it('asserts runtime roles hold zero table privileges on platform.preset_catalog', async () => {
      const roles = ['thaara_app', 'thaara_worker', 'thaara_definer'];
      const privs = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES', 'TRIGGER', 'TRUNCATE'];

      for (const role of roles) {
        for (const priv of privs) {
          const { rows } = await db.query(
            `SELECT pg_catalog.has_table_privilege($1, 'platform.preset_catalog', $2) AS has_priv;`,
            [role, priv]
          );
          expect(rows[0]?.has_priv).toBe(false);
        }
      }
    });

    it('denies direct SELECT on platform.preset_catalog when executing as thaara_app', async () => {
      await db.exec('SET ROLE thaara_app;');
      try {
        await expect(db.query('SELECT * FROM platform.preset_catalog;')).rejects.toThrow(/permission denied/);
      } finally {
        await db.exec('RESET ROLE;');
      }
    });

    it('rejects UPDATE and DELETE on platform.preset_catalog via immutability trigger', async () => {
      await expect(
        db.query("UPDATE platform.preset_catalog SET name = 'Tampered' WHERE preset_id = 'preset_thaara_v2';")
      ).rejects.toThrow(/Immutable relation violation/);

      await expect(
        db.query("DELETE FROM platform.preset_catalog WHERE preset_id = 'preset_thaara_v2';")
      ).rejects.toThrow(/Immutable relation violation/);
    });
  });

  describe('4. Trigger Function Privileges (Zero Direct Grants)', () => {
    it('verifies trigger functions are SECURITY INVOKER with PUBLIC execute revoked', async () => {
      const { rows } = await db.query(`
        SELECT p.proname, p.prosecdef,
               pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('reject_mutation_on_immutable_table', 'guard_plan_governance_version');
      `);
      expect(rows.length).toBe(2);
      for (const row of rows) {
        expect(row.prosecdef).toBe(false); // SECURITY INVOKER
        expect(row.public_exec).toBe(false); // PUBLIC revoked
      }
    });

    it('asserts zero direct EXECUTE grants on trigger functions for runtime roles', async () => {
      const roles = ['thaara_app', 'thaara_worker', 'thaara_definer'];
      const funcs = ['reject_mutation_on_immutable_table()', 'guard_plan_governance_version()'];

      for (const role of roles) {
        for (const func of funcs) {
          const { rows } = await db.query(
            `SELECT pg_catalog.has_function_privilege($1, $2, 'EXECUTE') AS has_exec;`,
            [role, `public.${func}`]
          );
          expect(rows[0]?.has_exec).toBe(false);
        }
      }
    });

    it('denies direct function invocation by thaara_app', async () => {
      await db.exec('SET ROLE thaara_app;');
      try {
        await expect(db.query('SELECT public.reject_mutation_on_immutable_table();')).rejects.toThrow(/permission denied/);
        await expect(db.query('SELECT public.guard_plan_governance_version();')).rejects.toThrow(/permission denied/);
      } finally {
        await db.exec('RESET ROLE;');
      }
    });
  });

  describe('5. Governance Version Backfill, Defaults, and Trigger Guard', () => {
    it('backfills pre-existing plans to governance_version 1', async () => {
      const isolatedDb = new PGliteDatabase();
      const isolatedMigrator = new Migrator(isolatedDb);
      const files = isolatedMigrator.loadMigrationFiles();

      // Apply migrations 0001 through 0011 (pre-Task 004)
      const preFiles = files.filter(f => f.version !== '0012');
      await isolatedMigrator.migrate(preFiles);

      // Create pre-migration workspace, user, and legacy plan
      const wsRes = await isolatedDb.query(`INSERT INTO workspaces (name) VALUES ('Legacy WS') RETURNING id;`);
      const legacyWsId = wsRes.rows[0]?.id;
      const uRes = await isolatedDb.query(`INSERT INTO users (email, password_hash, display_name) VALUES ('legacy@test.com', 'h', 'Legacy User') RETURNING id;`);
      const legacyUId = uRes.rows[0]?.id;

      const planRes = await isolatedDb.query(
        `INSERT INTO plans (workspace_id, created_by_user_id, title) VALUES ($1, $2, 'Pre-Migration Plan') RETURNING id;`,
        [legacyWsId, legacyUId]
      );
      const prePlanId = planRes.rows[0]?.id;

      // Now apply migration 0012
      const file0012 = files.filter(f => f.version === '0012');
      await isolatedMigrator.migrate(file0012);

      // Assert pre-migration plan was backfilled to governance_version = 1
      const { rows } = await isolatedDb.query(`SELECT governance_version FROM plans WHERE id = $1;`, [prePlanId]);
      expect(rows[0]?.governance_version).toBe(1);

      // Assert new plan defaults to governance_version = 2
      const newPlanRes = await isolatedDb.query(
        `INSERT INTO plans (workspace_id, created_by_user_id, title) VALUES ($1, $2, 'Post-Migration Plan') RETURNING id, governance_version;`,
        [legacyWsId, legacyUId]
      );
      expect(newPlanRes.rows[0]?.governance_version).toBe(2);
    });

    it('rejects INSERT of plan with explicit governance_version = 1 after migration', async () => {
      await expect(
        db.query(
          `INSERT INTO plans (workspace_id, created_by_user_id, title, governance_version)
           VALUES ($1, $2, 'Forbidden Legacy Plan', 1);`,
          [workspaceAId, userAAdminId]
        )
      ).rejects.toThrow(/Legacy governance_version 1 is prohibited/);
    });

    it('rejects UPDATE attempting to modify or downgrade governance_version', async () => {
      const { rows } = await db.query(
        `INSERT INTO plans (workspace_id, created_by_user_id, title)
         VALUES ($1, $2, 'Governed Plan') RETURNING id, governance_version;`,
        [workspaceAId, userAAdminId]
      );
      const planId = rows[0]?.id;
      expect(rows[0]?.governance_version).toBe(2);

      // Attempt to downgrade to 1 (increment version so optimistic concurrency check passes)
      await expect(
        db.query(`UPDATE plans SET governance_version = 1, version = version + 1 WHERE id = $1;`, [planId])
      ).rejects.toThrow(/Immutable field violation: governance_version cannot be modified or downgraded/);
    });
  });

  describe('6. Fail-Closed SECURITY DEFINER Stored Procedures', () => {
    it('verifies all 9 procedures are SECURITY DEFINER owned by thaara_definer', async () => {
      const { rows } = await db.query(`
        SELECT p.proname, p.prosecdef, pg_catalog.pg_get_userbyid(p.proowner) AS owner
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
            'create_workspace_persona',
            'update_workspace_persona',
            'archive_workspace_persona',
            'set_default_workspace_persona',
            'grant_workspace_capability',
            'revoke_workspace_capability',
            'set_workspace_policy_override',
            'bind_conversation_persona_atomic',
            'bind_plan_step_policy_atomic'
          );
      `);
      expect(rows.length).toBe(9);
      for (const row of rows) {
        expect(row.prosecdef).toBe(true);
        expect(row.owner).toBe('thaara_definer');
      }
    });

    it('denies procedure execution when token is invalid or expired', async () => {
      await expect(
        db.query(`SELECT public.create_workspace_persona($1, $2);`, ['invalid-hash', 'Test Persona'])
      ).rejects.toThrow(/Authentication failure/);
    });

    it('denies persona creation by non-admin member', async () => {
      await expect(
        db.query(`SELECT public.create_workspace_persona($1, $2);`, [tokenHashMemberA, 'Member Persona'])
      ).rejects.toThrow(/admin or owner role required/);
    });

    it('overwrites caller GUCs and creates persona in token-bound workspace (scope spoofing prevention)', async () => {
      // Caller deliberately spoofs app.workspace_id to Workspace B while presenting token for Workspace A
      await db.exec(`SELECT pg_catalog.set_config('app.workspace_id', '${workspaceBId}', true);`);

      const { rows } = await db.query(
        `SELECT public.create_workspace_persona($1, $2, 'en', 'executive', 'concise', ARRAY['strategy']::text[], NULL, 'guidance', ARRAY['test.sample_task']::text[], true, 'preset_thaara_v2', 1) AS persona_id;`,
        [tokenHashAdminA, 'Executive Alpha']
      );
      const personaId = rows[0]?.persona_id;
      expect(personaId).toBeDefined();

      // Check persona was created in Workspace A (not spoofed Workspace B)
      const checkRes = await db.query(`SELECT workspace_id, is_default FROM workspace_personas WHERE id = $1;`, [personaId]);
      expect(checkRes.rows[0]?.workspace_id).toBe(workspaceAId);
      expect(checkRes.rows[0]?.is_default).toBe(true);
    });

    it('updates workspace persona with monotonic entitlement versioning', async () => {
      const { rows: createRes } = await db.query(
        `SELECT public.create_workspace_persona($1, $2, 'en', 'executive', 'concise', '{}'::text[], NULL, '', ARRAY['cap.one']::text[], false) AS persona_id;`,
        [tokenHashAdminA, 'Updatable Persona']
      );
      const personaId = createRes[0]?.persona_id;

      // Update cosmetic only (capabilities unchanged)
      await db.query(
        `SELECT public.update_workspace_persona($1, $2, 'Renamed Persona', 'en', 'friendly', 'detailed', '{}'::text[], NULL, 'new guidance', ARRAY['cap.one']::text[]);`,
        [tokenHashAdminA, personaId]
      );

      const res1 = await db.query(`SELECT cosmetic_version, entitlement_version, name FROM workspace_personas WHERE id = $1;`, [personaId]);
      expect(res1.rows[0]?.name).toBe('Renamed Persona');
      expect(res1.rows[0]?.cosmetic_version).toBe(2);
      expect(res1.rows[0]?.entitlement_version).toBe(1); // Unchanged!

      // Update capabilities (entitlement change)
      await db.query(
        `SELECT public.update_workspace_persona($1, $2, 'Renamed Persona', 'en', 'friendly', 'detailed', '{}'::text[], NULL, 'new guidance', ARRAY['cap.one', 'cap.two']::text[]);`,
        [tokenHashAdminA, personaId]
      );

      const res2 = await db.query(`SELECT cosmetic_version, entitlement_version FROM workspace_personas WHERE id = $1;`, [personaId]);
      expect(res2.rows[0]?.cosmetic_version).toBe(3);
      expect(res2.rows[0]?.entitlement_version).toBe(2); // Bumped!
    });

    it('enforces exactly one default persona via set_default_workspace_persona', async () => {
      const { rows: p1 } = await db.query(
        `SELECT public.create_workspace_persona($1, 'Persona 1', 'en', 'executive', 'concise', '{}'::text[], NULL, '', '{}'::text[], true) AS id;`,
        [tokenHashAdminB]
      );
      const { rows: p2 } = await db.query(
        `SELECT public.create_workspace_persona($1, 'Persona 2', 'en', 'executive', 'concise', '{}'::text[], NULL, '', '{}'::text[], false) AS id;`,
        [tokenHashAdminB]
      );

      // Now switch default to Persona 2
      await db.query(`SELECT public.set_default_workspace_persona($1, $2);`, [tokenHashAdminB, p2[0]?.id]);

      const { rows: activeDefaults } = await db.query(
        `SELECT id FROM workspace_personas WHERE workspace_id = $1 AND is_default = true AND lifecycle_status = 'active';`,
        [workspaceBId]
      );
      expect(activeDefaults.length).toBe(1);
      expect(activeDefaults[0]?.id).toBe(p2[0]?.id);
    });

    it('prohibits archiving the default persona', async () => {
      const { rows } = await db.query(
        `SELECT id FROM workspace_personas WHERE workspace_id = $1 AND is_default = true AND lifecycle_status = 'active';`,
        [workspaceBId]
      );
      const defaultId = rows[0]?.id;

      await expect(
        db.query(`SELECT public.archive_workspace_persona($1, $2);`, [tokenHashAdminB, defaultId])
      ).rejects.toThrow(/Cannot archive default persona/);
    });

    it('grants and revokes workspace capabilities with version increments', async () => {
      const { rows: grantRes } = await db.query(
        `SELECT public.grant_workspace_capability($1, 'test.capability') AS grant_id;`,
        [tokenHashAdminA]
      );
      const grantId = grantRes[0]?.grant_id;
      expect(grantId).toBeDefined();

      const { rows: checkGrant } = await db.query(`SELECT enabled, version FROM workspace_capability_grants WHERE id = $1;`, [grantId]);
      expect(checkGrant[0]?.enabled).toBe(true);
      expect(checkGrant[0]?.version).toBe(1);

      // Revoke
      await db.query(`SELECT public.revoke_workspace_capability($1, 'test.capability');`, [tokenHashAdminA]);
      const { rows: checkRevoke } = await db.query(`SELECT enabled, version FROM workspace_capability_grants WHERE id = $1;`, [grantId]);
      expect(checkRevoke[0]?.enabled).toBe(false);
      expect(checkRevoke[0]?.version).toBe(2);
    });

    it('sets workspace policy overrides', async () => {
      const { rows } = await db.query(
        `SELECT public.set_workspace_policy_override($1, 'test.capability', 'high', 'explicit', 'admin', true, true, 3600) AS override_id;`,
        [tokenHashAdminA]
      );
      const overrideId = rows[0]?.override_id;
      expect(overrideId).toBeDefined();

      const { rows: checkOverride } = await db.query(
        `SELECT override_risk_level, override_approval_mode, override_required_role, override_ttl_seconds
         FROM workspace_policy_overrides WHERE id = $1;`,
        [overrideId]
      );
      expect(checkOverride[0]?.override_risk_level).toBe('high');
      expect(checkOverride[0]?.override_approval_mode).toBe('explicit');
      expect(checkOverride[0]?.override_required_role).toBe('admin');
      expect(checkOverride[0]?.override_ttl_seconds).toBe(3600);
    });

    it('binds conversation persona atomically and enforces tenant boundary', async () => {
      // Create conversation in Workspace A
      const { rows: convRes } = await db.query(
        `INSERT INTO conversations (workspace_id, user_id, title) VALUES ($1, $2, 'Conv Alpha') RETURNING id;`,
        [workspaceAId, userAAdminId]
      );
      const convAId = convRes[0]?.id;

      // Bind to preset
      const { rows: bindRes } = await db.query(
        `SELECT public.bind_conversation_persona_atomic($1, $2, NULL, 'preset_thaara_v2', 1) AS binding_id;`,
        [tokenHashAdminA, convAId]
      );
      expect(bindRes[0]?.binding_id).toBeDefined();

      // Workspace B admin attempting to bind Workspace A conversation fails closed
      await expect(
        db.query(
          `SELECT public.bind_conversation_persona_atomic($1, $2, NULL, 'preset_thaara_v2', 1);`,
          [tokenHashAdminB, convAId]
        )
      ).rejects.toThrow(/not found in workspace/);
    });

    it('binds plan step policy atomically with trusted scalar policy snapshot', async () => {
      const { rows: planRes } = await db.query(
        `INSERT INTO plans (workspace_id, created_by_user_id, title) VALUES ($1, $2, 'Governed Plan for Step') RETURNING id;`,
        [workspaceAId, userAAdminId]
      );
      const planId = planRes[0]?.id;

      const { rows: stepRes } = await db.query(
        `INSERT INTO plan_steps (workspace_id, plan_id, step_index, action_name, action_class, risk_level, approval_mode, parameters, parameter_hash)
         VALUES ($1, $2, 0, 'test.step_action', 'write', 'medium', 'explicit', '{}'::jsonb, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
         RETURNING id;`,
        [workspaceAId, planId]
      );
      const stepId = stepRes[0]?.id;

      const dummyHash = 'a'.repeat(64);
      const { rows: bindRes } = await db.query(
        `SELECT public.bind_plan_step_policy_atomic(
           $1, $2, $3, NULL, 'preset_thaara_v2', 1,
           '1.0.0', 'test.step_action.v1', 'test.step_action', 'write', 'medium', 'explicit', 'admin',
           true, true, 30000, $4, $4, $4, 'base.v1', 0
         ) AS binding_id;`,
        [tokenHashAdminA, planId, stepId, dummyHash]
      );
      const bindingId = bindRes[0]?.binding_id;
      expect(bindingId).toBeDefined();

      const { rows: checkBind } = await db.query(
        `SELECT policy_snapshot, action_name, risk_level FROM plan_step_policy_bindings WHERE id = $1;`,
        [bindingId]
      );
      expect(checkBind[0]?.action_name).toBe('test.step_action');
      expect(checkBind[0]?.risk_level).toBe('medium');
      expect(checkBind[0]?.policy_snapshot?.actionName).toBe('test.step_action');
      expect(checkBind[0]?.policy_snapshot?.timeoutMs).toBe(30000);
      expect(checkBind[0]?.policy_snapshot?.schemaIdentifier).toBe('test.step_action.v1');
    });
  });

  describe('7. Row Level Security & Tenant Isolation', () => {
    it('strictly isolates personas between tenants under RLS', async () => {
      // Must switch to non-superuser thaara_app role to enforce RLS
      await db.exec('SET ROLE thaara_app;');
      try {
        // Query as Workspace A
        await db.query(`SELECT pg_catalog.set_config('app.workspace_id', '${workspaceAId}', false);`);
        const { rows: rowsA } = await db.query(`SELECT id, name FROM workspace_personas;`);
        expect(rowsA.length).toBeGreaterThan(0);

        // Query as Workspace B
        await db.query(`SELECT pg_catalog.set_config('app.workspace_id', '${workspaceBId}', false);`);
        const { rows: rowsB } = await db.query(`SELECT id, name FROM workspace_personas;`);
        expect(rowsB.length).toBeGreaterThan(0);

        // Verify no overlap
        const idsA = new Set(rowsA.map(r => r.id));
        for (const b of rowsB) {
          expect(idsA.has(b.id)).toBe(false);
        }
      } finally {
        await db.query(`SELECT pg_catalog.set_config('app.workspace_id', '', false);`);
        await db.exec('RESET ROLE;');
      }
    });

    it('rejects foreign key referencing persona from another workspace (composite FK)', async () => {
      // Get persona from Workspace B
      const { rows: pB } = await db.query(`SELECT id FROM workspace_personas WHERE workspace_id = $1 LIMIT 1;`, [workspaceBId]);
      const personaBId = pB[0]?.id;
      expect(personaBId).toBeDefined();

      // Create conversation in Workspace A
      const { rows: convRes } = await db.query(
        `INSERT INTO conversations (workspace_id, user_id, title) VALUES ($1, $2, 'Conv FK Test') RETURNING id;`,
        [workspaceAId, userAAdminId]
      );
      const convAId = convRes[0]?.id;

      // Attempt to bind Workspace A conversation to Workspace B persona
      await expect(
        db.query(
          `INSERT INTO conversation_persona_bindings (workspace_id, conversation_id, workspace_persona_id, bound_by_user_id)
           VALUES ($1, $2, $3, $4);`,
          [workspaceAId, convAId, personaBId, userAAdminId]
        )
      ).rejects.toThrow(/foreign key constraint/);
    });
  });

  describe('8. Immutable Bindings & Workspace Deletion Protection', () => {
    it('prohibits UPDATE and DELETE on plan_step_policy_bindings via immutability trigger', async () => {
      const { rows } = await db.query(`SELECT id FROM plan_step_policy_bindings LIMIT 1;`);
      const bindingId = rows[0]?.id;
      expect(bindingId).toBeDefined();

      await expect(
        db.query(`UPDATE plan_step_policy_bindings SET action_name = 'tampered' WHERE id = $1;`, [bindingId])
      ).rejects.toThrow(/Immutable relation violation/);

      await expect(
        db.query(`DELETE FROM plan_step_policy_bindings WHERE id = $1;`, [bindingId])
      ).rejects.toThrow(/Immutable relation violation/);
    });

    it('prohibits UPDATE and DELETE on conversation_persona_bindings via immutability trigger', async () => {
      const { rows } = await db.query(`SELECT id FROM conversation_persona_bindings LIMIT 1;`);
      const bindingId = rows[0]?.id;
      expect(bindingId).toBeDefined();

      await expect(
        db.query(`UPDATE conversation_persona_bindings SET platform_preset_version = 2 WHERE id = $1;`, [bindingId])
      ).rejects.toThrow(/Immutable relation violation/);

      await expect(
        db.query(`DELETE FROM conversation_persona_bindings WHERE id = $1;`, [bindingId])
      ).rejects.toThrow(/Immutable relation violation/);
    });

    it('blocks direct workspace deletion when governed records exist (ON DELETE RESTRICT)', async () => {
      await expect(
        db.query(`DELETE FROM workspaces WHERE id = $1;`, [workspaceAId])
      ).rejects.toThrow(/foreign key constraint/);
    });
  });

  describe('9. Public Schema Hardening Regression & Runtime Role CREATE Denial', () => {
    it('verifies CREATE on schema public is revoked from PUBLIC, thaara_app, thaara_worker, thaara_definer', async () => {
      const publicPriv = await db.query(`SELECT pg_catalog.has_schema_privilege('public', 'public', 'CREATE') AS has_priv;`);
      expect(publicPriv.rows[0]?.has_priv).toBe(false);

      for (const role of ['thaara_app', 'thaara_worker', 'thaara_definer']) {
        const rolePriv = await db.query(`SELECT pg_catalog.has_schema_privilege($1, 'public', 'CREATE') AS has_priv;`, [role]);
        expect(rolePriv.rows[0]?.has_priv).toBe(false);
      }
    });

    it('proves thaara_definer cannot CREATE TABLE in public', async () => {
      await db.query('BEGIN;');
      try {
        await db.query('SET LOCAL ROLE thaara_definer;');
        await expect(
          db.query('CREATE TABLE public.regress_definer_test (id INT);')
        ).rejects.toThrow(/permission denied for schema public/);
      } finally {
        await db.query('ROLLBACK;');
      }
    });

    it('proves thaara_app cannot CREATE TABLE in public', async () => {
      await db.query('BEGIN;');
      try {
        await db.query('SET LOCAL ROLE thaara_app;');
        await expect(
          db.query('CREATE TABLE public.regress_app_test (id INT);')
        ).rejects.toThrow(/permission denied for schema public/);
      } finally {
        await db.query('ROLLBACK;');
      }
    });

    it('proves thaara_worker cannot CREATE TABLE in public', async () => {
      await db.query('BEGIN;');
      try {
        await db.query('SET LOCAL ROLE thaara_worker;');
        await expect(
          db.query('CREATE TABLE public.regress_worker_test (id INT);')
        ).rejects.toThrow(/permission denied for schema public/);
      } finally {
        await db.query('ROLLBACK;');
      }
    });

    it('asserts all 9 procedures remain owned by thaara_definer with EXECUTE granted to thaara_app and revoked from PUBLIC and worker', async () => {
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
        const { rows } = await db.query(`
          SELECT p.prosecdef, pg_catalog.pg_get_userbyid(p.proowner) AS owner,
                 pg_catalog.has_function_privilege('thaara_app', p.oid, 'EXECUTE') AS app_exec,
                 pg_catalog.has_function_privilege('thaara_worker', p.oid, 'EXECUTE') AS worker_exec,
                 pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = $1;
        `, [name]);

        expect(rows[0]?.prosecdef).toBe(true);
        expect(rows[0]?.owner).toBe('thaara_definer');
        expect(rows[0]?.app_exec).toBe(true);
        expect(rows[0]?.worker_exec).toBe(false);
        expect(rows[0]?.public_exec).toBe(false);
      }
    });
  });
});
