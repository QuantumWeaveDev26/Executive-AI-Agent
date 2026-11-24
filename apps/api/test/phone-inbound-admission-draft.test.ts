import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createSarvamInboundService,buildInboundServiceBinding} from '../src/services/phone-sarvam-inbound-service.js';
import {createInboundJournalReportFeed} from '../src/services/phone-inbound-journal-feed.js';
const draft=JSON.parse(readFileSync(new URL('../../../docs/integrations/phone/sarvam-inbound-admission.draft.json',import.meta.url),'utf8'));
it('keeps unknown Thaara identities and credential references unset instead of reusing provider identifiers',()=>{
 expect(draft.reviewOnly).toBe(true);expect(draft.runtimeEnabled).toBe(false);expect(draft.productionReady).toBe(false);
 expect(Object.values(draft.thaaraIdentity).every(v=>v===null)).toBe(true);expect(Object.values(draft.credentialReferences).every(v=>v===null)).toBe(true);
 expect(Object.values(draft.hostingGates).every(v=>v===false)).toBe(true);
});
it('preserves intended v5/five-minute/report-only policy without asserting fresh provider verification',()=>{
 expect(draft.providerBinding).toMatchObject({intendedCommittedAppVersion:5,maxCallLengthSeconds:300,currentBindingIndependentlyVerified:false,toolAuthenticationIndependentlyVerified:false});
 expect(draft.policy).toMatchObject({direction:'inbound',callbackMeaning:'human_team_request',calendarBooking:'disabled',mediaRetention:'off',outboundDispatch:'disabled'});
});
it('cannot turn this draft into a canonical authorization profile by flipping review flags',()=>{
 expect(()=>buildInboundServiceBinding(draft)).toThrow();
 expect(()=>buildInboundServiceBinding({...draft,reviewOnly:false,runtimeEnabled:true,productionReady:true})).toThrow();
});
it('keeps production service/feed constructors blocked before touching injected storage',()=>{
 vi.stubEnv('NODE_ENV','production');const touched=vi.fn();
 try{
  expect(()=>createSarvamInboundService({profile:draft,transactions:{withGrant:touched}})).toThrow(/test-only/);
  expect(()=>createInboundJournalReportFeed({repository:{list:touched,read:touched}})).toThrow(/test-only/);
  expect(touched).not.toHaveBeenCalled();
 }finally{vi.unstubAllEnvs();}
});
