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
from urllib.error import HTTPError
from urllib.request import urlopen

BASE = 'sha256:b1b13df2fb1b51817765f099c2645e25bafa6934251add0d71c890c6f29d7117'
V3 = 'sha256:a7590de6e56ab622ef7b2f5f17dbe744f9182defbcf4fd0817a0f9bfb6ddf8ec'
BASE_CONTAINER = '08f378a8216af3b5b24749825da6d9fe789bd9b891831ede1e27df673b093ba8'
PROFILE = '7a41b4f34482ccf833fcdab6b7bb0c8a5c198f52a994ec4d8c0ca11a19596447'
PILOT = Path('/opt/thaara-v2-pilot')
API = 'thaara-v2-pilot-api-1'
OTHER = ('thaara-v2-pilot-postgres-1', 'thaara-v2-pilot-redis-1', 'n8n-n8n-1', 'n8n-traefik-1')
NET = 'n8n_default'
ALIAS = 'thaara-pilot-api'
SITE = 'https://thaara-v2.quantumweaveai.io'
ASSETS = {'/': 'ae2eb1b4e729f83513746d37a92d97162e418256d4cd2631bbcb09953f4eff6d',
          '/assets/index-CAoiIo_h.js': '504aa0bc3133edd6a6d0639562d1eed9d087ed202c3e7b7f4a3f51ade4260394',
          '/assets/index-Co2o2hIb.css': 'ed715f21be63f91a95091267354402101c750b39666ff5f6a8b52d853ff63309'}
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
    env_next = ENV_LINE + V3.encode() + b'\n'
    if image in ('${THAARA_PILOT_API_IMAGE}', '${THAARA_PILOT_API_IMAGE:?reviewed image ID required}'):
        return env_next, compose_bytes
    require(image == BASE, 'compose_image_baseline_mismatch')
    # Preserve the original Compose bytes apart from its single literal image pin.
    require(compose_bytes.count(BASE.encode()) == 1, 'compose_image_pin_ambiguous')
    return env_next, compose_bytes.replace(BASE.encode(), V3.encode(), 1)


def topology(run, name):
    raw = run(['inspect', '--format', '{{json .NetworkSettings.Networks}}', name])
    return {key: tuple(sorted(value.get('Aliases') or [])) for key, value in json.loads(raw).items()}


def api_identity(run):
    parts = run(['inspect', '--format', IMAGE_FIELDS, API]).split('|')
    require(len(parts) == 5 and re.fullmatch(r'[a-f0-9]{64}', parts[0]) and parts[3] == 'true', 'api_identity_denied')
    return parts


def web_check():
    for path, digest in ASSETS.items():
        with urlopen(SITE + path, timeout=8) as response:
            require(response.status == 200 and hashlib.sha256(response.read(1048576)).hexdigest() == digest,
                    'public_assets_changed')
    for url, expected in [(SITE + '/api/v1/health', 200), (SITE + '/api/v1/auth/me', 401),
                          (SITE + '/api/v1/connectors/phone/ai/requests', 401),
                          ('https://n8n.srv1871828.hstgr.cloud/healthz', 200)]:
        try:
            with urlopen(url, timeout=8) as response:
                status = response.status
        except HTTPError as error:
            status = error.code
            error.close()
        require(status == expected, 'public_health_or_auth_failed')


def switch(run=docker, verify_web=web_check, change=replace, pilot=PILOT, sleep=time.sleep):
    stage = 'preflight'
    edited = []
    started = False
    try:
        protected_directory(pilot)
        paths = [pilot / '.env', pilot / 'compose.json']
        require(protected(paths[0]).st_size == len(ENV_LINE) + len(BASE) + 1, 'image_pointer_size_denied')
        protected(paths[1])
        env_bytes, compose_bytes = [path.read_bytes() for path in paths]
        env_next, compose_next = image_changes(env_bytes, compose_bytes)
        base = api_identity(run)
        require(base[:3] == [BASE_CONTAINER, BASE, 'healthy'], 'live_api_baseline_changed')
        for image in (BASE, V3):
            require(run(['image', 'inspect', '--format', '{{.Id}}', image]) == image, 'pinned_image_missing')
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
        before['services']['api']['image'] = V3

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
        stage = 'postcheck'
        cid = health(V3)
        verify_link(cid)
        verify_api(cid)
        require(api_identity(run)[:3] == [cid, V3, 'healthy'], 'candidate_changed_after_verification')
        require([path.read_bytes() for path in paths] == [env_next, compose_next], 'configuration_changed_after_verification')
        return {'status': 'verified', 'stage': 'complete', 'imageId': V3, 'previousImageId': BASE, 'outboundVersion': 2}
    except Exception as error:
        reason = str(error) if isinstance(error, Stop) else 'bounded_operation_failed'
        if not edited and not started:
            return {'status': 'stopped', 'stage': stage, 'category': reason}
        try:
            check_other()
            if started:
                require(api_identity(run)[1] in (BASE, V3), 'rollback_image_conflict')
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
                recreate()
                cid = health(BASE)
                verify_link(cid)
                verify_api(cid)
            require(api_identity(run)[1:3] == [BASE, 'healthy'], 'rollback_health_unverified')
            return {'status': 'rolled_back', 'stage': stage, 'category': reason, 'imageId': BASE, 'outboundVersion': 2}
        except Exception:
            return {'status': 'rollback_unverified', 'stage': stage, 'category': reason}


if __name__ == '__main__':
    # The approved launcher supplies the literal gate in the same pinned SSH input.
    if globals().get('APPROVED_IMAGE_SWITCH') != V3 or os.geteuid() != 0:
        print(json.dumps({'status': 'review_only'}))
    else:
        print(json.dumps(switch()))
