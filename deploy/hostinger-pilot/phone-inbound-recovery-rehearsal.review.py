"""LOCAL REVIEW ONLY until separately pinned and approved. Source stays read-only; DDL only in owned clone."""
import base64
import hashlib
import json
import re
import signal
import subprocess
import sys
import types

JOURNAL_CATALOG = """SELECT json_build_object(
 'table',(SELECT json_build_object('owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forced',c.relforcerowsecurity,'kind',c.relkind,'persistence',c.relpersistence,'options',c.reloptions)
  FROM pg_class c WHERE c.oid='public.phone_inbound_call_events'::regclass),
 'columns',(SELECT json_agg(json_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'required',a.attnotnull,
  'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,
  'collation',(SELECT n.nspname||'.'||co.collname FROM pg_collation co JOIN pg_namespace n ON n.oid=co.collnamespace WHERE co.oid=a.attcollation)) ORDER BY a.attnum)
  FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attrelid='public.phone_inbound_call_events'::regclass AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT json_agg(json_build_array(conname,contype,convalidated,pg_get_constraintdef(oid,true)) ORDER BY conname)
  FROM pg_constraint WHERE conrelid='public.phone_inbound_call_events'::regclass),
 'indexes',(SELECT json_agg(json_build_array(pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready) ORDER BY c.relname)
  FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='public.phone_inbound_call_events'::regclass),
 'policies',(SELECT json_agg(json_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,
   'roles',(SELECT json_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END ORDER BY CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END) FROM unnest(p.polroles) AS r),
   'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname)
  FROM pg_policy p WHERE p.polrelid='public.phone_inbound_call_events'::regclass),
 'grants',(SELECT json_agg(json_build_array(pg_get_userbyid(x.grantor),CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,x.privilege_type,x.is_grantable)
  ORDER BY pg_get_userbyid(x.grantor),CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,x.privilege_type) FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) x
  WHERE c.oid='public.phone_inbound_call_events'::regclass),
 'columnGrants',(SELECT COALESCE(json_agg(json_build_array(a.attname,pg_get_userbyid(x.grantor),CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,x.privilege_type,x.is_grantable)
  ORDER BY a.attname,pg_get_userbyid(x.grantor),CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,x.privilege_type),'[]'::json) FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
  WHERE a.attrelid='public.phone_inbound_call_events'::regclass AND a.attnum>0)
)"""
FINAL_PRIVILEGES = """SELECT json_build_object(
 'principalsRls',(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.phone_inbound_principals'::regclass),
 'roles',(SELECT count(*)=2 AND bool_and(NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit)
  FROM pg_roles WHERE rolname IN('thaara_phone_ingest','thaara_phone_guard')),
 'functionOwners',(SELECT count(*)=3 AND bool_and(pg_get_userbyid(proowner)='thaara_phone_guard') FROM pg_proc
  WHERE pronamespace='public'::regnamespace AND proname IN('phone_inbound_resolve_grant','phone_inbound_scope_matches','phone_inbound_append_event')),
 'appDenied',NOT has_function_privilege('thaara_app','public.phone_inbound_append_event(jsonb)','EXECUTE'),
 'ingestAllowed',has_function_privilege('thaara_phone_ingest','public.phone_inbound_append_event(jsonb)','EXECUTE'),
 'guardSchemaCreateDenied',NOT has_schema_privilege('thaara_phone_guard','public','CREATE'),
 'functionsAcl',NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) x
  WHERE p.pronamespace='public'::regnamespace AND p.proname IN('phone_inbound_resolve_grant','phone_inbound_scope_matches','phone_inbound_append_event')
   AND (x.grantee=0 OR pg_get_userbyid(x.grantee) NOT IN('thaara_phone_guard','thaara_phone_ingest')
    OR (pg_get_userbyid(x.grantee)='thaara_phone_ingest' AND p.oid NOT IN('public.phone_inbound_resolve_grant(text,text,text)'::regprocedure,'public.phone_inbound_append_event(jsonb)'::regprocedure))
    OR (x.is_grantable AND x.grantee<>p.proowner))),
 'principalsAcl',NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) x
  WHERE c.oid='public.phone_inbound_principals'::regclass AND x.grantee<>c.relowner
   AND (x.grantee=0 OR pg_get_userbyid(x.grantee)<>'thaara_phone_guard' OR x.privilege_type<>'SELECT' OR x.is_grantable)),
 'principalColumnAcl',NOT EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
  WHERE a.attrelid='public.phone_inbound_principals'::regclass AND
   pg_get_userbyid(x.grantee)<>'postgres' AND
   (x.grantee=0 OR pg_get_userbyid(x.grantee)<>'thaara_phone_guard' OR a.attname<>'revoked_at' OR x.privilege_type<>'UPDATE' OR x.is_grantable)),
 'noRoleMemberships',NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN(SELECT oid FROM pg_roles WHERE rolname IN('thaara_phone_guard','thaara_phone_ingest'))
  OR member IN(SELECT oid FROM pg_roles WHERE rolname IN('thaara_phone_guard','thaara_phone_ingest'))))"""
FUNCTION_ROLE_CATALOG = """SELECT json_build_object(
 'functions',(SELECT json_agg(json_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'definition',pg_get_functiondef(p.oid),
  'acl',(SELECT json_agg(json_build_array(pg_get_userbyid(x.grantor),CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,x.privilege_type,x.is_grantable)
   ORDER BY pg_get_userbyid(x.grantor),CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,x.privilege_type)
   FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) x)) ORDER BY p.oid::regprocedure::text)
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN('phone_inbound_resolve_grant','phone_inbound_scope_matches','phone_inbound_append_event')),
 'roles',(SELECT json_agg(json_build_object('name',rolname,'login',rolcanlogin,'inherit',rolinherit,'super',rolsuper,'bypass',rolbypassrls,'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,'config',rolconfig) ORDER BY rolname)
  FROM pg_roles WHERE rolname IN('thaara_phone_guard','thaara_phone_ingest'))
)"""

def sha(data):
    return hashlib.sha256(data).hexdigest()

def capture_status():
    # Observation is NOT independent approval of an expected schema fingerprint.
    return {'catalogPurpose':'observed_unapproved_baseline','independentBaselineVerified':False}

def recount_source(core, docker, expected):
    session=core['Snapshot'](docker,core['SOURCE_ID'],'postgres')
    try:observed=core['counts'](session)
    finally:session.close()
    core['require'](isinstance(observed,dict) and all(isinstance(k,str) and type(v) is int and v>=0 for k,v in observed.items()),'source_recount_invalid')
    # A mismatch may be concurrent legitimate writes; never infer who changed the source.
    return observed==expected

def validate_function_catalog(functions):
    allowed={
      'public.phone_inbound_resolve_grant(text,text,text)':{'thaara_phone_guard','thaara_phone_ingest'},
      'public.phone_inbound_scope_matches(uuid,uuid)':{'thaara_phone_guard'},
      'public.phone_inbound_append_event(jsonb)':{'thaara_phone_guard','thaara_phone_ingest'}}
    if not isinstance(functions,list) or len(functions)!=3:raise ValueError('function_catalog_shape')
    seen=set()
    for f in functions:
        if not isinstance(f,dict) or set(f)!={'signature','owner','definition','acl'} or f['signature'] not in allowed or f['signature'] in seen or f['owner']!='thaara_phone_guard' or not isinstance(f['definition'],str) or not f['definition'] or not isinstance(f['acl'],list):raise ValueError('function_catalog_shape')
        seen.add(f['signature']);grantees=set()
        for grant in f['acl']:
            if not isinstance(grant,list) or len(grant)!=4 or grant[1] not in allowed[f['signature']] or grant[2]!='EXECUTE' or type(grant[3]) is not bool or (grant[1]!='thaara_phone_guard' and grant[3]):raise ValueError('function_execute_acl')
            grantees.add(grant[1])
        if grantees!=allowed[f['signature']]:raise ValueError('function_execute_acl')

def canonical_catalog(value, kind='journal'):
    if kind not in {'journal','principals'}:raise ValueError('catalog_kind')
    if not isinstance(value,dict) or set(value)!={'table','columns','constraints','indexes','policies','grants','columnGrants'}:
        raise ValueError('catalog_shape')
    if not isinstance(value['table'],dict) or set(value['table'])!={'owner','rls','forced','kind','persistence','options'} or value['table'].get('owner')!='postgres' or value['table'].get('rls') is not True or value['table'].get('forced') is not True or value['table'].get('kind')!='r' or value['table'].get('persistence')!='p':
        raise ValueError('catalog_guard')
    for key in ['columns','constraints','indexes','policies','grants','columnGrants']:
        if not isinstance(value[key],list) or (not value[key] and key!='columnGrants'):
            raise ValueError('catalog_shape')
    for grant in value['grants']:
        if not isinstance(grant,list) or len(grant)!=4:raise ValueError('catalog_acl')
        if grant[1]!='postgres' and (grant[1] not in ({'thaara_app','thaara_phone_guard'} if kind=='journal' else {'thaara_phone_guard'}) or grant[2] not in ({'SELECT','INSERT'} if kind=='journal' else {'SELECT'}) or grant[3] is not False):raise ValueError('catalog_acl')
    if kind=='journal' and value['columnGrants']:raise ValueError('catalog_column_acl')
    for grant in value['columnGrants']:
        if not isinstance(grant,list) or len(grant)!=5 or (grant[2]!='postgres' and (grant[0]!='revoked_at' or grant[2]!='thaara_phone_guard' or grant[3]!='UPDATE' or grant[4] is not False)):raise ValueError('catalog_column_acl')
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()

def secure_process_args(command, source_id, read_options):
    if not isinstance(command,list) or command[:2]!=['docker','--host=unix:///var/run/docker.sock']:
        raise ValueError('docker_endpoint')
    args=command[2:]
    if not args or args[0]!='exec':
        return ['/usr/bin/docker',*command[1:]]
    options=[];i=1;readonly=False
    while i<len(args):
        if args[i]=='-i':options.append('-i');i+=1
        elif args[i]=='--user' and i+1<len(args) and args[i+1]=='postgres':options.extend(args[i:i+2]);i+=2
        elif args[i]=='-e' and i+1<len(args):
            entry=args[i+1];key=entry.split('=',1)[0]
            if key not in {'PGHOST','PGHOSTADDR','PGPORT','PGPASSWORD','PGPASSFILE','PGCLIENTENCODING','PGOPTIONS'}:raise ValueError('client_environment')
            readonly=readonly or key=='PGOPTIONS';i+=2
        else:break
    if i>=len(args) or not re.fullmatch('[a-f0-9]{64}',args[i]):raise ValueError('exec_target')
    cid=args[i];client=args[i+1:]
    if not client:raise ValueError('exec_command')
    env=['/usr/bin/env','-i','PATH=/usr/local/bin:/usr/bin:/bin','HOME=/nonexistent','PGHOST=/var/run/postgresql','PGPORT=5432',
         'PGCONNECT_TIMEOUT=5','PGPASSFILE=/nonexistent/thaara-no-passfile','PGSERVICEFILE=/nonexistent/thaara-no-service','PGSYSCONFDIR=/nonexistent','PGCLIENTENCODING=UTF8']
    if cid==source_id or readonly:env.append('PGOPTIONS='+read_options)
    return ['/usr/bin/docker','--host=unix:///var/run/docker.sock','exec',*options,cid,*env,*client]

def prepare_core(source, expected_sha):
    if not re.fullmatch('[a-f0-9]{64}',expected_sha or '') or sha(source)!=expected_sha:raise ValueError('core_checksum')
    text=source.decode()
    if any(x in text for x in ['def migration_inputs(', 'def migrate(', 'def run_with_migration(', 'def main(']):raise ValueError('core_scope')
    old="        save_json(folder / 'verified.json', {'countsVerified': True,"
    if text.count(old)!=1:raise ValueError('core_hook_boundary')
    text=text.replace(old,"        phase = 'clone_inbound_schema_rehearsal'\n        rehearsal = rehearse_clone(docker, ident, bootstrap, folder, source_counts)\n        receipt.update(sourceCountsRechecked=False, sourceCountsMatchSnapshot=None)\n        receipt['sourceCountsMatchSnapshot'] = recount_source(docker, source_counts)\n        receipt['sourceCountsRechecked'] = True\n        require(receipt['sourceCountsMatchSnapshot'] is True, 'source_counts_changed_during_rehearsal')\n        require(docker.source() == before, 'source_changed_during_restore')\n        require(all(digest(folder / name) == value for name, value in backup_hashes.items()), 'backup_changed_during_restore')\n"+old)
    old="receipt.update(status='verified', backupDirectory=str(folder), tableCount=len(source_counts), countsVerified=True,"
    if text.count(old)!=1:raise ValueError('core_receipt_boundary')
    text=text.replace(old,"receipt.update(catalogPurpose='observed_unapproved_baseline', independentBaselineVerified=False, cloneSchemaRehearsed=True, journalCatalogSha256=rehearsal['journalCatalogSha256'], finalCatalogSha256=rehearsal['finalCatalogSha256'], status='verified', backupDirectory=str(folder), tableCount=len(source_counts), countsVerified=True,")
    text=text.replace("folder = BASE / ('phone110-'", "folder = BASE / ('phone113-rehearsal-'")
    core={'__name__':'thaara_inbound_recovery_core'}
    exec(compile(text,'<pinned-backup-core>','exec'),core)
    core['ENV']={**core['ENV'],'HOME':'/nonexistent','DOCKER_CONFIG':'/nonexistent'}
    core['READ_OPTIONS']+=' -c search_path=pg_catalog'
    core['recount_source']=lambda docker,expected:recount_source(core,docker,expected)
    original_category=core['diagnostic_category']
    core['diagnostic_category']=lambda e:'source_count_drift' if isinstance(e,core['Refusal']) and str(e)=='source_counts_changed_during_rehearsal' else original_category(e)
    def popen(command,**kwargs):
        env=kwargs.get('env')
        if not isinstance(env,dict) or set(env)-{'PATH','LC_ALL','HOME','DOCKER_CONFIG','PGOPTIONS','POSTGRES_USER','POSTGRES_DB','POSTGRES_PASSWORD'}:raise ValueError('process_environment')
        kwargs['env']={**env,'HOME':'/nonexistent','DOCKER_CONFIG':'/nonexistent'}
        return subprocess.Popen(secure_process_args(command,core['SOURCE_ID'],core['READ_OPTIONS']),**kwargs)
    core['subprocess']=types.SimpleNamespace(Popen=popen,TimeoutExpired=subprocess.TimeoutExpired,PIPE=subprocess.PIPE,DEVNULL=subprocess.DEVNULL)
    return core

def rehearse_clone(core, sql_parts, docker, ident, bootstrap, folder, source_counts):
    core['require'](core['valid_id'](ident.get('id')) and ident['id']!=core['SOURCE_ID'],'unsafe_clone_schema_target')
    docker.fixture(ident)
    def read_value(query):
        session=core['Snapshot'](docker,ident['id'],'postgres')
        try:return session.value(query)
        finally:session.close()
    def apply(step):
        docker.fixture(ident)
        text,expected=sql_parts[step]
        core['require'](sha(text)==expected,'clone_sql_checksum')
        path=folder/(str(step)+'h.sql')
        with core['private_file'](path) as out:
            out.write(("SELECT set_config('thaara.step%d_hosted_install_approved','owner-approved-inbound-hosted-install-v1',false);\n"%step).encode()+text)
            out.flush();core['os'].fsync(out.fileno())
        with path.open('rb') as incoming:
            docker(['exec','-i','--user','postgres',ident['id'],'psql','-w','-X','-q','-U','postgres','-d',core['DATABASE'],'-v','ON_ERROR_STOP=1'],input=incoming,timeout=60)
    apply(112)
    catalog=canonical_catalog(read_value(JOURNAL_CATALOG))
    core['save_json'](folder/'journal-112-catalog.json',json.loads(catalog))
    journal_hash=sha(catalog)
    apply(113)
    facts=read_value(FINAL_PRIVILEGES)
    core['require'](isinstance(facts,dict) and set(facts)=={'principalsRls','roles','functionOwners','appDenied','ingestAllowed','guardSchemaCreateDenied','functionsAcl','principalsAcl','principalColumnAcl','noRoleMemberships'} and all(v is True for v in facts.values()),'clone_final_privileges')
    after=core['Snapshot'](docker,ident['id'],bootstrap)
    try:counts=core['counts'](after)
    finally:after.close()
    # Match the reviewed core's schema/table JSON-pair count keys, not relation OIDs or row data.
    expected={**source_counts,json.dumps(['public','phone_inbound_call_events']):0,json.dumps(['public','phone_inbound_principals']):0}
    core['verify_counts'](expected,counts)
    principals=json.loads(canonical_catalog(read_value(JOURNAL_CATALOG.replace('phone_inbound_call_events','phone_inbound_principals')),'principals'))
    functions=read_value(FUNCTION_ROLE_CATALOG)
    core['require'](isinstance(functions,dict) and set(functions)=={'functions','roles'} and isinstance(functions['functions'],list) and len(functions['functions'])==3 and isinstance(functions['roles'],list) and len(functions['roles'])==2,'clone_final_catalog')
    validate_function_catalog(functions['functions'])
    final={'privileges':facts,'journal':json.loads(canonical_catalog(read_value(JOURNAL_CATALOG))),'principals':principals,'functionsAndRoles':functions}
    core['save_json'](folder/'final-inbound-catalog.json',final)
    final_hash=sha(json.dumps(final,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode())
    artifacts=['112h.sql','113h.sql','journal-112-catalog.json','final-inbound-catalog.json']
    core['save_json'](folder/'clone-schema-rehearsal.json',{**capture_status(),'sql112Sha256':sql_parts[112][1],'sql113Sha256':sql_parts[113][1],
      'journalCatalogSha256':journal_hash,'finalCatalogSha256':final_hash,'filesSha256':{name:core['digest'](folder/name) for name in artifacts}})
    return {**capture_status(),'journalCatalogSha256':journal_hash,'finalCatalogSha256':final_hash}

def main():
    if sys.argv[1:]!=['--approved-inbound-backup-rehearsal']:
        print(json.dumps({'status':'review_only','sourceDatabaseReadOnly':True,'cloneSchemaRehearsal':True,'executionAllowed':False}));return 0
    try:
        core=prepare_core(base64.b64decode(CORE_SOURCE_B64,validate=True),CORE_SOURCE_SHA256)
        sql_parts={int(k):(base64.b64decode(v['base64'],validate=True),v['sha256']) for k,v in INBOUND_SQL.items()}
        if set(sql_parts)!={112,113}:raise ValueError('sql_scope')
        for body,pin in sql_parts.values():
            if not re.fullmatch('[a-f0-9]{64}',pin) or sha(body)!=pin:raise ValueError('sql_checksum')
        docker=core['Docker']();cid=docker.field(core['SOURCE_NAME'],'.Id')
        if not core['valid_id'](cid):raise ValueError('source_identity')
        core['SOURCE_ID']=cid
        core['rehearse_clone']=lambda *a:rehearse_clone(core,sql_parts,*a)
        def cancelled(*_):raise core['Refusal']('operator_interrupted_or_deadline')
        for sig in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGALRM):signal.signal(sig,cancelled)
        signal.alarm(600)
        result=core['run']();signal.alarm(0)
        print(json.dumps(result,sort_keys=True));return 0 if result.get('status')=='verified' and result.get('cleanupVerified') is True and result.get('cloneSchemaRehearsed') is True else 1
    except Exception:
        print(json.dumps({'status':'failed','phase':'review_inputs_or_runtime','sourceMutated':False,'providerCalls':0,'cleanupVerified':False}));return 1

if __name__=='__main__':sys.exit(main())
