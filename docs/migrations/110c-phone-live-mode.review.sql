-- REVIEW ARTIFACT ONLY. NOT an installed migration. Owner approved local/in-memory testing on 29 Oct 2026
-- ("Approve SDK + live mode"); applying it to the pilot or any shared/managed database needs a separate explicit approval.
-- Step 110 live-mode slice. Requires 110a + 110b. Additive: no existing row is rewritten.
-- 1. phone_calls may hold mode='live' rows (only from an approved live draft; simulation rows unchanged).
-- 2. Dispatch outbox on the call row: pending -> claimed (once) -> unverified | failed | unknown. Never re-sent.
-- 3. Provider callbacks enter ONLY through apply_phone_provider_event(), after the API verified the provider signature.
--    The function re-checks the dispatch binding, ignores stale/illegal transitions, and audits in the same transaction.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF current_setting('thaara.step110c_review_approved', true) IS DISTINCT FROM 'yes'
    OR current_setting('thaara.step110c_target_database', true) IS DISTINCT FROM current_database() THEN
    RAISE EXCEPTION 'Step 110c SQL requires explicit approval and target database';
  END IF;
  IF to_regclass('public.phone_calls') IS NULL OR to_regclass('public.phone_call_events') IS NULL THEN
    RAISE EXCEPTION 'Step 110c requires Step 110a and 110b';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='phone_calls' AND column_name='dispatch_status')
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname='thaara_phone_callback_guard') THEN
    RAISE EXCEPTION 'Step 110c objects already exist; never overwrite or adopt';
  END IF;
END $$;

-- Replace exactly the 110b single-mode, null-provider-id and simulated-only report checks, located by definition.
DO $$ DECLARE c record; found int := 0; BEGIN
  FOR c IN SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='public.phone_calls'::regclass AND contype='c' LOOP
    IF c.def LIKE '%(mode = ''simulation''::text)%' AND c.def NOT LIKE '%draft%'
      OR c.def LIKE '%provider_call_id IS NULL%'
      OR c.def LIKE '%''simulated''::text) = ''true''::jsonb%' THEN
      EXECUTE format('ALTER TABLE public.phone_calls DROP CONSTRAINT %I', c.conname); found := found + 1;
    END IF;
  END LOOP;
  IF found <> 3 THEN RAISE EXCEPTION 'Step 110c expected exactly three 110b checks, found %', found; END IF;
END $$;

ALTER TABLE public.phone_calls
  ADD COLUMN dispatch_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (dispatch_status IN ('not_applicable','pending','claimed','unverified','failed','unknown')),
  ADD COLUMN dispatch_claimed_at timestamptz,
  ADD COLUMN dispatch_code text CHECK (dispatch_code IS NULL OR dispatch_code ~ '^[A-Z0-9_]{1,64}$'),
  -- Provider ids are opaque: Plivo uses UUIDs, Sarvam uses its own attempt/interaction ids.
  ADD COLUMN provider_request_id text CHECK (provider_request_id IS NULL OR provider_request_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  -- How recipient evidence was obtained: our own speech-to-text (verbatim) or the provider's English rendering.
  ADD COLUMN transcript_source text CHECK (transcript_source IS NULL OR transcript_source IN ('verbatim','provider_english')),
  ADD CONSTRAINT phone_calls_mode_110c CHECK (mode IN ('simulation','live')),
  ADD CONSTRAINT phone_calls_dispatch_110c CHECK ((mode = 'simulation') = (dispatch_status = 'not_applicable')
    AND (provider_request_id IS NULL OR (mode = 'live' AND dispatch_status IN ('unverified')))
    AND ((dispatch_claimed_at IS NULL) = (dispatch_status IN ('not_applicable','pending')))),
  ADD CONSTRAINT phone_calls_provider_id_110c CHECK (provider_call_id IS NULL
    OR (mode = 'live' AND provider_call_id ~ '^([A-Za-z0-9_.:-]{1,128}|[0-9]{8}/[A-Za-z0-9][A-Za-z0-9_.:-]{0,99})$')),
  ADD CONSTRAINT phone_calls_report_110c CHECK (COALESCE(jsonb_typeof(report) = 'object' AND report->'verified' = 'false'::jsonb
    AND report->'simulated' = to_jsonb(mode = 'simulation') AND length(report::text) <= 65536, false));

-- Live rows must start in the outbox; simulation rows never enter it.
CREATE OR REPLACE FUNCTION public.guard_phone_call_claim() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE approval public.approval_requests;
BEGIN
  SELECT a.* INTO approval FROM public.approval_requests a WHERE a.id = NEW.approval_id AND a.workspace_id = NEW.workspace_id;
  IF NOT FOUND OR approval.requester_user_id IS DISTINCT FROM NEW.owner_user_id OR approval.action_name <> 'phone.ai.calls.request'
    OR approval.status <> 'approved' OR approval.expires_at <= clock_timestamp() OR approval.action_params IS DISTINCT FROM NEW.draft THEN
    RAISE EXCEPTION 'Phone call claim requires the exact approved draft';
  END IF;
  IF NEW.state <> 'queued' OR NEW.event_sequence <> 0 OR NEW.provider_call_id IS NOT NULL OR NEW.provider_request_id IS NOT NULL
    -- Parenthesised: inside a PL/pgSQL IF, a bare CASE ... THEN would end the condition early.
    OR NEW.dispatch_status IS DISTINCT FROM (CASE NEW.mode WHEN 'live' THEN 'pending' ELSE 'not_applicable' END) THEN
    RAISE EXCEPTION 'Phone call must start queued';
  END IF;
  NEW.created_at := clock_timestamp(); NEW.updated_at := NEW.created_at;
  RETURN NEW;
END $$;

-- Two update kinds: a dispatch step (outbox fields only) or a conversation step (state/report/sequence + event row).
CREATE OR REPLACE FUNCTION public.guard_phone_call_state() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE dispatch_step boolean;
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.call_id IS DISTINCT FROM OLD.call_id OR NEW.approval_id IS DISTINCT FROM OLD.approval_id OR NEW.draft IS DISTINCT FROM OLD.draft
    OR NEW.draft_hash IS DISTINCT FROM OLD.draft_hash OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.contact_id IS DISTINCT FROM OLD.contact_id OR NEW.contact_revision IS DISTINCT FROM OLD.contact_revision
    OR NEW.mode IS DISTINCT FROM OLD.mode OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.provider_call_id IS NOT NULL AND NEW.provider_call_id IS DISTINCT FROM OLD.provider_call_id) THEN
    RAISE EXCEPTION 'Phone call state fence';
  END IF;
  dispatch_step := NEW.dispatch_status IS DISTINCT FROM OLD.dispatch_status;
  IF dispatch_step THEN
    IF NEW.state IS DISTINCT FROM OLD.state OR NEW.report IS DISTINCT FROM OLD.report OR NEW.event_sequence IS DISTINCT FROM OLD.event_sequence
      OR NEW.provider_call_id IS DISTINCT FROM OLD.provider_call_id OR OLD.state <> 'queued'
      OR NOT ((OLD.dispatch_status = 'pending' AND NEW.dispatch_status = 'claimed' AND NEW.provider_request_id IS NULL AND NEW.dispatch_code IS NULL)
        OR (OLD.dispatch_status = 'claimed' AND NEW.dispatch_status = 'unverified' AND NEW.provider_request_id IS NOT NULL AND NEW.dispatch_code IS NULL)
        OR (OLD.dispatch_status = 'claimed' AND NEW.dispatch_status IN ('failed','unknown') AND NEW.provider_request_id IS NULL AND NEW.dispatch_code IS NOT NULL))
      OR (OLD.dispatch_status <> 'pending' AND NEW.dispatch_claimed_at IS DISTINCT FROM OLD.dispatch_claimed_at) THEN
      RAISE EXCEPTION 'Phone call dispatch fence';
    END IF;
    IF OLD.dispatch_status = 'pending' THEN NEW.dispatch_claimed_at := clock_timestamp(); END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
  END IF;
  IF NEW.provider_request_id IS DISTINCT FROM OLD.provider_request_id OR NEW.dispatch_code IS DISTINCT FROM OLD.dispatch_code
    OR NEW.dispatch_claimed_at IS DISTINCT FROM OLD.dispatch_claimed_at
    OR NEW.event_sequence IS DISTINCT FROM OLD.event_sequence + 1
    OR OLD.state IN ('completed','failed','cancelled','busy','no_answer')
    OR (NEW.state = OLD.state AND OLD.state <> 'answered')
    OR (NEW.state <> OLD.state AND NOT (
      (OLD.state = 'queued' AND NEW.state IN ('ringing','failed','cancelled'))
      OR (OLD.state = 'ringing' AND NEW.state IN ('answered','busy','no_answer','failed','cancelled'))
      OR (OLD.state = 'answered' AND NEW.state IN ('completed','failed','cancelled'))))
    -- A live call only rings after the provider acknowledged it; a dispatch failure may still close it as failed.
    OR (OLD.mode = 'live' AND NEW.state NOT IN ('failed','cancelled') AND OLD.dispatch_status <> 'unverified')
    OR (NEW.provider_call_id IS DISTINCT FROM OLD.provider_call_id AND OLD.mode <> 'live') THEN
    RAISE EXCEPTION 'Phone call state fence';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.phone_call_events e WHERE e.workspace_id = NEW.workspace_id AND e.owner_user_id = NEW.owner_user_id
    AND e.call_id = NEW.call_id AND e.sequence = NEW.event_sequence AND (e.kind <> 'state' OR e.state = NEW.state)) THEN
    RAISE EXCEPTION 'Phone call state change requires its event';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;

GRANT UPDATE (dispatch_status, dispatch_code, provider_request_id, dispatch_claimed_at) ON public.phone_calls TO thaara_app;

-- Provider callback entry point. Owned by a dedicated NOLOGIN role whose only table access is through this function.
CREATE ROLE thaara_phone_callback_guard NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT USAGE ON SCHEMA public TO thaara_phone_callback_guard;
GRANT SELECT, UPDATE (state, report, event_sequence, provider_call_id, transcript_source, updated_at) ON public.phone_calls TO thaara_phone_callback_guard;
GRANT SELECT, INSERT ON public.phone_call_events TO thaara_phone_callback_guard;
GRANT INSERT ON public.audit_events TO thaara_phone_callback_guard;
-- 110b owner-scope policies apply to PUBLIC; narrow them to the app role so the guard is governed only by its own policies.
ALTER POLICY phone_owner_scope ON public.phone_calls TO thaara_app;
ALTER POLICY phone_owner_scope ON public.phone_call_events TO thaara_app;
CREATE POLICY phone_callback_guard_calls ON public.phone_calls TO thaara_phone_callback_guard USING (mode = 'live') WITH CHECK (mode = 'live');
CREATE POLICY phone_callback_guard_events ON public.phone_call_events TO thaara_phone_callback_guard USING (true) WITH CHECK (true);

CREATE FUNCTION public.apply_phone_provider_event(p_call_id uuid, p_provider_request_id text, p_provider_call_id text, p_state text, p_event_id text, p_event_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c public.phone_calls; prior text; legal boolean; v_report jsonb; v_text text;
BEGIN
  IF p_provider_call_id !~ '^([A-Za-z0-9_.:-]{1,128}|[0-9]{8}/[A-Za-z0-9][A-Za-z0-9_.:-]{0,99})$' OR p_event_id !~ '^[a-zA-Z0-9_-]{1,128}$'
    OR p_event_hash !~ '^[a-f0-9]{64}$' OR p_state NOT IN ('ringing','answered','completed','failed','cancelled','busy','no_answer') THEN
    RAISE EXCEPTION 'Phone provider event input denied';
  END IF;
  SELECT * INTO c FROM public.phone_calls WHERE call_id = p_call_id FOR UPDATE;
  IF NOT FOUND OR c.mode <> 'live' OR c.dispatch_status <> 'unverified' OR c.provider_request_id IS DISTINCT FROM p_provider_request_id
    OR (c.provider_call_id IS NOT NULL AND c.provider_call_id <> p_provider_call_id) THEN
    RAISE EXCEPTION 'Phone provider event binding denied';
  END IF;
  SELECT event_hash INTO prior FROM public.phone_call_events WHERE workspace_id = c.workspace_id AND owner_user_id = c.owner_user_id AND call_id = c.call_id AND event_id = p_event_id;
  IF FOUND THEN
    IF prior <> p_event_hash THEN RAISE EXCEPTION 'Phone provider event conflict'; END IF;
    RETURN 'duplicate';
  END IF;
  legal := c.state NOT IN ('completed','failed','cancelled','busy','no_answer') AND c.event_sequence < 100 AND (
    (c.state = 'queued' AND p_state IN ('ringing','failed','cancelled'))
    OR (c.state = 'ringing' AND p_state IN ('answered','busy','no_answer','failed','cancelled'))
    OR (c.state = 'answered' AND p_state IN ('completed','failed','cancelled')));
  -- Late or out-of-order provider reports are acknowledged but never move the call backwards.
  IF NOT legal THEN RETURN 'ignored'; END IF;
  -- Keep any recipient evidence already recorded; only the state wording changes.
  IF jsonb_array_length(COALESCE(c.report->'quotedResponses', '[]'::jsonb)) > 0 THEN
    v_text := format('Live call. Call state: %s. ', p_state) || CASE WHEN c.transcript_source = 'provider_english'
      THEN 'Recipient''s words as rendered in English by the call provider (untrusted; may be translated, not exact words): '
      ELSE 'Recipient''s final words (untrusted quotes): ' END
      || (SELECT string_agg(to_jsonb(q)::text, '; ') FROM jsonb_array_elements_text(c.report->'quotedResponses') q) || '. No agreement or attendance is inferred.';
  ELSE
    v_text := format('Live call. Call state: %s. No conversation outcome is recorded here.', p_state);
  END IF;
  v_report := jsonb_build_object('text', v_text, 'spokenText', v_text,
    'quotedResponses', COALESCE(c.report->'quotedResponses', '[]'::jsonb), 'evidenceIds', COALESCE(c.report->'evidenceIds', '[]'::jsonb), 'verified', false, 'simulated', false);
  INSERT INTO public.phone_call_events (workspace_id, owner_user_id, call_id, event_id, sequence, kind, state, text, event_hash)
    VALUES (c.workspace_id, c.owner_user_id, c.call_id, p_event_id, c.event_sequence + 1, 'state', p_state, NULL, p_event_hash);
  UPDATE public.phone_calls SET state = p_state, report = v_report, event_sequence = c.event_sequence + 1, provider_call_id = p_provider_call_id
    WHERE workspace_id = c.workspace_id AND owner_user_id = c.owner_user_id AND call_id = c.call_id;
  PERFORM set_config('app.workspace_id', c.workspace_id::text, true);
  INSERT INTO public.audit_events (workspace_id, actor_user_id, action, target_type, target_id, payload, created_at)
    VALUES (c.workspace_id, NULL, 'phone.ai.provider_event', 'phone_call', c.call_id::text,
      jsonb_build_object('callId', c.call_id, 'eventId', p_event_id, 'state', p_state, 'actorKind', 'phone_provider'), clock_timestamp());
  RETURN 'applied';
END $$;
ALTER FUNCTION public.apply_phone_provider_event(uuid, text, text, text, text, text) OWNER TO thaara_phone_callback_guard;
REVOKE ALL ON FUNCTION public.apply_phone_provider_event(uuid, text, text, text, text, text) FROM PUBLIC;
-- The API calls this only after the provider signature, pinned URL and nonce checks passed.
GRANT EXECUTE ON FUNCTION public.apply_phone_provider_event(uuid, text, text, text, text, text) TO thaara_app;

-- Read-only binding lookup for callback admission and the answer response: only dispatched live calls, only the fields
-- needed to check the callback and to speak the approved AI disclosure and question. No phone number, contact or owner data.
CREATE FUNCTION public.phone_provider_binding(p_call_id uuid)
RETURNS TABLE (provider_request_id text, provider_call_id text, language text, ai_disclosure text, purpose text, max_duration_seconds int, state text, on_behalf_of text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT c.provider_request_id, c.provider_call_id, c.draft->>'language', c.draft->>'aiDisclosure', c.draft->>'purpose',
    (c.draft->>'maxDurationSeconds')::int, c.state, c.draft->>'onBehalfOf'
  FROM public.phone_calls c WHERE c.call_id = p_call_id AND c.mode = 'live' AND c.dispatch_status = 'unverified'
$$;
ALTER FUNCTION public.phone_provider_binding(uuid) OWNER TO thaara_phone_callback_guard;
REVOKE ALL ON FUNCTION public.phone_provider_binding(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phone_provider_binding(uuid) TO thaara_app;

-- Conversation evidence from the live stream: the recipient's FINAL words only, while the call is answered, bound to the
-- provider call id. Report = quoted words, never an interpretation. Idempotent per event id; conflicting replays fail.
CREATE FUNCTION public.append_phone_provider_transcript(p_call_id uuid, p_provider_call_id text, p_event_id text, p_text text, p_event_hash text, p_source text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c public.phone_calls; prior text; quotes jsonb; ids jsonb; v_report jsonb; v_text text;
BEGIN
  IF p_event_id !~ '^[a-zA-Z0-9_-]{1,128}$' OR p_event_hash !~ '^[a-f0-9]{64}$' OR p_text IS NULL OR length(btrim(p_text)) = 0 OR length(p_text) > 1000
    OR p_source IS NULL OR p_source NOT IN ('verbatim','provider_english') THEN
    RAISE EXCEPTION 'Phone transcript input denied';
  END IF;
  SELECT * INTO c FROM public.phone_calls WHERE call_id = p_call_id FOR UPDATE;
  IF NOT FOUND OR c.mode <> 'live' OR c.dispatch_status <> 'unverified' OR c.provider_call_id IS DISTINCT FROM p_provider_call_id
    OR (c.transcript_source IS NOT NULL AND c.transcript_source <> p_source) THEN
    RAISE EXCEPTION 'Phone transcript binding denied';
  END IF;
  SELECT event_hash INTO prior FROM public.phone_call_events WHERE workspace_id = c.workspace_id AND owner_user_id = c.owner_user_id AND call_id = c.call_id AND event_id = p_event_id;
  IF FOUND THEN
    IF prior <> p_event_hash THEN RAISE EXCEPTION 'Phone transcript conflict'; END IF;
    RETURN 'duplicate';
  END IF;
  quotes := COALESCE(c.report->'quotedResponses', '[]'::jsonb);
  ids := COALESCE(c.report->'evidenceIds', '[]'::jsonb);
  IF c.state <> 'answered' OR jsonb_array_length(quotes) >= 12 OR c.event_sequence >= 100 THEN RETURN 'ignored'; END IF;
  quotes := quotes || to_jsonb(p_text);
  ids := ids || to_jsonb(p_event_id);
  v_text := 'Live call. Call state: answered. ' || CASE WHEN p_source = 'provider_english'
    THEN 'Recipient''s words as rendered in English by the call provider (untrusted; may be translated, not exact words): '
    ELSE 'Recipient''s final words (untrusted quotes): ' END
    || (SELECT string_agg(to_jsonb(q)::text, '; ') FROM jsonb_array_elements_text(quotes) q) || '. No agreement or attendance is inferred.';
  v_report := jsonb_build_object('text', v_text, 'spokenText', v_text, 'quotedResponses', quotes, 'evidenceIds', ids, 'verified', false, 'simulated', false);
  INSERT INTO public.phone_call_events (workspace_id, owner_user_id, call_id, event_id, sequence, kind, state, text, event_hash)
    VALUES (c.workspace_id, c.owner_user_id, c.call_id, p_event_id, c.event_sequence + 1, 'recipient_final', NULL, p_text, p_event_hash);
  UPDATE public.phone_calls SET report = v_report, event_sequence = c.event_sequence + 1, transcript_source = p_source
    WHERE workspace_id = c.workspace_id AND owner_user_id = c.owner_user_id AND call_id = c.call_id;
  PERFORM set_config('app.workspace_id', c.workspace_id::text, true);
  -- Audit records that evidence arrived, never the words themselves.
  INSERT INTO public.audit_events (workspace_id, actor_user_id, action, target_type, target_id, payload, created_at)
    VALUES (c.workspace_id, NULL, 'phone.ai.provider_transcript', 'phone_call', c.call_id::text,
      jsonb_build_object('callId', c.call_id, 'eventId', p_event_id, 'actorKind', 'phone_provider'), clock_timestamp());
  RETURN 'applied';
END $$;
ALTER FUNCTION public.append_phone_provider_transcript(uuid, text, text, text, text, text) OWNER TO thaara_phone_callback_guard;
REVOKE ALL ON FUNCTION public.append_phone_provider_transcript(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_phone_provider_transcript(uuid, text, text, text, text, text) TO thaara_app;
COMMIT;
