import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const INSTALL_APPROVAL = 'owner-approved-step115-hosted-install-r3-acl';
const approvedSqlHash = 'a4448d05d9323ae510e448acb6d0f09a08c24e1511f62071a63b00c7e742872c';
const sources = [
  ['112-phone-inbound-events.review.sql', 'CREATE TABLE public.phone_inbound_call_events('],
  ['113-phone-inbound-principals.review.sql', 'CREATE ROLE thaara_phone_ingest '],
  ['114-phone-structured-report.review.sql', 'CREATE FUNCTION public.complete_phone_provider_report('],
  ['115-phone-callback-notification.review.sql', 'CREATE TABLE public.phone_callback_requests ('],
  ['115g-phone-callback-grants.review.sql', 'CREATE TABLE public.phone_callback_notification_grants ('],
  ['115w-phone-callback-worker.review.sql', 'CREATE ROLE thaara_phone_notify '],
  ['115i-phone-callback-inbound-save.review.sql', 'GRANT SELECT,INSERT ON public.phone_callback_requests TO thaara_phone_guard;'],
  ['115o-phone-callback-outbound.review.sql', 'CREATE TABLE public.phone_callback_dispatch_numbers ('],
];
const newTables = ['phone_inbound_call_events', 'phone_inbound_principals', 'phone_callback_requests',
  'phone_callback_notification_grants', 'phone_callback_notification_grant_uses', 'phone_callback_worker_principals', 'phone_callback_dispatch_numbers'];
const newRoles = ['thaara_phone_ingest', 'thaara_phone_guard', 'thaara_phone_notify', 'thaara_phone_notify_guard'];
const newFunctions = ['phone_inbound_resolve_grant', 'phone_inbound_scope_matches', 'phone_inbound_append_event',
  'complete_phone_provider_report', 'phone_callback_validate_grant', 'phone_callback_record_grant_use',
  'phone_callback_worker_operation', 'phone_callback_inbound_save', 'phone_callback_outbound_context', 'phone_callback_outbound_save'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const literal = value => {
  if (typeof value !== 'string' || value.length > 512) throw Error('Invalid metadata literal.');
  return "'" + value.replaceAll("'", "''") + "'";
};
const sqlList = values => values.map(literal).join(',');

export function buildStep115HostedInstall(receipt, root) {
  const database = receipt?.schema?.database?.[0];
  if (receipt?.status !== 'verified' || receipt.sourceHealthy !== true || receipt.changesMade !== false || receipt.providerRequests !== 0 ||
      receipt.sqlSha256 !== approvedSqlHash || !/^sha256:[a-f0-9]{64}$/.test(receipt.imageId) ||
      receipt.schema.database.length !== 1 || database.database_name !== 'thaara_vps_pilot' || !/^16\d{4}$/.test(database.server_version)) {
    throw Error('Verified PostgreSQL 16 production metadata is required.');
  }
  const roles = receipt.schema.roles;
  if (roles.length !== 3 || !['thaara_app', 'thaara_worker', 'thaara_phone_callback_guard'].every(name => roles.some(role => role.rolname === name)) ||
      roles.some(role => ['rolsuper', 'rolcreaterole', 'rolcreatedb', 'rolreplication', 'rolbypassrls'].some(flag => role[flag] !== 'f'))) {
    throw Error('Unexpected existing production roles.');
  }
  const callbackGuard = roles.find(role => role.rolname === 'thaara_phone_callback_guard');
  if (callbackGuard.rolcanlogin !== 'f' || callbackGuard.rolinherit !== 'f') throw Error('Callback guard identity is not restricted.');
  const columns = receipt.schema.columns;
  if (columns.length !== 46 || !columns.every(column => ['phone_contacts', 'phone_calls', 'phone_call_events'].includes(column.relname) &&
      column.relrowsecurity === 't' && column.relforcerowsecurity === 't' && column.owner_role === 'postgres' && ['t', 'f'].includes(column.attnotnull))) {
    throw Error('Unexpected Phone table baseline.');
  }
  const functions = receipt.schema.functions;
  const signatures = ['phone_provider_binding(uuid)', 'apply_phone_provider_event(uuid,text,text,text,text,text)'];
  if (functions.length !== 2 || !signatures.every(signature => functions.some(fn => fn.signature === signature)) ||
      functions.some(fn => fn.security_definer !== 't' || fn.owner_role !== 'thaara_phone_callback_guard' || !/^[a-f0-9]{64}$/.test(fn.definition_sha256))) {
    throw Error('Unexpected callback function baseline.');
  }
  const inputs = [];
  const bodies = sources.map(([name, marker]) => {
    const relative = 'docs/migrations/' + name;
    const bytes = readFileSync(path.join(root, relative));
    const source = bytes.toString('utf8').replaceAll('\r\n', '\n');
    const start = source.indexOf(marker);
    if (start < 0 || start !== source.lastIndexOf(marker) || !source.trimEnd().endsWith('COMMIT;')) throw Error('Review SQL boundary changed: ' + name);
    const hash = digest(bytes);
    inputs.push({ path: relative, sha256: hash });
    return '-- Input ' + relative + '\n-- SHA256 ' + hash + '\n' + source.slice(start).trimEnd().slice(0, -'COMMIT;'.length).trimEnd();
  });
  const functionChecks = functions.map(fn => ` IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure(${literal('public.' + fn.signature)})
  AND p.prosecdef AND pg_get_userbyid(p.proowner)='thaara_phone_callback_guard'
  AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')=${literal(fn.definition_sha256)}) THEN
  RAISE EXCEPTION 'Installed callback function drift detected'; END IF;`).join('\n');
  const columnChecks = columns.map(column => ` IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname=${literal(column.relname)}
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname=${literal(column.attname)}
  AND format_type(a.atttypid,a.atttypmod)=${literal(column.column_type)} AND a.attnotnull=${column.attnotnull === 't'}) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;`).join('\n');
  const guard = `-- TARGET-SPECIFIC REVIEW ONLY. No execution or credential provisioning is authorized by this file.
-- Observed API image ${receipt.imageId}. The deployment runner must independently recheck it.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog;
DO $step115_guard$ BEGIN
 IF current_setting('thaara.step115_hosted_install_approved',true) IS DISTINCT FROM ${literal(INSTALL_APPROVAL)}
  OR current_database() IS DISTINCT FROM ${literal(database.database_name)} OR current_setting('server_version_num') IS DISTINCT FROM ${literal(database.server_version)}
  OR session_user IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM session_user THEN
  RAISE EXCEPTION 'Step 115 requires exact target and separate installation approval'; END IF;
 IF to_regprocedure('public.current_authenticated_scope()') IS NULL OR to_regprocedure('public.resolve_session_scope(text)') IS NULL
  OR EXISTS(SELECT 1 FROM (VALUES('public.workspaces'),('public.users'),('public.memberships'),('public.sessions'),('public.audit_events')) required(name)
    WHERE to_regclass(required.name) IS NULL)
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid IN(to_regclass('public.memberships'),to_regclass('public.sessions'),to_regclass('public.audit_events'))
    AND (NOT relrowsecurity OR NOT relforcerowsecurity)) THEN RAISE EXCEPTION 'Base authorization boundaries are unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN(${sqlList(newTables)}))
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN(${sqlList(newRoles)}))
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN(${sqlList(newFunctions)})) THEN
  RAISE EXCEPTION 'Step 115 refuses existing candidate objects or identities'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN('thaara_app','thaara_worker','thaara_phone_callback_guard')
  AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication))
  OR (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN('thaara_app','thaara_worker','thaara_phone_callback_guard'))<>3
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='thaara_phone_callback_guard' AND (r.rolcanlogin OR r.rolinherit))
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.rolname='thaara_phone_callback_guard'
    WHERE m.roleid=r.oid OR m.member=r.oid)
  OR has_schema_privilege('thaara_app','public','CREATE') THEN
  RAISE EXCEPTION 'Step 115 base role safety check failed'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN('phone_contacts','phone_calls','phone_call_events')
  AND a.attnum>0 AND NOT a.attisdropped)<>46 THEN RAISE EXCEPTION 'Phone column inventory changed'; END IF;
${functionChecks}
${columnChecks}
END $step115_guard$;
`;
  const acl = `
-- Normalize the journal dependency and verify effective privileges, including inherited/default grants.
REVOKE ALL ON public.phone_inbound_call_events FROM thaara_app,thaara_worker;
GRANT SELECT,INSERT ON public.phone_inbound_call_events TO thaara_app;
DO $step115_acl$ DECLARE access record;column_row record;table_oid oid;can_read boolean;can_insert boolean;can_update boolean;
BEGIN
 FOR access IN WITH roles(name) AS(VALUES('thaara_app'),('thaara_worker'),('thaara_phone_ingest'),('thaara_phone_notify')),
 expected(name,read_allowed,insert_allowed,updates) AS(VALUES
  ('phone_inbound_call_events',true,true,ARRAY[]::text[]),
  ('phone_inbound_principals',false,false,ARRAY[]::text[]),
  ('phone_callback_requests',true,true,ARRAY['notification_status','notification_attempt_id','provider_message_id','attempts','next_attempt_at','sending_started_at']),
  ('phone_callback_notification_grants',true,true,ARRAY['approval_id','approved_params','created_at','expires_at','revoked_at']),
  ('phone_callback_notification_grant_uses',true,true,ARRAY['revoked_at']),
  ('phone_callback_worker_principals',false,false,ARRAY[]::text[]),
  ('phone_callback_dispatch_numbers',true,true,ARRAY[]::text[]))
 SELECT roles.name AS role_name,expected.* FROM roles CROSS JOIN expected LOOP
  table_oid:=to_regclass('public.'||access.name);
  can_read:=access.role_name='thaara_app' AND access.read_allowed;
  can_insert:=access.role_name='thaara_app' AND access.insert_allowed;
  IF table_oid IS NULL OR has_table_privilege(access.role_name,table_oid,'SELECT') IS DISTINCT FROM can_read
   OR has_table_privilege(access.role_name,table_oid,'INSERT') IS DISTINCT FROM can_insert
   OR has_table_privilege(access.role_name,table_oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
   RAISE EXCEPTION 'Step 115 table privilege admission failed';
  END IF;
  FOR column_row IN SELECT attnum,attname FROM pg_catalog.pg_attribute WHERE attrelid=table_oid AND attnum>0 AND NOT attisdropped LOOP
   can_update:=access.role_name='thaara_app' AND column_row.attname=ANY(access.updates);
   IF has_column_privilege(access.role_name,table_oid,column_row.attnum,'SELECT') IS DISTINCT FROM can_read
    OR has_column_privilege(access.role_name,table_oid,column_row.attnum,'INSERT') IS DISTINCT FROM can_insert
    OR has_column_privilege(access.role_name,table_oid,column_row.attnum,'UPDATE') IS DISTINCT FROM can_update
    OR has_column_privilege(access.role_name,table_oid,column_row.attnum,'REFERENCES') THEN
    RAISE EXCEPTION 'Step 115 column privilege admission failed';
   END IF;
  END LOOP;
 END LOOP;
END $step115_acl$;
`;
  const body = bodies.join('\n\n') + '\n' + acl;
  return { sql: guard + '\n' + body + '\nCOMMIT;\n', body, inputs,
    target: { database: database.database_name, serverVersion: database.server_version, observedApiImage: receipt.imageId,
      newTables, newRoles, newFunctions, approvalSetting: 'thaara.step115_hosted_install_approved', approvalValue: INSTALL_APPROVAL } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const receiptPath = path.join(root, 'node_modules/.cache/phone-step115-schema-20261111.result.json');
  const receiptBytes = readFileSync(receiptPath);
  const result = buildStep115HostedInstall(JSON.parse(receiptBytes.toString('utf8')), root);
  const sqlPath = path.join(root, 'docs/migrations/115-step115-hosted-install-20261111-r2.review.sql');
  writeFileSync(sqlPath, result.sql, { flag: 'wx' });
  const manifest = { reviewOnly: true, executionAuthorized: false, activationEnabled: false,
    target: result.target, schemaReceiptSha256: digest(receiptBytes), observedAt: statSync(receiptPath).mtime.toISOString(),
    sql: { path: 'docs/migrations/115-step115-hosted-install-20261111-r2.review.sql', sha256: digest(result.sql) }, inputs: result.inputs,
    rollback: 'One transaction rolls back on installation failure. Retain additive schema and records during any later application rollback.',
    provisionsLoginOrSecrets: false };
  const manifestPath = path.join(root, 'docs/integrations/phone/PHONE_STEP115_INSTALL_20261111_R2.review.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ sql: manifest.sql, manifest: 'docs/integrations/phone/PHONE_STEP115_INSTALL_20261111_R2.review.json',
    manifestSha256: digest(readFileSync(manifestPath)), observedApiImage: result.target.observedApiImage }));
}
