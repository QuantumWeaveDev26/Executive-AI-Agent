"""Inspect job_runs row with workspace_id set."""
import subprocess

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-c',
    "SET app.workspace_id = '75d2f889-d3eb-4acc-861a-fada4691ecce'; SELECT id, job_type, created_at, left(payload::text, 100) FROM public.job_runs;"
], capture_output=True, text=True)
print(p.stdout)
