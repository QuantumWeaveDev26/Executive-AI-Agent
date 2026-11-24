"""Owner-authorized LOCAL synthetic PG16.15 rehearsal. Never accesses SSH or production."""
import hashlib
import difflib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location('reviewed_phone_backup', ROOT / 'deploy/hostinger-pilot/phone-backup-restore.review.py')
_backup = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_backup)
DOCKER = r'C:\Users\Admin\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe'
IMAGE = 'sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
SQL_PATH = ROOT / 'docs/migrations/115-step115-hosted-install-20261111-r2.review.sql'
SQL_HASH = 'c809ba7c0a44f9bdf3b76a1566edf1fbe6fc33e39a1d0c1d25e58a53025dcf8e'
DATABASE = 'thaara_vps_pilot'
APPROVAL = "SET thaara.step115_hosted_install_approved='owner-approved-step115-hosted-install-r3-acl';\n"
NEW_TABLES = {'phone_inbound_call_events', 'phone_inbound_principals', 'phone_callback_requests',
              'phone_callback_notification_grants', 'phone_callback_notification_grant_uses',
              'phone_callback_worker_principals', 'phone_callback_dispatch_numbers'}
OPERATIONS_REPARSE = {
    b"    CONSTRAINT phone_inbound_principals_operations_check CHECK ((((operations = ARRAY['callback'::text]) OR (operations = ARRAY['completion'::text])) OR (operations = ARRAY['callback'::text, 'completion'::text]))),\n":
    b"    CONSTRAINT phone_inbound_principals_operations_check CHECK (((operations = ARRAY['callback'::text]) OR (operations = ARRAY['completion'::text]) OR (operations = ARRAY['callback'::text, 'completion'::text]))),\n",
}


def digest(value):
    return hashlib.sha256(value).hexdigest()


def docker(*arguments, payload=None, timeout=90):
    process = subprocess.run([DOCKER, '--context', 'desktop-linux', *arguments], input=payload,
                             capture_output=True, timeout=timeout)
    if process.returncode:
        error = process.stderr.decode(errors='replace')
        state = re.search(r'ERROR:\s+([0-9A-Z]{5})', error)
        if b'step115_rehearsal_rollback_ready' in process.stdout and state and state[1] == 'P0001':
            raise RuntimeError('synthetic_rollback_verified:P0001')
        known = next((text for text in ['exact target', 'Base authorization boundaries', 'Unexpected',
                     'privilege admission failed', 'synthetic rollback', 'already exists', 'permission denied'] if text in error), 'command_failed')
        raise RuntimeError(known + (':' + state[1] if state else ''))
    return process.stdout


def owned(facts, nonce):
    if (facts['Image'] != IMAGE or facts['Config']['Labels'].get('thaara.step115.rehearsal') != nonce
        or facts['HostConfig']['NetworkMode'] != 'none' or facts['HostConfig']['PortBindings']
        or facts['HostConfig'].get('Binds') or any(mount['Type'] != 'tmpfs' for mount in facts['Mounts'])
        or not re.fullmatch('thaara-step115-' + nonce + '-(?:source|restore-before|restore-after)', facts['Name'].lstrip('/'))):
        raise RuntimeError('isolated_container_identity_denied')
    return facts['Id']


def inspect(name):
    return json.loads(docker('inspect', name))[0]


def start(name, nonce, bootstrap='postgres', database=DATABASE):
    identifier = docker('run', '--detach', '--pull=never', '--name', name, '--network', 'none',
        '--label', 'thaara.step115.rehearsal=' + nonce, '--memory', '768m', '--cpus', '1', '--pids-limit', '128',
        '--security-opt', 'no-new-privileges:true', '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,size=536870912',
        '--tmpfs', '/run/secrets:rw,noexec,nosuid,size=1048576',
        '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_USER=' + bootstrap,
        '-e', 'POSTGRES_DB=' + database, IMAGE).decode().strip()
    facts = inspect(identifier)
    if owned(facts, nonce) != identifier:
        raise RuntimeError('created_identity_mismatch')
    for _ in range(45):
        try:
            docker('exec', '--user', 'postgres', identifier, 'pg_isready', '-q', '-U', bootstrap, '-d', database, timeout=5)
            return identifier
        except RuntimeError:
            time.sleep(1)
    raise RuntimeError('local_database_not_ready')


def psql(identifier, sql, user='postgres', database=DATABASE):
    return docker('exec', '-i', '--user', 'postgres', identifier, 'psql', '-X', '-qAt', '-w',
                  '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-U', user, '-d', database,
                  payload=sql.encode() if isinstance(sql, str) else sql)


def rows(identifier):
    names = psql(identifier, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;").decode().splitlines()
    if any(not re.fullmatch('[a-z_][a-z0-9_]*', name) for name in names):
        raise RuntimeError('fixture_table_name_denied')
    query = '\n'.join("SELECT json_build_object('table','%s','count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(entry)::text,E'\\n' ORDER BY to_jsonb(entry)::text),''))) FROM public.\"%s\" entry;" % (name, name) for name in names)
    return {row['table']: row for row in map(json.loads, psql(identifier, query).decode().splitlines())}


def schema(identifier):
    value = docker('exec', '--user', 'postgres', identifier, 'pg_dump', '-w', '-U', 'postgres', '-d', DATABASE, '--schema-only')
    # Exact observed PostgreSQL reparse only: (A OR B) OR C and A OR B OR C are equivalent.
    # Changed predicates, operations, grants and policies remain substantive differences.
    value = b''.join(OPERATIONS_REPARSE.get(line, line) for line in value.splitlines(keepends=True))
    value = _backup.canonical_schema(value).decode()
    # PG16.15 emits randomized psql restriction tokens. They are not database schema.
    return '\n'.join(line for line in value.splitlines() if line.strip() and not line.startswith(('--', '\\restrict ', '\\unrestrict '))).encode()


def roles(identifier):
    return json.loads(psql(identifier, "SELECT json_agg(r ORDER BY rolname) FROM (SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles WHERE rolname !~ '^pg_') r;"))


def access_metadata(identifier):
    return json.loads(psql(identifier, """SELECT json_build_object(
      'memberships',(SELECT coalesce(json_agg(r ORDER BY role_name,member_name,grantor_name),'[]'::json) FROM
        (SELECT pg_get_userbyid(roleid) AS role_name,pg_get_userbyid(member) AS member_name,
          pg_get_userbyid(grantor) AS grantor_name,admin_option,inherit_option,set_option
         FROM pg_auth_members WHERE pg_get_userbyid(roleid) !~ '^pg_' AND pg_get_userbyid(member)<>'thaara_rehearsal_bootstrap') r),
      'database',(SELECT row_to_json(d) FROM (SELECT pg_get_userbyid(datdba) AS owner,datacl,encoding,datcollate,datctype,datconnlimit
         FROM pg_database WHERE datname=current_database()) d));"""))


def backup_restore(identifier, nonce, label, active):
    before_rows, before_schema, before_roles = rows(identifier), schema(identifier), roles(identifier)
    before_access = access_metadata(identifier)
    backup = docker('exec', '--user', 'postgres', identifier, 'pg_dump', '-w', '-U', 'postgres', '-d', DATABASE, '--format=custom', '--create')
    role_sql = docker('exec', '--user', 'postgres', identifier, 'pg_dumpall', '-w', '-U', 'postgres', '--roles-only', '--no-role-passwords')
    name = 'thaara-step115-' + nonce + '-restore-' + label
    active.append(name)
    restored = start(name, nonce, bootstrap='thaara_rehearsal_bootstrap', database='postgres')
    psql(restored, role_sql, user='thaara_rehearsal_bootstrap', database='postgres')
    docker('exec', '-i', '--user', 'postgres', restored, 'pg_restore', '-w', '--exit-on-error', '--create', '--role', 'postgres',
           '-U', 'thaara_rehearsal_bootstrap', '-d', 'postgres', payload=backup)
    restored_roles = [role for role in roles(restored) if role['rolname'] != 'thaara_rehearsal_bootstrap']
    data_match = rows(restored) == before_rows
    restored_schema = schema(restored)
    schema_match = restored_schema == before_schema
    role_match = restored_roles == before_roles
    access_match = access_metadata(restored) == before_access
    if not data_match or not schema_match or not role_match or not access_match:
        differences = list(difflib.unified_diff(before_schema.decode().splitlines(), restored_schema.decode().splitlines(), n=0))
        # Synthetic schema diagnostics only; never emit row contents or role passwords.
        metadata_diff = [line for line in differences if line.startswith(('+', '-')) and not line.startswith(('+++', '---'))][:30]
        (ROOT / 'node_modules/.cache/phone-step115-local-schema.expected.sql').write_bytes(before_schema)
        (ROOT / 'node_modules/.cache/phone-step115-local-schema.restored.sql').write_bytes(restored_schema)
        raise RuntimeError('backup_restore_evidence_mismatch:' + json.dumps({'data': data_match, 'schema': schema_match, 'roles': role_match, 'access': access_match, 'aclDiff': metadata_diff}))
    return {'verified': True, 'backupSha256': digest(backup), 'schemaSha256': digest(before_schema),
            'tables': len(before_rows), 'roles': len(before_roles), 'membershipsAndDatabaseAccessMatch': access_match,
            'dumpStoredOnHost': False, 'rolePasswordsIncluded': False}


def main():
    nonce = secrets.token_hex(12)
    active = []
    phase = 'local_preflight'
    result = {'status': 'failed', 'syntheticOnly': True, 'productionAccess': False, 'providerRequests': 0,
              'activation': 'disabled', 'sqlSha256': SQL_HASH, 'image': IMAGE}
    try:
        sql = SQL_PATH.read_bytes()
        if digest(sql) != SQL_HASH:
            raise RuntimeError('sql_checksum_denied')
        endpoint = docker('context', 'inspect', 'desktop-linux', '--format', '{{.Endpoints.docker.Host}}').decode().strip()
        if endpoint != 'npipe:////./pipe/dockerDesktopLinuxEngine':
            raise RuntimeError('nonlocal_docker_endpoint_denied')
        if docker('image', 'inspect', IMAGE, '--format', '{{.Id}}').decode().strip() != IMAGE:
            raise RuntimeError('cached_image_mismatch')
        phase = 'synthetic_baseline'
        source_name = 'thaara-step115-' + nonce + '-source'
        active.append(source_name)
        source = start(source_name, nonce)
        if psql(source, 'SHOW server_version_num;').strip() != b'160015':
            raise RuntimeError('requires_exact_pg16_15')
        result['serverVersion'] = '160015'
        docker('exec', source, 'sh', '-c', 'chown postgres /run/secrets')
        docker('exec', '-i', '--user', 'postgres', source, 'sh', '-c', 'cat > /run/secrets/api_password', payload=secrets.token_urlsafe(48).encode())
        loader = "import {buildPilotDbBundle} from './deploy/hostinger-pilot/pilot-db-bundle.mjs';process.stdout.write(buildPilotDbBundle(process.cwd()).sql);"
        bundle = subprocess.run(['node', '--input-type=module', '-e', loader], cwd=ROOT, capture_output=True, timeout=60)
        if bundle.returncode:
            raise RuntimeError('local_baseline_bundle_failed')
        psql(source, bundle.stdout)
        for step, file in [('10825', '10825-whatsapp-templates-media-contacts.review.sql'), ('110a', '110a-phone-contacts.review.sql'), ('110b', '110b-phone-calls.review.sql'), ('110c', '110c-phone-live-mode.review.sql')]:
            if step == '10825':
                psql(source, (ROOT / 'docs/migrations/10821-whatsapp-media.review.sql').read_bytes())
            guard = "SELECT set_config('thaara.step%s_review_approved','yes',false),set_config('thaara.step%s_target_database',current_database(),false);\n" % (step, step)
            psql(source, guard.encode() + (ROOT / 'docs/migrations' / file).read_bytes())
        psql(source, "CREATE TABLE public.step115_shared_sentinel(feature text PRIMARY KEY,payload jsonb NOT NULL); INSERT INTO public.step115_shared_sentinel SELECT feature,jsonb_build_object('synthetic',true) FROM unnest(ARRAY['WhatsApp','Bulk Campaigns','Chat','Gmail','Calendar']) feature;")
        baseline_rows = rows(source)
        phase = 'backup_restore_before_install'
        result['beforeBackupRestore'] = backup_restore(source, nonce, 'before', active)
        phase = 'transaction_rollback'
        injected = sql.replace(b'\nCOMMIT;', b"\nSELECT 'step115_rehearsal_rollback_ready';\nDO $$ BEGIN RAISE EXCEPTION 'synthetic rollback'; END $$;\nCOMMIT;")
        try:
            psql(source, APPROVAL.encode() + injected)
            raise RuntimeError('rollback_failure_not_injected')
        except RuntimeError as error:
            if str(error) != 'synthetic_rollback_verified:P0001':
                raise
        if rows(source) != baseline_rows:
            raise RuntimeError('failed_transaction_changed_rows')
        result['rollbackVerified'] = True
        phase = 'exact_sql_install'
        psql(source, APPROVAL.encode() + sql)
        installed = rows(source)
        if {name: data for name, data in installed.items() if name not in NEW_TABLES} != baseline_rows or set(installed) - set(baseline_rows) != NEW_TABLES:
            raise RuntimeError('existing_data_or_table_boundary_changed')
        new_roles = [role for role in roles(source) if role['rolname'] in {'thaara_phone_ingest', 'thaara_phone_guard', 'thaara_phone_notify', 'thaara_phone_notify_guard'}]
        if len(new_roles) != 4 or any(role[key] for role in new_roles for key in ['rolcanlogin', 'rolsuper', 'rolinherit', 'rolbypassrls', 'rolcreatedb', 'rolcreaterole', 'rolreplication']):
            raise RuntimeError('new_role_not_disabled')
        rls = json.loads(psql(source, "SELECT json_agg(relname ORDER BY relname) FROM pg_class WHERE relnamespace='public'::regnamespace AND relrowsecurity AND relforcerowsecurity;"))
        if not NEW_TABLES.issubset(set(rls)) or any(installed[name]['count'] != 0 for name in NEW_TABLES):
            raise RuntimeError('new_table_rls_or_empty_state_denied')
        result.update(installationVerified=True, sharedRowsUnchanged=True, newTables=sorted(NEW_TABLES), newRolesNoLogin=True,
                      forcedRlsVerified=True, newTablesEmpty=True)
        phase = 'backup_restore_after_install'
        result['afterBackupRestore'] = backup_restore(source, nonce, 'after', active)
        result['status'] = 'verified'
    except Exception as error:
        result.update(phase=phase, category=str(error) if isinstance(error, RuntimeError) else type(error).__name__)
    finally:
        cleanup = True
        for name in reversed(active):
            try:
                facts = inspect(name)
                identifier = owned(facts, nonce)
                docker('rm', '--force', '--volumes', identifier)
                # Fixed unique name/label query, no other development resources.
                if docker('ps', '--all', '--quiet', '--filter', 'name=^/' + name + '$').strip():
                    cleanup = False
            except Exception:
                cleanup = False
        result['cleanupVerified'] = cleanup
        if not cleanup:
            result['status'] = 'failed'
        destination = ROOT / 'node_modules/.cache/phone-step115-pg16-local-rehearsal.result.json'
        destination.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(result))
    return 0 if result['status'] == 'verified' else 1


if __name__ == '__main__':
    sys.exit(main())
