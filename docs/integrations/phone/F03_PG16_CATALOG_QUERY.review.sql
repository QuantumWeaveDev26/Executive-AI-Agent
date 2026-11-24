-- READ-ONLY CANDIDATE. Never executed by this local development stage.
-- Expected transaction: REPEATABLE READ, READ ONLY, search_path=pg_catalog.
-- $1 is a bound stage label, never interpolated SQL. Exact version is checked separately.
WITH namespaces AS (
 SELECT oid,nspname,nspowner,nspacl FROM pg_catalog.pg_namespace WHERE nspname IN('public','platform')
), relations AS (
 SELECT c.*,n.nspname FROM pg_catalog.pg_class c JOIN namespaces n ON n.oid=c.relnamespace
), routines AS (
 SELECT p.*,n.nspname,l.lanname FROM pg_catalog.pg_proc p JOIN namespaces n ON n.oid=p.pronamespace
 JOIN pg_catalog.pg_language l ON l.oid=p.prolang
), principals AS (
 SELECT oid,rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,rolconnlimit,rolvaliduntil,rolconfig
 FROM pg_catalog.pg_roles WHERE rolname IN('postgres','pg_database_owner','thaara_app','thaara_admin','thaara_worker','thaara_seeder','thaara_definer','thaara_platform_owner','thaara_phone_guard','thaara_phone_ingest')
), dependency_edges AS (
 SELECT pg_catalog.pg_describe_object(d.classid,d.objid,d.objsubid) AS dependent,
 pg_catalog.pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid) AS referenced,d.deptype::text AS kind
 FROM pg_catalog.pg_depend d
 WHERE (d.classid='pg_catalog.pg_class'::regclass AND d.objid IN(SELECT oid FROM relations))
 OR (d.classid='pg_catalog.pg_proc'::regclass AND d.objid IN(SELECT oid FROM routines))
)
SELECT pg_catalog.jsonb_build_object(
 'server_version_num',pg_catalog.current_setting('server_version_num')::integer,'stage',$1::text,
 'relations',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'name',c.nspname||'.'||c.relname,'owner',pg_catalog.pg_get_userbyid(c.relowner),
  'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'kind',c.relkind::text,'persistence',c.relpersistence::text,
  'options',COALESCE(pg_catalog.to_jsonb(c.reloptions),'[]'::jsonb),
  'parents',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.pg_describe_object('pg_catalog.pg_class'::regclass,i.inhparent,0) ORDER BY i.inhseqno) FROM pg_catalog.pg_inherits i WHERE i.inhrelid=c.oid),'[]'::jsonb),
  'triggers',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'name',t.tgname,'definition',pg_catalog.pg_get_triggerdef(t.oid,false),'function',fn.nspname||'.'||f.proname||'('||pg_catalog.oidvectortypes(f.proargtypes)||')',
   'enabled',t.tgenabled::text,'constraint',t.tgconstraint<>0,'deferrable',t.tgdeferrable,'initiallyDeferred',t.tginitdeferred,'oldTransitionTable',t.tgoldtable,'newTransitionTable',t.tgnewtable
  ) ORDER BY t.tgname) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc f ON f.oid=t.tgfoid JOIN pg_catalog.pg_namespace fn ON fn.oid=f.pronamespace WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),'[]'::jsonb),
  'rules',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_ruledef(r.oid,false) ORDER BY r.rulename) FROM pg_catalog.pg_rewrite r WHERE r.ev_class=c.oid),'[]'::jsonb),
  'columns',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'name',a.attname,'position',a.attnum,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
   'notNull',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid,false),
   'identity',a.attidentity::text,'generated',a.attgenerated::text,
   'collation',(SELECT n.nspname||'.'||co.collname FROM pg_catalog.pg_collation co JOIN pg_catalog.pg_namespace n ON n.oid=co.collnamespace WHERE co.oid=a.attcollation)
  ) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb),
  'constraints',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'name',k.conname,'type',k.contype::text,'definition',pg_catalog.pg_get_constraintdef(k.oid,false),
   'validated',k.convalidated,'deferrable',k.condeferrable,'deferred',k.condeferred,
   'referencedTable',(SELECT n.nspname||'.'||ref.relname FROM pg_catalog.pg_class ref JOIN pg_catalog.pg_namespace n ON n.oid=ref.relnamespace WHERE ref.oid=k.confrelid)
  ) ORDER BY k.conname) FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid),'[]'::jsonb),
  'indexes',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'name',ic.relname,'definition',pg_catalog.pg_get_indexdef(i.indexrelid,0,false),'valid',i.indisvalid,
   'ready',i.indisready,'unique',i.indisunique,'primary',i.indisprimary,'nullsNotDistinct',i.indnullsnotdistinct
  ) ORDER BY ic.relname) FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=c.oid),'[]'::jsonb),
  'policies',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'name',p.polname,'command',p.polcmd::text,'permissive',p.polpermissive,
   'roles',(SELECT pg_catalog.jsonb_agg(CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(role_oid) END ORDER BY role_oid) FROM pg_catalog.unnest(p.polroles) AS role_oid),
   'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid,false),'check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid,false)
  ) ORDER BY p.polname) FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid),'[]'::jsonb),
  'acl',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'grantor',pg_catalog.pg_get_userbyid(x.grantor),'grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x.grantee) END,
   'privilege',x.privilege_type,'grantable',x.is_grantable
  ) ORDER BY x.grantor,x.grantee,x.privilege_type) FROM pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) x),'[]'::jsonb),
  'columnAcl',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('column',a.attname,'acl',
   (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantor',pg_catalog.pg_get_userbyid(x.grantor),'grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x.grantee) END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY x.grantor,x.grantee,x.privilege_type),'[]'::jsonb) FROM pg_catalog.aclexplode(a.attacl) x)
  ) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL),'[]'::jsonb)
 ) ORDER BY c.nspname,c.relname) FROM relations c WHERE c.relkind='r'),'[]'::jsonb),
 'routines',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'signature',p.nspname||'.'||p.proname||'('||pg_catalog.oidvectortypes(p.proargtypes)||')',
  'owner',pg_catalog.pg_get_userbyid(p.proowner),'definition',CASE WHEN p.prokind='f' THEN pg_catalog.pg_get_functiondef(p.oid) ELSE NULL END,
  'language',p.lanname,'result',pg_catalog.pg_get_function_result(p.oid),'kind',p.prokind::text,
  'securityDefiner',p.prosecdef,'leakproof',p.proleakproof,'strict',p.proisstrict,'volatility',p.provolatile::text,'parallel',p.proparallel::text,
  'config',COALESCE(pg_catalog.to_jsonb(p.proconfig),'[]'::jsonb),'acl',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'grantor',pg_catalog.pg_get_userbyid(x.grantor),'grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x.grantee) END,
   'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY x.grantor,x.grantee,x.privilege_type) FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) x),'[]'::jsonb)
 ) ORDER BY p.nspname,p.proname,p.proargtypes::text) FROM routines p),'[]'::jsonb),
 'principals',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'name',rolname,'login',rolcanlogin,'inherit',rolinherit,'super',rolsuper,'bypassRls',rolbypassrls,'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,
  'connectionLimit',rolconnlimit,'validUntil',rolvaliduntil::text,'config',COALESCE(pg_catalog.to_jsonb(rolconfig),'[]'::jsonb)
 ) ORDER BY rolname) FROM principals),'[]'::jsonb),
 'namespaces',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',n.nspname,'owner',pg_catalog.pg_get_userbyid(n.nspowner),'acl',
  COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantor',pg_catalog.pg_get_userbyid(x.grantor),'grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x.grantee) END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY x.grantor,x.grantee,x.privilege_type) FROM pg_catalog.aclexplode(COALESCE(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) x),'[]'::jsonb)
 ) ORDER BY n.nspname) FROM namespaces n),'[]'::jsonb),
 'role_memberships',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'role',pg_catalog.pg_get_userbyid(m.roleid),'member',pg_catalog.pg_get_userbyid(m.member),'grantor',pg_catalog.pg_get_userbyid(m.grantor),'adminOption',m.admin_option,'inheritOption',m.inherit_option,'setOption',m.set_option
 ) ORDER BY m.roleid,m.member,m.grantor) FROM pg_catalog.pg_auth_members m WHERE m.roleid IN(SELECT oid FROM principals) OR m.member IN(SELECT oid FROM principals)),'[]'::jsonb),
 'default_acls',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'role',pg_catalog.pg_get_userbyid(d.defaclrole),'schema',(SELECT nspname FROM pg_catalog.pg_namespace WHERE oid=d.defaclnamespace),'objectType',d.defaclobjtype::text,
  'acl',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('grantor',pg_catalog.pg_get_userbyid(x.grantor),'grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x.grantee) END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY x.grantor,x.grantee,x.privilege_type) FROM pg_catalog.aclexplode(d.defaclacl) x),'[]'::jsonb)
 ) ORDER BY d.defaclrole,d.defaclnamespace,d.defaclobjtype) FROM pg_catalog.pg_default_acl d WHERE d.defaclrole IN(SELECT oid FROM principals) OR d.defaclnamespace IN(SELECT oid FROM namespaces)),'[]'::jsonb),
 'dependency_contracts',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('name','catalog-dependencies','kind','pg16-dependency-graph','sha256',
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(dependent,referenced,kind) ORDER BY dependent,referenced,kind) FROM dependency_edges),'[]'::jsonb)::text,'UTF8')),'hex')))
) AS projection,
COALESCE((SELECT pg_catalog.jsonb_agg(reason ORDER BY reason) FROM (
 SELECT 'relation-kind:'||nspname||'.'||relname||':'||relkind::text AS reason FROM relations WHERE relkind NOT IN('r','i')
 UNION ALL SELECT 'routine-kind:'||nspname||'.'||proname||':'||prokind::text FROM routines WHERE prokind<>'f'
 UNION ALL SELECT 'event-trigger:'||evtname FROM pg_catalog.pg_event_trigger
 UNION ALL SELECT 'disabled-internal-trigger:'||c.nspname||'.'||c.relname FROM pg_catalog.pg_trigger t JOIN relations c ON c.oid=t.tgrelid WHERE t.tgisinternal AND t.tgenabled<>'O'
 UNION ALL SELECT 'unsupported-trigger:'||c.nspname||'.'||c.relname||'.'||t.tgname FROM pg_catalog.pg_trigger t JOIN relations c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND (t.tgparentid<>0 OR t.tgnargs<>0 OR t.tgoldtable IS NOT NULL OR t.tgnewtable IS NOT NULL)
 UNION ALL SELECT 'unstable-index:'||c.nspname||'.'||c.relname FROM pg_catalog.pg_index i JOIN relations c ON c.oid=i.indexrelid WHERE NOT i.indisvalid OR NOT i.indisready OR NOT i.indislive OR i.indcheckxmin
 UNION ALL SELECT 'role-outside-scope:'||pg_catalog.pg_get_userbyid(role_oid) FROM (
  SELECT relowner AS role_oid FROM relations
  UNION SELECT proowner FROM routines
  UNION SELECT nspowner FROM namespaces
  UNION SELECT roleid FROM pg_catalog.pg_auth_members WHERE member IN(SELECT oid FROM principals)
  UNION SELECT member FROM pg_catalog.pg_auth_members WHERE roleid IN(SELECT oid FROM principals)
  UNION SELECT grantor FROM pg_catalog.pg_auth_members WHERE roleid IN(SELECT oid FROM principals) OR member IN(SELECT oid FROM principals)
  UNION SELECT x.grantee FROM relations c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) x
  UNION SELECT x.grantor FROM relations c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) x
  UNION SELECT x.grantee FROM routines p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) x
  UNION SELECT x.grantor FROM routines p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) x
  UNION SELECT x.grantee FROM namespaces n CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) x
  UNION SELECT x.grantor FROM namespaces n CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) x
  UNION SELECT x.grantee FROM pg_catalog.pg_attribute a JOIN relations c ON c.oid=a.attrelid CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) x
  UNION SELECT x.grantor FROM pg_catalog.pg_attribute a JOIN relations c ON c.oid=a.attrelid CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) x
  UNION SELECT x.grantee FROM pg_catalog.pg_default_acl d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) x WHERE d.defaclrole IN(SELECT oid FROM principals) OR d.defaclnamespace IN(SELECT oid FROM namespaces)
  UNION SELECT x.grantor FROM pg_catalog.pg_default_acl d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) x WHERE d.defaclrole IN(SELECT oid FROM principals) OR d.defaclnamespace IN(SELECT oid FROM namespaces)
 ) referenced_roles WHERE role_oid<>0 AND role_oid NOT IN(SELECT oid FROM principals)
 UNION ALL SELECT 'unscoped-schema:'||nspname FROM pg_catalog.pg_namespace WHERE nspname NOT IN('public','platform','information_schema') AND nspname NOT LIKE 'pg\_%' ESCAPE '\'
) unsupported),'[]'::jsonb) AS unsupported;
