"""Inspect job_runs table schema and rows."""
import subprocess

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'job_runs';"
], capture_output=True, text=True)
print("job_runs columns:\n", p.stdout.strip())

p2 = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT job_name, idempotency_key, status, updated_at FROM public.job_runs ORDER BY updated_at DESC LIMIT 10;"
], capture_output=True, text=True)
print("\njob_runs rows:\n", p2.stdout.strip())
