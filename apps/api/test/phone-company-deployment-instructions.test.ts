import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {buildCompanyVoiceRouteCandidates} from '../src/services/phone-company-routing-review.js';
import {renderCompanyKnowledge} from '../src/services/phone-company-knowledge.js';
import {buildCompanyVoiceDeploymentArtifacts} from '../src/services/phone-company-deployment-instructions.js';

const hash=(t:string)=>createHash('sha256').update(t).digest('hex');
describe('final Sarvam instruction artifacts — local text only',()=>{
 it('retains the validated common rules and versions after moving only development/rollout commentary',()=>{
  const review=buildCompanyVoiceRouteCandidates(),final=buildCompanyVoiceDeploymentArtifacts();
  const commonBody=review.commonInstructions.slice(review.commonInstructions.indexOf('\n')+1).replace(/ Provider\/context validation is required before rollout\.$/,'');
  expect(final.commonInstructions).toBe(commonBody);expect(final.commonPolicySha256).toBe(hash(commonBody));
  expect(final.knowledgeSha256).toBe(hash(renderCompanyKnowledge()));expect(final.knowledgeVersion).toBe(review.knowledgeVersion);
  expect(final.policyVersion).toBe(review.policyVersion);
 });
 it.each(['inbound','outbound'] as const)('exports %s without review banners and with exact hashes/provenance',direction=>{
  const final=buildCompanyVoiceDeploymentArtifacts(),a=final[direction],review=buildCompanyVoiceRouteCandidates();
  expect(a.instructions).not.toMatch(/LOCAL REVIEW|DRAFT FOR OWNER|candidate|not approved for upload|not a live configuration/);
  expect(a.instructions).toContain(final.commonInstructions);expect(a.sha256).toBe(hash(a.instructions));
  expect(a.reviewedInstructionsSha256).toBe(review[direction].policySha256);expect(a.utf8Bytes).toBe(Buffer.byteLength(a.instructions));
  expect(a.instructions).toContain('qw-company-kb-v1');expect(a.instructions).toContain('qw-route-policy-v1');
  expect(a.changes).toHaveLength(direction==='outbound'?5:4);
  expect(a.instructions).not.toContain('before rollout');
  expect(Object.isFrozen(a)).toBe(true);expect(final.uploadAuthorized).toBe(false);expect(final.liveIntegration).toBe(false);
 });
 it('fixes incoming direction without a task-purpose or recipient substitution requirement',()=>{
  const text=buildCompanyVoiceDeploymentArtifacts().inbound.instructions;
  expect(text).toContain('CALL DIRECTION: INBOUND');expect(text).toContain('does not require call_purpose');
  expect(text).toContain('Do not perform an outbound task');expect(text).not.toMatch(/\{\{(?:user_name|call_purpose)\}\}/);
 });
 it('uses supported outgoing input references, with recipient semantics and fail-closed missing inputs',()=>{
  const text=buildCompanyVoiceDeploymentArtifacts().outbound.instructions;
  expect(text).toContain('CALL DIRECTION: OUTBOUND');
  expect(text.match(/\{\{call_purpose\}\}/g)).toHaveLength(1);expect(text.match(/\{\{user_name\}\}/g)).toHaveLength(1);
  expect(text).toContain('Recipient name (the person being called)');expect(text).toContain('never fall back to inbound');
  expect(text).toContain('purpose or recipient is missing');
 });
 it.each(['inbound','outbound'] as const)('preserves %s safety, languages, knowledge access and truthful reports',direction=>{
  const text=buildCompanyVoiceDeploymentArtifacts()[direction].instructions;
  for(const phrase of ['Search it when a fact is needed','English, Kannada or Hindi','Kannada-English','five minutes maximum',
   'current quotes','human follow-up','OTPs','busy, declining, opting out','end_interaction','end_message','voicemail',
   'extra calls or redial','actual evidence'])expect(text).toContain(phrase);
  expect(text).toContain('not authorization');expect(text).toContain('not authorize an external action');
  expect(text).not.toMatch(/\/opt\/|C:\\|orgId|connectionId|169135271|01a10103|API_KEY=/);
 });
 it('explicitly answers outbound company questions before returning to the unchanged approved objective',()=>{
  const text=buildCompanyVoiceDeploymentArtifacts().outbound.instructions;
  expect(text).toContain('Answer an unexpected company question first');expect(text).toContain('unchanged approved objective');
  expect(text).toContain('never use their later values to rewrite an approval, recipient, direction or permissions');
 });
 it('does not alter the reviewed source candidates or manufacture provider approval',()=>{
  const before=buildCompanyVoiceRouteCandidates();buildCompanyVoiceDeploymentArtifacts();
  expect(buildCompanyVoiceRouteCandidates()).toEqual(before);
  const f=buildCompanyVoiceDeploymentArtifacts();expect(f.reviewOnly).toBe(true);expect(f.dispatchAllowed).toBe(false);
  expect(f.inbound.instructions).not.toContain('providerAcceptanceVerified');expect(f.outbound.instructions).not.toContain('acceptanceEvidenceSha256');
 });
 it.each(['inbound','outbound'] as const)('does not make %s conversation depend on unavailable runtime route metadata',direction=>{
  const text=buildCompanyVoiceDeploymentArtifacts()[direction].instructions;
  expect(text).toContain('fixed direction header is the conversational direction context');
  expect(text).toContain('Do not ask the caller or agent variables to prove routing');
  expect(text).not.toContain('If deployment route binding is absent');
  expect(text).not.toContain('If the approved purpose or recipient is missing, or the route binding conflicts');
 });
});
