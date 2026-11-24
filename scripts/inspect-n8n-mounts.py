import subprocess
import json

p = subprocess.run(['docker', 'inspect', 'n8n-n8n-1'], capture_output=True, text=True)
data = json.loads(p.stdout)[0]
mounts = data.get('Mounts', [])
print("Mounts:\n", json.dumps(mounts, indent=2))

# Also search inside container for database.sqlite
p_find = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'find', '/', '-name', '*database.sqlite*', '-maxdepth', '4'], capture_output=True, text=True)
print("Find result:\n", p_find.stdout.strip())
