-- Fresh in-memory integration review only. Requires the reviewed 112, 113 and 115 schemas.
BEGIN;
DO $$ BEGIN
 IF current_setting('thaara.step115_review_approved',true) IS DISTINCT FROM 'in-memory-only'
 OR current_setting('thaara.step115_target_database',true) IS DISTINCT FROM current_database()
 OR to_regprocedure('public.phone_inbound_scope_matches(uuid,uuid)') IS NULL THEN
  RAISE EXCEPTION 'Step 115 inbound integration requires the isolated principal schema';
 END IF;
END $$;
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
COMMIT;
