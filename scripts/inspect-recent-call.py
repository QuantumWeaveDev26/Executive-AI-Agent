"""Inspect the call from 11:35 AM IST in PostgreSQL."""
import subprocess
import json

script = """
SELECT id, job_name, idempotency_key, status, payload, result, error, created_at, updated_at
FROM public.job_runs
WHERE created_at >= '2026-11-18 05:00:00+00'
ORDER BY created_at DESC;
"""

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT job_name, idempotency_key, status, (payload->>'occurredAt'), (payload->>'customerName'), (payload->>'phoneNumber'), (payload->>'callbackEligibility'), (payload->>'callbackRequestId'), (payload->>'interactionId'), (payload->>'callId') FROM public.job_runs WHERE created_at >= '2026-11-18 05:30:00+00' ORDER BY created_at DESC;"
], capture_output=True, text=True)

print("=== Job Runs created after 05:30 UTC ===")
print(p.stdout.strip())

p2 = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT id, interaction_id, phone_number, notification_status, customer_name, callback_state, created_at FROM public.phone_callback_requests ORDER BY created_at DESC LIMIT 5;"
], capture_output=True, text=True)
print("\n=== Phone Callback Requests ===")
print(p2.stdout.strip() if p2.stdout.strip() else "(No rows in phone_callback_requests)")
