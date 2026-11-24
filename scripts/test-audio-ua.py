"""Test audio_url with proper User-Agent to avoid Cloudflare 1010 block."""
from pathlib import Path
import urllib.request
import urllib.error

secrets_dir = Path('/opt/thaara-v2-pilot-private/secrets')
sarvam_api_key = (secrets_dir / 'sarvam_api_key').read_text(encoding='utf-8').strip()

audio_url = "https://indus.sarvam.ai/media?org_id=01a10103-1b5d-78a1-9902-f391242c7537&workspace_id=01a10103-1b66-7123-96b1-43a6e96e016b&app_id=Thaara-AI-V-db336de4-5453&interaction_id=20261116/921070f1-11:55:58-aw1a08aa&audio_hash=merged_audio"

ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

test_headers = [
    {"User-Agent": ua},
    {"User-Agent": ua, "X-API-Key": sarvam_api_key},
    {"User-Agent": ua, "api-subscription-key": sarvam_api_key},
]

for th in test_headers:
    hname = ", ".join(th.keys())
    try:
        req = urllib.request.Request(audio_url, headers=th)
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"Headers [{hname}]: SUCCESS! status={resp.status}, len={resp.headers.get('Content-Length')}, type={resp.headers.get('Content-Type')}")
            sample = resp.read(50)
            print("  First bytes:", sample[:20])
            break
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')[:200]
        print(f"Headers [{hname}]: HTTPError {e.code} - body: {body}")
    except Exception as ex:
        print(f"Headers [{hname}]: {ex}")
