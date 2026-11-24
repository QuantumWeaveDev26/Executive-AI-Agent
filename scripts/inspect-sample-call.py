"""Inspect full payload of a synced call."""
import subprocess
import json

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT payload FROM public.job_runs WHERE job_name = 'phone.n8n.call_sync' AND idempotency_key LIKE 'sarvam_call:inbound:%' LIMIT 1;"
], capture_output=True, text=True)

if p.stdout.strip():
    data = json.loads(p.stdout.strip())
    print("Call ID:", data.get('callId'))
    print("Direction:", data.get('direction'))
    print("Customer Name:", data.get('customerName'))
    print("Phone Number:", data.get('phoneNumber'))
    print("Duration:", data.get('durationSeconds'))
    print("Outcome:", data.get('outcomeLabel'))
    print("Recording Available:", data.get('recordingAvailable'))
    print("Transcript Turns Count:", len(data.get('transcript', [])))
    if data.get('transcript'):
        print("First 2 turns:", json.dumps(data['transcript'][:2], indent=2))
else:
    print("No row found.")
