import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {PGliteDatabase,Migrator,WorkspaceRepository,UserRepository,MembershipRepository,SessionRepository,generateSessionToken,hashSessionToken,ApprovalRepository} from '@thaara/db';
import {loadConfig} from '@thaara/config';
import {Logger} from '@thaara/observability';
import {buildApp} from '../src/app.js';
import {generateCsrfToken} from '../src/crypto/csrf.js';
import type {PhoneContact} from '../src/services/phone-calling.js';

describe('phone calling HTTP: existing in-memory schema, real session/CSRF/approval/plan/audit',()=>{
 let db:PGliteDatabase,app:Awaited<ReturnType<typeof buildApp>>,off:Awaited<ReturnType<typeof buildApp>>;
 let owner:any,other:any,viewer:any;
 const csrf=generateCsrfToken(),base='/api/v1/connectors/phone/ai';
 const request={contactQuery:'Ram',purpose:'Can you attend tomorrow?',language:'kn-en'};
 const headers=(s=owner)=>({cookie:`thaara_session=${s.token}; thaara_csrf=${csrf}`,'x-csrf-token':csrf});
 beforeAll(async()=>{
  db=new PGliteDatabase();const migrator=new Migrator(db);await migrator.migrate(migrator.loadMigrationFiles());
  const ws=await new WorkspaceRepository(db).create('phone-ai-synthetic');
  async function identity(name:string,role:'owner'|'member'|'viewer'){
   const user=await new UserRepository(db).create(name+'@example.test','unused',name),token=generateSessionToken();
   const scope={workspaceId:ws.id,userId:user.id,role,sessionTokenHash:hashSessionToken(token)};
   await db.withScopedTransaction(scope,async tx=>{await new MembershipRepository(tx).create(ws.id,user.id,role);await new SessionRepository(tx).create(user.id,ws.id,token);});return {...scope,token};
  }
  owner=await identity('phone-ai-owner','owner');other=await identity('phone-ai-other','member');viewer=await identity('phone-ai-viewer','viewer');
  await db.exec('SET ROLE thaara_app;');
  const contact:PhoneContact={workspaceId:owner.workspaceId,userId:owner.userId,id:'ram',revision:1,displayName:'Ram',phoneE164:'+919000000002',consent:{reference:'synthetic-consent',callingAllowed:true,expiresAt:new Date(Date.now()+3600000).toISOString()}};
  const config=loadConfig({NODE_ENV:'test'}),logger=new Logger('error');
  app=await buildApp({db,config,logger,phoneCalling:{contacts:{list:async s=>s.userId===owner.userId?[contact]:[]},simulation:true}});await app.ready();
  off=await buildApp({db,config,logger});await off.ready();
 });
 afterAll(async()=>{await app?.close();await off?.close();await db?.close();});
 it('default runtime is off, reports no fabricated history and refuses simulation',async()=>{
  expect((await off.inject({method:'GET',url:base+'/status',headers:headers()})).json()).toMatchObject({status:'not_configured',liveCallingEnabled:false,simulationEnabled:false});
  expect((await off.inject({method:'GET',url:base+'/calls',headers:headers()})).json()).toMatchObject({calls:[],durable:false});
  expect((await off.inject({method:'POST',url:base+'/drafts',headers:headers(),payload:request})).statusCode).toBe(503);
 });
 it('requires authentication, matching membership, CSRF and strict payloads',async()=>{
  expect((await app.inject({method:'GET',url:base+'/status'})).statusCode).toBe(401);
  expect((await app.inject({method:'GET',url:base+'/status',headers:headers(viewer)})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:base+'/drafts',headers:{cookie:headers().cookie},payload:request})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:base+'/drafts',headers:headers(),payload:{...request,workspaceId:owner.workspaceId}})).statusCode).toBe(400);
 });
 it('stores only the bound draft, exact high-risk approval and plan, without a raw dial target',async()=>{
  const r=await app.inject({method:'POST',url:base+'/drafts',headers:headers(),payload:request});expect(r.statusCode,r.body).toBe(200);
  const p=r.json();expect(p.status).toBe('awaiting_approval');expect(r.body).not.toContain('+919000000002');expect(r.headers['cache-control']).toBe('no-store');
  const a=await db.withScopedTransaction(owner,tx=>new ApprovalRepository(tx).findById(owner.workspaceId,p.approvalId));
  expect(a).toMatchObject({status:'pending',risk_level:'high',requester_user_id:owner.userId,action_params:p.draft});
  expect((await app.inject({method:'POST',url:base+'/simulations',headers:headers(),payload:{approvalId:p.approvalId}})).statusCode).toBe(403);
  await db.withScopedTransaction(owner,tx=>new ApprovalRepository(tx).transitionStatus(owner.workspaceId,p.approvalId,'pending','approved',owner.userId));
  const first=await app.inject({method:'POST',url:base+'/simulations',headers:headers(),payload:{approvalId:p.approvalId}});expect(first.statusCode,first.body).toBe(200);
  const replay=await app.inject({method:'POST',url:base+'/simulations',headers:headers(),payload:{approvalId:p.approvalId}});expect(replay.json().id).toBe(first.json().id);
  expect((await app.inject({method:'POST',url:base+'/simulations',headers:headers(other),payload:{approvalId:p.approvalId}})).statusCode).toBe(403);
  expect((await app.inject({method:'GET',url:base+'/calls',headers:headers(other)})).json().calls).toEqual([]);
 });
 it('Chat builds an approval card without falling through to a model or dialing',async()=>{
  const conv=await app.inject({method:'POST',url:'/api/v1/conversations',headers:headers(),payload:{title:'Phone preparation'}});expect(conv.statusCode).toBe(201);
  const r=await app.inject({method:'POST',url:`/api/v1/conversations/${conv.json().id}/stream`,headers:headers(),payload:{content:"Hey Thaara, call Ram and ask whether he can attend tomorrow's meeting.",idempotency_key:'phone-ai-chat-request-1'}});
  expect(r.statusCode,r.body).toBe(200);expect(r.body).toContain('simulation-only');expect(r.body).toContain('phone.ai.calls.request');expect(r.body).toContain('approval_id');
  const messages=await app.inject({method:'GET',url:`/api/v1/conversations/${conv.json().id}/messages`,headers:headers()});
  const saved=messages.json().find((m:any)=>m.sender_type==='assistant');
  expect(saved.metadata).toMatchObject({plan_id:expect.any(String),approval_id:expect.any(String)});
  expect(saved.metadata.step_statuses).toEqual(expect.arrayContaining([expect.objectContaining({action_name:'phone.ai.calls.request'})]));
 });
 it('keeps appointment words inside an explicit call purpose from invoking Calendar',async()=>{
  const conv=await app.inject({method:'POST',url:'/api/v1/conversations',headers:headers(),payload:{title:'Phone purpose routing'}});
  const r=await app.inject({method:'POST',url:`/api/v1/conversations/${conv.json().id}/stream`,headers:headers(),payload:{content:'Thaara, call Ram and ask when the website will be ready. Do not book an appointment or send a message.',idempotency_key:'phone-purpose-routing'}});
  expect(r.statusCode,r.body).toBe(200);expect(r.body).toContain('phone.ai.calls.request');expect(r.body).not.toContain('Google Calendar is not connected');
 });
 it('refuses revoked sessions for reads as well as preparation',async()=>{
  await db.withScopedTransaction(other,tx=>tx.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1',[other.sessionTokenHash]));
  expect((await app.inject({method:'GET',url:base+'/calls',headers:headers(other)})).statusCode).toBe(401);
 });
});
