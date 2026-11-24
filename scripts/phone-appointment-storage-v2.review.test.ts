import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {appointmentStorageCommand,verifyAppointmentStorageManifest,verifyHistoricalEvidence,readV2Inputs,INPUT_REVIEW} from './phone-appointment-storage-v2.review.mjs';
import {makeInboundReview,INBOUND_REVIEW_FILES} from './phone-inbound-release-preflight.mjs';
import {INBOUND_HOSTED_GATE_FIXTURE} from './phone-inbound-runtime-config.mjs';
const sha=(v:any)=>createHash('sha256').update(v).digest('hex');
it('requires a new exact V2 approval and manifest pin',()=>{
 expect(appointmentStorageCommand(['--approved-appointment-storage-v2','--manifest-sha256','a'.repeat(64)]).mode).toBe('--approved-appointment-storage-v2');
 for(const args of [[],['--approved-appointment-storage','--manifest-sha256','a'.repeat(64)],['--approved-appointment-storage-v2'],['--preflight-only','--manifest-sha256','bad']])expect(()=>appointmentStorageCommand(args)).toThrow();
});
it('binds fresh five-case selection and refuses changed sources or old selection',()=>{
 const m={reviewOnly:true,purpose:'appointment-journal-postgres-acceptance',validationPlan:'appointment-storage-v2',transport:'owned-exec-loopback',dockerPublication:'none',expectedTests:5,plannedSkippedTests:4,historicalPassedCases:[1,2,3,4],fixture:INBOUND_HOSTED_GATE_FIXTURE,files:{sample:sha('source')}};
 expect(()=>verifyAppointmentStorageManifest(m,['sample'],()=>Buffer.from('source'))).not.toThrow();
 expect(()=>verifyAppointmentStorageManifest(m,['sample'],()=>Buffer.from('tampered'))).toThrow();
 expect(()=>verifyAppointmentStorageManifest({...m,expectedTests:9},['sample'],()=>Buffer.from('source'))).toThrow();
});
it('checks immutable historical receipts without granting V2 execution',()=>{
 expect(()=>verifyHistoricalEvidence(p=>readFileSync(p))).not.toThrow();
 expect(()=>verifyHistoricalEvidence(()=>Buffer.from('{}'))).toThrow();
});
it('rejects stale input snapshots before deriving SQL',()=>{
 const read=(p:string)=>Buffer.from(p===INPUT_REVIEW?JSON.stringify(makeInboundReview(()=>Buffer.from('original'))):'changed');
 const names=INBOUND_REVIEW_FILES.filter(p=>p.startsWith('packages/db/src/migrations/')).map(p=>p.split('/').pop());
 expect(()=>readV2Inputs(read,names)).toThrow('INBOUND_REVIEW_SOURCE_CHANGED');
});
it('selects cases 5–9 while retaining one fixture initialization and original nine cases',()=>{
 const s=readFileSync('apps/api/test/phone-inbound-appointment-storage.runtime.test.ts','utf8');
 expect(s.match(/it\.skipIf\(v2\)/g)).toHaveLength(4);
 expect(s).toContain('if(v2)await initializeFixture()');
 for(const n of ['05','06','07','08','09'])expect(s).toContain("it('"+n);
});
