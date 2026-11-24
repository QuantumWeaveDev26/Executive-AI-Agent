import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {referenceCommand,referenceInputs,referenceExecutionClosure,verifyReferenceManifest,sanitizeReferenceFailure} from './phone-f03-reference.review.mjs';
import {INBOUND_HOSTED_GATE_FIXTURE} from './phone-inbound-runtime-config.mjs';
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
it('requires a new exact mode and manifest pin; never accepts old appointment execution flags',()=>{
 expect(referenceCommand(['--prepare-review'])).toEqual({mode:'--prepare-review',pin:null});
 expect(referenceCommand(['--preflight-only','--manifest-sha256','a'.repeat(64)]).mode).toBe('--preflight-only');
 for(const a of [[],['--approved-appointment-storage-v2','--manifest-sha256','a'.repeat(64)],['--approved-isolated-f03-reference'],['--approved-isolated-f03-reference','--manifest-sha256','bad'],['--prepare-review','--force']])expect(()=>referenceCommand(a)).toThrow();
});
it('binds complete sources and denies tampering, missing files or claimed admission',()=>{
 const bytes=Buffer.from('synthetic source'),m={reviewOnly:true,productionAdmission:false,plan:'f03-reference-capture',expectedChecks:3,fixture:INBOUND_HOSTED_GATE_FIXTURE,sql114Included:false,extensionProvenanceRequired:true,files:{'source.sql':sha(bytes)}};
 expect(verifyReferenceManifest(m,['source.sql'],()=>bytes)).toBe(true);
 for(const bad of [{...m,productionAdmission:true},{...m,sql114Included:true},{...m,extensionProvenanceRequired:false},{...m,files:{}},{...m,expectedChecks:9},{...m,plan:'hosted-gates'},{...m,executionAuthorized:true}])expect(()=>verifyReferenceManifest(bad,['source.sql'],()=>bytes)).toThrow();
 expect(()=>verifyReferenceManifest(m,['source.sql'],()=>Buffer.from('changed'))).toThrow();
});
it('derives only the exact twelve pinned base inputs and keeps hosted SQL unchanged',()=>{
 const paths=Array.from({length:14},(_,i)=>i<12?`packages/db/src/migrations/${String(i+1).padStart(4,'0')}_base.sql`:`docs/migrations/${i===12?'112h':'113h'}-source.sql`);
 const sql=Buffer.from('SELECT 1;'),contract={sources:paths.map(path=>({path,sha256:sha(sql)})),statementCount:864,expectedCatalog:null,productionAdmission:false};
 const read=(p:string)=>p.includes('F03_EFFECTIVE_SOURCE_CONTRACT')?Buffer.from(JSON.stringify(contract)):sql;
 const names=paths.slice(0,12).map(p=>p.split('/').at(-1)!);expect(referenceInputs(read,names).base).toHaveLength(12);
 expect(()=>referenceInputs(read,[...names,'extra.sql'])).toThrow();
 expect(()=>referenceInputs(p=>p===paths[13]?Buffer.from('tampered'):read(p),names)).toThrow();
 contract.productionAdmission=true;expect(()=>referenceInputs(read,names)).toThrow();
});
it('executes the same verified base bytes even if a second read would return changed SQL',()=>{
 const paths=Array.from({length:14},(_,i)=>i<12?`packages/db/src/migrations/${String(i+1).padStart(4,'0')}_base.sql`:`docs/migrations/${i}-source.sql`),sql=Buffer.from('SELECT 1;');
 const contract={sources:paths.map(path=>({path,sha256:sha(sql)})),statementCount:864,expectedCatalog:null,productionAdmission:false};
 const counts=new Map<string,number>(),read=(p:string)=>{if(p.includes('F03_EFFECTIVE_SOURCE_CONTRACT'))return Buffer.from(JSON.stringify(contract));counts.set(p,(counts.get(p)??0)+1);return counts.get(p)===1?sql:Buffer.from('changed');};
 const result=referenceInputs(read,paths.slice(0,12).map(p=>p.split('/').at(-1)!));expect(result.base.every((m:any)=>m.sql==='SELECT 1;')).toBe(true);expect([...counts.values()].every(n=>n===1)).toBe(true);
});
it('pins transitive relative execution imports and rejects escapes',()=>{
 const sources=new Map([['scripts/root.mjs',"import './helper.mjs';"],['scripts/helper.mjs',"import './transport.mjs';"],['scripts/transport.mjs','export {};']]);
 expect(referenceExecutionClosure(p=>Buffer.from(sources.get(p)!),['scripts/root.mjs'])).toEqual(['scripts/helper.mjs','scripts/root.mjs','scripts/transport.mjs']);
 expect(()=>referenceExecutionClosure(()=>Buffer.from("import '../../outside.mjs';"),['scripts/root.mjs'])).toThrow();
});
it('retains only an allowlisted phase and SQLSTATE, never the error message or arbitrary code',()=>{
 expect(sanitizeReferenceFailure('catalog112',{code:'42601',message:'private value'})).toEqual({phase:'catalog112',sqlState:'42601',category:'postgresql_error'});
 expect(sanitizeReferenceFailure('install113',{code:'password-secret',message:'private value'})).toEqual({phase:'install113',sqlState:null,category:'validation_or_transport_error'});
 expect(()=>sanitizeReferenceFailure('private phase',{})).toThrow();
});
