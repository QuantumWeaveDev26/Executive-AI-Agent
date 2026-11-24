"""Test audio_url headers and read error body."""
from pathlib import Path
import urllib.request
import urllib.error

secrets_dir = Path('/opt/thaara-v2-pilot-private/secrets')
sarvam_api_key = (secrets_dir / 'sarvam_api_key').read_text(encoding='utf-8').strip()

audio_url = "https://indus.sarvam.ai/media?org_id=01a10103-1b5d-78a1-9902-f391242c7537&workspace_id=01a10103-1b66-7123-96b1-43a6e96e016b&app_id=Thaara-AI-V-db336de4-5453&interaction_id=20261116/921070f1-11:55:58-aw1a08aa&audio_hash=merged_audio"

test_headers = [
    {},
    {"api-subscription-key": sarvam_api_key},
    {"Api-Subscription-Key": sarvam_api_key},
    {"X-API-Key": sarvam_api_key},
    {"Authorization": f"Bearer {sarvam_api_key}"},
]

for th in test_headers:
    hname = list(th.keys())[0] if th else 'None'
    try:
        req = urllib.request.Request(audio_url, headers=th)
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"Header {hname}: SUCCESS! status={resp.status}, len={resp.headers.get('Content-Length')}, type={resp.headers.get('Content-Type')}")
            break
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')[:200]
        print(f"Header {hname}: HTTPError {e.code} - body: {body}")
    except Exception as ex:
        print(f"Header {hname}: {ex}")
