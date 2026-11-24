"""Check for duplicate calls in postgres."""
import subprocess

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT idempotency_key, count(*) FROM public.job_runs WHERE job_name = 'phone.n8n.call_sync' GROUP BY idempotency_key HAVING count(*) > 1;"
], capture_output=True, text=True)

duplicates = p.stdout.strip()
if duplicates:
    print("Found duplicates:\n", duplicates)
else:
    print("Zero duplicates found! Every single call is deduplicated.")
