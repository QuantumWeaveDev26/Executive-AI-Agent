import subprocess

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT prosrc FROM pg_proc WHERE proname = 'phone_callback_worker_operation';"
], capture_output=True, text=True)

print("phone_callback_worker_operation:\n", p.stdout.strip())
