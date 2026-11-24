import {randomUUID} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {PolicyGateway} from '@thaara/policy';
import type {ApprovalRequest,PhoneCallingDraft} from '@thaara/contracts';
import {PhoneCallingService,type PhoneContact,type PhoneCallingStore,type PhoneCallingOptions} from '../src/services/phone-calling.js';

const scope={workspaceId:randomUUID(),userId:randomUUID(),role:'owner' as const,sessionTokenHash:'synthetic-session'};
const request={contactQuery:'Ram',purpose:'Can you attend tomorrow?',language:'en-IN' as const};
function fixture(options:PhoneCallingOptions={}){
 const now=Date.now();let revoked=false,auditFails=false;
 const contacts:PhoneContact[]=[{workspaceId:scope.workspaceId,userId:scope.userId,id:'ram',revision:1,displayName:'Ram',aliases:['ರಾಮ್'],phoneE164:'+919000000002',consent:{reference:'consent-1',expiresAt:new Date(now+3600000).toISOString(),callingAllowed:true}}];
 const approvals=new Map<string,ApprovalRequest>();
 const store:PhoneCallingStore={
  async assertScope(s){if(revoked||s.workspaceId!==scope.workspaceId||s.userId!==scope.userId||s.sessionTokenHash!==scope.sessionTokenHash||s.role==='viewer')throw Error('denied');},
  async createPrepared(s,draft){if(auditFails)throw Error('audit failed');const id=randomUUID();approvals.set(id,{id,workspaceId:s.workspaceId,requesterUserId:s.userId,approverUserId:null,actionName:'phone.ai.calls.request',actionParams:draft,status:'pending',riskLevel:'high',expiresAt:new Date(now+900000).toISOString(),createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()});return {approvalId:id,planId:randomUUID(),stepId:randomUUID()};},
  async approval(s,id){return approvals.get(id)??null;},
  async audit(){if(auditFails)throw Error('audit failed');}
 };
 const service=new PhoneCallingService({store,contacts:{list:async()=>structuredClone(contacts)},simulation:true,now:()=>now,...options});
 const approve=(id:string)=>{approvals.get(id)!.status='approved';approvals.get(id)!.approverUserId=scope.userId;};
 return {service,contacts,approvals,approve,failAudit:()=>{auditFails=true;},revoke:()=>{revoked=true;}};
}
describe('phone contact resolution, bound approvals and test-only call lifecycle',()=>{
 it('uses exact authorized number matches and refuses duplicate number records',async()=>{
  const f=fixture();expect((await f.service.resolve(scope,'9000000002')).status).toBe('matched');
  expect((await f.service.prepare(scope,{...request,contactQuery:'+91 90000 00002'})).draft.contactId).toBe('ram');
  f.contacts.push({...f.contacts[0]!,id:'duplicate'});
  expect((await f.service.resolve(scope,'9000000002')).status).toBe('ambiguous');
  await expect(f.service.prepare(scope,{...request,contactQuery:'9000000002'})).rejects.toThrow();
 });
 it('persists a pending exact draft, masks the target and never calls by preparing',async()=>{
  const f=fixture(),p=await f.service.prepare(scope,request);
  expect(p).toMatchObject({status:'awaiting_approval',liveCallingEnabled:false,draft:{contactId:'ram',mode:'simulation'}});
  expect(JSON.stringify(p)).not.toContain('+919000000002');
  expect((await f.service.history(scope)).calls).toEqual([]);
  await expect(f.service.simulate(scope,p.approvalId)).rejects.toThrow();
 });
 it('requires selection for duplicate contact names and refuses missing/expired consent',async()=>{
  const f=fixture();f.contacts.push({...f.contacts[0]!,id:'ram-2'});
  expect((await f.service.resolve(scope,'Ram')).status).toBe('ambiguous');
  await expect(f.service.prepare(scope,request)).rejects.toThrow();
  expect((await f.service.prepare(scope,{...request,selectedContactId:'ram'})).draft.contactId).toBe('ram');
  f.contacts[0]!.consent.callingAllowed=false;
  await expect(f.service.prepare(scope,{...request,selectedContactId:'ram'})).rejects.toThrow();
 });
 it('rejects viewer, foreign owner, workspace and revoked session, including read history',async()=>{
  const f=fixture();
  for(const s of [{...scope,role:'viewer' as const},{...scope,userId:randomUUID()},{...scope,workspaceId:randomUUID()}])await expect(f.service.prepare(s,request)).rejects.toThrow();
  f.revoke();await expect(f.service.history(scope)).rejects.toThrow();
 });
 it('rechecks contact binding, approval expiry and exact approved parameters',async()=>{
  const f=fixture(),p=await f.service.prepare(scope,request);f.approve(p.approvalId);
  f.contacts[0]!.phoneE164='+919000000003';
  await expect(f.service.simulate(scope,p.approvalId)).rejects.toThrow();
  f.contacts[0]!.phoneE164='+919000000002';
  f.approvals.get(p.approvalId)!.expiresAt='2020-01-01T00:00:00Z';
  await expect(f.service.simulate(scope,p.approvalId)).rejects.toThrow();
 });
 it('serializes concurrent simulation starts, handles duplicate events and refuses state regression',async()=>{
  const f=fixture(),p=await f.service.prepare(scope,request);f.approve(p.approvalId);
  const [a,b]=await Promise.all([f.service.simulate(scope,p.approvalId),f.service.simulate(scope,p.approvalId)]);
  expect(a.id).toBe(b.id);expect((await f.service.history(scope)).calls).toHaveLength(1);
  await f.service.simulationEvent(scope,a.id,{eventId:'ring',sequence:1,kind:'state',state:'ringing'});
  await f.service.simulationEvent(scope,a.id,{eventId:'answer',sequence:2,kind:'state',state:'answered'});
  const turn={eventId:'utterance',sequence:3,kind:'recipient_final' as const,text:'No, I cannot attend.'};
  await f.service.simulationEvent(scope,a.id,turn);await f.service.simulationEvent(scope,a.id,turn);
  const done=await f.service.simulationEvent(scope,a.id,{eventId:'done',sequence:4,kind:'state',state:'completed'});
  expect(done.report.quotedResponses).toEqual(['No, I cannot attend.']);
  expect(done.report).toMatchObject({simulated:true,verified:false});
  await expect(f.service.simulationEvent(scope,a.id,{eventId:'late',sequence:5,kind:'state',state:'ringing'})).rejects.toThrow();
 });
 it('an audit failure creates no simulation and cannot advance its state',async()=>{
  const f=fixture(),p=await f.service.prepare(scope,request);f.approve(p.approvalId);const call=await f.service.simulate(scope,p.approvalId);
  f.failAudit();await expect(f.service.simulationEvent(scope,call.id,{eventId:'ring',sequence:1,kind:'state',state:'ringing'})).rejects.toThrow();
  expect((await f.service.history(scope)).calls[0]!.state).toBe('queued');
 });
 it('authorizes and audits speech before contacting the voice service, and speaks only ended calls',async()=>{
  const spoken:string[]=[];
  const f=fixture({reportVoice:{speak:async text=>{spoken.push(text);return new Uint8Array([1,2]);}}});
  const p=await f.service.prepare(scope,request);f.approve(p.approvalId);
  const c=await f.service.simulate(scope,p.approvalId);
  await expect(f.service.reportSpeech(scope,c.id)).rejects.toThrow();
  expect(spoken).toHaveLength(0);
  await f.service.simulationEvent(scope,c.id,{eventId:'failed',sequence:1,kind:'state',state:'failed'});
  f.failAudit();await expect(f.service.reportSpeech(scope,c.id)).rejects.toThrow();
  expect(spoken).toHaveLength(0);
 });
 it('consults PolicyGateway before sending a stored report to speech synthesis',async()=>{
  const policy=new PolicyGateway(),speak=vi.fn(async()=>new Uint8Array([1]));
  const f=fixture({policy,reportVoice:{speak}} as PhoneCallingOptions & {policy:PolicyGateway});
  const p=await f.service.prepare(scope,request);f.approve(p.approvalId);
  const c=await f.service.simulate(scope,p.approvalId);
  await f.service.simulationEvent(scope,c.id,{eventId:'failed',sequence:1,kind:'state',state:'failed'});
  vi.spyOn(policy,'evaluate').mockReturnValue({status:'REJECTED_UNAUTHORIZED',allowed:false,reason:'test refusal',risk:'low',requiredApprovalMode:'none',auditRequired:true});
  await expect(f.service.reportSpeech(scope,c.id)).rejects.toThrow();
  expect(speak).not.toHaveBeenCalled();
 });
 it('default service has no simulation admission',async()=>{
  const f=fixture();
  // Explicitly disabled regardless of pending/approved content.
  const service=new PhoneCallingService({store:{assertScope:async()=>{},createPrepared:async()=>{throw Error();},approval:async()=>null,audit:async()=>{}}});
  expect(await service.status(scope)).toMatchObject({liveCallingEnabled:false,simulationEnabled:false,contactDirectoryConfigured:false});
  await expect(service.simulate(scope,randomUUID())).rejects.toThrow();
 });
 it('blocks provider result reads before network on audit failure, policy denial or changed profile',async()=>{
  const readResult=vi.fn(async()=>({status:'available' as const,outcome:'completed' as const,responses:['Tomorrow.']}));
  const policy=new PolicyGateway(),callId=randomUUID();let failAudit=false,hash='a'.repeat(64);
  const entry={record:{id:callId,simulated:false,draft:{providerBindingHash:hash},dispatchStatus:'unverified',createdAt:new Date().toISOString()},providerRequestId:'attempt_1'};
  const provider={name:'sarvam',liveCallingEnabled:true,configurationFingerprint:hash,dispatch:async()=>({status:'not_configured' as const}),readResult};
  const service=new PhoneCallingService({policy,store:{assertScope:async()=>{},createPrepared:async()=>{throw Error();},approval:async()=>null,audit:async()=>{if(failAudit)throw Error('audit failed');}},
   contacts:{list:async()=>[]},calls:{durable:true,load:async()=>entry as never,list:async()=>[],claim:async()=>{throw Error();},append:async()=>{throw Error();}},
   live:{provider,store:{claimDispatch:async()=>null,recordDispatch:async()=>{throw Error();}}}});
  failAudit=true;await expect(service.providerResult(scope,callId)).rejects.toThrow();expect(readResult).not.toHaveBeenCalled();
  failAudit=false;provider.configurationFingerprint='b'.repeat(64);await expect(service.providerResult(scope,callId)).rejects.toThrow();expect(readResult).not.toHaveBeenCalled();
  provider.configurationFingerprint=hash;
  vi.spyOn(policy,'evaluate').mockReturnValue({status:'REJECTED_UNAUTHORIZED',allowed:false,reason:'refused',risk:'low',requiredApprovalMode:'none',auditRequired:true});
  await expect(service.providerResult(scope,callId)).rejects.toThrow();expect(readResult).not.toHaveBeenCalled();
 });
});
