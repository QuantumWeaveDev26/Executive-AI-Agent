"""Inspect HTML returned by https://indus.sarvam.ai/media."""
import urllib.request

audio_url = "https://indus.sarvam.ai/media?org_id=01a10103-1b5d-78a1-9902-f391242c7537&workspace_id=01a10103-1b66-7123-96b1-43a6e96e016b&app_id=Thaara-AI-V-db336de4-5453&interaction_id=20261116/921070f1-11:55:58-aw1a08aa&audio_hash=merged_audio"
ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

req = urllib.request.Request(audio_url, headers={"User-Agent": ua})
with urllib.request.urlopen(req, timeout=10) as resp:
    html = resp.read().decode('utf-8', errors='replace')
    print("HTML length:", len(html))
    print(html[:1500])
