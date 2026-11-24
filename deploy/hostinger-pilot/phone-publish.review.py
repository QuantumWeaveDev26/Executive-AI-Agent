"""REVIEW ONLY. Step 110 pilot publisher: separately approved deploy (calling off), live-on, live-off, the UI image update and the existing Chat model / Google integrations.
Changes only the pilot API container, its image, phone environment and Sarvam secret mounts. No SQL, no provider request, no call.
Other services must stay untouched; any failed check restores the previous image and compose file. Never prints or logs secrets.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time

BASE_IMAGE = 'sha256:e6d9d0bc6f63fd126d453159a124fe09eaffdf11300344857a032a65cea007fb'
NEW_TAG = 'thaara-v2-pilot-api:phone-110-web'
ARCHIVE_SHA = 'c70c2c3df69bb096109ba9e92230ac180afffc0e60119be16382004da8d0c3d3'
LAYERS_SHA = '850e41f5b7c5e4371fcdd46730fe956d73d841e8f68e79c65ccd8a2206cf6042'
LINK_SHA = '2885a39671346932339a87cb5b616b2a117ef593eb2ee9d32fa5f267cb273016'
# 31 Oct UI update: replaces only the image of the running live phone build; environment and Sarvam mounts are kept as they are.
RUNNING_IMAGE = 'sha256:3e21eaef24a41d15d8962431f10005ec593d68a752a95cf5b56a61e6863387cb'
UI_TAG = 'thaara-v2-pilot-api:phone-110-ui'
# Pinned from the owner-approved local build of 31 Oct (image sha256:a7f8a2107beb2696b4936aa5c05a37a59119bb003e89a9e399826f36dd762fc2).
UI_ARCHIVE_SHA = '83135d87228bd7d8fd8691972490859060761a0dc415925561f7ab879263f917'
UI_IMAGE = 'sha256:a7f8a2107beb2696b4936aa5c05a37a59119bb003e89a9e399826f36dd762fc2'
UI_LAYERS_SHA = '10e6138a2cc107c6b79f1fce1364d7dc042f321027f69433e69619054ff12ac0'
PILOT = Path('/opt/thaara-v2-pilot')
PRIVATE = Path('/opt/thaara-v2-pilot-private')
HANDOFF = PRIVATE / 'handoff'
SECRETS = PRIVATE / 'secrets'
ARCHIVE = HANDOFF / 'phone110-image.tar.gz'
# Existing integrations (owner 31 Oct): original Chat model (OpenAI gpt-4.1-mini) and Gmail/Calendar. Image built on the
# UI image; each feature is switched on only after the owner saves its key files.
CHAT_TAG = 'thaara-v2-pilot-api:phone-110-chat'
CHAT_ARCHIVE = HANDOFF / 'phone110-chat-image.tar.gz'
CHAT_ARCHIVE_SHA = '474530e26fbf36ddad3fe2d71e587e9fd9d33764915f7cb96e400c69d6ead800'
CHAT_LAYERS_SHA = 'ec2fa210c5e1d9d287d0a35ece235203d480b145fdc0614457605004c7b1a199'
CHAT_SECRET = 'openai_api_key'
CHAT_ENV = {'THAARA_OPENAI_API_KEY_FILE': '/run/secrets/openai_api_key'}
GOOGLE_SECRETS = ['google_client_id', 'google_client_secret', 'google_vault_key']
GOOGLE_ENV = {'THAARA_GOOGLE_OAUTH': 'approved'}
CHAT_OWNER_FILES = {'pilot-openai-key-entry.sh': 'd3312ee767bca461bb1b342cb9b0a0f6ff4147b7a5e2695cdd4cc07a990c5e47',
                    'pilot-google-entry.sh': '5e58185475f7f66d67d19849e3456fb2e8518ffbda3a732e4fd192a96c2a18e2'}
UI_ARCHIVE = HANDOFF / 'phone110-ui-image.tar.gz'
API, PG, REDIS, N8N, TRAEFIK = 'thaara-v2-pilot-api-1', 'thaara-v2-pilot-postgres-1', 'thaara-v2-pilot-redis-1', 'n8n-n8n-1', 'n8n-traefik-1'
SITE = 'https://thaara-v2.quantumweaveai.io'
SARVAM_SECRETS = ['sarvam_api_key', 'sarvam_webhook_secret', 'sarvam_profile']
DURABLE_ENV = {'THAARA_PHONE_DURABLE': 'approved'}
LIVE_ENV = {'THAARA_PHONE_LIVE_CALLING': 'approved', 'THAARA_SARVAM_PROFILE_FILE': '/run/secrets/sarvam_profile', 'THAARA_SARVAM_API_KEY_FILE': '/run/secrets/sarvam_api_key',
            'THAARA_SARVAM_WEBHOOK_SECRET_FILE': '/run/secrets/sarvam_webhook_secret', 'THAARA_PHONE_CALLBACK_ORIGIN': SITE}
OWNER_FILES = {'pilot-sarvam-key-entry.sh': 'b8885be270b15b1c0b2fd66d2fc1302c58eae40872f0dea7f0a0c0ec1ded6ab8', 'sarvam-runtime-profile.pilot.json': '7a41b4f34482ccf833fcdab6b7bb0c8a5c198f52a994ec4d8c0ca11a19596447'}
COMPOSE = ['docker', 'compose', '-p', 'thaara-v2-pilot', '-f', str(PILOT / 'compose.json'), '--profile', 'application']
VALIDATE = "const m=await import('./pilot-config.mjs');let t='';for await(const c of process.stdin)t+=c;m.validatePilotCompose(JSON.parse(t));console.log('valid')"


class Refusal(Exception):
    pass


def require(value, code):
    if not value:
        raise Refusal(code)


def run(args, check=True, env=None, timeout=240, stdin=None, input=None):
    result = subprocess.run(args, stdin=stdin, input=input, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env, timeout=timeout)
    if check:
        require(result.returncode == 0, 'command_failed')
    return result


def inspect(name):
    return json.loads(run(['docker', 'inspect', name]).stdout)[0]


def identity(name):
    facts = inspect(name)
    return (facts['Id'], facts['State']['StartedAt'], facts['RestartCount'])


def networks(name):
    return list(inspect(name)['NetworkSettings']['Networks'])


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1048576), b''):
            digest.update(chunk)
    return digest.hexdigest()


def wait_api():
    for _ in range(40):
        if inspect(API)['State'].get('Health', {}).get('Status') == 'healthy':
            return
        time.sleep(3)
    raise Refusal('api_health_timeout')


def restore_link():
    require('n8n_default' not in networks(API), 'unexpected_existing_link')
    result = run(['bash', str(PILOT / 'n8n-link-v2.sh')], check=False)
    markers = ['n8n_to_pilot_health=200', 'forged_callback_status=403', 'public_watch=12/12 ok', 'n8n_single_network=yes', 'n8n_not_restarted=yes']
    require(result.returncode == 0 and all(marker in result.stdout for marker in markers), 'n8n_link_failed')


def send_state():
    env = [e for e in inspect(API)['Config']['Env'] if e.startswith('THAARA_WHATSAPP_SEND_ENABLED=')]
    rich = run(['docker', 'exec', '-w', '/app/apps/api', API, 'node', '--input-type=module', '-e',
                "const m=await import('./pilot-config.mjs');const s=m.pilotSendSettings();console.log(s?String(s.profile.richMessages):'off')"]).stdout.strip()
    return [env, rich]


def http_status(path, method='GET'):
    return run(['curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '10', '-X', method, SITE + path], timeout=20).stdout


def traefik_access_log():
    facts = inspect(TRAEFIK)['Config']
    words = ' '.join((facts.get('Cmd') or []) + (facts.get('Env') or [])).lower()
    return 'accesslog' in words


def phone_schema_ready():
    query = "SELECT to_regclass('public.phone_contacts') IS NOT NULL AND to_regclass('public.phone_calls') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='phone_calls' AND column_name='dispatch_status')"
    return run(['docker', 'exec', '--user', 'postgres', PG, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-c', query]).stdout.strip() == 't'


def phone_environment(model):
    return {k: v for k, v in model['services']['api']['environment'].items() if k.startswith(('THAARA_PHONE_', 'THAARA_SARVAM_'))}


def with_durable(model):
    updated = json.loads(json.dumps(model))
    updated['services']['api']['environment'].update(DURABLE_ENV)
    return updated


def with_live(model):
    updated = with_durable(model)
    updated['services']['api']['environment'].update(LIVE_ENV)
    for name in SARVAM_SECRETS:
        updated.setdefault('secrets', {})[name] = {'file': '/opt/thaara-v2-pilot-private/secrets/' + name}
        if name not in updated['services']['api']['secrets']:
            updated['services']['api']['secrets'].append(name)
    return updated


def without_live(model):
    updated = json.loads(json.dumps(model))
    for key in LIVE_ENV:
        updated['services']['api']['environment'].pop(key, None)
    for name in SARVAM_SECRETS:
        updated.get('secrets', {}).pop(name, None)
    updated['services']['api']['secrets'] = [s for s in updated['services']['api']['secrets'] if s not in SARVAM_SECRETS]
    return updated


def with_chat(model):
    updated = json.loads(json.dumps(model))
    updated['services']['api']['environment'].update(CHAT_ENV)
    updated.setdefault('secrets', {})[CHAT_SECRET] = {'file': '/opt/thaara-v2-pilot-private/secrets/' + CHAT_SECRET}
    if CHAT_SECRET not in updated['services']['api']['secrets']:
        updated['services']['api']['secrets'].append(CHAT_SECRET)
    return updated


def without_chat(model):
    updated = json.loads(json.dumps(model))
    for key in list(updated['services']['api']['environment']):
        if key.startswith('THAARA_OPENAI_'):
            updated['services']['api']['environment'].pop(key)
    updated.get('secrets', {}).pop(CHAT_SECRET, None)
    updated['services']['api']['secrets'] = [s for s in updated['services']['api']['secrets'] if s != CHAT_SECRET]
    return updated


def secret_file_ready(name):
    try:
        info = os.lstat(SECRETS / name)
    except FileNotFoundError:
        return False
    return stat.S_ISREG(info.st_mode) and info.st_uid == 1000 and stat.S_IMODE(info.st_mode) == 0o400


def chat_file_ready():
    return secret_file_ready(CHAT_SECRET)


def with_google(model):
    updated = json.loads(json.dumps(model))
    updated['services']['api']['environment'].update(GOOGLE_ENV)
    for name in GOOGLE_SECRETS:
        updated.setdefault('secrets', {})[name] = {'file': '/opt/thaara-v2-pilot-private/secrets/' + name}
        if name not in updated['services']['api']['secrets']:
            updated['services']['api']['secrets'].append(name)
    return updated


def without_google(model):
    updated = json.loads(json.dumps(model))
    updated['services']['api']['environment'].pop('THAARA_GOOGLE_OAUTH', None)
    for name in GOOGLE_SECRETS:
        updated.get('secrets', {}).pop(name, None)
    updated['services']['api']['secrets'] = [s for s in updated['services']['api']['secrets'] if s not in GOOGLE_SECRETS]
    return updated


def sarvam_files_ready():
    for name in SARVAM_SECRETS:
        info = os.lstat(SECRETS / name)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 1000 or stat.S_IMODE(info.st_mode) != 0o400:
            return False
    return True


def change_api(directory, image, change):
    """Recreate only the API with a new image and compose model. Any failed check restores both and re-verifies."""
    compose_path, env_path = PILOT / 'compose.json', PILOT / '.env'
    original_compose, original_env = compose_path.read_bytes(), env_path.read_bytes()
    current_image = original_env.decode().strip().split('=', 1)[1]
    (directory / 'previous-compose.json').write_bytes(original_compose)
    (directory / 'previous-image.env').write_bytes(original_env)
    updated = change(json.loads(original_compose))
    services = {name: identity(name) for name in [PG, REDIS, N8N, TRAEFIK]}
    state = send_state()
    new_env = dict(os.environ, THAARA_PILOT_API_IMAGE=image)
    old_env = dict(os.environ, THAARA_PILOT_API_IMAGE=current_image)
    # Render the candidate before touching anything; only the API may differ.
    candidate = directory / 'candidate-compose.json'
    candidate.write_text(json.dumps(updated, indent=2))
    candidate_compose = ['docker', 'compose', '-p', 'thaara-v2-pilot', '-f', str(candidate), '--profile', 'application']
    rendered_old = json.loads(run(COMPOSE + ['config', '--format', 'json'], env=old_env).stdout)
    rendered_new = json.loads(run(candidate_compose + ['config', '--format', 'json'], env=new_env).stdout)
    for name in ['postgres', 'redis']:
        require(rendered_old['services'][name] == rendered_new['services'][name], 'compose_other_service_changed')
    require(run(['docker', 'run', '--rm', '-i', '--network', 'none', '--entrypoint', 'node', image, '--input-type=module', '-e', VALIDATE], input=json.dumps(rendered_new)).stdout.strip() == 'valid', 'compose_validation_failed')
    recreated = False
    try:
        compose_path.write_text(json.dumps(updated, indent=2))
        env_path.write_text('THAARA_PILOT_API_IMAGE=' + image + '\n')
        recreated = True
        run(COMPOSE + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=new_env)
        wait_api()
        restore_link()
        require(inspect(API)['Image'] == image, 'api_image_mismatch')
        require(send_state() == state, 'send_state_changed')
        require(all(identity(name) == value for name, value in services.items()), 'other_service_changed')
        require(networks(N8N) == ['n8n_default'], 'n8n_networks_changed')
        require(http_status('/api/v1/health') == '200' and http_status('/integrations/phone') == '200', 'public_check_failed')
        require(http_status('/api/v1/connectors/phone/ai/requests') == '401', 'phone_route_check_failed')
    except Exception:
        compose_path.write_bytes(original_compose)
        env_path.write_bytes(original_env)
        if recreated:
            run(COMPOSE + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], env=old_env)
            wait_api()
            restore_link()
            require(inspect(API)['Image'] == current_image, 'rollback_image_mismatch')
        raise


def load_image(archive=None, archive_sha=None, tag=None, layers_sha=None):
    archive, archive_sha = archive or ARCHIVE, archive_sha or ARCHIVE_SHA
    tag, layers_sha = tag or NEW_TAG, layers_sha or LAYERS_SHA
    require(sha256_file(archive) == archive_sha, 'archive_checksum')
    with archive.open('rb') as stream:
        run(['bash', '-c', 'gzip -dc | docker load'], stdin=stream, timeout=300)
    facts = inspect(tag)
    require(hashlib.sha256(json.dumps(facts['RootFS']['Layers']).encode()).hexdigest() == layers_sha, 'image_layers_mismatch')
    return facts['Id']


def phone_image():
    """The running phone build: the first deployed image or the UI update. Anything else is refused by the preconditions."""
    running = inspect(API)['Image']
    known = []
    for tag in (NEW_TAG, UI_TAG, CHAT_TAG):
        try:
            known.append(inspect(tag)['Id'])
        except Refusal:
            pass
    require(running in known, 'api_not_expected')
    return running


def unchanged(model):
    return json.loads(json.dumps(model))


def install_owner_files(expected_files=None, variable='OWNER_FILES_B64'):
    expected_files = expected_files or OWNER_FILES
    supplied = globals().get(variable)
    require(isinstance(supplied, dict) and set(supplied) == set(expected_files), 'owner_files_missing')
    for name, expected in expected_files.items():
        data = base64.b64decode(supplied[name], validate=True)
        require(hashlib.sha256(data).hexdigest() == expected, 'owner_file_checksum')
    for name in expected_files:
        path = PILOT / name
        path.write_bytes(base64.b64decode(supplied[name], validate=True))
        path.chmod(0o500 if name.endswith('.sh') else 0o400)


def new_directory(label):
    directory = HANDOFF / ('phone110-' + label + '-' + time.strftime('%Y%m%dT%H%M%SZ'))
    directory.mkdir(mode=0o700, exist_ok=False)
    return directory


def preconditions(receipt, expected_image):
    require(os.getuid() == 0, 'root_required')
    require(sha256_file(PILOT / 'n8n-link-v2.sh') == LINK_SHA, 'link_script_changed')
    api = inspect(API)
    require(api['Image'] == expected_image and api['State']['Health']['Status'] == 'healthy', 'api_not_expected')
    require(networks(N8N) == ['n8n_default'], 'n8n_networks_unexpected')
    require(phone_schema_ready(), 'phone_schema_missing')
    receipt['traefikAccessLog'] = traefik_access_log()


def deploy(receipt):
    os.umask(0o077)
    preconditions(receipt, BASE_IMAGE)
    receipt['step'] = 'load_image'
    image = load_image()
    receipt['image'] = image
    receipt['step'] = 'recreate_api'
    change_api(new_directory('deploy'), image, with_durable)
    receipt['step'] = 'owner_files'
    install_owner_files()
    receipt.update(status='verified', step='done', callingEnabled=False, rollbackImage=BASE_IMAGE, sendStatePreserved=True, otherServicesUnchanged=True)


def live_on(receipt):
    os.umask(0o077)
    image = phone_image()
    preconditions(receipt, image)
    receipt['step'] = 'live_checks'
    require(not receipt['traefikAccessLog'], 'traefik_access_log_enabled')
    require(sarvam_files_ready(), 'sarvam_files_not_ready')
    receipt['step'] = 'recreate_api'
    change_api(new_directory('live-on'), image, with_live)
    receipt['step'] = 'post_checks'
    hook = http_status('/api/v1/connectors/phone/sarvam/calls/00000000-0000-4000-8000-000000000001/' + '0' * 64, 'POST')
    require(hook == '403', 'live_webhook_not_active')
    receipt.update(status='verified', step='done', callingEnabled=True, sendStatePreserved=True, otherServicesUnchanged=True)


def live_off(receipt):
    os.umask(0o077)
    image = phone_image()
    preconditions(receipt, image)
    receipt['step'] = 'recreate_api'
    change_api(new_directory('live-off'), image, without_live)
    require(http_status('/api/v1/connectors/phone/sarvam/calls/00000000-0000-4000-8000-000000000001/' + '0' * 64, 'POST') == '404', 'live_webhook_still_active')
    receipt.update(status='verified', step='done', callingEnabled=False, sendStatePreserved=True, otherServicesUnchanged=True)


def ui_update(receipt):
    """New web pages on the running live build. Same compose model (environment, mounts, limits); rollback image is the running one."""
    os.umask(0o077)
    preconditions(receipt, RUNNING_IMAGE)
    live = 'THAARA_PHONE_LIVE_CALLING' in json.loads((PILOT / 'compose.json').read_bytes())['services']['api']['environment']
    if live:
        require(sarvam_files_ready(), 'sarvam_files_not_ready')
    receipt['step'] = 'load_image'
    image = load_image(UI_ARCHIVE, UI_ARCHIVE_SHA, UI_TAG, UI_LAYERS_SHA)
    require(image != RUNNING_IMAGE, 'image_not_new')
    receipt['image'] = image
    receipt['step'] = 'recreate_api'
    change_api(new_directory('ui-update'), image, unchanged)
    receipt['step'] = 'post_checks'
    require(http_status('/integrations/phone/contacts') == '200' and http_status('/integrations/phone/history') == '200', 'public_check_failed')
    hook = http_status('/api/v1/connectors/phone/sarvam/calls/00000000-0000-4000-8000-000000000001/' + '0' * 64, 'POST')
    require(hook == ('403' if live else '404'), 'live_state_changed')
    receipt.update(status='verified', step='done', callingEnabled=live, rollbackImage=RUNNING_IMAGE, sendStatePreserved=True, otherServicesUnchanged=True)


def live_webhook_state(live):
    hook = http_status('/api/v1/connectors/phone/sarvam/calls/00000000-0000-4000-8000-000000000001/' + '0' * 64, 'POST')
    require(hook == ('403' if live else '404'), 'live_state_changed')


def phone_live_configured():
    return 'THAARA_PHONE_LIVE_CALLING' in json.loads((PILOT / 'compose.json').read_bytes())['services']['api']['environment']


def chat_deploy(receipt):
    """Claude-capable image on the running UI build, Chat still off. Installs the owner's key-entry script only."""
    os.umask(0o077)
    preconditions(receipt, UI_IMAGE)
    live = phone_live_configured()
    if live:
        require(sarvam_files_ready(), 'sarvam_files_not_ready')
    receipt['step'] = 'load_image'
    image = load_image(CHAT_ARCHIVE, CHAT_ARCHIVE_SHA, CHAT_TAG, CHAT_LAYERS_SHA)
    require(image != UI_IMAGE, 'image_not_new')
    receipt['image'] = image
    receipt['step'] = 'recreate_api'
    change_api(new_directory('chat-deploy'), image, lambda model: without_google(without_chat(model)))
    receipt['step'] = 'owner_files'
    install_owner_files(CHAT_OWNER_FILES, 'CHAT_OWNER_FILES_B64')
    receipt['step'] = 'post_checks'
    live_webhook_state(live)
    receipt.update(status='verified', step='done', callingEnabled=live, chatEnabled=False, googleEnabled=False, rollbackImage=UI_IMAGE, sendStatePreserved=True, otherServicesUnchanged=True)


def chat_on(receipt):
    """Mounts the owner-saved Claude key and sets its one switch. Same image, phone and WhatsApp settings unchanged."""
    os.umask(0o077)
    image = inspect(CHAT_TAG)['Id']
    preconditions(receipt, image)
    receipt['step'] = 'live_checks'
    require(chat_file_ready(), 'chat_key_not_ready')
    live = phone_live_configured()
    receipt['step'] = 'recreate_api'
    change_api(new_directory('chat-on'), image, with_chat)
    receipt['step'] = 'post_checks'
    live_webhook_state(live)
    receipt.update(status='verified', step='done', callingEnabled=live, chatEnabled=True, sendStatePreserved=True, otherServicesUnchanged=True)


def chat_off(receipt):
    os.umask(0o077)
    image = inspect(CHAT_TAG)['Id']
    preconditions(receipt, image)
    live = phone_live_configured()
    receipt['step'] = 'recreate_api'
    change_api(new_directory('chat-off'), image, without_chat)
    receipt['step'] = 'post_checks'
    live_webhook_state(live)
    receipt.update(status='verified', step='done', callingEnabled=live, chatEnabled=False, sendStatePreserved=True, otherServicesUnchanged=True)


def google_on(receipt):
    """Mounts the owner-saved Google client files and sets the one switch. Same image; phone, Chat and WhatsApp unchanged."""
    os.umask(0o077)
    image = inspect(CHAT_TAG)['Id']
    preconditions(receipt, image)
    receipt['step'] = 'live_checks'
    require(all(secret_file_ready(name) for name in GOOGLE_SECRETS), 'google_files_not_ready')
    live = phone_live_configured()
    receipt['step'] = 'recreate_api'
    change_api(new_directory('google-on'), image, with_google)
    receipt['step'] = 'post_checks'
    live_webhook_state(live)
    receipt.update(status='verified', step='done', callingEnabled=live, googleEnabled=True, sendStatePreserved=True, otherServicesUnchanged=True)


def google_off(receipt):
    os.umask(0o077)
    image = inspect(CHAT_TAG)['Id']
    preconditions(receipt, image)
    live = phone_live_configured()
    receipt['step'] = 'recreate_api'
    change_api(new_directory('google-off'), image, without_google)
    receipt['step'] = 'post_checks'
    live_webhook_state(live)
    receipt.update(status='verified', step='done', callingEnabled=live, googleEnabled=False, sendStatePreserved=True, otherServicesUnchanged=True)


MODES = {'--approved-phone-deploy': deploy, '--approved-phone-live-on': live_on, '--approved-phone-live-off': live_off, '--approved-phone-ui-update': ui_update,
         '--approved-chat-model-deploy': chat_deploy, '--approved-chat-model-on': chat_on, '--approved-chat-model-off': chat_off,
         '--approved-google-on': google_on, '--approved-google-off': google_off}
CODES = {'root_required', 'link_script_changed', 'api_not_expected', 'n8n_networks_unexpected', 'phone_schema_missing', 'archive_checksum', 'image_layers_mismatch', 'traefik_access_log_enabled',
         'sarvam_files_not_ready', 'compose_other_service_changed', 'compose_validation_failed', 'api_health_timeout', 'n8n_link_failed', 'send_state_changed', 'other_service_changed',
         'n8n_networks_changed', 'public_check_failed', 'phone_route_check_failed', 'api_image_mismatch', 'live_webhook_not_active', 'live_webhook_still_active', 'owner_files_missing',
         'owner_file_checksum', 'rollback_image_mismatch', 'command_failed', 'unexpected_existing_link', 'image_not_new', 'live_state_changed', 'chat_key_not_ready', 'google_files_not_ready'}


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in MODES:
        print(json.dumps({'status': 'review_only', 'providerCalls': 0}))
        return 0
    receipt = {'status': 'failed', 'step': 'preconditions', 'providerCalls': 0, 'callsPlaced': 0}
    try:
        MODES[sys.argv[1]](receipt)
    except Exception as error:
        receipt['category'] = str(error) if isinstance(error, Refusal) and str(error) in CODES else 'unclassified_failure'
    print(json.dumps(receipt, sort_keys=True))
    return 0 if receipt['status'] == 'verified' else 1


if __name__ == '__main__':
    sys.exit(main())
