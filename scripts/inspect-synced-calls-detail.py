"""Count synced calls in postgres by direction."""
import subprocess

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT (payload->>'direction') as dir, count(*) FROM public.job_runs WHERE job_name = 'phone.n8n.call_sync' GROUP BY dir;"
], capture_output=True, text=True)
print("Synced calls count by direction:\n", p.stdout.strip())

p2 = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT (payload->>'direction'), (payload->>'callId'), (payload->>'customerName'), (payload->>'phoneNumber'), (payload->>'durationSeconds'), (payload->>'outcomeLabel'), (payload->>'recordingAvailable'), jsonb_array_length(payload->'transcript') FROM public.job_runs WHERE job_name = 'phone.n8n.call_sync' ORDER BY updated_at DESC LIMIT 5;"
], capture_output=True, text=True)
print("\nSample synced call details (dir|callId|name|phone|dur|outcome|recAvailable|turns):\n", p2.stdout.strip())
