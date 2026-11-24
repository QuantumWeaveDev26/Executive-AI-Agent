-- REVIEW ARTIFACT ONLY. NOT an installed migration. Owner approved local/in-memory testing on 29 Oct 2026
-- ("Approve slice B"); applying it to the pilot or any shared/managed database needs a separate explicit approval.
-- Step 110 slice B: durable call ledger. One call per approved draft (one-use claim), revision-free state machine,
-- append-only idempotent event log. Requires 110a. Simulation rows only: live/provider rows need a future reviewed change.
-- No recording, audio or provider credential storage.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF current_setting('thaara.step110b_review_approved', true) IS DISTINCT FROM 'yes'
    OR current_setting('thaara.step110b_target_database', true) IS DISTINCT FROM current_database() THEN
    RAISE EXCEPTION 'Step 110b SQL requires explicit approval and target database';
  END IF;
  IF to_regclass('public.phone_contacts') IS NULL OR to_regclass('public.approval_requests') IS NULL THEN
    RAISE EXCEPTION 'Step 110b requires the base schema and Step 110a';
  END IF;
  IF to_regclass('public.phone_calls') IS NOT NULL OR to_regclass('public.phone_call_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Phone call objects already exist; never overwrite or adopt';
  END IF;
END $$;

CREATE TABLE public.phone_calls (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  owner_user_id uuid NOT NULL REFERENCES public.users(id),
  call_id uuid NOT NULL,
  approval_id uuid NOT NULL REFERENCES public.approval_requests(id),
  draft jsonb NOT NULL CHECK (jsonb_typeof(draft) = 'object' AND length(draft::text) <= 16384),
  draft_hash text NOT NULL CHECK (draft_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[a-zA-Z0-9_-]{1,128}$'),
  contact_id text NOT NULL CHECK (contact_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  contact_revision bigint NOT NULL CHECK (contact_revision >= 1),
  mode text NOT NULL CHECK (mode = 'simulation'),
  state text NOT NULL CHECK (state IN ('queued','ringing','answered','completed','failed','cancelled','busy','no_answer')),
  provider_call_id text CHECK (provider_call_id IS NULL),
  report jsonb NOT NULL CHECK (COALESCE(jsonb_typeof(report) = 'object' AND report->'verified' = 'false'::jsonb
    AND report->'simulated' = 'true'::jsonb AND length(report::text) <= 65536, false)),
  event_sequence bigint NOT NULL DEFAULT 0 CHECK (event_sequence BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, owner_user_id, call_id),
  -- One-use claim: an approval can produce at most one call, ever. Idempotency key is likewise single-use.
  UNIQUE (workspace_id, approval_id),
  UNIQUE (workspace_id, owner_user_id, idempotency_key),
  CHECK (draft->>'contactId' = contact_id AND (draft->>'contactRevision')::bigint = contact_revision
    AND draft->>'idempotencyKey' = idempotency_key AND draft->>'mode' = mode)
);
CREATE INDEX phone_calls_recent ON public.phone_calls (workspace_id, owner_user_id, created_at DESC);

CREATE TABLE public.phone_call_events (
  workspace_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  call_id uuid NOT NULL,
  event_id text NOT NULL CHECK (event_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  sequence bigint NOT NULL CHECK (sequence BETWEEN 1 AND 100),
  kind text NOT NULL CHECK (kind IN ('state','recipient_final','interruption')),
  state text CHECK (state IN ('queued','ringing','answered','completed','failed','cancelled','busy','no_answer')),
  text text CHECK (text IS NULL OR length(text) BETWEEN 1 AND 1000),
  event_hash text NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, owner_user_id, call_id, event_id),
  UNIQUE (workspace_id, owner_user_id, call_id, sequence),
  FOREIGN KEY (workspace_id, owner_user_id, call_id) REFERENCES public.phone_calls (workspace_id, owner_user_id, call_id),
  CHECK ((kind = 'state') = (state IS NOT NULL) AND (kind = 'recipient_final') = (text IS NOT NULL))
);

-- Claim guard: the call must bind to the caller's own approved, unexpired phone approval with the exact same draft.
CREATE FUNCTION public.guard_phone_call_claim() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE approval public.approval_requests;
BEGIN
  SELECT a.* INTO approval FROM public.approval_requests a WHERE a.id = NEW.approval_id AND a.workspace_id = NEW.workspace_id;
  IF NOT FOUND OR approval.requester_user_id IS DISTINCT FROM NEW.owner_user_id OR approval.action_name <> 'phone.ai.calls.request'
    OR approval.status <> 'approved' OR approval.expires_at <= clock_timestamp() OR approval.action_params IS DISTINCT FROM NEW.draft THEN
    RAISE EXCEPTION 'Phone call claim requires the exact approved draft';
  END IF;
  IF NEW.state <> 'queued' OR NEW.event_sequence <> 0 THEN RAISE EXCEPTION 'Phone call must start queued'; END IF;
  NEW.created_at := clock_timestamp(); NEW.updated_at := NEW.created_at;
  RETURN NEW;
END $$;
CREATE TRIGGER phone_calls_claim BEFORE INSERT ON public.phone_calls FOR EACH ROW EXECUTE FUNCTION public.guard_phone_call_claim();

-- State fence: identity/draft immutable, sequence advances by exactly one per update, legal transitions only,
-- terminal states final; same-state updates (recipient evidence) only while answered.
CREATE FUNCTION public.guard_phone_call_state() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.call_id IS DISTINCT FROM OLD.call_id OR NEW.approval_id IS DISTINCT FROM OLD.approval_id OR NEW.draft IS DISTINCT FROM OLD.draft
    OR NEW.draft_hash IS DISTINCT FROM OLD.draft_hash OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.contact_id IS DISTINCT FROM OLD.contact_id OR NEW.contact_revision IS DISTINCT FROM OLD.contact_revision
    OR NEW.mode IS DISTINCT FROM OLD.mode OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.event_sequence IS DISTINCT FROM OLD.event_sequence + 1
    OR OLD.state IN ('completed','failed','cancelled','busy','no_answer')
    OR (NEW.state = OLD.state AND OLD.state <> 'answered')
    OR (NEW.state <> OLD.state AND NOT (
      (OLD.state = 'queued' AND NEW.state IN ('ringing','failed','cancelled'))
      OR (OLD.state = 'ringing' AND NEW.state IN ('answered','busy','no_answer','failed','cancelled'))
      OR (OLD.state = 'answered' AND NEW.state IN ('completed','failed','cancelled')))) THEN
    RAISE EXCEPTION 'Phone call state fence';
  END IF;
  -- The update must be accompanied by its event row, written first in the same transaction.
  IF NOT EXISTS (SELECT 1 FROM public.phone_call_events e WHERE e.workspace_id = NEW.workspace_id AND e.owner_user_id = NEW.owner_user_id
    AND e.call_id = NEW.call_id AND e.sequence = NEW.event_sequence AND (e.kind <> 'state' OR e.state = NEW.state)) THEN
    RAISE EXCEPTION 'Phone call state change requires its event';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER phone_calls_state BEFORE UPDATE ON public.phone_calls FOR EACH ROW EXECUTE FUNCTION public.guard_phone_call_state();

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['phone_calls','phone_call_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY phone_owner_scope ON public.%I USING (
      (workspace_id, owner_user_id) IN (SELECT s.workspace_id, s.user_id FROM public.current_authenticated_scope() s
      WHERE s.role IN (''owner'',''admin'',''member'') AND EXISTS (SELECT 1 FROM public.sessions auth
        WHERE auth.token_hash=current_setting(''app.session_token_hash'',true) AND auth.workspace_id=s.workspace_id AND auth.user_id=s.user_id
        AND auth.revoked_at IS NULL AND auth.expires_at > clock_timestamp()))) WITH CHECK (
      (workspace_id, owner_user_id) IN (SELECT s.workspace_id, s.user_id FROM public.current_authenticated_scope() s
      WHERE s.role IN (''owner'',''admin'',''member'') AND EXISTS (SELECT 1 FROM public.sessions auth
        WHERE auth.token_hash=current_setting(''app.session_token_hash'',true) AND auth.workspace_id=s.workspace_id AND auth.user_id=s.user_id
        AND auth.revoked_at IS NULL AND auth.expires_at > clock_timestamp())))', table_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, thaara_app, thaara_worker', table_name);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO thaara_app', table_name);
  END LOOP;
END $$;
-- Calls advance state; events are append-only. No DELETE/TRUNCATE for anyone in the app.
GRANT UPDATE (state, report, event_sequence, updated_at) ON public.phone_calls TO thaara_app;
REVOKE ALL ON FUNCTION public.guard_phone_call_claim() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_phone_call_state() FROM PUBLIC;
COMMIT;
