import subprocess
import json

def run_psql(query):
    p = subprocess.run([
        'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
        'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c', query
    ], capture_output=True, text=True)
    return p.stdout.strip()

config = run_psql("SELECT row_to_json(c) FROM public.phone_callback_service_configuration c;")
print("phone_callback_service_configuration:\n", config)

principals = run_psql("SELECT row_to_json(p) FROM public.phone_callback_worker_principals p;")
print("\nprincipals:\n", principals)
