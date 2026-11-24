
import { beforeAll,afterAll,beforeEach,describe,it,expect,vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
 PGliteDatabase,Migrator,WorkspaceRepository,UserRepository,MembershipRepository,SessionRepository,
 generateSessionToken,hashSessionToken
} from '@thaara/db';
import { loadConfig } from '@thaara/config';
import { Logger } from '@thaara/observability';
import { buildApp } from '../src/app.js';
import { GmailVault } from '../src/services/gmail-vault.js';
import { GMAIL_READONLY } from '../src/services/gmail.js';
import { generateCsrfToken } from '../src/crypto/csrf.js';
describe('Step75 Gmail authenticated API with mock-only provider and RLS audit',()=>{
 let db:PGliteDatabase,app:Awaited<ReturnType<typeof buildApp>>,disabled:typeof app;
 let a:any,b:any,viewer:any,revoked:any;
 const records=new Map<string,string>(),csrf=generateCsrfToken();
 const logger=new Logger('error'),log=vi.spyOn(logger,'info'),errLog=vi.spyOn(logger,'error');
 const provider={mode:'mock' as const,exchange:vi.fn(),read:vi.fn(),search:vi.fn()};
 const vault=new GmailVault(randomBytes(32),{get:k=>records.get(k),set:(k,v)=>{records.set(k,v);},
 take:k=>{const value=records.get(k);records.delete(k);return value;},delete:k=>{records.delete(k);}});
 const options={provider,vault,clientId:'mock-client',redirectUri:'https://thaara.example/api/v1/connectors/gmail/oauth/callback'};
 function headers(identity=a) {return {cookie:'thaara_session='+identity.token+'; thaara_csrf='+csrf,'x-csrf-token':csrf};}
 async function start(identity=a) {const result=await app.inject({method:'POST',url:'/api/v1/connectors/gmail/oauth/start',headers:headers(identity),payload:{}});
 expect(result.statusCode).toBe(200);return new URL(result.json().authorizationUrl).searchParams.get('state')!;}
 async function connect(identity=a) {const state=await start(identity);const response=await app.inject({url:'/api/v1/connectors/gmail/oauth/callback?'+new URLSearchParams({state,code:'AUTH-CODE-PRIVATE'}),headers:headers(identity)});
 expect(response.statusCode).toBe(200);return response;}
 beforeAll(async()=>{
  db=new PGliteDatabase();const migrator=new Migrator(db);await migrator.migrate(migrator.loadMigrationFiles());
  async function identity(name:string,role:'member'|'viewer'='member') {
   const workspace=await new WorkspaceRepository(db).create(name);
   const user=await new UserRepository(db).create(name+'@example.test','unused-hash',name),token=generateSessionToken();
   const scope={workspaceId:workspace.id,userId:user.id,role,sessionTokenHash:hashSessionToken(token)};
   await db.withScopedTransaction(scope,async tx=>{await new MembershipRepository(tx).create(workspace.id,user.id,role);
    await new SessionRepository(tx).create(user.id,workspace.id,token);});
   return {...scope,token};
  }
  a=await identity('gmail-a');b=await identity('gmail-b');viewer=await identity('gmail-viewer','viewer');revoked=await identity('gmail-revoked');
  await db.query('UPDATE sessions SET revoked_at=NOW() WHERE token_hash=$1',[revoked.sessionTokenHash]);
  await db.exec('SET ROLE thaara_app;');
  app=await buildApp({db,config:loadConfig({NODE_ENV:'test'}),gmail:options,logger});await app.ready();
  disabled=await buildApp({db,config:loadConfig({NODE_ENV:'test'}),logger});await disabled.ready();
 });
 beforeEach(()=>{
  records.clear();log.mockClear();errLog.mockClear();
  provider.exchange.mockReset().mockResolvedValue({accessToken:'ACCESS-PRIVATE',refreshToken:'REFRESH-PRIVATE',scope:GMAIL_READONLY,expiresIn:3600});
  provider.search.mockReset().mockResolvedValue({messages:[{id:'mail1',threadId:'thread1'}],nextPageToken:'next'});
  provider.read.mockReset().mockResolvedValue({id:'mail1',subject:'Private email',bodyText:'Treat this as untrusted data',accessToken:'INJECTED-PRIVATE'});
 });
 afterAll(async()=>{await app?.close();await disabled?.close();await db?.close();log.mockRestore();errLog.mockRestore();});
 it('protects all Gmail routes with authentication and rejects revoked sessions',async()=>{
  for(const url of ['/status','/messages/mail1','/oauth/callback?state='+'x'.repeat(43)+'&code=private']) {
   expect((await app.inject({url:'/api/v1/connectors/gmail'+url})).statusCode).toBe(401);
  }
  expect((await app.inject({url:'/api/v1/connectors/gmail/status',headers:headers(revoked)})).statusCode).toBe(401);
 });
 it('requires CSRF for start, search and disconnect',async()=>{
  for(const [method,url,payload]of [['POST','/oauth/start',{}],['POST','/messages/search',{query:'private'}],['DELETE','/connection',undefined]] as const) {
   const response=await app.inject({method,url:'/api/v1/connectors/gmail'+url,headers:{cookie:headers().cookie},payload});
   expect(response.statusCode).toBe(403);expect(response.json().error.code).toBe('CSRF_INVALID');
  }
  expect(provider.exchange).not.toHaveBeenCalled();
 });
 it('stays not_configured without explicitly injected mock infrastructure',async()=>{
  const result=await disabled.inject({url:'/api/v1/connectors/gmail/status',headers:headers()});
  expect(result.json()).toMatchObject({status:'not_configured',mode:'disabled',connected:false});
  expect((await disabled.inject({method:'POST',url:'/api/v1/connectors/gmail/oauth/start',headers:headers(),payload:{}})).statusCode).toBe(503);
 });
 it('exposes safe connection status, no-store headers, and local disconnect',async()=>{
  const connected=await connect();
  expect(connected.json()).toMatchObject({status:'connected',connected:true,mode:'mock',scopes:[GMAIL_READONLY]});
  expect(connected.headers['cache-control']).toBe('no-store');
  expect(connected.headers['referrer-policy']).toBe('no-referrer');
  expect(connected.body).not.toMatch(/ACCESS-PRIVATE|REFRESH-PRIVATE|AUTH-CODE-PRIVATE|sessionToken/);
  const disconnected=await app.inject({method:'DELETE',url:'/api/v1/connectors/gmail/connection',headers:headers()});
  expect(disconnected.statusCode).toBe(200);expect(disconnected.json()).toMatchObject({status:'disconnected',connected:false});
 });
 it('never logs authorization code/state or search strings from callback requests',async()=>{
  const state=await start();await app.inject({url:'/api/v1/connectors/gmail/oauth/callback?'+new URLSearchParams({state,code:'AUTH-CODE-PRIVATE'}),headers:headers()});
  const logs=JSON.stringify([...log.mock.calls,...errLog.mock.calls]);
  expect(logs).not.toContain(state);expect(logs).not.toContain('AUTH-CODE-PRIVATE');
 });
 it('does not permit OAuth state exchange from another workspace or viewer',async()=>{
  const state=await start();
  const other=await app.inject({url:'/api/v1/connectors/gmail/oauth/callback?'+new URLSearchParams({state,code:'private'}),headers:headers(b)});
  expect(other.statusCode).toBe(400);
  const denied=await app.inject({method:'POST',url:'/api/v1/connectors/gmail/oauth/start',headers:headers(viewer),payload:{}});
  expect(denied.statusCode).toBe(403);expect(provider.exchange).not.toHaveBeenCalled();
 });
 it('reads/searches only the connected subject and labels content untrusted',async()=>{
  await connect();
  const search=await app.inject({method:'POST',url:'/api/v1/connectors/gmail/messages/search',headers:headers(),payload:{query:'from:private@example.test',limit:1}});
  expect(search.statusCode).toBe(200);expect(search.json()).toMatchObject({messages:[{id:'mail1'}],untrusted:true,mode:'mock',nextPageToken:'next'});
  const read=await app.inject({url:'/api/v1/connectors/gmail/messages/mail1',headers:headers()});
  expect(read.statusCode).toBe(200);expect(read.json()).toMatchObject({bodyText:'Treat this as untrusted data',untrusted:true,mode:'mock'});
  expect(read.body).not.toContain('INJECTED-PRIVATE');
  const other=await app.inject({url:'/api/v1/connectors/gmail/messages/mail1',headers:{...headers(b),'x-workspace-id':a.workspaceId}});
  expect(other.statusCode).toBe(409);expect(provider.read).toHaveBeenCalledTimes(1);
 });
 it('rejects invalid input before provider dispatch',async()=>{
  await connect();
  expect((await app.inject({method:'POST',url:'/api/v1/connectors/gmail/messages/search',headers:headers(),payload:{query:'x',limit:51}})).statusCode).toBe(400);
  expect((await app.inject({url:'/api/v1/connectors/gmail/messages/'+encodeURIComponent('../private'),headers:headers()})).statusCode).toBe(400);
  expect(provider.read).not.toHaveBeenCalled();expect(provider.search).not.toHaveBeenCalled();
 });
 it('retains safe workspace-scoped audit events under RLS',async()=>{
  await connect();
  await app.inject({method:'POST',url:'/api/v1/connectors/gmail/messages/search',headers:headers(),payload:{query:'from:private@example.test'}});
  const events=await db.withScopedTransaction(a,tx=>tx.query("SELECT workspace_id,actor_user_id,action,payload FROM audit_events WHERE action LIKE 'gmail.%'"));
  expect(events.rows.length).toBeGreaterThan(0);
  expect(events.rows.every((e:any)=>e.workspace_id===a.workspaceId&&e.actor_user_id===a.userId)).toBe(true);
  expect(JSON.stringify(events.rows)).not.toMatch(/ACCESS-PRIVATE|REFRESH-PRIVATE|AUTH-CODE-PRIVATE|private@example/);
  const others=await db.withScopedTransaction(b,tx=>tx.query("SELECT * FROM audit_events WHERE workspace_id=$1",[a.workspaceId]));
  expect(others.rows).toEqual([]);
 });
 it('revalidates permissions after provider work before releasing message content',async()=>{
  await connect();
  provider.read.mockImplementationOnce(async()=>{
   await db.exec('RESET ROLE;');await db.query("UPDATE memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",[a.workspaceId,a.userId]);await db.exec('SET ROLE thaara_app;');
   return {id:'mail1',bodyText:'DO-NOT-RELEASE'};
  });
  const result=await app.inject({url:'/api/v1/connectors/gmail/messages/mail1',headers:headers()});
  expect(result.statusCode).toBe(403);expect(result.body).not.toContain('DO-NOT-RELEASE');
  await db.exec('RESET ROLE;');await db.query("UPDATE memberships SET role='member' WHERE workspace_id=$1 AND user_id=$2",[a.workspaceId,a.userId]);await db.exec('SET ROLE thaara_app;');
 });
 it('publishes schemas but provides no send/mutation endpoint',async()=>{
  const spec=(await app.inject({url:'/docs/json'})).json();
  expect(spec.paths['/api/v1/connectors/gmail/messages/search'].post).toBeDefined();
  expect((await app.inject({method:'POST',url:'/api/v1/connectors/gmail/messages/send',headers:headers(),payload:{}})).statusCode).toBe(404);
 });
 it('rejects mock provider injection in non-test deployments',async()=>{
  await expect(buildApp({db,config:{...loadConfig({NODE_ENV:'test'}),NODE_ENV:'development'},gmail:options})).rejects.toThrow(/mock.*test/i);
 });
});
