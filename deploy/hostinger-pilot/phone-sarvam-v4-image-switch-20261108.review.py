"""Swap only the validated API image. Preserve the v2 profile and restore it on failure."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

BASE = 'sha256:df1499e3a4b7cfbfab87f9ba4face080bb44737a8a3f2d4b0767cd7b270a99c5'
V4 = 'sha256:da0cf28a92658a89498693e8b1724377be8a399c5c693f31db506f3d64b12d81'
BASE_CONTAINER = '0d7c367d2c212d8796a6ae599047681779f19bba0b083922ba956e8656da330b'
PROFILE = '7a41b4f34482ccf833fcdab6b7bb0c8a5c198f52a994ec4d8c0ca11a19596447'
PILOT = Path('/opt/thaara-v2-pilot')
API = 'thaara-v2-pilot-api-1'
OTHER = ('thaara-v2-pilot-postgres-1', 'thaara-v2-pilot-redis-1', 'n8n-n8n-1', 'n8n-traefik-1')
NET = 'n8n_default'
ALIAS = 'thaara-pilot-api'
SITE = 'https://thaara-v2.quantumweaveai.io'
PUBLIC_HEALTH = SITE + '/api/v1/health'
N8N_HEALTH = 'https://n8n.srv1871828.hstgr.cloud/healthz'
ASSETS = {'/': '35836aa9c848284aaadaf7d03949ac907a46639b27254a73806d5388c9395908',
          '/assets/index-BJGkboGa.js': 'f7d7d9fb43914b358e4ba79f212217c61524c6acba000e94a3822a72a36c3688',
          '/assets/index-C_8sjcAM.css': '58307c440d8ac118b880068ab90f10a42e56cc61e53734620a526b667b03316a'}
ENV_LINE = b'THAARA_PILOT_API_IMAGE='
IMAGE_FIELDS = '{{.Id}}|{{.Image}}|{{.State.Health.Status}}|{{.HostConfig.ReadonlyRootfs}}|{{.State.StartedAt}}'
PROFILE_PROBE = """const fs=require('node:fs'),c=require('node:crypto'),p='/run/secrets/sarvam_profile';
if(process.env.THAARA_SARVAM_PROFILE_FILE!==p)process.exit(2);
const f=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
try{const s=fs.fstatSync(f);if(!s.isFile()||s.size<1||s.size>32768)process.exit(2);
const b=Buffer.alloc(s.size);if(fs.readSync(f,b,0,b.length,0)!==b.length)process.exit(2);
const a=fs.fstatSync(f);if(a.size!==s.size||a.mtimeMs!==s.mtimeMs||a.ctimeMs!==s.ctimeMs)process.exit(2);
console.log(c.createHash('sha256').update(b).digest('hex'));}finally{fs.closeSync(f);}"""


class Stop(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Stop(code)


def docker(args, timeout=25, env=None):
    command = ['docker', '--host=unix:///var/run/docker.sock', *args]
    result = subprocess.run(command, capture_output=True, timeout=timeout, env=env)
    require(result.returncode == 0 and len(result.stdout) < 1048576, 'docker_operation_failed')
    return result.stdout.decode().strip()


def protected(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and not info.st_mode & 0o022,
            'unprotected_configuration')
    require(info.st_size <= 131072, 'configuration_size_denied')
    return info


def protected_directory(path):
    info = path.lstat()
    require(path.resolve(strict=True) == path and stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and
            not info.st_mode & 0o022, 'unprotected_project_directory')


def replace(path, expected, content):
    info = protected(path)
    require(path.read_bytes() == expected, 'concurrent_configuration_change')
    fd, name = tempfile.mkstemp(prefix='.phone-image-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchown(stream.fileno(), info.st_uid, info.st_gid)
            os.fchmod(stream.fileno(), stat.S_IMODE(info.st_mode))
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        require(path.read_bytes() == expected, 'concurrent_configuration_change')
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def image_changes(env_bytes, compose_bytes):
    require(env_bytes == ENV_LINE + BASE.encode() + b'\n', 'image_pointer_baseline_mismatch')
    parsed = json.loads(compose_bytes)
    image = parsed['services']['api']['image']
    env_next = ENV_LINE + V4.encode() + b'\n'
    if image in ('${THAARA_PILOT_API_IMAGE}', '${THAARA_PILOT_API_IMAGE:?reviewed image ID required}'):
        return env_next, compose_bytes
    require(image == BASE, 'compose_image_baseline_mismatch')
    # Preserve the original Compose bytes apart from its single literal image pin.
    require(compose_bytes.count(BASE.encode()) == 1, 'compose_image_pin_ambiguous')
    return env_next, compose_bytes.replace(BASE.encode(), V4.encode(), 1)


def topology(run, name):
    raw = run(['inspect', '--format', '{{json .NetworkSettings.Networks}}', name])
    return {key: tuple(sorted(value.get('Aliases') or [])) for key, value in json.loads(raw).items()}


def api_identity(run):
    parts = run(['inspect', '--format', IMAGE_FIELDS, API]).split('|')
    require(len(parts) == 5 and re.fullmatch(r'[a-f0-9]{64}', parts[0]) and parts[3] == 'true', 'api_identity_denied')
    return parts


def http_status(url, timeout=8):
    try:
        with urlopen(url, timeout=timeout) as response:
            return response.status
    except HTTPError as error:
        code = error.code
        error.close()
        return code
    except (OSError, URLError):
        return 0


def stabilize_public_route(run, read_status, sleep, rollback):
    require(read_status(N8N_HEALTH) == 200, 'public_n8n_unhealthy')
    first = read_status(PUBLIC_HEALTH)
    if first != 200:
        require(first in (0, 502, 503, 504), 'public_thaara_unexpected_response')
        suffix = 'rollback' if rollback else 'candidate'
        name = 'thaara-phone-v4-route-' + suffix
        require(run(['ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.Names}}']) == '', 'refresh_name_not_clear')
        run(['run', '--rm', '--name', name, '--pull=never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
             '--security-opt', 'no-new-privileges', '--user', '1000:1000', '--entrypoint', 'node', V4, '--version'])
        require(run(['ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.Names}}']) == '', 'refresh_cleanup_unverified')
        for _ in range(6):
            require(read_status(N8N_HEALTH) == 200, 'public_n8n_unhealthy')
            if read_status(PUBLIC_HEALTH) == 200:
                break
            sleep(3)
        else:
            raise Stop('public_thaara_route_unhealthy')
    sleep(3)
    require(read_status(PUBLIC_HEALTH) == 200 and read_status(N8N_HEALTH) == 200, 'public_route_unstable')
    return first != 200


def web_check():
    for path, digest in ASSETS.items():
        try:
            with urlopen(SITE + path, timeout=8) as response:
                require(response.status == 200 and hashlib.sha256(response.read(1500001)).hexdigest() == digest,
                        'public_assets_changed')
        except (OSError, URLError) as error:
            raise Stop('public_asset_transport_failed') from error
    for url, expected in [(PUBLIC_HEALTH, 200), (SITE + '/api/v1/auth/me', 401),
                          (SITE + '/api/v1/connectors/phone/ai/requests', 401),
                          (N8N_HEALTH, 200)]:
        require(http_status(url) == expected, 'public_health_or_auth_failed')


def switch(run=docker, verify_web=web_check, change=replace, pilot=PILOT, sleep=time.sleep, read_status=http_status):
    stage = 'preflight'
    edited = []
    started = False
    refresh = False
    try:
        protected_directory(pilot)
        paths = [pilot / '.env', pilot / 'compose.json']
        require(protected(paths[0]).st_size == len(ENV_LINE) + len(BASE) + 1, 'image_pointer_size_denied')
        protected(paths[1])
        env_bytes, compose_bytes = [path.read_bytes() for path in paths]
        env_next, compose_next = image_changes(env_bytes, compose_bytes)
        base = api_identity(run)
        require(base[:3] == [BASE_CONTAINER, BASE, 'healthy'], 'live_api_baseline_changed')
        for image in (BASE, V4):
            require(run(['image', 'inspect', '--format', '{{.Id}}', image]) == image, 'pinned_image_missing')
        require(json.loads(run(['image', 'inspect', '--format', '{{json .Config.Volumes}}', V4])) in (None, {}), 'refresh_image_volumes_denied')
        other = {name: run(['inspect', '--format', '{{.Id}}|{{.State.StartedAt}}|{{.RestartCount}}', name]) for name in OTHER}
        links = topology(run, API)
        require(set(links) == {'thaara-v2-pilot-data', 'thaara-v2-pilot-entry', NET} and ALIAS in links[NET], 'relay_topology_changed')
        require(set(topology(run, 'n8n-n8n-1')) == {NET}, 'n8n_topology_changed')
        compose = ['compose', '--project-directory', str(pilot), '--env-file', str(paths[0]),
                   '-p', 'thaara-v2-pilot', '-f', str(paths[1]), '--profile', 'application']
        # The host environment must not override the reviewed image pointer or secret paths.
        child_env = {'PATH': os.defpath, 'LANG': 'C.UTF-8'}
        config = lambda: json.loads(run(compose + ['config', '--format', 'json'], env=child_env))
        before = config()
        require(before['services']['api']['image'] == BASE, 'rendered_image_baseline_changed')
        before['services']['api']['image'] = V4

        def check_other():
            require(all(run(['inspect', '--format', '{{.Id}}|{{.State.StartedAt}}|{{.RestartCount}}', name]) == value
                        for name, value in other.items()), 'other_service_changed')

        def health(image):
            for _ in range(35):
                try:
                    facts = api_identity(run)
                    if facts[1:3] == [image, 'healthy']:
                        return facts[0]
                except Stop:
                    pass
                sleep(2)
            raise Stop('api_health_unverified')

        def verify_api(cid):
            require(run(['exec', cid, 'node', '-e', PROFILE_PROBE]) == PROFILE, 'outbound_profile_changed')
            check_other()
            verify_web()

        def verify_link(cid):
            current = topology(run, cid)
            if NET not in current:
                require(set(current) == set(links) - {NET}, 'api_networks_changed')
                run(['network', 'connect', '--alias', ALIAS, NET, cid])
            require(topology(run, cid) == links, 'relay_alias_unverified')
            probe = f"fetch('http://{ALIAS}:3002/api/v1/health',{{signal:AbortSignal.timeout(6000)}}).then(r=>console.log(r.status)).catch(()=>process.exit(1))"
            require(run(['exec', 'n8n-n8n-1', 'node', '-e', probe]) == '200', 'private_relay_unreachable')

        def recreate():
            run(compose + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', 'api'], timeout=85, env=child_env)

        verify_api(base[0])
        require(api_identity(run) == base, 'live_api_changed_before_switch')
        stage = 'configuration_switch'
        for path, old, new in zip(paths, (env_bytes, compose_bytes), (env_next, compose_next), strict=True):
            if old != new:
                change(path, old, new)
                edited.append((path, old, new))
        require(config() == before, 'non_image_configuration_changed')
        check_other()
        require(api_identity(run) == base, 'live_api_changed_before_recreation')
        stage = 'api_recreation'
        started = True
        recreate()
        stage = 'private_postcheck'
        cid = health(V4)
        verify_link(cid)
        check_other()
        stage = 'public_postcheck'
        refresh = stabilize_public_route(run, read_status, sleep, rollback=False)
        verify_api(cid)
        require(api_identity(run)[:3] == [cid, V4, 'healthy'], 'candidate_changed_after_verification')
        require([path.read_bytes() for path in paths] == [env_next, compose_next], 'configuration_changed_after_verification')
        return {'status': 'verified', 'stage': 'complete', 'imageId': V4, 'previousImageId': BASE, 'outboundVersion': 2,
                'routeRefresh': refresh}
    except Exception as error:
        reason = str(error) if isinstance(error, Stop) else 'bounded_operation_failed'
        if not edited and not started:
            return {'status': 'stopped', 'stage': stage, 'category': reason}
        rollback_stage = 'configuration'
        try:
            check_other()
            if started:
                require(api_identity(run)[1] in (BASE, V4), 'rollback_image_conflict')
            else:
                require(api_identity(run) == base, 'rollback_image_conflict')
            pending = {path: new for path, _, new in edited}
            require([path.read_bytes() for path in paths] == [pending.get(paths[0], env_bytes), pending.get(paths[1], compose_bytes)],
                    'rollback_configuration_conflict')
            for path, _, new in edited:
                protected(path)
            for path, old, new in reversed(edited):
                change(path, new, old)
            if started:
                rollback_stage = 'api_and_relay'
                recreate()
                cid = health(BASE)
                verify_link(cid)
                check_other()
                rollback_stage = 'public_route'
                refresh = stabilize_public_route(run, read_status, sleep, rollback=True) or refresh
                verify_api(cid)
            require(api_identity(run)[1:3] == [BASE, 'healthy'], 'rollback_health_unverified')
            return {'status': 'rolled_back', 'stage': stage, 'category': reason, 'imageId': BASE, 'outboundVersion': 2,
                    'routeRefresh': refresh}
        except Exception:
            return {'status': 'rollback_unverified', 'stage': stage, 'category': reason, 'rollbackStage': rollback_stage}


if __name__ == '__main__':
    # The approved launcher supplies the literal gate in the same pinned SSH input.
    if globals().get('APPROVED_IMAGE_SWITCH') != V4 or os.geteuid() != 0:
        print(json.dumps({'status': 'review_only'}))
    else:
        print(json.dumps(switch()))
