// LOCAL CRYPTOGRAPHIC BOUNDARY PROTOTYPE. No IO, key enrolment, execution gate or DB driver.
import {verify,KeyObject} from 'node:crypto';
import {canonical,fingerprint} from './phone-inbound-expected-schema.mjs';
const fail=()=>{throw Error('REVIEW_PROVENANCE_DENIED');};
const keys=(v,k)=>v&&Object.getPrototypeOf(v)===Object.prototype&&canonical(Object.keys(v).sort())===canonical([...k].sort());
const id=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9-]{0,95}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const int=v=>Number.isSafeInteger(v)&&v>=0;
function registry(value){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||!Object.keys(value).length)fail();
 const entries=Object.entries(value);for(const [name,key] of entries)if(!id(name)||!(key instanceof KeyObject)||key.type!=='public'||key.asymmetricKeyType!=='ed25519')fail();
 return new Map(entries);
}
function signed(envelope,registry,identity){
 if(!keys(envelope,['payload','signature'])||typeof envelope.signature!=='string'||! /^[A-Za-z0-9+/]{86}==$/.test(envelope.signature))fail();
 const key=registry.get(envelope.payload?.[identity]);if(!key||!verify(null,Buffer.from(canonical(envelope.payload)),key,Buffer.from(envelope.signature,'base64')))fail();
 return envelope.payload;
}
export function createLocalReviewVerifier({reviewerKeys,authorityKeys,now,minRevocationSequence,maxSnapshotAge,maxApprovalLifetime,revocationCheckpoint}){
 if(process.env.NODE_ENV!=='test')throw Error('Review verifier is test-only');
 const reviewers=registry(reviewerKeys),authorities=registry(authorityKeys);
 if([...reviewers.keys()].some(k=>authorities.has(k))||typeof now!=='function'||!int(minRevocationSequence)||!int(maxSnapshotAge)||!maxSnapshotAge||!int(maxApprovalLifetime)||!maxApprovalLifetime)fail();
 if(!int(now()))fail();
 const reviewerIdentities=new Set([...reviewers.values()].map(k=>fingerprint(k.export({type:'spki',format:'pem'}))));
 if([...authorities.values()].some(k=>reviewerIdentities.has(fingerprint(k.export({type:'spki',format:'pem'})))))fail();
 let highestSequence=minRevocationSequence,lastSnapshot=null;
 const checkpointValid=c=>keys(c,['sequence','snapshotSha256'])&&int(c.sequence)&&c.sequence>=minRevocationSequence&&((c.snapshotSha256===null&&c.sequence===minRevocationSequence)||sha(c.snapshotSha256));
 if(revocationCheckpoint!==undefined){
  if(!revocationCheckpoint||typeof revocationCheckpoint.read!=='function'||typeof revocationCheckpoint.advance!=='function')fail();
  const c=revocationCheckpoint.read();if(!checkpointValid(c))fail();highestSequence=c.sequence;lastSnapshot=c.snapshotSha256;
 }
 // Trust anchors/clock/policy are constructor-only, not fields in a submitted review document.
 return (document,reviewEnvelope,revocationEnvelope)=>{
  if(process.env.NODE_ENV!=='test')throw Error('Review verifier is test-only');
  try{
   const t=now();if(!int(t))fail();
   const r=signed(reviewEnvelope,reviewers,'reviewerId'),s=signed(revocationEnvelope,authorities,'issuerId');
   if(!keys(r,['kind','approvalId','reviewerId','documentSha256','provenanceSha256','scope','issuedAt','expiresAt'])||r.kind!=='expected-schema-review-v1'||!id(r.approvalId)||!id(r.reviewerId)||!sha(r.documentSha256)||!sha(r.provenanceSha256)||r.scope!=='phone-inbound-expected-schema'||!int(r.issuedAt)||!int(r.expiresAt)||r.issuedAt>t||r.expiresAt<=t||r.expiresAt<=r.issuedAt||r.expiresAt-r.issuedAt>maxApprovalLifetime)fail();
   if(!keys(s,['kind','issuerId','sequence','issuedAt','expiresAt','revokedApprovalIds','revokedReviewerIds'])||s.kind!=='schema-revocations-v1'||!id(s.issuerId)||!int(s.sequence)||s.sequence<minRevocationSequence||!int(s.issuedAt)||!int(s.expiresAt)||s.issuedAt>t||s.expiresAt<=t||s.expiresAt<=s.issuedAt||t-s.issuedAt>maxSnapshotAge)fail();
   for(const values of [s.revokedApprovalIds,s.revokedReviewerIds])if(!Array.isArray(values)||values.length>4096||Object.keys(values).length!==values.length||values.some(v=>!id(v))||new Set(values).size!==values.length)fail();
   const snapshotHash=fingerprint(s);
   if(s.sequence<highestSequence||(s.sequence===highestSequence&&lastSnapshot!==null&&snapshotHash!==lastSnapshot))fail();
   if(revocationCheckpoint!==undefined){
    // Trusted store must atomically compare-and-advance its protected durable floor, across processes.
    const c=revocationCheckpoint.advance({sequence:s.sequence,snapshotSha256:snapshotHash});
    if(!checkpointValid(c)||c.sequence!==s.sequence||c.snapshotSha256!==snapshotHash)fail();
   }
   // Fresh authenticated revocation evidence advances the floor even when admission is denied.
   highestSequence=s.sequence;lastSnapshot=snapshotHash;
   if(s.revokedApprovalIds.includes(r.approvalId)||s.revokedReviewerIds.includes(r.reviewerId)||!document?.provenance||fingerprint(document)!==r.documentSha256||fingerprint(document.provenance)!==r.provenanceSha256)fail();
   return {status:'local_review_verified',executionAuthorized:false};
  }catch{return {status:'denied',executionAuthorized:false};}
 };
}
