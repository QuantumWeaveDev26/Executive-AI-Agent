"""Inspect attempt object keys from Sarvam attempt in payload."""
import subprocess
import json

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT payload FROM public.job_runs WHERE job_name = 'phone.n8n.call_sync' LIMIT 1;"
], capture_output=True, text=True)

if p.stdout.strip():
    data = json.loads(p.stdout.strip())
    print("Payload keys:", list(data.keys()))
    print("Payload sample:", json.dumps({k: data[k] for k in data if k != 'transcript'}, indent=2))
