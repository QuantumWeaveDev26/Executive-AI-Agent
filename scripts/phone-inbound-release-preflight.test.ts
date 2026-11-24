import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {INBOUND_REVIEW_FILES,makeInboundReview,verifyInboundReview} from './phone-inbound-release-preflight.mjs';
const source=(path:string)=>Buffer.from('synthetic-review-source:'+path);
const names=INBOUND_REVIEW_FILES.filter((p:string)=>p.startsWith('packages/db/src/migrations/')).map((p:string)=>p.split('/').pop()!);
it('verifies a review snapshot without granting any execution or production permission',()=>{
 const m=makeInboundReview(source);const r=verifyInboundReview(m,source,names);
 expect(r).toMatchObject({status:'review_integrity_verified',executionAllowed:false,productionReady:false,sqlExecuted:false,providerRequests:0});
 expect(r.pinnedFiles).toBe(INBOUND_REVIEW_FILES.length);
});
it('rejects changed, missing and extra source pins before considering readiness',()=>{
 const m=makeInboundReview(source);expect(()=>verifyInboundReview(m,(p:string)=>p===INBOUND_REVIEW_FILES[0]?Buffer.from('changed'):source(p),names)).toThrow('INBOUND_REVIEW_SOURCE_CHANGED');
 const missing=structuredClone(m);delete missing.files[INBOUND_REVIEW_FILES[0]!];expect(()=>verifyInboundReview(missing,source,names)).toThrow();
 const extra=structuredClone(m);extra.files['../private']=createHash('sha256').update('x').digest('hex');expect(()=>verifyInboundReview(extra,source,names)).toThrow();
});
it('rejects added or missing base migrations and refuses permissive execution flags',()=>{
 const m=makeInboundReview(source);for(const actual of [names.slice(1),[...names,'0013_unreviewed.sql']])expect(()=>verifyInboundReview(m,source,actual)).toThrow('INBOUND_REVIEW_BASE_SET_CHANGED');
 for(const change of [{executionAllowed:true},{productionReady:true},{reviewOnly:false},{unknown:'field'}])expect(()=>verifyInboundReview({...m,...change},source,names)).toThrow('INBOUND_REVIEW_MANIFEST_INVALID');
});
