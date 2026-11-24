// LOCAL evidence representation only. No database, credential, approval or execution port.
import {createHash} from 'node:crypto';
import {canonical,fingerprint} from './phone-inbound-expected-schema.mjs';
const deny=()=>{throw Error('PHONE_SCHEMA_DEPENDENCY_DENIED');};
const local=()=>{if(process.env.NODE_ENV!=='test')deny();};
const keys=(v,k)=>v&&Object.getPrototypeOf(v)===Object.prototype&&canonical(Object.keys(v).sort())===canonical([...k].sort());
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const name=v=>typeof v==='string'&&/^[a-z_][a-z0-9_]*$/.test(v);
const sha=b=>createHash('sha256').update(b).digest('hex');
// Source identity pins, not reviewer authorization. Never replace from observed catalog values.
const bootstrapSourceSha='5c1341b60a7c4dae2fa47036c829c03630b0309d9037eb3a2f20bcae44e33a98';
const bootstrapSqlSha='60469a37642d26072bfbb9c082742ec84aead018cbf8765b56f500814896b95d';
const bootstrapCompiledSha='8360a16e3e634c00df9def1109ce3612f1c3bebc77b66477542c3d4fe757a9dd';
export function deriveMigratorBootstrap(bytes,compiledBytes){
 local();if(!Buffer.isBuffer(bytes)||sha(bytes)!==bootstrapSourceSha||!Buffer.isBuffer(compiledBytes)||sha(compiledBytes)!==bootstrapCompiledSha)deny();
 const match=bytes.toString('utf8').match(/CREATE TABLE IF NOT EXISTS schema_migrations \([\s\S]*?\);/);
 const compiled=compiledBytes.toString('utf8').match(/CREATE TABLE IF NOT EXISTS schema_migrations \([\s\S]*?\);/);
 if(!match||!compiled||sha(match[0])!==bootstrapSqlSha||compiled[0]!==match[0])deny();
 return {format:'phone-migrator-bootstrap-source-v1',productionAdmission:false,verified:false,
  source:{path:'packages/db/src/migrator.ts',sha256:bootstrapSourceSha,sqlSha256:bootstrapSqlSha},
  executedSource:{path:'packages/db/dist/migrator.js',sha256:bootstrapCompiledSha,sqlSha256:bootstrapSqlSha},
  sql:match[0],table:{name:'schema_migrations',qualification:'search-path-dependent',conditionalExistence:'absence-or-independently-verified-identical-definition',columns:[
   {name:'version',type:'TEXT',primaryKey:true,default:null},{name:'name',type:'TEXT',notNull:true,default:null},
   {name:'checksum',type:'TEXT',notNull:true,default:null},{name:'applied_at',type:'TIMESTAMPTZ',notNull:true,default:'NOW()'}
  ]},preconditions:['Verify migration search_path resolves the unqualified table to public',
   'Verify absence before creation or independently approved existing definition',
   'Verify migration actor, initial defaults and all subsequent ordered ACL effects']};
}
/** Decode explicit metadata that must be collected with the catalog in ONE read-only snapshot.
 * Exact comparisons here establish consistency only; they do not approve the observed extension.
 */
export function decodePg16ExtensionEvidence(capture,binding,catalog){
 local();
 if(!keys(binding,['postgresVersionNum','imageId','stage','sourceSetSha256','querySha256','projectionSha256'])
  ||!Number.isSafeInteger(binding.postgresVersionNum)||binding.postgresVersionNum<160000||binding.postgresVersionNum>169999
  ||!/^sha256:[a-f0-9]{64}$/.test(binding.imageId??'')||!['after112','after113'].includes(binding.stage)
  ||!digest(binding.sourceSetSha256)||!digest(binding.querySha256)||!digest(binding.projectionSha256)
  ||fingerprint(catalog)!==binding.projectionSha256||!Array.isArray(catalog.routines)
  ||catalog.server_version_num!==binding.postgresVersionNum||catalog.stage!==binding.stage)deny();
 if(!keys(capture,['format','provenance','metadata'])||capture.format!=='pg16-extension-capture-v1'||canonical(capture.provenance)!==canonical(binding))deny();
 const m=capture.metadata;
 if(!keys(m,['format','serverVersionNum','stage','extensions','routines'])||m.format!=='pg16-extension-provenance-v1'
  ||m.serverVersionNum!==binding.postgresVersionNum||m.stage!==binding.stage||!Array.isArray(m.extensions)||m.extensions.length!==1
  ||!Array.isArray(m.routines)||m.routines.length>4096)deny();
 const e=m.extensions[0];
 if(!keys(e,['name','version','schema','owner','relocatable','configTables','configConditions'])||e.name!=='pgcrypto'
  ||typeof e.version!=='string'||! /^[A-Za-z0-9_.-]{1,64}$/.test(e.version)||!['public','platform'].includes(e.schema)||!name(e.owner)
  ||typeof e.relocatable!=='boolean'||!Array.isArray(e.configTables)||e.configTables.length||!Array.isArray(e.configConditions)||e.configConditions.length)deny();
 const native=catalog.routines.filter(r=>r.language==='c');
 if(native.length!==m.routines.length||new Set(native.map(r=>r.signature)).size!==native.length||new Set(m.routines.map(r=>r.signature)).size!==m.routines.length)deny();
 for(const r of m.routines){
  if(!keys(r,['signature','definition','language','library','symbol','extensionName','membershipType','objectSubId'])
   ||r.language!=='c'||r.library!=='$libdir/pgcrypto'||typeof r.symbol!=='string'||! /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(r.symbol)
   ||r.extensionName!==e.name||r.membershipType!=='e'||r.objectSubId!==0||typeof r.signature!=='string'||r.signature.length>1024
   ||typeof r.definition!=='string'||r.definition.length>131072)deny();
  const f=native.find(f=>f.signature===r.signature);
  if(!f||f.definition!==r.definition||!r.definition.includes("'"+r.library+"'")
   ||!r.definition.includes("'"+r.symbol+"'")&&!r.definition.includes('$function$'+r.symbol+'$function$'))deny();
 }
 return {status:'unapproved-extension-observation',productionAdmission:false,executionAuthorized:false,
  provenance:structuredClone(binding),metadata:structuredClone(m),evidenceSha256:fingerprint(capture)};
}
