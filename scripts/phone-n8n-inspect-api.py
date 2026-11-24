"""Inspect container mounts and compose file."""
import json
import subprocess

p = subprocess.run(['docker', 'inspect', 'thaara-v2-pilot-api-1'], capture_output=True, text=True)
data = json.loads(p.stdout)[0]
info = {
    'Mounts': data.get('Mounts', []),
    'Env': [e.split('=')[0] for e in data.get('Config', {}).get('Env', [])],
    'Cmd': data.get('Config', {}).get('Cmd', []),
    'WorkingDir': data.get('Config', {}).get('WorkingDir', '')
}
print(json.dumps(info, indent=2))
