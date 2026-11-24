"""Step108.23b approved UI-only pilot publisher (chat scrolling). No SQL, no data change, sending stays disabled."""
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

BASE = 'sha256:1cbe1786f7fa350a655307f0f4447f200ae85176cee9333ef5ced591b8303296'
ARCHIVE_SHA = 'c76774bfbde074278409f404446655d3cb16eba6a87c98dae55e4d290f387782'
LINK_SHA = '2885a39671346932339a87cb5b616b2a117ef593eb2ee9d32fa5f267cb273016'
P = Path('/opt/thaara-v2-pilot')
API = 'thaara-v2-pilot-api-1'
PG = 'thaara-v2-pilot-postgres-1'
DB = 'thaara_vps_pilot'
LINK = P / 'n8n-link-v2.sh'
SITE = 'https://thaara-v2.quantumweaveai.io'
ALLOWED = ['Dockerfile', 'manifest.json', 'web-dist']

def run(args, check=True, env=None, timeout=240):
    result = subprocess.run(args, capture_output=True, text=True, env=env, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError('Command failed; output withheld: ' + args[0])
    return result

def inspect(name):
    return json.loads(run(['docker', 'inspect', name]).stdout)[0]

def identity(facts):
    return (facts['Id'], facts['State']['StartedAt'], facts['RestartCount'])

def database_facts():
    # Read-only proof that publication changes no data or schema.
    out = run(['docker', 'exec', '--user', 'postgres', PG, 'psql', '-X', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-tAc', """BEGIN READ ONLY; SELECT json_build_object(
      'messages',(SELECT count(*) FROM public.whatsapp_n8n_messages),'connections',(SELECT count(*) FROM public.whatsapp_n8n_connections),
      'dispatches',(SELECT count(*) FROM public.whatsapp_n8n_dispatches),'events',(SELECT count(*) FROM public.whatsapp_n8n_status_events),
      'audit',(SELECT count(*) FROM public.audit_events),'schema',(SELECT md5(string_agg(table_name||'.'||column_name||':'||data_type,',' ORDER BY table_name,column_name)) FROM information_schema.columns WHERE table_schema='public')); ROLLBACK;"""]).stdout
    return next(json.loads(line) for line in out.splitlines() if line.startswith('{'))

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
    assert hashlib.sha256(LINK.read_bytes()).hexdigest() == LINK_SHA
    api = inspect(API)
    assert api['Image'] == BASE and api['State']['Health']['Status'] == 'healthy'
    assert 'THAARA_WHATSAPP_SEND_ENABLED=false' in api['Config']['Env']
    assert list(inspect('n8n-n8n-1')['NetworkSettings']['Networks']) == ['n8n_default']
    assert run(['curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '8', 'https://n8n.srv1871828.hstgr.cloud/healthz']).stdout == '200'
    services = [PG, 'thaara-v2-pilot-redis-1', 'n8n-n8n-1', 'n8n-traefik-1']
    before = {name: identity(inspect(name)) for name in services}
    facts = database_facts()
    raw = base64.b64decode(payload, validate=True)
    assert hashlib.sha256(raw).hexdigest() == ARCHIVE_SHA
    directory = Path('/opt/thaara-v2-pilot-private/handoff') / ('chat-scroll-10823b-' + time.strftime('%Y%m%dT%H%M%SZ'))
    directory.mkdir(mode=0o700, exist_ok=False)
    context = directory / 'context'
    context.mkdir(mode=0o700)
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        members = archive.getmembers()
        assert len(members) < 30
        for member in members:
            path = Path(member.name)
            assert not path.is_absolute() and '..' not in path.parts and '\\' not in member.name
            assert member.isfile() or member.isdir()
            assert path.parts[0] in ALLOWED
        archive.extractall(context)
    manifest = json.loads((context / 'manifest.json').read_text(encoding='utf-8'))
    for item in manifest:
        path = Path(item['Path'])
        assert not path.is_absolute() and '..' not in path.parts
        assert hashlib.sha256((context / path).read_bytes()).hexdigest() == item['SHA256']
    print('artifact_checksums=verified files=' + str(len(manifest)), flush=True)
    tag = 'thaara-v2-scroll-base:10823b-1cbe1786'
    exists = run(['docker', 'image', 'inspect', tag], check=False)
    if exists.returncode == 0:
        assert json.loads(exists.stdout)[0]['Id'] == BASE
    else:
        run(['docker', 'tag', BASE, tag])
    # --no-cache: unchanged size+mtime must never let a stale file survive (seen in 108.23b).
    build = run(['docker', 'build', '--no-cache', '--network=none', '--pull=false', '--build-arg', 'BASE_IMAGE=' + tag, '-t', 'thaara-v2-chat-scroll:10823b', str(context)], check=False, timeout=240)
    (directory / 'build.log').write_text(build.stdout + build.stderr)
    if build.returncode:
        raise RuntimeError('Overlay build failed; nothing changed; private build.log retained')
    new = json.loads(run(['docker', 'image', 'inspect', 'thaara-v2-chat-scroll:10823b']).stdout)[0]
    old = json.loads(run(['docker', 'image', 'inspect', BASE]).stdout)[0]
    image = new['Id']
    assert new['RootFS']['Layers'][:len(old['RootFS']['Layers'])] == old['RootFS']['Layers']
    assert 1 <= len(new['RootFS']['Layers']) - len(old['RootFS']['Layers']) <= 7
    for key in ['Cmd', 'Entrypoint', 'Env', 'User', 'WorkingDir', 'ExposedPorts', 'Healthcheck', 'Volumes', 'StopSignal']:
        assert new['Config'].get(key) == old['Config'].get(key)
    print('overlay_build=passed image=' + image, flush=True)
    env_path = P / '.env'
    original = env_path.read_bytes()
    lines = [line for line in original.decode().splitlines() if line.strip() and not line.lstrip().startswith('#')]
    assert len(lines) == 1 and lines[0] == 'THAARA_PILOT_API_IMAGE=' + BASE
    (directory / 'previous-image.env').write_bytes(original)
    shutil.copy2(P / 'compose.json', directory / 'compose.json')
    os.chmod(directory / 'compose.json', 0o600)
    compose = ['docker', 'compose', '-p', 'thaara-v2-pilot', '-f', str(P / 'compose.json'), '--profile', 'application']
    old_env = dict(os.environ, THAARA_PILOT_API_IMAGE=BASE)
    new_env = dict(os.environ, THAARA_PILOT_API_IMAGE=image)
    resolved = json.loads(run(compose + ['config', '--format', 'json'], env=old_env).stdout)
    updated = json.loads(run(compose + ['config', '--format', 'json'], env=new_env).stdout)
    assert resolved['services']['api'].pop('image') == BASE and updated['services']['api'].pop('image') == image
    assert resolved == updated
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
        assert list(inspect('n8n-n8n-1')['NetworkSettings']['Networks']) == ['n8n_default'], 'check=n8n_single_network'
        assets = 0
        for item in manifest:
            if item['Path'].startswith('web-dist/'):
                asset = item['Path'][len('web-dist/'):]
                # The public router may serve the previous container for a few seconds after recreation.
                for attempt in range(10):
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
                                       (durable + '/wa_pilot_meta_test_10813b/contacts', 'GET', '401')]:
            assert status(path, method) == expected, 'check=public_path ' + path
            print('public_path=' + path + ' status=' + expected, flush=True)
        after = database_facts()
        # New inbound messages/events may arrive meanwhile; nothing may be lost and the schema must be identical.
        assert after['schema'] == facts['schema'] and all(after[k] >= facts[k] for k in facts if k != 'schema'), 'Database drift during publication'
        print('database=schema_unchanged rows_not_reduced', flush=True)
        final = {'image': image, 'archive_sha256': ARCHIVE_SHA, 'send_enabled': False, 'sql_applied': False, 'other_services_unchanged': True, 'rollback_directory': str(directory)}
        (directory / 'result.json').write_text(json.dumps(final))
        print(json.dumps(final), flush=True)
    except Exception:
        print('publication_failed=attempting_API_rollback', flush=True)
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
        assert globals().get('OWNER_APPROVED_10823B') is True
        publish(globals()['PAYLOAD'])
    except Exception as error:
        print('Step10823b stopped: ' + str(error) if isinstance(error, (AssertionError, RuntimeError)) else 'Step10823b stopped; private diagnostics withheld', flush=True)
        raise SystemExit(1)
