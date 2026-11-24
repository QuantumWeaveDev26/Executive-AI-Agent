"""Review-only payload. Metadata/catalog reads; no settings repair, data rows or secrets."""
import json, re, subprocess, sys

IMAGE = 'postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
CATALOG_SQL = """BEGIN READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='5s';
SELECT json_build_object(
 'databaseMatched',current_database()='thaara_vps_pilot',
 'postgres16',current_setting('server_version_num')::integer BETWEEN 160000 AND 169999,
 'baseSchemaPresent',to_regclass('public.workspaces') IS NOT NULL AND to_regclass('public.users') IS NOT NULL
  AND to_regclass('public.memberships') IS NOT NULL AND to_regclass('public.audit_events') IS NOT NULL
  AND to_regprocedure('public.current_authenticated_scope()') IS NOT NULL
  AND to_regprocedure('public.resolve_session_scope(text)') IS NOT NULL,
 'journalPresent',to_regclass('public.phone_inbound_call_events') IS NOT NULL,
 'principalTablePresent',to_regclass('public.phone_inbound_principals') IS NOT NULL,
 'ingestRolePresent',EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='thaara_phone_ingest'),
 'guardRolePresent',EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='thaara_phone_guard'),
 'appendFunctionPresent',to_regprocedure('public.phone_inbound_append_event(jsonb)') IS NOT NULL,
 'resolveGrantFunctionPresent',to_regprocedure('public.phone_inbound_resolve_grant(text,text,text)') IS NOT NULL,
 'scopeMatchFunctionPresent',to_regprocedure('public.phone_inbound_scope_matches(uuid,uuid)') IS NOT NULL
);
COMMIT;
"""
CATALOG_KEYS = {'databaseMatched','postgres16','baseSchemaPresent','journalPresent','principalTablePresent',
 'ingestRolePresent','guardRolePresent','appendFunctionPresent','resolveGrantFunctionPresent','scopeMatchFunctionPresent'}

def command(args, body=None):
    return subprocess.run(args, input=body, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=12, check=True, env={'PATH':'/usr/bin:/bin','LC_ALL':'C','HOME':'/nonexistent','DOCKER_CONFIG':'/nonexistent'}).stdout.strip()

def docker(*args):
    return ['/usr/bin/docker','--host','unix:///var/run/docker.sock',*args]

def inventory(run=command):
    phase = 'container_identity'
    try:
        cid = run(docker('inspect','--format','{{.Id}}','thaara-v2-pilot-postgres-1'))
        if not re.fullmatch('[a-f0-9]{64}',cid): raise ValueError()
        image = run(docker('image','inspect','--format','{{.Id}}',IMAGE))
        if not re.fullmatch('sha256:[a-f0-9]{64}',image): raise ValueError()
        fmt = '{{.Image}}|{{.State.Running}}|{{.State.Health.Status}}|{{.RestartCount}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}'
        facts = run(docker('inspect','--format',fmt,cid))
        if not re.fullmatch(re.escape(image)+r'\|true\|healthy\|[0-9]+\|thaara-v2-pilot\|postgres',facts): raise ValueError()
        phase = 'readonly_catalog'
        data = json.loads(run(docker('exec','-i',cid,'/usr/bin/env','-i','PATH=/usr/local/bin:/usr/bin:/bin','HOME=/nonexistent',
          'PGPASSFILE=/dev/null','PGSERVICEFILE=/dev/null','PGSYSCONFDIR=/nonexistent','PGCONNECT_TIMEOUT=5',
          '/usr/local/bin/psql','-X','-w','-q','-A','-t','-h','/var/run/postgresql','-p','5432','-U','postgres','-d','thaara_vps_pilot','-v','ON_ERROR_STOP=1'),CATALOG_SQL))
        if not isinstance(data,dict) or set(data)!=CATALOG_KEYS or any(type(v) is not bool for v in data.values()): raise ValueError()
        if not all(data[k] for k in ['databaseMatched','postgres16','baseSchemaPresent']): raise ValueError()
        phase = 'identity_recheck'
        if run(docker('inspect','--format',fmt,cid)) != facts: raise ValueError()
        return {'status':'passed','sourceHealthy':True,'imageMatched':True,'catalogReadOnly':True,'inventory':data}
    except Exception as error:
        kind = 'timeout' if isinstance(error,subprocess.TimeoutExpired) else 'command_failed' if isinstance(error,subprocess.CalledProcessError) else 'validation_failed'
        return {'status':'stopped','phase':phase,'kind':kind}

if __name__=='__main__':
    result=inventory(); print(json.dumps(result,separators=(',',':')))
    sys.exit(0 if result['status']=='passed' else 1)
