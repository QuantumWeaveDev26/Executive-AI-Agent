"""Check job_runs table directly."""
import subprocess

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-c',
    "SELECT count(*) FROM public.job_runs;"
], capture_output=True, text=True)
print("job_runs count:\n", p.stdout)
