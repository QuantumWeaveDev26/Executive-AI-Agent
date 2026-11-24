"""Query workspace and owner ID in production database."""
import subprocess

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT w.id, w.name, u.id, u.email, u.role FROM public.workspaces w JOIN public.users u ON u.workspace_id = w.id WHERE u.role = 'owner' LIMIT 5;"
], capture_output=True, text=True)
print(p.stdout)
