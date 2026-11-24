import {it,expect,vi} from 'vitest';
import fs from 'node:fs';
import {generateKeyPairSync,sign} from 'node:crypto';
import {canonical,fingerprint} from './phone-inbound-expected-schema.mjs';
import {sqlStatementEvidence} from './phone-schema-source-evidence.mjs';
import {createLocalSchemaComposition} from './phone-schema-composition.mjs';
import {extractPg16Projection} from './phone-schema-pg16-extractor.mjs';
const h=(c:string)=>c.repeat(64);
const acl=[{grantor:'postgres',grantee:'thaara_app',privilege:'SELECT',grantable:false}];
function catalog():any{
 const tables=['workspaces','users','memberships','sessions','audit_events','phone_inbound_call_events','phone_inbound_principals'].map(n=>({name:'public.'+n,owner:'postgres',rls:true,forceRls:true,kind:'r',persistence:'p',options:[],parents:[],triggers:[],rules:[],columns:[{name:'id',position:1,type:'uuid',notNull:true,default:null,identity:'',generated:'',collation:null}],constraints:[],indexes:[],policies:[],acl:structuredClone(acl),columnAcl:[]}));
 const functions=['public.current_authenticated_scope()','public.resolve_session_scope(text)','public.phone_inbound_resolve_grant(text,text,text)','public.phone_inbound_scope_matches(uuid,uuid)','public.phone_inbound_append_event(jsonb)'].map(signature=>({signature,owner:'postgres',definition:'SYNTHETIC COMPLETE TEXT ONLY; NOT AN ACTUAL SQL CONTRACT',language:'sql',result:'boolean',kind:'f',securityDefiner:true,leakproof:false,strict:false,volatility:'v',parallel:'u',config:['search_path=pg_catalog, pg_temp'],acl:[{...acl[0],privilege:'EXECUTE'}]}));
 return {format:'pg16-security-v1',serverVersionNum:160006,stage:'after113',tables,functions,roles:['postgres','thaara_app','thaara_worker','thaara_phone_guard','thaara_phone_ingest'].map(name=>({name,login:false,inherit:false,super:false,bypassRls:false,createDb:false,createRole:false,replication:false,connectionLimit:-1,validUntil:null,config:[]})),schemas:[{name:'public',owner:'postgres',acl:[{...acl[0],privilege:'USAGE'}]}],memberships:[],defaultPrivileges:[],dependencies:[{name:'synthetic-base',kind:'reviewed-contract',sha256:h('1')}]};
}
function fixture(){
 const sources=Array.from({length:14},(_,i)=>({path:`synthetic-source-${i}.sql`,bytes:Buffer.from(`-- synthetic ${i}\nSELECT 1;\n`)}));
 const coverage=sources.map(s=>{const e=sqlStatementEvidence(s.bytes);return {path:s.path,sha256:e.sha256,statements:e.statements.map(s=>s.sha256)};});
 const binding={postgresVersionNum:160006,imageId:'sha256:'+h('1'),imageRepoDigest:'postgres@sha256:'+h('2'),platform:'linux/amd64',stage:'after113',sourceSetSha256:fingerprint(coverage),extractorSha256:h('3'),normalizerSha256:h('4')};
 const doc:any={format:'phone-schema-composition-v1',provenance:structuredClone(binding),sourceCoverage:coverage,catalog:catalog(),coverage:{tables:[],functions:[],roles:[],schemas:[],dependencies:[]},grantorEvidence:{status:'reviewed-isolated-test',evidenceSha256:h('5'),bindingSha256:fingerprint(binding),aclSha256:''}};
 for(const [key,field] of [['tables','name'],['functions','signature'],['roles','name'],['schemas','name'],['dependencies','name']])doc.coverage[key]=doc.catalog[key].map((x:any)=>x[field]).sort();
 const aclProjection=(c:any)=>({tables:c.tables.map((t:any)=>({name:t.name,owner:t.owner,acl:t.acl,columnAcl:t.columnAcl})),functions:c.functions.map((f:any)=>({signature:f.signature,owner:f.owner,acl:f.acl})),schemas:c.schemas,defaultPrivileges:c.defaultPrivileges,memberships:c.memberships});
 doc.grantorEvidence.aclSha256=fingerprint(aclProjection(doc.catalog));
 const reference={expectedDocumentSha256:fingerprint(doc),provenanceSha256:fingerprint(binding),sourceSetSha256:binding.sourceSetSha256,coverageSha256:fingerprint(doc.coverage),grantorEvidenceSha256:doc.grantorEvidence.evidenceSha256};
 const reviewer=generateKeyPairSync('ed25519'),authority=generateKeyPairSync('ed25519');
 const review:any={kind:'expected-schema-review-v1',approvalId:'review-fixture',reviewerId:'independent',documentSha256:fingerprint(doc),provenanceSha256:fingerprint(binding),scope:'phone-inbound-expected-schema',issuedAt:100,expiresAt:200};
 const status:any={kind:'schema-revocations-v1',issuerId:'authority',sequence:4,issuedAt:140,expiresAt:170,revokedApprovalIds:[],revokedReviewerIds:[]};
 let checkpoint:any={sequence:3,snapshotSha256:null},writes=0,broken=false;
 // Simulated protected atomic store survives reconstructed verifier instances in these tests.
 const store={read:()=>structuredClone(checkpoint),advance:(next:any)=>{if(broken)throw Error('PRIVATE STORE FAILURE');if(next.sequence<checkpoint.sequence||(next.sequence===checkpoint.sequence&&checkpoint.snapshotSha256!==null&&next.snapshotSha256!==checkpoint.snapshotSha256))throw Error('rollback');checkpoint=structuredClone(next);writes++;return structuredClone(checkpoint);}};
 const policy={reviewerKeys:{independent:reviewer.publicKey},authorityKeys:{authority:authority.publicKey},now:()=>150,minRevocationSequence:3,maxSnapshotAge:20,maxApprovalLifetime:100};
 const observed=structuredClone(doc.catalog);
 const capture=()=>({format:'pg16-projection-v1',provenance:structuredClone(binding),unsupported:[],projection:{server_version_num:observed.serverVersionNum,stage:observed.stage,relations:structuredClone(observed.tables),routines:structuredClone(observed.functions),principals:structuredClone(observed.roles),namespaces:structuredClone(observed.schemas),role_memberships:structuredClone(observed.memberships),default_acls:structuredClone(observed.defaultPrivileges),dependency_contracts:structuredClone(observed.dependencies)}});
 const envelope=(p:any,k:any)=>({payload:structuredClone(p),signature:sign(null,Buffer.from(canonical(p)),k).toString('base64')});
 const make=()=>createLocalSchemaComposition({binding,sources,reference,reviewPolicy:policy,revocationStore:store});
 const request=()=>({expected:structuredClone(doc),capture:capture(),review:envelope(review,reviewer.privateKey),revocations:envelope(status,authority.privateKey)});
 return {sources,binding,reference,doc,review,status,store,make,request,envelope,reviewer,authority,get checkpoint(){return checkpoint;},get writes(){return writes;},breakStore:()=>broken=true,repin:()=>{review.documentSha256=fingerprint(doc);review.provenanceSha256=fingerprint(doc.provenance);}};
}
it('composes source coverage, binding, schema validation, signed review, grantor evidence and exact observation',()=>{
 const f=fixture(),r=f.make()(f.request());expect(r).toEqual({status:'synthetic_composed_match',productionAdmission:false,executionAuthorized:false});expect(f.writes).toBe(1);
});
it.each(['missing-catalog','missing-coverage','missing-source','extra-source','wrong-statement','invalid-schema','unknown-field','wrong-version','wrong-image','wrong-extractor','unverified-grantor','wrong-grantor-evidence'])('a fresh valid signature cannot bypass %s',mode=>{
 const f=fixture();if(mode==='missing-catalog')delete f.doc.catalog;if(mode==='missing-coverage')f.doc.coverage.tables.pop();if(mode==='missing-source')f.doc.sourceCoverage.pop();if(mode==='extra-source')f.doc.sourceCoverage.push({...f.doc.sourceCoverage[0],path:'foreign.sql'});if(mode==='wrong-statement')f.doc.sourceCoverage[0].statements[0]=h('0');
 if(mode==='invalid-schema')f.doc.catalog.tables.pop();if(mode==='unknown-field')f.doc.catalog.extra=true;if(mode==='wrong-version')f.doc.provenance.postgresVersionNum=160007;if(mode==='wrong-image')f.doc.provenance.imageId='sha256:'+h('0');if(mode==='wrong-extractor')f.doc.provenance.extractorSha256=h('0');if(mode==='unverified-grantor')f.doc.grantorEvidence.status='observed';if(mode==='wrong-grantor-evidence')f.doc.grantorEvidence.aclSha256=h('0');
 f.repin();expect(f.make()(f.request()).status).toBe('denied');
});
it.each(['caller-boolean','expired','revoked','changed-source','changed-observation','changed-grantor','unsupported-object','missing-observation','wrong-observed-version','extra-observed-field'])('rejects %s without granting execution',mode=>{
 const f=fixture();if(mode==='expired')f.review.expiresAt=140;if(mode==='revoked')f.status.revokedApprovalIds=['review-fixture'];if(mode==='changed-source')f.sources[0].bytes=Buffer.from('SELECT 2;');
 const run=f.make(),q:any=f.request();if(mode==='caller-boolean')q.review={approved:true};if(mode==='changed-observation')q.capture.projection.relations[0].rls=false;if(mode==='changed-grantor')q.capture.projection.relations[0].acl[0].grantor='foreign';if(mode==='unsupported-object')q.capture.unsupported=['view:public.foreign'];if(mode==='missing-observation')delete q.capture;if(mode==='wrong-observed-version')q.capture.projection.server_version_num=160007;if(mode==='extra-observed-field')q.capture.projection.extra=true;
 const r=run(q);expect(r.status).toBe('denied');expect(r.executionAuthorized).toBe(false);
});
it('does not accept missing or failed protected checkpoint storage',()=>{
 const f=fixture();f.breakStore();expect(f.make()(f.request()).status).toBe('denied');
 expect(()=>createLocalSchemaComposition({binding:f.binding,sources:f.sources,reviewPolicy:{},revocationStore:null})).toThrow();
});
it('persists newer signed revocations even on denial and blocks rollback after reconstruction',()=>{
 const f=fixture();f.status.sequence=5;f.status.revokedApprovalIds=['review-fixture'];expect(f.make()(f.request()).status).toBe('denied');expect(f.checkpoint.sequence).toBe(5);
 f.status.sequence=4;f.status.revokedApprovalIds=[];expect(f.make()(f.request()).status).toBe('denied');expect(f.checkpoint.sequence).toBe(5);
});
it('cannot poison the durable floor with an invalid signature',()=>{
 const f=fixture(),q=f.request();q.revocations.payload.sequence=99;expect(f.make()(q).status).toBe('denied');expect(f.writes).toBe(0);expect(f.checkpoint.sequence).toBe(3);
});
it('rejects stale concurrent verifier state at the atomic checkpoint port',()=>{
 const f=fixture(),old=f.make(),next=f.make();f.status.sequence=5;expect(next(f.request()).status).toBe('synthetic_composed_match');
 f.status.sequence=4;expect(old(f.request()).status).toBe('denied');expect(f.checkpoint.sequence).toBe(5);
});
it('denies wrong checkpoint receipts and malformed or unavailable protected state',()=>{
 const f=fixture();const bad={read:()=>({sequence:3,snapshotSha256:null}),advance:()=>({sequence:99,snapshotSha256:h('0')})};
 const policy={reviewerKeys:{independent:f.reviewer.publicKey},authorityKeys:{authority:f.authority.publicKey},now:()=>150,minRevocationSequence:3,maxSnapshotAge:20,maxApprovalLifetime:100};
 const run=createLocalSchemaComposition({binding:f.binding,sources:f.sources,reference:f.reference,reviewPolicy:policy,revocationStore:bad});expect(run(f.request()).status).toBe('denied');
 for(const state of [{sequence:2,snapshotSha256:null},{sequence:4,snapshotSha256:null},{sequence:3,snapshotSha256:'bad'},null]){
  expect(()=>createLocalSchemaComposition({binding:f.binding,sources:f.sources,reference:f.reference,reviewPolicy:policy,revocationStore:{read:()=>state,advance:()=>state}})).toThrow();
 }
 expect(()=>createLocalSchemaComposition({binding:f.binding,sources:f.sources,reference:f.reference,reviewPolicy:policy,revocationStore:{read:()=>{throw Error('UNAVAILABLE');},advance:()=>null}})).toThrow();
});
it('does not promote the actual unapproved source candidate into an expected catalog',()=>{
 const f=fixture();const q=f.request();q.expected=JSON.parse(fs.readFileSync('docs/integrations/phone/INBOUND_EXPECTED_SCHEMA_SOURCE_CANDIDATE_2026-11-04.json','utf8'));
 expect(f.make()(q).status).toBe('denied');
});
it('requires an independently provisioned reference pin, not only a new review signature',()=>{
 const f=fixture();expect(()=>createLocalSchemaComposition({binding:f.binding,sources:f.sources,reviewPolicy:{},revocationStore:f.store})).toThrow();
 f.reference.expectedDocumentSha256=h('0');expect(f.make()(f.request()).status).toBe('denied');
});
it('never treats a protected reference pin as a replacement for catalog validation',()=>{
 const f=fixture();f.doc.catalog.tables[0].columns=[];f.repin();f.reference.expectedDocumentSha256=fingerprint(f.doc);expect(f.make()(f.request()).status).toBe('denied');
});
it.each(['format','missing-projection','extra-envelope','missing-binding','unsupported-array'])('extractor denies %s',mode=>{
 const f=fixture(),capture:any=f.request().capture;
 if(mode==='format')capture.format='pg17-projection-v1';if(mode==='missing-projection')delete capture.projection;if(mode==='extra-envelope')capture.extra=true;if(mode==='missing-binding')delete capture.provenance;if(mode==='unsupported-array')capture.unsupported={};
 expect(()=>extractPg16Projection(capture,f.binding)).toThrow();
});
it('does not mutate expected, capture or source buffers and does not return untrusted error text',()=>{
 const f=fixture(),q=f.request(),before=canonical(q),buffers=f.sources.map(s=>s.bytes.toString('hex'));expect(f.make()(q).status).toBe('synthetic_composed_match');expect(canonical(q)).toBe(before);expect(f.sources.map(s=>s.bytes.toString('hex'))).toEqual(buffers);
 f.breakStore();expect(canonical(f.make()(f.request()))).not.toContain('PRIVATE');
});
it('uses immutable verified source inputs even if original buffers change after initialization',()=>{
 const f=fixture(),verify=f.make(),q=f.request();f.sources[0].bytes.fill(0);f.sources.reverse();
 expect(verify(q).status).toBe('synthetic_composed_match');
 // A newly initialized verifier sees the changed bytes and refuses them; no file reread is hidden.
 expect(()=>f.make()).toThrow();
});
it('extracts only the exact pinned projection without changing PostgreSQL definitions',()=>{
 const f=fixture(),q=f.request(),before=JSON.stringify(q.capture);expect(extractPg16Projection(q.capture,f.binding)).toEqual(expect.objectContaining({serverVersionNum:160006}));expect(JSON.stringify(q.capture)).toBe(before);
});
it('keeps the composition and extractor test-only',()=>{
 const f=fixture();vi.stubEnv('NODE_ENV','production');try{expect(()=>f.make()).toThrow(/test-only/);expect(()=>extractPg16Projection(f.request().capture,f.binding)).toThrow(/test-only/);}finally{vi.unstubAllEnvs();}
});
