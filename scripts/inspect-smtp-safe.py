import subprocess
import json

p = subprocess.run([
    'docker', 'exec', 'n8n-n8n-1', 'n8n', 'export:credentials', '--id=G1VGVGldX32ch2xV', '--decrypted'
], capture_output=True, text=True)

# Find json array in output
text = p.stdout.strip()
idx = text.find('[')
if idx != -1:
    data = json.loads(text[idx:])
    cdata = data[0].get('data', {})
    safe = {k: ('[REDACTED]' if 'pass' in k.lower() else v) for k, v in cdata.items()}
    print("SMTP details:\n", json.dumps(safe, indent=2))
else:
    print("No JSON array found.")
