"""Inspect job_runs row."""
import subprocess

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-c',
    "SELECT id, job_type, created_at, payload FROM public.job_runs;"
], capture_output=True, text=True)
print(p.stdout)
