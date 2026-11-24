import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {inboundRuntimeConfig,INBOUND_F03_REFERENCE_CACHE_PATH} from '../../../scripts/phone-inbound-runtime-config.mjs';
import {inspectInboundUnpublishedFixture} from '../../../scripts/phone-inbound-runtime-guard.mjs';
import {withFreshPhoneFixtureSession} from '../../../scripts/phone-fixture-session.mjs';
import {sanitizeReferenceFailure,F03_REFERENCE_MANIFEST} from '../../../scripts/phone-f03-reference.review.mjs';
import {deriveMigratorBootstrap,decodePg16ExtensionEvidence} from '../../../scripts/phone-schema-dependency-evidence.mjs';
import {fingerprint} from '../../../scripts/phone-inbound-expected-schema.mjs';

// OFF unless a fresh separately approved pinned runner provides this exact fixture proof.
const enabled=process.env.THAARA_PHONE113_VALIDATION_PLAN==='f03-reference-capture';
const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|COMSPEC|PATHEXT|DOCKER_CONFIG)$/i.test(k)));
const docker=(endpoint:string,args:string[])=>execFileSync('docker',['--host',endpoint,...args],{env:safeEnv,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,windowsHide:true}).trim();
const config=enabled?inboundRuntimeConfig(process.env,fs.readFileSync(INBOUND_F03_REFERENCE_CACHE_PATH+'/fixture.json'),(p:any)=>{inspectInboundUnpublishedFixture((a:string[])=>docker(p.dockerEndpoint,a),p);return true;},{validationPlan:'f03-reference-capture'}):null;
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const manifestPath=F03_REFERENCE_MANIFEST;
type Client={query:(sql:string,params?:unknown[])=>Promise<{rows:any[]}>};
let version:number,environmentHash:string,after112Hash:string;
function inputs(){
 const bytes=fs.readFileSync(manifestPath),manifest=JSON.parse(bytes.toString());
 expect(sha(bytes)).toBe(process.env.THAARA_PHONE_F03_MANIFEST_SHA256);
 expect(manifest.plan).toBe('f03-reference-capture');
 const sources=new Map<string,string>();
 for(const [path,hash]of Object.entries(manifest.files)){const value=fs.readFileSync(path);expect(sha(value)).toBe(hash);sources.set(path,value.toString('utf8'));}
 return {manifest,manifestSha256:sha(bytes),sources};
}
async function session(work:(c:Client)=>Promise<void>){
 if(!config)throw Error('F03_REFERENCE_FIXTURE_NOT_APPROVED');
 const {Pool}=createRequire(new URL('../../../packages/db/package.json',import.meta.url))('pg');
 await withFreshPhoneFixtureSession({verify:()=>{inputs();inspectInboundUnpublishedFixture((a:string[])=>docker(config.proof.dockerEndpoint,a),config.proof);},createPool:()=>new Pool({connectionString:config.admin,max:1,connectionTimeoutMillis:5000,statement_timeout:30000,query_timeout:45000})},work);
}
function save(name:string,value:unknown){
 const bytes=JSON.stringify(value);if(Buffer.byteLength(bytes)>4000000)throw Error('F03_REFERENCE_OUTPUT_BOUNDS');
 fs.writeFileSync(INBOUND_F03_REFERENCE_CACHE_PATH+'/'+name,bytes,{flag:'wx',mode:0o600});return sha(bytes);
}
async function phase<T>(name:string,work:()=>Promise<T>):Promise<T>{
 try{return await work();}catch(error){
  try{save('failure.json',sanitizeReferenceFailure(name,error));}catch{/* Preserve first failure; never overwrite evidence. */}
  throw Error('F03_REFERENCE_PHASE_FAILED');
 }
}
async function capture(c:Client,stage:'after112'|'after113',previousHash:string){
 const proof=inputs();
 await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  await c.query('SET LOCAL search_path=pg_catalog');
  const settings=(await c.query("SELECT current_database() AS database,current_user AS actor,current_setting('server_version_num')::integer AS version,current_setting('transaction_read_only') AS readonly,current_setting('transaction_isolation') AS isolation,current_setting('search_path') AS path")).rows[0];
  expect(settings).toEqual({database:'thaara_vps_pilot',actor:'postgres',version,readonly:'on',isolation:'repeatable read',path:'pg_catalog'});
  const sql=proof.sources.get('docs/integrations/phone/F03_PG16_CATALOG_QUERY.review.sql')!;
  const result=await c.query(sql,[stage]);expect(result.rows).toHaveLength(1);
  const observed=result.rows[0];expect(Object.keys(observed).sort()).toEqual(['projection','unsupported']);
  // Keep unsupported observations in a review-only receipt, then stop. Never approve them.
  const hash=save(stage+'.json',{format:'unapproved-isolated-pg16-reference-v1',productionAdmission:false,executionAuthorized:false,stage,manifestSha256:proof.manifestSha256,sourceContractSha256:proof.manifest.files['docs/integrations/phone/F03_EFFECTIVE_SOURCE_CONTRACT_2026-11-04.json'],postgresVersionNum:version,imageId:config!.proof.imageId,runId:config!.proof.runId,previousHash,...observed});
  expect(Array.isArray(observed.unsupported)).toBe(true);expect(observed.unsupported).toHaveLength(0);
  expect(observed.projection.server_version_num).toBe(version);expect(observed.projection.stage).toBe(stage);
  const extensionSql=proof.sources.get('docs/integrations/phone/F03_PG16_EXTENSION_PROVENANCE.review.sql')!;
  const extensionRows=await c.query(extensionSql,[stage]);expect(extensionRows.rows).toHaveLength(1);
  expect(Object.keys(extensionRows.rows[0])).toEqual(['extension_provenance']);
  const contract=JSON.parse(proof.sources.get('docs/integrations/phone/F03_EFFECTIVE_SOURCE_CONTRACT_2026-11-04.json')!);
  const binding={postgresVersionNum:version,imageId:config!.proof.imageId,stage,sourceSetSha256:fingerprint(contract.sources),querySha256:sha(extensionSql),projectionSha256:fingerprint(observed.projection)};
  const extension=decodePg16ExtensionEvidence({format:'pg16-extension-capture-v1',provenance:binding,metadata:extensionRows.rows[0].extension_provenance},binding,observed.projection);
  save(stage+'-extensions.json',{manifestSha256:proof.manifestSha256,catalogArtifactSha256:hash,...extension});
  await c.query('COMMIT');return hash;
 }catch(error){await c.query('ROLLBACK');throw error;}
}
describe.skipIf(!config)('F03 isolated reference capture; NOT schema admission',()=>{
 it('01 binds the exact fresh fixture, version, source set and pgcrypto environment',async()=>phase('environment',()=>session(async c=>{
  const evidence=inputs(),target=(await c.query("SELECT current_database() AS database,current_user AS actor,current_setting('server_version_num')::integer AS version,(SELECT extversion FROM pg_catalog.pg_extension WHERE extname='pgcrypto') AS pgcrypto")).rows[0];
  expect(target.database).toBe('thaara_vps_pilot');expect(target.actor).toBe('postgres');expect(target.version).toBeGreaterThanOrEqual(160000);expect(target.version).toBeLessThan(170000);expect(typeof target.pgcrypto).toBe('string');version=target.version;
  const bootstrap=deriveMigratorBootstrap(Buffer.from(evidence.sources.get('packages/db/src/migrator.ts')!),Buffer.from(evidence.sources.get('packages/db/dist/migrator.js')!));
  const bootstrapSha256=save('bootstrap-source.json',bootstrap);
  environmentHash=save('environment.json',{format:'unapproved-isolated-pg16-environment-v1',productionAdmission:false,executionAuthorized:false,manifestSha256:evidence.manifestSha256,imageId:config!.proof.imageId,runId:config!.proof.runId,bootstrapSha256,...target});
 })));
 it('02 applies unchanged112h only in the verified disposable target and captures read-only catalog',async()=>session(async c=>{
  expect(environmentHash).toMatch(/^[a-f0-9]{64}$/);const sql=inputs().sources.get('docs/migrations/112h-phone-inbound-events.hosted-review.sql')!;
  await phase('install112',async()=>{await c.query("SELECT set_config('thaara.step112_hosted_install_approved','owner-approved-inbound-hosted-install-v1',false)");await c.query(sql);});after112Hash=await phase('catalog112',()=>capture(c,'after112',environmentHash));
 }));
 it('03 applies unchanged113h and captures the final read-only catalog for independent review',async()=>session(async c=>{
  expect(after112Hash).toMatch(/^[a-f0-9]{64}$/);const sql=inputs().sources.get('docs/migrations/113h-phone-inbound-principals.hosted-review.sql')!;
  await phase('install113',async()=>{await c.query("SELECT set_config('thaara.step113_hosted_install_approved','owner-approved-inbound-hosted-install-v1',false)");await c.query(sql);});await phase('catalog113',()=>capture(c,'after113',after112Hash));
 }));
});
