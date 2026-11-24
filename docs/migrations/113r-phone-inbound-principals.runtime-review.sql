-- NEW RUNTIME REVIEW CANDIDATE: not executed or authorized. Original schema file remains unchanged.
-- REVIEW ONLY: NEW SQL, NOT AUTHORIZED FOR EXECUTION. No existing111/112bytes are changed.
-- Candidate permits report-only service writes; no Calendar booking, raw media retention or dialing.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_setting('thaara.step113_runtime_review_approved',true) IS DISTINCT FROM 'isolated-runtime-only'
  OR current_setting('thaara.step113_runtime_target_database',true) IS DISTINCT FROM current_database()
  OR current_database() IS DISTINCT FROM 'thaara_phone113_review'
  OR current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999 THEN
  RAISE EXCEPTION 'Inbound runtime review requires separate approval and exact isolated PostgreSQL16 database';
 END IF;
 IF to_regclass('public.phone_inbound_call_events') IS NULL OR to_regclass('public.memberships') IS NULL THEN
  RAISE EXCEPTION 'Step113 requires reviewed base and112schema';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('thaara_phone_ingest','thaara_phone_guard'))
  OR to_regclass('public.phone_inbound_principals') IS NOT NULL
  OR to_regprocedure('public.phone_inbound_resolve_grant(text,text,text)') IS NOT NULL
  OR to_regprocedure('public.phone_inbound_scope_matches(uuid,uuid)') IS NOT NULL
  OR to_regprocedure('public.phone_inbound_append_event(jsonb)') IS NOT NULL THEN
  RAISE EXCEPTION 'Step113 refuses existing identities or objects';
 END IF;
END $$;
-- No passwords, LOGIN, role membership or deployment is installed here.
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
COMMIT;
