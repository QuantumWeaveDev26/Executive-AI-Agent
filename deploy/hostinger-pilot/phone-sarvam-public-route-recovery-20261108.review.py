"""Restore Traefik Docker discovery using the existing pilot link refresh method."""
import json
import os
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

API = 'thaara-v2-pilot-api-1'
BASE = 'sha256:b1b13df2fb1b51817765f099c2645e25bafa6934251add0d71c890c6f29d7117'
CID = '3e771762f84b79de91b8973282d9bc8ea45e28a5273231d954f56634ed81a18f'
RELAY = 'n8n-n8n-1'
PROXY = 'n8n-traefik-1'
LOCAL_IMAGE = 'postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
TAG = 'thaara-phone-route-refresh-20261108'
THAARA = 'https://thaara-v2.quantumweaveai.io/api/v1/health'
N8N = 'https://n8n.srv1871828.hstgr.cloud/healthz'


class Stop(Exception):
    pass


def require(ok, category):
    if not ok:
        raise Stop(category)


def docker(args, timeout=15):
    result = subprocess.run(['docker', '--host=unix:///var/run/docker.sock', *args], capture_output=True, timeout=timeout)
    return result.returncode, result.stdout.decode().strip(), result.stderr.decode(errors='replace')


def status(url, timeout):
    try:
        with urlopen(url, timeout=timeout) as response:
            return response.status
    except HTTPError as error:
        code = error.code
        error.close()
        return code
    except (OSError, URLError):
        return 0


def recover(run=docker, public_status=status, sleep=time.sleep):
    triggered = False
    try:
        def output(args, timeout=15):
            code, text, _ = run(args, timeout)
            require(code == 0, 'docker_readback_failed')
            return text

        def inventory():
            fmt = '{{.Id}}|{{.Image}}|{{.State.StartedAt}}|{{.RestartCount}}'
            return {name: output(['inspect', '--format', fmt, name]) for name in (API, RELAY, PROXY)}

        before = inventory()
        require(before[API].split('|')[:2] == [CID, BASE], 'api_image_or_identity_changed')
        require(output(['inspect', '--format', '{{.State.Health.Status}}', API]) == 'healthy', 'private_api_unhealthy')
        require(output(['inspect', '--format', '{{index .Config.Labels "traefik.docker.network"}}', API]) == 'n8n_default', 'proxy_network_label_changed')
        private = "fetch('http://thaara-pilot-api:3002/api/v1/health',{signal:AbortSignal.timeout(5000)}).then(r=>console.log(r.status)).catch(()=>process.exit(1))"
        require(output(['exec', RELAY, 'node', '-e', private]) == '200', 'private_relay_unreachable')
        require(public_status(N8N, 8) == 200, 'public_n8n_unhealthy')
        initial = public_status(THAARA, 35)
        if initial == 200:
            return {'status': 'verified', 'refreshTriggered': False, 'publicThaara': 200, 'publicN8n': 200}
        require(initial in (0, 502, 503, 504), 'unexpected_public_response')
        # Same no-op event as the existing n8n-link-v2 helper, with a pinned local image and pulls disabled.
        require(LOCAL_IMAGE in json.loads(output(['image', 'inspect', '--format', '{{json .RepoDigests}}', LOCAL_IMAGE])), 'refresh_image_unverified')
        require(inventory() == before, 'live_services_changed')
        code, _, error = run(['container', 'inspect', TAG])
        require(code == 1 and ('no such container' in error.lower() or 'no such object' in error.lower()), 'refresh_name_not_clear')
        triggered = True
        output(['run', '--rm', '--name', TAG, '--pull=never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                '--security-opt', 'no-new-privileges', '--entrypoint', 'true', LOCAL_IMAGE], 30)
        code, _, error = run(['container', 'inspect', TAG])
        require(code == 1 and ('no such container' in error.lower() or 'no such object' in error.lower()), 'temporary_container_cleanup_unverified')
        for _ in range(6):
            require(inventory() == before, 'live_services_changed')
            require(public_status(N8N, 8) == 200, 'public_n8n_unhealthy')
            if public_status(THAARA, 8) == 200:
                require(output(['exec', RELAY, 'node', '-e', private]) == '200', 'private_relay_unreachable')
                require(inventory() == before, 'live_services_changed')
                return {'status': 'verified', 'refreshTriggered': True, 'publicThaara': 200, 'publicN8n': 200}
            sleep(3)
        raise Stop('public_thaara_still_unhealthy')
    except Exception as error:
        return {'status': 'stopped', 'refreshTriggered': triggered,
                'category': str(error) if isinstance(error, Stop) else 'bounded_recovery_failed'}


if __name__ == '__main__':
    if globals().get('APPROVED_PUBLIC_ROUTE_REFRESH') is True and os.geteuid() == 0:
        print(json.dumps(recover()))
    else:
        print(json.dumps({'status': 'review_only'}))
