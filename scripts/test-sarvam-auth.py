"""List secret file names (not contents) and test Sarvam Analytics endpoint."""
from pathlib import Path
import urllib.request
import urllib.error
import json

secrets_dir = Path('/opt/thaara-v2-pilot-private/secrets')
files = [p.name for p in secrets_dir.glob('*')]
print("Secret files:", files)

# Read sarvam keys if present
sarvam_api_key = (secrets_dir / 'sarvam_api_key').read_text(encoding='utf-8').strip() if (secrets_dir / 'sarvam_api_key').exists() else ''
print("sarvam_api_key length:", len(sarvam_api_key), "prefix:", sarvam_api_key[:6])

# Let's check other sarvam secrets
sarvam_profile = (secrets_dir / 'sarvam_profile').read_text(encoding='utf-8').strip() if (secrets_dir / 'sarvam_profile').exists() else ''
print("sarvam_profile exists:", bool(sarvam_profile), "length:", len(sarvam_profile))
if sarvam_profile:
    try:
        p_json = json.loads(sarvam_profile)
        print("sarvam_profile keys:", list(p_json.keys()))
    except:
        print("sarvam_profile is not json")

url = "https://apps.sarvam.ai/api/analytics/v1/01a10103-1b5d-78a1-9902-f391242c7537/01a10103-1b66-7123-96b1-43a6e96e016b/Thaara-AI-V-db336de4-5453/attempts"

# Test different auth headers
test_headers = [
    {"api-subscription-key": sarvam_api_key},
    {"Api-Subscription-Key": sarvam_api_key},
    {"Authorization": f"Bearer {sarvam_api_key}"},
    {"sarvam-api-key": sarvam_api_key},
    {"x-api-key": sarvam_api_key}
]

for th in test_headers:
    hname = list(th.keys())[0]
    req = urllib.request.Request(url, headers=th)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            print(f"Header {hname}: SUCCESS status={resp.status}")
            data = resp.read(200)
            print("Preview:", data)
    except urllib.error.HTTPError as e:
        print(f"Header {hname}: HTTPError {e.code} - {e.reason}")
        err_body = e.read().decode('utf-8', errors='replace')[:200]
        print("  Error body:", err_body)
    except Exception as ex:
        print(f"Header {hname}: Exception {ex}")
