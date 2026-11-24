import subprocess
import json

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT row_to_json(r) FROM public.phone_callback_requests r WHERE call_id = 'e08e595066cd3788699164ee33cd9f19b3226a1012a93ddde72ac603c70aee51';"
], capture_output=True, text=True)

row = p.stdout.strip()
print("Raw row JSON:\n", row)

# Also check phone_callback_notification_grants or uses or service configuration
p2 = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT row_to_json(g) FROM public.phone_callback_service_configuration g LIMIT 5;"
], capture_output=True, text=True)
print("\nConfiguration:\n", p2.stdout.strip())
