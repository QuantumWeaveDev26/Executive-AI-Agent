from pathlib import Path
import json

secrets_dir = Path('/opt/thaara-v2-pilot-private/secrets')
for fname in ['send_profile', 'phone_callback_profile', 'phone_callback_api_profile']:
    f = secrets_dir / fname
    if f.exists():
        content = f.read_text(encoding='utf-8', errors='ignore').strip()
        print(f"=== {fname} ===")
        try:
            parsed = json.loads(content)
            # Redact actual secret values, show keys and prefixes/lengths
            safe = {}
            for k, v in parsed.items():
                if isinstance(v, str):
                    if any(s in k.lower() for s in ['key', 'secret', 'pass', 'token']):
                        safe[k] = f"{v[:6]}... (len {len(v)})"
                    else:
                        safe[k] = v
                else:
                    safe[k] = v
            print(json.dumps(safe, indent=2))
        except Exception:
            print("Not JSON. Content length:", len(content))
