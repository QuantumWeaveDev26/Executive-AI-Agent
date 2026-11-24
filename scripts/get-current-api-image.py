import subprocess
import json

p = subprocess.run(['docker', 'inspect', 'thaara-v2-pilot-api-1'], capture_output=True, text=True)
data = json.loads(p.stdout)[0]
print("Current API Image:", data.get('Image'))
print("Config Image:", data.get('Config', {}).get('Image'))
