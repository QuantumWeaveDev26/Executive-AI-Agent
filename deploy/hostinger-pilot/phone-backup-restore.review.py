"""REVIEW ONLY. One separately approved pilot backup/isolated-restore rehearsal.
No source mutation, phone migration, provider, service change or automatic retry.
"""
import base64
import hashlib
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import secrets
import selectors
import signal
import stat
import subprocess
import sys
import tempfile
import time

SOURCE_ID = '340a0ab86ef4156d87651433676978473f58c82b32e1fa4c279664261ace7893'
SOURCE_NAME = 'thaara-v2-pilot-postgres-1'
IMAGE_ID = 'sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
IMAGE = IMAGE_ID  # Immutable local config ID observed on the source; never confuse it with a registry manifest digest.
DATABASE = 'thaara_vps_pilot'
BASE = Path('/opt/thaara-v2-pilot-private/phone-backups')
TMPFS = {'/var/lib/postgresql/data': 'rw,noexec,nosuid,size=536870912',
         '/var/run/postgresql': 'rw,noexec,nosuid,size=16777216', '/tmp': 'rw,noexec,nosuid,size=33554432'}
ENV = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'}
READ_OPTIONS = '-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=120000 -c timezone=UTC -c datestyle=ISO'
# libpq rejects an empty PGSERVICE and warns on a non-regular PGPASSFILE; a missing passfile is silently ignored.
LOCAL_CLIENT_ENV = ['-e', 'PGHOST=/var/run/postgresql', '-e', 'PGHOSTADDR=', '-e', 'PGPORT=5432', '-e', 'PGPASSWORD=',
                    '-e', 'PGPASSFILE=/nonexistent/thaara-no-passfile', '-e', 'PGCLIENTENCODING=UTF8']


class Refusal(Exception):
    pass


def diagnostic_category(error):
    # Exact literals only: never forward exception text, paths, stderr or provider data.
    groups = {
        'container_identity': {'source_identity_denied', 'cached_image_mismatch'},
        'filesystem_permissions': {'unsafe_backup_path', 'backup_directory_not_private', 'private_backup_file_permissions', 'command_permissions'},
        'disk_availability': {'disk_budget_insufficient'},
        'memory_availability': {'memory_budget_insufficient'},
        'missing_path_or_tool': {'source_client_deadline_tool_unavailable', 'command_missing'},
        'docker_metadata': {'command_output_limit'},
        'command_timeout': {'docker_command_timeout', 'docker_command_unavailable_or_timeout',
                            'operator_interrupted_or_deadline', 'snapshot_statement_timeout', 'source_client_deadline'},
        'command_failed': {'docker_or_database_command_failed', 'unexpected_command_diagnostic', 'command_unavailable'},
        'runtime_requirements': {'reviewed_python_runtime_required', 'root_operator_required'},
        'database_preflight': {'database_identity_denied', 'source_size_limit', 'unreviewed_extension_or_tablespace',
                               'unreviewed_database_capability', 'role_inventory_limit', 'unreviewed_role_configuration',
                               'snapshot_diagnostic', 'snapshot_session_failed', 'snapshot_value_shape',
                               'snapshot_output_limit', 'source_session_close_failed'},
        'migration_failed': {'migration_sql_missing', 'migration_sql_checksum', 'migration_target_not_clean', 'migration_changed_existing_objects',
                             'migrated_rls_denied', 'migrated_objects_denied', 'migrated_grants_denied'},
    }
    if isinstance(error, Refusal):
        return next((group for group, codes in groups.items() if str(error) in codes), 'unclassified_failure')
    if isinstance(error, PermissionError):
        return 'filesystem_permissions'
    if isinstance(error, FileNotFoundError):
        return 'missing_path_or_tool'
    if isinstance(error, (json.JSONDecodeError, KeyError, TypeError)):
        return 'docker_metadata'
    return 'unclassified_failure'


def host_preflight(docker, progress):
    progress['step'] = 'runtime_requirements'
    require(sys.platform == 'linux' and sys.version_info >= (3, 8), 'reviewed_python_runtime_required')
    require(os.geteuid() == 0, 'root_operator_required')
    progress['step'] = 'container_identity'
    before = docker.source()
    progress['step'] = 'cached_image'
    require(json.loads(docker(['image', 'inspect', '--format', '{{json .Id}}', IMAGE])) == IMAGE_ID, 'cached_image_mismatch')
    progress['step'] = 'deadline_tool'
    # Pinned image's timeout is BusyBox: no --version. Exercise the same -k/duration form the source clients use.
    require(docker(['exec', '--user', 'postgres', SOURCE_ID, 'timeout', '-k', '1s', '5s', 'true']) == b'', 'source_client_deadline_tool_unavailable')
    progress['step'] = 'protected_paths'
    for parent in [Path('/'), Path('/opt'), BASE.parent]:
        safe_directory(parent, private=parent == BASE.parent)
    progress['step'] = 'disk_availability'
    stats = os.statvfs(BASE.parent)
    require(stats.f_bavail * stats.f_frsize >= 2 * 1024 ** 3, 'disk_budget_insufficient')
    progress['step'] = 'memory_availability'
    available = re.search(r'^MemAvailable:\s+(\d+) kB$', Path('/proc/meminfo').read_text(), re.M)
    require(available and int(available[1]) >= 1536 * 1024, 'memory_budget_insufficient')
    return before


def host_diagnostic():
    progress = {'step': 'runtime_requirements'}
    receipt = {'status': 'failed', 'phase': 'preflight', 'sourceMutated': False, 'providerCalls': 0,
               'cleanupVerified': True, 'databaseAccessed': False, 'resourcesCreated': False}
    try:
        docker = Docker()
        before = host_preflight(docker, progress)
        progress['step'] = 'identity_recheck'
        require(docker.source() == before, 'source_identity_denied')
        receipt.update(status='verified', sourceIdentityUnchanged=True)
    except Exception as error:
        receipt.update(category=diagnostic_category(error), preflightStep=progress['step'])
    return receipt


def require(value, code):
    if not value:
        raise Refusal(code)


def valid_id(value):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def validate_source(f):
    require(f.get('Id') == SOURCE_ID and f.get('Name') == '/' + SOURCE_NAME and f.get('Image') == IMAGE_ID
            and f.get('Project') == 'thaara-v2-pilot' and f.get('Service') == 'postgres'
            and f.get('Running') is True and f.get('Healthy') == 'healthy'
            and type(f.get('Restarts')) is int and f['Restarts'] >= 0, 'source_identity_denied')


def validate_metadata(m, bootstrap):
    require(m.get('database') == DATABASE and type(m.get('version')) is int and 160000 <= m['version'] < 170000,
            'database_identity_denied')
    require(type(m.get('size')) is int and 0 < m['size'] <= 128 * 1024 * 1024, 'source_size_limit')
    require(set(m.get('extensions', [])) <= {'plpgsql', 'pgcrypto'} and set(m.get('tablespaces', [])) == {'pg_default', 'pg_global'}, 'unreviewed_extension_or_tablespace')
    require(all(m.get(k) == 0 for k in ['foreign', 'subscriptions', 'events', 'largeObjects', 'materialized', 'parameterAcls', 'databaseSettings']), 'unreviewed_database_capability')
    roles = m.get('roles')
    require(isinstance(roles, list) and 0 < len(roles) <= 50, 'role_inventory_limit')
    for role in roles:
        require(isinstance(role.get('name'), str) and re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,62}', role['name'])
                and role['name'] != bootstrap and role.get('config') is None, 'unreviewed_role_configuration')


def validate_fixture(ident, f):
    require(valid_id(ident['id']) and f.get('Id') == ident['id'] and f.get('Name') == '/' + ident['name']
            and f.get('Image') == IMAGE_ID and f.get('Labels', {}).get('thaara.phone-restore') == ident['run'], 'restore_identity_denied')
    require(f.get('ReadOnly') is True and type(f.get('Restarts')) is int and f['Restarts'] == 0 and f.get('NetworkMode') == 'none'
            and f.get('Networks') == ['none'] and not f.get('PortBindings') and not f.get('Binds'), 'restore_isolation_denied')
    require(all(not ports for ports in (f.get('Ports') or {}).values()), 'restore_published_port')
    require(f.get('Memory') == 805306368 and f.get('NanoCpus') == 1000000000 and f.get('ShmSize') == 67108864
            and f.get('PidsLimit') == 128 and 'no-new-privileges:true' in (f.get('SecurityOpt') or []), 'restore_resource_limits_denied')
    require(f.get('Tmpfs') == TMPFS, 'restore_tmpfs_declaration')
    mounts = f.get('Mounts')
    require(isinstance(mounts, list) and len(mounts) in (0, 3), 'restore_mount_metadata')
    for mount in mounts:
        require(mount.get('Type') == 'tmpfs' and mount.get('Destination') in TMPFS and mount.get('Source') in (None, '', 'tmpfs')
                and mount.get('RW') is not False, 'restore_persistent_mount')
    resolved = {'/var/lib/postgresql/data': '/var/lib/postgresql/data', '/var/run/postgresql': '/run/postgresql', '/tmp': '/tmp'}
    require(f.get('Resolved') == resolved, 'restore_path_redirected')
    raw = f.get('MountInfo')
    require(isinstance(raw, str) and 0 < len(raw) < 131072, 'actual_mounts_missing')
    actual = {}
    for line in raw.splitlines():
        left, sep, right = line.partition(' - ')
        a, b = left.split(), right.split()
        require(sep and len(a) >= 6 and len(b) >= 3, 'mountinfo_invalid')
        dest = re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), a[4])
        require(dest not in actual, 'duplicate_actual_mount')
        actual[dest] = {'device': a[2], 'root': a[3], 'options': set(a[5].split(',')), 'type': b[0], 'source': b[1], 'super': set(b[2].split(','))}
    root = actual.get('/')
    require(root and root['type'] in ('overlay', 'fuse.overlayfs') and 'ro' in root['options'], 'root_not_readonly')
    devices = set()
    expected = {'/var/lib/postgresql/data': 'size=524288k', '/run/postgresql': 'size=16384k', '/tmp': 'size=32768k'}
    for dest, size in expected.items():
        mount = actual.get(dest)
        require(mount and mount['type'] == 'tmpfs' and mount['source'] == 'tmpfs' and mount['root'] == '/'
                and {'rw', 'noexec', 'nosuid'} <= mount['options'] and {'rw', size} <= mount['super']
                and mount['device'] != root['device'] and mount['device'] not in devices, 'actual_tmpfs_denied')
        devices.add(mount['device'])
    for dest, mount in actual.items():
        if dest in {'/', *expected}:
            continue
        require(not any(dest.startswith(p + '/') for p in expected), 'nested_storage_mount')
        virtual = any(dest == p or dest.startswith(p + '/') for p in ['/proc', '/sys', '/dev'])
        if virtual:
            require(mount['type'] in {'proc', 'sysfs', 'tmpfs', 'devpts', 'mqueue', 'cgroup', 'cgroup2'}, 'foreign_virtual_mount')
        else:
            require(dest in {'/etc/hosts', '/etc/hostname', '/etc/resolv.conf'} and
                    re.search('/containers/' + re.escape(ident['id']) + '/' + re.escape(dest.rsplit('/', 1)[1]) + '$', mount['root']), 'unexpected_host_mount')


# Postgres flattens nested ANDs when it re-parses dumped CHECK text, so only these exact reviewed lines deparse differently after restore.
REPARSE_EQUIVALENT = {
    b"    CONSTRAINT phone_contacts_display_name_check CHECK ((((length(btrim(display_name)) >= 1) AND (length(btrim(display_name)) <= 128)) AND (display_name = btrim(display_name)) AND (display_name !~ '[[:cntrl:]<>]'::text))),\n":
    b"    CONSTRAINT phone_contacts_display_name_check CHECK (((length(btrim(display_name)) >= 1) AND (length(btrim(display_name)) <= 128) AND (display_name = btrim(display_name)) AND (display_name !~ '[[:cntrl:]<>]'::text))),\n",
    b"    CONSTRAINT whatsapp_n8n_relay_principals_allowed_operations_check CHECK ((((cardinality(allowed_operations) >= 1) AND (cardinality(allowed_operations) <= 3)) AND (allowed_operations <@ ARRAY['events'::text, 'claim'::text, 'receipts'::text]) AND (array_position(allowed_operations, NULL::text) IS NULL))),\n":
    b"    CONSTRAINT whatsapp_n8n_relay_principals_allowed_operations_check CHECK (((cardinality(allowed_operations) >= 1) AND (cardinality(allowed_operations) <= 3) AND (allowed_operations <@ ARRAY['events'::text, 'claim'::text, 'receipts'::text]) AND (array_position(allowed_operations, NULL::text) IS NULL))),\n",
}


def canonical_schema(data):
    require(len(data) <= 8 * 1024 * 1024, 'schema_output_limit')
    lines = data.splitlines(keepends=True)
    substantive = [i for i, line in enumerate(lines) if line.strip() and not line.startswith(b'--')]
    if substantive and lines[substantive[0]].startswith(b'\\restrict '):
        first, last = substantive[0], substantive[-1]
        start = re.fullmatch(rb'\\restrict ([A-Za-z0-9]+)\s*', lines[first])
        end = re.fullmatch(rb'\\unrestrict ([A-Za-z0-9]+)\s*', lines[last])
        require(start and end and start[1] == end[1] and first < last, 'schema_wrapper_invalid')
        lines = [line for i, line in enumerate(lines) if i not in (first, last)]
    # `-- Name: ...; Owner:` headers name the extension installer, which is the restore bootstrap. All SQL statements stay compared.
    return b''.join(REPARSE_EQUIVALENT.get(line, line) for line in lines if not line.startswith(b'--'))


def schema_matches(source, restored, bootstrap):
    normal = canonical_schema(restored)
    return bootstrap.encode() not in normal and canonical_schema(source) == normal


def verify_counts(source, restored):
    require(source == restored and all(type(n) is int and n >= 0 for n in source.values()), 'restored_counts_mismatch')


def dump_command(snapshot, schema=False, seconds=110):
    require(type(seconds) is int and 1 <= seconds <= 110, 'invalid_source_client_deadline')
    return ['exec', '--user', 'postgres', *LOCAL_CLIENT_ENV, '-e', 'PGOPTIONS', SOURCE_ID, 'timeout', '-k', '5s', str(seconds) + 's', 'pg_dump', '-w', '-U', 'postgres', '-d', DATABASE,
            '--lock-wait-timeout=3s', '--snapshot=' + snapshot, '--schema-only' if schema else '--format=custom']


def restore_command(container, bootstrap):
    require(valid_id(container) and container != SOURCE_ID, 'unsafe_restore_target')
    return ['exec', '-i', '--user', 'postgres', *LOCAL_CLIENT_ENV, container, 'pg_restore', '-w', '-U', bootstrap, '-d', 'postgres', '--create', '--exit-on-error']


def ready_command(container, bootstrap):
    require(valid_id(container) and container != SOURCE_ID, 'unsafe_readiness_target')
    # The image's temporary init server uses Unix sockets only. TCP loopback proves final startup before restore.
    return ['exec', '--user', 'postgres', *LOCAL_CLIENT_ENV, container, 'pg_isready', '-h', '127.0.0.1', '-p', '5432', '-U', bootstrap, '-d', 'postgres']


def cleanup_fixture(docker, ident):
    require(valid_id(ident['id']) and ident['id'] != SOURCE_ID, 'unsafe_cleanup_id')
    f = docker(['inspect', ident['id']], identity_only=True)
    require(f.get('Id') == ident['id'] and f.get('Name') == '/' + ident['name'] and f.get('Image') == IMAGE_ID
            and f.get('Labels', {}).get('thaara.phone-restore') == ident['run'], 'cleanup_identity_denied')
    docker(['rm', '-f', ident['id']])


def quoted(name):
    require(isinstance(name, str) and re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,62}', name), 'unreviewed_identifier')
    return '"' + name + '"'


class Docker:
    def __call__(self, args, *, identity_only=False, input=None, output=None, timeout=30, extra=None, limit=None, allow_unready=False):
        if identity_only:
            return {k: self.field(args[-1], v) for k, v in {'Id': '.Id', 'Name': '.Name', 'Image': '.Image', 'Labels': '.Config.Labels'}.items()}
        command = ['docker', '--host=unix:///var/run/docker.sock', *args]
        env = {**ENV, **(extra or {})}
        proc = None
        selector = selectors.DefaultSelector()
        try:
            proc = subprocess.Popen(command, stdin=input or subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
            selector.register(proc.stdout, selectors.EVENT_READ, 'stdout')
            selector.register(proc.stderr, selectors.EVENT_READ, 'stderr')
            end = time.monotonic() + timeout
            total, data = 0, bytearray()
            cap = limit or (256 * 1024 * 1024 if output is not None else 2 * 1024 * 1024)
            while selector.get_map():
                require(time.monotonic() < end, 'docker_command_timeout')
                events = selector.select(max(0, end - time.monotonic()))
                require(events, 'docker_command_timeout')
                for key, _ in events:
                    chunk = os.read(key.fileobj.fileno(), 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    require(key.data != 'stderr', 'unexpected_command_diagnostic')
                    total += len(chunk)
                    require(total <= cap, 'command_output_limit')
                    if output is not None:
                        output.write(chunk)
                    else:
                        data.extend(chunk)
            status = proc.wait(timeout=max(0.1, end - time.monotonic()))
            if allow_unready and status in (1, 2):
                return None
            require(status == 0, 'docker_or_database_command_failed')
            if output is None:
                return bytes(data)
        except subprocess.TimeoutExpired:
            raise Refusal('docker_command_timeout') from None
        except OSError as error:
            code = 'command_missing' if isinstance(error, FileNotFoundError) else 'command_permissions' if isinstance(error, PermissionError) else 'command_unavailable'
            raise Refusal(code) from None
        finally:
            if proc:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait(timeout=5)
                proc.stdout.close()
                proc.stderr.close()
            selector.close()

    def field(self, container, field):
        return json.loads(self(['inspect', '--format', '{{json ' + field + '}}', container]))

    def source(self):
        fields = {'Id': '.Id', 'Name': '.Name', 'Image': '.Image', 'Project': '.Config.Labels', 'Running': '.State.Running',
                  'Healthy': '.State.Health.Status', 'Restarts': '.RestartCount'}
        facts = {k: self.field(SOURCE_ID, v) for k, v in fields.items()}
        labels = facts['Project']
        facts['Project'], facts['Service'] = labels.get('com.docker.compose.project'), labels.get('com.docker.compose.service')
        validate_source(facts)
        return facts

    def fixture(self, ident):
        cid = ident['id']
        facts = self(['inspect', cid], identity_only=True)
        fields = {'ReadOnly': '.HostConfig.ReadonlyRootfs', 'Restarts': '.RestartCount', 'NetworkMode': '.HostConfig.NetworkMode',
                  'Networks': '.NetworkSettings.Networks', 'PortBindings': '.HostConfig.PortBindings', 'Ports': '.NetworkSettings.Ports',
                  'Binds': '.HostConfig.Binds', 'Mounts': '.Mounts', 'Tmpfs': '.HostConfig.Tmpfs', 'Memory': '.HostConfig.Memory',
                  'NanoCpus': '.HostConfig.NanoCpus', 'ShmSize': '.HostConfig.ShmSize', 'PidsLimit': '.HostConfig.PidsLimit', 'SecurityOpt': '.HostConfig.SecurityOpt'}
        facts.update({k: self.field(cid, v) for k, v in fields.items()})
        facts['Networks'] = list(facts['Networks'])
        facts['MountInfo'] = self(['exec', cid, 'cat', '/proc/self/mountinfo']).decode()
        facts['Resolved'] = {p: self(['exec', cid, 'readlink', '-f', p]).decode().strip() for p in TMPFS}
        validate_fixture(ident, facts)
        return facts


class Snapshot:
    """One read-only psql session; bounded pipes, same exported snapshot for dump/counts."""
    def __init__(self, docker, container, user):
        self.container, self.user = container, user
        client = ['timeout', '-k', '3s', '115s', 'psql'] if container == SOURCE_ID else ['psql']
        self.proc = subprocess.Popen(['docker', '--host=unix:///var/run/docker.sock', 'exec', '-i', '--user', 'postgres', *LOCAL_CLIENT_ENV, '-e', 'PGOPTIONS',
                                      container, *client, '-w', '-X', '-qAt', '-U', user, '-d', DATABASE, '-v', 'ON_ERROR_STOP=1'],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     env={**ENV, 'PGOPTIONS': READ_OPTIONS})
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.proc.stdout, selectors.EVENT_READ, 'stdout')
        self.selector.register(self.proc.stderr, selectors.EVENT_READ, 'stderr')
        try:
            self.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        except BaseException:
            self.close()
            raise

    def query(self, sql):
        marker = '__thaara_' + secrets.token_hex(16)
        self.proc.stdin.write((sql + ';\n\\echo ' + marker + '\n').encode())
        self.proc.stdin.flush()
        data = b''
        deadline = time.monotonic() + 20
        while True:
            require(time.monotonic() < deadline, 'snapshot_statement_timeout')
            events = self.selector.select(max(0, deadline - time.monotonic()))
            if not events:
                raise Refusal('snapshot_statement_timeout')
            for key, _ in sorted(events, key=lambda event: event[0].data == 'stdout'):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if key.data == 'stderr':
                    require(not chunk, 'snapshot_diagnostic')
                    self.selector.unregister(key.fileobj)
                    continue
                require(chunk, 'snapshot_session_failed')
                data += chunk
                require(len(data) <= 2 * 1024 * 1024, 'snapshot_output_limit')
                lines = data.splitlines()
                if lines and lines[-1] == marker.encode() and data.endswith(b'\n'):
                    return [line.decode() for line in lines[:-1] if line]

    def value(self, sql):
        lines = self.query(sql)
        require(len(lines) == 1, 'snapshot_value_shape')
        return json.loads(lines[0])

    def close(self):
        try:
            if self.proc.poll() is None:
                self.proc.stdin.write(b'ROLLBACK;\n\\q\n')
                self.proc.stdin.close()
                self.proc.wait(timeout=5)
            require(self.proc.returncode == 0, 'source_session_close_failed')
            require(not self.proc.stderr.read(1024).strip(), 'snapshot_diagnostic')
        finally:
            if self.proc.poll() is None:
                self.proc.kill()
                self.proc.wait(timeout=5)
            self.selector.close()
            if not self.proc.stdin.closed:
                self.proc.stdin.close()
            self.proc.stdout.close()
            self.proc.stderr.close()


METADATA = """SELECT json_build_object('database',current_database(),'version',current_setting('server_version_num')::int,
'size',pg_database_size(current_database()),'extensions',(SELECT json_agg(extname ORDER BY extname) FROM pg_extension),
'tablespaces',(SELECT json_agg(spcname ORDER BY spcname) FROM pg_tablespace),
'foreign',(SELECT count(*) FROM pg_foreign_server),'subscriptions',(SELECT count(*) FROM pg_subscription),
'events',(SELECT count(*) FROM pg_event_trigger),'largeObjects',(SELECT count(*) FROM pg_largeobject_metadata),
'materialized',(SELECT count(*) FROM pg_class WHERE relkind='m'), 'parameterAcls',(SELECT count(*) FROM pg_parameter_acl),
'databaseSettings',(SELECT count(*) FROM pg_db_role_setting WHERE setdatabase=0 OR setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())),
'roles',(SELECT json_agg(json_build_object('name',rolname,'config',rolconfig) ORDER BY rolname) FROM pg_roles WHERE rolname !~ '^pg_'))"""
ROLE_STATE = """SELECT COALESCE(json_agg(json_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,
rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil::text,rolconfig) ORDER BY rolname),'[]'::json)
FROM pg_roles WHERE rolname !~ '^pg_' AND rolname <> '%s'"""
MEMBERSHIPS = """SELECT COALESCE(json_agg(json_build_array(r.rolname,u.rolname,g.rolname,m.admin_option,m.inherit_option,m.set_option)
ORDER BY r.rolname,u.rolname,g.rolname),'[]'::json) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
JOIN pg_roles u ON u.oid=m.member JOIN pg_roles g ON g.oid=m.grantor
WHERE r.rolname <> '%s' AND u.rolname <> '%s' AND g.rolname <> '%s' AND NOT (r.rolname ~ '^pg_' AND u.rolname ~ '^pg_')"""
TABLES = """SELECT COALESCE(json_agg(json_build_array(n.nspname,c.relname) ORDER BY n.nspname,c.relname),'[]'::json)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p')
AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'"""
DB_STATE = """SELECT json_build_object('owner',pg_get_userbyid(d.datdba),'encoding',pg_encoding_to_char(d.encoding),
'collate',d.datcollate,'ctype',d.datctype,'connectionLimit',d.datconnlimit,'comment',shobj_description(d.oid,'pg_database'),
'acl',(SELECT json_agg(json_build_array(pg_get_userbyid(a.grantor),CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
ORDER BY a.grantor::regrole::text,a.grantee::regrole::text,a.privilege_type,a.is_grantable)
FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a)) FROM pg_database d WHERE d.datname=current_database()"""


MIGRATION_OPTIONS = '-c client_min_messages=warning -c timezone=UTC'
MIGRATION_FACTS = """SELECT json_build_object(
'tables',(SELECT md5(string_agg(c.relname,',' ORDER BY c.relname)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname !~ '^phone_'),
'columns',(SELECT md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable,',' ORDER BY table_name,column_name)) FROM information_schema.columns WHERE table_schema='public' AND table_name !~ '^phone_'),
'roles',(SELECT md5(string_agg(rolname,',' ORDER BY rolname)) FROM pg_roles WHERE rolname !~ '^pg_' AND rolname <> 'thaara_phone_callback_guard'),
'contacts',to_regclass('public.phone_contacts') IS NOT NULL,'calls',to_regclass('public.phone_calls') IS NOT NULL,'events',to_regclass('public.phone_call_events') IS NOT NULL,
'guard',EXISTS (SELECT 1 FROM pg_roles WHERE rolname='thaara_phone_callback_guard'),
'dispatch',EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='phone_calls' AND column_name='dispatch_status'))"""
MIGRATION_READY = """SELECT to_json(to_regprocedure('public.append_phone_provider_transcript(uuid,text,text,text,text,text)') IS NOT NULL)"""
MIGRATION_POST = """SELECT json_build_object(
'rls',(SELECT json_agg(json_build_array(relname,relrowsecurity,relforcerowsecurity) ORDER BY relname) FROM pg_class WHERE oid IN ('public.phone_contacts'::regclass,'public.phone_calls'::regclass,'public.phone_call_events'::regclass)),
'rows',(SELECT count(*) FROM public.phone_contacts)+(SELECT count(*) FROM public.phone_calls)+(SELECT count(*) FROM public.phone_call_events),
'guard',(SELECT json_build_array(rolcanlogin,rolsuper,rolbypassrls) FROM pg_roles WHERE rolname='thaara_phone_callback_guard'),
'definer',(SELECT count(*) FROM pg_proc WHERE prosecdef AND oid IN (to_regprocedure('public.apply_phone_provider_event(uuid,text,text,text,text,text)'),to_regprocedure('public.phone_provider_binding(uuid)'),to_regprocedure('public.append_phone_provider_transcript(uuid,text,text,text,text,text)'))),
'appInsert',has_table_privilege('thaara_app','public.phone_contacts','INSERT'),'appDelete',has_table_privilege('thaara_app','public.phone_contacts','DELETE'),
'publicRead',has_table_privilege('public','public.phone_contacts','SELECT'),'publicExecute',has_function_privilege('public','public.apply_phone_provider_event(uuid,text,text,text,text,text)','EXECUTE'))"""
MIGRATIONS = (('110a', '7c2066959edd4b129751bf858e31af1dbed5ae9b300226597e4ce4e160c06a8e'), ('110b', '1030cd5b9d2015cad94221cce19c34699fa049b541606f9b081f65f6acc5aa6e'), ('110c', '479c06d456577a120a95382b25f29d703366ac624dcae71f1d4839e346a67b5d'))


def counts(session):
    tables = session.value(TABLES)
    require(isinstance(tables, list) and 0 < len(tables) <= 300, 'table_inventory_limit')
    result = {}
    for schema, table in tables:
        result[json.dumps([schema, table])] = session.value('SELECT to_json(count(*)) FROM ' + quoted(schema) + '.' + quoted(table))
    return result


def role_state(session, bootstrap):
    quoted(bootstrap)
    return {'roles': session.value(ROLE_STATE % bootstrap), 'memberships': session.value(MEMBERSHIPS % (bootstrap, bootstrap, bootstrap))}


def safe_directory(path, private=False):
    info = os.lstat(path)
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, 'unsafe_backup_path')
    if private:
        require(stat.S_IMODE(info.st_mode) == 0o700, 'backup_directory_not_private')


def private_file(path):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
        os.close(fd)
        raise Refusal('private_backup_file_permissions')
    return os.fdopen(fd, 'wb')


def save_json(path, value):
    with private_file(path) as stream:
        stream.write((json.dumps(value, sort_keys=True) + '\n').encode())
        stream.flush()
        os.fsync(stream.fileno())


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(65536), b''):
            value.update(chunk)
    return value.hexdigest()


def run():
    docker = Docker()
    ident = None
    snapshot = None
    folder = None
    phase = 'preflight'
    progress = {'step': 'runtime_requirements'}
    receipt = {'status': 'failed', 'sourceMutated': False, 'providerCalls': 0, 'cleanupVerified': False}
    started = datetime.now(timezone.utc).isoformat(timespec='microseconds')
    nonce = secrets.token_hex(16)
    bootstrap = 'thaara_restore_' + nonce[:16]
    overall_end = time.monotonic() + 600
    def deadline(seconds):
        require(time.monotonic() < overall_end, 'rehearsal_deadline')
        signal.alarm(max(1, math.ceil(min(seconds, overall_end - time.monotonic()))))
    try:
        os.umask(0o077)  # This new operator process only; never changes service configuration.
        before = host_preflight(docker, progress)
        progress['step'] = 'database_metadata'
        deadline(120)  # Bound the complete source snapshot/backup phase, not only each statement.
        source_end = time.monotonic() + 120
        def client_seconds(maximum):
            remaining = min(maximum, math.floor(source_end - time.monotonic()) - 6)
            require(remaining >= 1, 'source_client_deadline')
            return remaining
        snapshot = Snapshot(docker, SOURCE_ID, 'postgres')
        meta = snapshot.value(METADATA)
        validate_metadata(meta, bootstrap)
        source_roles = role_state(snapshot, bootstrap)
        source_database = snapshot.value(DB_STATE)
        if BASE.exists() or BASE.is_symlink():
            safe_directory(BASE, private=True)
        else:
            BASE.mkdir(mode=0o700)
        folder = BASE / ('phone110-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + nonce)
        folder.mkdir(mode=0o700)
        safe_directory(folder, private=True)
        save_json(folder / 'run.json', {'sourceId': SOURCE_ID, 'image': IMAGE_ID, 'restoreName': 'thaara-phone-restore-' + nonce,
                                       'run': nonce, 'started': started, 'retention': 'minimum7days; removal needs separate owner approval'})
        phase = 'snapshot_backup'
        exported = snapshot.query('SELECT pg_export_snapshot()')[0]
        require(re.fullmatch('[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+', exported), 'exported_snapshot_invalid')
        source_counts = counts(snapshot)
        extra = {'PGOPTIONS': READ_OPTIONS}
        with private_file(folder / 'database.dump') as output:
            docker(dump_command(exported, seconds=client_seconds(110)), output=output, extra=extra, timeout=120)
            output.flush()
            os.fsync(output.fileno())
        with private_file(folder / 'schema.sql') as output:
            docker(dump_command(exported, schema=True, seconds=client_seconds(50)), output=output, extra=extra, timeout=60, limit=8 * 1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        with private_file(folder / 'globals.sql') as output:
            docker(['exec', '--user', 'postgres', *LOCAL_CLIENT_ENV, '-e', 'PGOPTIONS', SOURCE_ID, 'timeout', '-k', '5s', str(client_seconds(20)) + 's', 'pg_dumpall', '-w', '-U', 'postgres', '-l', DATABASE,
                    '--globals-only', '--no-role-passwords'], output=output, extra=extra, timeout=30, limit=8 * 1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        require(not re.search(rb'(?im)^\s*ALTER\s+ROLE[^\n]*\bPASSWORD\b', (folder / 'globals.sql').read_bytes()), 'unexpected_role_password')
        save_json(folder / 'source-manifest.json', {'metadata': meta, 'roles': source_roles, 'database': source_database, 'counts': source_counts})
        snapshot.close()
        snapshot = None
        deadline(480)  # Includes elapsed preflight; cleanup has its own bounded commands.
        require(docker.source() == before, 'source_changed_during_backup')
        backup_hashes = {name: digest(folder / name) for name in ('database.dump', 'schema.sql', 'globals.sql', 'source-manifest.json')}
        save_json(folder / 'backup-sha256.json', backup_hashes)
        phase = 'new_isolated_restore'
        name = 'thaara-phone-restore-' + nonce
        require(not docker(['ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}']).strip(), 'restore_name_collision')
        args = ['run', '-d', '--pull=never', '--name', name, '--label', 'thaara.phone-restore=' + nonce, '--network', 'none', '--read-only',
                '--memory', '768m', '--cpus', '1', '--shm-size', '64m', '--pids-limit', '128', '--security-opt', 'no-new-privileges:true']
        for dest, options in TMPFS.items():
            args += ['--tmpfs', dest + ':' + options]
        args += ['-e', 'POSTGRES_USER', '-e', 'POSTGRES_DB', '-e', 'POSTGRES_PASSWORD', IMAGE]
        ident = {'id': None, 'name': name, 'run': nonce}
        cid = docker(args, extra={'POSTGRES_USER': bootstrap, 'POSTGRES_DB': bootstrap, 'POSTGRES_PASSWORD': secrets.token_urlsafe(32)}).decode().strip()
        require(valid_id(cid) and cid != SOURCE_ID, 'created_restore_id_invalid')
        ident = {'id': cid, 'name': name, 'run': nonce}
        save_json(folder / 'restore-identity.json', ident)
        docker.fixture(ident)  # Actual mount proof BEFORE any archive/restore SQL.
        ready = False
        for _ in range(40):
            if docker(ready_command(cid, bootstrap), timeout=5, allow_unready=True) is not None:
                ready = True
                break
            time.sleep(0.25)
        require(ready, 'restore_database_not_ready')
        docker.fixture(ident)
        phase = 'restore_globals_and_database'
        with (folder / 'globals.sql').open('rb') as input_stream:
            docker(['exec', '-i', '--user', 'postgres', *LOCAL_CLIENT_ENV, cid, 'psql', '-w', '-X', '-q', '-U', bootstrap, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], input=input_stream, timeout=30)
        with (folder / 'database.dump').open('rb') as input_stream:
            docker(restore_command(cid, bootstrap), input=input_stream, timeout=120)
        phase = 'verify_restored_snapshot'
        restored = Snapshot(docker, cid, bootstrap)
        try:
            verify_counts(source_counts, counts(restored))
            require(source_roles == role_state(restored, bootstrap), 'restored_roles_mismatch')
            require(source_database == restored.value(DB_STATE), 'restored_database_owner_acl_mismatch')
        finally:
            restored.close()
        restored_schema = docker(['exec', '--user', 'postgres', *LOCAL_CLIENT_ENV, cid, 'pg_dump', '-w', '-U', bootstrap, '-d', DATABASE, '--schema-only'], timeout=60)
        require(schema_matches((folder / 'schema.sql').read_bytes(), restored_schema, bootstrap), 'restored_schema_owner_acl_mismatch')
        require(docker.source() == before, 'source_changed_during_restore')
        require(all(digest(folder / name) == value for name, value in backup_hashes.items()), 'backup_changed_during_restore')
        save_json(folder / 'verified.json', {'countsVerified': True, 'schemaOwnersAclVerified': True, 'rolesVerified': True,
                                          'sourceIdentityUnchanged': True, 'archiveSha256': backup_hashes['database.dump'],
                                          'globalsSha256': backup_hashes['globals.sql']})
        for directory in (folder, BASE, BASE.parent):
            sync_directory(directory)
        receipt.update(status='verified', backupDirectory=str(folder), tableCount=len(source_counts), countsVerified=True,
                       schemaOwnersAclVerified=True, rolesVerified=True, sourceIdentityUnchanged=True,
                       archiveSha256=backup_hashes['database.dump'], globalsSha256=backup_hashes['globals.sql'])
    except Exception as error:
        receipt.update(status='failed', phase=phase, category=diagnostic_category(error), preflightStep=progress['step'])
        if folder:
            receipt['backupDirectory'] = str(folder)
    finally:
        signal.alarm(0)
        try:
            if snapshot:
                snapshot.close()
            if ident:
                if ident['id'] is None:
                    # Cleanup-only discovery after a lost create response. Never retry creation or adopt another run's resource.
                    found = docker(['ps', '-a', '--no-trunc', '--filter', 'name=^/' + ident['name'] + '$', '--filter',
                                    'label=thaara.phone-restore=' + ident['run'], '--format', '{{.ID}}']).decode().splitlines()
                    require(len(found) <= 1, 'cleanup_creation_identity_ambiguous')
                    if found:
                        require(valid_id(found[0]) and found[0] != SOURCE_ID, 'cleanup_discovery_invalid')
                        ident['id'] = found[0]
                if ident['id'] is None:
                    # Creation outcome is uncertain: do not claim absence based on one potentially racing lookup.
                    receipt.update(status='failed', cleanupVerified=False, cleanupCategory='creation_outcome_unknown')
                    return receipt
                cleanup_fixture(docker, ident)
                require(not docker(['ps', '-a', '--filter', 'id=' + ident['id'], '--format', '{{.ID}}']).strip(), 'restore_removal_unverified')
                event = docker(['events', '--since', started, '--until', datetime.now(timezone.utc).isoformat(timespec='microseconds'),
                                '--filter', 'container=' + ident['id'], '--filter', 'event=destroy', '--format', '{{.Action}} {{.Actor.ID}}']).decode()
                require(('destroy ' + ident['id']) in event.splitlines(), 'restore_destruction_unverified')
                receipt.update(restoreContainerId=ident['id'], restoreContainerRemoved=True, destructionObserved=True)
            receipt['cleanupVerified'] = True
        except Exception:
            receipt.update(status='failed', cleanupVerified=False, cleanupCategory='owned_cleanup_needs_review')
    return receipt


def migration_inputs():
    # Supplied by the pinned transport as a base64 prefix; refused before any backup or database work unless exact.
    supplied = globals().get('MIGRATION_SQL_B64')
    require(isinstance(supplied, dict) and set(supplied) == {step for step, _ in MIGRATIONS}, 'migration_sql_missing')
    inputs = []
    for step, expected in MIGRATIONS:
        data = base64.b64decode(supplied[step], validate=True)
        require(hashlib.sha256(data).hexdigest() == expected, 'migration_sql_checksum')
        inputs.append((step, data))
    return inputs


def migration_facts(docker):
    session = Snapshot(docker, SOURCE_ID, 'postgres')
    try:
        return session.value(MIGRATION_FACTS), session.value(MIGRATION_POST) if session.value(MIGRATION_READY) else None
    finally:
        session.close()


def validate_migrated(post):
    require(post and post['rls'] == [['phone_call_events', True, True], ['phone_calls', True, True], ['phone_contacts', True, True]], 'migrated_rls_denied')
    require(post['rows'] == 0 and post['guard'] == [False, False, False] and post['definer'] == 3, 'migrated_objects_denied')
    require(post['appInsert'] is True and post['appDelete'] is False and post['publicRead'] is False and post['publicExecute'] is False, 'migrated_grants_denied')


def migrate(docker, inputs, receipt):
    """Persistent 110a/b/c on the source, only after a fresh verified backup. Each file commits alone; never rolled back here."""
    step = 'precheck'
    receipt.update(migrationStatus='failed', migrationApplied=[], migrationStep=step)
    try:
        docker.source()
        before, _ = migration_facts(docker)
        require(not any(before[k] for k in ('contacts', 'calls', 'events', 'guard', 'dispatch')), 'migration_target_not_clean')
        for step, data in inputs:
            receipt['migrationStep'] = step
            guard = ("SELECT set_config('thaara.step%s_review_approved','yes',false), set_config('thaara.step%s_target_database',current_database(),false);\n" % (step, step)).encode()
            with tempfile.TemporaryFile() as stream:
                stream.write(guard + data)
                stream.flush()
                stream.seek(0)
                receipt['sourceMutated'] = True  # Conservative from the first attempt; post-state below says what actually exists.
                docker(['exec', '-i', '--user', 'postgres', *LOCAL_CLIENT_ENV, '-e', 'PGOPTIONS', SOURCE_ID, 'timeout', '-k', '5s', '60s', 'psql', '-w', '-X', '-q', '-U', 'postgres',
                        '-d', DATABASE, '-v', 'ON_ERROR_STOP=1', '-o', '/dev/null'], input=stream, extra={'PGOPTIONS': MIGRATION_OPTIONS}, timeout=70)
            receipt['migrationApplied'].append(step)
        step = 'postcheck'
        receipt['migrationStep'] = step
        after, post = migration_facts(docker)
        require(all(before[k] == after[k] for k in ('tables', 'columns', 'roles')), 'migration_changed_existing_objects')
        validate_migrated(post)
        docker.source()
        receipt.update(migrationStatus='verified', migrationPostVerified=True)
    except Exception as error:
        receipt.update(status='failed', phase='persistent_migration', category=diagnostic_category(error), migrationStatus='failed')
        try:
            # After a failure, report what exists rather than what was attempted. Never repaired or rolled back here.
            observed, _ = migration_facts(docker)
            receipt['migrationObserved'] = {k: observed[k] is True for k in ('contacts', 'calls', 'events', 'guard', 'dispatch')}
        except Exception:
            receipt['migrationObserved'] = 'unverified'
    return receipt


def run_with_migration():
    receipt = {'status': 'failed', 'phase': 'preflight', 'sourceMutated': False, 'providerCalls': 0, 'cleanupVerified': True, 'migrationStatus': 'not_started', 'migrationApplied': []}
    try:
        inputs = migration_inputs()
    except Exception as error:
        receipt.update(category=diagnostic_category(error))
        return receipt
    receipt = run()
    receipt.update(migrationStatus='not_started', migrationApplied=[])
    if receipt['status'] != 'verified' or not receipt['cleanupVerified']:
        return receipt
    signal.alarm(180)
    return migrate(Docker(), inputs, receipt)


def main():
    diagnostic_only = sys.argv[1:] == ['--approved-phone-host-diagnostic']
    migration = sys.argv[1:] == ['--approved-phone-migration-110']
    if not diagnostic_only and not migration and sys.argv[1:] != ['--approved-phone-backup-restore']:
        print(json.dumps({'status': 'review_only', 'sourceId': SOURCE_ID, 'maxSourceMiB': 128, 'network': 'none', 'phoneMigration': False}))
        return 0
    def cancelled(*_):
        raise Refusal('operator_interrupted_or_deadline')
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP, signal.SIGALRM):
        signal.signal(sig, cancelled)
    signal.alarm(120 if diagnostic_only else 600)
    receipt = host_diagnostic() if diagnostic_only else run_with_migration() if migration else run()
    signal.alarm(0)
    print(json.dumps(receipt, sort_keys=True))
    return 0 if receipt['status'] == 'verified' and receipt['cleanupVerified'] else 1


if __name__ == '__main__':
    sys.exit(main())
