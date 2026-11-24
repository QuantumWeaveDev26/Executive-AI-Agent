"""Step108.28 approved pilot publisher: mount the owner-entered Meta key to the API only and wire media/template/upload
adapters. No SQL. Sending stays OFF. The key is never read, printed or copied by this script."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tarfile
import time
import urllib.request

BASE = 'sha256:7f577bb120325f295949d93054c37e9c82d24f46689a7e008e3fa423d0f7e09c'
ARCHIVE_SHA = '387b283dfa26af76b5ed5c86b7761342490f351e479dada8855003ad43e6bd07'
LINK_SHA = '2885a39671346932339a87cb5b616b2a117ef593eb2ee9d32fa5f267cb273016'
P = Path('/opt/thaara-v2-pilot')
KEY = Path('/opt/thaara-v2-pilot-private/secrets/meta_access_token')
API = 'thaara-v2-pilot-api-1'
PG = 'thaara-v2-pilot-postgres-1'
LINK = P / 'n8n-link-v2.sh'
SITE = 'https://thaara-v2.quantumweaveai.io'
ALLOWED = ['Dockerfile', 'manifest.json', 'patch-whatsapp-meta.mjs', 'api-root']

def run(args, check=True, env=None, timeout=240, stdin=None):
    result = subprocess.run(args, capture_output=True, text=True, env=env, timeout=timeout, input=stdin)
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

def status(path):
    return run(['curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '10', SITE + path]).stdout

def publish(payload):
    assert os.getuid() == 0
    os.umask(0o077)
    assert hashlib.sha256(LINK.read_bytes()).hexdigest() == LINK_SHA, 'check=link_script_pinned'
    # Key presence by metadata only (owner-entered, root-only directory, readable by the API user). Never read.
    info = os.lstat(KEY)
    assert stat.S_ISREG(info.st_mode) and info.st_uid == 1000 and stat.S_IMODE(info.st_mode) == 0o400 and 20 <= info.st_size <= 4096, 'check=owner_key_file'
    print('owner_key_file=present_regular_0400_uid1000 (not read)', flush=True)
    api = inspect(API)
    assert api['Image'] == BASE and api['State']['Health']['Status'] == 'healthy', 'check=base_image_healthy'
    assert 'THAARA_WHATSAPP_SEND_ENABLED=false' in api['Config']['Env'], 'check=send_off_before'
    assert list(inspect('n8n-n8n-1')['NetworkSettings']['Networks']) == ['n8n_default'], 'check=n8n_single_network'
    services = [PG, 'thaara-v2-pilot-redis-1', 'n8n-n8n-1', 'n8n-traefik-1']
    before = {name: identity(inspect(name)) for name in services}
    raw = base64.b64decode(payload, validate=True)
    assert hashlib.sha256(raw).hexdigest() == ARCHIVE_SHA, 'check=archive_sha'
    directory = Path('/opt/thaara-v2-pilot-private/handoff') / ('meta-wiring-10828-' + time.strftime('%Y%m%dT%H%M%SZ'))
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
    print('artifact_checksums=verified', flush=True)
    tag = 'thaara-v2-meta-base:10828-7f577bb1'
    exists = run(['docker', 'image', 'inspect', tag], check=False)
    if exists.returncode == 0:
        assert json.loads(exists.stdout)[0]['Id'] == BASE, 'check=base_tag'
    else:
        run(['docker', 'tag', BASE, tag])
    build = run(['docker', 'build', '--no-cache', '--network=none', '--pull=false', '--build-arg', 'BASE_IMAGE=' + tag, '-t', 'thaara-v2-meta-wiring:10828', str(context)], check=False, timeout=300)
    (directory / 'build.log').write_text(build.stdout + build.stderr)
    if build.returncode:
        raise RuntimeError('Overlay build failed; nothing changed; private build.log retained')
    new = json.loads(run(['docker', 'image', 'inspect', 'thaara-v2-meta-wiring:10828']).stdout)[0]
    old = json.loads(run(['docker', 'image', 'inspect', BASE]).stdout)[0]
    image = new['Id']
    assert new['RootFS']['Layers'][:len(old['RootFS']['Layers'])] == old['RootFS']['Layers'] and 1 <= len(new['RootFS']['Layers']) - len(old['RootFS']['Layers']) <= 4, 'check=layers'
    for key in ['Cmd', 'Entrypoint', 'Env', 'User', 'WorkingDir', 'ExposedPorts', 'Healthcheck', 'Volumes', 'StopSignal']:
        assert new['Config'].get(key) == old['Config'].get(key), 'check=config ' + key
    print('overlay_build=passed image=' + image, flush=True)
    env_path, compose_path = P / '.env', P / 'compose.json'
    original_env, original_compose = env_path.read_bytes(), compose_path.read_bytes()
    lines = [line for line in original_env.decode().splitlines() if line.strip() and not line.lstrip().startswith('#')]
    assert len(lines) == 1 and lines[0] == 'THAARA_PILOT_API_IMAGE=' + BASE, 'check=env_matches_base'
    (directory / 'previous-image.env').write_bytes(original_env); (directory / 'compose.json').write_bytes(original_compose)
    model = json.loads(original_compose)
    assert 'meta_access_token' not in model.get('secrets', {}) and 'meta_access_token' not in model['services']['api'].get('secrets', []), 'check=key_not_yet_mounted'
    assert model['services']['api']['environment']['THAARA_WHATSAPP_SEND_ENABLED'] == 'false', 'check=compose_send_off'
    model['secrets']['meta_access_token'] = {'file': str(KEY)}
    model['services']['api']['secrets'] = list(model['services']['api']['secrets']) + ['meta_access_token']
    compose = ['docker', 'compose', '-p', 'thaara-v2-pilot', '-f', str(compose_path), '--profile', 'application']
    old_env, new_env = dict(os.environ, THAARA_PILOT_API_IMAGE=BASE), dict(os.environ, THAARA_PILOT_API_IMAGE=image)
    resolved_before = json.loads(run(compose + ['config', '--format', 'json'], env=old_env).stdout)
    changed = recreated = False
    try:
        compose_path.write_text(json.dumps(model, indent=2)); env_path.write_text('THAARA_PILOT_API_IMAGE=' + image + '\n'); changed = True
        resolved = run(compose + ['config', '--format', 'json'], env=new_env).stdout
        # The project's own compose validator, run inside the new image (no network): only the key mount may be added.
        check = run(['docker', 'run', '--rm', '-i', '--network', 'none', '--read-only', '--entrypoint', 'node', '-w', '/app/apps/api', image, '--input-type=module', '-e',
                     "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',async()=>{const m=await import('./pilot-config.mjs');m.validatePilotCompose(JSON.parse(s));console.log('compose_valid');});"], check=False, stdin=resolved, timeout=60)
        assert check.returncode == 0 and 'compose_valid' in check.stdout, 'check=compose_validator'
        after = json.loads(resolved)
        b_api, a_api = resolved_before['services']['api'], after['services']['api']
        assert a_api.pop('image') == image and b_api.pop('image') == BASE, 'check=image_swap'
        b_secrets = b_api.pop('secrets'); a_secrets = a_api.pop('secrets')
        names = lambda xs: sorted(x if isinstance(x, str) else x['source'] for x in xs)
        assert names(a_secrets) == sorted(names(b_secrets) + ['meta_access_token']) and a_api == b_api, 'check=only_key_mount_added'
        recreated = True
        run(compose + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=new_env)
        wait_api()
        restore_link()
        live = inspect(API)
        assert live['Image'] == image and 'THAARA_WHATSAPP_SEND_ENABLED=false' in live['Config']['Env'], 'check=image_and_send_off'
        assert all(identity(inspect(name)) == value for name, value in before.items()), 'check=other_services_unchanged'
        assert list(inspect('n8n-n8n-1')['NetworkSettings']['Networks']) == ['n8n_default'], 'check=n8n_single_network_after'
        logs = run(['docker', 'logs', '--since', '5m', API], check=False).stdout + run(['docker', 'logs', '--since', '5m', API], check=False).stderr
        assert 'Pilot Meta key refused' not in logs, 'check=key_accepted_by_api'
        print('api_key_status=accepted (no refusal logged; no provider call made)', flush=True)
        for path, expected in [('/api/v1/health', '200'), ('/api/v1/auth/me', '401'), ('/api/v1/connectors/whatsapp/n8n/durable/wa_pilot_meta_test_10813b/templates', '401')]:
            assert status(path) == expected, 'check=public_path ' + path
            print('public_path=' + path + ' status=' + expected, flush=True)
        final = {'image': image, 'archive_sha256': ARCHIVE_SHA, 'send_enabled': False, 'meta_key_mounted': True, 'other_services_unchanged': True, 'rollback_directory': str(directory)}
        (directory / 'result.json').write_text(json.dumps(final))
        print(json.dumps(final), flush=True)
    except Exception:
        print('publication_failed=attempting_rollback (compose and image restored; key file untouched)', flush=True)
        if changed:
            compose_path.write_bytes(original_compose); env_path.write_bytes(original_env)
            print('compose_and_env_restored=yes', flush=True)
        if recreated:
            run(compose + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=old_env)
            wait_api()
            restore_link()
            assert inspect(API)['Image'] == BASE
            print('API_rollback=verified', flush=True)
        raise

if __name__ == '__main__':
    try:
        assert globals().get('OWNER_APPROVED_10828') is True
        publish(globals()['PAYLOAD'])
    except Exception as error:
        print('Step10828 stopped: ' + str(error) if isinstance(error, (AssertionError, RuntimeError)) else 'Step10828 stopped; private diagnostics withheld', flush=True)
        raise SystemExit(1)
