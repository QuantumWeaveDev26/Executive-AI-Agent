"""Check phone.n8n.callback_notify row in job_runs."""
import subprocess
import json

callId = 'e08e595066cd3788699164ee33cd9f19b3226a1012a93ddde72ac603c70aee51'
p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    f"SELECT id, status, retries_count, payload, result, error, created_at, updated_at FROM public.job_runs WHERE job_name = 'phone.n8n.callback_notify' AND idempotency_key = 'callback_notify:{callId}';"
], capture_output=True, text=True)

print("callback_notify row:\n", p.stdout.strip())
