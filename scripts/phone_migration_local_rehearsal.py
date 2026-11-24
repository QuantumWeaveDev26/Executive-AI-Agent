"""LOCAL rehearsal of persistent phone 110a/b/c through the real runner, on throwaway synthetic Postgres.

Scenario 1: fresh backup + restore + migration, app-role checks, a later backup of the migrated schema, refused second run.
Scenario 2: a lock on approval_requests makes 110b fail, proving partial state is reported truthfully.
Never uses SSH, the VPS, real credentials or a provider. Needs explicit owner approval because it starts temporary databases.
"""
import base64
import difflib
import json
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import time

import phone_backup_local_rehearsal as R

REPORT = R.ROOT / 'node_modules/.cache/phone-migration-local-rehearsal.json'
SQL = {'110a': '110a-phone-contacts', '110b': '110b-phone-calls', '110c': '110c-phone-live-mode'}
APP_CHECK = """SET ROLE thaara_app;
SELECT count(*) FROM public.phone_contacts;
SELECT count(*) FROM public.phone_calls;
"""
APP_DELETE = "SET ROLE thaara_app; DELETE FROM public.phone_contacts;"


def scenario(nonce_label, body):
    nonce = secrets.token_hex(8)
    name = 'thaara-phone-rehearsal-source-' + nonce
    work = pathlib.Path(tempfile.mkdtemp(prefix='thaara-phone-migration-'))
    M = R.load_runner()
    M.MIGRATION_SQL_B64 = {step: base64.b64encode((R.ROOT / 'docs/migrations' / (stem + '.review.sql')).read_bytes()).decode() for step, stem in SQL.items()}
    source_id = None
    result = {'scenario': nonce_label}
    try:
        source_id = R.create_source(name, nonce)
        stderr_log = R.install_shims(M, source_id, name, work / 'phone-backups')
        real_category = M.diagnostic_category
        errors = []

        def category(error):
            errors.append(str(error)[:200])
            return real_category(error)
        M.diagnostic_category = category
        result.update(body(M, source_id))
        result.update(errors=errors, stderr=stderr_log[-6:])
    except Exception as error:
        result['harnessError'] = str(error)[:1000]
    finally:
        if source_id:
            R.docker('rm', '-f', '-v', source_id, check=False)
        shutil.rmtree(work, ignore_errors=True)
        result['sourceRemoved'] = not R.docker('ps', '-a', '--filter', 'label=thaara.phone-rehearsal=' + nonce, '--format', '{{.ID}}')
    return result


def psql(source_id, sql, check=True):
    done = subprocess.run(['docker', 'exec', '-i', '--user', 'postgres', source_id, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-v', 'ON_ERROR_STOP=1'],
                          input=sql.encode(), capture_output=True, timeout=60)
    if check and done.returncode != 0:
        raise RuntimeError('psql failed: ' + done.stderr.decode(errors='replace')[:500])
    return done


def full_flow(M, source_id):
    fingerprint = R.source_fingerprint(source_id)
    receipt = M.run_with_migration()
    app = psql(source_id, APP_CHECK).stdout.decode().split()
    denied = psql(source_id, APP_DELETE, check=False)
    real_canonical = M.canonical_schema
    schemas = []

    def canonical_schema(data):
        schemas.append(real_canonical(data))
        return schemas[-1]
    M.canonical_schema = canonical_schema
    later_backup = M.run()
    M.canonical_schema = real_canonical
    schema_diff = list(difflib.unified_diff(schemas[-2].decode(errors='replace').splitlines(), schemas[-1].decode(errors='replace').splitlines(), lineterm='', n=0)) if len(schemas) >= 2 else []
    again = M.migrate(M.Docker(), M.migration_inputs(), {'status': 'verified', 'sourceMutated': False})
    return {'receipt': receipt, 'appSeesNoRows': app == ['0', '0'], 'appDeleteDenied': denied.returncode != 0 and b'permission denied' in denied.stderr,
            'existingDataUnchanged': R.source_fingerprint(source_id).split('\n')[0] == fingerprint.split('\n')[0],
            'laterBackupSchemaDiff': schema_diff, 'laterBackupStatus': later_backup.get('status'), 'laterBackupCategory': later_backup.get('category'), 'laterBackupPhase': later_backup.get('phase'),
            'secondRun': {k: again.get(k) for k in ('status', 'category', 'migrationStep', 'migrationApplied', 'sourceMutated')}}


def partial_flow(M, source_id):
    holder = subprocess.Popen(['docker', 'exec', '-i', '--user', 'postgres', source_id, 'psql', '-X', '-q', '-U', 'postgres', '-d', 'thaara_vps_pilot'],
                              stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        holder.stdin.write(b'BEGIN; LOCK TABLE public.approval_requests IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(60);\n')
        holder.stdin.flush()
        for _ in range(50):
            if psql(source_id, "SELECT count(*) FROM pg_locks WHERE mode='AccessExclusiveLock' AND relation='public.approval_requests'::regclass;").stdout.strip() == b'1':
                break
            time.sleep(0.2)
        else:
            raise RuntimeError('lock holder did not start')
        receipt = M.migrate(M.Docker(), M.migration_inputs(), {'status': 'verified', 'sourceMutated': False})
    finally:
        holder.kill()
        holder.wait(timeout=10)
    exists = psql(source_id, "SELECT to_regclass('public.phone_contacts') IS NOT NULL, to_regclass('public.phone_calls') IS NOT NULL;").stdout.decode().strip()
    return {'receipt': receipt, 'independentContactsAndCalls': exists}


def main():
    if R.docker('context', 'show') != 'desktop-linux':
        raise RuntimeError('refusing: not the local Docker Desktop context')
    if R.docker('image', 'inspect', '--format', '{{.Id}}', R.IMAGE_TAG) != R.load_runner().IMAGE_ID:
        raise RuntimeError('refusing: local image differs from the pinned pilot image')
    volumes = set(R.docker('volume', 'ls', '-q').split())
    report = {'mode': 'local_migration_rehearsal', 'vpsAccess': False, 'syntheticDataOnly': True,
              'scenarios': [scenario('full', full_flow), scenario('partial_failure', partial_flow)]}
    report['volumesLeft'] = sorted(set(R.docker('volume', 'ls', '-q').split()) - volumes)
    report['fixturesLeft'] = R.docker('ps', '-a', '--filter', 'label=thaara.phone-restore', '--format', '{{.Names}}').split()
    REPORT.write_text(json.dumps(report, indent=1, sort_keys=True), encoding='utf-8')
    print(json.dumps(report, indent=1, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
