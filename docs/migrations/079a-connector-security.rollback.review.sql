-- STEP79A_REVIEW_ONLY: FAIL-CLOSED ACCESS ROLLBACK, NOT DATA DELETION. DO NOT EXECUTE without approval.
-- Before forward COMMIT: PostgreSQL transaction ROLLBACK restores pre-migration state.
-- After forward COMMIT: disable these new entry points; retain all encrypted rows, revisions, profiles and audits.
BEGIN;
DO $rollback_guard$
BEGIN
 IF pg_catalog.current_setting('thaara.step79a_rollback_approved',true) IS DISTINCT FROM 'yes'
    OR pg_catalog.current_setting('thaara.step79a_target_database',true) IS DISTINCT FROM pg_catalog.current_database() THEN
  RAISE EXCEPTION 'Review-only rollback: approval and explicit target database are required';
 END IF;
 IF pg_catalog.obj_description(pg_catalog.to_regclass('public.workspace_connector_connections'),'pg_class')
      IS DISTINCT FROM 'THAARA_STEP79A_REVIEW_ONLY_V1'
    OR pg_catalog.obj_description(pg_catalog.to_regclass('public.workspace_connector_profiles'),'pg_class')
      IS DISTINCT FROM 'THAARA_STEP79A_REVIEW_ONLY_V1' THEN
  RAISE EXCEPTION 'Connector object identity is unsuitable; stop without changing anything';
 END IF;
END;
$rollback_guard$;
REVOKE ALL ON FUNCTION public.read_workspace_connector_connection(text),
 public.commit_workspace_connector_connection(text,bigint,text,text,text,jsonb)
 FROM PUBLIC,thaara_app,thaara_worker,thaara_admin;
REVOKE ALL ON TABLE public.workspace_connector_connections,public.workspace_connector_profiles
 FROM PUBLIC,thaara_app,thaara_worker,thaara_admin;
-- No DROP, DELETE, TRUNCATE, revision decrement, RLS disable, key deletion or audit removal.
-- Return to the prior application build with connector configuration disabled.
-- A later re-enable requires review/approval; never restore old revisions from backup to undo disconnect.
COMMIT;
