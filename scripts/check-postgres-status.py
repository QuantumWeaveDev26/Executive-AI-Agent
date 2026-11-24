import subprocess
import json

cmd = ['docker', 'ps', '--format', '{{.Names}}\t{{.Status}}\t{{.Ports}}']
out = subprocess.check_output(cmd).decode('utf-8')
print("Containers:")
print(out)

# Check postgres containers and users
try:
    # Check what user postgres uses
    out_users = subprocess.check_output(['docker', 'exec', 'thaara-v2-pilot-postgres-1', 'psql', '-U', 'thaara', '-d', 'thaara_vps_pilot', '-c', '\dt'], stderr=subprocess.STDOUT)
    print("Postgres with user thaara:\n", out_users.decode('utf-8')[:500])
except Exception as e:
    print("Error user thaara:", e)
