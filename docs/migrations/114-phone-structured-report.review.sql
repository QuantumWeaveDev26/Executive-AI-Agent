-- REVIEW ONLY. New SQL, NOT covered by earlier fixture/migration approvals.
-- Requires separate independent review and isolated runtime validation before any installation.
-- Existing 110a/110b/110c and 112h/113h source files remain unchanged.
BEGIN;
DO $$
BEGIN
  IF current_setting('thaara.enable_phone_structured_report_114', true) IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Phone structured report 114 requires separate explicit approval';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='thaara_phone_callback_guard'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolinherit)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.phone_calls'::regclass AND relrowsecurity AND relforcerowsecurity)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.phone_call_events'::regclass AND relrowsecurity AND relforcerowsecurity)
    OR to_regprocedure('public.apply_phone_provider_event(uuid,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Phone structured report 114 prerequisites denied';
  END IF;
END $$;

-- Called ONLY after the API admits the existing per-call capability and exact dispatch binding.
-- The DB independently binds the dispatch again and saves evidence + completion atomically.
-- It does not repair terminal calls, create contacts, grant dialing or book Calendar events.
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
COMMIT;
