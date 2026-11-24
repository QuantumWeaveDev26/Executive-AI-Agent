import subprocess
import json

# Run n8n export:credentials --id=G1VGVGldX32ch2xV --decrypted inside container
p = subprocess.run([
    'docker', 'exec', 'n8n-n8n-1', 'n8n', 'export:credentials', '--id=G1VGVGldX32ch2xV', '--decrypted'
], capture_output=True, text=True)

try:
    data = json.loads(p.stdout.strip())
    if isinstance(data, list) and len(data) > 0:
        cdata = data[0].get('data', {})
        # Redact password
        safe = {}
        for k, v in cdata.items():
            if 'pass' in k.lower() or 'secret' in k.lower() or 'key' in k.lower():
                safe[k] = '[REDACTED len=' + str(len(str(v))) + ']'
            else:
                safe[k] = v
        print("SMTP Configuration (Redacted):\n", json.dumps(safe, indent=2))
    else:
        print("Raw output:", p.stdout[:300])
except Exception as e:
    print("Error parsing exported credential:", e, "\nRaw:", p.stdout[:300], p.stderr[:300])
