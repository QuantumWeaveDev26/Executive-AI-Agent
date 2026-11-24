import subprocess
import json

def run_psql(query):
    p = subprocess.run([
        'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
        'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c', query
    ], capture_output=True, text=True)
    return p.stdout.strip(), p.stderr.strip()

print("--- 1. Tables related to notification or callback ---")
out, err = run_psql("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND (table_name LIKE '%callback%' OR table_name LIKE '%notif%' OR table_name LIKE '%email%' OR table_name LIKE '%deliver%');")
print("Tables:", out)

print("\n--- 2. phone_callback_requests for test call ---")
callId = 'e08e595066cd3788699164ee33cd9f19b3226a1012a93ddde72ac603c70aee51'
out, err = run_psql(f"SELECT id, call_id, caller_name, caller_phone, callback_consent, notification_status, provider_message_id, created_at, updated_at FROM public.phone_callback_requests WHERE call_id = '{callId}';")
print("Row:", out)

print("\n--- 3. Any other rows in phone_callback_requests ---")
out, err = run_psql("SELECT id, call_id, caller_name, notification_status, provider_message_id, created_at FROM public.phone_callback_requests ORDER BY created_at DESC LIMIT 5;")
print("All recent rows:\n", out)

print("\n--- 4. Inspect thaara-phone115-worker container ---")
try:
    insp = subprocess.check_output(['docker', 'inspect', 'thaara-phone115-worker']).decode('utf-8')
    data = json.loads(insp)[0]
    print("Config.Cmd:", data.get('Config', {}).get('Cmd'))
    print("Config.Entrypoint:", data.get('Config', {}).get('Entrypoint'))
    # Mask any secret values when printing env
    envs = []
    for e in data.get('Config', {}).get('Env', []):
        if '=' in e:
            k, v = e.split('=', 1)
            if any(s in k.lower() for s in ['key', 'secret', 'pass', 'token']):
                envs.append(f"{k}=[REDACTED len={len(v)}]")
            else:
                envs.append(f"{k}={v}")
    print("Env:", envs)
except Exception as e:
    print("Error inspect worker:", e)

print("\n--- 5. thaara-phone115-worker logs ---")
try:
    worker_logs = subprocess.check_output(['docker', 'logs', '--tail', '100', 'thaara-phone115-worker']).decode('utf-8')
    print("Worker logs tail:\n", worker_logs[-2000:])
except Exception as e:
    print("Error getting worker logs:", e)

print("\n--- 6. thaara-phone115-receiver logs ---")
try:
    recv_logs = subprocess.check_output(['docker', 'logs', '--tail', '100', 'thaara-phone115-receiver']).decode('utf-8')
    print("Receiver logs tail:\n", recv_logs[-2000:])
except Exception as e:
    print("Error getting receiver logs:", e)
