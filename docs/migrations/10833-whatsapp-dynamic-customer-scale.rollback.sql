-- Rollback for Migration 10833: WhatsApp Dynamic Customer Scale & Inbound Recipient Verification
-- Restores static recipient check constraint to BETWEEN 1 AND 5 and reverts guard_whatsapp_offline_state()
-- to previous recipient lookup in parent.binding->'recipients'.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- 1. Revert check constraint on public.whatsapp_n8n_connections to 1..5
ALTER TABLE public.whatsapp_n8n_connections
  DROP CONSTRAINT IF EXISTS whatsapp_n8n_connections_check;

ALTER TABLE public.whatsapp_n8n_connections
  ADD CONSTRAINT whatsapp_n8n_connections_check
  CHECK (COALESCE(
    binding->>'mode' = 'offline_test'
    AND binding->>'workspaceId' = workspace_id::text
    AND binding->>'userId' = owner_user_id::text
    AND binding->>'connectionId' = connection_id
    AND (binding->>'revision')::bigint = revision
    AND jsonb_typeof(binding->'recipients') = 'array'
    AND jsonb_array_length(binding->'recipients') BETWEEN 1 AND 5
    AND binding->>'phoneNumberId' ~ '^[0-9]{6,24}$'
    AND binding->>'businessAccountId' ~ '^[0-9]{6,24}$'
    AND binding->>'graphVersion' ~ '^v[2-9][0-9]\.0$',
    false
  ));

-- 2. Restore guard_whatsapp_offline_state()
CREATE OR REPLACE FUNCTION public.guard_whatsapp_offline_state()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    RAISE EXCEPTION 'WhatsApp events audit binding denied'; END IF;
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
END $function$;

COMMIT;
