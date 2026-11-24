"""Thaara Chat Modernization Approved Release Publisher:
- Authenticated attachments, native text extraction, smart auto-scroll, zero-token business classifier.
- Preserves all WhatsApp, Phone, Calendar, Gmail, and n8n workflows.
- Atomic container deployment with automatic rollback protection.
"""
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

OWNER_APPROVED_CHAT = True

BASE_IMAGE = 'sha256:b1b13df2fb1b51817765f099c2645e25bafa6934251add0d71c890c6f29d7117'
ARCHIVE_SHA = '81284759e56d6feccc4fb956d3370134a3dcf389f39e53c602a1a55eb8eb42d9'
LINK_SHA = '2885a39671346932339a87cb5b616b2a117ef593eb2ee9d32fa5f267cb273016'
P = Path('/opt/thaara-v2-pilot')
API = 'thaara-v2-pilot-api-1'
PG = 'thaara-v2-pilot-postgres-1'
DB = 'thaara_vps_pilot'
LINK = P / 'n8n-link-v2.sh'
SITE = 'https://thaara-v2.quantumweaveai.io'
ALLOWED = ['Dockerfile', 'manifest.json', 'contracts', 'api-services', 'api-routes', 'web-dist']

def run(args, check=True, env=None, timeout=240, stdin=None):
    result = subprocess.run(args, capture_output=True, text=True, env=env, timeout=timeout, input=stdin)
    if check and result.returncode:
        raise RuntimeError('Command failed; details withheld: ' + args[0])
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
    raise RuntimeError('Pilot API health check timeout')

def restore_link():
    if 'n8n_default' in inspect(API)['NetworkSettings']['Networks']:
        return
    if LINK.exists():
        run(['bash', str(LINK)], check=False)

def update_compose_and_env(env_path, compose_path, original_compose_bytes, base_image, target_image):
    compose_doc = json.loads(original_compose_bytes.decode('utf-8'))
    compose_doc['services']['api']['image'] = target_image
    env_path.write_text('THAARA_PILOT_API_IMAGE=' + target_image + '\n', encoding='utf-8')
    compose_path.write_text(json.dumps(compose_doc, indent=2) + '\n', encoding='utf-8')

def rollback_compose_and_env(env_path, compose_path, original_env_bytes, original_compose_bytes, compose_cmd, old_env, base_image):
    env_path.write_bytes(original_env_bytes)
    compose_path.write_bytes(original_compose_bytes)
    cur = inspect(API)
    if cur['Image'] != base_image or cur['State'].get('Health', {}).get('Status') != 'healthy':
        run(compose_cmd + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=old_env)
        wait_api()
    if 'n8n_default' not in inspect(API)['NetworkSettings']['Networks']:
        restore_link()
    final_api = inspect(API)
    assert final_api['Image'] == base_image, 'check=rollback_verified'

def publish(payload):
    assert os.getuid() == 0, 'check=must_run_as_root'
    os.umask(0o077)

    ps_out = run(['ps', '-eo', 'args']).stdout
    active_deploy = [l for l in ps_out.splitlines() if ('docker build' in l or 'docker compose' in l or 'publish-phone' in l) and 'ps -eo' not in l]
    assert not active_deploy, 'check=no_concurrent_deployments'
    assert hashlib.sha256(LINK.read_bytes()).hexdigest() == LINK_SHA, 'check=link_script_pinned'

    api = inspect(API)
    assert api['Image'] == BASE_IMAGE and api['State']['Health']['Status'] == 'healthy', 'check=base_image_healthy'
    base_image = BASE_IMAGE

    services = [PG, 'thaara-v2-pilot-redis-1', 'n8n-n8n-1', 'n8n-traefik-1']
    before = {name: identity(inspect(name)) for name in services}

    raw = base64.b64decode(payload, validate=True)
    assert hashlib.sha256(raw).hexdigest() == ARCHIVE_SHA, 'check=archive_sha'

    directory = Path('/opt/thaara-v2-pilot-private/handoff') / ('chat-modernization-' + time.strftime('%Y%m%dT%H%M%SZ'))
    directory.mkdir(mode=0o700, exist_ok=False)
    context = directory / 'context'
    context.mkdir(mode=0o700)

    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        members = archive.getmembers()
        for member in members:
            path = Path(member.name)
            assert not path.is_absolute() and '..' not in path.parts and '\\' not in member.name and (member.isfile() or member.isdir()) and path.parts[0] in ALLOWED, 'check=archive_member'
        archive.extractall(context)

    manifest = json.loads((context / 'manifest.json').read_text(encoding='utf-8'))
    for item in manifest:
        path = Path(item['Path'])
        assert not path.is_absolute() and '..' not in path.parts
        assert hashlib.sha256((context / path).read_bytes()).hexdigest() == item['SHA256'], 'check=manifest ' + item['Path']
    print('artifact_checksums=verified files=' + str(len(manifest)), flush=True)

    tag = 'thaara-v2-base:chat-modernization'
    run(['docker', 'tag', base_image, tag])
    build = run(['docker', 'build', '--no-cache', '--network=none', '--pull=false', '--build-arg', 'BASE_IMAGE=' + tag, '-t', 'thaara-v2-pilot-api:chat-modernization', str(context)], check=False, timeout=300)
    (directory / 'build.log').write_text(build.stdout + build.stderr)
    if build.returncode:
        raise RuntimeError('Overlay build failed; private build.log retained')

    new = json.loads(run(['docker', 'image', 'inspect', 'thaara-v2-pilot-api:chat-modernization']).stdout)[0]
    old = json.loads(run(['docker', 'image', 'inspect', base_image]).stdout)[0]
    image = new['Id']

    assert new['RootFS']['Layers'][:len(old['RootFS']['Layers'])] == old['RootFS']['Layers'], 'check=layer_prefix'
    for key in ['Cmd', 'Entrypoint', 'Env', 'User', 'WorkingDir', 'ExposedPorts', 'Healthcheck', 'Volumes', 'StopSignal']:
        assert new['Config'].get(key) == old['Config'].get(key), 'check=config ' + key
    print('overlay_build=passed image=' + image, flush=True)

    env_path = P / '.env'
    compose_path = P / 'compose.json'
    original_env = env_path.read_bytes()
    original_compose = compose_path.read_bytes()
    (directory / 'previous-image.env').write_bytes(original_env)
    (directory / 'previous-compose.json').write_bytes(original_compose)

    compose = ['docker', 'compose', '-p', 'thaara-v2-pilot', '-f', str(compose_path), '--profile', 'application']
    old_env = dict(os.environ, THAARA_PILOT_API_IMAGE=base_image)
    new_env = dict(os.environ, THAARA_PILOT_API_IMAGE=image)

    backup = directory / 'before-chat-modernization.dump'
    with backup.open('xb') as stream:
        dump = subprocess.run(['docker', 'exec', '--user', 'postgres', PG, 'pg_dump', '-U', 'postgres', '-d', DB, '-Fc'], stdout=stream, stderr=subprocess.PIPE, timeout=120)
    assert dump.returncode == 0 and backup.stat().st_size > 100, 'check=backup_created'
    print('private_backup=created', flush=True)

    changed = False
    try:
        update_compose_and_env(env_path, compose_path, original_compose, base_image, image)
        changed = True
        run(compose + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=new_env)
        wait_api()
        restore_link()

        assert inspect(API)['Image'] == image, 'check=api_image'
        assert all(identity(inspect(name)) == value for name, value in before.items()), 'check=other_services_unchanged'

        # Verify web assets served
        for item in manifest:
            if item['Path'].startswith('web-dist/'):
                asset = item['Path'][len('web-dist/'):]
                url = SITE + '/' + ('' if asset == 'index.html' else asset)
                got = (0, '')
                for _ in range(10):
                    try:
                        with urllib.request.urlopen(url, timeout=12) as response:
                            got = (response.status, hashlib.sha256(response.read()).hexdigest())
                    except Exception:
                        got = (0, '')
                    if got == (200, item['SHA256']):
                        break
                    time.sleep(3)
                assert got == (200, item['SHA256']), 'check=public_asset ' + asset

        # Verify public API health
        with urllib.request.urlopen(SITE + '/api/v1/health', timeout=10) as response:
            assert response.status == 200, 'check=api_health'

        print('deployment=successful new_image=' + image, flush=True)
        return image
    except Exception as e:
        print('Deployment error encountered: ' + str(e), flush=True)
        if changed:
            print('Executing automated atomic rollback...', flush=True)
            rollback_compose_and_env(env_path, compose_path, original_env, original_compose, compose, old_env, base_image)
            print('Rollback completed successfully.', flush=True)
        raise

if __name__ == '__main__':
    try:
        if not globals().get('OWNER_APPROVED_CHAT'):
            print('Chat Modernization stopped: OWNER_APPROVED_CHAT is required', flush=True)
            raise SystemExit(1)
        publish(globals()['PAYLOAD'])
    except Exception as error:
        print('Chat Modernization stopped: ' + str(error) if isinstance(error, (AssertionError, RuntimeError)) else 'Chat Modernization stopped; diagnostics withheld', flush=True)
        raise SystemExit(1)
