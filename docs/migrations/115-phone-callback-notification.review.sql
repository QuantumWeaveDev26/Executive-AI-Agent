-- Review only. Outside the production migration chain.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_setting('thaara.step115_review_approved',true) IS DISTINCT FROM 'in-memory-only'
  OR current_setting('thaara.step115_target_database',true) IS DISTINCT FROM current_database() THEN
  RAISE EXCEPTION 'Step 115 requires separate in-memory review approval';
 END IF;
END $$;

CREATE TABLE public.phone_callback_requests (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 owner_user_id uuid NOT NULL REFERENCES public.users(id),
 request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
 call_id text NOT NULL CHECK (length(call_id) BETWEEN 1 AND 220),
 direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
 request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
 details jsonb NOT NULL CHECK (jsonb_typeof(details)='object' AND octet_length(details::text)<=4096 AND
  details ?& ARRAY['name','business','service','phoneNumber','numberSource'] AND
  details - ARRAY['name','business','service','phoneNumber','numberSource']='{}'::jsonb),
 occurred_at timestamptz NOT NULL,
 request_status text NOT NULL CHECK (request_status IN ('requested','contacted','completed','cancelled')),
 notification_status text NOT NULL CHECK (notification_status IN ('pending','sending','submitted','failed','unverified','needs_review')),
 notification_attempt_id uuid,
 provider_message_id text CHECK (provider_message_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 attempts smallint NOT NULL CHECK (attempts BETWEEN 0 AND 2),
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 sending_started_at timestamptz,
 PRIMARY KEY(workspace_id,owner_user_id,request_id),
 UNIQUE(workspace_id,owner_user_id,direction,call_id),
 CHECK ((attempts=0)=(notification_attempt_id IS NULL)),
 CHECK ((notification_status='submitted')=(provider_message_id IS NOT NULL)),
 CHECK (notification_status NOT IN ('sending','submitted','failed','unverified') OR attempts>0),
 CHECK (notification_status<>'pending' OR attempts<2)
);
ALTER TABLE public.phone_callback_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_callback_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.phone_callback_requests FROM PUBLIC,thaara_app,thaara_worker;
GRANT SELECT,INSERT ON public.phone_callback_requests TO thaara_app;
GRANT UPDATE(notification_status,notification_attempt_id,provider_message_id,attempts,next_attempt_at,sending_started_at) ON public.phone_callback_requests TO thaara_app;
CREATE POLICY phone_callback_owner ON public.phone_callback_requests TO thaara_app
 USING ((workspace_id,owner_user_id) IN (SELECT s.workspace_id,s.user_id FROM public.current_authenticated_scope() s WHERE s.role='owner'))
 WITH CHECK ((workspace_id,owner_user_id) IN (SELECT s.workspace_id,s.user_id FROM public.current_authenticated_scope() s WHERE s.role='owner'));
COMMIT;
