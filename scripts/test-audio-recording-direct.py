"""Test live recording fetch with superuser postgres."""
import subprocess
import json
from pathlib import Path

PRIVATE = Path('/opt/thaara-v2-pilot-private')
sarvam_api_key = (PRIVATE / 'secrets' / 'sarvam_api_key').read_text(encoding='utf-8').strip()

p = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT (payload->>'rawAudioUrl'), (payload->>'callId') FROM public.job_runs WHERE job_name = 'phone.n8n.call_sync' AND (payload->>'recordingAvailable') = 'true' LIMIT 1;"
], capture_output=True, text=True)

if p.stdout.strip():
    parts = p.stdout.strip().split('|')
    audio_url = parts[0]
    call_id = parts[1]
    print(f"Call {call_id} Audio URL: {audio_url[:60]}...")
    
    # Test fetch from Sarvam
    import urllib.request
    req = urllib.request.Request(audio_url, headers={
        'User-Agent': 'Thaara-Voice-Proxy/1.0',
        'X-API-Key': sarvam_api_key,
        'api-subscription-key': sarvam_api_key
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            print("Sarvam audio fetch: SUCCESS status=", resp.status)
            print("Content-Type:", resp.headers.get('content-type'))
            print("Content-Length:", resp.headers.get('content-length'))
    except Exception as e:
        print("Sarvam audio fetch ERROR:", e)
else:
    print("No call with recordingAvailable=true found.")
