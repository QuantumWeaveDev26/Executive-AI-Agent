// LOCAL REVIEW TEXT ONLY. No database/SSH/provider/secret operations or execution mode.
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {INBOUND_SQL_SOURCES} from './phone-inbound-runtime-sql.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const deny=()=>{throw Error('INBOUND_HOSTED_INSTALL_REVIEW_DENIED');};
export const HOSTED_INBOUND_SQL=Object.freeze({112:'docs/migrations/112h-phone-inbound-events.hosted-review.sql',113:'docs/migrations/113h-phone-inbound-principals.hosted-review.sql'});
export function deriveHostedInboundSql(step,source){
 const entry=INBOUND_SQL_SOURCES[step];if(!entry||typeof source!=='string'||hash(source)!==entry.sha256)deny();
 const start=source.indexOf(' IF current_setting('),end=source.indexOf(' IF to_reg');if(start<0||end<=start)deny();
 const gate=` IF current_setting('thaara.step${step}_hosted_install_approved',true) IS DISTINCT FROM 'owner-approved-inbound-hosted-install-v1'
  OR current_database() IS DISTINCT FROM 'thaara_vps_pilot'
  OR current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999
  OR session_user IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM session_user THEN
  RAISE EXCEPTION 'Inbound hosted install requires separate owner approval and exact pilot target';
 END IF;
 IF EXISTS(SELECT 1 FROM (VALUES('public.workspaces'),('public.users'),('public.memberships'),('public.sessions'),('public.audit_events')) AS required(name)
    WHERE to_regclass(required.name) IS NULL)
  OR to_regprocedure('public.current_authenticated_scope()') IS NULL
  OR to_regprocedure('public.resolve_session_scope(text)') IS NULL
  OR (SELECT count(*) FROM pg_roles WHERE rolname IN('thaara_app','thaara_worker'))<>2
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('thaara_app','thaara_worker') AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication))
  OR EXISTS(SELECT 1 FROM pg_class WHERE oid IN(to_regclass('public.memberships'),to_regclass('public.sessions'),to_regclass('public.audit_events'))
    AND (NOT relrowsecurity OR NOT relforcerowsecurity)) THEN
  RAISE EXCEPTION 'Inbound hosted install base security preconditions failed';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_policy WHERE polname LIKE 'phone_principal_%') THEN
  RAISE EXCEPTION 'Inbound hosted install refuses policy name collision';
 END IF;
${step===112?` IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('thaara_phone_ingest','thaara_phone_guard'))
  OR to_regclass('public.phone_inbound_principals') IS NOT NULL
  OR to_regprocedure('public.phone_inbound_resolve_grant(text,text,text)') IS NOT NULL
  OR to_regprocedure('public.phone_inbound_scope_matches(uuid,uuid)') IS NOT NULL
  OR to_regprocedure('public.phone_inbound_append_event(jsonb)') IS NOT NULL THEN
  RAISE EXCEPTION 'Inbound hosted install refuses existing service identities or objects';
 END IF;
`:''}`;
 const prefix=source.slice(0,start).replace("SET LOCAL statement_timeout='30s';","SET LOCAL statement_timeout='30s';\nSET LOCAL search_path=pg_catalog;");
 return '-- TARGET-SPECIFIC REVIEW ONLY. NOT AUTHORIZED. No runner, credential provisioning or runtime activation.\n'+prefix+gate+source.slice(end);
}
export function makeHostedInboundReview(receipt,receiptSha){
 const inv=receipt?.inventory;
 if(!/^[a-f0-9]{64}$/.test(receiptSha??'')||receipt?.mode!=='readonly_inbound_inventory'||!inv
  ||['sourceHealthy','imageMatched','catalogReadOnly','hostRecordMatched','hostHandshakeVerified','cleanupVerified'].some(k=>receipt[k]!==true)
  ||['databaseMatched','postgres16','baseSchemaPresent'].some(k=>inv[k]!==true)
  ||['journalPresent','principalTablePresent','ingestRolePresent','guardRolePresent','appendFunctionPresent','resolveGrantFunctionPresent','scopeMatchFunctionPresent'].some(k=>inv[k]!==false))deny();
 return {schemaVersion:1,reviewOnly:true,installationAllowed:false,runtimeEnabled:false,productionReady:false,
  targetDatabase:'thaara_vps_pilot',postgresMajor:16,inventoryReceiptSha256:receiptSha,inventoryMeaning:'historical_preparation_evidence_only_revalidate_before_any_install',
  ownerIdentity:null,principalIdentity:null,backupVerification:null,hostingExceptionApproval:null,secretReferences:null,
  sequence:['112h','113h'],partialInstallRecovery:'keep_reporting_disabled_preserve_data_forward_review_only',
  pending:['isolated_validation_of_new_hosted_sql_gates','fresh_backup_and_isolated_restore_approval','hosting_and_secret_storage_compliance_or_explicit_pilot_exception','authenticated_thaara_owner_binding','base_ownership_role_membership_and_privilege_review','live_provider_auth_and_metadata_review','shared_ingress_and_runtime_admission_review','scoped_install_identity_secret_deployment_approvals','controlled_end_to_end_acceptance']};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3||!['--prepare-review','--check-review'].includes(process.argv[2]))deny();
  const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
  const inside=p=>{const r=relative(root,realpathSync(p));if(isAbsolute(r)||r==='..'||r.startsWith('../')||r.startsWith('..\\'))deny();return p;};
  const read=p=>readFileSync(inside(resolve(root,p)));
  const receipt=read('node_modules/.cache/phone-inbound-host-inventory-v1.result.json');
  const artifacts=Object.entries(HOSTED_INBOUND_SQL).map(([step,path])=>({path,text:deriveHostedInboundSql(Number(step),read(INBOUND_SQL_SOURCES[step].path).toString('utf8'))}));
  artifacts.push({path:'docs/integrations/phone/INBOUND_HOSTED_INSTALL_REVIEW_2026-11-04.json',text:JSON.stringify({...makeHostedInboundReview(JSON.parse(receipt),hash(receipt)),sqlSha256:Object.fromEntries(artifacts.map(a=>[a.path,hash(a.text)]))},null,2)+'\n'});
  for(const a of artifacts)inside(dirname(resolve(root,a.path)));
  if(process.argv[2]==='--prepare-review')for(const a of artifacts)writeFileSync(resolve(root,a.path),a.text,{flag:'wx'});
  for(const a of artifacts)if(read(a.path).toString('utf8')!==a.text)deny();
  console.log(JSON.stringify({status:'hosted_install_review_verified',sqlCandidates:2,installationAllowed:false,runtimeEnabled:false,sqlExecuted:false}));
 }catch{console.error('INBOUND_HOSTED_INSTALL_REVIEW_DENIED');process.exitCode=1;}
}
