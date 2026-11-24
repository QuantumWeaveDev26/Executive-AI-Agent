"""Test audio_url access."""
from pathlib import Path
import urllib.request
import urllib.error

secrets_dir = Path('/opt/thaara-v2-pilot-private/secrets')
sarvam_api_key = (secrets_dir / 'sarvam_api_key').read_text(encoding='utf-8').strip()

audio_url = "https://indus.sarvam.ai/media?org_id=01a10103-1b5d-78a1-9902-f391242c7537&workspace_id=01a10103-1b66-7123-96b1-43a6e96e016b&app_id=Thaara-AI-V-db336de4-5453&interaction_id=20261116/921070f1-11:55:58-aw1a08aa&audio_hash=merged_audio"

print("--- Testing audio_url without headers ---")
try:
    req = urllib.request.Request(audio_url)
    with urllib.request.urlopen(req, timeout=10) as resp:
        print("Status:", resp.status)
        print("Content-Type:", resp.headers.get('Content-Type'))
        print("Content-Length:", resp.headers.get('Content-Length'))
        sample = resp.read(100)
        print("First 100 bytes length:", len(sample))
except urllib.error.HTTPError as e:
    print(f"HTTPError {e.code}: {e.reason}")
except Exception as ex:
    print("Error:", ex)

print("--- Testing audio_url with X-API-Key ---")
try:
    req = urllib.request.Request(audio_url, headers={'X-API-Key': sarvam_api_key})
    with urllib.request.urlopen(req, timeout=10) as resp:
        print("Status:", resp.status)
        print("Content-Type:", resp.headers.get('Content-Type'))
        print("Content-Length:", resp.headers.get('Content-Length'))
        sample = resp.read(100)
        print("First 100 bytes length:", len(sample))
except urllib.error.HTTPError as e:
    print(f"HTTPError {e.code}: {e.reason}")
except Exception as ex:
    print("Error:", ex)
