"""Check RLS policies on memberships and workspaces."""
import subprocess

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT tablename, policyname, cmd, qual FROM pg_policies WHERE tablename IN ('memberships', 'workspaces', 'job_runs');"
], capture_output=True, text=True)

print(p.stdout)
