// LOCAL ONLY. Synthetic consistency composition, never production or execution admission.
import {canonical,fingerprint} from './phone-inbound-expected-schema.mjs';
import {sqlStatementEvidence} from './phone-schema-source-evidence.mjs';
import {normalizePg16,comparePg16} from './phone-schema-pg16.mjs';
import {createLocalReviewVerifier} from './phone-schema-review-verifier.mjs';
import {extractPg16Projection} from './phone-schema-pg16-extractor.mjs';
const fail=()=>{throw Error('SCHEMA_COMPOSITION_DENIED');};
const keys=(v,k)=>v&&Object.getPrototypeOf(v)===Object.prototype&&canonical(Object.keys(v).sort())===canonical([...k].sort());
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const result=status=>({status,productionAdmission:false,executionAuthorized:false});
const aclProjection=c=>({tables:c.tables.map(t=>({name:t.name,owner:t.owner,acl:t.acl,columnAcl:t.columnAcl})),functions:c.functions.map(f=>({signature:f.signature,owner:f.owner,acl:f.acl})),schemas:c.schemas,defaultPrivileges:c.defaultPrivileges,memberships:c.memberships});
export function createLocalSchemaComposition({binding,sources,reference,reviewPolicy,revocationStore}){
 if(process.env.NODE_ENV!=='test')throw Error('Schema composition is test-only');
 if(!keys(binding,['postgresVersionNum','imageId','imageRepoDigest','platform','stage','sourceSetSha256','extractorSha256','normalizerSha256'])||!Number.isSafeInteger(binding.postgresVersionNum)||binding.postgresVersionNum<160000||binding.postgresVersionNum>169999||!/^sha256:[a-f0-9]{64}$/.test(binding.imageId)||!/^postgres@sha256:[a-f0-9]{64}$/.test(binding.imageRepoDigest)||!['linux/amd64','linux/arm64'].includes(binding.platform)||!['after112','after113'].includes(binding.stage)||['sourceSetSha256','extractorSha256','normalizerSha256'].some(k=>!sha(binding[k])))fail();
 if(!Array.isArray(sources)||sources.length!==14||new Set(sources.map(s=>s.path)).size!==14||!revocationStore||typeof revocationStore.read!=='function'||typeof revocationStore.advance!=='function')fail();
 if(!keys(reference,['expectedDocumentSha256','provenanceSha256','sourceSetSha256','coverageSha256','grantorEvidenceSha256'])||Object.values(reference).some(v=>!sha(v)))fail();
 const pinnedReference=structuredClone(reference);
 const pinnedBinding=structuredClone(binding),coverage=sources.map(s=>{
  if(!keys(s,['path','bytes'])||typeof s.path!=='string'||!s.path||s.path.length>512||!Buffer.isBuffer(s.bytes))fail();
  const e=sqlStatementEvidence(Buffer.from(s.bytes));return {path:s.path,sha256:e.sha256,statements:e.statements.map(x=>x.sha256)};
 });
 const verifyReview=createLocalReviewVerifier({...reviewPolicy,revocationCheckpoint:revocationStore});
 return request=>{
  if(process.env.NODE_ENV!=='test')throw Error('Schema composition is test-only');
  try{
   if(!keys(request,['expected','capture','review','revocations']))fail();
   const e=request.expected;
   // Authenticate/update revocation checkpoint before rejecting an incomplete expected document.
   const review=verifyReview(e,request.review,request.revocations);
   if(review.status!=='local_review_verified')fail();
   // This reference is constructor-only protected configuration, never a field trusted from requests.
   if(fingerprint(e)!==pinnedReference.expectedDocumentSha256||fingerprint(e.provenance)!==pinnedReference.provenanceSha256||fingerprint(coverage)!==pinnedReference.sourceSetSha256||fingerprint(e.coverage)!==pinnedReference.coverageSha256)fail();
   if(!keys(e,['format','provenance','sourceCoverage','catalog','coverage','grantorEvidence'])||e.format!=='phone-schema-composition-v1'||canonical(e.provenance)!==canonical(pinnedBinding)||canonical(e.sourceCoverage)!==canonical(coverage)||fingerprint(coverage)!==pinnedBinding.sourceSetSha256)fail();
   const expected=normalizePg16(e.catalog);
   if(expected.serverVersionNum!==pinnedBinding.postgresVersionNum||expected.stage!==pinnedBinding.stage||!keys(e.coverage,['tables','functions','roles','schemas','dependencies']))fail();
   for(const [collection,key] of [['tables','name'],['functions','signature'],['roles','name'],['schemas','name'],['dependencies','name']]){
    const names=expected[collection].map(x=>x[key]).sort();if(canonical(e.coverage[collection])!==canonical(names))fail();
   }
   if(!keys(e.grantorEvidence,['status','evidenceSha256','bindingSha256','aclSha256'])||e.grantorEvidence.status!=='reviewed-isolated-test'||e.grantorEvidence.evidenceSha256!==pinnedReference.grantorEvidenceSha256||e.grantorEvidence.bindingSha256!==fingerprint(pinnedBinding)||e.grantorEvidence.aclSha256!==fingerprint(aclProjection(e.catalog)))fail();
   const observed=extractPg16Projection(request.capture,pinnedBinding);
   if(!comparePg16(expected,observed))fail();
   return result('synthetic_composed_match');
  }catch{return result('denied');}
 };
}
