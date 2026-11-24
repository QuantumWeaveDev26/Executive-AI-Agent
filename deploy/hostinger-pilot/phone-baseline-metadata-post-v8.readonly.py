"""Read two fixed Docker inventories. Never enter the container or export files."""
import json
import re
import subprocess

CONTAINER = 'thaara-v2-pilot-api-1'
EXPECTED = 'sha256:9fb2739d92ba3c5bc38c1c5927b8ef3614da816e03a9dac107497b2b842f652c'
FORMAT = ('{{.Id}}|{{.Image}}|{{.State.Health.Status}}|'
          '{{index .Config.Labels "com.docker.compose.project"}}|'
          '{{index .Config.Labels "com.docker.compose.service"}}|'
          '{{.State.StartedAt}}|{{.HostConfig.ReadonlyRootfs}}')
COMMAND = ('docker', '--host=unix:///var/run/docker.sock', 'inspect', '--format', FORMAT, CONTAINER)


def inventory():
    result = subprocess.run(COMMAND, capture_output=True, check=True, timeout=12)
    if len(result.stdout) > 1024:
        raise ValueError('oversized inventory')
    return result.stdout.decode('ascii').strip().split('|')


def check(read=inventory):
    before = read()
    after = read()
    if before != after:
        return {'status': 'stopped', 'category': 'inventory_changed'}
    if (len(before) != 7 or not re.fullmatch(r'[0-9a-f]{64}', before[0])
            or not re.fullmatch(r'sha256:[0-9a-f]{64}', before[1])
            or before[2] not in ('healthy', 'unhealthy', 'starting')
            or before[3:5] != ['thaara-v2-pilot', 'api']
            or before[6] not in ('true', 'false')):
        return {'status': 'stopped', 'category': 'inventory_shape_or_identity_denied'}
    return {'status': 'verified', 'containerId': before[0], 'imageId': before[1],
            'health': before[2], 'readOnlyRoot': before[6] == 'true',
            'matchesV8Image': before[1] == EXPECTED}


if __name__ == '__main__':
    try:
        print(json.dumps(check()))
    except (subprocess.SubprocessError, ValueError):
        print(json.dumps({'status': 'stopped', 'category': 'inventory_unavailable'}))
