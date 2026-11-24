"""Inspect phone_callback_requests table columns and rows."""
import subprocess

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'phone_callback_requests';"
], capture_output=True, text=True)
print("Columns in phone_callback_requests:\n", p.stdout.strip())

callId = 'e08e595066cd3788699164ee33cd9f19b3226a1012a93ddde72ac603c70aee51'
p2 = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    f"SELECT * FROM public.phone_callback_requests WHERE call_id = '{callId}';"
], capture_output=True, text=True)
print("\nRow for callId in phone_callback_requests:\n", p2.stdout.strip())

p3 = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT count(*) FROM public.phone_callback_requests;"
], capture_output=True, text=True)
print("\nTotal count in phone_callback_requests:", p3.stdout.strip())
