-- TARGET-SPECIFIC REVIEW ONLY. NOT AUTHORIZED. No runner, credential provisioning or runtime activation.
-- REVIEW ONLY. Additive standalone journal; never alter111 tables/data or reuse its consumed approval.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF current_setting('thaara.step112_hosted_install_approved',true) IS DISTINCT FROM 'owner-approved-inbound-hosted-install-v1'
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
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('thaara_phone_ingest','thaara_phone_guard'))
  OR to_regclass('public.phone_inbound_principals') IS NOT NULL
  OR to_regprocedure('public.phone_inbound_resolve_grant(text,text,text)') IS NOT NULL
  OR to_regprocedure('public.phone_inbound_scope_matches(uuid,uuid)') IS NOT NULL
  OR to_regprocedure('public.phone_inbound_append_event(jsonb)') IS NOT NULL THEN
  RAISE EXCEPTION 'Inbound hosted install refuses existing service identities or objects';
 END IF;
 IF to_regprocedure('public.current_authenticated_scope()') IS NULL OR to_regclass('public.audit_events') IS NULL THEN
  RAISE EXCEPTION 'Step112 requires base schema';
 END IF;
 IF to_regclass('public.phone_inbound_call_events') IS NOT NULL THEN
  RAISE EXCEPTION 'Step112 journal already exists; never adopt or overwrite';
 END IF;
END $$;
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
COMMIT;
