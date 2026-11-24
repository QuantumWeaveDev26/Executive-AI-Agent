import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import {
  PGliteDatabase,
  Migrator,
  WorkspaceRepository,
  UserRepository,
  MembershipRepository,
  SessionRepository,
  PlanStepDependencyRepository,
  generateSessionToken,
  hashSessionToken
} from '@thaara/db';
import { loadConfig } from '@thaara/config';
import { computeCanonicalParameterHash } from '@thaara/contracts';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE_NAME, CSRF_COOKIE_NAME } from '../src/plugins/auth.js';
import { generateCsrfToken } from '../src/crypto/csrf.js';

describe('Governed Plan Execution API (/api/v1/plans)', () => {
  let app: FastifyInstance;
  let db: PGliteDatabase;

  let workspaceAId: string;
  let workspaceBId: string;
  let userAId: string;
  let userBId: string;
  let sessionTokenA: string;
  let sessionTokenB: string;
  let csrfTokenA: string;
  let csrfTokenB: string;

  beforeEach(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());

    const wsRepo = new WorkspaceRepository(db);
    const userRepo = new UserRepository(db);

    // Tenant A
    const wsA = await wsRepo.create('Tenant A Corp');
    workspaceAId = wsA.id;
    const userA = await userRepo.create('alice@tenanta.com', 'hashA', 'Alice Plan Owner');
    userAId = userA.id;
    sessionTokenA = generateSessionToken();
    const scopeA = {
      workspaceId: wsA.id,
      userId: userA.id,
      role: 'owner' as const,
      sessionTokenHash: hashSessionToken(sessionTokenA)
    };
    await db.withScopedTransaction(scopeA, async (tx) => {
      const mRepo = new MembershipRepository(tx);
      const sRepo = new SessionRepository(tx);
      await mRepo.create(wsA.id, userA.id, 'owner');
      await sRepo.create(userA.id, wsA.id, sessionTokenA);
    });
    csrfTokenA = generateCsrfToken();

    // Tenant B
    const wsB = await wsRepo.create('Tenant B Corp');
    workspaceBId = wsB.id;
    const userB = await userRepo.create('bob@tenantb.com', 'hashB', 'Bob Plan Owner');
    userBId = userB.id;
    sessionTokenB = generateSessionToken();
    const scopeB = {
      workspaceId: wsB.id,
      userId: userB.id,
      role: 'owner' as const,
      sessionTokenHash: hashSessionToken(sessionTokenB)
    };
    await db.withScopedTransaction(scopeB, async (tx) => {
      const mRepo = new MembershipRepository(tx);
      const sRepo = new SessionRepository(tx);
      await mRepo.create(wsB.id, userB.id, 'owner');
      await sRepo.create(userB.id, wsB.id, sessionTokenB);
    });
    csrfTokenB = generateCsrfToken();

    const config = loadConfig({ NODE_ENV: 'test' });
    app = await buildApp({ db, config });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const authHeadersA = () => ({
    cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`,
    'x-csrf-token': csrfTokenA
  });

  const authHeadersB = () => ({
    cookie: `${SESSION_COOKIE_NAME}=${sessionTokenB}; ${CSRF_COOKIE_NAME}=${csrfTokenB}`,
    'x-csrf-token': csrfTokenB
  });

  it('creates a draft plan and appends steps with canonical parameter hashing', async () => {
    // 1. Create plan
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/plans',
      headers: authHeadersA(),
      payload: {
        title: 'Alpha Migration Plan',
        description: 'Multi-step database upgrade',
        metadata: { priority: 'high' }
      }
    });

    expect(createRes.statusCode).toBe(201);
    const plan = JSON.parse(createRes.body);
    expect(plan.id).toBeDefined();
    expect(plan.title).toBe('Alpha Migration Plan');
    expect(plan.status).toBe('draft');
    expect(plan.workspace_id).toBe(workspaceAId);
    expect(plan.created_by_user_id).toBe(userAId);
    expect(plan.version).toBe(1);

    // 2. Add Step 1 (read action)
    const step1Payload = {
      action_name: 'system.read_status',
      action_class: 'read',
      risk_level: 'low',
      approval_mode: 'none',
      parameters: {}
    };
    const expectedHash1 = computeCanonicalParameterHash(step1Payload.parameters);

    const step1Res = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/steps`,
      headers: authHeadersA(),
      payload: step1Payload
    });

    expect(step1Res.statusCode).toBe(201);
    const step1 = JSON.parse(step1Res.body);
    expect(step1.id).toBeDefined();
    expect(step1.plan_id).toBe(plan.id);
    expect(step1.step_index).toBe(0);
    expect(step1.action_name).toBe('system.read_status');
    expect(step1.parameter_hash).toBe(expectedHash1);
    expect(step1.status).toBe('blocked');

    // 3. Add Step 2 (write action depending on Step 1)
    const step2Payload = {
      action_name: 'system.reset_connector',
      action_class: 'write',
      risk_level: 'high',
      approval_mode: 'explicit',
      parameters: { connectorName: 'cluster-a' },
      depends_on_step_ids: [step1.id]
    };
    const expectedHash2 = computeCanonicalParameterHash(step2Payload.parameters);

    const step2Res = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/steps`,
      headers: authHeadersA(),
      payload: step2Payload
    });

    expect(step2Res.statusCode).toBe(201);
    const step2 = JSON.parse(step2Res.body);
    expect(step2.step_index).toBe(1);
    expect(step2.parameter_hash).toBe(expectedHash2);
    expect(step2.depends_on_step_ids).toEqual([step1.id]);

    // 4. Retrieve plan with steps
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/plans/${plan.id}`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}`
      }
    });

    expect(getRes.statusCode).toBe(200);
    const planDetails = JSON.parse(getRes.body);
    expect(planDetails.steps.length).toBe(2);
    expect(planDetails.steps[0].id).toBe(step1.id);
    expect(planDetails.steps[1].id).toBe(step2.id);
  });

  it('rejects step addition with non-existent dependency ID with 400 VALIDATION_ERROR', async () => {
    // 1. Create plan
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/plans',
      headers: authHeadersA(),
      payload: { title: 'Invalid Dep Plan' }
    });
    const plan = JSON.parse(createRes.body);

    // 2. Try to add step with random non-existent dependency
    const fakeStepId = '00000000-0000-0000-0000-000000000001';
    const stepRes = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/steps`,
      headers: authHeadersA(),
      payload: {
        action_name: 'system.read_status',
        action_class: 'read',
        risk_level: 'low',
        approval_mode: 'none',
        parameters: {},
        depends_on_step_ids: [fakeStepId]
      }
    });

    expect(stepRes.statusCode).toBe(400);
    const errBody = JSON.parse(stepRes.body);
    expect(errBody.error.code).toBe('VALIDATION_ERROR');
    expect(errBody.error.message).toContain(`Dependency step '${fakeStepId}' does not exist in plan`);
  });

  it('rejects plan submission when a cycle is detected in the DAG', async () => {
    // 1. Create plan
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/plans',
      headers: authHeadersA(),
      payload: { title: 'Cyclic DAG Plan' }
    });
    const plan = JSON.parse(createRes.body);

    // 2. Create 2 steps
    const s1Res = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/steps`,
      headers: authHeadersA(),
      payload: {
        action_name: 'system.read_status',
        action_class: 'read',
        risk_level: 'low',
        approval_mode: 'none',
        parameters: {}
      }
    });
    const step1 = JSON.parse(s1Res.body);

    const s2Res = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/steps`,
      headers: authHeadersA(),
      payload: {
        action_name: 'system.read_status',
        action_class: 'read',
        risk_level: 'low',
        approval_mode: 'none',
        parameters: {},
        depends_on_step_ids: [step1.id]
      }
    });
    const step2 = JSON.parse(s2Res.body);

    // Inject a back-edge into step 1 to form a cycle: step1 depends on step2
    const scopeA = {
      workspaceId: workspaceAId,
      userId: userAId,
      role: 'owner' as const,
      sessionTokenHash: hashSessionToken(sessionTokenA)
    };
    await db.withScopedTransaction(scopeA, async (txClient) => {
      const depRepo = new PlanStepDependencyRepository(txClient);
      await depRepo.create(workspaceAId, plan.id, step1.id, step2.id);
    });

    // 3. Submit plan should detect cycle and fail with 400
    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/submit`,
      headers: authHeadersA()
    });

    expect(submitRes.statusCode).toBe(400);
    const errBody = JSON.parse(submitRes.body);
    expect(errBody.error.code).toBe('VALIDATION_ERROR');
    expect(errBody.error.message).toContain('Cyclic dependency detected');
  });

  it('submits plan with mutating write step: binds approval request and transitions plan to awaiting_approval', async () => {
    // 1. Create plan
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/plans',
      headers: authHeadersA(),
      payload: { title: 'Mutation Execution Plan' }
    });
    const plan = JSON.parse(createRes.body);

    // 2. Add write step with approval_mode: explicit
    const writeStepRes = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/steps`,
      headers: authHeadersA(),
      payload: {
        action_name: 'system.reset_connector',
        action_class: 'write',
        risk_level: 'high',
        approval_mode: 'explicit',
        parameters: { connectorName: 'prod-01' }
      }
    });
    const writeStep = JSON.parse(writeStepRes.body);

    // 3. Submit plan
    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/submit`,
      headers: authHeadersA()
    });

    expect(submitRes.statusCode).toBe(200);
    const submitBody = JSON.parse(submitRes.body);
    expect(submitBody.plan.status).toBe('awaiting_approval');
    expect(submitBody.approval_requests_created).toBe(1);

    // 4. Verify step has bound approval_request_id and status awaiting_approval
    const planDetailsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/plans/${plan.id}`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}`
      }
    });
    const details = JSON.parse(planDetailsRes.body);
    const stepInDb = details.steps.find((s: any) => s.id === writeStep.id);
    expect(stepInDb.status).toBe('awaiting_approval');
    expect(stepInDb.approval_request_id).not.toBeNull();
  });

  it('submits read-only plan: transitions plan directly to queued and enqueues root steps', async () => {
    // 1. Create plan
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/plans',
      headers: authHeadersA(),
      payload: { title: 'Read-Only Inspection Plan' }
    });
    const plan = JSON.parse(createRes.body);

    // 2. Add read-only step with approval_mode: none
    const stepRes = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/steps`,
      headers: authHeadersA(),
      payload: {
        action_name: 'system.read_status',
        action_class: 'read',
        risk_level: 'low',
        approval_mode: 'none',
        parameters: {}
      }
    });
    const step = JSON.parse(stepRes.body);

    // 3. Submit plan
    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/submit`,
      headers: authHeadersA()
    });

    expect(submitRes.statusCode).toBe(200);
    const submitBody = JSON.parse(submitRes.body);
    expect(submitBody.plan.status).toBe('queued');
    expect(submitBody.approval_requests_created).toBe(0);
    expect(submitBody.steps_queued).toBe(1);

    // Verify step status is queued
    const planDetailsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/plans/${plan.id}`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}`
      }
    });
    const details = JSON.parse(planDetailsRes.body);
    expect(details.steps[0].status).toBe('queued');
  });

  it('cancels an active plan and cascades cancellation to all non-terminal steps', async () => {
    // 1. Create plan and 2 steps
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/plans',
      headers: authHeadersA(),
      payload: { title: 'Plan to Cancel' }
    });
    const plan = JSON.parse(createRes.body);

    await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/steps`,
      headers: authHeadersA(),
      payload: {
        action_name: 'system.read_status',
        action_class: 'read',
        risk_level: 'low',
        approval_mode: 'none',
        parameters: {}
      }
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/steps`,
      headers: authHeadersA(),
      payload: {
        action_name: 'system.read_status',
        action_class: 'read',
        risk_level: 'low',
        approval_mode: 'none',
        parameters: {}
      }
    });

    // 2. Submit plan
    await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/submit`,
      headers: authHeadersA()
    });

    // 3. Cancel plan
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/cancel`,
      headers: authHeadersA()
    });

    expect(cancelRes.statusCode).toBe(200);
    const cancelBody = JSON.parse(cancelRes.body);
    expect(cancelBody.plan.status).toBe('cancelled');
    expect(cancelBody.steps_cancelled).toBe(2);

    // Verify steps in DB
    const planDetailsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/plans/${plan.id}`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenA}`
      }
    });
    const details = JSON.parse(planDetailsRes.body);
    expect(details.status).toBe('cancelled');
    expect(details.steps.every((s: any) => s.status === 'cancelled')).toBe(true);
  });

  it('enforces cross-tenant isolation: Tenant B cannot read, modify, submit, or cancel Tenant A plans', async () => {
    // 1. Create plan under Tenant A
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/plans',
      headers: authHeadersA(),
      payload: { title: 'Tenant A Confidential Plan' }
    });
    const planA = JSON.parse(createRes.body);

    // 2. Tenant B GET /plans/:id -> 404 NOT_FOUND
    const getResB = await app.inject({
      method: 'GET',
      url: `/api/v1/plans/${planA.id}`,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenB}`
      }
    });
    expect(getResB.statusCode).toBe(404);

    // 3. Tenant B GET /plans (list) does not include Tenant A's plan
    const listResB = await app.inject({
      method: 'GET',
      url: '/api/v1/plans',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionTokenB}`
      }
    });
    expect(listResB.statusCode).toBe(200);
    const listB = JSON.parse(listResB.body);
    expect(listB.find((p: any) => p.id === planA.id)).toBeUndefined();

    // 4. Tenant B POST /plans/:id/steps -> 404 NOT_FOUND
    const addStepResB = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${planA.id}/steps`,
      headers: authHeadersB(),
      payload: {
        action_name: 'system.read_status',
        action_class: 'read',
        risk_level: 'low',
        approval_mode: 'none',
        parameters: {}
      }
    });
    expect(addStepResB.statusCode).toBe(404);

    // 5. Tenant B POST /plans/:id/submit -> 404 NOT_FOUND
    const submitResB = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${planA.id}/submit`,
      headers: authHeadersB()
    });
    expect(submitResB.statusCode).toBe(404);

    // 6. Tenant B POST /plans/:id/cancel -> 404 NOT_FOUND
    const cancelResB = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${planA.id}/cancel`,
      headers: authHeadersB()
    });
    expect(cancelResB.statusCode).toBe(404);
  });

  it('rejects a client that downgrades a registered write action to read/no approval', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/v1/plans',
      headers: authHeadersA(), payload: { title: 'Forged Action' } });
    const plan = JSON.parse(create.body);
    const res = await app.inject({ method: 'POST',
      url: `/api/v1/plans/${plan.id}/steps`, headers: authHeadersA(), payload: {
        action_name: 'system.reset_connector', action_class: 'read',
        risk_level: 'low', approval_mode: 'none',
        parameters: { connectorName: 'prod' }
      } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unregistered actions instead of defaulting to low-risk read', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/v1/plans',
      headers: authHeadersA(), payload: { title: 'Unknown Action' } });
    const plan = JSON.parse(create.body);
    const res = await app.inject({ method: 'POST',
      url: `/api/v1/plans/${plan.id}/steps`, headers: authHeadersA(), payload: {
        action_name: 'unregistered.action', parameters: {}
      } });
    expect(res.statusCode).toBe(400);
  });

  it('derives sensitive action metadata from catalog when caller omits overrides', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/v1/plans',
      headers: authHeadersA(), payload: { title: 'Catalog Action' } });
    const plan = JSON.parse(create.body);
    const res = await app.inject({ method: 'POST',
      url: `/api/v1/plans/${plan.id}/steps`, headers: authHeadersA(), payload: {
        action_name: 'system.reset_connector', parameters: { connectorName: 'test' }
      } });
    expect(res.statusCode).toBe(201);
    const step = JSON.parse(res.body);
    expect(step.action_class).toBe('write');
    expect(step.risk_level).toBe('high');
    expect(step.approval_mode).toBe('explicit');
  });

  it('Step 64B: handles early approval on dependent step C without invalid DB state transition or premature queueing', async () => {
    const composeParams = {
      workflowName: 'Lead Welcome Follow-Up',
      triggerType: 'new_lead_inquiry',
      recipientVariable: 'customer_email',
      emailSubject: 'Welcome {{customer_name}}!',
      emailBodyTemplate: 'Hi {{customer_name}}, thanks for reaching out about {{topic}}.',
      allowedVariables: ['customer_email', 'customer_name', 'topic'],
      followUpConditions: [
        { field: 'topic', operator: 'equals', value: 'enterprise', delayMinutes: 15 }
      ]
    };
    const dryRunParams = {
      ...composeParams,
      sampleData: {
        customer_email: 'priya@example.com',
        customer_name: 'Priya',
        topic: 'enterprise'
      }
    };

    const pRes = await app.inject({
      method: 'POST',
      url: '/api/v1/plans',
      headers: authHeadersA(),
      payload: { title: '3-Step Email Automation Plan (Early Approval)' }
    });
    const plan = JSON.parse(pRes.body);

    const sARes = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/steps`,
      headers: authHeadersA(),
      payload: { action_name: 'automation.email.compose_workflow', parameters: composeParams }
    });
    const stepA = JSON.parse(sARes.body);

    const sBRes = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/steps`,
      headers: authHeadersA(),
      payload: {
        action_name: 'automation.email.dry_run_test',
        parameters: dryRunParams,
        depends_on_step_ids: [stepA.id]
      }
    });
    const stepB = JSON.parse(sBRes.body);

    const sCRes = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/steps`,
      headers: authHeadersA(),
      payload: {
        action_name: 'test.approval_gated_hash_task',
        parameters: { task: 'stage_verified_blueprint', workflowName: 'Lead Welcome Follow-Up' },
        depends_on_step_ids: [stepB.id]
      }
    });
    const stepC = JSON.parse(sCRes.body);

    const subRes = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/submit`,
      headers: authHeadersA()
    });
    expect(subRes.statusCode).toBe(200);

    const detailBefore = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/plans/${plan.id}`, headers: authHeadersA() })).body
    );
    const stepCBefore = detailBefore.steps.find((s: any) => s.id === stepC.id);
    expect(stepCBefore.approval_request_id).toBeDefined();

    // Early approval before Step A or Step B has completed
    const decideRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${stepCBefore.approval_request_id}/decide`,
      headers: authHeadersA(),
      payload: { status: 'approved' }
    });
    expect(decideRes.statusCode).toBe(200);
    expect(JSON.parse(decideRes.body).status).toBe('approved');

    // Step C must NOT be queued prematurely while Step B is still blocked
    const detailAfter = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/plans/${plan.id}`, headers: authHeadersA() })).body
    );
    const stepCAfter = detailAfter.steps.find((s: any) => s.id === stepC.id);
    expect(stepCAfter.status).toBe('awaiting_approval');
  });

  it('Step 64B: rejecting an approval fails the step, emits a failed receipt, fails the parent plan, and cancels remaining steps', async () => {
    const pRes = await app.inject({
      method: 'POST',
      url: '/api/v1/plans',
      headers: authHeadersA(),
      payload: { title: 'Plan With Rejected Approval' }
    });
    const plan = JSON.parse(pRes.body);

    const sARes = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/steps`,
      headers: authHeadersA(),
      payload: { action_name: 'system.read_status', parameters: {} }
    });
    const stepA = JSON.parse(sARes.body);

    const sCRes = await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/steps`,
      headers: authHeadersA(),
      payload: {
        action_name: 'test.approval_gated_hash_task',
        parameters: { task: 'stage_verified_blueprint' },
        depends_on_step_ids: [stepA.id]
      }
    });
    const stepC = JSON.parse(sCRes.body);

    await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${plan.id}/submit`,
      headers: authHeadersA()
    });

    const detailBefore = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/plans/${plan.id}`, headers: authHeadersA() })).body
    );
    const approvalId = detailBefore.steps.find((s: any) => s.id === stepC.id).approval_request_id;

    const rejectRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${approvalId}/decide`,
      headers: authHeadersA(),
      payload: { status: 'rejected' }
    });
    expect(rejectRes.statusCode).toBe(200);

    const detailAfter = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/plans/${plan.id}`, headers: authHeadersA() })).body
    );
    expect(detailAfter.status).toBe('failed');
    expect(detailAfter.steps.find((s: any) => s.id === stepA.id).status).toBe('cancelled');
    expect(detailAfter.steps.find((s: any) => s.id === stepC.id).status).toBe('failed');
    expect(detailAfter.receipts.length).toBe(1);
    expect(detailAfter.receipts[0].status).toBe('failed');
    expect(detailAfter.receipts[0].plan_step_id).toBe(stepC.id);
    await db.withScopedTransaction({
      workspaceId:workspaceAId,userId:userAId,role:'owner',
      sessionTokenHash:hashSessionToken(sessionTokenA)
    },async tx=>{
      const rows=(await tx.query<{action:string;target_id:string}>(
        'SELECT action,target_id FROM audit_events WHERE workspace_id=$1',[workspaceAId])).rows;
      expect(rows.filter(e=>e.action==='approval.created'&&e.target_id===approvalId)).toHaveLength(1);
      expect(rows.filter(e=>e.action==='approval.rejected'&&e.target_id===approvalId)).toHaveLength(1);
      expect(rows.filter(e=>e.action==='step.failed'&&e.target_id===stepC.id)).toHaveLength(1);
      expect(rows.filter(e=>e.action==='plan.failed'&&e.target_id===plan.id)).toHaveLength(1);
    });
  });
});
