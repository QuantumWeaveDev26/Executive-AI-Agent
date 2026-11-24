-- Isolated local review only. No login, password, deployment or production installation.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_setting('thaara.step115_review_approved',true) IS DISTINCT FROM 'in-memory-only'
 OR current_setting('thaara.step115_target_database',true) IS DISTINCT FROM current_database() THEN
  RAISE EXCEPTION 'Step 115 worker review requires the isolated target';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('thaara_phone_notify','thaara_phone_notify_guard')) THEN
  RAISE EXCEPTION 'Worker review refuses existing identities';
 END IF;
END $$;
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
COMMIT;
