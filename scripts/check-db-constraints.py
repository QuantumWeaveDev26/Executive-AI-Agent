import subprocess

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.phone_callback_requests'::regclass;"
], capture_output=True, text=True)

print("Constraints on phone_callback_requests:\n", p.stdout.strip())
