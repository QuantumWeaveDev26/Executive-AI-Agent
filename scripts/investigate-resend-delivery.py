"""
Investigate Resend message d14034cf-59c5-4798-895a-27513fbc2b67 read-only.
"""
import os
import json
import urllib.request
import urllib.error
import subprocess
from pathlib import Path

results = {}

# 1. Inspect secrets to find Resend API Key
secrets_dir = Path('/opt/thaara-v2-pilot-private/secrets')
resend_key = None

if secrets_dir.exists():
    for f in secrets_dir.iterdir():
        if f.is_file():
            name = f.name.lower()
            if 'resend' in name or 'send' in name or 'email' in name or 'mail' in name:
                try:
                    txt = f.read_text(encoding='utf-8', errors='ignore').strip()
                    try:
                        parsed = json.loads(txt)
                        for k, v in parsed.items():
                            if 'resend' in k.lower() or 'key' in k.lower() or 'api' in k.lower():
                                if str(v).startswith('re_'):
                                    resend_key = str(v)
                                    results['resend_key_source'] = f"{f.name}:{k}"
                    except Exception:
                        if txt.startswith('re_'):
                            resend_key = txt
                            results['resend_key_source'] = f.name
                except Exception as e:
                    results[f'err_reading_{f.name}'] = str(e)

# If not found in secrets dir, check docker inspect on worker or api
if not resend_key:
    for container in ['thaara-phone115-worker', 'thaara-v2-pilot-api', 'thaara-v2-pilot-api-1']:
        try:
            out = subprocess.check_output(['docker', 'inspect', container], stderr=subprocess.DEVNULL)
            insp = json.loads(out.decode('utf-8'))[0]
            env_list = insp.get('Config', {}).get('Env', [])
            for env in env_list:
                if '=' in env:
                    k, v = env.split('=', 1)
                    if 'RESEND' in k.upper() and v.startswith('re_'):
                        resend_key = v
                        results['resend_key_source'] = f"container_{container}:{k}"
                        break
            if resend_key:
                break
        except Exception:
            pass

# Also check env files in /opt/thaara-v2-pilot-private/ or /opt/thaara/
for p in [Path('/opt/thaara-v2-pilot-private'), Path('/opt/thaara-v2-pilot-private/secrets'), Path('/root')]:
    if resend_key:
        break
    if p.exists():
        for env_file in p.glob('*.env'):
            try:
                for line in env_file.read_text(encoding='utf-8', errors='ignore').splitlines():
                    line = line.strip()
                    if line.startswith('RESEND_') and '=' in line:
                        k, v = line.split('=', 1)
                        v = v.strip('\'"')
                        if v.startswith('re_'):
                            resend_key = v
                            results['resend_key_source'] = f"{env_file.name}:{k}"
                            break
            except Exception:
                pass

results['resend_key_found'] = bool(resend_key)
if resend_key:
    results['resend_key_prefix'] = resend_key[:8] + '...'

# 2. If Resend key found, query Resend API
msg_id = 'd14034cf-59c5-4798-895a-27513fbc2b67'
if resend_key:
    # A. Check Email details
    try:
        req = urllib.request.Request(
            f'https://api.resend.com/emails/{msg_id}',
            headers={'Authorization': f'Bearer {resend_key}', 'User-Agent': 'Thaara-Audit/1.0'}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            results['resend_email'] = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        results['resend_email_error'] = f"HTTP {e.code}: {e.read().decode('utf-8', errors='ignore')}"
    except Exception as e:
        results['resend_email_error'] = str(e)

    # B. Check domains status (to see if brandmintai.io is verified)
    try:
        req = urllib.request.Request(
            'https://api.resend.com/domains',
            headers={'Authorization': f'Bearer {resend_key}', 'User-Agent': 'Thaara-Audit/1.0'}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            results['resend_domains'] = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        results['resend_domains_error'] = f"HTTP {e.code}: {e.read().decode('utf-8', errors='ignore')}"
    except Exception as e:
        results['resend_domains_error'] = str(e)

    # C. Check api keys or webhooks if possible
    try:
        req = urllib.request.Request(
            'https://api.resend.com/webhooks',
            headers={'Authorization': f'Bearer {resend_key}', 'User-Agent': 'Thaara-Audit/1.0'}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            results['resend_webhooks'] = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        results['resend_webhooks_error'] = f"HTTP {e.code}: {e.read().decode('utf-8', errors='ignore')}"
    except Exception as e:
        results['resend_webhooks_error'] = str(e)

# 3. Check DB records in PostgreSQL
try:
    sql = """
    SELECT json_build_object(
        'callback_request', (SELECT row_to_json(c) FROM (SELECT * FROM phone_callback_requests WHERE provider_message_id = 'd14034cf-59c5-4798-895a-27513fbc2b67' OR call_id = 'e08e595066cd3788699164ee33cd9f19b3226a1012a93ddde72ac603c70aee51' LIMIT 1) c),
        'recent_deliveries', (SELECT json_agg(row_to_json(d)) FROM (SELECT * FROM notification_deliveries ORDER BY created_at DESC LIMIT 5) d)
    );
    """
    cmd = [
        'docker', 'exec', 'thaara-v2-pilot-postgres-1',
        'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-t', '-c', sql
    ]
    out = subprocess.check_output(cmd, stderr=subprocess.STDOUT)
    results['db_records'] = json.loads(out.decode('utf-8').strip())
except Exception as e:
    results['db_error'] = str(e)

# 4. Check worker logs around the send
for container in ['thaara-phone115-worker', 'thaara-phone-worker', 'thaara-v2-pilot-api-1']:
    try:
        cmd = ['docker', 'logs', '--since', '2h', container]
        out = subprocess.check_output(cmd, stderr=subprocess.STDOUT)
        lines = out.decode('utf-8', errors='ignore').splitlines()
        matching = [l for l in lines if 'd14034cf' in l or 'e08e5950' in l or 'connect@brandmintai.io' in l or 'resend' in l.lower() or 'callback' in l.lower()]
        results[f'logs_{container}'] = matching[-20:]
    except Exception as e:
        results[f'logs_err_{container}'] = str(e)

print(json.dumps(results, indent=2))
