"""Query memberships in production database."""
import subprocess

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT m.workspace_id, m.user_id, m.role, u.email FROM public.memberships m JOIN public.users u ON u.id = m.user_id;"
], capture_output=True, text=True)
print(p.stdout)
