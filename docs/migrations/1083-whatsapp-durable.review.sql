-- REVIEW ARTIFACT ONLY. NOT an installed migration. DO NOT EXECUTE without separate authorization.
-- Depends on existing base schema/current_authenticated_scope()/audit ledger; no Step 79a installation needed.
-- Master-task correction: four domain tables plus a DB-owned transaction/version-bound audit ledger.
-- PostgreSQL runtime/RLS/lock/grant validation is PENDING. No provider execution capability exists here.
BEGIN;
DO $$ BEGIN
  IF current_setting('thaara.step1083_review_approved', true) IS DISTINCT FROM 'yes'
    OR current_setting('thaara.step1083_target_database', true) IS DISTINCT FROM current_database() THEN
    RAISE EXCEPTION 'Review-only WhatsApp SQL requires explicit approval and target database';
  END IF;
  IF to_regclass('public.whatsapp_n8n_connections') IS NOT NULL
    OR to_regclass('public.whatsapp_n8n_audit_proofs') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname='thaara_whatsapp_audit_guard') THEN
    RAISE EXCEPTION 'WhatsApp objects already exist; never overwrite or adopt';
  END IF;
END $$;

CREATE ROLE thaara_whatsapp_audit_guard NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT USAGE, CREATE ON SCHEMA public TO thaara_whatsapp_audit_guard;
GRANT EXECUTE ON FUNCTION public.current_authenticated_scope() TO thaara_whatsapp_audit_guard;
GRANT SELECT (token_hash,workspace_id,user_id,revoked_at,expires_at) ON public.sessions TO thaara_whatsapp_audit_guard;

-- Append-only, no retroactive backfill. Full xid8 avoids timestamp approximations/32-bit wrap assumptions.
-- Deliberately no FK to the connection: its initial audit is issued BEFORE connection INSERT.
CREATE TABLE public.whatsapp_n8n_audit_proofs (
  audit_id uuid PRIMARY KEY REFERENCES public.audit_events(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  owner_user_id uuid NOT NULL REFERENCES public.users(id),
  connection_id text NOT NULL CHECK (connection_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  audit_action text NOT NULL CHECK (audit_action IN ('whatsapp.durable.created','whatsapp.durable.events',
    'whatsapp.durable.reserved','whatsapp.durable.claimed','whatsapp.durable.receipt','whatsapp.durable.unknown','whatsapp.durable.disconnected')),
  transaction_id xid8 NOT NULL,
  write_version bigint NOT NULL CHECK (write_version BETWEEN 1 AND 9007199254740991),
  bound_dispatch_id uuid,
  CHECK ((audit_action IN ('whatsapp.durable.reserved','whatsapp.durable.claimed','whatsapp.durable.receipt','whatsapp.durable.unknown')) = (bound_dispatch_id IS NOT NULL))
);
ALTER TABLE public.whatsapp_n8n_audit_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_n8n_audit_proofs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_n8n_audit_proofs FROM PUBLIC, thaara_app, thaara_worker;
GRANT SELECT ON public.whatsapp_n8n_audit_proofs TO thaara_app;
GRANT INSERT ON public.whatsapp_n8n_audit_proofs TO thaara_whatsapp_audit_guard;
CREATE POLICY whatsapp_proof_read ON public.whatsapp_n8n_audit_proofs FOR SELECT TO thaara_app
  USING ((workspace_id,owner_user_id) IN (SELECT s.workspace_id,s.user_id FROM public.current_authenticated_scope() s
    WHERE s.role IN ('owner','admin','member') AND EXISTS (SELECT 1 FROM public.sessions auth
      WHERE auth.token_hash=current_setting('app.session_token_hash',true) AND auth.workspace_id=s.workspace_id AND auth.user_id=s.user_id
        AND auth.revoked_at IS NULL AND auth.expires_at > clock_timestamp())));
CREATE POLICY whatsapp_proof_issue ON public.whatsapp_n8n_audit_proofs FOR INSERT TO thaara_whatsapp_audit_guard
  WITH CHECK (transaction_id=pg_current_xact_id() AND (workspace_id,owner_user_id) IN
    (SELECT s.workspace_id,s.user_id FROM public.current_authenticated_scope() s WHERE s.role IN ('owner','admin','member')));

CREATE TABLE public.whatsapp_n8n_connections (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  owner_user_id uuid NOT NULL REFERENCES public.users(id),
  connection_id text NOT NULL CHECK (connection_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  binding jsonb NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  disconnected boolean NOT NULL DEFAULT false,
  row_version bigint NOT NULL CHECK (row_version BETWEEN 1 AND 9007199254740991),
  audit_id uuid NOT NULL REFERENCES public.audit_events(id),
  PRIMARY KEY (workspace_id, owner_user_id, connection_id),
  CHECK (COALESCE(binding->>'mode' = 'offline_test'
    AND binding->>'workspaceId' = workspace_id::text AND binding->>'userId' = owner_user_id::text
    AND binding->>'connectionId' = connection_id AND (binding->>'revision')::bigint = revision
    AND jsonb_typeof(binding->'recipients') = 'array'
    AND jsonb_array_length(binding->'recipients') BETWEEN 1 AND 5
    AND binding->>'phoneNumberId' ~ '^[0-9]{6,24}$'
    AND binding->>'businessAccountId' ~ '^[0-9]{6,24}$'
    AND binding->>'graphVersion' ~ '^v[2-9][0-9]\.0$', false)),
  CHECK (binding - ARRAY['mode','workspaceId','userId','connectionId','revision','recipients','phoneNumberId','businessAccountId','graphVersion']::text[] = '{}'::jsonb)
);

CREATE TABLE public.whatsapp_n8n_messages (
  workspace_id uuid NOT NULL, owner_user_id uuid NOT NULL, connection_id text NOT NULL,
  provider_message_id text NOT NULL CHECK (provider_message_id ~ '^wamid\.[a-zA-Z0-9._=+/-]{1,250}$'),
  recipient_id text NOT NULL CHECK (recipient_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  record jsonb NOT NULL, audit_id uuid NOT NULL REFERENCES public.audit_events(id),
  PRIMARY KEY (workspace_id, owner_user_id, connection_id, provider_message_id),
  FOREIGN KEY (workspace_id, owner_user_id, connection_id) REFERENCES public.whatsapp_n8n_connections,
  CHECK (COALESCE(record->>'providerMessageId' = provider_message_id AND record->>'recipientId' = recipient_id
    AND record->>'mode' = 'offline_test' AND record->'untrusted' = 'true'::jsonb
    AND length(record->>'textPreview') <= 4096 AND (record->>'timestamp')::timestamptz IS NOT NULL, false)),
  CHECK (record - ARRAY['providerMessageId','recipientId','senderMaskedPhone','textPreview','timestamp','mode','untrusted']::text[] = '{}'::jsonb)
);

CREATE TABLE public.whatsapp_n8n_dispatches (
  workspace_id uuid NOT NULL, owner_user_id uuid NOT NULL, connection_id text NOT NULL,
  dispatch_id uuid NOT NULL, idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[a-zA-Z0-9_-]{8,128}$'),
  parameter_hash text NOT NULL CHECK (parameter_hash ~ '^[a-f0-9]{64}$'),
  approval_id uuid NOT NULL REFERENCES public.approval_requests(id),
  created_at_ms bigint NOT NULL, expires_at_ms bigint NOT NULL,
  claimed_at_ms bigint,
  provider_message_id text CHECK (provider_message_id ~ '^wamid\.[a-zA-Z0-9._=+/-]{1,250}$'),
  record jsonb NOT NULL, audit_id uuid NOT NULL REFERENCES public.audit_events(id),
  PRIMARY KEY (workspace_id, owner_user_id, connection_id, dispatch_id),
  UNIQUE (workspace_id, owner_user_id, connection_id, idempotency_key),
  UNIQUE (workspace_id, owner_user_id, connection_id, provider_message_id),
  FOREIGN KEY (workspace_id, owner_user_id, connection_id) REFERENCES public.whatsapp_n8n_connections,
  CHECK (created_at_ms > 0 AND expires_at_ms = created_at_ms + 60000),
  CHECK (claimed_at_ms IS NULL OR (claimed_at_ms >= created_at_ms AND claimed_at_ms < expires_at_ms)),
  CHECK (provider_message_id IS NULL OR claimed_at_ms IS NOT NULL),
  CHECK (COALESCE(record->>'id' = dispatch_id::text AND record->>'approvalId' = approval_id::text
    AND record->>'parameterHash' = parameter_hash AND record->'draft'->>'idempotencyKey' = idempotency_key
    AND record->'draft'->>'connectionId' = connection_id
    AND (record->>'createdAt')::bigint = created_at_ms AND (record->>'expiresAt')::bigint = expires_at_ms
    AND record->'receipt'->>'dispatchId' = dispatch_id::text
    AND record->'receipt'->>'transport' = 'n8n' AND record->'receipt'->>'mode' = 'offline_test'
    AND record->'receipt'->'verified' = 'false'::jsonb
    AND record->'receipt'->>'status' IN ('not_configured','unverified','sent','delivered','read','failed'), false)),
  CHECK ((record->>'claimedAt')::bigint IS NOT DISTINCT FROM claimed_at_ms),
  CHECK (record->'receipt'->>'providerMessageId' IS NOT DISTINCT FROM provider_message_id),
  CHECK (record - ARRAY['id','draft','parameterHash','approvalId','createdAt','expiresAt','claimedAt','receipt']::text[] = '{}'::jsonb),
  CHECK ((record->'draft') - ARRAY['connectionId','connectionRevision','senderPhoneNumberId','recipientId','bodyText','idempotencyKey','replyToProviderMessageId']::text[] = '{}'::jsonb),
  CHECK ((record->'receipt') - ARRAY['transport','mode','dispatchId','providerMessageId','status','verified']::text[] = '{}'::jsonb)
);

CREATE TABLE public.whatsapp_n8n_status_events (
  workspace_id uuid NOT NULL, owner_user_id uuid NOT NULL, connection_id text NOT NULL,
  event_key text NOT NULL CHECK (event_key ~ '^[a-f0-9]{64}$'),
  record jsonb NOT NULL, audit_id uuid NOT NULL REFERENCES public.audit_events(id),
  PRIMARY KEY (workspace_id, owner_user_id, connection_id, event_key),
  FOREIGN KEY (workspace_id, owner_user_id, connection_id) REFERENCES public.whatsapp_n8n_connections,
  CHECK (COALESCE(record->>'key' = event_key AND record->>'status' IN ('sent','delivered','read','failed')
    AND record->>'providerMessageId' ~ '^wamid\.[a-zA-Z0-9._=+/-]{1,250}$'
    AND record->>'recipientAddress' ~ '^[1-9][0-9]{7,14}$' AND record->>'timestamp' ~ '^[0-9]{1,12}$', false)),
  CHECK (record - ARRAY['key','providerMessageId','recipientAddress','status','timestamp']::text[] = '{}'::jsonb)
);

-- Session-derived RLS, including owner isolation within a workspace. No authority from GUC tenant IDs.
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['whatsapp_n8n_connections','whatsapp_n8n_messages','whatsapp_n8n_dispatches','whatsapp_n8n_status_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY whatsapp_owner_scope ON public.%I USING (
      (workspace_id, owner_user_id) IN (SELECT s.workspace_id, s.user_id FROM public.current_authenticated_scope() s
      WHERE s.role IN (''owner'',''admin'',''member'') AND EXISTS (SELECT 1 FROM public.sessions auth
        WHERE auth.token_hash=current_setting(''app.session_token_hash'',true) AND auth.workspace_id=s.workspace_id AND auth.user_id=s.user_id
        AND auth.revoked_at IS NULL AND auth.expires_at > clock_timestamp()))) WITH CHECK (
      (workspace_id, owner_user_id) IN (SELECT s.workspace_id, s.user_id FROM public.current_authenticated_scope() s
      WHERE s.role IN (''owner'',''admin'',''member'') AND EXISTS (SELECT 1 FROM public.sessions auth
        WHERE auth.token_hash=current_setting(''app.session_token_hash'',true) AND auth.workspace_id=s.workspace_id AND auth.user_id=s.user_id
        AND auth.revoked_at IS NULL AND auth.expires_at > clock_timestamp())))', table_name);
    -- Base migrations grant app DML through default privileges. Reset those grants explicitly.
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, thaara_app, thaara_worker', table_name);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO thaara_app', table_name);
  END LOOP;
END $$;
GRANT UPDATE ON public.whatsapp_n8n_connections, public.whatsapp_n8n_dispatches TO thaara_app;
-- No DELETE or TRUNCATE grants. Application cannot erase tombstones/idempotency evidence.

GRANT SELECT (workspace_id,owner_user_id,connection_id,row_version,disconnected)
  ON public.whatsapp_n8n_connections TO thaara_whatsapp_audit_guard;

CREATE FUNCTION public.issue_whatsapp_audit_proof() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor record; version_to_write bigint; is_disconnected boolean; dispatch uuid;
BEGIN
  SELECT a.workspace_id,a.user_id,a.role INTO actor FROM public.current_authenticated_scope() a
    JOIN public.sessions s ON s.workspace_id=a.workspace_id AND s.user_id=a.user_id
    WHERE s.token_hash=current_setting('app.session_token_hash',true)
      AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp();
  IF NOT FOUND OR actor.workspace_id IS DISTINCT FROM NEW.workspace_id OR actor.user_id IS DISTINCT FROM NEW.actor_user_id
    OR actor.role NOT IN ('owner','admin','member') OR NEW.target_type IS DISTINCT FROM 'whatsapp_connection'
    OR NOT COALESCE(NEW.target_id ~ '^[a-zA-Z0-9_-]{1,128}$',false)
    OR NEW.action NOT IN ('whatsapp.durable.created','whatsapp.durable.events','whatsapp.durable.reserved',
      'whatsapp.durable.claimed','whatsapp.durable.receipt','whatsapp.durable.unknown','whatsapp.durable.disconnected') THEN
    RAISE EXCEPTION 'WhatsApp audit issuance denied';
  END IF;
  SELECT c.row_version+1,c.disconnected INTO version_to_write,is_disconnected
    FROM public.whatsapp_n8n_connections c
    WHERE c.workspace_id=NEW.workspace_id AND c.owner_user_id=NEW.actor_user_id AND c.connection_id=NEW.target_id;
  IF NEW.action='whatsapp.durable.created' THEN
    IF FOUND THEN RAISE EXCEPTION 'WhatsApp audit creation conflict'; END IF;
    version_to_write := 1;
  ELSE
    IF NOT FOUND OR is_disconnected THEN RAISE EXCEPTION 'WhatsApp audit connection fenced'; END IF;
  END IF;
  IF NEW.action IN ('whatsapp.durable.reserved','whatsapp.durable.claimed','whatsapp.durable.receipt','whatsapp.durable.unknown') THEN
    dispatch := (NEW.payload->>'dispatchId')::uuid;
    IF dispatch IS NULL THEN RAISE EXCEPTION 'WhatsApp audit dispatch binding missing'; END IF;
  END IF;
  INSERT INTO public.whatsapp_n8n_audit_proofs
    (audit_id,workspace_id,owner_user_id,connection_id,audit_action,transaction_id,write_version,bound_dispatch_id)
    VALUES (NEW.id,NEW.workspace_id,NEW.actor_user_id,NEW.target_id,NEW.action,pg_current_xact_id(),version_to_write,dispatch);
  RETURN NEW;
END $$;
ALTER FUNCTION public.issue_whatsapp_audit_proof() OWNER TO thaara_whatsapp_audit_guard;
REVOKE CREATE ON SCHEMA public FROM thaara_whatsapp_audit_guard;
REVOKE ALL ON FUNCTION public.issue_whatsapp_audit_proof() FROM PUBLIC, thaara_app, thaara_worker;
CREATE TRIGGER whatsapp_audit_proof_issuer AFTER INSERT ON public.audit_events
  FOR EACH ROW WHEN (NEW.action LIKE 'whatsapp.durable.%') EXECUTE FUNCTION public.issue_whatsapp_audit_proof();

-- Base app grants permit generic audit UPDATE/DELETE. Protect this connector's evidence narrowly.
CREATE FUNCTION public.reject_whatsapp_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'WhatsApp audit records are immutable';
END $$;
REVOKE ALL ON FUNCTION public.reject_whatsapp_audit_mutation() FROM PUBLIC, thaara_app, thaara_worker;
CREATE TRIGGER whatsapp_audit_update_guard BEFORE UPDATE ON public.audit_events
  FOR EACH ROW WHEN (OLD.action LIKE 'whatsapp.durable.%' OR NEW.action LIKE 'whatsapp.durable.%')
  EXECUTE FUNCTION public.reject_whatsapp_audit_mutation();
CREATE TRIGGER whatsapp_audit_delete_guard BEFORE DELETE ON public.audit_events
  FOR EACH ROW WHEN (OLD.action LIKE 'whatsapp.durable.%') EXECUTE FUNCTION public.reject_whatsapp_audit_mutation();

-- Audit association and irreversible claim/revision transitions are checked independently of the service.
CREATE FUNCTION public.guard_whatsapp_offline_state() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE parent public.whatsapp_n8n_connections; approval public.approval_requests; proof public.whatsapp_n8n_audit_proofs; recipient jsonb; last_message timestamptz;
BEGIN
  SELECT p.* INTO proof FROM public.whatsapp_n8n_audit_proofs p
    WHERE p.audit_id=NEW.audit_id AND p.workspace_id=NEW.workspace_id AND p.owner_user_id=NEW.owner_user_id
      AND p.connection_id=NEW.connection_id AND p.transaction_id=pg_current_xact_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'WhatsApp fresh audit proof missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_events a WHERE a.id = NEW.audit_id
    AND a.workspace_id = NEW.workspace_id AND a.actor_user_id = NEW.owner_user_id
    AND a.action = proof.audit_action AND a.target_type = 'whatsapp_connection' AND a.target_id = NEW.connection_id) THEN
    RAISE EXCEPTION 'WhatsApp audit association denied';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.workspace_id,NEW.owner_user_id,NEW.connection_id) IS DISTINCT FROM (OLD.workspace_id,OLD.owner_user_id,OLD.connection_id)
      OR NEW.audit_id = OLD.audit_id THEN RAISE EXCEPTION 'WhatsApp immutable identity/audit denied'; END IF;
  END IF;
  IF TG_TABLE_NAME = 'whatsapp_n8n_connections' THEN
    IF proof.write_version <> NEW.row_version THEN RAISE EXCEPTION 'WhatsApp audit version replay denied'; END IF;
    IF TG_OP = 'INSERT' THEN
      IF proof.audit_action <> 'whatsapp.durable.created' THEN RAISE EXCEPTION 'WhatsApp creation audit action denied'; END IF;
      IF NEW.revision <> 1 OR NEW.row_version <> 1 OR NEW.disconnected THEN RAISE EXCEPTION 'Invalid initial WhatsApp state'; END IF;
    ELSE
      IF proof.audit_action = 'whatsapp.durable.created'
        OR ((proof.audit_action='whatsapp.durable.disconnected') IS DISTINCT FROM (NOT OLD.disconnected AND NEW.disconnected)) THEN
        RAISE EXCEPTION 'WhatsApp connection audit action denied'; END IF;
      IF NEW.row_version <> OLD.row_version + 1 OR (OLD.disconnected AND NOT NEW.disconnected)
        OR NEW.revision <> OLD.revision + (CASE WHEN NOT OLD.disconnected AND NEW.disconnected THEN 1 ELSE 0 END)
        OR NEW.binding <> jsonb_set(OLD.binding,'{revision}',to_jsonb(NEW.revision)) THEN
        RAISE EXCEPTION 'WhatsApp revision fence denied';
      END IF;
    END IF;
    -- Recipient entries cannot contain secrets or duplicate identity/address mappings.
    FOR recipient IN SELECT value FROM jsonb_array_elements(NEW.binding->'recipients') LOOP
      IF recipient - ARRAY['id','phoneE164','optedIn']::text[] <> '{}'::jsonb
        OR NOT COALESCE(recipient->>'id' ~ '^[a-zA-Z0-9_-]{1,128}$'
        AND recipient->>'phoneE164' ~ '^\+[1-9][0-9]{7,14}$' AND jsonb_typeof(recipient->'optedIn')='boolean',false) THEN
        RAISE EXCEPTION 'Invalid WhatsApp recipient'; END IF;
    END LOOP;
    IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(NEW.binding->'recipients')) <> jsonb_array_length(NEW.binding->'recipients')
      OR (SELECT count(DISTINCT value->>'phoneE164') FROM jsonb_array_elements(NEW.binding->'recipients')) <> jsonb_array_length(NEW.binding->'recipients') THEN
      RAISE EXCEPTION 'Duplicate WhatsApp recipient'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO parent FROM public.whatsapp_n8n_connections
    WHERE workspace_id=NEW.workspace_id AND owner_user_id=NEW.owner_user_id AND connection_id=NEW.connection_id FOR UPDATE;
  IF NOT FOUND OR parent.disconnected THEN RAISE EXCEPTION 'WhatsApp connection fenced'; END IF;
  IF proof.write_version <> parent.row_version OR parent.audit_id IS DISTINCT FROM NEW.audit_id THEN
    RAISE EXCEPTION 'WhatsApp audit batch version or identity denied'; END IF;
  IF TG_TABLE_NAME IN ('whatsapp_n8n_messages','whatsapp_n8n_status_events') AND proof.audit_action <> 'whatsapp.durable.events' THEN
    RAISE EXCEPTION 'WhatsApp event audit action denied'; END IF;
  IF TG_TABLE_NAME = 'whatsapp_n8n_dispatches' THEN
    IF TG_OP = 'INSERT' THEN
      IF proof.audit_action <> 'whatsapp.durable.reserved' OR proof.bound_dispatch_id IS DISTINCT FROM NEW.dispatch_id THEN
        RAISE EXCEPTION 'WhatsApp reservation audit binding denied'; END IF;
    ELSE
      IF OLD.claimed_at_ms IS NULL AND NEW.claimed_at_ms IS NOT NULL THEN
        IF proof.audit_action <> 'whatsapp.durable.claimed' OR proof.bound_dispatch_id IS DISTINCT FROM NEW.dispatch_id THEN
          RAISE EXCEPTION 'WhatsApp claim audit binding denied'; END IF;
      ELSIF proof.audit_action <> 'whatsapp.durable.events' AND
        (proof.audit_action NOT IN ('whatsapp.durable.receipt','whatsapp.durable.unknown') OR proof.bound_dispatch_id IS DISTINCT FROM NEW.dispatch_id) THEN
        RAISE EXCEPTION 'WhatsApp receipt audit binding denied';
      END IF;
    END IF;
    IF TG_OP = 'UPDATE' THEN
      IF (NEW.dispatch_id,NEW.idempotency_key,NEW.parameter_hash,NEW.approval_id,NEW.created_at_ms,NEW.expires_at_ms)
        IS DISTINCT FROM (OLD.dispatch_id,OLD.idempotency_key,OLD.parameter_hash,OLD.approval_id,OLD.created_at_ms,OLD.expires_at_ms)
        OR NEW.record - ARRAY['receipt','claimedAt']::text[] <> OLD.record - ARRAY['receipt','claimedAt']::text[]
        OR (OLD.claimed_at_ms IS NOT NULL AND NEW.claimed_at_ms IS DISTINCT FROM OLD.claimed_at_ms)
        OR (OLD.provider_message_id IS NOT NULL AND NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id) THEN
        RAISE EXCEPTION 'WhatsApp dispatch immutable binding denied'; END IF;
    END IF;
    IF TG_OP = 'INSERT' OR (OLD.claimed_at_ms IS NULL AND NEW.claimed_at_ms IS NOT NULL) THEN
      IF TG_OP = 'INSERT' AND (NEW.claimed_at_ms IS NOT NULL OR NEW.provider_message_id IS NOT NULL) THEN
        RAISE EXCEPTION 'WhatsApp must reserve before claiming'; END IF;
      SELECT * INTO approval FROM public.approval_requests WHERE id=NEW.approval_id AND workspace_id=NEW.workspace_id
        AND requester_user_id=NEW.owner_user_id FOR SHARE;
      IF NOT FOUND OR approval.status <> 'approved' OR approval.expires_at <= clock_timestamp()
        OR approval.action_name <> 'whatsapp.meta.messages.send' OR approval.action_params <> NEW.record->'draft'
        OR (NEW.record->'draft'->>'connectionRevision')::bigint <> parent.revision
        OR NEW.record->'draft'->>'senderPhoneNumberId' <> parent.binding->>'phoneNumberId'
        OR (TG_OP = 'UPDATE' AND floor(extract(epoch FROM clock_timestamp())*1000) >= NEW.expires_at_ms) THEN
        RAISE EXCEPTION 'WhatsApp approval/claim denied'; END IF;
      SELECT value INTO recipient FROM jsonb_array_elements(parent.binding->'recipients')
        WHERE value->>'id'=NEW.record->'draft'->>'recipientId' AND value->'optedIn'='true'::jsonb;
      IF recipient IS NULL THEN RAISE EXCEPTION 'WhatsApp recipient denied'; END IF;
      SELECT max((record->>'timestamp')::timestamptz) INTO last_message FROM public.whatsapp_n8n_messages
        WHERE workspace_id=NEW.workspace_id AND owner_user_id=NEW.owner_user_id AND connection_id=NEW.connection_id AND recipient_id=recipient->>'id';
      IF last_message IS NULL OR last_message > clock_timestamp() OR last_message <= clock_timestamp()-interval '24 hours' THEN
        RAISE EXCEPTION 'WhatsApp messaging window denied'; END IF;
      IF NEW.record->'draft' ? 'replyToProviderMessageId' AND NOT EXISTS (SELECT 1 FROM public.whatsapp_n8n_messages m
        WHERE m.workspace_id=NEW.workspace_id AND m.owner_user_id=NEW.owner_user_id AND m.connection_id=NEW.connection_id
          AND m.recipient_id=recipient->>'id' AND m.provider_message_id=NEW.record->'draft'->>'replyToProviderMessageId') THEN
        RAISE EXCEPTION 'WhatsApp reply binding denied'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_whatsapp_offline_state() FROM PUBLIC;
-- Trigger invocation does not require the caller to have explicit EXECUTE privilege.
CREATE TRIGGER whatsapp_connection_guard BEFORE INSERT OR UPDATE ON public.whatsapp_n8n_connections FOR EACH ROW EXECUTE FUNCTION public.guard_whatsapp_offline_state();
CREATE TRIGGER whatsapp_message_guard BEFORE INSERT ON public.whatsapp_n8n_messages FOR EACH ROW EXECUTE FUNCTION public.guard_whatsapp_offline_state();
CREATE TRIGGER whatsapp_dispatch_guard BEFORE INSERT OR UPDATE ON public.whatsapp_n8n_dispatches FOR EACH ROW EXECUTE FUNCTION public.guard_whatsapp_offline_state();
CREATE TRIGGER whatsapp_status_guard BEFORE INSERT ON public.whatsapp_n8n_status_events FOR EACH ROW EXECUTE FUNCTION public.guard_whatsapp_offline_state();
COMMIT;
