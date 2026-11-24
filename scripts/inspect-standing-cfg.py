"""Inspect phone_callback_service_configuration in postgres."""
import subprocess

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT * FROM public.phone_callback_service_configuration;"
], capture_output=True, text=True)
print("Standing service configuration:\n", p.stdout.strip())
