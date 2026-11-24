import subprocess
import json

for cred_id in ['jtLOWVgBKhDXKrUH', 'XmHYwmapfhSF94WA', 'VNE8c5XfExHEBeaY']:
    p = subprocess.run([
        'docker', 'exec', 'n8n-n8n-1', 'n8n', 'export:credentials', f'--id={cred_id}', '--decrypted'
    ], capture_output=True, text=True)
    text = p.stdout.strip()
    idx = text.find('[')
    if idx != -1:
        try:
            data = json.loads(text[idx:])
            cdata = data[0].get('data', {})
            safe = {k: ('[REDACTED]' if any(s in k.lower() for s in ['pass', 'token', 'secret']) else v) for k, v in cdata.items()}
            print(f"Cred {cred_id} ({data[0].get('name')}):", json.dumps(safe, indent=2))
        except Exception as e:
            print(f"Error {cred_id}:", e)
