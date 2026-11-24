"""Inspect workspace_id in job_runs."""
import subprocess

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT workspace_id, count(*) FROM public.job_runs GROUP BY workspace_id;"
], capture_output=True, text=True)
print("Workspaces in job_runs:\n", p.stdout.strip())

p2 = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT id, name FROM public.workspaces;"
], capture_output=True, text=True)
print("Workspaces in DB:\n", p2.stdout.strip())
