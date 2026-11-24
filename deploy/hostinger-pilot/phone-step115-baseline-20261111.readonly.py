"""One read-only container identity check. No source, profile or credential export."""
import json
import re
import subprocess

command = ['docker', 'inspect', '--format', '{{.Id}}|{{.Image}}|{{.State.Health.Status}}', 'thaara-v2-pilot-api-1']
def inspect():
    result = subprocess.run(command, capture_output=True, timeout=15, check=True)
    parts = result.stdout.decode('utf-8').strip().split('|')
    if len(parts) != 3 or not re.fullmatch('[a-f0-9]{64}', parts[0]) or not re.fullmatch('sha256:[a-f0-9]{64}', parts[1]) or parts[2] != 'healthy':
        raise RuntimeError('container_identity_unavailable')
    return parts

before = inspect()
if before != inspect():
    raise RuntimeError('container_changed')
print(json.dumps({'status': 'verified', 'containerId': before[0], 'imageId': before[1], 'sourceHealthy': True,
                  'changesMade': False, 'providerRequests': 0}))
