-- REVIEW ARTIFACT ONLY. NOT an installed migration. Owner approval + isolated runtime acceptance before any pilot use.
-- Base: 1083 + 1085/1089 (identical function bodies) + 10821. Additive: no existing row rewrite, RLS, grant or table change.
-- 1. Dispatch drafts may carry exactly one of bodyText | template | media (bounded shapes).
-- 2. Template drafts are exempt from the 24 h customer-service window (their purpose); text/media are not.
-- 3. New owner-only audited action whatsapp.durable.contacts_updated: binding revision +1, only recipients change,
--    recipients may carry an optional displayName. Pending dispatches for the old revision are fenced as before.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF current_setting('thaara.step10825_review_approved', true) IS DISTINCT FROM 'yes'
    OR current_setting('thaara.step10825_target_database', true) IS DISTINCT FROM current_database() THEN
    RAISE EXCEPTION 'Step 10825 SQL requires explicit approval and target database';
  END IF;
  IF to_regclass('public.whatsapp_n8n_relay_principals') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.whatsapp_n8n_messages'::regclass AND conname='whatsapp_n8n_media_metadata_10821_check')
    OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.whatsapp_n8n_dispatches'::regclass AND conname='whatsapp_n8n_dispatch_draft_10825_check') THEN
    RAISE EXCEPTION 'Step 10825 requires 1083+1085/1089+10821 and must not be applied twice';
  END IF;
END $$;

-- Replace the unnamed 1083 draft key-set CHECK and audit-proof action CHECK, located by exact definition (exactly one each).
DO $$ DECLARE draft_check text; action_check text; BEGIN
  SELECT string_agg(conname, ',') INTO draft_check FROM pg_constraint
    WHERE conrelid='public.whatsapp_n8n_dispatches'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%(record -> ''draft''::text) - ARRAY[%''replyToProviderMessageId''%';
  SELECT string_agg(conname, ',') INTO action_check FROM pg_constraint
    WHERE conrelid='public.whatsapp_n8n_audit_proofs'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%audit_action = ANY%' AND pg_get_constraintdef(oid) LIKE '%whatsapp.durable.disconnected%'
      AND pg_get_constraintdef(oid) NOT LIKE '%bound_dispatch_id%';
  IF draft_check IS NULL OR draft_check LIKE '%,%' OR action_check IS NULL OR action_check LIKE '%,%' THEN
    RAISE EXCEPTION 'Step 10825 could not identify exactly one base constraint of each kind';
  END IF;
  EXECUTE format('ALTER TABLE public.whatsapp_n8n_dispatches DROP CONSTRAINT %I', draft_check);
  EXECUTE format('ALTER TABLE public.whatsapp_n8n_audit_proofs DROP CONSTRAINT %I', action_check);
END $$;

ALTER TABLE public.whatsapp_n8n_audit_proofs ADD CONSTRAINT whatsapp_n8n_audit_action_10825_check CHECK (audit_action IN (
  'whatsapp.durable.created','whatsapp.durable.events','whatsapp.durable.reserved','whatsapp.durable.claimed',
  'whatsapp.durable.receipt','whatsapp.durable.unknown','whatsapp.durable.disconnected','whatsapp.durable.contacts_updated'));

ALTER TABLE public.whatsapp_n8n_dispatches ADD CONSTRAINT whatsapp_n8n_dispatch_draft_10825_check CHECK (COALESCE(
  jsonb_typeof(record->'draft') = 'object'
  AND length((record->'draft')::text) <= 16384
  AND (record->'draft') - ARRAY['connectionId','connectionRevision','senderPhoneNumberId','recipientId','bodyText','idempotencyKey','replyToProviderMessageId','template','media']::text[] = '{}'::jsonb
  AND ((record->'draft' ? 'bodyText')::int + (record->'draft' ? 'template')::int + (record->'draft' ? 'media')::int) = 1
  AND (NOT (record->'draft' ? 'template') OR (
    jsonb_typeof(record->'draft'->'template') = 'object'
    AND NOT (record->'draft' ? 'replyToProviderMessageId')
    AND (record->'draft'->'template') - ARRAY['name','language','bodyParams','headerParams']::text[] = '{}'::jsonb
    -- PostgreSQL regex repetition counts are limited to 255, so long bounds use length().
    AND record->'draft'->'template'->>'name' ~ '^[a-z0-9_]+$' AND length(record->'draft'->'template'->>'name') <= 512
    AND record->'draft'->'template'->>'language' ~ '^[a-z]{2,3}(_[A-Z]{2})?$'
    AND jsonb_typeof(COALESCE(record->'draft'->'template'->'bodyParams', '[]'::jsonb)) = 'array'
    AND jsonb_array_length(COALESCE(record->'draft'->'template'->'bodyParams', '[]'::jsonb)) <= 20
    AND jsonb_typeof(COALESCE(record->'draft'->'template'->'headerParams', '[]'::jsonb)) = 'array'
    AND jsonb_array_length(COALESCE(record->'draft'->'template'->'headerParams', '[]'::jsonb)) <= 1
    AND NOT jsonb_path_exists(COALESCE(record->'draft'->'template'->'bodyParams', '[]'::jsonb) || COALESCE(record->'draft'->'template'->'headerParams', '[]'::jsonb),
      '$[*] ? (@.type() != "string" || @ == "" || @ like_regex "^(.{250}){4}.{25}" flag "s")')))
  AND (NOT (record->'draft' ? 'media') OR (
    jsonb_typeof(record->'draft'->'media') = 'object'
    AND (record->'draft'->'media') - ARRAY['kind','mediaId','mimeType','sha256','caption','filename']::text[] = '{}'::jsonb
    AND record->'draft'->'media'->>'kind' IN ('image','document','audio')
    AND record->'draft'->'media'->>'mediaId' ~ '^[0-9]{1,64}$'
    AND record->'draft'->'media'->>'mimeType' ~ '^[a-z0-9.+-]{1,64}/[a-z0-9.+-]{1,127}$'
    AND record->'draft'->'media'->>'sha256' ~ '^[a-f0-9]{64}$'
    AND (NOT (record->'draft'->'media' ? 'caption') OR (record->'draft'->'media'->>'kind' <> 'audio' AND length(record->'draft'->'media'->>'caption') BETWEEN 1 AND 1024))
    AND (NOT (record->'draft'->'media' ? 'filename') OR (record->'draft'->'media'->>'kind' = 'document' AND record->'draft'->'media'->>'filename' ~ '^[^/\\[:cntrl:]]{1,160}$'))))
  AND (NOT (record->'draft' ? 'bodyText') OR (jsonb_typeof(record->'draft'->'bodyText') = 'string' AND length(record->'draft'->>'bodyText') BETWEEN 1 AND 4096)),
  false));

-- Derived from 1085/1089: adds whatsapp.durable.contacts_updated (owner sessions only; relay principals cannot map to it).
CREATE OR REPLACE FUNCTION public.issue_whatsapp_audit_proof() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor record; version_to_write bigint; is_disconnected boolean; dispatch uuid;
BEGIN
  SELECT * INTO actor FROM public.current_whatsapp_runtime_scope();
  IF NOT FOUND OR actor.workspace_id IS DISTINCT FROM NEW.workspace_id OR actor.user_id IS DISTINCT FROM NEW.actor_user_id
    OR actor.role NOT IN ('owner','admin','member') OR NEW.target_type IS DISTINCT FROM 'whatsapp_connection'
    OR NOT COALESCE(NEW.target_id ~ '^[a-zA-Z0-9_-]{1,128}$',false)
    OR NEW.action NOT IN ('whatsapp.durable.created','whatsapp.durable.events','whatsapp.durable.reserved',
      'whatsapp.durable.claimed','whatsapp.durable.receipt','whatsapp.durable.unknown','whatsapp.durable.disconnected',
      'whatsapp.durable.contacts_updated') THEN
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

-- Derived from 1085/1089: contacts_updated revision path, optional displayName, template window exemption.
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
    ELSIF proof.audit_action = 'whatsapp.durable.contacts_updated' THEN
      -- Only the recipient list changes; revision and row version advance by exactly one; never while disconnected.
      IF OLD.disconnected OR NEW.disconnected OR NEW.row_version <> OLD.row_version + 1 OR NEW.revision <> OLD.revision + 1
        OR NEW.binding - 'recipients' <> jsonb_set(OLD.binding,'{revision}',to_jsonb(NEW.revision)) - 'recipients'
        OR NEW.binding->'recipients' = OLD.binding->'recipients' THEN
        RAISE EXCEPTION 'WhatsApp contacts revision fence denied';
      END IF;
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
      IF recipient - ARRAY['id','phoneE164','optedIn','displayName']::text[] <> '{}'::jsonb
        OR NOT COALESCE(recipient->>'id' ~ '^[a-zA-Z0-9_-]{1,128}$'
        AND recipient->>'phoneE164' ~ '^\+[1-9][0-9]{7,14}$' AND jsonb_typeof(recipient->'optedIn')='boolean'
        AND (NOT (recipient ? 'displayName') OR (jsonb_typeof(recipient->'displayName')='string' AND recipient->>'displayName' ~ '^[^[:cntrl:]]{1,80}$')),false) THEN
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
      -- Approved templates are Meta's mechanism for messaging outside the 24 h window; text and media stay inside it.
      IF NOT (NEW.record->'draft' ? 'template') THEN
        SELECT max((record->>'timestamp')::timestamptz) INTO last_message FROM public.whatsapp_n8n_messages
          WHERE workspace_id=NEW.workspace_id AND owner_user_id=NEW.owner_user_id AND connection_id=NEW.connection_id AND recipient_id=recipient->>'id';
        IF last_message IS NULL OR last_message > clock_timestamp() OR last_message <= clock_timestamp()-interval '24 hours' THEN
          RAISE EXCEPTION 'WhatsApp messaging window denied'; END IF;
      END IF;
      IF NEW.record->'draft' ? 'replyToProviderMessageId' AND NOT EXISTS (SELECT 1 FROM public.whatsapp_n8n_messages m
        WHERE m.workspace_id=NEW.workspace_id AND m.owner_user_id=NEW.owner_user_id AND m.connection_id=NEW.connection_id
          AND m.recipient_id=recipient->>'id' AND m.provider_message_id=NEW.record->'draft'->>'replyToProviderMessageId') THEN
        RAISE EXCEPTION 'WhatsApp reply binding denied'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_whatsapp_offline_state() FROM PUBLIC;
DO $$ BEGIN
  IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.issue_whatsapp_audit_proof()'::regprocedure) <> 'thaara_whatsapp_audit_guard'
    OR NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.issue_whatsapp_audit_proof()'::regprocedure)
    OR (SELECT prosecdef FROM pg_proc WHERE oid='public.guard_whatsapp_offline_state()'::regprocedure)
    OR (SELECT count(*) FROM pg_constraint WHERE conname IN ('whatsapp_n8n_dispatch_draft_10825_check','whatsapp_n8n_audit_action_10825_check')) <> 2 THEN
    RAISE EXCEPTION 'Step 10825 post-condition failed';
  END IF;
END $$;
COMMIT;
