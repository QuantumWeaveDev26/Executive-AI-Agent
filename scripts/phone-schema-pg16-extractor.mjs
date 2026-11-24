// LOCAL projection decoder only; no database connection/query execution or semantic SQL rewriting.
import {canonical} from './phone-inbound-expected-schema.mjs';
import {normalizePg16} from './phone-schema-pg16.mjs';
const fail=()=>{throw Error('PG16_EXTRACTION_DENIED');};
const keys=(v,k)=>v&&Object.getPrototypeOf(v)===Object.prototype&&canonical(Object.keys(v).sort())===canonical([...k].sort());
export function extractPg16Projection(capture,binding){
 if(process.env.NODE_ENV!=='test')throw Error('PG16 projection extractor is test-only');
 if(!keys(capture,['format','provenance','unsupported','projection'])||capture.format!=='pg16-projection-v1'||!Array.isArray(capture.unsupported)||capture.unsupported.length||canonical(capture.provenance)!==canonical(binding))fail();
 const p=capture.projection;
 if(!keys(p,['server_version_num','stage','relations','routines','principals','namespaces','role_memberships','default_acls','dependency_contracts'])||p.server_version_num!==binding.postgresVersionNum||p.stage!==binding.stage)fail();
 try{return normalizePg16({format:'pg16-security-v1',serverVersionNum:p.server_version_num,stage:p.stage,tables:p.relations,functions:p.routines,roles:p.principals,schemas:p.namespaces,memberships:p.role_memberships,defaultPrivileges:p.default_acls,dependencies:p.dependency_contracts});}catch{fail();}
}
