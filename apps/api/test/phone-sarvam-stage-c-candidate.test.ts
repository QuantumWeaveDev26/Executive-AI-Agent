import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseSarvamRuntimeProfile,loadSarvamRuntime} from '../src/services/phone-sarvam-runtime.js';

const root='docs/integrations/phone/';
const json=(path:string)=>JSON.parse(readFileSync(root+path,'utf8'));
const sha=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const candidate=()=>json('sarvam-runtime-profile.stage-c-v6.review.json');
const evidence=()=>json('knowledge/stage-c-v6-review/admission-evidence.review.json');
const manifest=()=>json('knowledge/stage-c-v6-review/admission-manifest.review.json');
// Hypothetical attestation IN MEMORY ONLY. Never exported or installed; this tests parser compatibility, not provider truth.
const syntheticAdmitted=()=>{const p=candidate();p.reviewOnly=false;p.runtimeProfile=true;p.verifiedMaxCallLengthMinutes=5;
 p.companyKnowledge.reviewOnly=false;p.companyKnowledge.providerAcceptanceVerified=true;return p;};

describe('local Stage C v6/v5 candidate — no installation or provider access',()=>{
 it('pins distinct v6 outbound/v5 inbound and preserves existing provider identity and variable semantics',()=>{
  const p=candidate(),active=json('sarvam-runtime-profile.pilot.json');
  expect(p.appVersion).toBe(6);expect(p.companyKnowledge.inboundAppVersion).toBe(5);
  for(const k of ['orgId','workspaceId','appId','connectionId','agentPhoneNumber','variableMapping'])expect(p[k]).toEqual(active[k]);
  expect(p.requiredMaxCallLengthMinutes).toBe(5);expect(p.companyKnowledge.maxDurationSeconds).toBe(300);
 });
 it('refuses the real review artifact and refuses partial flag changes',()=>{
  expect(candidate()).toMatchObject({reviewOnly:true,runtimeProfile:false,verifiedMaxCallLengthMinutes:null,
   companyKnowledge:{reviewOnly:true,providerAcceptanceVerified:false}});
  expect(parseSarvamRuntimeProfile(candidate())).toEqual({reasons:expect.arrayContaining(['profile_not_runtime','duration_not_verified','knowledge_binding_invalid'])});
  const p=candidate();p.reviewOnly=false;p.runtimeProfile=true;p.verifiedMaxCallLengthMinutes=5;
  expect(parseSarvamRuntimeProfile(p)).toEqual({reasons:['knowledge_binding_invalid']});
 });
 it('binds exact reviewed KB, outgoing prompt, shared policy and pending evidence bytes',()=>{
  const p=candidate(),b=p.companyKnowledge;
  expect(b.knowledgeVersion).toBe('qw-company-kb-v1');expect(b.policyVersion).toBe('qw-route-policy-v1');expect(b.direction).toBe('outbound');
  expect(b.knowledgeSha256).toBe(sha(root+'knowledge/review-v1/quantum-weave-public.md'));
  expect(b.policySha256).toBe(sha(root+'knowledge/language-fix-v2/outbound-instructions.proposed.txt'));
  const marker='You are Thaara, an AI assistant representing Quantum Weave.';
  const common=(dir:string)=>{const text=readFileSync(root+`knowledge/language-fix-v2/${dir}-instructions.proposed.txt`,'utf8');return text.slice(text.indexOf(marker));};
  expect(common('inbound')).toBe(common('outbound'));
  expect(b.commonPolicySha256).toBe(createHash('sha256').update(common('outbound')).digest('hex'));
  expect(b.acceptanceEvidenceSha256).toBe(sha(root+'knowledge/stage-c-v6-review/admission-evidence.review.json'));
 });
 it('records the real five passing verdicts without inventing raw tool or live workflow evidence',()=>{
  const e=evidence();expect(e.providerSynthetic).toMatchObject({appVersion:6,passedChecks:5,totalChecks:5,providerJudgePassed:true,telephoneCalls:0});
  expect(e.providerSynthetic.verdicts).toHaveLength(5);
  expect(e.providerSynthetic.verdicts.every((x:{verdict:string})=>x.verdict==='Pass')).toBe(true);
  expect(e.providerSynthetic.sanitizedSpeechTurnCount).toBe(9);
  expect(e.providerSynthetic.rawTranscriptDigestIndependentlyRecomputed).toBe(false);
  expect(e.providerSynthetic.sanitizedSpeechSha256).not.toBe(e.providerSynthetic.transcriptSha256);
  expect(e.pending).toMatchObject({rawToolFramesManuallyVerified:false,inboundV5RolloutVerified:false,liveChatCallReportVerified:false,ownerAdmissionApproved:false});
  expect(e.providerAcceptanceVerified).toBe(false);
 });
 it('keeps the loader off or rejects the candidate before reading any secret',async()=>{
  const readText=vi.fn(async()=>JSON.stringify(candidate())),mode=vi.fn(async()=>0o600);
  expect(await loadSarvamRuntime({}, {readText,mode})).toEqual({status:'off',reasons:['live_switch_off']});expect(readText).not.toHaveBeenCalled();
  const result=await loadSarvamRuntime({THAARA_PHONE_LIVE_CALLING:'approved',THAARA_SARVAM_PROFILE_FILE:'/synthetic/profile'}, {readText,mode});
  expect(result).toMatchObject({status:'refused',reasons:expect.arrayContaining(['knowledge_binding_invalid','profile_not_runtime'])});expect(readText.mock.calls).toHaveLength(1);
 });
 it('is structurally compatible only with a hypothetical admitted copy and changes approval fingerprint',()=>{
  const admitted=parseSarvamRuntimeProfile(syntheticAdmitted()),active=parseSarvamRuntimeProfile(json('sarvam-runtime-profile.pilot.json'));
  expect('profile' in admitted).toBe(true);expect('profile' in active).toBe(true);
  if(!('profile' in admitted)||!('profile' in active))throw Error('synthetic fixture rejected');
  expect(admitted.profile.fingerprint).not.toBe(active.profile.fingerprint);
  const changed=syntheticAdmitted();changed.companyKnowledge.acceptanceEvidenceSha256='e'.repeat(64);
  const other=parseSarvamRuntimeProfile(changed);if(!('profile' in other))throw Error('fixture rejected');
  expect(other.profile.fingerprint).not.toBe(admitted.profile.fingerprint);
 });
 it('detects mixed versions/directions in hypothetical admission without weakening existing parsers',()=>{
  for(const patch of [{appVersion:5},{inboundAppVersion:6},{direction:'inbound'},{knowledgeSha256:'invalid'}]){
   const p=syntheticAdmitted();Object.assign(p.companyKnowledge,patch);
   expect(parseSarvamRuntimeProfile(p)).toEqual({reasons:['knowledge_binding_invalid']});
  }
 });
 it('preserves active profile, inbound approval and Vite bytes and leaves all ten gates closed',()=>{
  for(const [path,digest] of Object.entries(manifest().preservedFiles))expect(sha(path)).toBe(digest);
  expect(manifest().gates).toHaveLength(10);
  for(const path of manifest().gates)expect(JSON.parse(readFileSync(path,'utf8')).remoteExecutionAllowed).toBe(false);
 });
});
