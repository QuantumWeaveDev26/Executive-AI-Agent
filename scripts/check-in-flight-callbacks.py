import subprocess
import json

def run_psql(query):
    p = subprocess.run([
        'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
        'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c', query
    ], capture_output=True, text=True)
    return p.stdout.strip()

in_flight_cbs = run_psql("SELECT count(*) FROM public.phone_callback_requests WHERE notification_status IN ('sending');")
pending_cbs = run_psql("SELECT count(*) FROM public.phone_callback_requests WHERE notification_status IN ('pending');")
in_flight_jobs = run_psql("SELECT count(*) FROM public.job_runs WHERE status = 'processing';")

print("In-flight callback requests (status=sending):", in_flight_cbs)
print("Pending callback requests (status=pending):", pending_cbs)
print("In-flight job_runs (status=processing):", in_flight_jobs)

# Verify Miss Krishna row specifically
callId = 'e08e595066cd3788699164ee33cd9f19b3226a1012a93ddde72ac603c70aee51'
krishna_row = run_psql(f"SELECT call_id, notification_status, provider_message_id, attempts FROM public.phone_callback_requests WHERE call_id = '{callId}';")
print("\nMiss Krishna status:", krishna_row)
