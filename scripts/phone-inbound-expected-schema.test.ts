import {it,expect,vi} from 'vitest';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {compareExpectedSchema,canonical,fingerprint} from './phone-inbound-expected-schema.mjs';
const h=(c:string)=>c.repeat(64);
function fixture(){
 const provenance={sql112Sha256:h('1'),sql113Sha256:h('2'),baseContractSha256:h('3'),extractorSha256:h('4'),canonicalizerSha256:h('5'),postgresVersionNum:160006,imageId:'sha256:'+h('6'),imageRepoDigest:'postgres@sha256:'+h('7'),platform:'linux/amd64',stage:'after113'};
 // SYNTHETIC only: not a full schema, reviewed baseline or actual PostgreSQL catalog.
 const catalog={table:{name:'synthetic',forced:true},grants:[['owner','reader','SELECT',false]]};
 const expected={format:'phone-schema-design-v1',provenance,catalog};
 return {expected,observed:structuredClone(catalog),context:structuredClone(provenance),trustedReview:{scope:'phone-expected-schema-review',decision:'approved',documentSha256:fingerprint(expected),authorizationId:'review-synthetic',issuedAt:100,expiresAt:200},now:150};
}
it('compares an independently pinned synthetic expectation without admitting runtime',()=>{expect(compareExpectedSchema(fixture())).toEqual({status:'mock_match',runtimeAdmitted:false});});
it('canonicalizes object key order, preserves array order and rejects undefined',()=>{
 expect(canonical({b:2,a:1})).toBe(canonical({a:1,b:2}));expect(fingerprint([1,2])).not.toBe(fingerprint([2,1]));expect(()=>canonical(undefined)).toThrow();
});
it.each(['missing','unapproved','expired','future','wrong-scope','wrong-document'])('denies %s approval',mode=>{
 const f:any=fixture();if(mode==='missing')f.trustedReview=null;
 if(mode==='unapproved')f.trustedReview.decision='pending';if(mode==='expired')f.now=200;
 if(mode==='future')f.now=99;if(mode==='wrong-scope')f.trustedReview.scope='execute';if(mode==='wrong-document')f.trustedReview.documentSha256=h('0');
 expect(compareExpectedSchema(f).status).toBe('denied');
});
it.each(['sql112Sha256','sql113Sha256','baseContractSha256','extractorSha256','canonicalizerSha256','postgresVersionNum','imageId','imageRepoDigest','platform','stage'])('denies changed target/provenance %s',key=>{
 const f:any=fixture();f.context[key]=key==='postgresVersionNum'?160007:key==='stage'?'after112':key==='platform'?'linux/arm64':h('0');expect(compareExpectedSchema(f).status).toBe('denied');
});
it('cannot repin tampered expected definitions or provenance using the old approval',()=>{
 for(const mutate of [(f:any)=>f.expected.catalog.table.forced=false,(f:any)=>{f.expected.provenance.sql112Sha256=h('0');f.context.sql112Sha256=h('0');}]){
  const f=fixture();mutate(f);expect(compareExpectedSchema(f).status).toBe('denied');
 }
});
it.each(['grantor','extra','missing','value'])('rejects observed catalog drift: %s',mode=>{
 const f:any=fixture();if(mode==='grantor')f.observed.grants[0][0]='foreign';if(mode==='extra')f.observed.extra=true;
 if(mode==='missing')delete f.observed.table;if(mode==='value')f.observed.table.forced=false;
 expect(compareExpectedSchema(f).status).toBe('denied');
});
it('rejects missing fingerprint and malformed or extra envelope fields',()=>{
 for(const mutate of [(f:any)=>delete f.trustedReview.documentSha256,(f:any)=>f.expected.observedHash='copied',(f:any)=>f.context.postgresVersionNum=16,(f:any)=>f.expected.catalog={}]){
  const f=fixture();mutate(f);expect(compareExpectedSchema(f).status).toBe('denied');
 }
});
it('does not mutate passed evidence',()=>{const f=fixture(),before=JSON.stringify(f);compareExpectedSchema(f);expect(JSON.stringify(f)).toBe(before);});
it('cannot run outside tests',()=>{vi.stubEnv('NODE_ENV','production');try{expect(()=>compareExpectedSchema(fixture())).toThrow(/test-only/);}finally{vi.unstubAllEnvs();}});
it('pins source-derived candidate spans to unchanged SQL bytes without issuing a fingerprint',()=>{
 const candidate=JSON.parse(fs.readFileSync('docs/integrations/phone/INBOUND_EXPECTED_SCHEMA_SOURCE_CANDIDATE_2026-11-04.json','utf8'));
 expect(candidate.expectedCatalogSha256).toBeNull();expect(candidate.reviewAuthorization).toBeNull();
 const allowed=['docs/migrations/112h-phone-inbound-events.hosted-review.sql','docs/migrations/113h-phone-inbound-principals.hosted-review.sql'];
 const sha=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
 for(const span of candidate.provenance){
  expect(allowed).toContain(span.path);const raw=fs.readFileSync(span.path);expect(sha(raw)).toBe(span.artifactSha256);
  const lines=raw.toString('utf8').match(/[^\n]*\n|[^\n]+$/g)!;
  expect(sha(Buffer.from(lines.slice(span.lines[0]-1,span.lines[1]).join('')))).toBe(span.rawLineSpanSha256);
 }
 expect(fs.readFileSync('deploy/hostinger-pilot/phone-inbound-recovery-rehearsal.review.py','utf8')).toContain("'independentBaselineVerified':False");
 expect(JSON.parse(fs.readFileSync('docs/integrations/phone/PHONE_INBOUND_RECOVERY_REHEARSAL_V1.review.json','utf8')).independentReviewComplete).toBe(false);
});
