"""Step108.25-108.27 approved pilot publisher: private backup, pinned 10825 SQL, API-only overlay, link restore.
Sending stays OFF. No live-on, token entry, workflow change or provider call. Never logs secrets."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import time
import urllib.request

BASE = 'sha256:85fea59e583aa761b6759fe2347b5624433fc4ea06a46361f7756e2b5bddbd4b'
ARCHIVE_SHA = '47a0b3ca6c4dc0a93ddc962a82d0e8e408c8ec2c3946b8993edc5006a9c684d0'
SQL_SHA = '03f152fd0755cdfa5a00be8cba59cf33f4ad792c9d5ec0684189f651572672ee'
SQL_NAME = '10825-whatsapp-templates-media-contacts.review.sql'
LINK_SHA = '2885a39671346932339a87cb5b616b2a117ef593eb2ee9d32fa5f267cb273016'
P = Path('/opt/thaara-v2-pilot')
API = 'thaara-v2-pilot-api-1'
PG = 'thaara-v2-pilot-postgres-1'
DB = 'thaara_vps_pilot'
LINK = P / 'n8n-link-v2.sh'
SITE = 'https://thaara-v2.quantumweaveai.io'
ALLOWED = ['Dockerfile', 'manifest.json', SQL_NAME, 'patch-whatsapp-compose.mjs', 'pilot-compose-base.json', 'contracts', 'db', 'api-services', 'api-routes', 'api-root', 'web-dist', 'host-scripts']
TABLES = ['whatsapp_n8n_connections', 'whatsapp_n8n_messages', 'whatsapp_n8n_dispatches', 'whatsapp_n8n_status_events']

def run(args, check=True, env=None, timeout=240, stdin=None):
    result = subprocess.run(args, capture_output=True, text=True, env=env, timeout=timeout, input=stdin)
    if check and result.returncode:
        raise RuntimeError('Command failed; output withheld: ' + args[0])
    return result

def inspect(name):
    return json.loads(run(['docker', 'inspect', name]).stdout)[0]

def identity(facts):
    return (facts['Id'], facts['State']['StartedAt'], facts['RestartCount'])

def sql(query):
    out = run(['docker', 'exec', '--user', 'postgres', PG, 'psql', '-X', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-tAc', 'BEGIN READ ONLY; ' + query + '; ROLLBACK;']).stdout
    return next(json.loads(line) for line in out.splitlines() if line.startswith('{'))

def database_facts():
    # Read-only: row counts, RLS/ACL/policies/triggers per durable table, and the 10825 markers.
    per_table = ','.join(f"""'{t}',(SELECT json_build_object('rows',(SELECT count(*) FROM public.{t}),'rls',c.relrowsecurity AND c.relforcerowsecurity,'acl',md5(coalesce(c.relacl::text,'')),
      'policies',(SELECT md5(coalesce(string_agg(pg_get_expr(polqual,polrelid)||coalesce(pg_get_expr(polwithcheck,polrelid),''),';' ORDER BY polname),'')) FROM pg_policy WHERE polrelid=c.oid),
      'triggers',(SELECT md5(coalesce(string_agg(pg_get_triggerdef(oid),';' ORDER BY tgname),'')) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)) FROM pg_class c WHERE c.oid='public.{t}'::regclass)""" for t in TABLES)
    return sql(f"""SELECT json_build_object('database',current_database(),'tables',json_build_object({per_table}),
      'audit_rows',(SELECT count(*) FROM public.audit_events),
      'media_check',EXISTS(SELECT 1 FROM pg_constraint WHERE conname='whatsapp_n8n_media_metadata_10821_check'),
      'principals',to_regclass('public.whatsapp_n8n_relay_principals') IS NOT NULL,
      'step10825',(SELECT count(*) FROM pg_constraint WHERE conname IN ('whatsapp_n8n_dispatch_draft_10825_check','whatsapp_n8n_audit_action_10825_check')),
      'issuer_owner',(SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.issue_whatsapp_audit_proof()'::regprocedure))""")

def unchanged_except_schema(before, after):
    # Rows may only grow (live inbound may arrive); RLS, grants, policies and trigger definitions must be identical.
    for t in TABLES:
        b, a = before['tables'][t], after['tables'][t]
        assert a['rows'] >= b['rows'] and all(a[k] == b[k] for k in ['rls', 'acl', 'policies', 'triggers']), 'check=table_unchanged ' + t
    assert after['audit_rows'] >= before['audit_rows'], 'check=audit_rows_not_reduced'

def wait_api():
    for _ in range(40):
        if inspect(API)['State'].get('Health', {}).get('Status') == 'healthy':
            return
        time.sleep(3)
    raise RuntimeError('Pilot API health timeout')

def restore_link():
    if 'n8n_default' in inspect(API)['NetworkSettings']['Networks']:
        raise RuntimeError('Unexpected existing API link before restoration')
    result = run(['bash', str(LINK)], check=False, timeout=240)
    markers = ['n8n_to_pilot_health=200', 'forged_callback_status=403', 'public_watch=12/12 ok', 'n8n_single_network=yes', 'n8n_not_restarted=yes']
    for line in result.stdout.splitlines():
        if any(line.startswith(marker.split('=')[0] + '=') for marker in markers):
            print(line, flush=True)
    if result.returncode or not all(marker in result.stdout for marker in markers):
        raise RuntimeError('Private link acceptance failed')

def status(path, method='GET'):
    return run(['curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '10', '-X', method, SITE + path]).stdout

def publish(payload):
    assert os.getuid() == 0
    os.umask(0o077)
    assert hashlib.sha256(LINK.read_bytes()).hexdigest() == LINK_SHA, 'check=link_script_pinned'
    api = inspect(API)
    assert api['Image'] == BASE and api['State']['Health']['Status'] == 'healthy', 'check=base_image_healthy'
    assert 'THAARA_WHATSAPP_SEND_ENABLED=false' in api['Config']['Env'], 'check=send_off_before'
    assert list(inspect('n8n-n8n-1')['NetworkSettings']['Networks']) == ['n8n_default'], 'check=n8n_single_network'
    assert run(['curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '8', 'https://n8n.srv1871828.hstgr.cloud/healthz']).stdout == '200', 'check=n8n_public_health'
    services = [PG, 'thaara-v2-pilot-redis-1', 'n8n-n8n-1', 'n8n-traefik-1']
    before = {name: identity(inspect(name)) for name in services}
    facts = database_facts()
    assert facts['database'] == DB and facts['media_check'] and facts['principals'] and facts['step10825'] == 0, 'check=expected_base_schema'
    assert facts['issuer_owner'] == 'thaara_whatsapp_audit_guard', 'check=issuer_owner_before'
    raw = base64.b64decode(payload, validate=True)
    assert hashlib.sha256(raw).hexdigest() == ARCHIVE_SHA, 'check=archive_sha'
    directory = Path('/opt/thaara-v2-pilot-private/handoff') / ('whatsapp-compose-10827-' + time.strftime('%Y%m%dT%H%M%SZ'))
    directory.mkdir(mode=0o700, exist_ok=False)
    context = directory / 'context'
    context.mkdir(mode=0o700)
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        members = archive.getmembers()
        assert len(members) < 60, 'check=archive_size'
        for member in members:
            path = Path(member.name)
            assert not path.is_absolute() and '..' not in path.parts and '\\' not in member.name and (member.isfile() or member.isdir()) and path.parts[0] in ALLOWED, 'check=archive_member'
        archive.extractall(context)
    manifest = json.loads((context / 'manifest.json').read_text(encoding='utf-8'))
    for item in manifest:
        path = Path(item['Path'])
        assert not path.is_absolute() and '..' not in path.parts
        assert hashlib.sha256((context / path).read_bytes()).hexdigest() == item['SHA256'], 'check=manifest ' + item['Path']
    sql_file = context / SQL_NAME
    assert hashlib.sha256(sql_file.read_bytes()).hexdigest() == SQL_SHA, 'check=sql_sha'
    print('artifact_checksums=verified files=' + str(len(manifest)), flush=True)
    tag = 'thaara-v2-compose-base:10827-85fea59e'
    exists = run(['docker', 'image', 'inspect', tag], check=False)
    if exists.returncode == 0:
        assert json.loads(exists.stdout)[0]['Id'] == BASE, 'check=base_tag'
    else:
        run(['docker', 'tag', BASE, tag])
    # --no-cache: unchanged size+mtime must never let a stale file survive (seen in 108.23b).
    build = run(['docker', 'build', '--no-cache', '--network=none', '--pull=false', '--build-arg', 'BASE_IMAGE=' + tag, '-t', 'thaara-v2-whatsapp-compose:10827', str(context)], check=False, timeout=300)
    (directory / 'build.log').write_text(build.stdout + build.stderr)
    if build.returncode:
        raise RuntimeError('Overlay build failed before backup/SQL; nothing changed; private build.log retained')
    new = json.loads(run(['docker', 'image', 'inspect', 'thaara-v2-whatsapp-compose:10827']).stdout)[0]
    old = json.loads(run(['docker', 'image', 'inspect', BASE]).stdout)[0]
    image = new['Id']
    assert new['RootFS']['Layers'][:len(old['RootFS']['Layers'])] == old['RootFS']['Layers'], 'check=layer_prefix'
    assert 1 <= len(new['RootFS']['Layers']) - len(old['RootFS']['Layers']) <= 10, 'check=layer_delta'
    for key in ['Cmd', 'Entrypoint', 'Env', 'User', 'WorkingDir', 'ExposedPorts', 'Healthcheck', 'Volumes', 'StopSignal']:
        assert new['Config'].get(key) == old['Config'].get(key), 'check=config ' + key
    print('overlay_build=passed image=' + image, flush=True)
    env_path = P / '.env'
    original = env_path.read_bytes()
    lines = [line for line in original.decode().splitlines() if line.strip() and not line.lstrip().startswith('#')]
    assert len(lines) == 1 and lines[0] == 'THAARA_PILOT_API_IMAGE=' + BASE, 'check=env_matches_base'
    (directory / 'previous-image.env').write_bytes(original)
    shutil.copy2(P / 'compose.json', directory / 'compose.json'); os.chmod(directory / 'compose.json', 0o600)
    compose = ['docker', 'compose', '-p', 'thaara-v2-pilot', '-f', str(P / 'compose.json'), '--profile', 'application']
    old_env, new_env = dict(os.environ, THAARA_PILOT_API_IMAGE=BASE), dict(os.environ, THAARA_PILOT_API_IMAGE=image)
    resolved = json.loads(run(compose + ['config', '--format', 'json'], env=old_env).stdout)
    updated = json.loads(run(compose + ['config', '--format', 'json'], env=new_env).stdout)
    assert resolved['services']['api'].pop('image') == BASE and updated['services']['api'].pop('image') == image and resolved == updated, 'check=compose_only_image_changes'
    # Private pre-change backup (custom format) with archive-list validation. Not a restore rehearsal.
    backup = directory / 'before-10825.dump'
    with backup.open('xb') as stream:
        dump = subprocess.run(['docker', 'exec', '--user', 'postgres', PG, 'pg_dump', '-U', 'postgres', '-d', DB, '-Fc'], stdout=stream, stderr=subprocess.PIPE, timeout=120)
    assert dump.returncode == 0 and backup.stat().st_size > 100, 'check=backup_created'
    with backup.open('rb') as stream:
        listing = subprocess.run(['docker', 'exec', '-i', '--user', 'postgres', PG, 'pg_restore', '-l'], stdin=stream, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=60)
    assert listing.returncode == 0, 'check=backup_listing'
    (directory / 'database-before.json').write_text(json.dumps(facts))
    print('private_backup=created_and_archive_list_validated', flush=True)
    # Exact reviewed transaction only (BEGIN..COMMIT inside the file); on error it rolls back and the old API keeps running.
    guard = "SELECT set_config('thaara.step10825_review_approved','yes',false), set_config('thaara.step10825_target_database',current_database(),false);\n"
    migration = run(['docker', 'exec', '-i', '--user', 'postgres', PG, 'psql', '-X', '-q', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1'], check=False, timeout=60,
                    stdin=guard + sql_file.read_text(encoding='utf-8'))
    if migration.returncode:
        raise RuntimeError('10825 SQL failed and rolled back; old API and schema remain')
    after_sql = database_facts()
    assert after_sql['step10825'] == 2 and after_sql['issuer_owner'] == 'thaara_whatsapp_audit_guard', 'check=10825_installed'
    unchanged_except_schema(facts, after_sql)
    (directory / 'database-after-sql.json').write_text(json.dumps(after_sql))
    print('step10825_sql=applied rows_rls_grants_policies_triggers=unchanged', flush=True)
    changed = False
    try:
        env_path.write_text('THAARA_PILOT_API_IMAGE=' + image + '\n')
        changed = True
        run(compose + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=new_env)
        wait_api()
        restore_link()
        assert inspect(API)['Image'] == image, 'check=api_image'
        assert 'THAARA_WHATSAPP_SEND_ENABLED=false' in inspect(API)['Config']['Env'], 'check=send_disabled'
        assert all(identity(inspect(name)) == value for name, value in before.items()), 'check=other_services_unchanged'
        assert list(inspect('n8n-n8n-1')['NetworkSettings']['Networks']) == ['n8n_default'], 'check=n8n_single_network_after'
        assets = 0
        for item in manifest:
            if item['Path'].startswith('web-dist/'):
                asset = item['Path'][len('web-dist/'):]
                for _ in range(10):
                    try:
                        with urllib.request.urlopen(SITE + '/' + ('' if asset == 'index.html' else asset), timeout=12) as response:
                            got = (response.status, hashlib.sha256(response.read()).hexdigest())
                    except Exception:
                        got = (0, '')
                    if got == (200, item['SHA256']):
                        break
                    time.sleep(3)
                assert got == (200, item['SHA256']), 'check=public_asset ' + asset + ' status=' + str(got[0]) + ' sha=' + got[1][:12]
                assets += 1
        print('trusted_public_assets=' + str(assets) + '/' + str(assets), flush=True)
        durable = '/api/v1/connectors/whatsapp/n8n/durable'
        for path, method, expected in [('/api/v1/health', 'GET', '200'), ('/api/v1/auth/me', 'GET', '401'), (durable + '/connections', 'GET', '401'),
                                       (durable + '/wa_pilot_meta_test_10813b/contacts', 'GET', '401'), (durable + '/wa_pilot_meta_test_10813b/templates', 'GET', '401')]:
            assert status(path, method) == expected, 'check=public_path ' + path
            print('public_path=' + path + ' status=' + expected, flush=True)
        final_facts = database_facts()
        unchanged_except_schema(after_sql, final_facts)
        assert final_facts['step10825'] == 2, 'check=10825_still_installed'
        print('database=10825_present rows_not_reduced', flush=True)
        for name in ['pilot-meta-key-entry.sh', 'pilot-send-live-on.sh', 'pilot-send-live-off.sh']:
            shutil.copy2(context / 'host-scripts' / name, P / name); os.chmod(P / name, 0o700)
        print('host_scripts_installed=meta-key-entry,live-on(unlimited default),live-off (none run)', flush=True)
        final = {'image': image, 'archive_sha256': ARCHIVE_SHA, 'sql_sha256': SQL_SHA, 'send_enabled': False, 'other_services_unchanged': True, 'rollback_directory': str(directory)}
        (directory / 'result.json').write_text(json.dumps(final))
        print(json.dumps(final), flush=True)
    except Exception:
        # The additive 10825 schema is kept: it accepts everything the previous API writes (text drafts, unchanged
        # contacts), so returning to the previous image is safe while no rich/contact records exist yet.
        print('publication_failed=attempting_API_rollback step10825_schema_retained=yes', flush=True)
        if changed:
            env_path.write_bytes(original)
            run(compose + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=old_env)
            wait_api()
            restore_link()
            assert inspect(API)['Image'] == BASE
            print('API_rollback=verified', flush=True)
        raise

# The pinned SSH wrapper supplies only the already reviewed non-secret artifact.
if __name__ == '__main__':
    try:
        assert globals().get('OWNER_APPROVED_10827') is True
        publish(globals()['PAYLOAD'])
    except Exception as error:
        print('Step10827 stopped: ' + str(error) if isinstance(error, (AssertionError, RuntimeError)) else 'Step10827 stopped; private diagnostics withheld', flush=True)
        raise SystemExit(1)
