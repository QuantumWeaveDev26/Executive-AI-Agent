-- Prepared read-only metadata check. Requires separate owner authorization before production use.
-- No application rows, credentials, environment values or SQL definitions are returned.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='5s';
SET LOCAL lock_timeout='1s';

SELECT current_database() AS database_name,current_setting('server_version_num') AS server_version;

SELECT r.rolname,r.rolsuper,r.rolinherit,r.rolcreaterole,r.rolcreatedb,r.rolcanlogin,r.rolreplication,r.rolbypassrls
 FROM pg_catalog.pg_roles r WHERE r.rolname IN('thaara_app','thaara_worker','thaara_phone_ingest','thaara_phone_guard',
  'thaara_phone_callback_guard','thaara_phone_notify','thaara_phone_notify_guard') ORDER BY r.rolname;

SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_catalog.pg_get_userbyid(c.relowner) AS owner_role,
 a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod) AS column_type,a.attnotnull
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 WHERE n.nspname='public' AND c.relname IN('phone_contacts','phone_calls','phone_call_events','phone_inbound_call_events',
  'phone_inbound_principals','phone_callback_requests','phone_callback_notification_grants','phone_callback_notification_grant_uses',
  'phone_callback_worker_principals','phone_callback_dispatch_numbers') ORDER BY c.relname,a.attnum LIMIT 500;

SELECT p.oid::regprocedure::text AS signature,p.prosecdef AS security_definer,pg_catalog.pg_get_userbyid(p.proowner) AS owner_role,
 encode(sha256(convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex') AS definition_sha256
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN('phone_provider_binding','apply_phone_provider_event','complete_phone_provider_report',
  'phone_inbound_resolve_grant','phone_inbound_scope_matches','phone_inbound_append_event','phone_callback_worker_operation',
  'phone_callback_validate_grant','phone_callback_record_grant_use','phone_callback_inbound_save',
  'phone_callback_outbound_context','phone_callback_outbound_save') ORDER BY signature LIMIT 50;
COMMIT;
