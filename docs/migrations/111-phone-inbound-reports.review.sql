-- REVIEW ONLY. Not in installed migration chain. No execution authorized by this file.
-- Final inbound reports and saved-request projection. Calendar readback/authenticity MUST be supplied by the
-- admitted backend, not model JSON. This table alone does not prove Calendar verification or provider identity.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_setting('thaara.step111_review_approved',true) IS DISTINCT FROM 'in-memory-only'
  OR current_setting('thaara.step111_target_database',true) IS DISTINCT FROM current_database() THEN
  RAISE EXCEPTION 'Step111 requires reviewed in-memory approval and exact database';
 END IF;
 IF to_regprocedure('public.current_authenticated_scope()') IS NULL OR to_regclass('public.audit_events') IS NULL THEN
  RAISE EXCEPTION 'Step111 requires base schema';
 END IF;
 IF to_regclass('public.phone_inbound_reports') IS NOT NULL THEN
  RAISE EXCEPTION 'Step111 target already exists; never adopt or overwrite';
 END IF;
END $$;
CREATE TABLE public.phone_inbound_reports(
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 owner_user_id uuid NOT NULL REFERENCES public.users(id),
 report_id text NOT NULL CHECK(report_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 event_id text NOT NULL CHECK(event_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 report_hash text NOT NULL CHECK(report_hash ~ '^[a-f0-9]{64}$'),
 occurred_at timestamptz NOT NULL,
 report jsonb NOT NULL CHECK(jsonb_typeof(report)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,owner_user_id,report_id),
 UNIQUE(workspace_id,owner_user_id,event_id),
 CHECK(COALESCE(report->>'id'=report_id AND report->>'workspaceId'=workspace_id::text
  AND report->>'ownerUserId'=owner_user_id::text AND report->>'outcome' IN ('enquired','callback_requested','booked_appointment','needs_review')
  AND report->'providerVerified'='false'::jsonb,false)),
 CHECK(COALESCE(CASE WHEN report->>'outcome'='callback_requested' THEN
  jsonb_typeof(report->'callbackRequestId')='string' AND length(report->>'callbackRequestId') BETWEEN 1 AND 128
  AND report->>'callerPhone' ~ '^\+[1-9][0-9]{7,14}$' AND report->>'callbackConsent'='confirmed'
  ELSE true END,false)),
 CHECK(COALESCE(CASE WHEN report->>'outcome'='booked_appointment' THEN
  report->'appointment'->>'verification'='verified' AND length(report->'appointment'->>'eventId') BETWEEN 1 AND 256
  ELSE report->'appointment' IS NULL OR report->'appointment'='null'::jsonb END,false))
);
CREATE INDEX phone_inbound_reports_history ON public.phone_inbound_reports(workspace_id,owner_user_id,occurred_at DESC,report_id);
ALTER TABLE public.phone_inbound_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_inbound_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY phone_inbound_report_owner ON public.phone_inbound_reports USING(
 (workspace_id,owner_user_id) IN(SELECT s.workspace_id,s.user_id FROM public.current_authenticated_scope() s
  WHERE s.role='owner' AND EXISTS(SELECT 1 FROM public.sessions a WHERE a.token_hash=current_setting('app.session_token_hash',true)
   AND a.workspace_id=s.workspace_id AND a.user_id=s.user_id AND a.revoked_at IS NULL AND a.expires_at>clock_timestamp()))
) WITH CHECK(
 (workspace_id,owner_user_id) IN(SELECT s.workspace_id,s.user_id FROM public.current_authenticated_scope() s
  WHERE s.role='owner' AND EXISTS(SELECT 1 FROM public.sessions a WHERE a.token_hash=current_setting('app.session_token_hash',true)
   AND a.workspace_id=s.workspace_id AND a.user_id=s.user_id AND a.revoked_at IS NULL AND a.expires_at>clock_timestamp()))
);
-- Reset base default privileges; runtime roles cannot update/delete/truncate or grant themselves access.
REVOKE ALL ON public.phone_inbound_reports FROM PUBLIC,thaara_app,thaara_worker;
GRANT SELECT,INSERT ON public.phone_inbound_reports TO thaara_app;
COMMIT;
