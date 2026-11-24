import { getIsolatedRuntimeConfig, isolatedRoleUrl } from '../../../scripts/step74-runtime-guard.mjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import pg from 'pg';
import {
  PostgresDatabase,
  RoleAwarePool,
  AuthenticatedScope,
  ScopeError,
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ConflictError
} from '../src/index.js';
import { Migrator } from '../src/migrator.js';
import { WorkspaceRepository } from '../src/repositories/workspaces.js';
import { UserRepository } from '../src/repositories/users.js';
import { MembershipRepository } from '../src/repositories/memberships.js';
import { SessionRepository, hashSessionToken } from '../src/repositories/sessions.js';
import { ConversationRepository } from '../src/repositories/conversations.js';
import { ConversationMessageRepository } from '../src/repositories/conversation-messages.js';
import { MemoryItemRepository } from '../src/repositories/memory-items.js';
import { PrivacyPurgeRepository } from '../src/repositories/privacy-purge.js';
import { WorkerOutboxRepository } from '../src/repositories/worker/worker-outbox.js';
import { WorkerPurgeRepository } from '../src/repositories/worker/worker-purge.js';
import { ContextAssemblyService } from '../src/services/context-assembly.js';
import { bootstrapRuntimeIdentities } from '../scripts/bootstrap-runtime-identities.js';

const { Client } = pg;

const isolated = getIsolatedRuntimeConfig();

describe('Task 003 Phase 2: Repositories, Universal Procedures, and Context Assembly Runtime (Real PostgreSQL 16)', () => {
  const migrationDbUrl = isolated.migrationUrl;
  const appDbUrl = isolated.appUrl;

  let isLive = false;
  let adminDb: PostgresDatabase | null = null;
  let appDb: PostgresDatabase | null = null;
  let workerPool: RoleAwarePool | null = null;

  let workspaceAId: string;
  let workspaceBId: string;
  let userA1Id: string;
  let userA2Id: string;
  let userAdminId: string;
  let userB1Id: string;

  let tokenA1: string;
  let tokenHashA1: string;
  let tokenA2: string;
  let tokenHashA2: string;
  let tokenAdmin: string;
  let tokenHashAdmin: string;
  let tokenB1: string;
  let tokenHashB1: string;

  let scopeA1: AuthenticatedScope;
  let scopeA2: AuthenticatedScope;
  let scopeAdmin: AuthenticatedScope;
  let scopeB1: AuthenticatedScope;

  let convRepo: ConversationRepository;
  let msgRepo: ConversationMessageRepository;
  let memRepo: MemoryItemRepository;
  let purgeRepo: PrivacyPurgeRepository;
  let contextService: ContextAssemblyService;

  const adminPw = process.env.THAARA_DB_ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
  const workerPw = process.env.THAARA_DB_WORKER_PASSWORD || crypto.randomBytes(16).toString('hex');
  const seederPw = process.env.THAARA_DB_SEEDER_PASSWORD || crypto.randomBytes(16).toString('hex');

  const all11Procedures = [
    'current_authenticated_scope',
    'create_conversation',
    'update_conversation_status',
    'append_conversation_message',
    'create_memory_item',
    'grant_memory_consent',
    'revoke_memory_consent',
    'supersede_memory_item',
    'initiate_self_privacy_purge',
    'export_user_conversation_history',
    'inspect_private_conversation'
  ] as const;

  beforeAll(async () => {
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
        `[Task 003 Repositories Runtime Suite] PostgreSQL is not reachable at 127.0.0.1:15432/thaara_step74_test. ` +
          `ALLOW_OFFLINE_RUNTIME_SKIP=true is set; running in offline diagnostic mode. Skipping live queries.`
      );
      return;
    }

    if (!appDbUrl) {
      throw new Error(
        `[Runtime Proof Failure] DATABASE_URL must be provided with valid non-superuser thaara_app credentials.`
      );
    }

    // 1. Run migrations as migration admin
    adminDb = new PostgresDatabase(migrationDbUrl);
    const migrator = new Migrator(adminDb);
    await migrator.migrate(migrator.loadMigrationFiles());

    // 2. Configure dedicated runtime identities
    await bootstrapRuntimeIdentities(adminDb, {
      databaseName: isolated.databaseName,
      adminPassword: adminPw,
      workerPassword: workerPw,
      seederPassword: seederPw
    });

    // 3. Connect application database as thaara_app
    appDb = new PostgresDatabase(appDbUrl);

    // 4. Connect worker pool as thaara_worker
    const workerConnStr = isolatedRoleUrl(isolated, 'thaara_worker_user', workerPw);
    workerPool = new RoleAwarePool({
      connectionString: workerConnStr,
      targetRole: 'thaara_worker',
      expectedLoginUser: 'thaara_worker_user',
      max: 5
    });

    // 5. Seed test workspaces and users
    const wsRepo = new WorkspaceRepository(appDb);
    const userRepo = new UserRepository(appDb);

    const wsA = await wsRepo.create('Org Alpha Repo T003');
    const wsB = await wsRepo.create('Org Beta Repo T003');
    workspaceAId = wsA.id;
    workspaceBId = wsB.id;

    const uA1 = await userRepo.create('alice.repo.t003@alpha.com', 'pwd_hash_a1', 'Alice Repo Owner');
    const uA2 = await userRepo.create('charlie.repo.t003@alpha.com', 'pwd_hash_a2', 'Charlie Repo Member');
    const uAdmin = await userRepo.create('dan.repo.t003@alpha.com', 'pwd_hash_admin', 'Dan Repo Admin');
    const uB1 = await userRepo.create('bob.repo.t003@beta.com', 'pwd_hash_b1', 'Bob Repo Owner');
    userA1Id = uA1.id;
    userA2Id = uA2.id;
    userAdminId = uAdmin.id;
    userB1Id = uB1.id;

    // 6. Seed memberships and sessions
    tokenA1 = 'repo-token-alice-t003';
    tokenHashA1 = hashSessionToken(tokenA1);
    tokenA2 = 'repo-token-charlie-t003';
    tokenHashA2 = hashSessionToken(tokenA2);
    tokenAdmin = 'repo-token-dan-admin-t003';
    tokenHashAdmin = hashSessionToken(tokenAdmin);
    tokenB1 = 'repo-token-bob-t003';
    tokenHashB1 = hashSessionToken(tokenB1);

    scopeA1 = {
      workspaceId: workspaceAId,
      userId: userA1Id,
      role: 'owner',
      sessionTokenHash: tokenHashA1
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

    scopeB1 = {
      workspaceId: workspaceBId,
      userId: userB1Id,
      role: 'owner',
      sessionTokenHash: tokenHashB1
    };

    // Insert memberships and sessions in single transaction
    await appDb.withScopedTransaction(scopeA1, async (tx) => {
      const mRepo = new MembershipRepository(tx);
      const sRepo = new SessionRepository(tx);
      await mRepo.create(workspaceAId, userA1Id, 'owner');
      await sRepo.create(userA1Id, workspaceAId, tokenA1);
    });

    await appDb.withScopedTransaction(scopeA2, async (tx) => {
      const mRepo = new MembershipRepository(tx);
      const sRepo = new SessionRepository(tx);
      await mRepo.create(workspaceAId, userA2Id, 'member');
      await sRepo.create(userA2Id, workspaceAId, tokenA2);
    });

    await appDb.withScopedTransaction(scopeAdmin, async (tx) => {
      const mRepo = new MembershipRepository(tx);
      const sRepo = new SessionRepository(tx);
      await mRepo.create(workspaceAId, userAdminId, 'admin');
      await sRepo.create(userAdminId, workspaceAId, tokenAdmin);
    });

    await appDb.withScopedTransaction(scopeB1, async (tx) => {
      const mRepo = new MembershipRepository(tx);
      const sRepo = new SessionRepository(tx);
      await mRepo.create(workspaceBId, userB1Id, 'owner');
      await sRepo.create(userB1Id, workspaceBId, tokenB1);
    });

    // 7. Initialize repositories
    convRepo = new ConversationRepository(appDb);
    msgRepo = new ConversationMessageRepository(appDb);
    memRepo = new MemoryItemRepository(appDb);
    purgeRepo = new PrivacyPurgeRepository(appDb);
    contextService = new ContextAssemblyService(memRepo, msgRepo, convRepo, appDb);
  });

  afterAll(async () => {
    if (isLive) {
      if (workerPool) await workerPool.close();
      if (appDb) await appDb.close();
      if (adminDb) await adminDb.close();
    }
  });

  // Test 1: Token-Hash Lifecycle Fail-Closed Reads
  it('proves fail-closed reads across all 4 session-token lifecycle states (absent, invalid, revoked, expired) for all tables', async () => {
    if (!isLive) return;

    // Create a conversation, message, active consented memory, and purge operation under Alice (scopeA1)
    const conv = await convRepo.create(scopeA1, { title: 'Lifecycle Test Conv' });
    await msgRepo.append(scopeA1, conv.id, { content: 'Lifecycle test message' });
    const mem = await memRepo.create(scopeA1, {
      scope: 'user',
      category: 'fact',
      key: 'user.test.lifecycle',
      value: 'lifecycle value',
      provenance: 'explicit_user_input'
    });
    await memRepo.grantConsent(scopeA1, mem.id);
    const purgeId = await purgeRepo.initiatePurge(scopeA1, { mode: 'history_and_memory' });

    // Setup client under thaara_app to test the 4 states
    const rawClient = new Client({ connectionString: appDbUrl });
    await rawClient.connect();

    try {
      // State 1: Token hash absent / empty
      await rawClient.query('BEGIN;');
      await rawClient.query(`SELECT pg_catalog.set_config('app.session_token_hash', '', true);`);
      const r1Conv = await rawClient.query(`SELECT * FROM public.conversations WHERE id = $1;`, [conv.id]);
      const r1Msg = await rawClient.query(`SELECT * FROM public.conversation_messages WHERE conversation_id = $1;`, [conv.id]);
      const r1Mem = await rawClient.query(`SELECT * FROM public.memory_items WHERE id = $1;`, [mem.id]);
      const r1Cut = await rawClient.query(`SELECT * FROM public.user_purge_cutoffs WHERE workspace_id = $1;`, [workspaceAId]);
      const r1Op = await rawClient.query(`SELECT * FROM public.user_purge_operations WHERE id = $1;`, [purgeId]);
      const r1Out = await rawClient.query(`SELECT * FROM public.worker_dispatch_outbox WHERE workspace_id = $1;`, [workspaceAId]);
      await rawClient.query('ROLLBACK;');

      expect(r1Conv.rows.length).toBe(0);
      expect(r1Msg.rows.length).toBe(0);
      expect(r1Mem.rows.length).toBe(0);
      expect(r1Cut.rows.length).toBe(0);
      expect(r1Op.rows.length).toBe(0);
      expect(r1Out.rows.length).toBe(0);

      // State 2: Token hash invalid / nonexistent
      await rawClient.query('BEGIN;');
      await rawClient.query(`SELECT pg_catalog.set_config('app.session_token_hash', 'nonexistent_hash_xyz', true);`);
      const r2Conv = await rawClient.query(`SELECT * FROM public.conversations WHERE id = $1;`, [conv.id]);
      const r2Msg = await rawClient.query(`SELECT * FROM public.conversation_messages WHERE conversation_id = $1;`, [conv.id]);
      const r2Mem = await rawClient.query(`SELECT * FROM public.memory_items WHERE id = $1;`, [mem.id]);
      const r2Cut = await rawClient.query(`SELECT * FROM public.user_purge_cutoffs WHERE workspace_id = $1;`, [workspaceAId]);
      const r2Op = await rawClient.query(`SELECT * FROM public.user_purge_operations WHERE id = $1;`, [purgeId]);
      const r2Out = await rawClient.query(`SELECT * FROM public.worker_dispatch_outbox WHERE workspace_id = $1;`, [workspaceAId]);
      await rawClient.query('ROLLBACK;');

      expect(r2Conv.rows.length).toBe(0);
      expect(r2Msg.rows.length).toBe(0);
      expect(r2Mem.rows.length).toBe(0);
      expect(r2Cut.rows.length).toBe(0);
      expect(r2Op.rows.length).toBe(0);
      expect(r2Out.rows.length).toBe(0);

      // State 3: Session revoked
      // Create temporary dedicated session to revoke
      const tempToken = 'temp-revoked-token-t003';
      const tempHash = hashSessionToken(tempToken);
      await appDb.withScopedTransaction(scopeA1, async (tx) => {
        const sRepo = new SessionRepository(tx);
        await sRepo.create(userA1Id, workspaceAId, tempToken);
      });
      await adminDb!.query(`UPDATE public.sessions SET revoked_at = now() WHERE token_hash = $1;`, [tempHash]);

      await rawClient.query('BEGIN;');
      await rawClient.query(`SELECT pg_catalog.set_config('app.session_token_hash', $1, true);`, [tempHash]);
      const r3Conv = await rawClient.query(`SELECT * FROM public.conversations WHERE id = $1;`, [conv.id]);
      const r3Msg = await rawClient.query(`SELECT * FROM public.conversation_messages WHERE conversation_id = $1;`, [conv.id]);
      const r3Mem = await rawClient.query(`SELECT * FROM public.memory_items WHERE id = $1;`, [mem.id]);
      const r3Cut = await rawClient.query(`SELECT * FROM public.user_purge_cutoffs WHERE workspace_id = $1;`, [workspaceAId]);
      const r3Op = await rawClient.query(`SELECT * FROM public.user_purge_operations WHERE id = $1;`, [purgeId]);
      const r3Out = await rawClient.query(`SELECT * FROM public.worker_dispatch_outbox WHERE workspace_id = $1;`, [workspaceAId]);
      await rawClient.query('ROLLBACK;');

      expect(r3Conv.rows.length).toBe(0);
      expect(r3Msg.rows.length).toBe(0);
      expect(r3Mem.rows.length).toBe(0);
      expect(r3Cut.rows.length).toBe(0);
      expect(r3Op.rows.length).toBe(0);
      expect(r3Out.rows.length).toBe(0);

      // State 4: Session expired
      const expToken = 'temp-expired-token-t003';
      const expHash = hashSessionToken(expToken);
      await appDb.withScopedTransaction(scopeA1, async (tx) => {
        const sRepo = new SessionRepository(tx);
        await sRepo.create(userA1Id, workspaceAId, expToken);
      });
      await adminDb!.query(`UPDATE public.sessions SET expires_at = now() - interval '10s' WHERE token_hash = $1;`, [expHash]);

      await rawClient.query('BEGIN;');
      await rawClient.query(`SELECT pg_catalog.set_config('app.session_token_hash', $1, true);`, [expHash]);
      const r4Conv = await rawClient.query(`SELECT * FROM public.conversations WHERE id = $1;`, [conv.id]);
      const r4Msg = await rawClient.query(`SELECT * FROM public.conversation_messages WHERE conversation_id = $1;`, [conv.id]);
      const r4Mem = await rawClient.query(`SELECT * FROM public.memory_items WHERE id = $1;`, [mem.id]);
      const r4Cut = await rawClient.query(`SELECT * FROM public.user_purge_cutoffs WHERE workspace_id = $1;`, [workspaceAId]);
      const r4Op = await rawClient.query(`SELECT * FROM public.user_purge_operations WHERE id = $1;`, [purgeId]);
      const r4Out = await rawClient.query(`SELECT * FROM public.worker_dispatch_outbox WHERE workspace_id = $1;`, [workspaceAId]);
      await rawClient.query('ROLLBACK;');

      expect(r4Conv.rows.length).toBe(0);
      expect(r4Msg.rows.length).toBe(0);
      expect(r4Mem.rows.length).toBe(0);
      expect(r4Cut.rows.length).toBe(0);
      expect(r4Op.rows.length).toBe(0);
      expect(r4Out.rows.length).toBe(0);
    } finally {
      await rawClient.end();
    }
  });

  // Test 2: Strict No-Fallback Validation on Missing Token Hash
  it('proves strict no-fallback validation throws ScopeError on missing, empty, or whitespace sessionTokenHash', async () => {
    if (!isLive) return;

    // Missing sessionTokenHash
    const scopeMissing = {
      workspaceId: workspaceAId,
      userId: userA1Id,
      role: 'owner' as const
    } as any;

    await expect(
      appDb!.withScopedTransaction(scopeMissing, async () => true)
    ).rejects.toThrow(ScopeError);

    // Empty string sessionTokenHash
    const scopeEmpty = {
      ...scopeMissing,
      sessionTokenHash: ''
    };

    await expect(
      appDb!.withScopedTransaction(scopeEmpty, async () => true)
    ).rejects.toThrow(ScopeError);

    // Whitespace sessionTokenHash
    const scopeWhitespace = {
      ...scopeMissing,
      sessionTokenHash: '   '
    };

    await expect(
      appDb!.withScopedTransaction(scopeWhitespace, async () => true)
    ).rejects.toThrow(ScopeError);
  });

  // Test 3: Message Sequence Concurrency
  it('proves message sequence concurrency under 10 concurrent appends (sequences 1..10 with zero gaps or collisions)', async () => {
    if (!isLive) return;

    const conv = await convRepo.create(scopeA1, { title: 'Concurrency Sequence Conv' });

    // Seed sequence 0
    const seq0 = await msgRepo.append(scopeA1, conv.id, { content: 'Initial message 0' });
    expect(seq0.sequence_number).toBe(0);

    // Launch 10 concurrent appends across pool
    const appendPromises = Array.from({ length: 10 }, (_, i) =>
      msgRepo.append(scopeA1, conv.id, { content: `Concurrent message ${i + 1}` })
    );

    const results = await Promise.all(appendPromises);
    const sequenceNumbers = results.map((r) => r.sequence_number).sort((a, b) => a - b);

    expect(sequenceNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  // Test 4: Concurrent Memory Supersession
  it('proves concurrent memory supersession: exactly 1 succeeds to version 2, competing call throws ConflictError', async () => {
    if (!isLive) return;

    const mem = await memRepo.create(scopeA1, {
      scope: 'user',
      category: 'preference',
      key: 'user.ui.theme_concurrent',
      value: 'dark',
      confidence: 0.9,
      provenance: 'explicit_user_input'
    });
    await memRepo.grantConsent(scopeA1, mem.id);

    // 2 concurrent supersessions targeting the exact same predecessor
    const call1 = memRepo.supersede(scopeA1, mem.id, {
      value: 'theme_a',
      confidence: 0.95
    });
    const call2 = memRepo.supersede(scopeA1, mem.id, {
      value: 'theme_b',
      confidence: 0.95
    });

    const settled = await Promise.allSettled([call1, call2]);
    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const winningItem = (fulfilled[0] as PromiseFulfilledResult<any>).value;
    expect(winningItem.version).toBe(2);
    expect(winningItem.lifecycle_status).toBe('active');

    const rejectionReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejectionReason).toBeInstanceOf(ConflictError);
  });

  // Test 5: Cutoff Isolation (Messages & Memories)
  it('proves cutoff isolation: historical messages & user memories before cutoff are omitted, workspace memories preserved', async () => {
    if (!isLive) return;

    const conv = await convRepo.create(scopeA1, { title: 'Cutoff Isolation Conv' });

    // Pre-cutoff items
    const preMsg = await msgRepo.append(scopeA1, conv.id, { content: 'Pre-cutoff message' });
    const preMem = await memRepo.create(scopeA1, {
      scope: 'user',
      category: 'fact',
      key: 'user.fact.pre_cutoff',
      value: 'pre-cutoff fact',
      provenance: 'explicit_user_input'
    });
    await memRepo.grantConsent(scopeA1, preMem.id);

    // Initiate self privacy purge to create cutoff
    const purgeId = await purgeRepo.initiatePurge(scopeA1, { mode: 'history_and_memory' });
    expect(purgeId).toBeDefined();

    // Post-cutoff items
    const postMsg = await msgRepo.append(scopeA1, conv.id, { content: 'Post-cutoff message' });
    const postMem = await memRepo.create(scopeA1, {
      scope: 'user',
      category: 'fact',
      key: 'user.fact.post_cutoff',
      value: 'post-cutoff fact',
      provenance: 'explicit_user_input'
    });
    await memRepo.grantConsent(scopeA1, postMem.id);

    // Workspace-scoped memory (immune to user privacy cutoffs)
    const wsMem = await memRepo.create(scopeA1, {
      scope: 'workspace',
      category: 'guideline',
      key: 'workspace.guideline.retained',
      value: 'standard workspace compliance policy',
      provenance: 'explicit_user_input'
    });

    // Verification 1: Conversation messages list returns only post-cutoff message
    const visibleMessages = await msgRepo.listByConversation(scopeA1, conv.id);
    const visibleIds = visibleMessages.map((m) => m.id);
    expect(visibleIds).toContain(postMsg.id);
    expect(visibleIds).not.toContain(preMsg.id);

    // Verification 2: Active memories list returns post-cutoff user memory and workspace memory, omitting pre-cutoff
    const activeMems = await memRepo.listActive(scopeA1);
    const activeKeys = activeMems.map((m) => m.key);
    expect(activeKeys).toContain('user.fact.post_cutoff');
    expect(activeKeys).toContain('workspace.guideline.retained');
    expect(activeKeys).not.toContain('user.fact.pre_cutoff');
  });

  // Test 6: Same-Workspace Foreign-User Exclusion
  it('proves same-workspace foreign-user exclusion: User A cannot see User B messages in same workspace', async () => {
    if (!isLive) return;

    // Alice creates conv & message in Org Alpha
    const convA = await convRepo.create(scopeA1, { title: 'Alice Private Conv' });
    const msgA = await msgRepo.append(scopeA1, convA.id, { content: 'Alice confidential note' });

    // Charlie creates conv & message in same Org Alpha
    const convC = await convRepo.create(scopeA2, { title: 'Charlie Private Conv' });
    const msgC = await msgRepo.append(scopeA2, convC.id, { content: 'Charlie internal note' });

    // Alice queries her conversation
    const aliceVisible = await msgRepo.listByConversation(scopeA1, convA.id);
    expect(aliceVisible.some((m) => m.id === msgA.id)).toBe(true);
    expect(aliceVisible.some((m) => m.id === msgC.id)).toBe(false);

    // Charlie queries his conversation
    const charlieVisible = await msgRepo.listByConversation(scopeA2, convC.id);
    expect(charlieVisible.some((m) => m.id === msgC.id)).toBe(true);
    expect(charlieVisible.some((m) => m.id === msgA.id)).toBe(false);

    // Charlie attempting to view Alice conversation returns 0 messages
    const crossView = await msgRepo.listByConversation(scopeA2, convA.id);
    expect(crossView.length).toBe(0);
  });

  // Test 7: Same-Workspace Member Denial (Workspace Memory)
  it('proves same-workspace member denial: members cannot create workspace memory, owners can', async () => {
    if (!isLive) return;

    // Charlie (member) attempts workspace memory -> rejected with ForbiddenError
    await expect(
      memRepo.create(scopeA2, {
        scope: 'workspace',
        category: 'preference',
        key: 'ws.member.forbidden_pref',
        value: 'unauthorized workspace pref',
        provenance: 'explicit_user_input'
      })
    ).rejects.toThrow(ForbiddenError);

    // Alice (owner) creates workspace memory -> succeeds
    const wsMem = await memRepo.create(scopeA1, {
      scope: 'workspace',
      category: 'guideline',
      key: 'ws.owner.authorized_guideline',
      value: 'authorized workspace guideline',
      provenance: 'explicit_user_input'
    });

    expect(wsMem.scope).toBe('workspace');
    expect(wsMem.consent_status).toBe('pending_consent');
  });

  // Test 8: Comprehensive Foreign GUC Spoofing Denial & Cross-Tenant Isolation
  it('proves comprehensive foreign GUC spoofing denial: forged app.workspace_id and app.user_id cannot compromise cross-tenant boundaries', async () => {
    if (!isLive) return;

    // Ensure Tenant B has data across all 6 tables
    const convB = await convRepo.create(scopeB1, { title: 'Tenant B Private Conv' });
    const msgB = await msgRepo.append(scopeB1, convB.id, { content: 'Tenant B Secret' });
    const memB = await memRepo.create(scopeB1, {
      scope: 'user',
      category: 'fact',
      key: 'tenantb.secret_fact',
      value: 'confidential b',
      provenance: 'explicit_user_input'
    });
    const purgeIdB = await purgeRepo.initiatePurge(scopeB1, { mode: 'history_and_memory' });

    // Connect under thaara_app, authenticated as Alice (Tenant A)
    const spoofClient = new Client({ connectionString: appDbUrl });
    await spoofClient.connect();

    try {
      await spoofClient.query('BEGIN;');
      // Authenticate with Tenant A token
      await spoofClient.query(`SELECT pg_catalog.set_config('app.session_token_hash', $1, true);`, [tokenHashA1]);

      // Maliciously spoof foreign workspace, user, and elevated role
      await spoofClient.query(`SELECT pg_catalog.set_config('app.workspace_id', $1, true);`, [workspaceBId]);
      await spoofClient.query(`SELECT pg_catalog.set_config('app.user_id', $1, true);`, [userB1Id]);
      await spoofClient.query(`SELECT pg_catalog.set_config('app.role', 'admin', true);`);

      // 1. SELECT on ALL SIX Task 003 tables returns 0 rows from Tenant B
      const selConv = await spoofClient.query(`SELECT * FROM public.conversations WHERE id = $1;`, [convB.id]);
      const selMsg = await spoofClient.query(`SELECT * FROM public.conversation_messages WHERE id = $1;`, [msgB.id]);
      const selMem = await spoofClient.query(`SELECT * FROM public.memory_items WHERE id = $1;`, [memB.id]);
      const selCut = await spoofClient.query(`SELECT * FROM public.user_purge_cutoffs WHERE workspace_id = $1;`, [workspaceBId]);
      const selOp = await spoofClient.query(`SELECT * FROM public.user_purge_operations WHERE id = $1;`, [purgeIdB]);
      const selOut = await spoofClient.query(`SELECT * FROM public.worker_dispatch_outbox WHERE workspace_id = $1;`, [workspaceBId]);

      expect(selConv.rows.length).toBe(0);
      expect(selMsg.rows.length).toBe(0);
      expect(selMem.rows.length).toBe(0);
      expect(selCut.rows.length).toBe(0);
      expect(selOp.rows.length).toBe(0);
      expect(selOut.rows.length).toBe(0);

      // 2. Direct table INSERT is denied (42501 / RLS violation) across tables
      await spoofClient.query('SAVEPOINT sp_ins;');
      await expect(
        spoofClient.query(`
          INSERT INTO public.conversations (id, workspace_id, user_id, title)
          VALUES (gen_random_uuid(), $1, $2, 'Injected Conv');
        `, [workspaceBId, userB1Id])
      ).rejects.toThrow(/42501|new row violates row-level security policy/);
      await spoofClient.query('ROLLBACK TO SAVEPOINT sp_ins;');

      await spoofClient.query('SAVEPOINT sp_ins_cut;');
      await expect(
        spoofClient.query(`
          INSERT INTO public.user_purge_cutoffs (workspace_id, user_id, cutoff_at, generation)
          VALUES ($1, $2, now(), 999);
        `, [workspaceBId, userB1Id])
      ).rejects.toThrow(/42501|permission denied|new row violates row-level security policy/);
      await spoofClient.query('ROLLBACK TO SAVEPOINT sp_ins_cut;');

      await spoofClient.query('SAVEPOINT sp_ins_op;');
      await expect(
        spoofClient.query(`
          INSERT INTO public.user_purge_operations (id, workspace_id, user_id, generation, cutoff_at, mode, status)
          VALUES (gen_random_uuid(), $1, $2, 999, now(), 'history_and_memory', 'pending');
        `, [workspaceBId, userB1Id])
      ).rejects.toThrow(/42501|permission denied|new row violates row-level security policy/);
      await spoofClient.query('ROLLBACK TO SAVEPOINT sp_ins_op;');

      await spoofClient.query('SAVEPOINT sp_ins_out;');
      await expect(
        spoofClient.query(`
          INSERT INTO public.worker_dispatch_outbox (workspace_id, topic, dedup_key, payload, status)
          VALUES ($1, 'fake_topic', 'fake_key', '{}'::jsonb, 'pending');
        `, [workspaceBId])
      ).rejects.toThrow(/42501|permission denied|new row violates row-level security policy/);
      await spoofClient.query('ROLLBACK TO SAVEPOINT sp_ins_out;');

      // 3. Direct table UPDATE is denied (0 rows updated due to USING (false) policy)
      const updRes = await spoofClient.query(`
        UPDATE public.conversations SET title = 'Hacked' WHERE id = $1;
      `, [convB.id]);
      expect(updRes.rowCount).toBe(0);

      await spoofClient.query('SAVEPOINT sp_upd_op;');
      await expect(
        spoofClient.query(`
          UPDATE public.user_purge_operations SET status = 'completed' WHERE id = $1;
        `, [purgeIdB])
      ).rejects.toThrow(/(permission denied|42501)/i);
      await spoofClient.query('ROLLBACK TO SAVEPOINT sp_upd_op;');

      await spoofClient.query('SAVEPOINT sp_upd_out;');
      await expect(
        spoofClient.query(`
          UPDATE public.worker_dispatch_outbox SET status = 'dispatched' WHERE workspace_id = $1;
        `, [workspaceBId])
      ).rejects.toThrow(/(permission denied|42501)/i);
      await spoofClient.query('ROLLBACK TO SAVEPOINT sp_upd_out;');

      // 4. Procedural creations write strictly into Tenant A (resolved from token)
      const procConvRes = await spoofClient.query<{ id: string }>(`
        SELECT public.create_conversation($1, 'Procedural Conv Under Spoofed GUCs', 'web', '{}') AS id;
      `, [tokenHashA1]);
      const createdConvId = procConvRes.rows[0]?.id;

      // Verify the created conversation actually belongs to Tenant A, not Tenant B
      const checkConv = await spoofClient.query<{ workspace_id: string }>(`
        SELECT workspace_id FROM public.conversations WHERE id = $1;
      `, [createdConvId]);
      expect(checkConv.rows[0]?.workspace_id).toBe(workspaceAId);

      // 5. Procedural conversation append targeting Tenant B conversation fails
      await spoofClient.query('SAVEPOINT sp_app;');
      await expect(
        spoofClient.query(`
          SELECT * FROM public.append_conversation_message($1, $2, 'Injected message', '{}');
        `, [tokenHashA1, convB.id])
      ).rejects.toThrow(/not found or unauthorized/i);
      await spoofClient.query('ROLLBACK TO SAVEPOINT sp_app;');

      // 6. Procedural conversation status update targeting Tenant B fails
      await spoofClient.query('SAVEPOINT sp_stat;');
      await expect(
        spoofClient.query(`
          SELECT public.update_conversation_status($1, $2, 'archived');
        `, [tokenHashA1, convB.id])
      ).rejects.toThrow(/not found or unauthorized/i);
      await spoofClient.query('ROLLBACK TO SAVEPOINT sp_stat;');

      // 7. Procedural consent / supersession targeting Tenant B memory fails
      await spoofClient.query('SAVEPOINT sp_cons;');
      await expect(
        spoofClient.query(`
          SELECT public.grant_memory_consent($1, $2);
        `, [tokenHashA1, memB.id])
      ).rejects.toThrow(/not found|unauthorized|permission denied/i);
      await spoofClient.query('ROLLBACK TO SAVEPOINT sp_cons;');

      await spoofClient.query('SAVEPOINT sp_sup;');
      await expect(
        spoofClient.query(`
          SELECT public.supersede_memory_item($1, $2, 'hacked val', 0.9);
        `, [tokenHashA1, memB.id])
      ).rejects.toThrow(/not found|unauthorized|permission denied/i);
      await spoofClient.query('ROLLBACK TO SAVEPOINT sp_sup;');

      await spoofClient.query('ROLLBACK;');
    } finally {
      await spoofClient.end();
    }
  });

  // Test 9: Comprehensive 11-Procedure Catalog ACL Inspection
  it('proves comprehensive 11-procedure catalog ACL inspection: prosecdef, search_path, zero PUBLIC EXECUTE, and minimal grants', async () => {
    if (!isLive) return;

    for (const procName of all11Procedures) {
      const { rows } = await adminDb!.query<{
        proname: string;
        prosecdef: boolean;
        proconfig: string[] | null;
        public_privilege_count: number;
        app_can_execute: boolean;
        worker_can_execute: boolean;
        worker_privilege_in_acl: number;
        admin_can_execute: boolean;
      }>(`
        SELECT
          p.proname,
          p.prosecdef,
          p.proconfig,
          -- Explicit inspection of proacl via aclexplode: count entries where grantee = 0 (PUBLIC)
          (SELECT COUNT(*) FROM pg_catalog.aclexplode(p.proacl) WHERE grantee = 0) AS public_privilege_count,
          has_function_privilege('thaara_app'::regrole, p.oid, 'EXECUTE') AS app_can_execute,
          has_function_privilege('thaara_worker'::regrole, p.oid, 'EXECUTE') AS worker_can_execute,
          (SELECT COUNT(*) FROM pg_catalog.aclexplode(p.proacl) WHERE grantee = 'thaara_worker'::regrole::oid) AS worker_privilege_in_acl,
          has_function_privilege('thaara_admin'::regrole, p.oid, 'EXECUTE') AS admin_can_execute
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = $1;
      `, [procName]);

      expect(rows.length).toBeGreaterThan(0);
      const row = rows[0]!;

      // Prosecdef must be true
      expect(row.prosecdef).toBe(true);

      // Search path must be pinned to pg_catalog, public, pg_temp
      expect(row.proconfig).toBeDefined();
      expect(row.proconfig).toContain('search_path=pg_catalog, public, pg_temp');

      // Zero PUBLIC privilege entries in proacl
      expect(Number(row.public_privilege_count)).toBe(0);

      // thaara_app must have EXECUTE
      expect(row.app_can_execute).toBe(true);

      // thaara_worker must NOT have EXECUTE
      expect(row.worker_can_execute).toBe(false);
      expect(Number(row.worker_privilege_in_acl)).toBe(0);

      // thaara_admin only permitted on inspect_private_conversation
      if (procName === 'inspect_private_conversation') {
        expect(row.admin_can_execute).toBe(true);
      } else {
        expect(row.admin_can_execute).toBe(false);
      }
    }
  });

  // Test 10: Comprehensive 11-Procedure thaara_worker Execution Denial
  it('proves comprehensive 11-procedure thaara_worker execution denial: all 11 procedures reject thaara_worker with 42501', async () => {
    if (!isLive) return;

    await workerPool!.withClient(async (workerClient) => {
      // 1. current_authenticated_scope
      await expect(
        workerClient.query(`SELECT public.current_authenticated_scope();`)
      ).rejects.toThrow(/42501|permission denied/);

      // 2. create_conversation
      await expect(
        workerClient.query(`SELECT public.create_conversation('token', 'title', 'web', '{}');`)
      ).rejects.toThrow(/42501|permission denied/);

      // 3. update_conversation_status
      await expect(
        workerClient.query(`SELECT public.update_conversation_status('token', gen_random_uuid(), 'archived');`)
      ).rejects.toThrow(/42501|permission denied/);

      // 4. append_conversation_message
      await expect(
        workerClient.query(`SELECT public.append_conversation_message('token', gen_random_uuid(), 'msg', '{}');`)
      ).rejects.toThrow(/42501|permission denied/);

      // 5. create_memory_item
      await expect(
        workerClient.query(`SELECT public.create_memory_item('token', 'user', 'fact', 'key', 'val', 1.0, 'explicit_user_input', null, null, null);`)
      ).rejects.toThrow(/42501|permission denied/);

      // 6. grant_memory_consent
      await expect(
        workerClient.query(`SELECT public.grant_memory_consent('token', gen_random_uuid());`)
      ).rejects.toThrow(/42501|permission denied/);

      // 7. revoke_memory_consent
      await expect(
        workerClient.query(`SELECT public.revoke_memory_consent('token', gen_random_uuid());`)
      ).rejects.toThrow(/42501|permission denied/);

      // 8. supersede_memory_item
      await expect(
        workerClient.query(`SELECT public.supersede_memory_item('token', gen_random_uuid(), 'new_val', 1.0);`)
      ).rejects.toThrow(/42501|permission denied/);

      // 9. initiate_self_privacy_purge
      await expect(
        workerClient.query(`SELECT public.initiate_self_privacy_purge('token', 'anonymize');`)
      ).rejects.toThrow(/42501|permission denied/);

      // 10. export_user_conversation_history
      await expect(
        workerClient.query(`SELECT public.export_user_conversation_history('token');`)
      ).rejects.toThrow(/42501|permission denied/);

      // 11. inspect_private_conversation
      await expect(
        workerClient.query(`SELECT public.inspect_private_conversation('token', gen_random_uuid(), 'test reason');`)
      ).rejects.toThrow(/42501|permission denied/);
    });
  });

  // Test 11: Disjoint Context Segments & System Defaults
  it('proves disjoint context segments: system_default records appear only in systemDefaults and never in memories', async () => {
    if (!isLive) return;

    // Seed system default memory as admin/superuser
    const sysKey = 'sys.safety.guideline_' + crypto.randomBytes(4).toString('hex');
    const sysVal = 'Do not divulge executive credentials or API secrets.';
    const sysRes = await adminDb!.query<{ insert_system_default_memory: string }>(`
      SELECT public.insert_system_default_memory($1, 'guideline', $2, $3, 1.0);
    `, [workspaceAId, sysKey, sysVal]);
    const sysId = sysRes.rows[0]!.insert_system_default_memory;
    await memRepo.grantConsent(scopeA1, sysId);

    // Consented user memory
    const userMem = await memRepo.create(scopeA1, {
      scope: 'user',
      category: 'preference',
      key: 'user.briefing.time',
      value: '08:00 AM daily briefing',
      provenance: 'explicit_user_input'
    });
    await memRepo.grantConsent(scopeA1, userMem.id);

    const conv = await convRepo.create(scopeA1, { title: 'Context Assembly Conv' });

    // Assemble context
    const assembled = await contextService.assembleContext(scopeA1, { conversationId: conv.id });

    // System default must be in systemDefaults segment
    const sysItem = assembled.systemDefaults.find((i) => i.key === sysKey);
    expect(sysItem).toBeDefined();
    expect(sysItem?.content).toContain(sysVal);

    // System default must NOT be in memories segment
    const memoryItemMatch = assembled.memories.find((i) => i.key === sysKey);
    expect(memoryItemMatch).toBeUndefined();

    // User memory must be in memories segment
    const userMemItem = assembled.memories.find((i) => i.key === 'user.briefing.time');
    expect(userMemItem).toBeDefined();

    // User memory must NOT be in systemDefaults segment
    const sysMemMatch = assembled.systemDefaults.find((i) => i.key === 'user.briefing.time');
    expect(sysMemMatch).toBeUndefined();
  });

  // Test 12: Deterministic Context Budgeting & Token Hard Cap
  it('proves deterministic context budgeting: hard 4096-token cap and segment limits under cl100k_base', async () => {
    if (!isLive) return;

    const conv = await convRepo.create(scopeA1, { title: 'Budget Test Conv' });

    // Append 5 standard messages
    for (let i = 0; i < 5; i++) {
      await msgRepo.append(scopeA1, conv.id, { content: `Standard message number ${i}: detailed status report.` });
    }

    // Append 1 very large message (> 2500 words to test 2048 token slice)
    const hugeContent = 'word '.repeat(3000);
    await msgRepo.append(scopeA1, conv.id, { content: hugeContent });

    const assembled = await contextService.assembleContext(scopeA1, { conversationId: conv.id });

    expect(assembled.budget.systemTokens).toBeLessThanOrEqual(1024);
    expect(assembled.budget.memoryTokens).toBeLessThanOrEqual(1024);
    expect(assembled.budget.historyTokens).toBeLessThanOrEqual(2048);
    expect(assembled.totalTokens).toBeLessThanOrEqual(4096);
  });

  // Test 13: Provenance Consistency & Ownership Validation
  it('proves provenance consistency & ownership validation on memory creation', async () => {
    if (!isLive) return;

    // 1. explicit_user_input with conversation/message ID -> ValidationError
    await expect(
      memRepo.create(scopeA1, {
        scope: 'user',
        category: 'preference',
        key: 'invalid.provenance.key',
        value: 'val',
        provenance: 'explicit_user_input',
        provenanceConversationId: crypto.randomUUID()
      })
    ).rejects.toThrow(ValidationError);

    // 2. conversation_message referencing foreign message belonging to Charlie -> ForbiddenError
    const charlieConv = await convRepo.create(scopeA2, { title: 'Charlie Private Conv For Prov' });
    const charlieMsg = await msgRepo.append(scopeA2, charlieConv.id, { content: 'Charlie note' });

    await expect(
      memRepo.create(scopeA1, {
        scope: 'user',
        category: 'fact',
        key: 'stolen.provenance.key',
        value: 'val',
        provenance: 'conversation_message',
        provenanceConversationId: charlieConv.id,
        provenanceMessageId: charlieMsg.id
      })
    ).rejects.toThrow(ForbiddenError);
  });

  // Test 14: Transaction Rollback on Failure
  it('proves transaction rollback: failed step rolls back all preceding mutations cleanly', async () => {
    if (!isLive) return;

    let createdConvId = '';

    await expect(
      appDb!.withScopedTransaction(scopeA1, async (tx) => {
        const cRepo = new ConversationRepository(tx);
        const conv = await cRepo.create(scopeA1, { title: 'Doomed Rollback Conv' });
        createdConvId = conv.id;

        // Force SQL exception in step 2
        await tx.query('SELECT 1 / 0;');
      })
    ).rejects.toThrow();

    // Verify created conversation does NOT exist in DB
    expect(createdConvId).not.toBe('');
    const fetched = await convRepo.findById(scopeA1, createdConvId);
    expect(fetched).toBeNull();
  });

  // Test 15: Sanitized Error Leakage Prevention
  it('proves database error sanitization: domain errors contain zero internal schema, table, or column details', async () => {
    if (!isLive) return;

    // Trigger not found error
    try {
      await convRepo.updateStatus(scopeA1, crypto.randomUUID(), 'closed');
      expect.unreachable('Should have thrown NotFoundError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(NotFoundError);
      expect(err.message).not.toContain('public');
      expect(err.message).not.toContain('conversations');
      expect(err.message).not.toContain('workspace_id');
    }
  });

  // Test 16: Role Separation (App vs Worker)
  it('proves role separation: worker procedures reject thaara_app (42501) and succeed under thaara_worker', async () => {
    if (!isLive) return;

    // Alice creates a privacy purge operation to test worker lease acquisition
    const purgeId = await purgeRepo.initiatePurge(scopeA1, { mode: 'history_and_memory' });

    // thaara_app calling worker outbox claim -> fails with 42501
    await expect(
      appDb!.query(`SELECT * FROM public.claim_outbox_dispatches('worker-1', 10);`)
    ).rejects.toThrow(/42501|permission denied/);

    // thaara_app calling worker purge lease acquire -> fails with 42501
    await expect(
      appDb!.query(`SELECT * FROM public.acquire_purge_lease($1, 'worker-1', 30);`, [purgeId])
    ).rejects.toThrow(/42501|permission denied/);

    // thaara_worker calling worker outbox claim -> succeeds
    const workerOutbox = new WorkerOutboxRepository(workerPool!);
    const dispatches = await workerOutbox.claimDispatches('worker-node-1', 10);
    expect(Array.isArray(dispatches)).toBe(true);

    // thaara_worker calling worker purge lease acquire -> succeeds
    const workerPurge = new WorkerPurgeRepository(workerPool!);
    const lease = await workerPurge.acquireLease(purgeId, 'worker-node-1', 30);
    expect(lease).not.toBeNull();
    expect(typeof lease?.lease_token === 'string').toBe(true);
  });
});
