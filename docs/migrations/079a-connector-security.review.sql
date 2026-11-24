-- STEP79A_REVIEW_ONLY: not in the automatic migration directory. DO NOT EXECUTE without approval.
-- No cloud provider, real key, credential, profile, connection or workflow is created here.
-- Requires a reviewed elevated migration identity and the existing 0001..0012 schema.
BEGIN;
DO $review_guard$
BEGIN
 IF pg_catalog.current_setting('thaara.step79a_review_approved',true) IS DISTINCT FROM 'yes'
    OR pg_catalog.current_setting('thaara.step79a_target_database',true) IS DISTINCT FROM pg_catalog.current_database() THEN
  RAISE EXCEPTION 'Review-only SQL: approval and explicit target database are required';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='thaara_connector_guard')
    OR pg_catalog.to_regclass('public.workspace_connector_connections') IS NOT NULL
    OR pg_catalog.to_regclass('public.workspace_connector_profiles') IS NOT NULL THEN
  RAISE EXCEPTION 'Connector objects already exist: stop; never adopt or overwrite';
 END IF;
 IF pg_catalog.to_regprocedure('public.current_authenticated_scope()') IS NULL
    OR (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('thaara_app','thaara_worker','thaara_admin'))<>3 THEN
  RAISE EXCEPTION 'Required existing authentication schema/roles are unavailable';
 END IF;
END;
$review_guard$;

CREATE ROLE thaara_connector_guard NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT USAGE,CREATE ON SCHEMA public TO thaara_connector_guard;

CREATE FUNCTION public.connector_credential_envelope_valid(p_value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $envelope$
DECLARE v_field text;v_min integer;v_max integer;v_text text;v_bytes bytea;v_keys text[];
BEGIN
 IF p_value IS NULL OR pg_catalog.jsonb_typeof(p_value)<>'object'
    OR pg_catalog.octet_length(p_value::text)>32768 THEN RETURN false; END IF;
 SELECT pg_catalog.array_agg(k ORDER BY k) INTO v_keys FROM pg_catalog.jsonb_object_keys(p_value) k;
 IF v_keys IS DISTINCT FROM ARRAY['ciphertext','iv','keyId','tag','version','wrappedKey']::text[]
    OR p_value->'version' IS DISTINCT FROM '1'::jsonb
    OR pg_catalog.jsonb_typeof(p_value->'keyId')<>'string'
    OR pg_catalog.length(p_value->>'keyId') NOT BETWEEN 1 AND 512
    OR (p_value->>'keyId') !~ '^[!-~]+$' THEN RETURN false; END IF;
 FOR v_field,v_min,v_max IN SELECT * FROM (VALUES ('iv',12,12),('tag',16,16),('wrappedKey',1,4096),('ciphertext',1,16384)) f LOOP
  v_text:=p_value->>v_field;
  IF pg_catalog.jsonb_typeof(p_value->v_field)<>'string' OR v_text !~ '^[A-Za-z0-9_-]+$'
     OR pg_catalog.length(v_text)>((v_max*4+2)/3+4) THEN RETURN false; END IF;
  v_bytes:=pg_catalog.decode(pg_catalog.translate(v_text,'-_','+/')||
      pg_catalog.repeat('=',(4-pg_catalog.length(v_text)%4)%4),'base64');
  IF pg_catalog.octet_length(v_bytes)<v_min OR pg_catalog.octet_length(v_bytes)>v_max
     OR pg_catalog.rtrim(pg_catalog.translate(pg_catalog.replace(pg_catalog.replace(
      pg_catalog.encode(v_bytes,'base64'),pg_catalog.chr(10),''),pg_catalog.chr(13),''),'+/','-_'),'=')<>v_text THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$envelope$;
ALTER FUNCTION public.connector_credential_envelope_valid(jsonb) OWNER TO thaara_connector_guard;

-- Empty, disabled-by-default trusted metadata. Provisioning is separately approved administrative work.
CREATE TABLE public.workspace_connector_profiles (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
 connector_key text NOT NULL CHECK (connector_key IN ('n8n','gmail','calendar','whatsapp','phone')),
 profile_id text NOT NULL CHECK (profile_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 label text NOT NULL CHECK (label ~ '^[A-Za-z0-9 ._-]{1,60}$'),
 configuration_fingerprint text NOT NULL CHECK (configuration_fingerprint ~ '^[a-f0-9]{64}$'),
 enabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 PRIMARY KEY (workspace_id,connector_key,profile_id)
);
CREATE TABLE public.workspace_connector_connections (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
 connector_key text NOT NULL CHECK (connector_key IN ('n8n','gmail','calendar','whatsapp','phone')),
 revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
 status text NOT NULL CHECK (status IN ('configured_unverified','disconnected')),
 profile_id text,
 profile_fingerprint text,
 credential_envelope jsonb,
 updated_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 PRIMARY KEY (workspace_id,connector_key),
 FOREIGN KEY (workspace_id,connector_key,profile_id)
  REFERENCES public.workspace_connector_profiles(workspace_id,connector_key,profile_id) ON DELETE RESTRICT,
 CONSTRAINT connector_record_shape CHECK (
  (status='disconnected' AND profile_id IS NULL AND profile_fingerprint IS NULL AND credential_envelope IS NULL)
  OR (status='configured_unverified' AND profile_id IS NOT NULL AND profile_fingerprint IS NOT NULL
   AND profile_fingerprint ~ '^[a-f0-9]{64}$' AND credential_envelope IS NOT NULL
   AND public.connector_credential_envelope_valid(credential_envelope))
 )
);
ALTER TABLE public.workspace_connector_profiles OWNER TO thaara_connector_guard;
ALTER TABLE public.workspace_connector_connections OWNER TO thaara_connector_guard;
COMMENT ON TABLE public.workspace_connector_profiles IS 'THAARA_STEP79A_REVIEW_ONLY_V1';
COMMENT ON TABLE public.workspace_connector_connections IS 'THAARA_STEP79A_REVIEW_ONLY_V1';
ALTER TABLE public.workspace_connector_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_connector_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_connector_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_connector_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY connector_profile_scope ON public.workspace_connector_profiles TO thaara_connector_guard
 USING (workspace_id IN (SELECT s.workspace_id FROM public.current_authenticated_scope() s WHERE s.role IN ('admin','owner')))
 WITH CHECK (workspace_id IN (SELECT s.workspace_id FROM public.current_authenticated_scope() s WHERE s.role IN ('admin','owner')));
CREATE POLICY connector_connection_scope ON public.workspace_connector_connections TO thaara_connector_guard
 USING (workspace_id IN (SELECT s.workspace_id FROM public.current_authenticated_scope() s WHERE s.role IN ('admin','owner')))
 WITH CHECK (workspace_id IN (SELECT s.workspace_id FROM public.current_authenticated_scope() s WHERE s.role IN ('admin','owner')));
REVOKE ALL ON TABLE public.workspace_connector_profiles,public.workspace_connector_connections
 FROM PUBLIC,thaara_app,thaara_worker,thaara_admin;

-- Locks need SELECT plus UPDATE privilege on at least one column. No role/session UPDATE is issued.
GRANT SELECT ON public.sessions,public.memberships TO thaara_connector_guard;
GRANT UPDATE(last_active_at) ON public.sessions TO thaara_connector_guard;
GRANT UPDATE(updated_at) ON public.memberships TO thaara_connector_guard;
GRANT INSERT ON public.audit_events TO thaara_connector_guard;
GRANT EXECUTE ON FUNCTION public.current_authenticated_scope() TO thaara_connector_guard;

CREATE FUNCTION public.connector_locked_admin_scope()
RETURNS TABLE(workspace_id uuid,user_id uuid,role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout='3s' AS $scope$
DECLARE v_workspace uuid;v_user uuid;v_role text;v_hash text;v_session uuid;
BEGIN
 SELECT s.workspace_id,s.user_id,s.role INTO v_workspace,v_user,v_role FROM public.current_authenticated_scope() s;
 IF v_workspace IS NULL OR v_role NOT IN ('admin','owner') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active workspace admin authority required';
 END IF;
 -- Existing session/membership/audit RLS uses these GUCs: derive them from the token, never caller headers.
 PERFORM pg_catalog.set_config('app.workspace_id',v_workspace::text,true);
 PERFORM pg_catalog.set_config('app.user_id',v_user::text,true);
 PERFORM pg_catalog.set_config('app.role',v_role,true);
 v_hash:=pg_catalog.current_setting('app.session_token_hash',true);
 SELECT s.id INTO v_session FROM public.sessions s
  WHERE s.token_hash=v_hash AND s.workspace_id=v_workspace AND s.user_id=v_user
    AND s.revoked_at IS NULL AND s.expires_at>pg_catalog.clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active session required'; END IF;
 SELECT m.role INTO v_role FROM public.memberships m
  WHERE m.workspace_id=v_workspace AND m.user_id=v_user AND m.role IN ('admin','owner') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Active workspace admin membership required'; END IF;
 PERFORM pg_catalog.set_config('app.role',v_role,true);
 RETURN QUERY SELECT v_workspace,v_user,v_role;
END;
$scope$;
ALTER FUNCTION public.connector_locked_admin_scope() OWNER TO thaara_connector_guard;

CREATE FUNCTION public.read_workspace_connector_connection(p_connector_key text)
RETURNS SETOF public.workspace_connector_connections
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout='3s' AS $read$
DECLARE v_scope record;v_row public.workspace_connector_connections%ROWTYPE;
BEGIN
 IF p_connector_key IS NULL OR p_connector_key NOT IN ('n8n','gmail','calendar','whatsapp','phone') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid connector';
 END IF;
 SELECT * INTO STRICT v_scope FROM public.connector_locked_admin_scope();
 SELECT c.* INTO v_row FROM public.workspace_connector_connections c
  WHERE c.workspace_id=v_scope.workspace_id AND c.connector_key=p_connector_key;
 IF NOT FOUND THEN RETURN; END IF;
 IF v_row.status='configured_unverified' AND NOT EXISTS (
  SELECT 1 FROM public.workspace_connector_profiles p WHERE p.workspace_id=v_scope.workspace_id
   AND p.connector_key=p_connector_key AND p.profile_id=v_row.profile_id AND p.enabled
   AND p.configuration_fingerprint=v_row.profile_fingerprint
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Approved connector profile unavailable'; END IF;
 RETURN NEXT v_row;
END;
$read$;
ALTER FUNCTION public.read_workspace_connector_connection(text) OWNER TO thaara_connector_guard;

CREATE FUNCTION public.commit_workspace_connector_connection(
 p_connector_key text,p_expected_revision bigint,p_operation text,p_profile_id text,
 p_profile_fingerprint text,p_envelope jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET lock_timeout='3s' AS $commit$
DECLARE v_scope record;v_old public.workspace_connector_connections%ROWTYPE;v_actual bigint;
 v_revision bigint;v_profile public.workspace_connector_profiles%ROWTYPE;v_status text;v_action text;
BEGIN
 IF p_connector_key IS NULL OR p_connector_key NOT IN ('n8n','gmail','calendar','whatsapp','phone')
  OR p_expected_revision IS NULL OR p_expected_revision<0 OR p_expected_revision>=9007199254740991
  OR p_operation IS NULL OR p_operation NOT IN ('configure','rotate','disconnect') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid connector transition';
 END IF;
 SELECT * INTO STRICT v_scope FROM public.connector_locked_admin_scope();
 -- Includes the missing-row case. Hash collisions only serialize independent keys.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_scope.workspace_id::text||':'||p_connector_key,0));
 SELECT c.* INTO v_old FROM public.workspace_connector_connections c
  WHERE c.workspace_id=v_scope.workspace_id AND c.connector_key=p_connector_key FOR UPDATE;
 v_actual:=CASE WHEN FOUND THEN v_old.revision ELSE 0 END;
 IF v_actual<>p_expected_revision THEN RETURN NULL; END IF;
 -- Refresh expiry/authority after lock waits, retaining the same authenticated subject.
 PERFORM public.connector_locked_admin_scope();
 v_revision:=p_expected_revision+1;
 IF p_operation='disconnect' THEN
  IF p_profile_id IS NOT NULL OR p_profile_fingerprint IS NOT NULL OR p_envelope IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Disconnect must contain no credential data';
  END IF;
  v_status:='disconnected';v_action:='connector.connection.disconnected';
 ELSE
  IF p_profile_id IS NULL OR p_profile_fingerprint IS NULL OR p_envelope IS NULL
     OR NOT public.connector_credential_envelope_valid(p_envelope) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid encrypted connector record';
  END IF;
  SELECT p.* INTO v_profile FROM public.workspace_connector_profiles p
   WHERE p.workspace_id=v_scope.workspace_id AND p.connector_key=p_connector_key AND p.profile_id=p_profile_id
    AND p.configuration_fingerprint=p_profile_fingerprint AND p.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Approved server profile required'; END IF;
  IF p_operation='rotate' AND (v_actual=0 OR v_old.status<>'configured_unverified'
     OR v_old.profile_id IS DISTINCT FROM p_profile_id OR v_old.profile_fingerprint IS DISTINCT FROM p_profile_fingerprint
     OR v_old.credential_envelope->>'keyId' IS NOT DISTINCT FROM p_envelope->>'keyId') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid key rotation transition';
  END IF;
  -- Cryptographic AAD and lifecycle checks remain the server/KMS adapter's responsibility.
  v_status:='configured_unverified';
  v_action:=CASE WHEN p_operation='rotate' THEN 'connector.connection.key_rotated' ELSE 'connector.connection.configured' END;
 END IF;
 -- Profile locking may also wait; validate wall-clock session expiry immediately before mutation.
 PERFORM public.connector_locked_admin_scope();
 INSERT INTO public.workspace_connector_connections(
  workspace_id,connector_key,revision,status,profile_id,profile_fingerprint,credential_envelope,updated_by_user_id
 ) VALUES(v_scope.workspace_id,p_connector_key,v_revision,v_status,p_profile_id,p_profile_fingerprint,p_envelope,v_scope.user_id)
 ON CONFLICT(workspace_id,connector_key) DO UPDATE SET
  revision=EXCLUDED.revision,status=EXCLUDED.status,profile_id=EXCLUDED.profile_id,
  profile_fingerprint=EXCLUDED.profile_fingerprint,credential_envelope=EXCLUDED.credential_envelope,
  updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=pg_catalog.clock_timestamp();
 -- Derived audit only: no caller-provided actor/workspace/payload and no secret/envelope/key reference.
 INSERT INTO public.audit_events(workspace_id,actor_user_id,action,target_type,target_id,payload,created_at)
 VALUES(v_scope.workspace_id,v_scope.user_id,v_action,'connector_connection',p_connector_key,
  pg_catalog.jsonb_build_object('connector',p_connector_key,'revision',v_revision,'operation',p_operation,'localOnly',true),
  pg_catalog.clock_timestamp());
 RETURN v_revision;
END;
$commit$;
ALTER FUNCTION public.commit_workspace_connector_connection(text,bigint,text,text,text,jsonb) OWNER TO thaara_connector_guard;

-- Remove default PUBLIC function execution in the same transaction as creation.
REVOKE ALL ON FUNCTION public.connector_credential_envelope_valid(jsonb),
 public.connector_locked_admin_scope(),public.read_workspace_connector_connection(text),
 public.commit_workspace_connector_connection(text,bigint,text,text,text,jsonb)
 FROM PUBLIC,thaara_app,thaara_worker,thaara_admin;
GRANT EXECUTE ON FUNCTION public.read_workspace_connector_connection(text),
 public.commit_workspace_connector_connection(text,bigint,text,text,text,jsonb) TO thaara_app;
REVOKE CREATE ON SCHEMA public FROM thaara_connector_guard;
DO $postflight$
BEGIN
 IF pg_catalog.has_schema_privilege('thaara_connector_guard','public','CREATE') THEN
  RAISE EXCEPTION 'Inherited public-schema CREATE privilege is unsuitable; review existing schema ACL separately';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
  JOIN pg_catalog.pg_roles r ON r.oid=m.roleid WHERE r.rolname='thaara_connector_guard') THEN
  RAISE EXCEPTION 'Runtime role membership in connector guard must not exist';
 END IF;
END;
$postflight$;
-- Deliberately no profile/key/credential insert, connection setup, provider call or migration-ledger update.
COMMIT;
