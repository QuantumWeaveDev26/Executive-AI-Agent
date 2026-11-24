import subprocess
import json

p = subprocess.run(['docker', 'inspect', 'n8n-n8n-1'], capture_output=True, text=True)
data = json.loads(p.stdout)[0]
envs = data.get('Config', {}).get('Env', [])
db_envs = [e for e in envs if 'DB' in e or 'DATABASE' in e or 'N8N' in e]
print("DB Envs in n8n:\n", json.dumps(db_envs, indent=2))
