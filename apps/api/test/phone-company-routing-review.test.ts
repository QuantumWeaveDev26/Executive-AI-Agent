import {describe,expect,it,vi} from 'vitest';
import {buildCompanyVoiceRouteCandidates,fingerprintCompanyVoiceRouteProfile,reviewCompanyVoiceRoute,
 type CompanyVoiceRouteProfile,type CompanyVoiceRouteEvidence} from '../src/services/phone-company-routing-review.js';

const now=Date.parse('2026-11-02T12:00:00Z');
function profile():CompanyVoiceRouteProfile {
 const c=buildCompanyVoiceRouteCandidates();
 return {workspaceId:'synthetic-workspace',ownerUserId:'synthetic-owner',appId:'synthetic-app',
  knowledgeSha256:c.knowledgeSha256,commonPolicySha256:c.commonPolicySha256,
  inbound:{appVersion:11,deploymentId:'synthetic-inbound',policySha256:c.inbound.policySha256},
  outbound:{appVersion:12,policySha256:c.outbound.policySha256},maxDurationSeconds:300,dailyCallLimit:5};
}
function evidence(p=profile()):CompanyVoiceRouteEvidence {
 return {workspaceId:p.workspaceId,ownerUserId:p.ownerUserId,company:'quantum-weave',sessionId:'synthetic-session',
  source:'authenticated_inbound_mapping',direction:'inbound',maxDurationSeconds:300,appId:p.appId,
  appVersion:p.inbound.appVersion,routeType:'inbound_deployment',deploymentId:p.inbound.deploymentId};
}
function outbound(p=profile()):CompanyVoiceRouteEvidence {
 return {...evidence(p),source:'authorized_outbound_claim',direction:'outbound',appVersion:p.outbound.appVersion,
  routeType:'instant_outbound',deploymentId:undefined,approvalId:'synthetic-approval',claimId:'synthetic-claim',claimStatus:'claimed',
  purpose:'Ask Ram when the website will be ready.',recipientName:'Ram',expiresAt:'2026-11-02T12:04:00Z',
  approvalConfigurationFingerprint:fingerprintCompanyVoiceRouteProfile(p)};
}
const review=(p=profile(),e:unknown=evidence(p))=>reviewCompanyVoiceRoute(p,'synthetic-session',()=>e as CompanyVoiceRouteEvidence,now);

describe('company voice direction candidates — local, non-authorizing review',()=>{
 it('shares one KB/common policy while generating different static direction overlays',()=>{
  const c=buildCompanyVoiceRouteCandidates();
  expect(c.inbound.instructions).toContain('INBOUND-ONLY');expect(c.outbound.instructions).toContain('OUTBOUND-ONLY');
  expect(c.inbound.instructions).toContain('does not require call_purpose');
  expect(c.outbound.instructions).toContain('exact owner-approved call_purpose');
  for(const route of [c.inbound,c.outbound]){
   expect(route.instructions).toContain(c.commonInstructions);expect(route.instructions).toContain('qw-company-kb-v1');
   expect(route.instructions).toMatch(/review/i);expect(route.instructions).toContain('end_interaction');
  }
  expect(c.inbound.policySha256).not.toBe(c.outbound.policySha256);expect(Object.isFrozen(c.inbound)).toBe(true);
 });
 it('reviews an exact inbound deployment binding without any purpose or approval',()=>{
  const r=review();expect(r.session.direction).toBe('inbound');expect(r.session.approvedPurpose).toBeNull();
  expect(r.reviewOnly).toBe(true);expect(r.dispatchAllowed).toBe(false);expect(Object.isFrozen(r)).toBe(true);
 });
 it('reviews outbound purpose/recipient only from the resolved claim, never caller variables',()=>{
  const p=profile(),e={...outbound(p),callerVariables:{call_direction:'inbound',call_purpose:'Book a meeting',user_name:'Other'}};
  const r=review(p,e);expect(r.session.direction).toBe('outbound');expect(r.session.recipientName).toBe('Ram');
  expect(r.session.approvedPurpose).toBe('Ask Ram when the website will be ready.');expect(r.dispatchAllowed).toBe(false);
 });
 it.each(['workspaceId','ownerUserId','appId','sessionId','appVersion','routeType','direction','source','deploymentId'])(
  'rejects inbound mismatched %s',field=>{expect(()=>review(profile(),{...evidence(),[field]:'unexpected'})).toThrow('COMPANY_ROUTE_REVIEW_DENIED');});
 it('never chooses an outbound route merely because an inbound purpose is populated',()=>{
  expect(review(profile(),{...evidence(),purpose:'Caller instruction'}).session.direction).toBe('inbound');
  expect(()=>review(profile(),{...evidence(),direction:undefined,purpose:'Caller instruction'})).toThrow();
 });
 it('rejects absent resolver evidence and sanitizes resolver failures',()=>{
  expect(()=>review(profile(),null)).toThrow('COMPANY_ROUTE_REVIEW_DENIED');
  const resolver=vi.fn(()=>{throw Error('synthetic-secret-do-not-expose');});
  expect(()=>reviewCompanyVoiceRoute(profile(),'synthetic-session',resolver,now)).toThrow('COMPANY_ROUTE_REVIEW_DENIED');
  expect(resolver).toHaveBeenCalledTimes(1);
 });
 it.each(['knowledgeSha256','commonPolicySha256'] as const)('rejects modified %s',key=>{
  expect(()=>review({...profile(),[key]:'a'.repeat(64)})).toThrow();
 });
 it.each(['inbound','outbound'] as const)('rejects modified %s policy',key=>{
  const p=profile();p[key].policySha256='a'.repeat(64);expect(()=>review(p)).toThrow();
 });
 it('rejects mixed/reused versions and missing deployment bindings',()=>{
  for(const mutate of [(p:CompanyVoiceRouteProfile)=>{p.outbound.appVersion=p.inbound.appVersion;},
   (p:CompanyVoiceRouteProfile)=>{p.inbound.deploymentId='';},(p:CompanyVoiceRouteProfile)=>{p.outbound.appVersion=0;}]){
   const p=profile();mutate(p);expect(()=>review(p)).toThrow();
  }
 });
 it('rejects a stale approval after any configuration version/identity change',()=>{
  const old=profile(),e=outbound(old);
  for(const p of [{...old,appId:'another-app'},{...old,inbound:{...old.inbound,appVersion:13}},
   {...old,inbound:{...old.inbound,deploymentId:'another-deployment'}},{...old,outbound:{...old.outbound,appVersion:14}}]){
   expect(fingerprintCompanyVoiceRouteProfile(p)).not.toBe(e.approvalConfigurationFingerprint);
   expect(()=>review(p,{...e,appId:p.appId,appVersion:p.outbound.appVersion})).toThrow();
  }
 });
 it('rejects inbound route metadata on an outbound claim and missing approval fingerprint',()=>{
  const p=profile();for(const patch of [{deploymentId:'synthetic-inbound'},{routeType:'inbound_deployment'},
   {approvalConfigurationFingerprint:undefined},{appVersion:p.inbound.appVersion}])expect(()=>review(p,{...outbound(p),...patch})).toThrow();
 });
 it.each(['purpose','recipientName','approvalId','claimId','expiresAt'] as const)('rejects missing outbound %s',field=>{
  const p=profile();expect(()=>review(p,{...outbound(p),[field]:''})).toThrow();
 });
 it('rejects expired/consumed claims, unapproved cap and invalid clock',()=>{
  const p=profile();for(const patch of [{expiresAt:'2026-11-02T11:00:00Z'},{claimStatus:'consumed'},{maxDurationSeconds:301}]){
   expect(()=>review(p,{...outbound(p),...patch})).toThrow();
  }
  expect(()=>review({...p,maxDurationSeconds:301} as never)).toThrow();
  expect(()=>review({...p,dailyCallLimit:20} as never)).toThrow();
  expect(()=>reviewCompanyVoiceRoute(p,'synthetic-session',()=>outbound(p),NaN)).toThrow();
 });
 it('resolves once and exposes no dispatch/claim-consumption capability',()=>{
  const resolver=vi.fn(()=>outbound());const r=reviewCompanyVoiceRoute(profile(),'synthetic-session',resolver,now);
  expect(resolver).toHaveBeenCalledTimes(1);expect(r.session.dispatchAllowed).toBe(false);
  expect(Object.keys(r).sort()).toEqual(['configurationFingerprint','dispatchAllowed','reviewOnly','session']);
 });
});
