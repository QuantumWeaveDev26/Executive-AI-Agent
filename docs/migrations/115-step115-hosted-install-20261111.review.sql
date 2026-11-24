-- TARGET-SPECIFIC REVIEW ONLY. No execution or credential provisioning is authorized by this file.
-- Observed API image sha256:953a089698496c46d479eba46590b9afbd3dce672531f85f5ff29b4163038514. The deployment runner must independently recheck it.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog;
DO $step115_guard$ BEGIN
 IF current_setting('thaara.step115_hosted_install_approved',true) IS DISTINCT FROM 'owner-approved-step115-hosted-install-r3'
  OR current_database() IS DISTINCT FROM 'thaara_vps_pilot' OR current_setting('server_version_num') IS DISTINCT FROM '160015'
  OR session_user IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM session_user THEN
  RAISE EXCEPTION 'Step 115 requires exact target and separate installation approval'; END IF;
 IF to_regprocedure('public.current_authenticated_scope()') IS NULL OR to_regprocedure('public.resolve_session_scope(text)') IS NULL
  OR EXISTS(SELECT 1 FROM (VALUES('public.workspaces'),('public.users'),('public.memberships'),('public.sessions'),('public.audit_events')) required(name)
    WHERE to_regclass(required.name) IS NULL)
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid IN(to_regclass('public.memberships'),to_regclass('public.sessions'),to_regclass('public.audit_events'))
    AND (NOT relrowsecurity OR NOT relforcerowsecurity)) THEN RAISE EXCEPTION 'Base authorization boundaries are unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN('phone_inbound_call_events','phone_inbound_principals','phone_callback_requests','phone_callback_notification_grants','phone_callback_notification_grant_uses','phone_callback_worker_principals','phone_callback_dispatch_numbers'))
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN('thaara_phone_ingest','thaara_phone_guard','thaara_phone_notify','thaara_phone_notify_guard'))
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN('phone_inbound_resolve_grant','phone_inbound_scope_matches','phone_inbound_append_event','complete_phone_provider_report','phone_callback_validate_grant','phone_callback_record_grant_use','phone_callback_worker_operation','phone_callback_inbound_save','phone_callback_outbound_context','phone_callback_outbound_save')) THEN
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
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure('public.apply_phone_provider_event(uuid,text,text,text,text,text)')
  AND p.prosecdef AND pg_get_userbyid(p.proowner)='thaara_phone_callback_guard'
  AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='1acedd07bd1046e9fcdcbf4be78e6a2524fd409bfd791c7579e0140f90359a7f') THEN
  RAISE EXCEPTION 'Installed callback function drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure('public.phone_provider_binding(uuid)')
  AND p.prosecdef AND pg_get_userbyid(p.proowner)='thaara_phone_callback_guard'
  AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='7965975316ecd47f3557c65605e220d3c54845b31294fe24589c5efe261ba793') THEN
  RAISE EXCEPTION 'Installed callback function drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_call_events'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='workspace_id'
  AND format_type(a.atttypid,a.atttypmod)='uuid' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_call_events'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='owner_user_id'
  AND format_type(a.atttypid,a.atttypmod)='uuid' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_call_events'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='call_id'
  AND format_type(a.atttypid,a.atttypmod)='uuid' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_call_events'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='event_id'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_call_events'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='sequence'
  AND format_type(a.atttypid,a.atttypmod)='bigint' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_call_events'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='kind'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_call_events'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='state'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=false) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_call_events'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='text'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=false) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_call_events'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='event_hash'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_call_events'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='created_at'
  AND format_type(a.atttypid,a.atttypmod)='timestamp with time zone' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='workspace_id'
  AND format_type(a.atttypid,a.atttypmod)='uuid' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='owner_user_id'
  AND format_type(a.atttypid,a.atttypmod)='uuid' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='call_id'
  AND format_type(a.atttypid,a.atttypmod)='uuid' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='approval_id'
  AND format_type(a.atttypid,a.atttypmod)='uuid' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='draft'
  AND format_type(a.atttypid,a.atttypmod)='jsonb' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='draft_hash'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='idempotency_key'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='contact_id'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='contact_revision'
  AND format_type(a.atttypid,a.atttypmod)='bigint' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='mode'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='state'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='provider_call_id'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=false) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='report'
  AND format_type(a.atttypid,a.atttypmod)='jsonb' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='event_sequence'
  AND format_type(a.atttypid,a.atttypmod)='bigint' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='created_at'
  AND format_type(a.atttypid,a.atttypmod)='timestamp with time zone' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='updated_at'
  AND format_type(a.atttypid,a.atttypmod)='timestamp with time zone' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='dispatch_status'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='dispatch_claimed_at'
  AND format_type(a.atttypid,a.atttypmod)='timestamp with time zone' AND a.attnotnull=false) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='dispatch_code'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=false) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='provider_request_id'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=false) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_calls'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='transcript_source'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=false) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_contacts'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='workspace_id'
  AND format_type(a.atttypid,a.atttypmod)='uuid' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_contacts'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='owner_user_id'
  AND format_type(a.atttypid,a.atttypmod)='uuid' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_contacts'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='contact_id'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_contacts'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='revision'
  AND format_type(a.atttypid,a.atttypmod)='bigint' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_contacts'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='display_name'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_contacts'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='aliases'
  AND format_type(a.atttypid,a.atttypmod)='jsonb' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_contacts'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='phone_e164'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_contacts'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='consent_calling_allowed'
  AND format_type(a.atttypid,a.atttypmod)='boolean' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_contacts'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='consent_reference'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_contacts'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='consent_source'
  AND format_type(a.atttypid,a.atttypmod)='text' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_contacts'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='consent_recorded_at'
  AND format_type(a.atttypid,a.atttypmod)='timestamp with time zone' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_contacts'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='consent_expires_at'
  AND format_type(a.atttypid,a.atttypmod)='timestamp with time zone' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_contacts'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='archived'
  AND format_type(a.atttypid,a.atttypmod)='boolean' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_contacts'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='created_at'
  AND format_type(a.atttypid,a.atttypmod)='timestamp with time zone' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='phone_contacts'
  AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
  AND a.attnum>0 AND NOT a.attisdropped AND a.attname='updated_at'
  AND format_type(a.atttypid,a.atttypmod)='timestamp with time zone' AND a.attnotnull=true) THEN
  RAISE EXCEPTION 'Installed Phone column drift detected'; END IF;
END $step115_guard$;

-- Input docs/migrations/112-phone-inbound-events.review.sql
-- SHA256 d5c6a338b2bddba4e70bd527e8b0601b8bfe47602f3e46fc6306cc937adbbd8a
CREATE TABLE public.phone_inbound_call_events(
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 owner_user_id uuid NOT NULL REFERENCES public.users(id),
 call_id text NOT NULL CHECK(call_id ~ '^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK(kind IN('callback_requested','callback_withdrawn','call_completed')),
 event_id text NOT NULL CHECK(event_id=kind||'-'||call_id),
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 sequence smallint NOT NULL CHECK(sequence BETWEEN 1 AND 3),
 report jsonb NOT NULL CHECK(jsonb_typeof(report)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,owner_user_id,event_id),
 UNIQUE(workspace_id,owner_user_id,call_id,kind),
 UNIQUE(workspace_id,owner_user_id,call_id,sequence),
 CHECK(COALESCE(report->>'id'=call_id AND report->>'workspaceId'=workspace_id::text
  AND report->>'ownerUserId'=owner_user_id::text AND report->'providerVerified'='false'::jsonb,false)),
 CHECK(COALESCE(CASE WHEN kind='callback_requested' THEN report->>'outcome'='callback_requested'
  AND report->>'callbackConsent'='confirmed' AND length(report->>'callbackRequestId') BETWEEN 1 AND 128
  AND report->>'callerPhone' ~ '^\+[1-9][0-9]{7,14}$'
  WHEN kind='callback_withdrawn' THEN report->>'callbackConsent'='declined' ELSE true END,false))
);
CREATE INDEX phone_inbound_call_events_history ON public.phone_inbound_call_events(workspace_id,owner_user_id,created_at DESC,call_id);
ALTER TABLE public.phone_inbound_call_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_inbound_call_events FORCE ROW LEVEL SECURITY;
CREATE POLICY phone_inbound_call_events_owner ON public.phone_inbound_call_events USING(
 (workspace_id,owner_user_id) IN(SELECT s.workspace_id,s.user_id FROM public.current_authenticated_scope() s
  WHERE s.role='owner' AND EXISTS(SELECT 1 FROM public.sessions a WHERE a.token_hash=current_setting('app.session_token_hash',true)
   AND a.workspace_id=s.workspace_id AND a.user_id=s.user_id AND a.revoked_at IS NULL AND a.expires_at>clock_timestamp()))
) WITH CHECK(
 (workspace_id,owner_user_id) IN(SELECT s.workspace_id,s.user_id FROM public.current_authenticated_scope() s
  WHERE s.role='owner' AND EXISTS(SELECT 1 FROM public.sessions a WHERE a.token_hash=current_setting('app.session_token_hash',true)
   AND a.workspace_id=s.workspace_id AND a.user_id=s.user_id AND a.revoked_at IS NULL AND a.expires_at>clock_timestamp()))
);
REVOKE ALL ON public.phone_inbound_call_events FROM PUBLIC,thaara_app,thaara_worker;
GRANT SELECT,INSERT ON public.phone_inbound_call_events TO thaara_app;

-- Input docs/migrations/113-phone-inbound-principals.review.sql
-- SHA256 318eee1bad52b2674b1af21a186723e6c76d0433e247cacc0c4d983f61711680
CREATE ROLE thaara_phone_ingest NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE thaara_phone_guard NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE TABLE public.phone_inbound_principals(
 principal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 owner_user_id uuid NOT NULL REFERENCES public.users(id),
 route_id text NOT NULL UNIQUE CHECK(route_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 profile_fingerprint text NOT NULL CHECK(profile_fingerprint ~ '^[a-f0-9]{64}$'),
 revision integer NOT NULL CHECK(revision>0),
 operations text[] NOT NULL CHECK(operations IN(ARRAY['callback'],ARRAY['completion'],ARRAY['callback','completion'])),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 days')
);
ALTER TABLE public.phone_inbound_principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_inbound_principals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.phone_inbound_principals FROM PUBLIC,thaara_app,thaara_worker,thaara_phone_ingest;
GRANT USAGE ON SCHEMA public TO thaara_phone_guard,thaara_phone_ingest;
GRANT SELECT ON public.phone_inbound_principals TO thaara_phone_guard;
-- Row-lock privilege only; WITH CHECK(false) prevents definer mutation of the grant or owner membership.
GRANT UPDATE(revoked_at) ON public.phone_inbound_principals TO thaara_phone_guard;
CREATE POLICY phone_principal_guard_read ON public.phone_inbound_principals FOR SELECT TO thaara_phone_guard USING(true);
CREATE POLICY phone_principal_guard_lock ON public.phone_inbound_principals FOR UPDATE TO thaara_phone_guard USING(true) WITH CHECK(false);
GRANT SELECT ON public.memberships TO thaara_phone_guard;
GRANT UPDATE(role) ON public.memberships TO thaara_phone_guard;
CREATE POLICY phone_principal_membership_read ON public.memberships FOR SELECT TO thaara_phone_guard USING(true);
CREATE POLICY phone_principal_membership_lock ON public.memberships FOR UPDATE TO thaara_phone_guard USING(true) WITH CHECK(false);

CREATE FUNCTION public.phone_inbound_resolve_grant(p_hash text,p_route text,p_operation text)
RETURNS TABLE(grant_record jsonb) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p public.phone_inbound_principals%ROWTYPE;
BEGIN
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_route IS NULL OR p_route !~ '^[A-Za-z0-9_-]{1,128}$'
  OR p_operation IS NULL OR p_operation NOT IN('callback','completion') THEN
  RAISE EXCEPTION 'Inbound grant unavailable' USING ERRCODE='42501';
 END IF;
 -- No cookie or custom owner claims are ever promoted into an owner session.
 PERFORM set_config('app.session_token_hash','',true),set_config('app.workspace_id','',true),set_config('app.user_id','',true),set_config('app.role','',true);
 SELECT * INTO p FROM public.phone_inbound_principals WHERE token_hash=p_hash AND route_id=p_route
  AND revoked_at IS NULL AND expires_at>clock_timestamp() AND p_operation=ANY(operations) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Inbound grant unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.memberships m WHERE m.workspace_id=p.workspace_id AND m.user_id=p.owner_user_id AND m.role='owner' FOR SHARE;
 IF NOT FOUND OR p.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Inbound owner unavailable' USING ERRCODE='42501'; END IF;
 PERFORM set_config('app.phone_inbound_hash',p_hash,true),set_config('app.phone_inbound_route',p_route,true),set_config('app.phone_inbound_operation',p_operation,true);
 RETURN QUERY SELECT jsonb_build_object('principalId',p.principal_id,'workspaceId',p.workspace_id,'ownerUserId',p.owner_user_id,
  'routeId',p.route_id,'revision',p.revision,'profileFingerprint',p.profile_fingerprint,'tokenHash',p.token_hash,
  'activeOwner',true,'revokedAt',NULL,'expiresAt',to_char(p.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'operations',to_jsonb(p.operations));
END $$;
CREATE FUNCTION public.phone_inbound_scope_matches(p_workspace uuid,p_owner uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE g jsonb;
BEGIN
 SELECT grant_record INTO g FROM public.phone_inbound_resolve_grant(current_setting('app.phone_inbound_hash',true),
  current_setting('app.phone_inbound_route',true),current_setting('app.phone_inbound_operation',true));
 RETURN g->>'workspaceId'=p_workspace::text AND g->>'ownerUserId'=p_owner::text;
END $$;
GRANT SELECT,INSERT ON public.phone_inbound_call_events TO thaara_phone_guard;
-- Keep the unchanged owner predicate for its existing app role. The new guard must not evaluate its
-- browser-session subquery, and receives NO access to sessions. No owner predicate is weakened.
ALTER POLICY phone_inbound_call_events_owner ON public.phone_inbound_call_events TO thaara_app;
CREATE POLICY phone_principal_events_read ON public.phone_inbound_call_events FOR SELECT TO thaara_phone_guard
 USING(public.phone_inbound_scope_matches(workspace_id,owner_user_id));
CREATE POLICY phone_principal_events_insert ON public.phone_inbound_call_events FOR INSERT TO thaara_phone_guard
 WITH CHECK(public.phone_inbound_scope_matches(workspace_id,owner_user_id));
GRANT INSERT(workspace_id,actor_user_id,action,target_type,target_id,payload,created_at) ON public.audit_events TO thaara_phone_guard;
CREATE POLICY phone_principal_audit_insert ON public.audit_events FOR INSERT TO thaara_phone_guard
 WITH CHECK(action='phone.inbound.event_saved' AND target_type='phone_inbound_call'
  AND public.phone_inbound_scope_matches(workspace_id,actor_user_id));

CREATE FUNCTION public.phone_inbound_append_event(p_event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE g jsonb;r jsonb;call_key text;kind_key text;digest_key text;event_key text;op text;
 w uuid;u uuid;existing public.phone_inbound_call_events%ROWTYPE;n integer;history jsonb;duplicate boolean:=false;field_key text;
BEGIN
 SELECT grant_record INTO g FROM public.phone_inbound_resolve_grant(current_setting('app.phone_inbound_hash',true),
  current_setting('app.phone_inbound_route',true),current_setting('app.phone_inbound_operation',true));
 w:=(g->>'workspaceId')::uuid;u:=(g->>'ownerUserId')::uuid;op:=current_setting('app.phone_inbound_operation',true);
 IF p_event IS NULL OR jsonb_typeof(p_event) IS DISTINCT FROM 'object' OR octet_length(p_event::text)>65536 THEN
  RAISE EXCEPTION 'Invalid inbound event' USING ERRCODE='22023';
 END IF;
 call_key:=p_event->>'callId';kind_key:=p_event->>'kind';digest_key:=p_event->>'sourceDigest';event_key:=p_event->>'eventId';r:=p_event->'report';
 IF NOT COALESCE(call_key ~ '^[a-f0-9]{64}$' AND digest_key ~ '^[a-f0-9]{64}$'
  AND kind_key IN('callback_requested','callback_withdrawn','call_completed') AND event_key=kind_key||'-'||call_key
  AND ((op='callback' AND kind_key IN('callback_requested','callback_withdrawn')) OR (op='completion' AND kind_key='call_completed'))
  AND jsonb_typeof(r)='object' AND r->>'id'=call_key AND r->>'workspaceId'=w::text AND r->>'ownerUserId'=u::text
  AND r->'providerVerified'='false'::jsonb AND r->>'providerInteractionId' ~ '^[0-9]{8}/[A-Za-z0-9_.:-]{1,200}$'
  AND r->>'outcome' IN('enquired','callback_requested','needs_review'),false)
  OR r ? 'transcript' OR r ? 'transcriptExpiresAt' OR (r->'recordingReference' IS NOT NULL AND r->'recordingReference'<>'null'::jsonb)
  OR (r->'appointment' IS NOT NULL AND r->'appointment'<>'null'::jsonb) THEN
  RAISE EXCEPTION 'Inbound binding or unsupported material' USING ERRCODE='42501';
 END IF;
 IF NOT COALESCE((r->'callerPhone'='null'::jsonb OR r->>'callerPhone' ~ '^\+[1-9][0-9]{7,14}$')
  AND r->>'maskedPhone'=CASE WHEN r->'callerPhone'='null'::jsonb THEN 'Number unavailable' ELSE '•••• '||right(r->>'callerPhone',4) END
  AND (CASE WHEN r->>'outcome'='callback_requested' THEN r->>'callbackConsent'='confirmed' AND r->>'callerPhone' ~ '^\+[1-9][0-9]{7,14}$'
   AND r->>'callbackRequestId' ~ '^[A-Za-z0-9_-]{1,128}$' ELSE r->'callbackRequestId'='null'::jsonb END),false) THEN
  RAISE EXCEPTION 'Invalid inbound consent or phone' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_event) k WHERE k NOT IN('eventId','callId','kind','sourceDigest','report'))
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN('id','occurredAt','maskedPhone','callerPhone','customerName','business','serviceNeeded','enquirySummary',
   'outcome','callbackRequestId','providerVerified','providerInteractionId','timestampSource','durationSeconds','callStatus','preferredContactTime',
   'callbackConsent','callbackPreference','appointment','recordingReference','workspaceId','ownerUserId')) THEN
  RAISE EXCEPTION 'Unexpected inbound fields' USING ERRCODE='22023';
 END IF;
 FOREACH field_key IN ARRAY ARRAY['customerName','business','serviceNeeded','enquirySummary'] LOOP
  IF NOT(r ? field_key) OR jsonb_typeof(r->field_key) NOT IN('string','null') OR length(r->>field_key)>2000 THEN
   RAISE EXCEPTION 'Invalid inbound customer field' USING ERRCODE='22023';
  END IF;
 END LOOP;
 IF (r ? 'preferredContactTime' AND (jsonb_typeof(r->'preferredContactTime') NOT IN('string','null') OR length(r->>'preferredContactTime')>2000))
  OR NOT COALESCE(jsonb_typeof(r->'occurredAt')='string' AND r->>'occurredAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*Z$',false)
  OR (r ? 'callStatus' AND NOT COALESCE(r->>'callStatus' IN('ended','interrupted','failed','unknown'),false))
  OR (r ? 'timestampSource' AND NOT COALESCE(r->>'timestampSource' IN('provider_started','provider_ended','received_at'),false))
  OR (r ? 'callbackConsent' AND NOT COALESCE(r->>'callbackConsent' IN('confirmed','declined','unknown'),false))
  OR (r ? 'callbackPreference' AND NOT COALESCE(r->>'callbackPreference' IN('requested','declined','unknown'),false)) THEN
  RAISE EXCEPTION 'Invalid inbound report metadata' USING ERRCODE='22023';
 END IF;
 PERFORM (r->>'occurredAt')::timestamptz;
 IF r ? 'durationSeconds' AND r->'durationSeconds'<>'null'::jsonb THEN
  IF jsonb_typeof(r->'durationSeconds')<>'number' OR (r->>'durationSeconds')::numeric<0 OR (r->>'durationSeconds')::numeric>86400 THEN
   RAISE EXCEPTION 'Invalid inbound duration' USING ERRCODE='22023';
  END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('phone-inbound-events:'||w::text||':'||u::text||':'||call_key,0));
 SELECT * INTO existing FROM public.phone_inbound_call_events WHERE workspace_id=w AND owner_user_id=u AND event_id=event_key;
 IF FOUND THEN
  IF existing.source_digest<>digest_key OR existing.kind<>kind_key THEN RAISE EXCEPTION 'Inbound replay conflict' USING ERRCODE='23505'; END IF;
  duplicate:=true;
 ELSE
  SELECT count(*) INTO n FROM public.phone_inbound_call_events WHERE workspace_id=w AND owner_user_id=u AND call_id=call_key;
  IF n>=3 OR EXISTS(SELECT 1 FROM public.phone_inbound_call_events e WHERE e.workspace_id=w AND e.owner_user_id=u AND e.call_id=call_key
   AND (e.kind=kind_key OR e.report->>'providerInteractionId' IS DISTINCT FROM r->>'providerInteractionId'
    OR (e.report->>'callerPhone' IS NOT NULL AND r->>'callerPhone' IS NOT NULL AND e.report->>'callerPhone'<>r->>'callerPhone'))) THEN
   RAISE EXCEPTION 'Inbound phase or caller conflict' USING ERRCODE='23505';
  END IF;
  INSERT INTO public.phone_inbound_call_events(workspace_id,owner_user_id,call_id,event_id,kind,source_digest,sequence,report)
   VALUES(w,u,call_key,event_key,kind_key,digest_key,n+1,r);
  INSERT INTO public.audit_events(workspace_id,actor_user_id,action,target_type,target_id,payload,created_at)
   VALUES(w,u,'phone.inbound.event_saved','phone_inbound_call',call_key,
    jsonb_build_object('callId',call_key,'kind',kind_key,'revision',n+1,'principalId',g->>'principalId','operation',op),clock_timestamp());
 END IF;
 SELECT jsonb_agg(jsonb_build_object('eventId',e.event_id,'callId',e.call_id,'kind',e.kind,'sourceDigest',e.source_digest,'sequence',e.sequence,'report',e.report) ORDER BY e.sequence)
  INTO history FROM public.phone_inbound_call_events e WHERE e.workspace_id=w AND e.owner_user_id=u AND e.call_id=call_key;
 RETURN jsonb_build_object('saved',true,'events',history,'duplicate',duplicate);
END $$;
-- Assign definer ownership without making runtime a member or granting it direct table rights.
GRANT CREATE ON SCHEMA public TO thaara_phone_guard;
ALTER FUNCTION public.phone_inbound_resolve_grant(text,text,text) OWNER TO thaara_phone_guard;
ALTER FUNCTION public.phone_inbound_scope_matches(uuid,uuid) OWNER TO thaara_phone_guard;
ALTER FUNCTION public.phone_inbound_append_event(jsonb) OWNER TO thaara_phone_guard;
REVOKE CREATE ON SCHEMA public FROM thaara_phone_guard;
REVOKE ALL ON FUNCTION public.phone_inbound_resolve_grant(text,text,text),public.phone_inbound_scope_matches(uuid,uuid),public.phone_inbound_append_event(jsonb) FROM PUBLIC,thaara_app,thaara_worker;
GRANT EXECUTE ON FUNCTION public.phone_inbound_resolve_grant(text,text,text),public.phone_inbound_append_event(jsonb) TO thaara_phone_ingest;

-- Input docs/migrations/114-phone-structured-report.review.sql
-- SHA256 bc4f111e15edb6b00718ee9e64378149508a51219a8152e83d480bceec25448b
CREATE FUNCTION public.complete_phone_provider_report(
  p_call_id uuid, p_provider_request_id text, p_provider_call_id text,
  p_event_id text, p_event_hash text, p_conversation jsonb
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  c public.phone_calls; prior text; turn jsonb; previous_sequence integer := -1;
  quotes jsonb := '[]'::jsonb; ids jsonb := '[]'::jsonb; v_report jsonb; needed integer; applied text;
BEGIN
  IF NOT COALESCE(p_call_id IS NOT NULL AND p_provider_request_id ~ '^[-A-Za-z0-9_.:]{1,128}$'
    AND p_provider_call_id ~ '^([A-Za-z0-9_.:-]{1,128}|[0-9]{8}/[A-Za-z0-9][A-Za-z0-9_.:-]{0,99})$'
    AND p_event_id ~ '^[-A-Za-z0-9_]{1,100}$' AND p_event_hash ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(p_conversation)='object' AND octet_length(p_conversation::text)<=20000, false) THEN
    RAISE EXCEPTION 'Phone structured report input denied';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_conversation) AS fields(key) WHERE fields.key NOT IN ('version','turns','truncated','verified','taskOutcome'))
    OR NOT COALESCE(p_conversation->'version'='1'::jsonb AND p_conversation->'verified'='false'::jsonb
      AND p_conversation->>'taskOutcome'='not_independently_verified'
      AND jsonb_typeof(p_conversation->'truncated')='boolean' AND jsonb_typeof(p_conversation->'turns')='array', false) THEN
    RAISE EXCEPTION 'Phone structured report shape denied';
  END IF;
  IF jsonb_array_length(p_conversation->'turns')>24 THEN RAISE EXCEPTION 'Phone structured report bounds denied'; END IF;
  FOR turn IN SELECT value FROM jsonb_array_elements(p_conversation->'turns') LOOP
    IF jsonb_typeof(turn) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Phone structured turn denied'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(turn) AS fields(key) WHERE fields.key NOT IN ('sequence','speaker','text','source','attribution'))
      OR NOT COALESCE(jsonb_typeof(turn->'sequence')='number' AND turn->>'sequence' ~ '^[0-9]{1,3}$'
        AND jsonb_typeof(turn->'text')='string' AND length(turn->>'text') BETWEEN 1 AND 1000
        AND length(btrim(turn->>'text'))>0
        AND turn->>'speaker' IN ('thaara','customer','unknown') AND turn->>'source'='provider_english_translation'
        AND turn->>'attribution'=(CASE WHEN turn->>'speaker'='unknown' THEN 'uncertain' ELSE 'provider_labelled' END), false) THEN
      RAISE EXCEPTION 'Phone structured turn shape denied';
    END IF;
    IF (turn->>'sequence')::integer <= previous_sequence OR (turn->>'sequence')::integer>199 THEN
      RAISE EXCEPTION 'Phone structured turn order denied';
    END IF;
    previous_sequence := (turn->>'sequence')::integer;
    IF turn->>'speaker'='customer' AND jsonb_array_length(quotes)<12 THEN
      quotes := quotes || jsonb_build_array(turn->>'text');
    END IF;
  END LOOP;
  -- All quoted turns are bound to the one persisted completion event, not invented per-turn event rows.
  IF jsonb_array_length(quotes)>0 THEN ids := jsonb_build_array(p_event_id); END IF;
  SELECT * INTO c FROM public.phone_calls WHERE call_id=p_call_id FOR UPDATE;
  IF NOT FOUND OR c.mode<>'live' OR c.dispatch_status<>'unverified'
    OR c.provider_request_id IS DISTINCT FROM p_provider_request_id
    OR (c.provider_call_id IS NOT NULL AND c.provider_call_id IS DISTINCT FROM p_provider_call_id)
    OR (c.transcript_source IS NOT NULL AND c.transcript_source <> 'provider_english') THEN
    RAISE EXCEPTION 'Phone structured report binding denied';
  END IF;
  SELECT event_hash INTO prior FROM public.phone_call_events WHERE workspace_id=c.workspace_id
    AND owner_user_id=c.owner_user_id AND call_id=c.call_id AND event_id=p_event_id;
  IF FOUND THEN
    IF prior IS DISTINCT FROM p_event_hash OR c.state<>'completed' OR c.report->'conversation' IS DISTINCT FROM p_conversation THEN
      RAISE EXCEPTION 'Phone structured report replay conflict';
    END IF;
    RETURN 'duplicate';
  END IF;
  -- Never reopen or rewrite a completed/failed call, including legacy recipient-only reports.
  IF c.state NOT IN ('queued','ringing','answered') THEN RETURN 'ignored'; END IF;
  needed := CASE c.state WHEN 'queued' THEN 3 WHEN 'ringing' THEN 2 ELSE 1 END;
  IF c.event_sequence+needed>100 THEN RETURN 'ignored'; END IF;
  IF c.state='queued' THEN
    applied := public.apply_phone_provider_event(p_call_id,p_provider_request_id,p_provider_call_id,'ringing',p_event_id || '-ringing',p_event_hash);
    IF applied NOT IN ('applied','duplicate') THEN RAISE EXCEPTION 'Phone structured report state denied'; END IF;
  END IF;
  IF c.state IN ('queued','ringing') THEN
    applied := public.apply_phone_provider_event(p_call_id,p_provider_request_id,p_provider_call_id,'answered',p_event_id || '-answered',p_event_hash);
    IF applied NOT IN ('applied','duplicate') THEN RAISE EXCEPTION 'Phone structured report state denied'; END IF;
  END IF;
  SELECT * INTO c FROM public.phone_calls WHERE call_id=p_call_id FOR UPDATE;
  IF c.state IS DISTINCT FROM 'answered' OR c.provider_call_id IS DISTINCT FROM p_provider_call_id THEN
    RAISE EXCEPTION 'Phone structured report completion denied';
  END IF;
  -- Earlier final recipient turns must not silently disappear under a different completion payload.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(c.report->'quotedResponses','[]'::jsonb)) AS old_turn(value)
      WHERE NOT quotes @> jsonb_build_array(old_turn.value)) THEN
    RAISE EXCEPTION 'Phone structured report evidence conflict';
  END IF;
  -- Retain links to earlier persisted recipient evidence carried forward by the check above.
  ids := COALESCE(c.report->'evidenceIds','[]'::jsonb) || ids;
  v_report := jsonb_build_object('text','Live call. Call state: completed. Recipient words are rendered in English by the call provider; outcome unverified. See the ordered conversation.',
    'spokenText','Live call completed. Provider transcript is unverified. Review the recorded conversation.',
    'quotedResponses',quotes,'evidenceIds',ids,'verified',false,'simulated',false,'conversation',p_conversation);
  INSERT INTO public.phone_call_events(workspace_id,owner_user_id,call_id,event_id,sequence,kind,state,text,event_hash)
    VALUES(c.workspace_id,c.owner_user_id,c.call_id,p_event_id,c.event_sequence+1,'state','completed',NULL,p_event_hash);
  UPDATE public.phone_calls SET state='completed',report=v_report,event_sequence=c.event_sequence+1,
    provider_call_id=p_provider_call_id,transcript_source='provider_english'
    WHERE workspace_id=c.workspace_id AND owner_user_id=c.owner_user_id AND call_id=c.call_id;
  PERFORM set_config('app.workspace_id',c.workspace_id::text,true);
  INSERT INTO public.audit_events(workspace_id,actor_user_id,action,target_type,target_id,payload,created_at)
    VALUES(c.workspace_id,NULL,'phone.ai.structured_report_saved','phone_call',c.call_id::text,
      jsonb_build_object('callId',c.call_id,'eventId',p_event_id,'actorKind','phone_provider'),clock_timestamp());
  RETURN 'applied';
END $$;
ALTER FUNCTION public.complete_phone_provider_report(uuid,text,text,text,text,jsonb) OWNER TO thaara_phone_callback_guard;
REVOKE ALL ON FUNCTION public.complete_phone_provider_report(uuid,text,text,text,text,jsonb) FROM PUBLIC,thaara_app,thaara_worker;
GRANT EXECUTE ON FUNCTION public.complete_phone_provider_report(uuid,text,text,text,text,jsonb) TO thaara_app;
-- Reject unexpected inherited/default EXECUTE grants rather than silently widening access.
-- Exact grantor ownership-transfer behavior still requires separately approved PG16 validation/review.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE p.oid='public.complete_phone_provider_report(uuid,text,text,text,text,jsonb)'::regprocedure
      AND (a.grantee NOT IN (p.proowner,'thaara_app'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
  ) THEN RAISE EXCEPTION 'Phone structured report ACL denied'; END IF;
END $$;

-- Input docs/migrations/115-phone-callback-notification.review.sql
-- SHA256 9fee941e982c2f7bfeefbf6c55e041da549dce4a368d5c55913a5fee14ebed33
CREATE TABLE public.phone_callback_requests (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 owner_user_id uuid NOT NULL REFERENCES public.users(id),
 request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
 call_id text NOT NULL CHECK (length(call_id) BETWEEN 1 AND 220),
 direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
 request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
 details jsonb NOT NULL CHECK (jsonb_typeof(details)='object' AND octet_length(details::text)<=4096 AND
  details ?& ARRAY['name','business','service','phoneNumber','numberSource'] AND
  details - ARRAY['name','business','service','phoneNumber','numberSource']='{}'::jsonb),
 occurred_at timestamptz NOT NULL,
 request_status text NOT NULL CHECK (request_status IN ('requested','contacted','completed','cancelled')),
 notification_status text NOT NULL CHECK (notification_status IN ('pending','sending','submitted','failed','unverified','needs_review')),
 notification_attempt_id uuid,
 provider_message_id text CHECK (provider_message_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 attempts smallint NOT NULL CHECK (attempts BETWEEN 0 AND 2),
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 sending_started_at timestamptz,
 PRIMARY KEY(workspace_id,owner_user_id,request_id),
 UNIQUE(workspace_id,owner_user_id,direction,call_id),
 CHECK ((attempts=0)=(notification_attempt_id IS NULL)),
 CHECK ((notification_status='submitted')=(provider_message_id IS NOT NULL)),
 CHECK (notification_status NOT IN ('sending','submitted','failed','unverified') OR attempts>0),
 CHECK (notification_status<>'pending' OR attempts<2)
);
ALTER TABLE public.phone_callback_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_callback_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.phone_callback_requests FROM PUBLIC;
GRANT SELECT,INSERT ON public.phone_callback_requests TO thaara_app;
GRANT UPDATE(notification_status,notification_attempt_id,provider_message_id,attempts,next_attempt_at,sending_started_at) ON public.phone_callback_requests TO thaara_app;
CREATE POLICY phone_callback_owner ON public.phone_callback_requests TO thaara_app
 USING ((workspace_id,owner_user_id) IN (SELECT s.workspace_id,s.user_id FROM public.current_authenticated_scope() s WHERE s.role='owner'))
 WITH CHECK ((workspace_id,owner_user_id) IN (SELECT s.workspace_id,s.user_id FROM public.current_authenticated_scope() s WHERE s.role='owner'));

-- Input docs/migrations/115g-phone-callback-grants.review.sql
-- SHA256 657f4b00634b2cd330a634f9d583b6bb1530cce9692199d5ccc0af923f32c1d3
CREATE TABLE public.phone_callback_notification_grants (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 owner_user_id uuid NOT NULL REFERENCES public.users(id),
 approval_id uuid NOT NULL REFERENCES public.approval_requests(id),
 approved_params jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 PRIMARY KEY(workspace_id,owner_user_id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 days')
);
ALTER TABLE public.phone_callback_notification_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_callback_notification_grants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.phone_callback_notification_grants FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON public.phone_callback_notification_grants TO thaara_app;
CREATE POLICY phone_callback_notification_grants_owner ON public.phone_callback_notification_grants TO thaara_app
 USING ((workspace_id,owner_user_id) IN (SELECT s.workspace_id,s.user_id FROM public.current_authenticated_scope() s WHERE s.role='owner'))
 WITH CHECK ((workspace_id,owner_user_id) IN (SELECT s.workspace_id,s.user_id FROM public.current_authenticated_scope() s WHERE s.role='owner'));

CREATE TABLE public.phone_callback_notification_grant_uses (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 owner_user_id uuid NOT NULL REFERENCES public.users(id),
 approval_id uuid NOT NULL REFERENCES public.approval_requests(id),
 activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 revoked_at timestamptz,
 PRIMARY KEY(workspace_id,owner_user_id,approval_id)
);
ALTER TABLE public.phone_callback_notification_grant_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_callback_notification_grant_uses FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.phone_callback_notification_grant_uses FROM PUBLIC;
GRANT SELECT,INSERT ON public.phone_callback_notification_grant_uses TO thaara_app;
GRANT UPDATE(revoked_at) ON public.phone_callback_notification_grant_uses TO thaara_app;
CREATE POLICY phone_callback_grant_uses_owner ON public.phone_callback_notification_grant_uses TO thaara_app
 USING ((workspace_id,owner_user_id) IN (SELECT s.workspace_id,s.user_id FROM public.current_authenticated_scope() s WHERE s.role='owner'))
 WITH CHECK ((workspace_id,owner_user_id) IN (SELECT s.workspace_id,s.user_id FROM public.current_authenticated_scope() s WHERE s.role='owner'));

CREATE FUNCTION public.phone_callback_validate_grant() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.approval_requests%ROWTYPE;existing public.phone_callback_notification_grants%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO existing FROM public.phone_callback_notification_grants WHERE workspace_id=NEW.workspace_id AND owner_user_id=NEW.owner_user_id;
  IF FOUND AND existing.approval_id=NEW.approval_id THEN
   IF existing.revoked_at IS NOT NULL OR existing.approved_params IS DISTINCT FROM NEW.approved_params
    OR existing.expires_at IS DISTINCT FROM NEW.expires_at THEN RAISE EXCEPTION 'Callback grant replay needs new approval'; END IF;
   RETURN NEW;
  END IF;
 END IF;
 IF TG_OP='UPDATE' AND NEW.approval_id=OLD.approval_id THEN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
   OR NEW.approved_params IS DISTINCT FROM OLD.approved_params OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
   OR NEW.created_at IS DISTINCT FROM OLD.created_at OR OLD.revoked_at IS NOT NULL
   OR NEW.revoked_at IS NULL THEN RAISE EXCEPTION 'Callback grant replay denied'; END IF;
  NEW.revoked_at:=clock_timestamp();
  RETURN NEW;
 END IF;
 IF EXISTS(SELECT 1 FROM public.phone_callback_notification_grant_uses WHERE workspace_id=NEW.workspace_id
  AND owner_user_id=NEW.owner_user_id AND approval_id=NEW.approval_id) THEN RAISE EXCEPTION 'Callback grant historical approval replay denied'; END IF;
 NEW.created_at:=clock_timestamp();
 IF NEW.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Callback grant initial state denied'; END IF;
 SELECT * INTO a FROM public.approval_requests WHERE id=NEW.approval_id AND workspace_id=NEW.workspace_id FOR SHARE;
 IF NOT FOUND OR a.action_name<>'phone.callback.authorize_notifications' OR a.status<>'approved'
  OR a.requester_user_id IS DISTINCT FROM NEW.owner_user_id OR a.approver_user_id IS DISTINCT FROM NEW.owner_user_id
  OR a.expires_at<=clock_timestamp() OR a.action_params IS DISTINCT FROM NEW.approved_params
  OR NEW.approved_params IS DISTINCT FROM jsonb_build_object('enabled',true,'sender','notifications@brandmintai.io',
   'recipient','connect@brandmintai.io','expiresAt',NEW.approved_params->>'expiresAt')
  OR (NEW.approved_params->>'expiresAt')::timestamptz IS DISTINCT FROM NEW.expires_at THEN
  RAISE EXCEPTION 'Callback grant approval denied';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.phone_callback_validate_grant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phone_callback_validate_grant() TO thaara_app;
CREATE TRIGGER phone_callback_notification_grant_validation BEFORE INSERT OR UPDATE ON public.phone_callback_notification_grants
 FOR EACH ROW EXECUTE FUNCTION public.phone_callback_validate_grant();

CREATE FUNCTION public.phone_callback_record_grant_use() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  UPDATE public.phone_callback_notification_grant_uses SET revoked_at=clock_timestamp()
   WHERE workspace_id=OLD.workspace_id AND owner_user_id=OLD.owner_user_id AND approval_id=OLD.approval_id AND revoked_at IS NULL;
 END IF;
 IF TG_OP='INSERT' OR NEW.approval_id<>OLD.approval_id THEN
  INSERT INTO public.phone_callback_notification_grant_uses(workspace_id,owner_user_id,approval_id)
   VALUES(NEW.workspace_id,NEW.owner_user_id,NEW.approval_id);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.phone_callback_record_grant_use() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phone_callback_record_grant_use() TO thaara_app;
CREATE TRIGGER phone_callback_notification_grant_history AFTER INSERT OR UPDATE ON public.phone_callback_notification_grants
 FOR EACH ROW EXECUTE FUNCTION public.phone_callback_record_grant_use();

-- Input docs/migrations/115w-phone-callback-worker.review.sql
-- SHA256 f17dbd7b26368ab5fd0ab9556a872d5e336b551fc28c35c5456a3a34f30d9879
CREATE ROLE thaara_phone_notify NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE thaara_phone_notify_guard NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE TABLE public.phone_callback_worker_principals (
 principal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 owner_user_id uuid NOT NULL REFERENCES public.users(id),
 approval_id uuid NOT NULL REFERENCES public.approval_requests(id),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz
);
ALTER TABLE public.phone_callback_worker_principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_callback_worker_principals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.phone_callback_requests ADD COLUMN notification_worker_principal_id uuid REFERENCES public.phone_callback_worker_principals(principal_id);
REVOKE ALL ON public.phone_callback_worker_principals FROM PUBLIC,thaara_app,thaara_worker,thaara_phone_notify;
GRANT USAGE ON SCHEMA public TO thaara_phone_notify,thaara_phone_notify_guard;
GRANT SELECT ON public.phone_callback_worker_principals,public.phone_callback_notification_grants,public.approval_requests,public.memberships
 TO thaara_phone_notify_guard;
GRANT UPDATE(revoked_at) ON public.phone_callback_worker_principals,public.phone_callback_notification_grants TO thaara_phone_notify_guard;
GRANT UPDATE(status) ON public.approval_requests TO thaara_phone_notify_guard;
GRANT UPDATE(role) ON public.memberships TO thaara_phone_notify_guard;
CREATE POLICY phone_notify_principals_read ON public.phone_callback_worker_principals FOR SELECT TO thaara_phone_notify_guard USING(true);
CREATE POLICY phone_notify_principals_lock ON public.phone_callback_worker_principals FOR UPDATE TO thaara_phone_notify_guard USING(true) WITH CHECK(false);
CREATE POLICY phone_notify_grants_read ON public.phone_callback_notification_grants FOR SELECT TO thaara_phone_notify_guard USING(true);
CREATE POLICY phone_notify_grants_lock ON public.phone_callback_notification_grants FOR UPDATE TO thaara_phone_notify_guard USING(true) WITH CHECK(false);
CREATE POLICY phone_notify_approvals_read ON public.approval_requests FOR SELECT TO thaara_phone_notify_guard USING(true);
CREATE POLICY phone_notify_approvals_lock ON public.approval_requests FOR UPDATE TO thaara_phone_notify_guard USING(true) WITH CHECK(false);
CREATE POLICY phone_notify_membership_read ON public.memberships FOR SELECT TO thaara_phone_notify_guard USING(true);
CREATE POLICY phone_notify_membership_lock ON public.memberships FOR UPDATE TO thaara_phone_notify_guard USING(true) WITH CHECK(false);
GRANT SELECT ON public.phone_callback_requests TO thaara_phone_notify_guard;
GRANT UPDATE(notification_status,notification_attempt_id,provider_message_id,attempts,next_attempt_at,sending_started_at,notification_worker_principal_id)
 ON public.phone_callback_requests TO thaara_phone_notify_guard;
CREATE POLICY phone_notify_requests ON public.phone_callback_requests TO thaara_phone_notify_guard
 USING(workspace_id=NULLIF(current_setting('app.phone_notify_workspace',true),'')::uuid
  AND owner_user_id=NULLIF(current_setting('app.phone_notify_owner',true),'')::uuid)
 WITH CHECK(workspace_id=NULLIF(current_setting('app.phone_notify_workspace',true),'')::uuid
  AND owner_user_id=NULLIF(current_setting('app.phone_notify_owner',true),'')::uuid);
GRANT INSERT ON public.audit_events TO thaara_phone_notify_guard;
CREATE POLICY phone_notify_audit ON public.audit_events FOR INSERT TO thaara_phone_notify_guard
 WITH CHECK(workspace_id=NULLIF(current_setting('app.phone_notify_workspace',true),'')::uuid AND actor_user_id IS NULL);

CREATE FUNCTION public.phone_callback_worker_operation(
 p_hash text,p_workspace uuid,p_owner uuid,p_operation text,p_id text DEFAULT NULL,p_attempt uuid DEFAULT NULL,
 p_outcome text DEFAULT NULL,p_provider_id text DEFAULT NULL,p_approval uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE principal public.phone_callback_worker_principals%ROWTYPE;
 grant_row public.phone_callback_notification_grants%ROWTYPE;
 item public.phone_callback_requests%ROWTYPE;
 data jsonb; ids jsonb; count_changed integer;has_authority boolean:=false;
BEGIN
 IF session_user<>'thaara_phone_notify' OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$'
  OR p_workspace IS NULL OR p_owner IS NULL OR p_operation IS NULL
  OR p_operation NOT IN('grant','read','pending','claim','finish','recover') THEN
  RAISE EXCEPTION 'Phone notification principal denied' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=session_user AND
  (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit))
  OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname<>session_user AND pg_has_role(session_user,r.oid,'MEMBER'))
  OR has_schema_privilege(session_user,'public','CREATE')
  OR EXISTS(SELECT 1 FROM pg_class t JOIN pg_roles r ON r.rolname=session_user WHERE t.relnamespace='public'::regnamespace
   AND t.relkind IN('r','p','v','m','f') AND (t.relowner=r.oid
    OR has_table_privilege(session_user,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_any_column_privilege(session_user,t.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) THEN
  RAISE EXCEPTION 'Phone notification role denied' USING ERRCODE='42501';
 END IF;
 PERFORM set_config('app.session_token_hash','',true),set_config('app.workspace_id','',true),
  set_config('app.user_id','',true),set_config('app.role','',true);
 SELECT * INTO principal FROM public.phone_callback_worker_principals WHERE token_hash=p_hash
  AND workspace_id=p_workspace AND owner_user_id=p_owner FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Phone notification principal denied' USING ERRCODE='42501'; END IF;
 SELECT g.* INTO grant_row FROM public.phone_callback_notification_grants g
  JOIN public.approval_requests a ON a.id=g.approval_id AND a.workspace_id=g.workspace_id
  JOIN public.memberships m ON m.workspace_id=g.workspace_id AND m.user_id=g.owner_user_id AND m.role='owner'
  WHERE g.workspace_id=p_workspace AND g.owner_user_id=p_owner AND g.approval_id=principal.approval_id
  AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND principal.revoked_at IS NULL AND principal.expires_at>clock_timestamp()
  AND a.requester_user_id=p_owner AND a.approver_user_id=p_owner AND a.status='approved'
  AND a.action_name='phone.callback.authorize_notifications' AND a.action_params=g.approved_params FOR SHARE OF g,a,m;
 has_authority:=FOUND;
 -- A past claim permits recording its result, never acquiring or reading new work after revocation.
 IF NOT has_authority AND p_operation NOT IN('finish','recover') THEN
  RAISE EXCEPTION 'Phone notification grant denied' USING ERRCODE='42501';
 END IF;
 PERFORM set_config('app.phone_notify_workspace',p_workspace::text,true),set_config('app.phone_notify_owner',p_owner::text,true);
 IF p_operation='grant' THEN
  data:=grant_row.approved_params||jsonb_build_object('workspaceId',p_workspace,'userId',p_owner,'approvedByUserId',p_owner,'approvalId',grant_row.approval_id);
 ELSIF p_operation='pending' THEN
  SELECT COALESCE(jsonb_agg(request_id),'[]'::jsonb) INTO data FROM (
   SELECT request_id FROM public.phone_callback_requests WHERE workspace_id=p_workspace AND owner_user_id=p_owner
   AND request_status='requested' AND notification_status='pending' AND attempts<2 AND next_attempt_at<=clock_timestamp()
   ORDER BY next_attempt_at,request_id LIMIT 25) ready;
 ELSIF p_operation='recover' THEN
  WITH recovered AS (UPDATE public.phone_callback_requests SET notification_status='unverified'
   WHERE workspace_id=p_workspace AND owner_user_id=p_owner AND notification_status='sending'
   AND (has_authority OR notification_worker_principal_id=principal.principal_id)
   AND sending_started_at<clock_timestamp()-interval '5 minutes' RETURNING request_id)
  SELECT COALESCE(jsonb_agg(request_id),'[]'::jsonb) INTO ids FROM recovered;
  IF jsonb_array_length(ids)>0 THEN
   INSERT INTO public.audit_events(workspace_id,actor_user_id,action,target_type,target_id,payload)
    VALUES(p_workspace,NULL,'phone.callback.worker_recovered','phone_callback_worker',principal.principal_id::text,
     jsonb_build_object('count',jsonb_array_length(ids),'status','unverified'));
  END IF;
  data:=jsonb_build_object('recovered',jsonb_array_length(ids));
 ELSE
  IF p_id IS NULL OR p_id !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Phone notification request denied'; END IF;
  IF p_operation='read' THEN
   SELECT * INTO item FROM public.phone_callback_requests WHERE workspace_id=p_workspace AND owner_user_id=p_owner AND request_id=p_id;
   IF NOT FOUND THEN data:='null'::jsonb;
   ELSE data:=item.details||jsonb_build_object('id',item.request_id,'workspaceId',item.workspace_id,'userId',item.owner_user_id,
    'callId',item.call_id,'direction',item.direction,'occurredAt',item.occurred_at,'status',item.request_status,
    'notificationStatus',item.notification_status,'notificationAttemptId',item.notification_attempt_id,
    'providerMessageId',item.provider_message_id,'attempts',item.attempts);
   END IF;
  ELSIF p_operation='claim' THEN
   IF p_attempt IS NULL OR p_approval IS DISTINCT FROM grant_row.approval_id THEN RAISE EXCEPTION 'Phone notification claim denied'; END IF;
   UPDATE public.phone_callback_requests SET notification_status='sending',notification_attempt_id=p_attempt,attempts=attempts+1,
    sending_started_at=clock_timestamp(),notification_worker_principal_id=principal.principal_id
    WHERE workspace_id=p_workspace AND owner_user_id=p_owner AND request_id=p_id AND request_status='requested'
    AND notification_status='pending' AND attempts<2 AND next_attempt_at<=clock_timestamp() RETURNING * INTO item;
   IF NOT FOUND THEN data:='null'::jsonb;
   ELSE
    data:=to_jsonb(item.attempts);
    INSERT INTO public.audit_events(workspace_id,actor_user_id,action,target_type,target_id,payload)
     VALUES(p_workspace,NULL,'phone.callback.worker_claimed','phone_callback_request',p_id,jsonb_build_object('status','sending'));
   END IF;
  ELSE
   IF p_attempt IS NULL OR p_outcome IS NULL OR p_outcome NOT IN('submitted','failed','unverified','pending')
    OR ((p_outcome='submitted') IS DISTINCT FROM (p_provider_id IS NOT NULL))
    OR (p_provider_id IS NOT NULL AND p_provider_id !~ '^[A-Za-z0-9_-]{1,128}$') THEN RAISE EXCEPTION 'Phone notification result denied'; END IF;
   UPDATE public.phone_callback_requests SET notification_status=p_outcome,provider_message_id=p_provider_id,
    next_attempt_at=CASE WHEN p_outcome='pending' THEN clock_timestamp()+interval '60 seconds' ELSE next_attempt_at END
    WHERE workspace_id=p_workspace AND owner_user_id=p_owner AND request_id=p_id AND notification_status='sending'
    AND notification_attempt_id=p_attempt AND notification_worker_principal_id=principal.principal_id AND (p_outcome<>'pending' OR attempts<2);
   GET DIAGNOSTICS count_changed=ROW_COUNT;
   IF count_changed<>1 THEN RAISE EXCEPTION 'Phone notification attempt changed'; END IF;
   INSERT INTO public.audit_events(workspace_id,actor_user_id,action,target_type,target_id,payload)
    VALUES(p_workspace,NULL,'phone.callback.worker_result','phone_callback_request',p_id,jsonb_build_object('status',p_outcome));
   data:='true'::jsonb;
  END IF;
 END IF;
 RETURN jsonb_build_object('workspaceId',p_workspace,'userId',p_owner,'data',data);
END $$;
GRANT CREATE ON SCHEMA public TO thaara_phone_notify_guard;
ALTER FUNCTION public.phone_callback_worker_operation(text,uuid,uuid,text,text,uuid,text,text,uuid) OWNER TO thaara_phone_notify_guard;
REVOKE CREATE ON SCHEMA public FROM thaara_phone_notify_guard;
REVOKE ALL ON FUNCTION public.phone_callback_worker_operation(text,uuid,uuid,text,text,uuid,text,text,uuid) FROM PUBLIC,thaara_app,thaara_worker;
GRANT EXECUTE ON FUNCTION public.phone_callback_worker_operation(text,uuid,uuid,text,text,uuid,text,text,uuid) TO thaara_phone_notify;

-- Input docs/migrations/115i-phone-callback-inbound-save.review.sql
-- SHA256 05867d3bf19bf9b89208e98e68589e60f7c1ddaf8e54a726e063d33820a9d3e0
GRANT SELECT,INSERT ON public.phone_callback_requests TO thaara_phone_guard;
CREATE POLICY phone_callback_inbound_scope ON public.phone_callback_requests TO thaara_phone_guard
 USING(public.phone_inbound_scope_matches(workspace_id,owner_user_id))
 WITH CHECK(public.phone_inbound_scope_matches(workspace_id,owner_user_id));
CREATE POLICY phone_callback_inbound_audit ON public.audit_events FOR INSERT TO thaara_phone_guard
 WITH CHECK(action='phone.callback.inbound_saved' AND target_type='phone_callback_request'
  AND public.phone_inbound_scope_matches(workspace_id,actor_user_id));

CREATE FUNCTION public.phone_callback_inbound_save(p_request jsonb,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE w uuid;u uuid;key text;details jsonb;r public.phone_callback_requests%ROWTYPE;report jsonb;field text;
BEGIN
 IF session_user<>'thaara_phone_ingest' OR jsonb_typeof(p_request) IS DISTINCT FROM 'object'
  OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR octet_length(p_request::text)>8192 THEN
  RAISE EXCEPTION 'Inbound callback request denied';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_request) k WHERE k NOT IN('workspaceId','userId','id','callId','direction',
  'name','business','service','phoneNumber','numberSource','occurredAt','status','notificationStatus','notificationAttemptId','providerMessageId','attempts')) THEN
  RAISE EXCEPTION 'Inbound callback shape denied';
 END IF;
 w:=(p_request->>'workspaceId')::uuid;u:=(p_request->>'userId')::uuid;key:=p_request->>'id';
 IF NOT public.phone_inbound_scope_matches(w,u) OR key IS NULL OR key !~ '^[a-f0-9]{64}$'
  OR NOT COALESCE(p_request->>'callId' ~ '^[a-f0-9]{64}$' AND p_request->>'direction'='inbound'
   AND p_request->>'status'='requested' AND p_request->>'notificationStatus' IN('pending','needs_review')
   AND p_request->'attempts'='0'::jsonb AND p_request->'notificationAttemptId'='null'::jsonb
   AND p_request->'providerMessageId'='null'::jsonb,false) THEN RAISE EXCEPTION 'Inbound callback scope denied'; END IF;
 FOR field IN SELECT unnest(ARRAY['name','business','service','phoneNumber','numberSource']) LOOP
  IF NOT COALESCE(jsonb_typeof(p_request->field)='null' OR
   (jsonb_typeof(p_request->field)='string' AND length(p_request->>field) BETWEEN 1 AND 240),false) THEN
   RAISE EXCEPTION 'Inbound callback detail denied';
  END IF;
 END LOOP;
 IF p_request->>'phoneNumber' IS NOT NULL AND (p_request->>'phoneNumber' !~ '^\+[1-9][0-9]{7,14}$'
  OR p_request->>'numberSource' NOT IN('call_metadata','caller_confirmed')) THEN RAISE EXCEPTION 'Inbound callback number denied'; END IF;
 IF (p_request->>'phoneNumber' IS NULL) IS DISTINCT FROM (p_request->>'numberSource' IS NULL) THEN RAISE EXCEPTION 'Inbound callback number source denied'; END IF;
 SELECT e.report INTO report FROM public.phone_inbound_call_events e WHERE e.workspace_id=w AND e.owner_user_id=u
  AND e.call_id=p_request->>'callId' AND e.kind='call_completed';
 IF NOT FOUND OR report->>'callStatus' IS DISTINCT FROM 'ended'
  OR report->>'callbackConsent'='declined' OR (report->>'occurredAt')::timestamptz IS DISTINCT FROM (p_request->>'occurredAt')::timestamptz
  OR (p_request->>'numberSource'='call_metadata' AND p_request->>'phoneNumber' IS DISTINCT FROM report->>'callerPhone') THEN
  RAISE EXCEPTION 'Inbound callback completion binding denied';
 END IF;
 details:=jsonb_build_object('name',p_request->'name','business',p_request->'business','service',p_request->'service',
  'phoneNumber',p_request->'phoneNumber','numberSource',p_request->'numberSource');
 INSERT INTO public.phone_callback_requests(workspace_id,owner_user_id,request_id,call_id,direction,request_hash,details,
  occurred_at,request_status,notification_status,attempts) VALUES(w,u,key,p_request->>'callId','inbound',p_hash,details,
  (p_request->>'occurredAt')::timestamptz,'requested',p_request->>'notificationStatus',0)
  ON CONFLICT DO NOTHING RETURNING * INTO r;
 IF NOT FOUND THEN
  SELECT * INTO r FROM public.phone_callback_requests WHERE workspace_id=w AND owner_user_id=u AND request_id=key;
  IF NOT FOUND OR r.call_id IS DISTINCT FROM p_request->>'callId' OR r.request_hash IS DISTINCT FROM p_hash
   OR r.details IS DISTINCT FROM details THEN RAISE EXCEPTION 'Inbound callback replay conflict'; END IF;
 ELSE
  INSERT INTO public.audit_events(workspace_id,actor_user_id,action,target_type,target_id,payload)
   VALUES(w,u,'phone.callback.inbound_saved','phone_callback_request',key,
    jsonb_build_object('actorKind','phone_inbound','status',r.notification_status));
 END IF;
 RETURN jsonb_build_object('saved',true,'requestId',key);
END $$;
GRANT CREATE ON SCHEMA public TO thaara_phone_guard;
ALTER FUNCTION public.phone_callback_inbound_save(jsonb,text) OWNER TO thaara_phone_guard;
REVOKE CREATE ON SCHEMA public FROM thaara_phone_guard;
REVOKE ALL ON FUNCTION public.phone_callback_inbound_save(jsonb,text) FROM PUBLIC,thaara_app,thaara_worker;
GRANT EXECUTE ON FUNCTION public.phone_callback_inbound_save(jsonb,text) TO thaara_phone_ingest;

-- Input docs/migrations/115o-phone-callback-outbound.review.sql
-- SHA256 a2e9a9078638d064461a7454637e6bc798fc0269c1ea7d12d472389a2f4a3b19
CREATE TABLE public.phone_callback_dispatch_numbers (
 workspace_id uuid NOT NULL,
 owner_user_id uuid NOT NULL,
 call_id uuid NOT NULL,
 phone_e164 text NOT NULL CHECK(phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
 draft_hash text NOT NULL CHECK(draft_hash ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(workspace_id,owner_user_id,call_id),
 FOREIGN KEY(workspace_id,owner_user_id,call_id) REFERENCES public.phone_calls(workspace_id,owner_user_id,call_id)
);
ALTER TABLE public.phone_callback_dispatch_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_callback_dispatch_numbers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.phone_callback_dispatch_numbers FROM PUBLIC;
GRANT SELECT,INSERT ON public.phone_callback_dispatch_numbers TO thaara_app;
CREATE POLICY phone_callback_dispatch_owner ON public.phone_callback_dispatch_numbers TO thaara_app
 USING((workspace_id,owner_user_id) IN(SELECT s.workspace_id,s.user_id FROM public.current_authenticated_scope() s WHERE s.role='owner'))
 WITH CHECK((workspace_id,owner_user_id) IN(SELECT s.workspace_id,s.user_id FROM public.current_authenticated_scope() s WHERE s.role='owner')
 AND EXISTS(SELECT 1 FROM public.phone_calls c WHERE c.workspace_id=phone_callback_dispatch_numbers.workspace_id
  AND c.owner_user_id=phone_callback_dispatch_numbers.owner_user_id AND c.call_id=phone_callback_dispatch_numbers.call_id
  AND c.mode='live' AND c.dispatch_status='claimed' AND c.state='queued' AND c.draft_hash=phone_callback_dispatch_numbers.draft_hash));
GRANT SELECT ON public.phone_callback_dispatch_numbers TO thaara_phone_callback_guard;
CREATE POLICY phone_callback_dispatch_guard ON public.phone_callback_dispatch_numbers FOR SELECT TO thaara_phone_callback_guard USING(true);
GRANT SELECT,INSERT ON public.phone_callback_requests TO thaara_phone_callback_guard;
CREATE POLICY phone_callback_outbound_guard ON public.phone_callback_requests TO thaara_phone_callback_guard
 USING(direction='outbound') WITH CHECK(direction='outbound');

CREATE FUNCTION public.phone_callback_outbound_context(p_call uuid,p_attempt text,p_provider text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.phone_calls%ROWTYPE;n text;
BEGIN
 SELECT * INTO c FROM public.phone_calls WHERE call_id=p_call FOR UPDATE;
 IF NOT FOUND OR c.mode<>'live' OR c.dispatch_status<>'unverified' OR c.provider_request_id IS DISTINCT FROM p_attempt
  OR (c.provider_call_id IS NOT NULL AND c.provider_call_id IS DISTINCT FROM p_provider)
  OR c.state NOT IN('queued','ringing','answered','completed') THEN RAISE EXCEPTION 'Outbound callback binding denied'; END IF;
 SELECT phone_e164 INTO n FROM public.phone_callback_dispatch_numbers WHERE workspace_id=c.workspace_id
  AND owner_user_id=c.owner_user_id AND call_id=c.call_id AND draft_hash=c.draft_hash;
 RETURN jsonb_build_object('workspaceId',c.workspace_id,'userId',c.owner_user_id,'occurredAt',c.created_at,'verifiedNumber',n,
  'known',jsonb_build_object('name',c.draft->'recipient'->>'displayName'));
END $$;

CREATE FUNCTION public.phone_callback_outbound_save(p_call uuid,p_attempt text,p_provider text,p_request jsonb,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE binding jsonb;r public.phone_callback_requests%ROWTYPE;details jsonb;w uuid;u uuid;key text;field text;
BEGIN
 IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR octet_length(p_request::text)>8192
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_request) k WHERE k NOT IN('workspaceId','userId','id','callId','direction',
   'name','business','service','phoneNumber','numberSource','occurredAt','status','notificationStatus','notificationAttemptId','providerMessageId','attempts')) THEN
  RAISE EXCEPTION 'Outbound callback shape denied';
 END IF;
 FOR field IN SELECT unnest(ARRAY['name','business','service','phoneNumber','numberSource']) LOOP
  IF NOT COALESCE(jsonb_typeof(p_request->field)='null' OR
   (jsonb_typeof(p_request->field)='string' AND length(p_request->>field) BETWEEN 1 AND 240),false) THEN
   RAISE EXCEPTION 'Outbound callback detail denied';
  END IF;
 END LOOP;
 IF (p_request->>'phoneNumber' IS NULL) IS DISTINCT FROM (p_request->>'numberSource' IS NULL)
  OR (p_request->>'phoneNumber' IS NOT NULL AND (p_request->>'phoneNumber' !~ '^\+[1-9][0-9]{7,14}$'
   OR p_request->>'numberSource' NOT IN('call_metadata','caller_confirmed'))) THEN RAISE EXCEPTION 'Outbound callback number denied'; END IF;
 binding:=public.phone_callback_outbound_context(p_call,p_attempt,p_provider);
 w:=(binding->>'workspaceId')::uuid;u:=(binding->>'userId')::uuid;key:=p_request->>'id';
 IF NOT EXISTS(SELECT 1 FROM public.phone_calls c JOIN public.phone_call_events e ON e.workspace_id=c.workspace_id
    AND e.owner_user_id=c.owner_user_id AND e.call_id=c.call_id
   WHERE c.call_id=p_call AND c.state='completed' AND c.report->'conversation' IS NOT NULL
    AND e.event_id='sarvam-'||substring(encode(sha256(convert_to(p_attempt,'UTF8')),'hex'),1,20)||'-report'
    AND e.kind='state' AND e.state='completed')
  OR NOT COALESCE(p_request->>'workspaceId'=w::text AND p_request->>'userId'=u::text AND p_request->>'callId'=p_call::text
   AND p_request->>'direction'='outbound' AND p_request->>'status'='requested'
   AND p_request->>'notificationStatus' IN('pending','needs_review') AND p_request->'attempts'='0'::jsonb
   AND p_request->'notificationAttemptId'='null'::jsonb AND p_request->'providerMessageId'='null'::jsonb
   AND key ~ '^[a-f0-9]{64}$' AND p_hash ~ '^[a-f0-9]{64}$',false)
  OR (p_request->>'occurredAt')::timestamptz IS DISTINCT FROM (binding->>'occurredAt')::timestamptz
  OR (p_request->>'numberSource'='call_metadata' AND p_request->>'phoneNumber' IS DISTINCT FROM binding->>'verifiedNumber') THEN
  RAISE EXCEPTION 'Outbound callback request denied';
 END IF;
 details:=jsonb_build_object('name',p_request->'name','business',p_request->'business','service',p_request->'service',
  'phoneNumber',p_request->'phoneNumber','numberSource',p_request->'numberSource');
 INSERT INTO public.phone_callback_requests(workspace_id,owner_user_id,request_id,call_id,direction,request_hash,details,
  occurred_at,request_status,notification_status,attempts) VALUES(w,u,key,p_call::text,'outbound',p_hash,details,
  (p_request->>'occurredAt')::timestamptz,'requested',p_request->>'notificationStatus',0) ON CONFLICT DO NOTHING RETURNING * INTO r;
 IF NOT FOUND THEN
  SELECT * INTO r FROM public.phone_callback_requests WHERE workspace_id=w AND owner_user_id=u AND request_id=key;
  IF NOT FOUND OR r.request_hash IS DISTINCT FROM p_hash OR r.details IS DISTINCT FROM details OR r.call_id<>p_call::text THEN
   RAISE EXCEPTION 'Outbound callback replay conflict';
  END IF;
 ELSE
  PERFORM set_config('app.workspace_id',w::text,true);
  INSERT INTO public.audit_events(workspace_id,actor_user_id,action,target_type,target_id,payload)
   VALUES(w,NULL,'phone.callback.outbound_saved','phone_callback_request',key,jsonb_build_object('status',r.notification_status));
 END IF;
 RETURN jsonb_build_object('saved',true,'requestId',key);
END $$;
GRANT CREATE ON SCHEMA public TO thaara_phone_callback_guard;
ALTER FUNCTION public.phone_callback_outbound_context(uuid,text,text) OWNER TO thaara_phone_callback_guard;
ALTER FUNCTION public.phone_callback_outbound_save(uuid,text,text,jsonb,text) OWNER TO thaara_phone_callback_guard;
REVOKE CREATE ON SCHEMA public FROM thaara_phone_callback_guard;
REVOKE ALL ON FUNCTION public.phone_callback_outbound_context(uuid,text,text),public.phone_callback_outbound_save(uuid,text,text,jsonb,text) FROM PUBLIC,thaara_worker;
GRANT EXECUTE ON FUNCTION public.phone_callback_outbound_context(uuid,text,text),public.phone_callback_outbound_save(uuid,text,text,jsonb,text) TO thaara_app;

COMMIT;
