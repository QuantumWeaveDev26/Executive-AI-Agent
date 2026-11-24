-- REVIEW/ISOLATED TEST ARTIFACT ONLY. NOT INSTALLED. NEVER AUTOMATICALLY DISCOVERED.
-- Requires the unchanged1083 artifact SHA2564ad4e53f5d1c30b6a2806728359b79ab47695399c79db354bcac1d479d18228e.
-- No LIVE mode, principal provisioning endpoint, token generation, workflow activation or messages.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'thaara_step1085_test'
    OR current_setting('thaara.step1085_review_approved',true) IS DISTINCT FROM 'yes'
    OR current_setting('thaara.step1085_base_sha',true) IS DISTINCT FROM '4ad4e53f5d1c30b6a2806728359b79ab47695399c79db354bcac1d479d18228e'
    OR to_regclass('public.whatsapp_n8n_audit_proofs') IS NULL
    OR to_regclass('public.whatsapp_n8n_relay_principals') IS NOT NULL THEN
    RAISE EXCEPTION 'Callback SQL requires approved fresh isolated target and exact base';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='thaara_whatsapp_audit_guard'
    AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication)
    OR pg_has_role('thaara_app','thaara_whatsapp_audit_guard','MEMBER') THEN
    RAISE EXCEPTION 'WhatsApp guard role is not isolated';
  END IF;
END $$;

CREATE TABLE public.whatsapp_n8n_relay_principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL, owner_user_id uuid NOT NULL, connection_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  allowed_operations text[] NOT NULL CHECK (cardinality(allowed_operations) BETWEEN 1 AND 3
    AND allowed_operations <@ ARRAY['events','claim','receipts']::text[] AND array_position(allowed_operations,NULL) IS NULL),
  mode text NOT NULL DEFAULT 'offline_test' CHECK (mode='offline_test'),
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY (workspace_id,owner_user_id,connection_id) REFERENCES public.whatsapp_n8n_connections,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days')
);
ALTER TABLE public.whatsapp_n8n_relay_principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_n8n_relay_principals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_n8n_relay_principals FROM PUBLIC,thaara_app,thaara_worker;
GRANT SELECT ON public.whatsapp_n8n_relay_principals TO thaara_whatsapp_audit_guard;
CREATE POLICY whatsapp_principal_guard_read ON public.whatsapp_n8n_relay_principals FOR SELECT TO thaara_whatsapp_audit_guard USING(true);
-- Guard is NOLOGIN/NOBYPASSRLS/non-assumable. Its static definer functions need only these columns.
GRANT SELECT (workspace_id,user_id,role) ON public.memberships TO thaara_whatsapp_audit_guard;
GRANT SELECT (revision) ON public.whatsapp_n8n_connections TO thaara_whatsapp_audit_guard;
CREATE POLICY whatsapp_membership_guard_read ON public.memberships FOR SELECT TO thaara_whatsapp_audit_guard USING(true);
CREATE POLICY whatsapp_connection_guard_read ON public.whatsapp_n8n_connections FOR SELECT TO thaara_whatsapp_audit_guard USING(true);
GRANT USAGE,CREATE ON SCHEMA public TO thaara_whatsapp_audit_guard;

CREATE FUNCTION public.current_whatsapp_runtime_scope()
RETURNS TABLE(workspace_id uuid,user_id uuid,role text,principal_id uuid,connection_id text,revision bigint,relay_operation text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE token text:=NULLIF(current_setting('app.whatsapp_relay_token_hash',true),'');
  connection text:=current_setting('app.whatsapp_relay_connection',true);
  operation text:=current_setting('app.whatsapp_relay_operation',true);
BEGIN
  IF token IS NULL THEN
    RETURN QUERY SELECT a.workspace_id,a.user_id,a.role,NULL::uuid,NULL::text,NULL::bigint,NULL::text
      FROM public.current_authenticated_scope() a JOIN public.sessions s ON s.workspace_id=a.workspace_id AND s.user_id=a.user_id
      WHERE s.token_hash=current_setting('app.session_token_hash',true) AND s.revoked_at IS NULL
        AND s.expires_at > clock_timestamp() AND a.role IN ('owner','admin','member');
    RETURN;
  END IF;
  IF NULLIF(current_setting('app.session_token_hash',true),'') IS NOT NULL
    OR token !~ '^[a-f0-9]{64}$' OR NOT COALESCE(connection ~ '^[a-zA-Z0-9_-]{1,128}$',false)
    OR NOT COALESCE(operation IN ('events','claim','receipts'),false) THEN RETURN; END IF;
  RETURN QUERY SELECT p.workspace_id,p.owner_user_id,m.role,p.id,p.connection_id,p.revision,operation
    FROM public.whatsapp_n8n_relay_principals p
    JOIN public.memberships m ON m.workspace_id=p.workspace_id AND m.user_id=p.owner_user_id
    JOIN public.whatsapp_n8n_connections c ON c.workspace_id=p.workspace_id AND c.owner_user_id=p.owner_user_id AND c.connection_id=p.connection_id
    WHERE p.token_hash=token AND p.connection_id=connection AND p.enabled AND p.revoked_at IS NULL
      AND p.mode='offline_test' AND p.expires_at > clock_timestamp() AND operation=ANY(p.allowed_operations)
      AND m.role IN ('owner','admin','member') AND NOT c.disconnected AND c.revision=p.revision;
END $$;
ALTER FUNCTION public.current_whatsapp_runtime_scope() OWNER TO thaara_whatsapp_audit_guard;
REVOKE ALL ON FUNCTION public.current_whatsapp_runtime_scope() FROM PUBLIC,thaara_app,thaara_worker;
GRANT EXECUTE ON FUNCTION public.current_whatsapp_runtime_scope() TO thaara_app;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['whatsapp_n8n_connections','whatsapp_n8n_messages','whatsapp_n8n_dispatches','whatsapp_n8n_status_events'] LOOP
    EXECUTE format('CREATE POLICY whatsapp_callback_scope ON public.%I TO thaara_app USING (
      (workspace_id,owner_user_id,connection_id) IN (SELECT a.workspace_id,a.user_id,a.connection_id
        FROM public.current_whatsapp_runtime_scope() a WHERE a.principal_id IS NOT NULL)) WITH CHECK (
      (workspace_id,owner_user_id,connection_id) IN (SELECT a.workspace_id,a.user_id,a.connection_id
        FROM public.current_whatsapp_runtime_scope() a WHERE a.principal_id IS NOT NULL))',table_name);
  END LOOP;
END $$;
CREATE POLICY whatsapp_callback_proof_read ON public.whatsapp_n8n_audit_proofs FOR SELECT TO thaara_app USING (
  (workspace_id,owner_user_id,connection_id) IN (SELECT a.workspace_id,a.user_id,a.connection_id FROM public.current_whatsapp_runtime_scope() a WHERE a.principal_id IS NOT NULL));
CREATE POLICY whatsapp_callback_proof_issue ON public.whatsapp_n8n_audit_proofs FOR INSERT TO thaara_whatsapp_audit_guard WITH CHECK (
  transaction_id=pg_current_xact_id() AND EXISTS (SELECT 1 FROM public.current_whatsapp_runtime_scope() a
    WHERE a.principal_id IS NOT NULL AND a.workspace_id=whatsapp_n8n_audit_proofs.workspace_id AND a.user_id=whatsapp_n8n_audit_proofs.owner_user_id AND a.connection_id=whatsapp_n8n_audit_proofs.connection_id
      AND audit_action=CASE a.relay_operation WHEN 'events' THEN 'whatsapp.durable.events' WHEN 'claim' THEN 'whatsapp.durable.claimed' WHEN 'receipts' THEN 'whatsapp.durable.receipt' END));
CREATE POLICY whatsapp_callback_audit_read ON public.audit_events FOR SELECT TO thaara_app USING (
  target_type='whatsapp_connection' AND action LIKE 'whatsapp.durable.%' AND EXISTS (SELECT 1 FROM public.current_whatsapp_runtime_scope() a
    WHERE a.principal_id IS NOT NULL AND a.workspace_id=audit_events.workspace_id AND a.user_id=audit_events.actor_user_id AND a.connection_id=audit_events.target_id));
CREATE POLICY whatsapp_callback_audit_insert ON public.audit_events FOR INSERT TO thaara_app WITH CHECK (
  target_type='whatsapp_connection' AND EXISTS (SELECT 1 FROM public.current_whatsapp_runtime_scope() a
    WHERE a.principal_id IS NOT NULL AND a.workspace_id=audit_events.workspace_id AND a.user_id=audit_events.actor_user_id AND a.connection_id=audit_events.target_id
      AND action=CASE a.relay_operation WHEN 'events' THEN 'whatsapp.durable.events' WHEN 'claim' THEN 'whatsapp.durable.claimed' WHEN 'receipts' THEN 'whatsapp.durable.receipt' END
      AND payload->>'actorKind'='whatsapp_relay' AND payload->>'principalId'=a.principal_id::text AND payload->>'relayOperation'=a.relay_operation));

-- No new callback approval-table policy/grant: only a fixed, scoped definer accessor may lock/read.
GRANT SELECT ON public.approval_requests TO thaara_whatsapp_audit_guard;
GRANT UPDATE(id) ON public.approval_requests TO thaara_whatsapp_audit_guard;
CREATE POLICY whatsapp_approval_guard_read ON public.approval_requests FOR SELECT TO thaara_whatsapp_audit_guard USING(true);
CREATE POLICY whatsapp_approval_guard_lock ON public.approval_requests FOR UPDATE TO thaara_whatsapp_audit_guard USING(true) WITH CHECK(false);
GRANT SELECT (workspace_id,owner_user_id,connection_id,approval_id) ON public.whatsapp_n8n_dispatches TO thaara_whatsapp_audit_guard;
CREATE POLICY whatsapp_dispatch_guard_read ON public.whatsapp_n8n_dispatches FOR SELECT TO thaara_whatsapp_audit_guard USING(true);
CREATE FUNCTION public.whatsapp_runtime_approval(requested uuid) RETURNS SETOF public.approval_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor record;
BEGIN
  SELECT * INTO actor FROM public.current_whatsapp_runtime_scope();
  IF NOT FOUND THEN RETURN; END IF;
  IF actor.principal_id IS NOT NULL AND (actor.relay_operation <> 'claim' OR NOT EXISTS (
    SELECT 1 FROM public.whatsapp_n8n_dispatches d WHERE d.workspace_id=actor.workspace_id AND d.owner_user_id=actor.user_id
      AND d.connection_id=actor.connection_id AND d.approval_id=requested)) THEN RETURN; END IF;
  RETURN QUERY SELECT a.* FROM public.approval_requests a WHERE a.id=requested AND a.workspace_id=actor.workspace_id
    AND a.requester_user_id=actor.user_id AND a.action_name='whatsapp.meta.messages.send' FOR SHARE;
END $$;
ALTER FUNCTION public.whatsapp_runtime_approval(uuid) OWNER TO thaara_whatsapp_audit_guard;
REVOKE ALL ON FUNCTION public.whatsapp_runtime_approval(uuid) FROM PUBLIC,thaara_app,thaara_worker;
GRANT EXECUTE ON FUNCTION public.whatsapp_runtime_approval(uuid) TO thaara_app;

-- Derived from1083: actor/approval resolution plus stricter events-vs-receipts provider association.

CREATE OR REPLACE FUNCTION public.issue_whatsapp_audit_proof() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor record; version_to_write bigint; is_disconnected boolean; dispatch uuid;
BEGIN
  SELECT * INTO actor FROM public.current_whatsapp_runtime_scope();
  IF NOT FOUND OR actor.workspace_id IS DISTINCT FROM NEW.workspace_id OR actor.user_id IS DISTINCT FROM NEW.actor_user_id
    OR actor.role NOT IN ('owner','admin','member') OR NEW.target_type IS DISTINCT FROM 'whatsapp_connection'
    OR NOT COALESCE(NEW.target_id ~ '^[a-zA-Z0-9_-]{1,128}$',false)
    OR NEW.action NOT IN ('whatsapp.durable.created','whatsapp.durable.events','whatsapp.durable.reserved',
      'whatsapp.durable.claimed','whatsapp.durable.receipt','whatsapp.durable.unknown','whatsapp.durable.disconnected') THEN
    RAISE EXCEPTION 'WhatsApp audit issuance denied';
  END IF;
  IF actor.principal_id IS NOT NULL AND (NEW.target_id IS DISTINCT FROM actor.connection_id
    OR NEW.action IS DISTINCT FROM CASE actor.relay_operation WHEN 'events' THEN 'whatsapp.durable.events' WHEN 'claim' THEN 'whatsapp.durable.claimed' WHEN 'receipts' THEN 'whatsapp.durable.receipt' END
    OR NEW.payload->>'actorKind' IS DISTINCT FROM 'whatsapp_relay'
    OR NEW.payload->>'principalId' IS DISTINCT FROM actor.principal_id::text
    OR NEW.payload->>'relayOperation' IS DISTINCT FROM actor.relay_operation) THEN
    RAISE EXCEPTION 'WhatsApp callback audit identity/action denied';
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

CREATE OR REPLACE FUNCTION public.guard_whatsapp_offline_state() RETURNS trigger
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
      IF proof.audit_action='whatsapp.durable.events' AND NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id THEN
        RAISE EXCEPTION 'WhatsApp events cannot associate provider receipts';
      END IF;
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
      SELECT * INTO approval FROM public.whatsapp_runtime_approval(NEW.approval_id);
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

REVOKE CREATE ON SCHEMA public FROM thaara_whatsapp_audit_guard;
COMMIT;
