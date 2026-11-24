// DESIGN MODEL ONLY. No IO, SQL, approval writer or runtime integration.
import {createHash} from 'node:crypto';
const deny=()=>{throw Error('EXPECTED_SCHEMA_DENIED');};
const keys=(v,k)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join('|')===[...k].sort().join('|');
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function canonical(value){
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isSafeInteger(value))return String(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 deny();
}
export const fingerprint=value=>createHash('sha256').update(canonical(value)).digest('hex');
const bindingKeys=['sql112Sha256','sql113Sha256','baseContractSha256','extractorSha256','canonicalizerSha256','postgresVersionNum','imageId','imageRepoDigest','platform','stage'];
function binding(v){
 if(!keys(v,bindingKeys)||['sql112Sha256','sql113Sha256','baseContractSha256','extractorSha256','canonicalizerSha256'].some(k=>!hash(v[k]))
  ||!Number.isSafeInteger(v.postgresVersionNum)||v.postgresVersionNum<160000||v.postgresVersionNum>169999
  ||!/^sha256:[a-f0-9]{64}$/.test(v.imageId)||!/^postgres@sha256:[a-f0-9]{64}$/.test(v.imageRepoDigest)
  ||!['linux/amd64','linux/arm64'].includes(v.platform)||!['after112','after113'].includes(v.stage))deny();
}
/** trustedReview is a synthetic trusted port, NOT a caller JSON approval or signature verifier.
 * Production requires an independently authenticated approval store and complete catalog contract. */
export function compareExpectedSchema({expected,observed,context,trustedReview,now}){
 if(process.env.NODE_ENV!=='test')throw Error('Expected schema model is test-only');
 try{
  if(!keys(expected,['format','provenance','catalog'])||expected.format!=='phone-schema-design-v1')deny();
  binding(expected.provenance);binding(context);
  if(canonical(expected.provenance)!==canonical(context))deny();
  if(!expected.catalog||Object.getPrototypeOf(expected.catalog)!==Object.prototype||Object.keys(expected.catalog).length===0)deny();
  if(!keys(trustedReview,['scope','decision','documentSha256','authorizationId','issuedAt','expiresAt'])
   ||trustedReview.scope!=='phone-expected-schema-review'||trustedReview.decision!=='approved'
   ||!hash(trustedReview.documentSha256)||trustedReview.documentSha256!==fingerprint(expected)
   ||typeof trustedReview.authorizationId!=='string'||!/^review-[a-z0-9-]{1,64}$/.test(trustedReview.authorizationId)
   ||!Number.isSafeInteger(now)||!Number.isSafeInteger(trustedReview.issuedAt)||!Number.isSafeInteger(trustedReview.expiresAt)
   ||trustedReview.issuedAt>now||trustedReview.expiresAt<=now||trustedReview.expiresAt<=trustedReview.issuedAt)deny();
  if(fingerprint(observed)!==fingerprint(expected.catalog))deny();
  return {status:'mock_match',runtimeAdmitted:false};
 }catch{return {status:'denied',runtimeAdmitted:false};}
}
