// DISCONNECTED LOCAL ADAPTER. No pg client, connection string, environment credentials or live port.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {canonical} from './phone-inbound-expected-schema.mjs';
import {extractPg16Projection} from './phone-schema-pg16-extractor.mjs';
const fail=()=>{throw Error('CATALOG_READER_DENIED');};
const keys=(v,k)=>v&&Object.getPrototypeOf(v)===Object.prototype&&canonical(Object.keys(v).sort())===canonical([...k].sort());
const probe="SELECT pg_catalog.current_setting('server_version_num')::integer AS server_version_num, pg_catalog.current_setting('transaction_read_only') AS transaction_read_only, pg_catalog.current_setting('transaction_isolation') AS transaction_isolation, pg_catalog.current_setting('standard_conforming_strings') AS standard_conforming_strings, pg_catalog.current_setting('search_path') AS search_path";
export function catalogQueryArtifact(){
 if(process.env.NODE_ENV!=='test')throw Error('Catalog adapter is test-only');
 const bytes=fs.readFileSync(new URL('../docs/integrations/phone/F03_PG16_CATALOG_QUERY.review.sql',import.meta.url));
 return {sql:bytes.toString('utf8'),sha256:createHash('sha256').update(bytes).digest('hex')};
}
export function createDisconnectedPg16Reader({binding,querySha256,snapshotPort}){
 if(process.env.NODE_ENV!=='test')throw Error('Catalog adapter is test-only');
 const artifact=catalogQueryArtifact();if(artifact.sha256!==querySha256||snapshotPort?.mode!=='synthetic-only'||typeof snapshotPort.withReadOnlySnapshot!=='function'||!Number.isSafeInteger(binding?.postgresVersionNum)||binding.postgresVersionNum<160000||binding.postgresVersionNum>169999||!['after112','after113'].includes(binding.stage))fail();
 const pinned=structuredClone(binding);
 const one=r=>{if(!keys(r,['rows'])||!Array.isArray(r.rows)||r.rows.length!==1)fail();return r.rows[0];};
 const check=r=>{if(!keys(r,['server_version_num','transaction_read_only','transaction_isolation','standard_conforming_strings','search_path'])||r.server_version_num!==pinned.postgresVersionNum||r.transaction_read_only!=='on'||r.transaction_isolation!=='repeatable read'||r.standard_conforming_strings!=='on'||r.search_path!=='pg_catalog')fail();};
 return async()=>{
  if(process.env.NODE_ENV!=='test')throw Error('Catalog adapter is test-only');
  let produced=null,calls=0;
  try{const answer=await snapshotPort.withReadOnlySnapshot(async tx=>{
   if(++calls!==1)fail();
   if(!tx||typeof tx.query!=='function')fail();check(one(await tx.query(probe,[])));
   const observed=one(await tx.query(artifact.sql,[pinned.stage]));if(!keys(observed,['projection','unsupported']))fail();
   const capture={format:'pg16-projection-v1',provenance:structuredClone(pinned),...observed};
   const catalog=extractPg16Projection(capture,pinned);check(one(await tx.query(probe,[])));
   produced={status:'local_projection_decoded',productionAdmission:false,executionAuthorized:false,capture,catalog};return produced;
  });if(produced===null||answer!==produced)fail();return produced;}catch{return {status:'denied',productionAdmission:false,executionAuthorized:false};}
 };
}
