"""LOCAL rehearsal of the reviewed backup/restore runner against throwaway synthetic Postgres.

Runs the real run() and real psql/pg_dump/pg_restore/docker commands on this PC's Docker Desktop.
Only platform shims differ (Windows pipes, root/path/disk/RAM checks, SOURCE_ID and BASE targets).
Never uses SSH, the VPS, real credentials or a provider, and never targets an existing container.
Needs explicit owner approval to run because it starts a temporary database.
"""
import ctypes
import difflib
import importlib.util
import json
import msvcrt
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from types import SimpleNamespace

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPORT = ROOT / 'node_modules/.cache/phone-backup-local-rehearsal.json'
RUNNER = ROOT / 'deploy/hostinger-pilot/phone-backup-restore.review.py'
IMAGE_TAG = 'postgres:16-alpine'
HOST_ARG = '--host=unix:///var/run/docker.sock'
SEED = """CREATE TABLE public.rehearsal_synthetic (id serial PRIMARY KEY, label text NOT NULL, payload bytea);
GRANT SELECT ON public.rehearsal_synthetic TO thaara_app;
INSERT INTO public.rehearsal_synthetic (label, payload)
SELECT 'synthetic-' || n, decode(md5(n::text), 'hex') FROM generate_series(1, 2000) n;
COMMENT ON DATABASE thaara_vps_pilot IS 'synthetic rehearsal database';
"""


def load_runner():
    spec = importlib.util.spec_from_file_location('phone_backup', RUNNER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def docker(*args, input=None, env=None, check=True):
    done = subprocess.run(['docker', *args], input=input, env=env, capture_output=True, timeout=120)
    if check and done.returncode != 0:
        raise RuntimeError('docker %s failed: %s' % (args[0], done.stderr.decode(errors='replace')[:800]))
    return done.stdout.decode(errors='replace').strip()


class PipeSelector:
    """Windows stand-in for selectors.DefaultSelector over subprocess pipes; EOF reads as ready."""
    def __init__(self):
        self.keys = {}

    def register(self, fileobj, _events, data):
        self.keys[fileobj] = SimpleNamespace(fileobj=fileobj, data=data)

    def unregister(self, fileobj):
        del self.keys[fileobj]

    def get_map(self):
        return self.keys

    def close(self):
        self.keys = {}

    def select(self, timeout=None):
        end = time.monotonic() + (timeout if timeout is not None else 3600)
        while True:
            ready = [(key, 1) for key in self.keys.values() if self._ready(key.fileobj)]
            if ready or time.monotonic() >= end:
                return ready
            time.sleep(0.01)

    @staticmethod
    def _ready(fileobj):
        available = ctypes.c_ulong(0)
        handle = msvcrt.get_osfhandle(fileobj.fileno())
        return not ctypes.windll.kernel32.PeekNamedPipe(handle, None, 0, None, ctypes.byref(available), None) or available.value > 0


def install_shims(M, source_id, source_name, base):
    real_popen = subprocess.Popen
    real_read = os.read
    stderr_fds, stderr_log = set(), []

    def popen(command, **kwargs):
        proc = real_popen([part for part in command if part != HOST_ARG], **kwargs)
        stderr_fds.add(proc.stderr.fileno())
        return proc

    def read(fd, size):
        chunk = real_read(fd, size)
        if fd in stderr_fds and chunk:
            stderr_log.append(chunk.decode(errors='replace')[:800])
        return chunk

    def private_file(path):
        return open(path, 'xb')

    M.SOURCE_ID, M.SOURCE_NAME, M.BASE = source_id, source_name, base
    M.ENV = {**os.environ, 'LC_ALL': 'C'}
    M.subprocess = SimpleNamespace(Popen=popen, PIPE=subprocess.PIPE, DEVNULL=subprocess.DEVNULL, TimeoutExpired=subprocess.TimeoutExpired)
    M.selectors = SimpleNamespace(DefaultSelector=PipeSelector, EVENT_READ=1)
    M.signal = SimpleNamespace(alarm=lambda _seconds: 0)
    M.sys = SimpleNamespace(platform='linux', version_info=sys.version_info)
    M.safe_directory = lambda path, private=False: None
    M.private_file = private_file
    M.sync_directory = lambda path: None
    os.read = read
    os.geteuid = lambda: 0
    os.statvfs = lambda _path: SimpleNamespace(f_bavail=8 * 1024 ** 3, f_frsize=1)
    meminfo = pathlib.Path.read_text

    def read_text(self, *args, **kwargs):
        return 'MemAvailable: 4194304 kB\n' if self.name == 'meminfo' else meminfo(self, *args, **kwargs)
    pathlib.Path.read_text = read_text
    return stderr_log


def wait_healthy(container):
    for _ in range(120):
        if docker('inspect', '--format', '{{.State.Health.Status}}', container) == 'healthy':
            return
        time.sleep(1)
    raise RuntimeError('source did not become healthy')


def source_fingerprint(container):
    sql = "SELECT count(*), sum(hashtext(label)) FROM public.rehearsal_synthetic; SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r';"
    return docker('exec', '--user', 'postgres', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-c', sql)


def create_source(name, nonce, network='none', api_password=None):
    source_id = docker('run', '-d', '--pull=never', '--name', name, '--network', network, *([] if network == 'none' else ['--network-alias', 'postgres']),
                       '--label', 'com.docker.compose.project=thaara-v2-pilot', '--label', 'com.docker.compose.service=postgres',
                       '--label', 'thaara.phone-rehearsal=' + nonce, '--tmpfs', '/var/lib/postgresql/data',
                       '--health-cmd', 'pg_isready -U postgres -d thaara_vps_pilot', '--health-interval', '2s', '--health-retries', '30',
                       '-e', 'POSTGRES_DB', '-e', 'POSTGRES_USER', '-e', 'POSTGRES_PASSWORD', IMAGE_TAG,
                       env={**os.environ, 'POSTGRES_DB': 'thaara_vps_pilot', 'POSTGRES_USER': 'postgres', 'POSTGRES_PASSWORD': secrets.token_urlsafe(32)})
    wait_healthy(source_id)
    docker('exec', source_id, 'sh', '-c', 'mkdir -p /run/secrets && chown postgres /run/secrets')
    docker('exec', '-i', '--user', 'postgres', source_id, 'sh', '-c', 'cat > /run/secrets/api_password', input=(api_password or secrets.token_urlsafe(48)).encode())
    bundle_loader = "import {buildPilotDbBundle as b} from %s;process.stdout.write(b(process.cwd()).sql)" % json.dumps((ROOT / 'deploy/hostinger-pilot/pilot-db-bundle.mjs').as_uri())
    bundle = subprocess.run(['node', '--input-type=module', '-e', bundle_loader], cwd=ROOT, capture_output=True, timeout=60, shell=False)
    if bundle.returncode != 0:
        raise RuntimeError('bundle build failed: ' + bundle.stderr.decode(errors='replace')[:800])
    docker('exec', '-i', '--user', 'postgres', source_id, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-o', '/dev/null', '-U', 'postgres', '-d', 'thaara_vps_pilot', input=bundle.stdout)
    # Same later reviewed migrations the pilot's publish scripts applied; phone 110a-c are not on the pilot and stay out.
    guard10825 = "SELECT set_config('thaara.step10825_review_approved','yes',false), set_config('thaara.step10825_target_database',current_database(),false);\n"
    later = (ROOT / 'docs/migrations/10821-whatsapp-media.review.sql').read_bytes() + b'\n' + guard10825.encode() + (ROOT / 'docs/migrations/10825-whatsapp-templates-media-contacts.review.sql').read_bytes()
    docker('exec', '-i', '--user', 'postgres', source_id, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-o', '/dev/null', '-U', 'postgres', '-d', 'thaara_vps_pilot', input=later)
    docker('exec', '-i', '--user', 'postgres', source_id, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'thaara_vps_pilot', input=SEED.encode())
    return source_id


def main():
    if docker('context', 'show') != 'desktop-linux':
        raise RuntimeError('refusing: not the local Docker Desktop context')
    M = load_runner()
    if docker('image', 'inspect', '--format', '{{.Id}}', IMAGE_TAG) != M.IMAGE_ID:
        raise RuntimeError('refusing: local image differs from the pinned pilot image')
    nonce = secrets.token_hex(8)
    name = 'thaara-phone-rehearsal-source-' + nonce
    work = pathlib.Path(tempfile.mkdtemp(prefix='thaara-phone-rehearsal-'))
    report = {'status': 'failed', 'mode': 'local_rehearsal', 'vpsAccess': False, 'syntheticDataOnly': True}
    volumes_before = set(docker('volume', 'ls', '-q').split())
    source_id = None
    try:
        source_id = create_source(name, nonce)
        before = source_fingerprint(source_id)
        base = work / 'phone-backups'
        stderr_log = install_shims(M, source_id, name, base)
        real_category = M.diagnostic_category
        errors = []

        def category(error):
            errors.append({'type': type(error).__name__, 'code': str(error)[:300], 'trace': traceback.format_exc()[-1200:]})
            return real_category(error)
        M.diagnostic_category = category
        real_role_state = M.role_state
        role_states = []

        def role_state(session, bootstrap):
            role_states.append(real_role_state(session, bootstrap))
            return role_states[-1]
        M.role_state = role_state
        real_canonical = M.canonical_schema
        schemas = []

        def canonical_schema(data):
            schemas.append(real_canonical(data))
            return schemas[-1]
        M.canonical_schema = canonical_schema
        receipt = M.run()
        if len(schemas) == 2 and schemas[0] != schemas[1]:
            report['schemaDiff'] = list(difflib.unified_diff(schemas[0].decode(errors='replace').splitlines(), schemas[1].decode(errors='replace').splitlines(), 'source', 'restored', lineterm='', n=0))[:400]
        if len(role_states) == 2:
            for part in ('roles', 'memberships'):
                left, right = [{json.dumps(row) for row in state[part]} for state in role_states]
                report[part + 'OnlyInSource'], report[part + 'OnlyInRestore'] = sorted(left - right), sorted(right - left)
        files = sorted(p.name for folder in base.iterdir() for p in folder.iterdir()) if base.exists() else []
        report.update(receipt=receipt, errors=errors, stderr=stderr_log[-8:], backupFiles=files,
                      sourceUnchanged=source_fingerprint(source_id) == before, sourceFingerprint=before,
                      fixturesLeft=docker('ps', '-a', '--filter', 'label=thaara.phone-restore', '--format', '{{.Names}}').split())
        report['status'] = 'verified' if receipt.get('status') == 'verified' and receipt.get('cleanupVerified') else 'failed'
    except Exception as error:
        report['harnessError'] = str(error)[:1000]
    finally:
        if source_id:
            docker('rm', '-f', '-v', source_id, check=False)
        shutil.rmtree(work, ignore_errors=True)
        report['sourceRemoved'] = not docker('ps', '-a', '--filter', 'label=thaara.phone-rehearsal=' + nonce, '--format', '{{.ID}}')
        report['volumesLeft'] = sorted(set(docker('volume', 'ls', '-q').split()) - volumes_before)
        report['workRemoved'] = not work.exists()
    REPORT.write_text(json.dumps(report, indent=1, sort_keys=True), encoding='utf-8')
    print(json.dumps(report, indent=1, sort_keys=True))
    return 0 if report['status'] == 'verified' else 1


if __name__ == '__main__':
    sys.exit(main())
