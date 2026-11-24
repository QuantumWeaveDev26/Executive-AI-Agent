"""Check tables and rows in thaara_vps_pilot."""
import subprocess

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"
], capture_output=True, text=True)
print("Tables:\n", p.stdout)
