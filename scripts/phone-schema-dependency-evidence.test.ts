import fs from 'node:fs';
import {it,expect} from 'vitest';
import {fingerprint} from './phone-inbound-expected-schema.mjs';
import {deriveMigratorBootstrap,decodePg16ExtensionEvidence} from './phone-schema-dependency-evidence.mjs';
it('derives tracking-table declaration from the pinned runner source, not a captured catalog',()=>{
 const bytes=fs.readFileSync('packages/db/src/migrator.ts'),compiled=fs.readFileSync('packages/db/dist/migrator.js'),result=deriveMigratorBootstrap(bytes,compiled);
 expect(result.productionAdmission).toBe(false);expect(result.verified).toBe(false);
 expect(result.table.name).toBe('schema_migrations');expect(result.table.qualification).toBe('search-path-dependent');
 expect(result.table.columns.map(c=>c.name)).toEqual(['version','name','checksum','applied_at']);
 expect(result.table.columns[3].default).toBe('NOW()');expect(result.preconditions).toHaveLength(3);
 expect(()=>deriveMigratorBootstrap(bytes)).toThrow();
 expect(()=>deriveMigratorBootstrap(bytes,Buffer.concat([compiled,Buffer.from('\n// changed')]))).toThrow();
 expect(()=>deriveMigratorBootstrap(Buffer.concat([bytes,Buffer.from('\n// changed')]))).toThrow();
 expect(()=>deriveMigratorBootstrap(Buffer.from(bytes.toString().replace('checksum TEXT','checksum UUID')))).toThrow();
});
function fixture(){
 // Exact unapproved declaration text retained from the isolated PG16.15 reference capture.
 const routine={signature:'public.digest(text, text)',language:'c',definition:"CREATE OR REPLACE FUNCTION public.digest(text, text)\n RETURNS bytea\n LANGUAGE c\n IMMUTABLE PARALLEL SAFE STRICT\nAS '$libdir/pgcrypto', $function$pg_digest$function$\n"};
 const catalog={server_version_num:160015,stage:'after113',routines:[routine]},binding={postgresVersionNum:160015,imageId:'sha256:'+'1'.repeat(64),stage:'after113',sourceSetSha256:'2'.repeat(64),querySha256:'3'.repeat(64),projectionSha256:fingerprint(catalog)};
 const metadata={format:'pg16-extension-provenance-v1',serverVersionNum:160015,stage:'after113',extensions:[{name:'pgcrypto',version:'1.3',schema:'public',owner:'postgres',relocatable:true,configTables:[],configConditions:[]}],routines:[{signature:routine.signature,definition:routine.definition,language:'c',library:'$libdir/pgcrypto',symbol:'pg_digest',extensionName:'pgcrypto',membershipType:'e',objectSubId:0}]};
 const capture={format:'pg16-extension-capture-v1',provenance:structuredClone(binding),metadata};return {capture,binding,catalog};
}
it('binds explicit extension membership to exact declarations and reference provenance without approval',()=>{
 const f=fixture(),r=decodePg16ExtensionEvidence(f.capture,f.binding,f.catalog);
 expect(r.status).toBe('unapproved-extension-observation');expect(r.productionAdmission).toBe(false);expect(r.executionAuthorized).toBe(false);expect(r.metadata.extensions[0].version).toBe('1.3');
});
it.each(['missing-membership','wrong-membership','wrong-extension','missing-routine','extra-routine','definition','library','symbol','version-binding','image-binding','catalog-binding','catalog-stage','catalog-version','unknown-field','duplicate-extension','extension-version','config-tables'])('rejects incomplete or tampered extension observations: %s',mode=>{
 const f=fixture(),c:any=f.capture,m=c.metadata,r=m.routines[0];
 if(mode==='missing-membership')r.extensionName=null;if(mode==='wrong-membership')r.membershipType='n';if(mode==='wrong-extension')r.extensionName='other';
 if(mode==='missing-routine')m.routines=[];if(mode==='extra-routine')m.routines.push({...r,signature:'public.extra()'});
 if(mode==='definition')r.definition+=' changed';if(mode==='library')r.library='$libdir/other';if(mode==='symbol')r.symbol='';
 if(mode==='version-binding')m.serverVersionNum=160014;if(mode==='image-binding')c.provenance.imageId='sha256:'+'9'.repeat(64);
 if(mode==='catalog-binding')f.catalog.routines[0].definition+=' changed';if(mode==='unknown-field')m.trusted=true;
 if(mode==='catalog-stage'||mode==='catalog-version'){
  if(mode==='catalog-stage')f.catalog.stage='after112';else f.catalog.server_version_num=160014;
  f.binding.projectionSha256=fingerprint(f.catalog);c.provenance=structuredClone(f.binding);
 }
 if(mode==='duplicate-extension')m.extensions.push({...m.extensions[0]});if(mode==='extension-version')m.extensions[0].version='';
 if(mode==='config-tables')m.extensions[0].configTables=['public.hidden'];
 expect(()=>decodePg16ExtensionEvidence(c,f.binding,f.catalog)).toThrow();
});
