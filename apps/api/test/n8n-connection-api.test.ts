import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { PGliteDatabase,Migrator,WorkspaceRepository,UserRepository,MembershipRepository,SessionRepository,generateSessionToken,hashSessionToken,AuditEventRepository } from '@thaara/db';
import { randomBytes } from 'node:crypto';
import { N8nWorkspaceVault } from '../src/services/n8n-connections.js';
import { loadConfig } from '@thaara/config';
import { buildApp } from '../src/app.js';
import { generateCsrfToken } from '../src/crypto/csrf.js';
describe('Step77 authenticated n8n configuration boundary',()=>{
 let db:PGliteDatabase,app:Awaited<ReturnType<typeof buildApp>>,owner:any,viewer:any,other:any,mockApp:typeof app;
 const vault=new N8nWorkspaceVault(randomBytes(32),new Map());
 const connections={mode:'mock' as const,vault,profiles:[] as {id:string;workspaceId:string;label:string}[],transportFactory:(workspaceId:string)=>({mode:'mock' as const,workspaceId,listByName:async()=>[],createInactive:async()=>({id:'unused'}),read:async()=>({})})};
 const seed=()=>vault.put(owner.workspaceId,'profile:synthetic','SYNTHETIC-API-SECRET-ONLY');
 const csrf=generateCsrfToken(),path='/api/v1/connectors/n8n/connection';
 const headers=(who=owner)=>({cookie:'thaara_session='+who.token+'; thaara_csrf='+csrf,'x-csrf-token':csrf});
 beforeAll(async()=>{
  db=new PGliteDatabase();const migrator=new Migrator(db);await migrator.migrate(migrator.loadMigrationFiles());
  async function identity(name:string,role:'owner'|'viewer'){
   const w=await new WorkspaceRepository(db).create(name),u=await new UserRepository(db).create(name+'@example.test','unused',name),token=generateSessionToken();
   const scope={workspaceId:w.id,userId:u.id,role,sessionTokenHash:hashSessionToken(token)};
   await db.withScopedTransaction(scope,async tx=>{await new MembershipRepository(tx).create(w.id,u.id,role);await new SessionRepository(tx).create(u.id,w.id,token);});return {...scope,token};
  }
  owner=await identity('n8n-config-owner','owner');viewer=await identity('n8n-config-viewer','viewer');other=await identity('n8n-other-owner','owner');
  await db.exec('SET ROLE thaara_app;');app=await buildApp({db,config:loadConfig({NODE_ENV:'test'})});await app.ready();
  connections.profiles.push({id:'synthetic',workspaceId:owner.workspaceId,label:'Synthetic profile'});seed();
  mockApp=await buildApp({db,config:loadConfig({NODE_ENV:'test'}),n8nConnections:connections});await mockApp.ready();
 });
 afterAll(async()=>{await app.close();await mockApp.close();await db.close();});
 it('requires authentication for management details',async()=>{expect((await app.inject({method:'GET',url:path})).statusCode).toBe(401);});
 it.each(['GET','PUT','DELETE'] as const)('denies viewer %s management',async method=>{
  expect((await app.inject({method,url:path,headers:headers(viewer),...(method==='PUT'?{payload:{profileId:'test'}}:{})})).statusCode).toBe(403);
 });
 it('requires CSRF on local configuration writes',async()=>{
  expect((await app.inject({method:'PUT',url:path,headers:{cookie:'thaara_session='+owner.token},payload:{profileId:'test'}})).statusCode).toBe(403);
 });
 it('returns a truthful default with no credentials, endpoint or infrastructure',async()=>{
  const result=await app.inject({method:'GET',url:path,headers:headers()});
  expect(result.statusCode).toBe(200);expect(result.json()).toMatchObject({status:'not_configured',storage:'unavailable',managementEnabled:false,profiles:[]});
  expect(result.headers['cache-control']).toBe('no-store');
 });
 it('fails closed when durable secret management is not provisioned',async()=>{
  const result=await app.inject({method:'PUT',url:path,headers:headers(),payload:{profileId:'test'}});
  expect(result.statusCode).toBe(503);expect(result.body).not.toMatch(/token|password|apiKey/);
 });
 it('rejects credential/endpoint injection instead of accepting browser secrets',async()=>{
  const result=await app.inject({method:'PUT',url:path,headers:headers(),payload:{profileId:'test',apiKey:'PRIVATE-DO-NOT-ECHO',baseUrl:'http://127.0.0.1'}});
  expect([400,403,503]).toContain(result.statusCode);expect(result.body).not.toContain('PRIVATE-DO-NOT-ECHO');
 });
 it('audits admin reads using the authenticated workspace',async()=>{
  await app.inject({method:'GET',url:path,headers:{...headers(),'x-workspace-id':viewer.workspaceId}});
  const events=await db.withScopedTransaction(owner,tx=>new AuditEventRepository(tx).listByWorkspace(owner.workspaceId));
  expect(JSON.stringify(events)).toContain('n8n.connection.viewed');
  expect(JSON.stringify(events)).not.toContain(viewer.workspaceId);
 });

 it('configures an admin-selected mock profile without revealing server secrets',async()=>{
  seed();const result=await mockApp.inject({method:'PUT',url:path,headers:headers(),payload:{profileId:'synthetic'}});
  expect(result.statusCode).toBe(200);expect(result.json()).toMatchObject({status:'configured_unverified',mode:'mock',configured:true,selectedProfileId:'synthetic'});
  expect(result.body).not.toMatch(/SYNTHETIC-API-SECRET-ONLY|profile:synthetic|secretRef|apiKey/);
  const status=await mockApp.inject({method:'GET',url:'/api/v1/connectors/n8n/status',headers:headers()});
  expect(status.json()).toMatchObject({configured:true,mode:'mock',status:'configured_unverified'});
 });
 it('rejects extra browser credential fields even with usable mock infrastructure',async()=>{
  seed();const result=await mockApp.inject({method:'PUT',url:path,headers:headers(),payload:{profileId:'synthetic',apiKey:'DO-NOT-ECHO-SYNTHETIC'}});
  expect(result.statusCode).toBe(400);expect(result.body).not.toContain('DO-NOT-ECHO-SYNTHETIC');
 });
 it('cannot select or enumerate another workspace profile through headers or body',async()=>{
  const h={...headers(other),'x-workspace-id':owner.workspaceId};
  const result=await mockApp.inject({method:'GET',url:path,headers:h});expect(result.json()).toMatchObject({profiles:[],configured:false});
  expect((await mockApp.inject({method:'PUT',url:path,headers:h,payload:{profileId:'synthetic'}})).statusCode).toBe(404);
 });
 it('disconnects locally, removes secrets and leaves the other workspace unchanged',async()=>{
  seed();await mockApp.inject({method:'PUT',url:path,headers:headers(),payload:{profileId:'synthetic'}});
  const result=await mockApp.inject({method:'DELETE',url:path,headers:headers()});
  expect(result.statusCode).toBe(200);expect(result.json()).toMatchObject({configured:false,status:'disconnected',profiles:[]});
  expect(vault.get(owner.workspaceId,'profile:synthetic')).toBeUndefined();
  expect((await mockApp.inject({method:'GET',url:'/api/v1/connectors/n8n/status',headers:headers()})).json().configured).toBe(false);
  expect((await mockApp.inject({method:'GET',url:path,headers:headers(other)})).json().configured).toBe(false);
 });
 it('persists safe local configuration/disconnect audit events in the correct workspace',async()=>{
  seed();await mockApp.inject({method:'PUT',url:path,headers:headers(),payload:{profileId:'synthetic'}});
  await mockApp.inject({method:'DELETE',url:path,headers:headers()});
  const events=await db.withScopedTransaction(owner,tx=>new AuditEventRepository(tx).listByWorkspace(owner.workspaceId));
  const safe=JSON.stringify(events);expect(safe).toContain('n8n.connection.configured');expect(safe).toContain('n8n.connection.disconnected');
  expect(safe).not.toMatch(/SYNTHETIC-API-SECRET-ONLY|profile:synthetic/);
 });
 it('rejects ephemeral management in non-test application environments',async()=>{
  await expect(buildApp({db,config:{...loadConfig({NODE_ENV:'test'}),NODE_ENV:'development'},n8nConnections:connections})).rejects.toThrow('test-only');
 });
 it('refuses two conflicting connection sources',async()=>{
  await expect(buildApp({db,config:loadConfig({NODE_ENV:'test'}),n8nConnections:connections,n8nTransports:new Map([['conflicting',{} as any]])})).rejects.toThrow('one n8n connection source');
 });
 it('rejects a revoked session',async()=>{
  await db.exec('RESET ROLE;');await db.query('DELETE FROM memberships WHERE workspace_id=$1 AND user_id=$2',[owner.workspaceId,owner.userId]);await db.exec('SET ROLE thaara_app;');
  expect([401,403]).toContain((await app.inject({method:'GET',url:path,headers:headers()})).statusCode);
 });
});
