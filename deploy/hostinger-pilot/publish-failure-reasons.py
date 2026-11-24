"""Step108.30 approved pilot publisher: one-file API overlay that logs Meta delivery-failure reasons.
No SQL, no compose change. Live sending (key, text/rich mode) is preserved. Never logs secrets."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import time

BASE = 'sha256:522a3dd8346e760abd5bd5f4e623b2035c1fa80e41122905f3cc2a589c9f10d6'
ARCHIVE_SHA = 'fef42827014c55976fc9e48d1b99eb100037fb177644290a3ddc15099b568390'
LINK_SHA = '2885a39671346932339a87cb5b616b2a117ef593eb2ee9d32fa5f267cb273016'
P = Path('/opt/thaara-v2-pilot')
API = 'thaara-v2-pilot-api-1'
PG = 'thaara-v2-pilot-postgres-1'
LINK = P / 'n8n-link-v2.sh'
SITE = 'https://thaara-v2.quantumweaveai.io'
ALLOWED = ['Dockerfile', 'manifest.json', 'api-services']

def run(args, check=True, env=None, timeout=240):
    result = subprocess.run(args, capture_output=True, text=True, env=env, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError('Command failed; output withheld: ' + args[0])
    return result

def inspect(name):
    return json.loads(run(['docker', 'inspect', name]).stdout)[0]

def identity(facts):
    return (facts['Id'], facts['State']['StartedAt'], facts['RestartCount'])

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

def send_state():
    env = [e for e in inspect(API)['Config']['Env'] if e.startswith('THAARA_WHATSAPP_SEND_ENABLED=')]
    rich = run(['docker', 'exec', '-w', '/app/apps/api', API, 'node', '--input-type=module', '-e',
                "const m=await import('./pilot-config.mjs');const s=m.pilotSendSettings();console.log(s?String(s.profile.richMessages):'off')"]).stdout.strip()
    return (env, rich)

def publish(payload):
    assert os.getuid() == 0
    os.umask(0o077)
    assert hashlib.sha256(LINK.read_bytes()).hexdigest() == LINK_SHA, 'check=link_script_pinned'
    api = inspect(API)
    assert api['Image'] == BASE and api['State']['Health']['Status'] == 'healthy', 'check=base_image_healthy'
    state_before = send_state()
    print('send_state_before=' + json.dumps(state_before), flush=True)
    assert list(inspect('n8n-n8n-1')['NetworkSettings']['Networks']) == ['n8n_default'], 'check=n8n_single_network'
    services = [PG, 'thaara-v2-pilot-redis-1', 'n8n-n8n-1', 'n8n-traefik-1']
    before = {name: identity(inspect(name)) for name in services}
    raw = base64.b64decode(payload, validate=True)
    assert hashlib.sha256(raw).hexdigest() == ARCHIVE_SHA, 'check=archive_sha'
    directory = Path('/opt/thaara-v2-pilot-private/handoff') / ('failure-reasons-10830-' + time.strftime('%Y%m%dT%H%M%SZ'))
    directory.mkdir(mode=0o700, exist_ok=False)
    context = directory / 'context'
    context.mkdir(mode=0o700)
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        for member in archive.getmembers():
            path = Path(member.name)
            assert not path.is_absolute() and '..' not in path.parts and (member.isfile() or member.isdir()) and path.parts[0] in ALLOWED, 'check=archive_member'
        archive.extractall(context)
    for item in json.loads((context / 'manifest.json').read_text(encoding='utf-8')):
        assert hashlib.sha256((context / item['Path']).read_bytes()).hexdigest() == item['SHA256'], 'check=manifest ' + item['Path']
    tag = 'thaara-v2-failure-base:10830-522a3dd8'
    exists = run(['docker', 'image', 'inspect', tag], check=False)
    if exists.returncode == 0:
        assert json.loads(exists.stdout)[0]['Id'] == BASE, 'check=base_tag'
    else:
        run(['docker', 'tag', BASE, tag])
    build = run(['docker', 'build', '--no-cache', '--network=none', '--pull=false', '--build-arg', 'BASE_IMAGE=' + tag, '-t', 'thaara-v2-failure-reasons:10830', str(context)], check=False, timeout=300)
    (directory / 'build.log').write_text(build.stdout + build.stderr)
    if build.returncode:
        raise RuntimeError('Overlay build failed; nothing changed; private build.log retained')
    new = json.loads(run(['docker', 'image', 'inspect', 'thaara-v2-failure-reasons:10830']).stdout)[0]
    old = json.loads(run(['docker', 'image', 'inspect', BASE]).stdout)[0]
    image = new['Id']
    assert new['RootFS']['Layers'][:len(old['RootFS']['Layers'])] == old['RootFS']['Layers'] and 1 <= len(new['RootFS']['Layers']) - len(old['RootFS']['Layers']) <= 2, 'check=layers'
    for key in ['Cmd', 'Entrypoint', 'Env', 'User', 'WorkingDir', 'ExposedPorts', 'Healthcheck', 'Volumes', 'StopSignal']:
        assert new['Config'].get(key) == old['Config'].get(key), 'check=config ' + key
    print('overlay_build=passed image=' + image, flush=True)
    env_path = P / '.env'
    original_env = env_path.read_bytes()
    assert original_env.decode().strip() == 'THAARA_PILOT_API_IMAGE=' + BASE, 'check=env_matches_base'
    (directory / 'previous-image.env').write_bytes(original_env)
    compose = ['docker', 'compose', '-p', 'thaara-v2-pilot', '-f', str(P / 'compose.json'), '--profile', 'application']
    old_env, new_env = dict(os.environ, THAARA_PILOT_API_IMAGE=BASE), dict(os.environ, THAARA_PILOT_API_IMAGE=image)
    resolved = json.loads(run(compose + ['config', '--format', 'json'], env=old_env).stdout)
    updated = json.loads(run(compose + ['config', '--format', 'json'], env=new_env).stdout)
    assert resolved['services']['api'].pop('image') == BASE and updated['services']['api'].pop('image') == image and resolved == updated, 'check=compose_only_image_changes'
    recreated = False
    try:
        env_path.write_text('THAARA_PILOT_API_IMAGE=' + image + '\n')
        recreated = True
        run(compose + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=new_env)
        wait_api()
        restore_link()
        assert inspect(API)['Image'] == image, 'check=api_image'
        state_after = send_state()
        assert state_after == state_before, 'check=send_state_preserved'
        print('send_state_after=' + json.dumps(state_after), flush=True)
        assert all(identity(inspect(name)) == value for name, value in before.items()), 'check=other_services_unchanged'
        assert list(inspect('n8n-n8n-1')['NetworkSettings']['Networks']) == ['n8n_default'], 'check=n8n_single_network_after'
        assert run(['curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '10', SITE + '/api/v1/health']).stdout == '200', 'check=public_health'
        final = {'image': image, 'archive_sha256': ARCHIVE_SHA, 'send_state_preserved': True, 'other_services_unchanged': True, 'rollback_directory': str(directory)}
        (directory / 'result.json').write_text(json.dumps(final))
        print(json.dumps(final), flush=True)
    except Exception:
        print('publication_failed=attempting_API_rollback', flush=True)
        env_path.write_bytes(original_env)
        if recreated:
            run(compose + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=old_env)
            wait_api()
            restore_link()
            assert inspect(API)['Image'] == BASE
            print('API_rollback=verified', flush=True)
        raise

if __name__ == '__main__':
    try:
        assert globals().get('OWNER_APPROVED_10830') is True
        publish(globals()['PAYLOAD'])
    except Exception as error:
        print('Step10830 stopped: ' + str(error) if isinstance(error, (AssertionError, RuntimeError)) else 'Step10830 stopped; private diagnostics withheld', flush=True)
        raise SystemExit(1)
