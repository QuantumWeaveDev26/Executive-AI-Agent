-- Isolated local review only. Requires reviewed 110c, 114 and 115. No deployed schema changes.
BEGIN;
DO $$ BEGIN
 IF current_setting('thaara.step115_review_approved',true) IS DISTINCT FROM 'in-memory-only'
 OR current_setting('thaara.step115_target_database',true) IS DISTINCT FROM current_database()
 OR to_regprocedure('public.complete_phone_provider_report(uuid,text,text,text,text,jsonb)') IS NULL THEN
  RAISE EXCEPTION 'Step 115 outbound review requires its isolated dependencies';
 END IF;
END $$;
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
REVOKE ALL ON public.phone_callback_dispatch_numbers FROM PUBLIC,thaara_app,thaara_worker;
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
