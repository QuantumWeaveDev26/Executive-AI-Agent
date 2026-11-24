-- REVIEW ONLY. Never executed; not covered by F03 V1/V2/V3 approvals.
-- Additive permission-only correction; original migration SQL remains unchanged.
-- Requires separately reviewed target/reference admission, owner authorization and backup/recovery.
-- Preserve SELECT; remove only application mutation authority over the global migration ledger.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog;
DO $$
BEGIN
 IF current_setting('thaara.phone_ledger_write_fence_approved',true)
    IS DISTINCT FROM 'separately-reviewed-ledger-write-fence-v1'
  OR current_database() IS DISTINCT FROM 'thaara_vps_pilot'
  OR current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999
  OR session_user IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM session_user THEN
  RAISE EXCEPTION 'Migration ledger write fence requires separate approval and exact operator/target';
 END IF;
 IF to_regclass('public.schema_migrations') IS NULL
  OR to_regrole('thaara_app') IS NULL OR to_regrole('thaara_worker') IS NULL THEN
  RAISE EXCEPTION 'Migration ledger write fence prerequisites denied';
 END IF;
 LOCK TABLE public.schema_migrations IN ACCESS EXCLUSIVE MODE;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.schema_migrations'::regclass
    AND relkind='r' AND relpersistence='p' AND relowner='postgres'::regrole)
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_database WHERE datname=current_database()
    AND datdba='postgres'::regrole)
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN('thaara_app','thaara_worker')
    AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
  RAISE EXCEPTION 'Migration ledger write fence prerequisites denied';
 END IF;
END $$;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.schema_migrations FROM thaara_app, thaara_worker, PUBLIC RESTRICT;
DO $$
BEGIN
 -- Includes role membership and ownership-derived authority; unexpected access fails/rolls back.
 IF EXISTS(
  SELECT 1 FROM (VALUES('thaara_app'),('thaara_worker')) r(role_name)
  CROSS JOIN (VALUES('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege)
  WHERE pg_catalog.has_table_privilege(r.role_name,'public.schema_migrations',p.privilege)
 ) OR EXISTS(
  SELECT 1 FROM (VALUES('thaara_app'),('thaara_worker')) r(role_name)
  JOIN pg_catalog.pg_roles t ON pg_catalog.pg_has_role(r.role_name,t.oid,'SET')
  CROSS JOIN (VALUES('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege)
  WHERE pg_catalog.has_table_privilege(t.oid,'public.schema_migrations',p.privilege)
 ) OR EXISTS(
  SELECT 1 FROM (VALUES('thaara_app'),('thaara_worker')) r(role_name)
  JOIN pg_catalog.pg_roles t ON pg_catalog.pg_has_role(r.role_name,t.oid,'SET')
  CROSS JOIN (VALUES('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
  WHERE pg_catalog.has_any_column_privilege(t.oid,'public.schema_migrations',p.privilege)
 ) OR EXISTS(
  SELECT 1 FROM (VALUES('thaara_app'),('thaara_worker')) r(role_name)
  CROSS JOIN (VALUES('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
  WHERE pg_catalog.has_any_column_privilege(r.role_name,'public.schema_migrations',p.privilege)
 ) OR EXISTS(
  SELECT 1 FROM pg_catalog.pg_class c
  CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
  WHERE c.oid='public.schema_migrations'::regclass AND a.grantee=0
   AND a.privilege_type IN('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
 ) THEN
  RAISE EXCEPTION 'Migration ledger write fence did not remove application mutation authority';
 END IF;
END $$;
COMMIT;
