-- REVIEW ARTIFACT ONLY. NOT an installed migration. Owner approved local/in-memory testing on 29 Oct 2026;
-- applying it to the pilot or any shared/managed database needs a separate explicit approval.
-- Step 110 slice A: tenant- and owner-scoped phone contacts with owner-attested calling consent.
-- Depends on base schema (workspaces, users, sessions, audit_events, current_authenticated_scope()).
-- No provider, call-state, recording or transcript storage. No DELETE: contacts are archived, never erased here.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF current_setting('thaara.step110a_review_approved', true) IS DISTINCT FROM 'yes'
    OR current_setting('thaara.step110a_target_database', true) IS DISTINCT FROM current_database() THEN
    RAISE EXCEPTION 'Step 110a SQL requires explicit approval and target database';
  END IF;
  IF to_regprocedure('public.current_authenticated_scope()') IS NULL OR to_regclass('public.audit_events') IS NULL THEN
    RAISE EXCEPTION 'Step 110a requires the base schema';
  END IF;
  IF to_regclass('public.phone_contacts') IS NOT NULL THEN
    RAISE EXCEPTION 'Phone contact objects already exist; never overwrite or adopt';
  END IF;
END $$;

CREATE TABLE public.phone_contacts (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  owner_user_id uuid NOT NULL REFERENCES public.users(id),
  contact_id text NOT NULL CHECK (contact_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 128 AND display_name = btrim(display_name)
    AND display_name !~ '[[:cntrl:]<>]'),
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (COALESCE(jsonb_typeof(aliases) = 'array' AND jsonb_array_length(aliases) <= 20
    AND NOT jsonb_path_exists(aliases, '$[*] ? (@.type() != "string" || @ == "" || @ like_regex "^.{129}" flag "s" || @ like_regex "[<>]")'), false)),
  -- Domestic Indian mobile numbers only, matching the PhoneCallingService directory contract.
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+91[6-9][0-9]{9}$'),
  -- Owner-attested record that the recipient agreed to receive AI-assisted calls. Approval of a call never creates consent.
  consent_calling_allowed boolean NOT NULL,
  consent_reference text NOT NULL CHECK (consent_reference ~ '^[a-zA-Z0-9_-]{1,128}$'),
  consent_source text NOT NULL CHECK (consent_source IN ('recipient_verbal','recipient_written','recipient_message')),
  consent_recorded_at timestamptz NOT NULL,
  consent_expires_at timestamptz NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, owner_user_id, contact_id),
  CHECK (consent_expires_at > consent_recorded_at AND consent_expires_at <= consent_recorded_at + interval '366 days')
);
-- One active contact per number per owner, so a name can never silently resolve to a second record for the same phone.
CREATE UNIQUE INDEX phone_contacts_active_number ON public.phone_contacts (workspace_id, owner_user_id, phone_e164) WHERE NOT archived;

-- Revision fence: inserts start at 1; every update advances exactly one revision; keys/creation are immutable;
-- archiving is one-way. Changed contacts therefore invalidate any approval bound to the old revision.
CREATE FUNCTION public.guard_phone_contact_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.revision <> 1 OR NEW.archived THEN RAISE EXCEPTION 'Phone contact must start at revision 1 and active'; END IF;
    NEW.created_at := clock_timestamp(); NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.contact_id IS DISTINCT FROM OLD.contact_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.revision IS DISTINCT FROM OLD.revision + 1 OR OLD.archived THEN
    RAISE EXCEPTION 'Phone contact revision fence';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER phone_contacts_revision BEFORE INSERT OR UPDATE ON public.phone_contacts
  FOR EACH ROW EXECUTE FUNCTION public.guard_phone_contact_revision();

-- Session-derived RLS with owner isolation inside a workspace (same shape as the reviewed WhatsApp tables).
ALTER TABLE public.phone_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY phone_contacts_owner_scope ON public.phone_contacts USING (
  (workspace_id, owner_user_id) IN (SELECT s.workspace_id, s.user_id FROM public.current_authenticated_scope() s
  WHERE s.role IN ('owner','admin','member') AND EXISTS (SELECT 1 FROM public.sessions auth
    WHERE auth.token_hash=current_setting('app.session_token_hash',true) AND auth.workspace_id=s.workspace_id AND auth.user_id=s.user_id
    AND auth.revoked_at IS NULL AND auth.expires_at > clock_timestamp()))) WITH CHECK (
  (workspace_id, owner_user_id) IN (SELECT s.workspace_id, s.user_id FROM public.current_authenticated_scope() s
  WHERE s.role IN ('owner','admin','member') AND EXISTS (SELECT 1 FROM public.sessions auth
    WHERE auth.token_hash=current_setting('app.session_token_hash',true) AND auth.workspace_id=s.workspace_id AND auth.user_id=s.user_id
    AND auth.revoked_at IS NULL AND auth.expires_at > clock_timestamp())));
-- Base migrations grant app DML through default privileges. Reset explicitly; no DELETE/TRUNCATE, no worker access.
REVOKE ALL ON public.phone_contacts FROM PUBLIC, thaara_app, thaara_worker;
GRANT SELECT, INSERT, UPDATE ON public.phone_contacts TO thaara_app;
REVOKE ALL ON FUNCTION public.guard_phone_contact_revision() FROM PUBLIC;
COMMIT;
