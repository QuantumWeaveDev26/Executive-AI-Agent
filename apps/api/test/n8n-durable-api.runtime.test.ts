import { beforeAll,beforeEach,afterEach,afterAll,describe,it,expect,vi } from 'vitest';
import { randomBytes,randomUUID } from 'node:crypto';
import { getIsolatedRuntimeConfig } from '../../../scripts/step74-runtime-guard.mjs';
import { PostgresDatabase,WorkspaceRepository,UserRepository,MembershipRepository,SessionRepository,generateSessionToken,hashSessionToken,
 PlanRepository,PlanStepRepository,PlanStepDependencyRepository,ApprovalRepository,PlanStepApprovalBindingRepository,ReceiptRepository } from '@thaara/db';
import { loadConfig } from '@thaara/config';
import { computeCanonicalParameterHash } from '@thaara/contracts';
import { ComposeEmailWorkflowAdapter,DryRunEmailWorkflowAdapter,StageEmailWorkflowArtifactAdapter,N8N_CREATE_ACTION,defaultPolicyGateway } from '@thaara/policy';
import { buildApp } from '../src/app.js';
import { generateCsrfToken } from '../src/crypto/csrf.js';
import { createDurableN8nTestDependency,verifiedDurableN8nOptions } from '../src/services/n8n-durable-test.js';
import { ConnectorEnvelopeCipher } from '../src/services/connector-security.js';
import { PostgresConnectorStateStore,computeConnectorProfileFingerprint } from '../src/services/postgres-connector-store.js';
import { FaultInjectedConnectorKeys,faultGate } from './helpers/connector-faults.js';
import { DurableN8nSecurityPrototype } from '../src/services/durable-n8n-security.js';

// Existing schema only. No migrations, DROP/TRUNCATE, credential provisioning or role changes.
// Launcher must first verify disposable Docker identities. Synthetic fixtures are retained.
const isolated=getIsolatedRuntimeConfig(process.env);
const config=loadConfig({...process.env,NODE_ENV:'test',DATABASE_URL:isolated.appUrl,RATE_LIMIT_MAX:'10000'});
const path='/api/v1/connectors/n8n/connection',csrf=generateCsrfToken();
const quiet={info:()=>{},error:()=>{},warn:()=>{},debug:()=>{}} as any;
describe('Step82 isolated PostgreSQL durable n8n API (mock KMS/providers only)',()=>{
 let admin:PostgresDatabase,a:any,b:any,viewer:any,member:any,profiles:any[],app:Awaited<ReturnType<typeof buildApp>>;
 let apps:typeof app[],deps:Awaited<ReturnType<typeof createDurableN8nTestDependency>>[];
 let keys:FaultInjectedConnectorKeys,resolve:ReturnType<typeof vi.fn>,factory:ReturnType<typeof vi.fn>,provider:any;
 const headers=(who=a,revision?:number)=>({cookie:'thaara_session='+who.token+'; thaara_csrf='+csrf,'x-csrf-token':csrf,
  ...(revision===undefined?{}:{'if-match':JSON.stringify(String(revision))})});
 const put=(rev:number,who=a,profileId='test-profile')=>app.inject({method:'PUT',url:path,headers:headers(who,rev),payload:{profileId}});
 async function identity(role:'owner'|'member'|'viewer',workspaceId?:string){
  const suffix=randomUUID(),ws=workspaceId??(await new WorkspaceRepository(admin).create('Step82 '+suffix)).id;
  const user=await new UserRepository(admin).create(suffix+'@step82.test','unused-synthetic-hash','Step82 synthetic');
  const token=generateSessionToken();await new MembershipRepository(admin).create(ws,user.id,role);
  await new SessionRepository(admin).create(user.id,ws,token);
  return {workspaceId:ws,userId:user.id,role,token,sessionTokenHash:hashSessionToken(token)};
 }
 async function start(){
  const dependency=await createDurableN8nTestDependency({config,testEnvironment:process.env,profiles,cipher:new ConnectorEnvelopeCipher(keys),
   resolveProfileSecret:resolve as any,transportFactory:factory as any});deps.push(dependency);
  const result=await buildApp({config,n8nDurable:dependency,logger:quiet});await result.ready();apps.push(result);return result;
 }
 beforeAll(async()=>{
  admin=new PostgresDatabase(isolated.migrationUrl);
  const {rows}=await admin.query('SELECT current_database() AS db,current_user AS actor');
  expect(rows[0]).toEqual({db:'thaara_step74_test',actor:'postgres'});
 });
 beforeEach(async()=>{
  apps=[];deps=[];a=await identity('owner');b=await identity('owner');viewer=await identity('viewer',a.workspaceId);member=await identity('member',a.workspaceId);
  profiles=[a,b].map(w=>({id:'test-profile',workspaceId:w.workspaceId,label:'Synthetic test profile'}));
  for(const p of profiles)await admin.query(`INSERT INTO public.workspace_connector_profiles(workspace_id,connector_key,profile_id,label,configuration_fingerprint,enabled)
   VALUES ($1,'n8n',$2,$3,$4,true)`,[p.workspaceId,p.id,p.label,computeConnectorProfileFingerprint({...p,connector:'n8n'})]);
  keys=new FaultInjectedConnectorKeys(new Map([['test-key-v1',randomBytes(32)],['test-key-v2',randomBytes(32)]]));
  resolve=vi.fn(async()=> 'SYNTHETIC-STEP82-SECRET');
  const created=new Map<string,any>();
  provider={mode:'mock',workspaceId:a.workspaceId,listByName:vi.fn(async()=>[]),
   createInactive:vi.fn(async(w:any)=>{const id=randomUUID();created.set(id,{...structuredClone(w),id,active:false});return {id};}),
   read:vi.fn(async(id:string)=>structuredClone(created.get(id)))};
  factory=vi.fn((workspaceId:string,_id:string,secret:string)=>{expect(secret).toBe('SYNTHETIC-STEP82-SECRET');return {...provider,workspaceId};});
  app=await start();
 });
 afterEach(async()=>{for(const instance of apps??[])await instance.close();for(const dep of deps??[])await dep.db.close();});
 afterAll(async()=>{await admin?.close();});
 async function plan(approved=true){
  const params={workflowName:'Synthetic offline workflow',triggerType:'new_lead_inquiry',emailSubject:'Hi {{recipient_name}}',
   emailBodyTemplate:'Hello {{recipient_name}}',allowedVariables:['recipient_email','recipient_name'],recipientVariable:'recipient_email'};
  return deps[0].db.withScopedTransaction(a,async tx=>{
   const plans=new PlanRepository(tx),steps=new PlanStepRepository(tx),approvals=new ApprovalRepository(tx),bindings=new PlanStepApprovalBindingRepository(tx);
   const p=await plans.create(a.workspaceId,a.userId,'Step82 synthetic');
   const stage=await steps.create(a.workspaceId,p.id,0,'automation.email.stage_workflow_artifact','write','medium','explicit',params,computeCanonicalParameterHash(params));
   const context={workspaceId:a.workspaceId,planId:p.id,stepId:stage.id,idempotencyKey:'fixture',parameters:params};
   const compose=await new ComposeEmailWorkflowAdapter().execute(context);
   const dry=await new DryRunEmailWorkflowAdapter().execute({...context,parameters:{...params,sampleData:{recipient_email:'synthetic@example.test',recipient_name:'Synthetic'}}});
   const staged=await new StageEmailWorkflowArtifactAdapter().execute({...context,dependencyProofs:{compose:compose.proof,dry:dry.proof}});
   if(staged.status!=='verified')throw Error('Invalid synthetic staging fixture');
   const artifact:any=staged.proof.stagedArtifact;
   await steps.transitionStatus(a.workspaceId,stage.id,'blocked','queued');await steps.transitionStatus(a.workspaceId,stage.id,'queued','running');
   await steps.transitionStatus(a.workspaceId,stage.id,'running','verified');
   await new ReceiptRepository(tx).create(a.workspaceId,p.id,stage.id,stage.action_name,'verified',staged.proof,staged.verificationMethod);
   const parameters={artifactId:artifact.artifactId,workflowHash:artifact.workflowHash};
   const target=await steps.create(a.workspaceId,p.id,1,N8N_CREATE_ACTION,'write','medium','explicit',parameters,computeCanonicalParameterHash(parameters));
   await new PlanStepDependencyRepository(tx).create(a.workspaceId,p.id,target.id,stage.id);
   const approval=await approvals.create(a.workspaceId,N8N_CREATE_ACTION,parameters,a.userId,'medium');
   if(approved)await approvals.updateStatus(a.workspaceId,approval.id,'approved',a.userId);
   await bindings.create(a.workspaceId,p.id,target.id,approval.id,target.parameter_hash);
   await steps.transitionStatus(a.workspaceId,target.id,'blocked',approved?'queued':'awaiting_approval');
   await plans.transitionStatus(a.workspaceId,p.id,'draft',approved?'queued':'awaiting_approval');
   return '/api/v1/connectors/n8n/plans/'+p.id+'/steps/'+target.id+'/create-inactive';
  });
 }
 it('keeps the default API not_configured without probing/decrypting credentials',async()=>{
  const disabled=await buildApp({config,db:deps[0].db,logger:quiet});apps.push(disabled);
  const result=await disabled.inject({url:path,headers:headers()});expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({configured:false,storage:'unavailable',managementEnabled:false});
  expect(resolve).not.toHaveBeenCalled();expect(factory).not.toHaveBeenCalled();
 });
 it('requires authentication, admin permission and CSRF before mutation',async()=>{
  expect((await app.inject({url:path})).statusCode).toBe(401);
  for(const who of [member,viewer]){
   expect((await app.inject({url:path,headers:headers(who)})).statusCode).toBe(403);
   expect((await put(0,who)).statusCode).toBe(403);
  }
  expect((await app.inject({method:'PUT',url:path,headers:{cookie:headers().cookie},payload:{profileId:'test-profile'}})).statusCode).toBe(403);
  expect(resolve).not.toHaveBeenCalled();
 });
 it('requires a precise revision and rejects credential/endpoint body input',async()=>{
  expect((await app.inject({method:'PUT',url:path,headers:headers(),payload:{profileId:'test-profile'}})).statusCode).toBe(428);
  for(const revision of ['0','*','"-1"','"9007199254740991"'])expect((await app.inject({method:'PUT',url:path,headers:{...headers(),'if-match':revision},payload:{profileId:'test-profile'}})).statusCode).toBe(400);
  expect((await app.inject({method:'PUT',url:path,headers:headers(a,0),payload:{profileId:'test-profile',token:'PRIVATE'}})).statusCode).toBe(400);
  expect(resolve).not.toHaveBeenCalled();
 });
 it('persists encrypted selection across fresh app, manager and pool instances',async()=>{
  const configured=await put(0);expect(configured.statusCode).toBe(200);
  expect(configured.json()).toMatchObject({revision:1,storage:'postgres_durable',configured:true,selectedProfileId:'test-profile'});
  await app.close();await deps[0].db.close();apps=[];deps=[];app=await start();
  const response=await app.inject({url:path,headers:headers()});expect(response.json()).toMatchObject({revision:1,configured:true});
  expect(response.body).not.toMatch(/SYNTHETIC-STEP82-SECRET|envelope|ciphertext|wrappedKey|postgresql:/);
  const {rows}=await admin.query('SELECT credential_envelope FROM public.workspace_connector_connections WHERE workspace_id=$1',[a.workspaceId]);
  expect(JSON.stringify(rows)).not.toContain('SYNTHETIC-STEP82-SECRET');
  expect(factory).not.toHaveBeenCalled();
 });
 it('allows exactly one concurrent update across independent API instances and audits it once',async()=>{
  const other=await start();const responses=await Promise.all([put(0),other.inject({method:'PUT',url:path,headers:headers(a,0),payload:{profileId:'test-profile'}})]);
  expect(responses.map(r=>r.statusCode).sort()).toEqual([200,409]);
  const {rows}=await admin.query("SELECT action FROM public.audit_events WHERE workspace_id=$1 AND action='connector.connection.configured'",[a.workspaceId]);
  expect(rows).toHaveLength(1);
 });
 it('persists disconnect tombstones and fences stale updates after restart',async()=>{
  expect((await put(0)).statusCode).toBe(200);
  const result=await app.inject({method:'DELETE',url:path,headers:headers(a,1)});expect(result.statusCode).toBe(200);expect(result.json()).toMatchObject({revision:2,status:'disconnected',configured:false});
  const restarted=await start();expect((await restarted.inject({url:path,headers:headers()})).json()).toMatchObject({revision:2,status:'disconnected'});
  expect((await put(1)).statusCode).toBe(409);
  const {rows}=await admin.query('SELECT revision::int,profile_id,credential_envelope FROM public.workspace_connector_connections WHERE workspace_id=$1',[a.workspaceId]);
  expect(rows[0]).toEqual({revision:2,profile_id:null,credential_envelope:null});
 });
 it('isolates reads, revisions and approved profiles across workspaces despite spoofed headers',async()=>{
  expect((await put(0)).statusCode).toBe(200);
  const status=await app.inject({url:path,headers:{...headers(b),'x-workspace-id':a.workspaceId}});expect(status.json()).toMatchObject({revision:0,configured:false});
  expect((await put(0,b,'unknown-profile')).statusCode).toBe(404);
  const mismatch={...a,workspaceId:b.workspaceId};
  const raw=await deps[0].db.withScopedTransaction(mismatch,tx=>tx.query("SELECT * FROM public.read_workspace_connector_connection('n8n')"));
  expect(raw.rows).toHaveLength(1);expect(raw.rows[0].workspace_id).toBe(a.workspaceId);
  await expect(new PostgresConnectorStateStore({mode:'mock',db:deps[0].db,profiles}).read(mismatch,'n8n')).rejects.toThrow();
 });
 it('denies revoked membership and does not resolve synthetic credentials',async()=>{
  await admin.query('DELETE FROM public.memberships WHERE workspace_id=$1 AND user_id=$2',[a.workspaceId,a.userId]);
  expect((await put(0)).statusCode).toBe(401);expect(resolve).not.toHaveBeenCalled();
 });
 it('does not decrypt or construct a transport for status reads',async()=>{
  await put(0);const unwrap=vi.spyOn(keys,'unwrap');resolve.mockClear();
  expect((await app.inject({url:'/api/v1/connectors/n8n/status',headers:headers()})).json()).toMatchObject({configured:true,status:'configured_unverified',liveProvidersStatus:'not_configured'});
  expect(unwrap).not.toHaveBeenCalled();expect(factory).not.toHaveBeenCalled();expect(resolve).not.toHaveBeenCalled();
 });
 it('requires explicit plan approval before the durable mocked provider is reached',async()=>{
  await put(0);const url=await plan(false);const response=await app.inject({method:'POST',url,headers:headers()});
  expect(response.statusCode).toBe(403);expect(factory).not.toHaveBeenCalled();expect(provider.createInactive).not.toHaveBeenCalled();
 });
 it('uses durable transport through governed execution and readback, then replays one truthful receipt',async()=>{
  await put(0);const url=await plan();const response=await app.inject({method:'POST',url,headers:headers()});
  expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({status:'verified',active:false,verificationMethod:'mocked_n8n_inactive_readback',liveProvidersStatus:'not_configured'});
  expect(factory).toHaveBeenCalled();expect(provider.read).toHaveBeenCalled();expect(provider.createInactive).toHaveBeenCalledTimes(1);
  expect((await app.inject({method:'POST',url,headers:headers()})).json().receiptId).toBe(response.json().receiptId);
  expect(provider.createInactive).toHaveBeenCalledTimes(1);
 });
 it('withholds a delayed mock acknowledgement after concurrent disconnect',async()=>{
  await put(0);const url=await plan();let release!:(v:unknown)=>void,entered!:()=>void;
  const called=new Promise<void>(r=>{entered=r;});
  provider.read.mockImplementationOnce(()=>{entered();return new Promise(r=>{release=r;});});
  const pending=app.inject({method:'POST',url,headers:headers()});await called;
  expect((await app.inject({method:'DELETE',url:path,headers:headers(a,1)})).statusCode).toBe(200);
  release({active:false});const response=await pending;expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({status:'unverified',active:null});
  expect(provider.createInactive).toHaveBeenCalledTimes(1);
 });
 describe('Step83 failure, key lifecycle and in-flight authorization security',()=>{
  const service=(dep=deps[0])=>new DurableN8nSecurityPrototype(verifiedDurableN8nOptions(dep,config,dep.db),defaultPolicyGateway);
  const row=async()=> (await admin.query('SELECT revision::int,status,profile_id,credential_envelope FROM public.workspace_connector_connections WHERE workspace_id=$1',[a.workspaceId])).rows[0];
  const auditCount=async(action:string)=>(await admin.query('SELECT count(*)::int AS total FROM public.audit_events WHERE workspace_id=$1 AND action=$2',[a.workspaceId,action])).rows[0].total;
  const rejectVerified=async(url:string)=>{
   const stepId=url.split('/')[8];
   const receipts=(await admin.query('SELECT status,proof FROM public.receipts WHERE workspace_id=$1 AND plan_step_id=$2',[a.workspaceId,stepId])).rows;
   expect(receipts.every(r=>r.status!=='verified')).toBe(true);
   expect((await admin.query('SELECT status FROM public.plan_steps WHERE workspace_id=$1 AND id=$2',[a.workspaceId,stepId])).rows[0].status).not.toBe('verified');
   expect((await admin.query("SELECT count(*)::int AS total FROM public.audit_events WHERE workspace_id=$1 AND target_id=$2 AND action='step.verified'",[a.workspaceId,stepId])).rows[0].total).toBe(0);
   return receipts;
  };
  it('redacts KMS wrapping failures and preserves the previous encrypted revision and audit',async()=>{
   await put(0);const before=await row();keys.fail=true;
   const response=await put(1);expect(response.statusCode).toBe(503);
   expect(response.body).not.toMatch(/PRIVATE-MOCK|SYNTHETIC-STEP82-SECRET|wrappedKey|ciphertext/);
   expect(await row()).toEqual(before);expect(await auditCount('connector.connection.configured')).toBe(1);
   expect((await app.inject({url:path,headers:headers()})).json()).toMatchObject({revision:1,configured:true});
  });
  it('fails before provider dispatch on KMS unwrap outage and never returns a verified receipt',async()=>{
   await put(0);const url=await plan();keys.fail=true;
   const response=await app.inject({method:'POST',url,headers:headers()});expect(response.statusCode).toBe(200);
   expect(response.json()).toMatchObject({status:'failed',workflowId:null,active:null});
   expect(provider.listByName).not.toHaveBeenCalled();expect(provider.createInactive).not.toHaveBeenCalled();expect(factory).not.toHaveBeenCalled();
   expect(await rejectVerified(url)).toHaveLength(1);expect(response.body).not.toMatch(/PRIVATE-MOCK|SYNTHETIC-STEP82-SECRET/);
  });
  it('never substitutes an active key for a retired source key and can still disconnect',async()=>{
   await put(0);const url=await plan();keys.activeId='test-key-v2';keys.versions.get('test-key-v1')!.state='disabled';
   const response=await app.inject({method:'POST',url,headers:headers()});expect(response.json()).toMatchObject({status:'failed',active:null});
   expect(factory).not.toHaveBeenCalled();expect(provider.createInactive).not.toHaveBeenCalled();await rejectVerified(url);
   expect((await app.inject({method:'DELETE',url:path,headers:headers(a,1)})).json()).toMatchObject({revision:2,status:'disconnected'});
   expect(await row()).toMatchObject({revision:2,credential_envelope:null,profile_id:null});
  });
  it('commits rotation atomically, survives API restart and retires old bindings without crossing workspaces',async()=>{
   await put(0);const before=await row(),old=await service().transport(a),binding=await service().capture(a);
   keys.activeId='test-key-v2';keys.versions.get('test-key-v1')!.state='decrypt_only';
   expect(await service().rotate(a,1,keys)).toMatchObject({revision:2,configured:true});keys.versions.get('test-key-v1')!.state='disabled';
   const after=await row();expect(after.credential_envelope.keyId).toBe('test-key-v2');
   expect(after.credential_envelope.wrappedKey).not.toBe(before.credential_envelope.wrappedKey);
   expect(after.credential_envelope.iv).not.toBe(before.credential_envelope.iv);
   await expect(old.listByName('synthetic')).rejects.toMatchObject({code:'CONNECTOR_CONNECTION_CHANGED'});
   await expect(service().resolve(b,binding)).rejects.toMatchObject({statusCode:403});
   app=await start();const unwrap=vi.spyOn(keys,'unwrap'),url=await plan();
   const response=await app.inject({method:'POST',url,headers:headers()});expect(response.json()).toMatchObject({status:'verified',active:false});
   expect(unwrap.mock.calls.every(([input])=>input.keyId==='test-key-v2')).toBe(true);
   expect(await auditCount('connector.connection.key_rotated')).toBe(1);
   expect((await app.inject({url:path,headers:headers(b)})).json()).toMatchObject({revision:0,configured:false});
  });
  it('commits only one rotation and one success audit across independent PostgreSQL API pools',async()=>{
   await put(0);await start();keys.activeId='test-key-v2';
   const results=await Promise.allSettled([service(deps[0]).rotate(a,1,keys),service(deps[1]).rotate(a,1,keys)]);
   expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
   const rejected=results.find(r=>r.status==='rejected') as PromiseRejectedResult;expect(rejected.reason).toMatchObject({code:'CONNECTOR_CONNECTION_CHANGED'});
   expect(await row()).toMatchObject({revision:2});expect(await auditCount('connector.connection.key_rotated')).toBe(1);
  });
  it('does not commit rotation after a concurrent disconnect while KMS wrapping is delayed',async()=>{
   await put(0);const gate=faultGate();keys.activeId='test-key-v2';keys.beforeWrap=gate.pause;
   const pending=service().rotate(a,1,keys).catch(e=>e);
   try{await gate.entered;expect((await app.inject({method:'DELETE',url:path,headers:headers(a,1)})).statusCode).toBe(200);}finally{gate.release();}
   expect(await pending).toMatchObject({code:'CONNECTOR_CONNECTION_CHANGED'});
   expect(await row()).toMatchObject({revision:2,status:'disconnected',credential_envelope:null});
   expect(await auditCount('connector.connection.key_rotated')).toBe(0);
  });
  it('rejects permission revocation during configuration before committing any encrypted state',async()=>{
   const gate=faultGate();keys.beforeWrap=gate.pause;const pending=put(0);
   try{await gate.entered;await admin.query("UPDATE public.memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",[a.workspaceId,a.userId]);}finally{gate.release();}
   const response=await pending;expect(response.statusCode).toBe(403);expect(await row()).toBeUndefined();
   expect(await auditCount('connector.connection.configured')).toBe(0);expect((await put(0)).statusCode).toBe(403);
  });
  it.each(['membership','session'] as const)('withholds valid readback after %s revocation and denies reuse',async kind=>{
   await put(0);const url=await plan(),gate=faultGate(),read=provider.read.getMockImplementation()!;
   provider.read.mockImplementationOnce(async(id:string)=>{const valid=await read(id);expect(valid.active).toBe(false);await gate.pause();return valid;});
   const pending=app.inject({method:'POST',url,headers:headers()});
   try{await gate.entered;
    if(kind==='membership')await admin.query("UPDATE public.memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",[a.workspaceId,a.userId]);
    else await admin.query('UPDATE public.sessions SET revoked_at=NOW() WHERE token_hash=$1',[a.sessionTokenHash]);
   }finally{gate.release();}
   const response=await pending;expect(response.statusCode).toBe(403);await rejectVerified(url);
   const retry=await app.inject({method:'POST',url,headers:headers()});expect(retry.statusCode).toBe(kind==='session'?401:403);
   expect(provider.createInactive).toHaveBeenCalledTimes(1);expect(provider.read).toHaveBeenCalledTimes(1);
  });
  it.each(['lost_ack','kms_after_ack'] as const)('persists uncertain %s outcomes as unverified and does not retry creation',async failure=>{
   await put(0);const url=await plan(),create=provider.createInactive.getMockImplementation()!;
   provider.createInactive.mockImplementationOnce(async(workflow:any)=>{
    const ack=await create(workflow);
    if(failure==='lost_ack')throw Error('PRIVATE-MOCK-ACK-ERROR');keys.fail=true;return ack;
   });
   const first=await app.inject({method:'POST',url,headers:headers()});expect(first.statusCode).toBe(200);
   expect(first.json()).toMatchObject({status:'unverified',active:null});expect(first.body).not.toMatch(/PRIVATE-MOCK|SYNTHETIC-STEP82-SECRET/);
   const receipts=await rejectVerified(url);expect(receipts).toHaveLength(1);expect(receipts[0].status).toBe('unverified');
   const second=await app.inject({method:'POST',url,headers:headers()});expect(second.json().receiptId).toBe(first.json().receiptId);
   expect(provider.createInactive).toHaveBeenCalledTimes(1);expect(provider.read).not.toHaveBeenCalled();
  });
  it('rejects otherwise valid delayed readback after disconnect/reconnect without an ABA escape',async()=>{
   await put(0);const url=await plan(),gate=faultGate(),read=provider.read.getMockImplementation()!;
   provider.read.mockImplementationOnce(async(id:string)=>{const valid=await read(id);expect(valid.id).toBe(id);await gate.pause();return valid;});
   const pending=app.inject({method:'POST',url,headers:headers()});
   try{await gate.entered;expect((await app.inject({method:'DELETE',url:path,headers:headers(a,1)})).statusCode).toBe(200);expect((await put(2)).statusCode).toBe(200);}finally{gate.release();}
   const response=await pending;expect(response.json()).toMatchObject({status:'unverified',active:null});await rejectVerified(url);
   expect((await app.inject({url:path,headers:headers()})).json()).toMatchObject({revision:3,configured:true});
   expect((await app.inject({method:'POST',url,headers:headers()})).json().receiptId).toBe(response.json().receiptId);
   expect(provider.createInactive).toHaveBeenCalledTimes(1);
  });
 });

});
