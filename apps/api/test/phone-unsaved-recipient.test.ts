import {randomUUID} from 'node:crypto';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {PhoneCallingService,type PhoneCallingOptions,type PhoneCallingStore} from '../src/services/phone-calling.js';
import {executeChatPhoneCalling} from '../src/services/chat-phone-calling.js';
const scope={workspaceId:randomUUID(),userId:randomUUID(),role:'owner' as const,sessionTokenHash:'fixture'};
const input={contactQuery:'8073486718',purpose:'Ask Krishna about the website',language:'en-IN' as const};
// Keep the real policy clock aligned with this fixture's explicit consent/approval dates.
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-05T06:00:00Z'));});
afterEach(()=>vi.useRealTimers());
function setup(options:PhoneCallingOptions={},hour='2026-11-05T06:00:00Z'){
 const approvals=new Map<string,any>();
 const createPrepared=vi.fn(async(s:any,draft:any)=>{const approvalId=randomUUID();approvals.set(approvalId,{id:approvalId,workspaceId:s.workspaceId,requesterUserId:s.userId,approverUserId:s.userId,actionName:'phone.ai.calls.request',actionParams:draft,status:'approved',riskLevel:'high',expiresAt:'2026-11-06T00:00:00Z',createdAt:hour,updatedAt:hour});return {approvalId,planId:randomUUID(),stepId:randomUUID()};});
 const store:PhoneCallingStore={assertScope:async s=>{if(s.userId!==scope.userId||s.role!=='owner')throw Error('scope');},createPrepared,approval:async(_s,id)=>approvals.get(id)??null,audit:async()=>{}};
 return {createPrepared,approvals,service:new PhoneCallingService({store,contacts:{list:async()=>[]},now:()=>Date.parse(hour),...options})};
}
describe('one-call unsaved recipient previews',()=>{
 it('keeps the Chat approval card without promising a real call for an unverified recipient',async()=>{
  const f=setup();
  const prepare=f.service.prepare.bind(f.service);
  vi.spyOn(f.service,'prepare').mockImplementation(async (...args)=>{
   const result=await prepare(...args);
   return {...result,draft:{...result.draft,mode:'live'},liveCallingEnabled:true};
  });
  const result=await executeChatPhoneCalling(scope,input,f.service);
  expect(result).toMatchObject({status:'awaiting_approval',approvalId:expect.any(String)});
  expect(result.assistantResponseText).toContain('Approval cannot place a call until eligibility is verified.');
  expect(result.assistantResponseText).not.toContain('After approval Thaara can place');
 });
 it('fails closed without disclosing eligibility resolver errors',async()=>{
  const f=setup({simulation:true,recipientEligibility:async()=>{throw Error('synthetic private diagnostic');}});
  const p=await f.service.prepare(scope,{...input,newRecipient:{displayName:'Krishna',consentConfirmed:true}});
  expect(p.draft.newRecipient?.eligibility).toBe('unverified');expect(JSON.stringify(p)).not.toContain('private diagnostic');
 });
 it('links only an owned pending preview with the exact same number and purpose',async()=>{
  const f=setup(),root=await f.service.prepare(scope,input);f.approvals.get(root.approvalId)!.status='pending';
  const confirmation={displayName:'Krishna',consentConfirmed:true,previewApprovalId:root.approvalId};
  const child=await f.service.prepare(scope,{...input,newRecipient:confirmation});expect(child.draft.newRecipient?.previewApprovalId).toBe(root.approvalId);
  await expect(f.service.prepare(scope,{...input,purpose:'Different purpose',newRecipient:confirmation})).rejects.toThrow();
  await expect(f.service.prepare(scope,{...input,newRecipient:{...confirmation,previewApprovalId:randomUUID()}})).rejects.toThrow();
 });
 it('blocks owner consent alone when provider eligibility is unavailable',async()=>{
  const f=setup({simulation:true}),p=await f.service.prepare(scope,{...input,newRecipient:{displayName:'Krishna',consentConfirmed:true}});
  expect(p.draft.newRecipient?.eligibility).toBe('unverified');await expect(f.service.simulate(scope,p.approvalId)).rejects.toThrow();
 });
 it('rechecks server eligibility on execution and never persists a contact',async()=>{
  const eligible=vi.fn(async()=>true),f=setup({simulation:true,recipientEligibility:eligible});
  const p=await f.service.prepare(scope,{...input,newRecipient:{displayName:'Krishna',consentConfirmed:true}});
  expect(p.draft.newRecipient?.eligibility).toBe('eligible');
  const record=await f.service.simulate(scope,p.approvalId);expect(record.draft.recipient.displayName).toBe('Krishna');
  expect(eligible).toHaveBeenCalledTimes(2);
 });
 it('blocks outside calling hours and after eligibility is revoked',async()=>{
  const eligible=vi.fn(async()=>true),night=setup({simulation:true,recipientEligibility:eligible},'2026-11-05T17:00:00Z');
  expect((await night.service.prepare(scope,{...input,newRecipient:{displayName:'Krishna',consentConfirmed:true}})).draft.newRecipient?.eligibility).toBe('unverified');expect(eligible).not.toHaveBeenCalled();
  const f=setup({simulation:true,recipientEligibility:eligible}),p=await f.service.prepare(scope,{...input,newRecipient:{displayName:'Krishna',consentConfirmed:true}});
  eligible.mockResolvedValue(false);await expect(f.service.simulate(scope,p.approvalId)).rejects.toThrow();expect((await f.service.history(scope)).calls).toEqual([]);
 });
 it('creates an immutable, blocked new-recipient preview without saving a contact or dialing',async()=>{
  const f=setup(),p=await f.service.prepare(scope,input);
  expect(p.draft.newRecipient).toMatchObject({phoneE164:'+918073486718',consentConfirmed:false,eligibility:'unverified'});
  expect(f.createPrepared).toHaveBeenCalledOnce();expect(p.draft.recipient.displayName).toBe('New recipient');
  await expect(f.service.confirmAndPlaceCall(scope,p.approvalId)).rejects.toThrow();
 });
 it.each(['112','8073486718 or 9876543210','+18073486718'])('rejects invalid/prohibited/ambiguous %s',async contactQuery=>{
  const f=setup();await expect(f.service.prepare(scope,{...input,contactQuery})).rejects.toThrow();expect(f.createPrepared).not.toHaveBeenCalled();
 });
 it('does not accept caller-supplied eligibility or foreign scope',async()=>{
  const f=setup();await expect(f.service.prepare(scope,{...input,newRecipient:{displayName:'Krishna',consentConfirmed:true,eligibility:'eligible'}} as never)).rejects.toThrow();
  await expect(f.service.prepare({...scope,userId:randomUUID()},input)).rejects.toThrow();expect(f.createPrepared).not.toHaveBeenCalled();
 });
});
