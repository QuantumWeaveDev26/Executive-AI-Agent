import { describe, it, expect, beforeAll } from 'vitest';
import { PGliteDatabase } from '../src/pglite.js';
import { Migrator } from '../src/migrator.js';
import { WorkspaceRepository } from '../src/repositories/workspaces.js';
import { UserRepository } from '../src/repositories/users.js';
import { PlanRepository } from '../src/repositories/plans.js';
import { PlanStepRepository } from '../src/repositories/plan-steps.js';
import { PlanStepDependencyRepository } from '../src/repositories/plan-step-dependencies.js';
import { PlanStepApprovalBindingRepository } from '../src/repositories/plan-step-approval-bindings.js';
import { ReceiptRepository } from '../src/repositories/receipts.js';
import { ApprovalRepository } from '../src/repositories/approvals.js';
import { RequestScope, computeCanonicalParameterHash } from '@thaara/contracts';
import { AuthenticatedScope } from '../src/client.js';
import { hashSessionToken } from '../src/repositories/sessions.js';

describe('PostgreSQL RLS, Invariants, Semantic Validation & Triggers (Task 002)', () => {
  let db: PGliteDatabase;
  let workspaceAId: string;
  let workspaceBId: string;
  let userAId: string;
  let userBId: string;
  let scopeA: AuthenticatedScope;
  let scopeB: AuthenticatedScope;

  let planAId: string;
  let stepA1Id: string;
  let stepA2Id: string;

  beforeAll(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);

    // 1. Clean install: run migrations in sequence
    await migrator.migrate(migrator.loadMigrationFiles());

    // Switch to non-superuser application role thaara_app
    await db.exec('SET ROLE thaara_app;');

    const wsRepo = new WorkspaceRepository(db);
    const userRepo = new UserRepository(db);

    const wsA = await wsRepo.create('Tenant A Workspace');
    const wsB = await wsRepo.create('Tenant B Workspace');
    workspaceAId = wsA.id;
    workspaceBId = wsB.id;

    const uA = await userRepo.create('userA@tenant.com', 'hashA', 'User A');
    const uB = await userRepo.create('userB@tenant.com', 'hashB', 'User B');
    userAId = uA.id;
    userBId = uB.id;

    scopeA = {
      workspaceId: workspaceAId,
      userId: userAId,
      role: 'owner',
      sessionTokenHash: hashSessionToken('plan-token-alpha')
    };
    scopeB = {
      workspaceId: workspaceBId,
      userId: userBId,
      role: 'owner',
      sessionTokenHash: hashSessionToken('plan-token-beta')
    };

    // Seed Plan and Steps in Workspace A
    await db.withScopedTransaction(scopeA, async (txClient) => {
      const planRepo = new PlanRepository(txClient);
      const stepRepo = new PlanStepRepository(txClient);
      const depRepo = new PlanStepDependencyRepository(txClient);
      const receiptRepo = new ReceiptRepository(txClient);

      const plan = await planRepo.create(workspaceAId, userAId, 'Tenant A Governed Plan', 'Initial plan');
      planAId = plan.id;

      const hash1 = computeCanonicalParameterHash({ task: 'step1' });
      const step1 = await stepRepo.create(
        workspaceAId,
        planAId,
        0,
        'test.sample_task',
        'read',
        'low',
        'none',
        { task: 'step1' },
        hash1
      );
      stepA1Id = step1.id;

      const hash2 = computeCanonicalParameterHash({ task: 'step2' });
      const step2 = await stepRepo.create(
        workspaceAId,
        planAId,
        1,
        'test.sample_task',
        'write',
        'high',
        'explicit',
        { task: 'step2' },
        hash2
      );
      stepA2Id = step2.id;

      await depRepo.create(workspaceAId, planAId, stepA2Id, stepA1Id);

      // Transition step1 to verified with terminal receipt (through running state)
      await stepRepo.transitionStatus(workspaceAId, stepA1Id, ['ready', 'blocked'], 'running');
      await stepRepo.transitionStatus(workspaceAId, stepA1Id, 'running', 'verified');
      await receiptRepo.create(
        workspaceAId,
        planAId,
        stepA1Id,
        'test.sample_task',
        'verified',
        { done: true },
        'test_assertion'
      );
    });
  });

  describe('Migration Rerun & Semantic Validation Invariants', () => {
    it('succeeds on exact rerun of migration 0003 idempotently', async () => {
      await db.exec('RESET ROLE;');
      const migrator = new Migrator(db);
      const files = migrator.loadMigrationFiles();
      const m3 = files.find((f) => f.name.includes('0003'));
      expect(m3).toBeDefined();

      // Executing migration 0003 again against migrated database must succeed cleanly
      await db.exec(m3!.content);
      await db.exec('SET ROLE thaara_app;');
    });

    it('enforces RLS enabled and forced on all 6 Task 002 tables', async () => {
      await db.exec('RESET ROLE;');
      const tables = [
        'plans',
        'plan_steps',
        'plan_step_dependencies',
        'plan_step_approval_bindings',
        'step_executions',
        'receipts'
      ];
      for (const t of tables) {
        const res = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
          `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1;`,
          [t]
        );
        expect(res.rows[0]?.relrowsecurity).toBe(true);
        expect(res.rows[0]?.relforcerowsecurity).toBe(true);
      }
      await db.exec('SET ROLE thaara_app;');
    });
  });

  describe('Cross-Workspace & Cross-Plan Foreign Key Integrity', () => {
    it('rejects cross-workspace approval binding via composite foreign key', async () => {
      // Create approval request in Workspace B
      let approvalBId = '';
      await db.withScopedTransaction(scopeB, async (txClient) => {
        const approvalRepo = new ApprovalRepository(txClient);
        const approval = await approvalRepo.create(
          workspaceBId,
          'test.sample_task',
          { task: 'step2' },
          userBId,
          'high'
        );
        approvalBId = approval.id;
      });

      // Attempt to bind Workspace A step to Workspace B approval request
      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          const bindingRepo = new PlanStepApprovalBindingRepository(txClient);
          await bindingRepo.create(
            workspaceAId,
            planAId,
            stepA2Id,
            approvalBId, // Workspace B approval!
            computeCanonicalParameterHash({ task: 'step2' })
          );
        })
      ).rejects.toThrow();
    });

    it('rejects cross-plan dependency via composite foreign key', async () => {
      // Create a second plan in Workspace A
      let plan2Id = '';
      let stepP2Id = '';
      await db.withScopedTransaction(scopeA, async (txClient) => {
        const planRepo = new PlanRepository(txClient);
        const stepRepo = new PlanStepRepository(txClient);
        const p2 = await planRepo.create(workspaceAId, userAId, 'Plan 2');
        plan2Id = p2.id;
        const s = await stepRepo.create(
          workspaceAId,
          plan2Id,
          0,
          'test.sample_task',
          'read',
          'low',
          'none',
          {},
          computeCanonicalParameterHash({})
        );
        stepP2Id = s.id;
      });

      // Attempt to make step in Plan 1 depend on step in Plan 2
      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          const depRepo = new PlanStepDependencyRepository(txClient);
          await depRepo.create(workspaceAId, planAId, stepA2Id, stepP2Id);
        })
      ).rejects.toThrow();
    });

    it('rejects self-dependency via CHECK constraint', async () => {
      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          const depRepo = new PlanStepDependencyRepository(txClient);
          await depRepo.create(workspaceAId, planAId, stepA2Id, stepA2Id);
        })
      ).rejects.toThrow();
    });
  });

  describe('Identity Immutability & State Machine Triggers', () => {
    it('rejects changing plan identity fields (workspace_id, id, created_by_user_id)', async () => {
      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(`UPDATE plans SET workspace_id = $1 WHERE id = $2;`, [workspaceBId, planAId]);
        })
      ).rejects.toThrow(/immutable/i);
    });

    it('rejects changing step identity fields (workspace_id, plan_id, id)', async () => {
      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(`UPDATE plan_steps SET workspace_id = $1 WHERE id = $2;`, [workspaceBId, stepA1Id]);
        })
      ).rejects.toThrow(/immutable/i);
    });

    it('rejects transitioning a step from terminal status', async () => {
      // stepA1 is already 'verified' (terminal)
      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          const stepRepo = new PlanStepRepository(txClient);
          await stepRepo.transitionStatus(workspaceAId, stepA1Id, 'verified', 'running');
        })
      ).rejects.toThrow(/terminal state/i);
    });

    it('rejects modifying dependencies after plan submission (status != draft)', async () => {
      let subPlanId = '';
      let subStep1Id = '';
      let subStep2Id = '';

      await db.withScopedTransaction(scopeA, async (txClient) => {
        const planRepo = new PlanRepository(txClient);
        const stepRepo = new PlanStepRepository(txClient);
        const depRepo = new PlanStepDependencyRepository(txClient);

        const p = await planRepo.create(workspaceAId, userAId, 'Dep Test Plan');
        subPlanId = p.id;
        const s1 = await stepRepo.create(
          workspaceAId, subPlanId, 0, 'test.sample_task', 'read', 'low', 'none', {}, computeCanonicalParameterHash({})
        );
        subStep1Id = s1.id;
        const s2 = await stepRepo.create(
          workspaceAId, subPlanId, 1, 'test.sample_task', 'read', 'low', 'none', {}, computeCanonicalParameterHash({})
        );
        subStep2Id = s2.id;
        await depRepo.create(workspaceAId, subPlanId, subStep2Id, subStep1Id);

        // Submit plan to queued
        await planRepo.transitionStatus(workspaceAId, subPlanId, 'draft', 'queued');
      });

      // Attempt DELETE after submission
      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `DELETE FROM plan_step_dependencies WHERE workspace_id = $1 AND plan_id = $2;`,
            [workspaceAId, subPlanId]
          );
        })
      ).rejects.toThrow(/cannot be modified after submission/i);

      // Attempt INSERT after submission
      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO plan_step_dependencies (workspace_id, plan_id, step_id, depends_on_step_id)
             VALUES ($1, $2, $3, $4);`,
            [workspaceAId, subPlanId, subStep1Id, subStep2Id]
          );
        })
      ).rejects.toThrow(/cannot be modified after submission/i);
    });
  });

  describe('Receipt Integrity & Mutation Rejection Triggers', () => {
    it('unconditionally rejects UPDATE on receipts (both for app role and superuser trigger)', async () => {
      // 1. thaara_app role gets permission denied
      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `UPDATE receipts SET status = 'failed' WHERE plan_step_id = $1;`,
            [stepA1Id]
          );
        })
      ).rejects.toThrow(/permission denied/i);

      // 2. Even superuser gets rejected by trigger
      await db.exec('RESET ROLE;');
      await expect(
        db.query(`UPDATE receipts SET status = 'failed' WHERE plan_step_id = $1;`, [stepA1Id])
      ).rejects.toThrow(/immutable terminal records/i);
      await db.exec('SET ROLE thaara_app;');
    });

    it('unconditionally rejects DELETE on receipts (both for app role and superuser trigger)', async () => {
      // 1. thaara_app role gets permission denied
      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `DELETE FROM receipts WHERE plan_step_id = $1;`,
            [stepA1Id]
          );
        })
      ).rejects.toThrow(/permission denied/i);

      // 2. Even superuser gets rejected by trigger
      await db.exec('RESET ROLE;');
      await expect(
        db.query(`DELETE FROM receipts WHERE plan_step_id = $1;`, [stepA1Id])
      ).rejects.toThrow(/immutable terminal records/i);
      await db.exec('SET ROLE thaara_app;');
    });

    it('enforces verified_at CHECK constraint: verified requires timestamp, non-verified requires NULL', async () => {
      // Step A2 is currently 'ready'
      // Try inserting verified receipt with NULL verified_at
      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO receipts (workspace_id, plan_id, plan_step_id, action_name, status, proof, verification_method, verified_at)
             VALUES ($1, $2, $3, 'test.sample_task', 'verified', '{}'::jsonb, 'none', NULL);`,
            [workspaceAId, planAId, stepA2Id]
          );
        })
      ).rejects.toThrow();

      // Try inserting failed receipt with non-null verified_at
      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(
            `INSERT INTO receipts (workspace_id, plan_id, plan_step_id, action_name, status, proof, verification_method, verified_at)
             VALUES ($1, $2, $3, 'test.sample_task', 'failed', '{}'::jsonb, 'none', NOW());`,
            [workspaceAId, planAId, stepA2Id]
          );
        })
      ).rejects.toThrow();
    });

    it('rejects receipt status mismatch with step status', async () => {
      // Step A2 is 'ready'. Attempting to insert 'verified' receipt fails trigger
      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          const receiptRepo = new ReceiptRepository(txClient);
          await receiptRepo.create(
            workspaceAId,
            planAId,
            stepA2Id,
            'test.sample_task',
            'verified',
            { ok: true },
            'test'
          );
        })
      ).rejects.toThrow(/does not match terminal step status/i);
    });

    it('allows unverified receipt for cancelled step (in-flight cancellation exception)', async () => {
      // Transition step A2 to cancelled
      await db.withScopedTransaction(scopeA, async (txClient) => {
        const stepRepo = new PlanStepRepository(txClient);
        await stepRepo.transitionStatus(workspaceAId, stepA2Id, ['ready', 'blocked'], 'cancelled');

        const receiptRepo = new ReceiptRepository(txClient);
        const receipt = await receiptRepo.create(
          workspaceAId,
          planAId,
          stepA2Id,
          'test.sample_task',
          'unverified',
          { reason: 'Cancelled in-flight' },
          'cancellation_audit'
        );
        expect(receipt).toBeDefined();
        expect(receipt.status).toBe('unverified');
      });
    });
  });

  describe('Plan Completion Guard Trigger', () => {
    it('blocks marking plan completed if any step is not verified', async () => {
      // Plan A has stepA1 (verified) and stepA2 (cancelled)
      await db.withScopedTransaction(scopeA, async (txClient) => {
        const planRepo = new PlanRepository(txClient);
        await planRepo.transitionStatus(workspaceAId, planAId, 'draft', 'running');
      });

      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(`UPDATE plans SET status = 'completed', version = version + 1 WHERE id = $1;`, [planAId]);
        })
      ).rejects.toThrow(/not all steps are verified/i);
    });

    it('blocks marking plan completed if plan has no steps', async () => {
      let emptyPlanId = '';
      await db.withScopedTransaction(scopeA, async (txClient) => {
        const planRepo = new PlanRepository(txClient);
        const p = await planRepo.create(workspaceAId, userAId, 'Empty Plan');
        emptyPlanId = p.id;
        await planRepo.transitionStatus(workspaceAId, emptyPlanId, 'draft', 'running');
      });

      await expect(
        db.withScopedTransaction(scopeA, async (txClient) => {
          await txClient.query(`UPDATE plans SET status = 'completed', version = version + 1 WHERE id = $1;`, [emptyPlanId]);
        })
      ).rejects.toThrow(/plan has no steps/i);
    });
  });

  describe('Tenant Isolation & RLS Enforcement', () => {
    it('fails closed when direct queries are run without app.workspace_id', async () => {
      const plansRes = await db.query('SELECT * FROM plans;');
      expect(plansRes.rows.length).toBe(0);

      const stepsRes = await db.query('SELECT * FROM plan_steps;');
      expect(stepsRes.rows.length).toBe(0);

      const receiptsRes = await db.query('SELECT * FROM receipts;');
      expect(receiptsRes.rows.length).toBe(0);
    });

    it('enforces cross-tenant isolation: Tenant B cannot read Tenant A plans, steps, or receipts', async () => {
      await db.withScopedTransaction(scopeB, async (txClient) => {
        const planRepo = new PlanRepository(txClient);
        const stepRepo = new PlanStepRepository(txClient);
        const receiptRepo = new ReceiptRepository(txClient);

        const plan = await planRepo.findById(workspaceAId, planAId);
        expect(plan).toBeNull();

        const steps = await stepRepo.listByPlanId(workspaceAId, planAId);
        expect(steps.length).toBe(0);

        const receipt = await receiptRepo.findByStepId(workspaceAId, stepA1Id);
        expect(receipt).toBeNull();
      });
    });
  });
});
