"""Read back the API after an unverified rollback. No server changes."""
import json
from pathlib import Path
import re
import subprocess

BASE = 'sha256:b1b13df2fb1b51817765f099c2645e25bafa6934251add0d71c890c6f29d7117'
V3 = 'sha256:a7590de6e56ab622ef7b2f5f17dbe744f9182defbcf4fd0817a0f9bfb6ddf8ec'
API = 'thaara-v2-pilot-api-1'
INVENTORY = ['inspect', '--format', '{{.Id}}|{{.Image}}|{{.State.Health.Status}}|{{.State.Status}}|{{.State.StartedAt}}', API]
ALIAS = "{{with index .NetworkSettings.Networks \"n8n_default\"}}{{range .Aliases}}{{println .}}{{end}}{{end}}"


def docker(args):
    result = subprocess.run(['docker', '--host=unix:///var/run/docker.sock', *args], capture_output=True, timeout=12)
    return result.returncode, result.stdout.decode().strip()


def image_state(image):
    return 'base' if image == BASE else 'v3' if image == V3 else 'other'


def readback(run=docker, directory=Path('/opt/thaara-v2-pilot')):
    code, raw = run(INVENTORY)
    facts = raw.split('|')
    if code or len(facts) != 5 or not re.fullmatch('[a-f0-9]{64}', facts[0]) or not re.fullmatch('sha256:[a-f0-9]{64}', facts[1]):
        return {'status': 'stopped', 'category': 'api_identity_unverified'}
    cid, image, health, state, _ = facts
    alias_code, aliases = run(['inspect', '--format', ALIAS, cid])
    link = not alias_code and 'thaara-pilot-api' in aliases.splitlines()
    relay = False
    if link:
        relay_code, relay_status = run(['exec', 'n8n-n8n-1', 'node', '-e',
            "fetch('http://thaara-pilot-api:3002/api/v1/health',{signal:AbortSignal.timeout(5000)}).then(r=>console.log(r.status)).catch(()=>process.exit(1))"])
        relay = not relay_code and relay_status == '200'
    final_code, after = run(INVENTORY)
    if final_code or after != raw:
        return {'status': 'stopped', 'category': 'api_changed_during_readback'}
    with (directory / '.env').open('rb') as stream:
        env = stream.read(128)
    env_pin = next((image_state(pin) for pin in (BASE, V3) if env == b'THAARA_PILOT_API_IMAGE=' + pin.encode() + b'\n'), 'other')
    with (directory / 'compose.json').open('rb') as stream:
        compose = json.loads(stream.read(131073))['services']['api']['image']
    compose_pin = 'interpolated' if compose in ('${THAARA_PILOT_API_IMAGE}', '${THAARA_PILOT_API_IMAGE:?reviewed image ID required}') else image_state(compose)
    return {'status': 'verified', 'containerId': cid, 'imageId': image, 'healthy': health == 'healthy',
            'running': state == 'running', 'relayAlias': link, 'relayHealthy': relay, 'envPin': env_pin,
            'composePin': compose_pin}


if __name__ == '__main__':
    try:
        print(json.dumps(readback()))
    except Exception:
        print(json.dumps({'status': 'stopped', 'category': 'readback_failed'}))
