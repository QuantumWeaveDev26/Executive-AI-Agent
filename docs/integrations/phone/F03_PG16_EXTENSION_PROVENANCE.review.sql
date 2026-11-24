-- READ-ONLY CANDIDATE, NOT EXECUTED. Separate approval required before any SQL run.
-- Execute with the main catalog query in the SAME PG16 REPEATABLE READ, READ ONLY snapshot,
-- search_path=pg_catalog. Bind $1 to stage. Capture image/source/query hashes outside the database.
-- PG16 sources: catalog-pg-extension.html, catalog-pg-depend.html, catalog-pg-proc.html.
WITH native AS (
 SELECT p.*,n.nspname,l.lanname
 FROM pg_catalog.pg_proc p
 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 JOIN pg_catalog.pg_language l ON l.oid=p.prolang
 WHERE n.nspname IN('public','platform') AND l.lanname='c' AND p.prokind='f'
)
SELECT pg_catalog.jsonb_build_object(
 'format','pg16-extension-provenance-v1',
 'serverVersionNum',pg_catalog.current_setting('server_version_num')::integer,
 'stage',$1::text,
 'extensions',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'name',e.extname,'version',e.extversion,'schema',n.nspname,'owner',pg_catalog.pg_get_userbyid(e.extowner),
  'relocatable',e.extrelocatable,
  'configTables',COALESCE((SELECT pg_catalog.jsonb_agg(c.oid::pg_catalog.regclass::text ORDER BY c.oid)
    FROM pg_catalog.pg_class c WHERE c.oid=ANY(e.extconfig)),'[]'::jsonb),
  'configConditions',COALESCE(pg_catalog.to_jsonb(e.extcondition),'[]'::jsonb)
 ) ORDER BY e.extname) FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace
 WHERE e.extname<>'plpgsql'),'[]'::jsonb),
 'routines',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'signature',p.nspname||'.'||p.proname||'('||pg_catalog.oidvectortypes(p.proargtypes)||')',
  'definition',pg_catalog.pg_get_functiondef(p.oid),'language',p.lanname,'library',p.probin,'symbol',p.prosrc,
  'extensionName',e.extname,'membershipType',d.deptype::text,'objectSubId',d.objsubid
 ) ORDER BY p.nspname,p.proname,p.proargtypes::text)
 FROM native p LEFT JOIN pg_catalog.pg_depend d
  ON d.classid='pg_catalog.pg_proc'::pg_catalog.regclass AND d.objid=p.oid AND d.objsubid=0
   AND d.refclassid='pg_catalog.pg_extension'::pg_catalog.regclass AND d.refobjsubid=0 AND d.deptype='e'
 LEFT JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid),'[]'::jsonb)
) AS extension_provenance;
