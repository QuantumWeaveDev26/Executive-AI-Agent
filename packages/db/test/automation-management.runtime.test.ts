import { getIsolatedRuntimeConfig } from '../../../scripts/step74-runtime-guard.mjs';
import { AutomationActivityRepository } from '../src/repositories/automation-activity.js';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import pg from 'pg';
import { AutomationManagementRepository } from '../src/repositories/automation-management.js';
import { hashSessionToken } from '../src/repositories/sessions.js';

const isolated = getIsolatedRuntimeConfig();

describe('Step 71 real PostgreSQL automation reads (rollback-only fixtures, no migrations)', () => {
  let client: pg.Client;
  let workspaceA: string;
  let workspaceB: string;
  let userA: string;
  let userB: string;
  let planA: string;
  let planB: string;
  const tokenA = hashSessionToken(crypto.randomUUID());
  const tokenB = hashSessionToken(crypto.randomUUID());
  let repo: AutomationManagementRepository;
  beforeAll(async () => {
    const connectionString = isolated.migrationUrl;
    client = new pg.Client({ connectionString });
    await client.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '5s'");
    // Fixtures exist only inside this connection's transaction. No DDL, migrations or commits.
    async function seed(label: string, tokenHash: string) {
      const workspace = crypto.randomUUID(), user = crypto.randomUUID(), plan = crypto.randomUUID();
      await client.query('INSERT INTO workspaces (id,name) VALUES ($1,$2)', [workspace, label]);
      await client.query('INSERT INTO users (id,email,password_hash,display_name) VALUES ($1,$2,$3,$4)',
        [user, `${user}@step71.test`, 'unused-runtime-test-hash', label]);
      await client.query("INSERT INTO memberships (workspace_id,user_id,role) VALUES ($1,$2,'owner')", [workspace, user]);
      await client.query("INSERT INTO sessions (workspace_id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,NOW()+interval '1 hour')", [workspace,user,tokenHash]);
      await client.query("INSERT INTO plans (id,workspace_id,created_by_user_id,title,status,metadata) VALUES ($1,$2,$3,$4,'awaiting_approval','{}')", [plan,workspace,user,label]);
      await client.query(`INSERT INTO plan_steps (workspace_id,plan_id,step_index,action_name,action_class,risk_level,approval_mode,parameters,parameter_hash,status)
        VALUES ($1,$2,0,'automation.email.stage_workflow_artifact','write','low','explicit','{"private":"never-export-this"}',$3,'awaiting_approval')`,
        [workspace,plan,'a'.repeat(64)]);
      await client.query("INSERT INTO audit_events (workspace_id,action,target_type,target_id,payload) VALUES ($1,'plan.created','plan',$2,'{\"private\":\"never-export-this\"}')",[workspace,plan]);
      return {workspace,user,plan};
    }
    const a = await seed('Step71 runtime A',tokenA), b = await seed('Step71 runtime B',tokenB);
    workspaceA=a.workspace; userA=a.user; planA=a.plan;
    workspaceB=b.workspace; userB=b.user; planB=b.plan;
    await client.query('SET LOCAL ROLE thaara_app');
    repo = new AutomationManagementRepository(client);
  });
  afterAll(async () => {
    if (client) {
      try { await client.query('ROLLBACK'); } finally { await client.end(); }
    }
  });
  async function scope(workspaceId: string, userId: string, token: string) {
    await client.query(`SELECT set_config('app.workspace_id',$1,true),set_config('app.user_id',$2,true),
      set_config('app.role','owner',true),set_config('app.session_token_hash',$3,true)`, [workspaceId,userId,token]);
  }
  it('executes as non-superuser thaara_app with tenant RLS enabled', async () => {
    const identity=await client.query('SELECT current_user, rolsuper FROM pg_roles WHERE rolname=current_user');
    expect(identity.rows[0]).toEqual({current_user:'thaara_app',rolsuper:false});
    await scope(workspaceA,userA,tokenA);
    const list=await repo.list(workspaceA,{status:'awaiting_approval',limit:20,offset:0});
    expect(list.items.map((p)=>p.id)).toEqual([planA]);
  });
  it('blocks cross-workspace repository reads even with forged workspace arguments', async () => {
    await scope(workspaceA,userA,tokenA);
    expect((await repo.list(workspaceB)).items).toEqual([]);
    expect(await repo.detail(workspaceB,planB)).toBeNull();
  });
  it('returns tenant steps without private parameters, artifacts or raw proofs', async () => {
    await scope(workspaceB,userB,tokenB);
    const detail=await repo.detail(workspaceB,planB);
    expect(detail?.steps).toHaveLength(1);
    expect(detail?.status).toBe('awaiting_approval');
    expect(JSON.stringify(detail)).not.toContain('never-export-this');
    expect(await repo.detail(workspaceB,planA)).toBeNull();
  });
  it('fails closed without a workspace scope', async () => {
    await scope('', '', '');
    expect((await repo.list(workspaceA)).items).toEqual([]);
    expect(await repo.detail(workspaceA,planA)).toBeNull();
  });

  it('Step 72 reads scoped activity with bounded chronological pagination as thaara_app', async () => {
    await scope(workspaceA,userA,tokenA);
    const activity=new AutomationActivityRepository(client);
    const first=await activity.list(workspaceA,planA,{limit:1,offset:0});
    expect(first?.items).toHaveLength(1);
    expect(first?.items[0]).toMatchObject({event_type:'plan.created',source:'audit'});
    expect(first?.nextOffset).toBe(1);
    const next=await activity.list(workspaceA,planA,{limit:1,offset:1});
    expect(next?.items[0]).toMatchObject({event_type:'step.status_observed',status:'awaiting_approval',source:'step_record'});
    expect(next?.nextOffset).toBeNull();
    expect(JSON.stringify([first,next])).not.toContain('never-export-this');
  });
  it('Step 72 rejects cross-workspace activity arguments under real RLS', async () => {
    await scope(workspaceA,userA,tokenA);
    const activity=new AutomationActivityRepository(client);
    expect(await activity.list(workspaceB,planB)).toBeNull();
    expect(await activity.list(workspaceA,planB)).toBeNull();
    await scope(workspaceB,userB,tokenB);
    expect((await activity.list(workspaceB,planB))?.items.some(e=>e.event_type==='plan.created')).toBe(true);
  });
  it('Step 72 fails closed on activity reads without authenticated workspace scope', async () => {
    await scope('','','');
    expect(await new AutomationActivityRepository(client).list(workspaceA,planA)).toBeNull();
  });

  it('Step 73 captures future events as thaara_app and displays each receipt and attempt once',async()=>{
    await scope(workspaceA,userA,tokenA);
    await client.query('SAVEPOINT step73_capture');
    try {
      const {PlanRepository}=await import('../src/repositories/plans.js');
      const {PlanStepRepository}=await import('../src/repositories/plan-steps.js');
      const {StepExecutionRepository}=await import('../src/repositories/step-executions.js');
      const {ReceiptRepository}=await import('../src/repositories/receipts.js');
      const {ApprovalRepository}=await import('../src/repositories/approvals.js');
      const {PlanStepApprovalBindingRepository}=await import('../src/repositories/plan-step-approval-bindings.js');
      const {AuditEventRepository}=await import('../src/repositories/audit.js');
      const plans=new PlanRepository(client), steps=new PlanStepRepository(client), executions=new StepExecutionRepository(client);
      const plan=await plans.create(workspaceA,userA,'Step73 local runtime');
      const step=await steps.create(workspaceA,plan.id,0,'automation.email.compose_workflow','read','low','none',
        {private:'STEP73-PRIVATE-PARAMETER'},'a'.repeat(64));
      const approvals=new ApprovalRepository(client);
      const approval=await approvals.create(workspaceA,step.action_name,{private:'STEP73-PRIVATE-APPROVAL'},userA,'low');
      await new PlanStepApprovalBindingRepository(client).create(workspaceA,plan.id,step.id,approval.id,step.parameter_hash);
      await approvals.transitionStatus(workspaceA,approval.id,'pending','approved',userA);
      await plans.transitionStatus(workspaceA,plan.id,'draft','running');
      await steps.transitionStatus(workspaceA,step.id,'blocked','queued');
      const key=crypto.randomUUID(),token=crypto.randomUUID();
      await executions.acquireLease(workspaceA,plan.id,step.id,key,'STEP73-PRIVATE-WORKER',token);
      expect(await executions.acquireLease(workspaceA,plan.id,step.id,key,'duplicate',crypto.randomUUID())).toBeNull();
      await steps.transitionStatus(workspaceA,step.id,'queued','running');
      await steps.transitionStatus(workspaceA,step.id,'running','verified');
      const receipt=await new ReceiptRepository(client).create(workspaceA,plan.id,step.id,step.action_name,'verified',
        {artifact:'STEP73-PRIVATE-PROOF'},'offline_runtime');
      await plans.transitionStatus(workspaceA,plan.id,'running','completed');
      expect(await plans.transitionStatus(workspaceA,plan.id,'running','completed')).toBeNull();
      const timeline=await new AutomationActivityRepository(client).list(workspaceA,plan.id,{limit:100});
      expect(timeline?.items.every(e=>e.source==='audit')).toBe(true);
      expect(timeline?.items.map(e=>e.event_type)).toEqual([
        'plan.created','approval.requested','approval.approved','step.queued','step.started','step.completed','plan.completed']);
      expect(timeline?.items.filter(e=>e.receipt_id===receipt.id)).toHaveLength(1);
      expect(timeline?.items.find(e=>e.event_type==='step.started')?.attempt_number).toBe(1);
      const captured=(await new AuditEventRepository(client).listByWorkspace(workspaceA,100)).events;
      expect(captured.filter(e=>e.target_id===plan.id||e.target_id===step.id||e.target_id===approval.id)
        .every(e=>e.actor_user_id===userA)).toBe(true);
      expect(JSON.stringify(captured)).not.toContain('STEP73-PRIVATE-');
      expect(JSON.stringify(captured)).not.toContain(token);
      expect(JSON.stringify(timeline)).not.toContain('STEP73-PRIVATE-');
      const denied=await steps.transitionStatus(workspaceB,step.id,'verified','queued');
      expect(denied).toBeNull();
    } finally {await client.query('ROLLBACK TO SAVEPOINT step73_capture');await client.query('RELEASE SAVEPOINT step73_capture');}
  });
  it('Step 73 RLS refuses forged workspace audit writes and leaves no persisted event',async()=>{
    await scope(workspaceA,userA,tokenA);
    await client.query('SAVEPOINT step73_rls');
    try {
      const {AuditEventRepository}=await import('../src/repositories/audit.js');
      await expect(new AuditEventRepository(client).create(workspaceB,'step.queued','plan_step',{},null,crypto.randomUUID()))
        .rejects.toThrow(/row.level security/i);
    } finally {await client.query('ROLLBACK TO SAVEPOINT step73_rls');await client.query('RELEASE SAVEPOINT step73_rls');}
  });
  it('Step 73 timeline ignores malformed attempt metadata without leaking payloads or throwing',async()=>{
    await scope(workspaceA,userA,tokenA);
    await client.query('SAVEPOINT step73_metadata');
    try {
      const {AuditEventRepository}=await import('../src/repositories/audit.js');
      const step=(await client.query('SELECT id FROM plan_steps WHERE workspace_id=$1 AND plan_id=$2',[workspaceA,planA])).rows[0].id;
      for(const value of ['999999999999999999999999999','-1','NaN',{},'PRIVATE-ATTEMPT']) {
        await new AuditEventRepository(client).create(workspaceA,'step.retry_scheduled','plan_step',
          {attemptNumber:value,private:'PRIVATE-PAYLOAD'},null,step);
      }
      const result=await new AutomationActivityRepository(client).list(workspaceA,planA,{limit:100});
      const retries=result?.items.filter(e=>e.event_type==='step.retry_scheduled');
      expect(retries).toHaveLength(5);
      expect(retries?.every(e=>e.attempt_number===null&&e.status==='queued')).toBe(true);
      expect(JSON.stringify(result)).not.toContain('PRIVATE-');
    } finally {await client.query('ROLLBACK TO SAVEPOINT step73_metadata');await client.query('RELEASE SAVEPOINT step73_metadata');}
  });
});
