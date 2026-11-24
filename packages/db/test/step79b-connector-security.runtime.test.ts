import { getIsolatedRuntimeConfig, isolatedRoleUrl } from '../../../scripts/step74-runtime-guard.mjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PostgresDatabase, AuthenticatedScope } from '../src/client.js';
import { Migrator } from '../src/migrator.js';
import { WorkspaceRepository } from '../src/repositories/workspaces.js';
import { UserRepository } from '../src/repositories/users.js';
import { hashSessionToken } from '../src/repositories/sessions.js';
import { defaultPolicyGateway } from '../../policy/src/index.js';
import {
  ConnectorEnvelopeCipher,
  ConnectorKeyService,
  ConnectorKind,
  ConnectorRecord,
  ConnectorStateStore,
  ConnectorAudit,
  ConnectorBinding
} from '../../../apps/api/src/services/connector-security.js';
import {
  ConnectorKeyRotationPreparation,
  ConnectorKeyVersion,
  VersionedConnectorKeyService
} from '../../../apps/api/src/services/connector-key-rotation.js';
import {
  DurableN8nSecurityPrototype,
  PostgresConnectorStateStore
} from '../../../apps/api/src/services/durable-n8n-security.js';

const { Client } = pg;
const isolated = getIsolatedRuntimeConfig();

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const forwardSqlPath = path.join(repoRoot, 'docs/migrations/079a-connector-security.review.sql');
const rollbackSqlPath = path.join(repoRoot, 'docs/migrations/079a-connector-security.rollback.review.sql');

class MockVersionedKms implements VersionedConnectorKeyService {
  readonly mode = 'mock' as const;
  readonly versions = new Map<string, ConnectorKeyVersion>([
    ['kms-mock-v1', { keyId: 'kms-mock-v1', generation: 1, state: 'encrypt_decrypt' }],
    ['kms-mock-v2', { keyId: 'kms-mock-v2', generation: 2, state: 'encrypt_decrypt' }]
  ]);
  readonly keyMaterial = new Map<string, Buffer>([
    ['kms-mock-v1', crypto.randomBytes(32)],
    ['kms-mock-v2', crypto.randomBytes(32)]
  ]);
  activeKeyId = 'kms-mock-v1';

  private deriveWrapKey(keyId: string): Buffer {
    const raw = this.keyMaterial.get(keyId);
    if (!raw) throw new Error('Unknown mock KMS key');
    return raw;
  }

  async wrap(key: Buffer, context: string): Promise<{ keyId: string; wrappedKey: string }> {
    return this.wrapForVersion(key, context, this.activeKeyId);
  }

  async wrapForVersion(key: Buffer, context: string, keyId: string): Promise<{ keyId: string; wrappedKey: string }> {
    const meta = this.versions.get(keyId);
    if (!meta || meta.state !== 'encrypt_decrypt') {
      throw new Error('Mock KMS key version not enabled for encryption');
    }
    const kek = this.deriveWrapKey(keyId);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
    cipher.setAAD(Buffer.from(JSON.stringify([context, keyId]), 'utf8'));
    const encrypted = Buffer.concat([cipher.update(key), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      keyId,
      wrappedKey: Buffer.concat([iv, tag, encrypted]).toString('base64url')
    };
  }

  async unwrap(input: { keyId: string; wrappedKey: string }, context: string): Promise<Buffer> {
    const meta = this.versions.get(input.keyId);
    if (!meta || meta.state === 'disabled') {
      throw new Error('Mock KMS key version disabled');
    }
    const kek = this.deriveWrapKey(input.keyId);
    const raw = Buffer.from(input.wrappedKey, 'base64url');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', kek, iv);
    decipher.setAAD(Buffer.from(JSON.stringify([context, input.keyId]), 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  async activeVersion(_binding: ConnectorBinding): Promise<ConnectorKeyVersion> {
    return { ...this.versions.get(this.activeKeyId)! };
  }

  async describeVersion(_binding: ConnectorBinding, keyId: string): Promise<ConnectorKeyVersion> {
    const found = this.versions.get(keyId);
    if (!found) throw new Error('Missing key version');
    return { ...found };
  }
}

describe('Step 79B — Isolated PostgreSQL Validation for Step 79A Connector Security SQL', () => {
  const migrationDbUrl = isolated.migrationUrl;
  const appDbUrl = isolated.appUrl;
  const workerDbUrl = isolated.workerUrl;

  let adminDb: PostgresDatabase;
  let appDb: PostgresDatabase;
  let workerDb: PostgresDatabase;
  let adminUserDb: PostgresDatabase;
  let unprivilegedDb: PostgresDatabase;

  let workspaceAId: string;
  let workspaceBId: string;
  let ownerAId: string;
  let memberAId: string;
  let viewerAId: string;
  let ownerBId: string;

  let scopeOwnerA: AuthenticatedScope;
  let scopeMemberA: AuthenticatedScope;
  let scopeViewerA: AuthenticatedScope;
  let scopeOwnerB: AuthenticatedScope;

  const profileAId = 'n8n-primary-a';
  const profileAFingerprint = crypto.createHash('sha256').update('profile-a-v1').digest('hex');
  const profileBId = 'n8n-primary-b';
  const profileBFingerprint = crypto.createHash('sha256').update('profile-b-v1').digest('hex');

  async function resetStep79aObjectsIfPresent(db: PostgresDatabase) {
    await db.query(`
      DO $$
      BEGIN
        IF pg_catalog.current_database() <> 'thaara_step74_test' THEN
          RAISE EXCEPTION 'Refusing Step 79B cleanup outside thaara_step74_test';
        END IF;
        DROP FUNCTION IF EXISTS public.commit_workspace_connector_connection(text, bigint, text, text, text, jsonb);
        DROP FUNCTION IF EXISTS public.read_workspace_connector_connection(text);
        DROP FUNCTION IF EXISTS public.connector_locked_admin_scope();
        DROP TABLE IF EXISTS public.workspace_connector_connections;
        DROP TABLE IF EXISTS public.workspace_connector_profiles;
        DROP FUNCTION IF EXISTS public.connector_credential_envelope_valid(jsonb);
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_connector_guard') THEN
          REVOKE ALL ON TABLE public.sessions, public.memberships, public.audit_events FROM thaara_connector_guard;
          REVOKE ALL ON FUNCTION public.current_authenticated_scope() FROM thaara_connector_guard;
          REVOKE ALL ON SCHEMA public FROM thaara_connector_guard;
          DROP ROLE thaara_connector_guard;
        END IF;
      END $$;
    `);
  }

  async function executeApprovedSqlFile(sqlPath: string, approvalSetting: string, targetDatabase: string) {
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const client = new Client({ connectionString: migrationDbUrl });
    await client.connect();
    try {
      await client.query('SELECT pg_catalog.set_config($1, $2, false), pg_catalog.set_config($3, $4, false)', [
        approvalSetting,
        'yes',
        'thaara.step79a_target_database',
        targetDatabase
      ]);
      await client.query(sql);
    } finally {
      try {
        await client.query(
          "SELECT pg_catalog.set_config($1, '', false), pg_catalog.set_config('thaara.step79a_target_database', '', false)",
          [approvalSetting]
        );
      } catch {
        // ignore cleanup error on broken connection
      }
      await client.end();
    }
  }

  beforeAll(async () => {
    expect(isolated.databaseName).toBe('thaara_step74_test');
    expect(isolated.databaseName).not.toBe('thaara_v2');
    expect(isolated.host).toBe('127.0.0.1');
    expect(isolated.port).toBe('15432');

    adminDb = new PostgresDatabase(migrationDbUrl);
    appDb = new PostgresDatabase(appDbUrl);
    workerDb = new PostgresDatabase(workerDbUrl);

    const { rows: idRows } = await adminDb.query<{ db: string; usr: string }>(
      'SELECT current_database() AS db, current_user AS usr'
    );
    expect(idRows[0]).toEqual({ db: 'thaara_step74_test', usr: 'postgres' });

    // Ensure baseline migrations 0001..0012 are present and exclude 079a review SQL
    const migrator = new Migrator(adminDb);
    const files = migrator.loadMigrationFiles();
    expect(files.length).toBe(12);
    expect(files.some((f) => f.name.includes('079a'))).toBe(false);
    await migrator.migrate(files);

    // Ensure clean pre-Step79A state in the disposable database before testing fresh forward migration
    await resetStep79aObjectsIfPresent(adminDb);

    // Prepare unprivileged & admin_user connections for role boundary checks
    const testerPw = crypto.randomBytes(16).toString('hex');
    const adminUserPw = process.env.THAARA_DB_ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
    await adminDb.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'unprivileged_tester') THEN
          CREATE ROLE unprivileged_tester WITH LOGIN PASSWORD '${testerPw}' NOINHERIT NOSUPERUSER NOBYPASSRLS;
        ELSE
          ALTER ROLE unprivileged_tester WITH LOGIN PASSWORD '${testerPw}' NOINHERIT NOSUPERUSER NOBYPASSRLS;
        END IF;
      END $$;
      GRANT CONNECT ON DATABASE ${isolated.databaseName} TO unprivileged_tester;
      GRANT USAGE ON SCHEMA public TO unprivileged_tester;
    `);
    unprivilegedDb = new PostgresDatabase(isolatedRoleUrl(isolated, 'unprivileged_tester', testerPw));
    adminUserDb = new PostgresDatabase(isolatedRoleUrl(isolated, 'thaara_admin_user', adminUserPw));

    // Seed two isolated workspaces and users/sessions via appDb
    const wsRepo = new WorkspaceRepository(appDb);
    const userRepo = new UserRepository(appDb);

    const wsA = await wsRepo.create('Step 79B Workspace A');
    const wsB = await wsRepo.create('Step 79B Workspace B');
    workspaceAId = wsA.id;
    workspaceBId = wsB.id;

    const suffix = crypto.randomBytes(6).toString('hex');
    const ownerA = await userRepo.create(`owner-a-${suffix}@step79b.test`, 'hash', 'Owner A');
    const memberA = await userRepo.create(`member-a-${suffix}@step79b.test`, 'hash', 'Member A');
    const viewerA = await userRepo.create(`viewer-a-${suffix}@step79b.test`, 'hash', 'Viewer A');
    const ownerB = await userRepo.create(`owner-b-${suffix}@step79b.test`, 'hash', 'Owner B');

    ownerAId = ownerA.id;
    memberAId = memberA.id;
    viewerAId = viewerA.id;
    ownerBId = ownerB.id;

    const tokOwnerA = hashSessionToken(`tok-owner-a-${suffix}`);
    const tokMemberA = hashSessionToken(`tok-member-a-${suffix}`);
    const tokViewerA = hashSessionToken(`tok-viewer-a-${suffix}`);
    const tokOwnerB = hashSessionToken(`tok-owner-b-${suffix}`);

    await adminDb.query(
      `INSERT INTO public.memberships (id, workspace_id, user_id, role)
       VALUES ($1, $2, $3, 'owner'), ($4, $2, $5, 'member'), ($6, $2, $7, 'viewer'), ($8, $9, $10, 'owner')`,
      [
        crypto.randomUUID(), workspaceAId, ownerAId,
        crypto.randomUUID(), memberAId,
        crypto.randomUUID(), viewerAId,
        crypto.randomUUID(), workspaceBId, ownerBId
      ]
    );

    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    await adminDb.query(
      `INSERT INTO public.sessions (id, user_id, workspace_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5), ($6, $7, $3, $8, $5), ($9, $10, $3, $11, $5), ($12, $13, $14, $15, $5)`,
      [
        crypto.randomUUID(), ownerAId, workspaceAId, tokOwnerA, expiresAt,
        crypto.randomUUID(), memberAId, tokMemberA,
        crypto.randomUUID(), viewerAId, tokViewerA,
        crypto.randomUUID(), ownerBId, workspaceBId, tokOwnerB
      ]
    );

    scopeOwnerA = { workspaceId: workspaceAId, userId: ownerAId, role: 'owner', sessionTokenHash: tokOwnerA };
    scopeMemberA = { workspaceId: workspaceAId, userId: memberAId, role: 'member', sessionTokenHash: tokMemberA };
    scopeViewerA = { workspaceId: workspaceAId, userId: viewerAId, role: 'viewer', sessionTokenHash: tokViewerA };
    scopeOwnerB = { workspaceId: workspaceBId, userId: ownerBId, role: 'owner', sessionTokenHash: tokOwnerB };
  });

  afterAll(async () => {
    await unprivilegedDb?.close();
    await adminUserDb?.close();
    await workerDb?.close();
    await appDb?.close();
    await adminDb?.close();
  });

  it('rejects forward SQL execution without explicit approval GUC or when targeting thaara_v2/production', async () => {
    const sql = fs.readFileSync(forwardSqlPath, 'utf8');

    // 1. No GUC settings at all
    await expect(adminDb.query(sql)).rejects.toThrow(/Review-only SQL: approval and explicit target database are required/);

    // 2. Approved = yes, but target database is thaara_v2
    await expect(
      executeApprovedSqlFile(forwardSqlPath, 'thaara.step79a_review_approved', 'thaara_v2')
    ).rejects.toThrow(/Review-only SQL: approval and explicit target database are required/);

    // 3. Approved = yes, but target database is production
    await expect(
      executeApprovedSqlFile(forwardSqlPath, 'thaara.step79a_review_approved', 'thaara_production')
    ).rejects.toThrow(/Review-only SQL: approval and explicit target database are required/);

    // Confirm no partial objects were created
    const { rows } = await adminDb.query(`
      SELECT
        to_regclass('public.workspace_connector_connections') AS conn_tbl,
        to_regclass('public.workspace_connector_profiles') AS prof_tbl,
        EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'thaara_connector_guard') AS guard_role
    `);
    expect(rows[0]).toEqual({ conn_tbl: null, prof_tbl: null, guard_role: false });
  });

  it('applies 079a-connector-security.review.sql cleanly in the disposable test database and rejects duplicate application', async () => {
    await executeApprovedSqlFile(forwardSqlPath, 'thaara.step79a_review_approved', isolated.databaseName);

    // Rejects duplicate run (never adopts or overwrites)
    await expect(
      executeApprovedSqlFile(forwardSqlPath, 'thaara.step79a_review_approved', isolated.databaseName)
    ).rejects.toThrow(/Connector objects already exist: stop; never adopt or overwrite/);

    // Verify schema_migrations was NOT altered by review-only draft
    const { rows: migRows } = await adminDb.query('SELECT count(*)::int AS cnt FROM public.schema_migrations');
    expect(migRows[0]?.cnt).toBe(12);
  });

  it('enforces RLS (ENABLE + FORCE), least-privilege guard role attributes, and strict table/function ACLs', async () => {
    // 1. Verify RLS + FORCE RLS + comments + owner on both tables
    const { rows: tblRows } = await adminDb.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, r.rolname AS owner_role,
             pg_catalog.obj_description(c.oid, 'pg_class') AS comment_tag
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'public'
        AND c.relname IN ('workspace_connector_profiles', 'workspace_connector_connections')
      ORDER BY c.relname
    `);
    expect(tblRows).toEqual([
      {
        relname: 'workspace_connector_connections',
        relrowsecurity: true,
        relforcerowsecurity: true,
        owner_role: 'thaara_connector_guard',
        comment_tag: 'THAARA_STEP79A_REVIEW_ONLY_V1'
      },
      {
        relname: 'workspace_connector_profiles',
        relrowsecurity: true,
        relforcerowsecurity: true,
        owner_role: 'thaara_connector_guard',
        comment_tag: 'THAARA_STEP79A_REVIEW_ONLY_V1'
      }
    ]);

    // 2. Verify thaara_connector_guard role attributes and absence of members or schema CREATE
    const { rows: roleRows } = await adminDb.query(`
      SELECT rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
             pg_catalog.has_schema_privilege('thaara_connector_guard', 'public', 'CREATE') AS can_create_public,
             EXISTS (
               SELECT 1 FROM pg_catalog.pg_auth_members m
               JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
               WHERE r.rolname = 'thaara_connector_guard'
             ) AS has_members
      FROM pg_catalog.pg_roles
      WHERE rolname = 'thaara_connector_guard'
    `);
    expect(roleRows[0]).toEqual({
      rolcanlogin: false,
      rolinherit: false,
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
      can_create_public: false,
      has_members: false
    });

    // 3. Direct table access is denied to thaara_app, thaara_worker_user, thaara_admin_user, and unprivileged_tester
    for (const db of [appDb, workerDb, adminUserDb, unprivilegedDb]) {
      await expect(db.query('SELECT * FROM public.workspace_connector_connections')).rejects.toThrow(/permission denied/i);
      await expect(db.query('SELECT * FROM public.workspace_connector_profiles')).rejects.toThrow(/permission denied/i);
    }

    // 4. Internal functions are denied to thaara_app, and entry-point functions are denied to worker/admin/unprivileged
    await expect(appDb.query("SELECT public.connector_credential_envelope_valid('{}'::jsonb)")).rejects.toThrow(/permission denied/i);
    await expect(appDb.query('SELECT * FROM public.connector_locked_admin_scope()')).rejects.toThrow(/permission denied/i);

    for (const db of [workerDb, adminUserDb, unprivilegedDb]) {
      await expect(db.query("SELECT * FROM public.read_workspace_connector_connection('n8n')")).rejects.toThrow(/permission denied/i);
      await expect(
        db.query("SELECT public.commit_workspace_connector_connection('n8n', 0, 'disconnect', NULL, NULL, NULL)")
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it('denies member/viewer roles, forged GUC headers without valid session token, and revoked/expired sessions', async () => {
    // Member and viewer in Workspace A are denied
    await expect(
      appDb.withScopedTransaction(scopeMemberA, (tx) =>
        tx.query("SELECT * FROM public.read_workspace_connector_connection('n8n')")
      )
    ).rejects.toThrow(/Active workspace admin authority required/);

    await expect(
      appDb.withScopedTransaction(scopeViewerA, (tx) =>
        tx.query("SELECT public.commit_workspace_connector_connection('n8n', 0, 'disconnect', NULL, NULL, NULL)")
      )
    ).rejects.toThrow(/Active workspace admin authority required/);

    // Forged owner GUC with member's session token is denied because token-bound scope resolves 'member'
    const forgedScope: AuthenticatedScope = {
      workspaceId: workspaceAId,
      userId: ownerAId,
      role: 'owner',
      sessionTokenHash: scopeMemberA.sessionTokenHash
    };
    await expect(
      appDb.withScopedTransaction(forgedScope, (tx) =>
        tx.query("SELECT * FROM public.read_workspace_connector_connection('n8n')")
      )
    ).rejects.toThrow(/Active workspace admin authority required/);

    // Revoked and expired owner sessions are denied
    const revokedTok = hashSessionToken('revoked-owner-' + crypto.randomBytes(6).toString('hex'));
    const expiredTok = hashSessionToken('expired-owner-' + crypto.randomBytes(6).toString('hex'));
    await adminDb.query(
      `INSERT INTO public.sessions (id, user_id, workspace_id, token_hash, expires_at, revoked_at)
       VALUES
         ($1, $2, $3, $4, NOW() + INTERVAL '1 hour', NOW()),
         ($5, $2, $3, $6, NOW() - INTERVAL '1 minute', NULL)`,
      [crypto.randomUUID(), ownerAId, workspaceAId, revokedTok, crypto.randomUUID(), expiredTok]
    );
    for (const tokenHash of [revokedTok, expiredTok]) {
      await expect(
        appDb.withScopedTransaction({ ...scopeOwnerA, sessionTokenHash: tokenHash }, (tx) =>
          tx.query("SELECT * FROM public.read_workspace_connector_connection('n8n')")
        )
      ).rejects.toThrow(/Active workspace admin authority required/);
    }
  });

  it('enforces trusted enabled profile + fingerprint, durable revisions, envelope validation, and mocked KMS rotation', async () => {
    const kms = new MockVersionedKms();
    const cipher = new ConnectorEnvelopeCipher(kms);

    // Seed disabled profile for Workspace A and enabled profile for Workspace B
    await adminDb.query(
      `INSERT INTO public.workspace_connector_profiles
         (workspace_id, connector_key, profile_id, label, configuration_fingerprint, enabled)
       VALUES
         ($1, 'n8n', $2, 'Primary A', $3, false),
         ($4, 'n8n', $5, 'Primary B', $6, true)`,
      [workspaceAId, profileAId, profileAFingerprint, workspaceBId, profileBId, profileBFingerprint]
    );

    const bindingRev1: ConnectorBinding = {
      workspaceId: workspaceAId,
      connector: 'n8n',
      profileId: profileAId,
      revision: 1
    };
    const envRev1 = await cipher.seal(bindingRev1, 'SYNTHETIC-N8N-CREDENTIAL-REV1');

    // 1. Rejects configure when profile is disabled
    await expect(
      appDb.withScopedTransaction(scopeOwnerA, (tx) =>
        tx.query(
          'SELECT public.commit_workspace_connector_connection($1, $2, $3, $4, $5, $6::jsonb)',
          ['n8n', 0, 'configure', profileAId, profileAFingerprint, JSON.stringify(envRev1)]
        )
      )
    ).rejects.toThrow(/Approved server profile required/);

    // Enable Workspace A profile
    await adminDb.query(
      `UPDATE public.workspace_connector_profiles
       SET enabled = true
       WHERE workspace_id = $1 AND connector_key = 'n8n' AND profile_id = $2`,
      [workspaceAId, profileAId]
    );

    // 2. Rejects cross-workspace profile usage (Workspace A trying to use Workspace B's profile)
    await expect(
      appDb.withScopedTransaction(scopeOwnerA, (tx) =>
        tx.query(
          'SELECT public.commit_workspace_connector_connection($1, $2, $3, $4, $5, $6::jsonb)',
          ['n8n', 0, 'configure', profileBId, profileBFingerprint, JSON.stringify(envRev1)]
        )
      )
    ).rejects.toThrow(/Approved server profile required/);

    // 3. Rejects mismatched configuration fingerprint
    await expect(
      appDb.withScopedTransaction(scopeOwnerA, (tx) =>
        tx.query(
          'SELECT public.commit_workspace_connector_connection($1, $2, $3, $4, $5, $6::jsonb)',
          ['n8n', 0, 'configure', profileAId, profileBFingerprint, JSON.stringify(envRev1)]
        )
      )
    ).rejects.toThrow(/Approved server profile required/);

    // 4. Rejects malformed envelopes in SQL validator (including keyId > 512 chars)
    const badEnvelope = { ...envRev1, iv: 'invalid_iv', extraField: true };
    await expect(
      appDb.withScopedTransaction(scopeOwnerA, (tx) =>
        tx.query(
          'SELECT public.commit_workspace_connector_connection($1, $2, $3, $4, $5, $6::jsonb)',
          ['n8n', 0, 'configure', profileAId, profileAFingerprint, JSON.stringify(badEnvelope)]
        )
      )
    ).rejects.toThrow(/Invalid encrypted connector record/);

    const oversizedKeyIdEnv = { ...envRev1, keyId: 'k'.repeat(513) };
    await expect(
      appDb.withScopedTransaction(scopeOwnerA, (tx) =>
        tx.query(
          'SELECT public.commit_workspace_connector_connection($1, $2, $3, $4, $5, $6::jsonb)',
          ['n8n', 0, 'configure', profileAId, profileAFingerprint, JSON.stringify(oversizedKeyIdEnv)]
        )
      )
    ).rejects.toThrow(/Invalid encrypted connector record/);

    const longValidKeyIdEnv = { ...envRev1, keyId: 'k'.repeat(300) };
    const { rows: longKeyValid } = await adminDb.query<{ valid: boolean }>(
      'SELECT public.connector_credential_envelope_valid($1::jsonb) AS valid',
      [JSON.stringify(longValidKeyIdEnv)]
    );
    expect(longKeyValid[0]?.valid).toBe(true);

    // 5. Succeeds configuring revision 1
    const rev1Result = await appDb.withScopedTransaction(scopeOwnerA, (tx) =>
      tx.query<{ rev: string }>(
        'SELECT public.commit_workspace_connector_connection($1, $2, $3, $4, $5, $6::jsonb) AS rev',
        ['n8n', 0, 'configure', profileAId, profileAFingerprint, JSON.stringify(envRev1)]
      )
    );
    expect(Number(rev1Result.rows[0]?.rev)).toBe(1);

    // 6. Workspace B cannot read Workspace A's connection
    const readB = await appDb.withScopedTransaction(scopeOwnerB, (tx) =>
      tx.query("SELECT * FROM public.read_workspace_connector_connection('n8n')")
    );
    expect(readB.rows).toHaveLength(0);

    // 7. If profile fingerprint drifts or profile is disabled, read fails closed
    await adminDb.query(
      `UPDATE public.workspace_connector_profiles SET enabled = false WHERE workspace_id = $1 AND profile_id = $2`,
      [workspaceAId, profileAId]
    );
    await expect(
      appDb.withScopedTransaction(scopeOwnerA, (tx) =>
        tx.query("SELECT * FROM public.read_workspace_connector_connection('n8n')")
      )
    ).rejects.toThrow(/Approved connector profile unavailable/);
    await adminDb.query(
      `UPDATE public.workspace_connector_profiles SET enabled = true WHERE workspace_id = $1 AND profile_id = $2`,
      [workspaceAId, profileAId]
    );

    // 8. Wire ConnectorKeyRotationPreparation (mock KMS) against real PostgreSQL functions to rotate rev 1 -> rev 2
    kms.versions.set('kms-mock-v1', { keyId: 'kms-mock-v1', generation: 1, state: 'decrypt_only' });
    kms.activeKeyId = 'kms-mock-v2';

    const pgBackedMockStore: ConnectorStateStore = {
      mode: 'mock',
      read: async (scope: AuthenticatedScope, connector: ConnectorKind): Promise<ConnectorRecord | null> => {
        const res = await appDb.withScopedTransaction(scope, (tx) =>
          tx.query<any>('SELECT * FROM public.read_workspace_connector_connection($1)', [connector])
        );
        const row = res.rows[0];
        if (!row) return null;
        return {
          workspaceId: row.workspace_id,
          connector: row.connector_key,
          profileId: row.profile_id,
          revision: Number(row.revision),
          state: row.status,
          envelope: row.credential_envelope
        };
      },
      commit: async (
        scope: AuthenticatedScope,
        connector: ConnectorKind,
        expectedRevision: number,
        next: ConnectorRecord,
        _audit: ConnectorAudit
      ): Promise<boolean> => {
        const op = next.state === 'disconnected' ? 'disconnect' : expectedRevision > 0 ? 'rotate' : 'configure';
        const res = await appDb.withScopedTransaction(scope, (tx) =>
          tx.query<{ rev: string | null }>(
            'SELECT public.commit_workspace_connector_connection($1, $2, $3, $4, $5, $6::jsonb) AS rev',
            [
              connector,
              expectedRevision,
              op,
              next.profileId,
              next.profileId ? profileAFingerprint : null,
              next.envelope ? JSON.stringify(next.envelope) : null
            ]
          )
        );
        return Number(res.rows[0]?.rev) === next.revision;
      }
    };

    const rotationService = new ConnectorKeyRotationPreparation(
      {
        mode: 'mock',
        store: pgBackedMockStore,
        keys: kms,
        profiles: [{ id: profileAId, workspaceId: workspaceAId, label: 'Primary A' }]
      },
      defaultPolicyGateway
    );

    const prepared = await rotationService.prepare(scopeOwnerA, 1);
    expect(prepared.status).toBe('prepared_not_committed');
    expect(prepared.next.revision).toBe(2);
    expect(prepared.next.envelope?.keyId).toBe('kms-mock-v2');

    // Reject rotate in SQL if keyId did not change
    await expect(
      appDb.withScopedTransaction(scopeOwnerA, (tx) =>
        tx.query(
          'SELECT public.commit_workspace_connector_connection($1, $2, $3, $4, $5, $6::jsonb)',
          ['n8n', 1, 'rotate', profileAId, profileAFingerprint, JSON.stringify(envRev1)]
        )
      )
    ).rejects.toThrow(/Invalid key rotation transition/);

    // Commit rotated revision 2 to PostgreSQL
    const committed = await pgBackedMockStore.commit(scopeOwnerA, 'n8n', prepared.expectedRevision, prepared.next, {
      workspaceId: workspaceAId,
      actorUserId: ownerAId,
      action: 'connector.connection.configured',
      payload: { connector: 'n8n', revision: 2, mode: 'mock', localOnly: true }
    });
    expect(committed).toBe(true);

    const afterRotate = await pgBackedMockStore.read(scopeOwnerA, 'n8n');
    expect(afterRotate?.revision).toBe(2);
    expect(afterRotate?.envelope?.keyId).toBe('kms-mock-v2');
    expect(
      await cipher.open({ workspaceId: workspaceAId, connector: 'n8n', profileId: profileAId, revision: 2 }, afterRotate!.envelope!)
    ).toBe('SYNTHETIC-N8N-CREDENTIAL-REV1');
  });

  it('persists disconnect tombstones, rejects credential data on disconnect, and advances revisions monotonically', async () => {
    const kms = new MockVersionedKms();
    const cipher = new ConnectorEnvelopeCipher(kms);
    const dummyEnv = await cipher.seal(
      { workspaceId: workspaceAId, connector: 'n8n', profileId: profileAId, revision: 3 },
      'SYNTHETIC-SECRET'
    );

    // 1. Rejects disconnect that carries profile or envelope data
    await expect(
      appDb.withScopedTransaction(scopeOwnerA, (tx) =>
        tx.query(
          'SELECT public.commit_workspace_connector_connection($1, $2, $3, $4, $5, $6::jsonb)',
          ['n8n', 2, 'disconnect', profileAId, null, JSON.stringify(dummyEnv)]
        )
      )
    ).rejects.toThrow(/Disconnect must contain no credential data/);

    // 2. Commits disconnect tombstone at revision 3
    const discRes = await appDb.withScopedTransaction(scopeOwnerA, (tx) =>
      tx.query<{ rev: string }>(
        'SELECT public.commit_workspace_connector_connection($1, $2, $3, NULL, NULL, NULL) AS rev',
        ['n8n', 2, 'disconnect']
      )
    );
    expect(Number(discRes.rows[0]?.rev)).toBe(3);

    const { rows: tombstoneRows } = await appDb.withScopedTransaction(scopeOwnerA, (tx) =>
      tx.query<any>("SELECT * FROM public.read_workspace_connector_connection('n8n')")
    );
    expect(tombstoneRows[0]).toMatchObject({
      workspace_id: workspaceAId,
      connector_key: 'n8n',
      revision: '3',
      status: 'disconnected',
      profile_id: null,
      profile_fingerprint: null,
      credential_envelope: null
    });

    // 3. Rejects rotate from a disconnected tombstone
    await expect(
      appDb.withScopedTransaction(scopeOwnerA, (tx) =>
        tx.query(
          'SELECT public.commit_workspace_connector_connection($1, $2, $3, $4, $5, $6::jsonb)',
          ['n8n', 3, 'rotate', profileAId, profileAFingerprint, JSON.stringify(dummyEnv)]
        )
      )
    ).rejects.toThrow(/Invalid key rotation transition/);

    // 4. Re-configuring after disconnect must use expected_revision = 3 -> revision 4 (no revision reset to 1)
    const staleReset = await appDb.withScopedTransaction(scopeOwnerA, (tx) =>
      tx.query<{ rev: string | null }>(
        'SELECT public.commit_workspace_connector_connection($1, $2, $3, $4, $5, $6::jsonb) AS rev',
        ['n8n', 0, 'configure', profileAId, profileAFingerprint, JSON.stringify(dummyEnv)]
      )
    );
    expect(staleReset.rows[0]?.rev).toBeNull();

    const envRev4 = await cipher.seal(
      { workspaceId: workspaceAId, connector: 'n8n', profileId: profileAId, revision: 4 },
      'SYNTHETIC-N8N-CREDENTIAL-REV4'
    );
    const rev4Res = await appDb.withScopedTransaction(scopeOwnerA, (tx) =>
      tx.query<{ rev: string }>(
        'SELECT public.commit_workspace_connector_connection($1, $2, $3, $4, $5, $6::jsonb) AS rev',
        ['n8n', 3, 'configure', profileAId, profileAFingerprint, JSON.stringify(envRev4)]
      )
    );
    expect(Number(rev4Res.rows[0]?.rev)).toBe(4);
  });

  it('serializes concurrent updates and concurrent first-create via advisory/row locks and CAS', async () => {
    const kms = new MockVersionedKms();
    const cipher = new ConnectorEnvelopeCipher(kms);

    // 1. Concurrent update race on Workspace A n8n (both expect revision 4 -> revision 5)
    const env5A = await cipher.seal(
      { workspaceId: workspaceAId, connector: 'n8n', profileId: profileAId, revision: 5 },
      'SYNTHETIC-CONCURRENT-A'
    );
    const env5B = await cipher.seal(
      { workspaceId: workspaceAId, connector: 'n8n', profileId: profileAId, revision: 5 },
      'SYNTHETIC-CONCURRENT-B'
    );

    const [raceA, raceB] = await Promise.all([
      appDb.withScopedTransaction(scopeOwnerA, (tx) =>
        tx.query<{ rev: string | null }>(
          'SELECT public.commit_workspace_connector_connection($1, $2, $3, $4, $5, $6::jsonb) AS rev',
          ['n8n', 4, 'configure', profileAId, profileAFingerprint, JSON.stringify(env5A)]
        )
      ),
      appDb.withScopedTransaction(scopeOwnerA, (tx) =>
        tx.query<{ rev: string | null }>(
          'SELECT public.commit_workspace_connector_connection($1, $2, $3, $4, $5, $6::jsonb) AS rev',
          ['n8n', 4, 'configure', profileAId, profileAFingerprint, JSON.stringify(env5B)]
        )
      )
    ]);

    const outcomes = [raceA.rows[0]?.rev, raceB.rows[0]?.rev];
    expect(outcomes.filter((v) => v === '5')).toHaveLength(1);
    expect(outcomes.filter((v) => v === null)).toHaveLength(1);

    // 2. Concurrent initial creation race on Workspace B n8n (missing row: both expect revision 0 -> 1)
    const envB1 = await cipher.seal(
      { workspaceId: workspaceBId, connector: 'n8n', profileId: profileBId, revision: 1 },
      'SYNTHETIC-WS-B-1'
    );
    const envB2 = await cipher.seal(
      { workspaceId: workspaceBId, connector: 'n8n', profileId: profileBId, revision: 1 },
      'SYNTHETIC-WS-B-2'
    );

    const [init1, init2] = await Promise.all([
      appDb.withScopedTransaction(scopeOwnerB, (tx) =>
        tx.query<{ rev: string | null }>(
          'SELECT public.commit_workspace_connector_connection($1, $2, $3, $4, $5, $6::jsonb) AS rev',
          ['n8n', 0, 'configure', profileBId, profileBFingerprint, JSON.stringify(envB1)]
        )
      ),
      appDb.withScopedTransaction(scopeOwnerB, (tx) =>
        tx.query<{ rev: string | null }>(
          'SELECT public.commit_workspace_connector_connection($1, $2, $3, $4, $5, $6::jsonb) AS rev',
          ['n8n', 0, 'configure', profileBId, profileBFingerprint, JSON.stringify(envB2)]
        )
      )
    ]);

    const initOutcomes = [init1.rows[0]?.rev, init2.rows[0]?.rev];
    expect(initOutcomes.filter((v) => v === '1')).toHaveLength(1);
    expect(initOutcomes.filter((v) => v === null)).toHaveLength(1);
  });

  it('rolls back state and audit atomically on transaction failure and keeps audit payloads secret-free', async () => {
    const beforeAudit = await adminDb.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM public.audit_events WHERE workspace_id = $1 AND target_type = 'connector_connection'`,
      [workspaceAId]
    );

    // Trigger a transaction failure after commit_workspace_connector_connection succeeds inside the transaction
    await expect(
      appDb.withScopedTransaction(scopeOwnerA, async (tx) => {
        const res = await tx.query<{ rev: string }>(
          'SELECT public.commit_workspace_connector_connection($1, $2, $3, NULL, NULL, NULL) AS rev',
          ['n8n', 5, 'disconnect']
        );
        expect(Number(res.rows[0]?.rev)).toBe(6);
        throw new Error('Simulated downstream failure after connector commit');
      })
    ).rejects.toThrow(/Simulated downstream failure/);

    // Verify revision stayed at 5 and no audit event for revision 6 was persisted
    const current = await appDb.withScopedTransaction(scopeOwnerA, (tx) =>
      tx.query<any>("SELECT * FROM public.read_workspace_connector_connection('n8n')")
    );
    expect(Number(current.rows[0]?.revision)).toBe(5);
    expect(current.rows[0]?.status).toBe('configured_unverified');

    const afterAudit = await adminDb.query<{ action: string; payload: any }>(
      `SELECT action, payload FROM public.audit_events
       WHERE workspace_id = $1 AND target_type = 'connector_connection'
       ORDER BY created_at ASC`,
      [workspaceAId]
    );
    expect(afterAudit.rows.length).toBe(beforeAudit.rows[0]?.cnt);
    expect(afterAudit.rows.map((r) => r.action)).toEqual([
      'connector.connection.configured',
      'connector.connection.key_rotated',
      'connector.connection.disconnected',
      'connector.connection.configured',
      'connector.connection.configured'
    ]);
    for (const row of afterAudit.rows) {
      const serialized = JSON.stringify(row.payload);
      expect(serialized).not.toContain('SYNTHETIC');
      expect(serialized).not.toContain('kms-mock');
      expect(serialized).not.toContain('ciphertext');
      expect(serialized).not.toContain('wrappedKey');
    }
  });

  it('Step 81: PostgresConnectorStateStore + DurableN8nSecurityPrototype enforces restart recovery, concurrent CAS, stale-credential fencing, tombstones, and cross-workspace isolation on real PostgreSQL', async () => {
    const kms = new MockVersionedKms();
    const profiles = [
      { id: profileAId, workspaceId: workspaceAId, label: 'Primary A', configurationFingerprint: profileAFingerprint },
      { id: profileBId, workspaceId: workspaceBId, label: 'Primary B', configurationFingerprint: profileBFingerprint }
    ];

    let unblockInFlight!: (rows: any[]) => void;
    const resolvedSecrets: string[] = [];

    const buildInstance = (secretValue = 'SYNTHETIC-STEP81-PG-SECRET-V1') => {
      const store = new PostgresConnectorStateStore({
        mode: 'mock',
        db: appDb,
        profiles
      });
      return new DurableN8nSecurityPrototype(
        {
          mode: 'mock',
          store,
          cipher: new ConnectorEnvelopeCipher(kms),
          profiles: profiles.map(({ id, workspaceId, label }) => ({ id, workspaceId, label })),
          resolveProfileSecret: async () => secretValue,
          transportFactory: (wsId, _profId, secret) => {
            resolvedSecrets.push(secret);
            return {
              mode: 'mock',
              workspaceId: wsId,
              listByName: () => new Promise<any[]>((resolve) => { unblockInFlight = resolve; }),
              createInactive: async (wf) => ({ id: 'wf-step81', name: wf.name, active: false }),
              read: async (id) => ({ id, active: false })
            };
          }
        },
        defaultPolicyGateway
      );
    };

    const instance1 = buildInstance('SYNTHETIC-STEP81-PG-SECRET-REV6');
    const instance2 = buildInstance('SYNTHETIC-STEP81-PG-SECRET-COMPETING');

    // 1. Concurrent configure from revision 5 -> 6 across two independent instances
    const [race1, race2] = await Promise.allSettled([
      instance1.configure(scopeOwnerA, profileAId, 5),
      instance2.configure(scopeOwnerA, profileAId, 5)
    ]);
    expect([race1.status, race2.status].sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = (race1.status === 'rejected' ? race1 : race2) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'CONNECTOR_CONNECTION_CHANGED', statusCode: 409 });

    // 2. Simulated process restart: brand new instance recovers revision 6 from PostgreSQL and decrypts with mock KMS
    const restarted = buildInstance('SYNTHETIC-STEP81-PG-SECRET-RESTARTED');
    const statusAfterRestart = await restarted.status(scopeOwnerA);
    expect(statusAfterRestart).toEqual({
      status: 'configured_unverified',
      configured: true,
      revision: 6,
      mode: 'mock',
      storage: 'postgres_durable',
      liveProvidersStatus: 'not_configured'
    });

    const accessRev6 = await restarted.capture(scopeOwnerA);
    expect(accessRev6).toEqual({
      workspaceId: workspaceAId,
      connector: 'n8n',
      profileId: profileAId,
      revision: 6
    });
    const decryptedRev6 = await restarted.resolve(scopeOwnerA, accessRev6);
    expect(['SYNTHETIC-STEP81-PG-SECRET-REV6', 'SYNTHETIC-STEP81-PG-SECRET-COMPETING']).toContain(decryptedRev6);

    // 3. Cross-workspace access is denied (Workspace B cannot use Workspace A's profile or binding)
    await expect(restarted.configure(scopeOwnerB, profileAId, 1)).rejects.toMatchObject({ statusCode: 404 });
    await expect(restarted.resolve(scopeOwnerB, accessRev6)).rejects.toMatchObject({ statusCode: 403 });
    await expect(restarted.configure(scopeViewerA, profileAId, 6)).rejects.toMatchObject({ statusCode: 403 });

    // 4. Governed mock transport enforces inactive-only workflows and fences in-flight operations on disconnect
    const tr = await restarted.transport(scopeOwnerA, accessRev6);
    await expect(
      tr.createInactive({ name: 'Must Stay Inactive', active: true, nodes: [], connections: {} } as any)
    ).rejects.toMatchObject({ code: 'CONNECTOR_WORKFLOW_ACTIVE_FORBIDDEN', statusCode: 400 });

    const created = await tr.createInactive({
      name: 'Safe Inactive Workflow',
      active: false,
      nodes: [],
      connections: {}
    } as any);
    expect(created).toEqual({ id: 'wf-step81', name: 'Safe Inactive Workflow', active: false });

    // Start in-flight listByName on revision 6, then disconnect from another instance (revision 6 -> 7)
    const pendingList = tr.listByName('Safe Inactive Workflow');
    for (let i = 0; i < 20 && !unblockInFlight; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    const discStatus = await instance2.disconnect(scopeOwnerA, 6);
    expect(discStatus).toMatchObject({
      status: 'disconnected',
      configured: false,
      revision: 7,
      storage: 'postgres_durable'
    });
    unblockInFlight([]);
    await expect(pendingList).rejects.toMatchObject({ code: 'CONNECTOR_CONNECTION_CHANGED', statusCode: 409 });
    await expect(restarted.resolve(scopeOwnerA, accessRev6)).rejects.toMatchObject({
      code: 'CONNECTOR_CONNECTION_CHANGED',
      statusCode: 409
    });

    // 5. Disconnect tombstone survives restart and re-configuration advances revision to 8 -> rotated to 9
    const afterDiscRestart = buildInstance('SYNTHETIC-STEP81-PG-SECRET-REV8');
    expect(await afterDiscRestart.status(scopeOwnerA)).toMatchObject({
      status: 'disconnected',
      configured: false,
      revision: 7,
      storage: 'postgres_durable'
    });

    const rev8Status = await afterDiscRestart.configure(scopeOwnerA, profileAId, 7);
    expect(rev8Status).toMatchObject({ status: 'configured_unverified', configured: true, revision: 8 });
    const accessRev8 = await afterDiscRestart.capture(scopeOwnerA);

    kms.versions.set('kms-mock-v1', { keyId: 'kms-mock-v1', generation: 1, state: 'decrypt_only' });
    kms.activeKeyId = 'kms-mock-v2';
    const rev9Status = await afterDiscRestart.rotate(scopeOwnerA, 8, kms);
    expect(rev9Status).toMatchObject({ status: 'configured_unverified', configured: true, revision: 9 });

    // Old revision 8 binding is immediately fenced; new revision 9 binding decrypts after restart
    await expect(afterDiscRestart.resolve(scopeOwnerA, accessRev8)).rejects.toMatchObject({
      code: 'CONNECTOR_CONNECTION_CHANGED',
      statusCode: 409
    });
    const postRotateRestart = buildInstance();
    const accessRev9 = await postRotateRestart.capture(scopeOwnerA);
    expect(accessRev9.revision).toBe(9);
    expect(await postRotateRestart.resolve(scopeOwnerA, accessRev9)).toBe('SYNTHETIC-STEP81-PG-SECRET-REV8');
  });

  it('validates 079a-connector-security.rollback.review.sql guards and fail-closed access revocation while preserving data', async () => {
    // 1. Rollback guard rejects missing approval GUC or wrong target database (thaara_v2)
    const rollbackSql = fs.readFileSync(rollbackSqlPath, 'utf8');
    await expect(adminDb.query(rollbackSql)).rejects.toThrow(
      /Review-only rollback: approval and explicit target database are required/
    );
    await expect(
      executeApprovedSqlFile(rollbackSqlPath, 'thaara.step79a_rollback_approved', 'thaara_v2')
    ).rejects.toThrow(/Review-only rollback: approval and explicit target database are required/);

    // 2. Apply approved access rollback in disposable database
    await executeApprovedSqlFile(rollbackSqlPath, 'thaara.step79a_rollback_approved', isolated.databaseName);

    // 3. thaara_app immediately loses EXECUTE on read/commit entry points (fail-closed)
    await expect(
      appDb.withScopedTransaction(scopeOwnerA, (tx) =>
        tx.query("SELECT * FROM public.read_workspace_connector_connection('n8n')")
      )
    ).rejects.toThrow(/permission denied for function read_workspace_connector_connection/i);

    await expect(
      appDb.withScopedTransaction(scopeOwnerA, (tx) =>
        tx.query("SELECT public.commit_workspace_connector_connection('n8n', 9, 'disconnect', NULL, NULL, NULL)")
      )
    ).rejects.toThrow(/permission denied for function commit_workspace_connector_connection/i);

    // 4. Encrypted records, revisions, profiles, and audit history remain intact after access rollback
    const { rows: preservedConn } = await adminDb.query<{ workspace_id: string; revision: string; status: string }>(
      `SELECT workspace_id, revision, status FROM public.workspace_connector_connections ORDER BY workspace_id`
    );
    expect(preservedConn).toEqual(
      expect.arrayContaining([
        { workspace_id: workspaceAId, revision: '9', status: 'configured_unverified' },
        { workspace_id: workspaceBId, revision: '1', status: 'configured_unverified' }
      ])
    );

    const { rows: preservedAudits } = await adminDb.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM public.audit_events WHERE workspace_id = $1 AND target_type = 'connector_connection'`,
      [workspaceAId]
    );
    expect(preservedAudits[0]?.cnt).toBe(9);
  });
});
