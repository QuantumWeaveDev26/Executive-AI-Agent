"""Check phone115 worker env var names."""
import subprocess
import json

p = subprocess.run(['docker', 'inspect', 'thaara-phone115-worker'], capture_output=True, text=True)
data = json.loads(p.stdout)[0]
envs = [e.split('=')[0] for e in data.get('Config', {}).get('Env', [])]
print("Worker env vars:", envs)
