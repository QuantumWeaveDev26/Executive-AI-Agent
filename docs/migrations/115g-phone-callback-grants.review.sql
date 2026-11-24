-- Local review only, fresh in-memory database. Production installation requires a separate plan and approval.
BEGIN;
DO $$ BEGIN
 IF current_setting('thaara.step115_review_approved',true) IS DISTINCT FROM 'in-memory-only'
 OR current_setting('thaara.step115_target_database',true) IS DISTINCT FROM current_database() THEN
  RAISE EXCEPTION 'Step 115 grant review requires the isolated target';
 END IF;
END $$;
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
REVOKE ALL ON public.phone_callback_notification_grants FROM PUBLIC,thaara_app,thaara_worker;
GRANT SELECT,INSERT ON public.phone_callback_notification_grants TO thaara_app;
GRANT UPDATE(approval_id,approved_params,created_at,expires_at,revoked_at) ON public.phone_callback_notification_grants TO thaara_app;
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
REVOKE ALL ON public.phone_callback_notification_grant_uses FROM PUBLIC,thaara_app,thaara_worker;
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
COMMIT;
