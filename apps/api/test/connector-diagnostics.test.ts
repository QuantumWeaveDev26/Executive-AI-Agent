import { beforeAll,afterAll,afterEach,describe,it,expect,vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGliteDatabase,Migrator,WorkspaceRepository,UserRepository,MembershipRepository,SessionRepository,generateSessionToken,hashSessionToken } from '@thaara/db';
import { loadConfig } from '@thaara/config';
import { buildApp } from '../src/app.js';
import { GmailVault } from '../src/services/gmail-vault.js';
import { GmailFoundation,GMAIL_READONLY } from '../src/services/gmail.js';
import { N8nWorkspaceVault } from '../src/services/n8n-connections.js';
import { generateCsrfToken } from '../src/crypto/csrf.js';
describe('Step84 local connector diagnostics security',()=>{
 let db:PGliteDatabase,app:Awaited<ReturnType<typeof buildApp>>,mock:typeof app,owner:any,admin:any,other:any,viewer:any,member:any,revoked:any;
 const gmailRecords=new Map<string,string>(),n8nRecords=new Map<string,string>();
 const gmailVault=new GmailVault(randomBytes(32),{get:k=>gmailRecords.get(k),set:(k,v)=>{gmailRecords.set(k,v);},take:k=>{const v=gmailRecords.get(k);gmailRecords.delete(k);return v;},delete:k=>{gmailRecords.delete(k);}});
 const n8nVault=new N8nWorkspaceVault(randomBytes(32),n8nRecords);
 const provider={mode:'mock' as const,exchange:vi.fn(),read:vi.fn(),search:vi.fn()},factory=vi.fn();
 const csrf=generateCsrfToken(),url='/api/v1/admin/connectors/diagnostics';
 const headers=(who=owner)=>({cookie:'thaara_session='+who.token+'; thaara_csrf='+csrf,'x-csrf-token':csrf});
 const quiet={info:vi.fn(),error:vi.fn(),warn:vi.fn(),debug:vi.fn()} as any;
 beforeAll(async()=>{
  db=new PGliteDatabase();const m=new Migrator(db);await m.migrate(m.loadMigrationFiles());
  async function identity(name:string,role:'owner'|'admin'|'member'|'viewer',workspaceId?:string){
   const ws=workspaceId??(await new WorkspaceRepository(db).create(name)).id,u=await new UserRepository(db).create(name+'@step84.test','unused',name),token=generateSessionToken();
   const scope={workspaceId:ws,userId:u.id,role,sessionTokenHash:hashSessionToken(token)};
   await db.withScopedTransaction(scope,async tx=>{await new MembershipRepository(tx).create(ws,u.id,role);await new SessionRepository(tx).create(u.id,ws,token);});return {...scope,token};
  }
  owner=await identity('diagnostic-owner','owner');admin=await identity('diagnostic-admin','admin',owner.workspaceId);other=await identity('diagnostic-other','owner');
  viewer=await identity('diagnostic-viewer','viewer');member=await identity('diagnostic-member','member');revoked=await identity('diagnostic-revoked','owner');
  gmailVault.set(owner,'connection',{tokens:{accessToken:'SYNTHETIC-PRIVATE-TOKEN',refreshToken:'SYNTHETIC-REFRESH',scope:GMAIL_READONLY,expiresIn:3600},expiresAt:Date.now()+3600000,verifiedAt:new Date().toISOString(),epoch:'synthetic'});
  n8nVault.put(owner.workspaceId,'profile:synthetic','SYNTHETIC-N8N-SECRET');
  await db.exec('SET ROLE thaara_app;');
  app=await buildApp({db,config:loadConfig({NODE_ENV:'test'}),logger:quiet});await app.ready();
  mock=await buildApp({db,config:loadConfig({NODE_ENV:'test'}),logger:quiet,gmail:{provider,vault:gmailVault,clientId:'synthetic-client',redirectUri:'https://example.test/callback'},
   n8nConnections:{mode:'mock',vault:n8nVault,profiles:[{id:'synthetic',workspaceId:owner.workspaceId,label:'Synthetic profile'}],transportFactory:factory}});await mock.ready();
  expect((await mock.inject({method:'PUT',url:'/api/v1/connectors/n8n/connection',headers:headers(),payload:{profileId:'synthetic'}})).statusCode).toBe(200);
 });
 afterEach(()=>vi.restoreAllMocks());
 afterAll(async()=>{await app?.close();await mock?.close();await db?.close();});
 it('requires authentication',async()=>{expect((await app.inject({url})).statusCode).toBe(401);});
 it.each(['viewer','member'])('denies %s access',async role=>{expect((await mock.inject({url,headers:headers(role==='viewer'?viewer:member)})).statusCode).toBe(403);});
 it.each(['owner','admin'])('shows truthful disabled defaults for %s',async role=>{
  const response=await app.inject({url,headers:headers(role==='owner'?owner:admin)});expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json().connectors).toHaveLength(2);for(const item of response.json().connectors)expect(item).toMatchObject({connectionState:'not_configured',kmsStatus:'not_configured',storageStatus:'not_configured',lastDiagnostic:{code:'not_configured',providerContacted:false}});
 });
 it('shows subject-scoped Gmail and shared n8n metadata without provider calls or connector writes',async()=>{
  const before=[...gmailRecords,...n8nRecords];const audits=async()=>db.withScopedTransaction(owner,async tx=>(await tx.query('SELECT count(*)::int AS total FROM audit_events WHERE workspace_id=$1',[owner.workspaceId])).rows[0].total);
  const auditBefore=await audits(),response=await mock.inject({url,headers:headers()});expect(response.statusCode).toBe(200);
  expect(response.json().connectors).toMatchObject([{connectorName:'gmail',connectionState:'connected_mock',connectionScope:'user',storageStatus:'readable',kmsStatus:'not_configured'},
   {connectorName:'n8n',connectionState:'configured_unverified',connectionScope:'workspace',storageStatus:'readable',kmsStatus:'not_configured'}]);
  expect(response.body).not.toMatch(/SYNTHETIC|accessToken|refreshToken|ciphertext|profileId|postgresql:|https:|workspaceId|userId/);
  expect([...gmailRecords,...n8nRecords]).toEqual(before);expect(await audits()).toBe(auditBefore);
  for(const fn of [provider.exchange,provider.read,provider.search,factory])expect(fn).not.toHaveBeenCalled();
  const same=await mock.inject({url,headers:headers(admin)});expect(same.json().connectors[0].connectionState).toBe('disconnected');expect(same.json().connectors[1].connectionState).toBe('configured_unverified');
 });
 it('ignores spoofed workspace headers and rejects target query parameters',async()=>{
  const response=await mock.inject({url,headers:{...headers(other),'x-workspace-id':owner.workspaceId}});expect(response.statusCode).toBe(200);
  expect(response.json().connectors.map((c:any)=>c.connectionState)).toEqual(['disconnected','disconnected']);
  expect((await mock.inject({url:url+'?workspaceId='+owner.workspaceId,headers:headers(other)})).statusCode).toBe(400);
 });
 it.each(['gmail','n8n'])('redacts %s local storage failure while preserving the other result',async connector=>{
  vi.spyOn(connector==='gmail'?gmailVault:n8nVault,'get').mockImplementation(()=>{throw Error('postgresql://PRIVATE-TOKEN@internal/SECRET');});
  const response=await mock.inject({url,headers:headers()});expect(response.statusCode).toBe(200);
  const failed=response.json().connectors.find((c:any)=>c.connectorName===connector);expect(failed).toMatchObject({connectionState:'unavailable',storageStatus:'unavailable',lastDiagnostic:{code:'local_metadata_unavailable',providerContacted:false}});
  expect(response.body).not.toMatch(/PRIVATE|TOKEN|SECRET|internal|postgresql:/);
  expect(response.json().connectors.find((c:any)=>c.connectorName!==connector).storageStatus).toBe('readable');
 });
 it('does not report a transport belonging to another workspace as configured',async()=>{
  const transport={mode:'mock' as const,workspaceId:other.workspaceId,listByName:vi.fn(),createInactive:vi.fn(),read:vi.fn()};
  const mismatched=await buildApp({db,config:loadConfig({NODE_ENV:'test'}),logger:quiet,n8nTransports:new Map([[owner.workspaceId,transport]])});
  try{const response=await mismatched.inject({url,headers:headers()});expect(response.statusCode).toBe(200);
   expect(response.json().connectors[1].connectionState).toBe('not_configured');expect(transport.listByName).not.toHaveBeenCalled();
  }finally{await mismatched.close();}
 });
 it('honors PolicyGateway denial before collecting connector metadata',async()=>{
  const policy={evaluate:vi.fn(()=>({allowed:false}))} as any;
  const denied=await buildApp({db,config:loadConfig({NODE_ENV:'test'}),logger:quiet,policyGateway:policy});
  const read=vi.spyOn(GmailFoundation.prototype,'status');
  try{expect((await denied.inject({url,headers:headers()})).statusCode).toBe(403);expect(read).not.toHaveBeenCalled();
   expect(policy.evaluate).toHaveBeenCalledWith(expect.objectContaining({workspaceId:owner.workspaceId}),{actionName:'connectors.diagnostics',parameters:{}});
  }finally{await denied.close();}
 });
 it('rejects unrecognized local metadata instead of reflecting private strings',async()=>{
  vi.spyOn(GmailFoundation.prototype,'status').mockResolvedValueOnce({status:'PRIVATE-SECRET-postgresql:',tokens:'PRIVATE-TOKEN'} as any);
  const response=await mock.inject({url,headers:headers()});expect(response.statusCode).toBe(200);
  expect(response.json().connectors[0]).toMatchObject({connectionState:'unavailable',lastDiagnostic:{code:'local_metadata_unavailable'}});
  expect(response.body).not.toMatch(/PRIVATE|SECRET|postgresql:/);
 });
 it('rechecks session authorization before returning a delayed diagnostic result',async()=>{
  let release!:()=>void,enter!:()=>void;const wait=new Promise<void>(r=>{release=r;}),entered=new Promise<void>(r=>{enter=r;});
  const original=GmailFoundation.prototype.status;
  vi.spyOn(GmailFoundation.prototype,'status').mockImplementationOnce(async function(scope){const result=await original.call(this,scope);enter();await wait;return result;});
  const pending=mock.inject({url,headers:headers(revoked)});
  try{await entered;await db.withScopedTransaction(revoked,tx=>tx.query('UPDATE sessions SET revoked_at=NOW() WHERE token_hash=$1',[revoked.sessionTokenHash]));}finally{release();}
  expect((await pending).statusCode).toBe(403);expect((await mock.inject({url,headers:headers(revoked)})).statusCode).toBe(401);
 });
 it('publishes no mutating diagnostic endpoints',async()=>{for(const method of ['POST','PUT','DELETE'] as const)expect((await app.inject({method,url,headers:headers(),payload:{}})).statusCode).toBe(404);});
});
