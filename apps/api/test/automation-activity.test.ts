import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { PGliteDatabase, Migrator, WorkspaceRepository, UserRepository, MembershipRepository, SessionRepository, generateSessionToken, hashSessionToken } from '@thaara/db';
import { loadConfig } from '@thaara/config';
import { buildApp } from '../src/app.js';
import { SESSION_COOKIE_NAME } from '../src/plugins/auth.js';

describe('Step 72 automation activity API', () => {
  let db: PGliteDatabase, app: FastifyInstance;
  let workspace: string, user: string, token: string, otherToken: string, revokedToken: string;
  let plan: string, step: string, approval: string, foreignPlan: string, foreignWorkspace: string, unrelatedPlan: string;
  const enqueue = vi.fn();
  const outcomePlans:Record<string,string>={};
  const at = (minute: number) => `2026-10-16T10:${String(minute).padStart(2,'0')}:00.000Z`;
  const headers = () => ({ cookie: `${SESSION_COOKIE_NAME}=${token}` });
  const url = (query = '') => `/api/v1/automations/${plan}/activity${query}`;
  beforeAll(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());
    async function identity(name: string) {
      const ws = await new WorkspaceRepository(db).create(name);
      const u = await new UserRepository(db).create(`${name}@step72.test`, 'test-only-hash', name);
      const t = generateSessionToken();
      await db.withScopedTransaction({ workspaceId: ws.id, userId: u.id, role: 'viewer', sessionTokenHash: hashSessionToken(t) }, async tx => {
        await new MembershipRepository(tx).create(ws.id, u.id, 'viewer');
        await new SessionRepository(tx).create(u.id, ws.id, t);
      });
      return { ws: ws.id, user: u.id, token: t };
    }
    const a = await identity('timeline-a'), b = await identity('timeline-b'), revoked = await identity('timeline-revoked');
    workspace = a.ws; user = a.user; token = a.token; otherToken = b.token; revokedToken = revoked.token;
    foreignWorkspace = b.ws;
    await db.query('UPDATE sessions SET revoked_at=NOW() WHERE token_hash=$1', [hashSessionToken(revokedToken)]);
    async function seedPlan(ws: string, uid: string, title: string, action: string) {
      const p = crypto.randomUUID(), s = crypto.randomUUID();
      await db.query(`INSERT INTO plans (id,workspace_id,created_by_user_id,title,status,created_at,updated_at,metadata)
        VALUES ($1,$2,$3,$4,'completed',$5,$6,'{"secret":"PRIVATE-PARAMETER"}')`, [p,ws,uid,title,at(0),at(8)]);
      await db.query(`INSERT INTO plan_steps (id,workspace_id,plan_id,step_index,action_name,action_class,risk_level,approval_mode,parameters,parameter_hash,status,created_at,updated_at)
        VALUES ($1,$2,$3,0,$4,'write','low','explicit','{"token":"PRIVATE-PARAMETER"}',$5,'verified',$6,$7)`, [s,ws,p,action,'a'.repeat(64),at(1),at(7)]);
      return { p,s };
    }
    const own = await seedPlan(workspace,user,'Own automation','automation.email.stage_workflow_artifact');
    plan = own.p; step = own.s;
    foreignPlan = (await seedPlan(b.ws,b.user,'Foreign automation','automation.email.compose_workflow')).p;
    unrelatedPlan = (await seedPlan(workspace,user,'Unrelated plan','system.read_status')).p;
    approval = crypto.randomUUID();
    await db.query(`INSERT INTO approval_requests (id,workspace_id,action_name,action_params,requester_user_id,approver_user_id,status,risk_level,created_at,updated_at,expires_at)
      VALUES ($1,$2,'automation.email.stage_workflow_artifact','{"private":"PRIVATE-APPROVAL"}',$3,$3,'approved','low',$4,$5,$6)`,
      [approval,workspace,user,at(2),at(3),'2026-10-17T10:00:00.000Z']);
    await db.query(`INSERT INTO plan_step_approval_bindings (workspace_id,plan_id,step_id,approval_request_id,parameter_hash)
      VALUES ($1,$2,$3,$4,$5)`, [workspace,plan,step,approval,'a'.repeat(64)]);
    await db.query(`INSERT INTO step_executions (workspace_id,plan_id,step_id,idempotency_key,worker_id,lease_token,attempt_number,status,started_at,lease_expires_at,completed_at)
      VALUES ($1,$2,$3,'PRIVATE-IDEMPOTENCY','PRIVATE-WORKER',$4,2,'completed',$5,$6,$7)`, [workspace,plan,step,crypto.randomUUID(),at(5),at(9),at(7)]);
    await db.query(`INSERT INTO receipts (workspace_id,plan_id,plan_step_id,action_name,status,proof,verification_method,issued_at,verified_at)
      VALUES ($1,$2,$3,'automation.email.stage_workflow_artifact','verified','{"stagedArtifact":"PRIVATE-ARTIFACT"}','PRIVATE-VERIFICATION-METHOD',$4,$4)`, [workspace,plan,step,at(7)]);
    async function audit(action: string, targetType: string, targetId: string, minute: number, payload: object = {}) {
      await db.query(`INSERT INTO audit_events (workspace_id,action,target_type,target_id,payload,created_at,id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [workspace,action,targetType,targetId,JSON.stringify({secret:'PRIVATE-AUDIT',...payload}),at(minute),action==='plan.submitted'?'00000000-0000-0000-0000-000000000072':crypto.randomUUID()]);
    }
    await audit('plan.created','plan',plan,0);
    await audit('plan.submitted','plan',plan,4,{status:'PRIVATE-UNTRUSTED-STATUS'});
    await audit('step.queued','plan_step',step,4);
    await audit('approval.approved','approval_request',approval,3);
    await audit('plan.completed','plan',plan,8);
    // Payload plan IDs alone must never establish activity ownership.
    await audit('plan.cancelled','plan',foreignPlan,9,{planId:plan});
    await audit('step.started','plan_step',crypto.randomUUID(),9,{planId:plan,stepId:step});
    await audit('step.queued','plan_step','not-a-uuid-target',9,{planId:plan});
    await audit('unknown.SECRET-ACTION','plan',plan,9);

    for (const state of ['failed','unverified','cancelled','queued']) {
      const id=crypto.randomUUID(),sid=crypto.randomUUID();
      outcomePlans[state]=id;
      const ps=state==='unverified'?'failed':state;
      await db.query("INSERT INTO plans (id,workspace_id,created_by_user_id,title,status,created_at,updated_at) VALUES ($1,$2,$3,'Outcome fixture',$4,$5,$6)",
        [id,workspace,user,ps,at(0),at(8)]);
      await db.query(`INSERT INTO plan_steps (id,workspace_id,plan_id,step_index,action_name,action_class,risk_level,approval_mode,parameters,parameter_hash,status,updated_at)
        VALUES ($1,$2,$3,0,'automation.email.compose_workflow','write','low','none','{}',$4,$5,$6)`,
        [sid,workspace,id,'a'.repeat(64),state,at(7)]);
      if(state==='failed'||state==='unverified') {
        await db.query(`INSERT INTO receipts (workspace_id,plan_id,plan_step_id,action_name,status,proof,verification_method,issued_at)
          VALUES ($1,$2,$3,'automation.email.compose_workflow',$4,'{"private":"PRIVATE-OUTCOME"}','offline_test',$5)`,
          [workspace,id,sid,state,at(7)]);
        if(state==='unverified') await audit('step.failed','plan_step',sid,7,{receiptStatus:'unverified'});
      }
      if(state==='failed') {
        const aid=crypto.randomUUID();
        await db.query(`INSERT INTO approval_requests (id,workspace_id,action_name,action_params,requester_user_id,status,risk_level,created_at,updated_at,expires_at)
          VALUES ($1,$2,'automation.email.compose_workflow','{}',$3,'rejected','low',$4,$5,$6)`,
          [aid,workspace,user,at(2),at(3),'2026-10-17T10:00:00.000Z']);
        await db.query("INSERT INTO plan_step_approval_bindings (workspace_id,plan_id,step_id,approval_request_id,parameter_hash) VALUES ($1,$2,$3,$4,$5)",
          [workspace,id,sid,aid,'a'.repeat(64)]);
      }
    }

    await db.exec('SET ROLE thaara_app;');
    app = await buildApp({ db, config:loadConfig({ NODE_ENV:'test' }), queueService:{enqueue} });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); await db?.close(); });

  it('returns chronological plan, approval, queue, execution and verified receipt activity', async () => {
    const res = await app.inject({url:url(),headers:headers()});
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const items = res.json().items;
    expect(items.map((e:any)=>e.event_type)).toEqual([
      'plan.created','approval.requested','approval.approved','plan.submitted','step.queued','step.started','step.completed','plan.completed'
    ]);
    expect(items.map((e:any)=>e.timestamp)).toEqual([at(0),at(2),at(3),at(4),at(4),at(5),at(7),at(8)]);
    expect(items.find((e:any)=>e.event_type==='step.started')).toMatchObject({source:'execution_record',attempt_number:2});
    expect(items.find((e:any)=>e.event_type==='step.completed')).toMatchObject({source:'receipt',status:'verified'});
    expect(items.filter((e:any)=>e.event_type==='plan.created')).toHaveLength(1);
  });


  it.each(['failed','unverified','cancelled','queued'])('preserves the truthful %s outcome without inventing earlier transitions',async(state)=>{
    const res=await app.inject({url:`/api/v1/automations/${outcomePlans[state]}/activity`,headers:headers()});
    expect(res.statusCode).toBe(200);
    const items=res.json().items;
    if(state==='failed') {
      expect(items).toEqual(expect.arrayContaining([
        expect.objectContaining({event_type:'approval.rejected',source:'approval_record'}),
        expect.objectContaining({event_type:'step.failed',status:'failed',source:'receipt'}),
        expect.objectContaining({event_type:'plan.failed',source:'plan_record'})
      ]));
    } else if(state==='unverified') {
      expect(items.filter((e:any)=>e.event_type==='step.unverified')).toHaveLength(1);
      expect(items.find((e:any)=>e.event_type==='step.unverified')).toMatchObject({status:'unverified',source:'audit'});
    } else if(state==='cancelled') {
      expect(items.find((e:any)=>e.event_type==='plan.cancelled')).toMatchObject({status:'cancelled',source:'plan_record'});
    } else {
      expect(items.find((e:any)=>e.event_type==='step.queued')).toMatchObject({status:'queued',source:'step_record'});
      expect(items.find((e:any)=>e.event_type==='step.queued').details).toContain('not a historical transition');
    }
    expect(items.some((e:any)=>e.event_type==='step.started')).toBe(false);
    expect(res.body).not.toContain('PRIVATE-');
  });

  it('paginates deterministically without missing or repeating tied events', async () => {
    const full = await app.inject({url:url(),headers:headers()});
    const collected:any[] = [];
    let offset:number|null = 0;
    while(offset!==null) {
      const res = await app.inject({url:url(`?limit=2&offset=${offset}`),headers:headers()});
      expect(res.statusCode).toBe(200);
      expect(res.json().items.length).toBeLessThanOrEqual(2);
      collected.push(...res.json().items);
      offset=res.json().nextOffset;
    }
    expect(collected.map(e=>e.id)).toEqual(full.json().items.map((e:any)=>e.id));
    expect(new Set(collected.map(e=>e.id)).size).toBe(collected.length);
    const empty=await app.inject({url:url('?offset=100'),headers:headers()});
    expect(empty.json()).toMatchObject({items:[],nextOffset:null});
  });

  it('excludes arbitrary payloads, private parameters, worker details and receipt artifacts', async () => {
    const res=await app.inject({url:url(),headers:headers()});
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('PRIVATE-');
    expect(res.body).not.toContain('SECRET-ACTION');
    for (const item of res.json().items) {
      expect(item).not.toHaveProperty('payload');
      expect(item).not.toHaveProperty('proof');
      expect(item).not.toHaveProperty('parameters');
    }
  });

  it('requires authenticated active membership and blocks revoked sessions', async () => {
    expect((await app.inject({url:url()})).statusCode).toBe(401);
    expect((await app.inject({url:url(),headers:{cookie:`${SESSION_COOKIE_NAME}=${revokedToken}`}})).statusCode).toBe(401);
  });

  it('returns indistinguishable 404 for foreign, missing and non-automation plans', async () => {
    for(const id of [foreignPlan,unrelatedPlan,crypto.randomUUID()]) {
      expect((await app.inject({url:`/api/v1/automations/${id}/activity`,headers:headers()})).statusCode).toBe(404);
    }
    expect((await app.inject({url:url(),headers:{cookie:`${SESSION_COOKIE_NAME}=${otherToken}`}})).statusCode).toBe(404);
    const forged=await app.inject({url:url(`?workspaceId=${foreignWorkspace}`),headers:{cookie:`${SESSION_COOKIE_NAME}=${otherToken}`}});
    expect(forged.body).not.toContain('plan.created');
  });

  it('validates pagination bounds and plan identifiers', async () => {
    for(const q of ['?limit=0','?limit=101','?offset=-1','?offset=1.5']) {
      expect((await app.inject({url:url(q),headers:headers()})).statusCode).toBe(400);
    }
    expect((await app.inject({url:'/api/v1/automations/not-a-uuid/activity',headers:headers()})).statusCode).toBe(400);
  });

  it('reads without altering plans, steps, approvals, receipts or audit events', async () => {
    const scope={workspaceId:workspace,userId:user,role:'viewer' as const,sessionTokenHash:hashSessionToken(token)};
    async function snapshot() {
      return db.withScopedTransaction(scope, async tx => {
        const result:Record<string,unknown>={};
        for(const table of ['plans','plan_steps','approval_requests','receipts','audit_events','step_executions']) {
          result[table]=(await tx.query(`SELECT to_jsonb(t) AS record FROM ${table} t ORDER BY id`)).rows;
        }
        return result;
      });
    }
    const before=await snapshot();
    expect((await app.inject({url:url(),headers:headers()})).statusCode).toBe(200);
    expect((await app.inject({url:url('?limit=2'),headers:headers()})).statusCode).toBe(200);
    expect(await snapshot()).toEqual(before);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
