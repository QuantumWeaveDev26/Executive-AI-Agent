-- REVIEW ONLY. Owner approval and isolated runtime acceptance are mandatory before execution.
-- Keeps whatsapp_n8n_relay_principals revision synchronized with whatsapp_n8n_connections revision
-- so that contact additions never invalidate n8n relay credentials.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.sync_whatsapp_relay_principal_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.revision <> OLD.revision AND NOT NEW.disconnected THEN
    UPDATE public.whatsapp_n8n_relay_principals
    SET revision = NEW.revision
    WHERE workspace_id = NEW.workspace_id
      AND owner_user_id = NEW.owner_user_id
      AND connection_id = NEW.connection_id
      AND enabled AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_whatsapp_relay_principal_revision ON public.whatsapp_n8n_connections;
CREATE TRIGGER trg_sync_whatsapp_relay_principal_revision
AFTER UPDATE OF revision ON public.whatsapp_n8n_connections
FOR EACH ROW
EXECUTE FUNCTION public.sync_whatsapp_relay_principal_revision();

COMMIT;
