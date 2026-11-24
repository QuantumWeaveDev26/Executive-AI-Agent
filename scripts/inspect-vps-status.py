"""Inspect docker containers, n8n volumes, and run checks directly."""
import subprocess
import json
import sqlite3
import glob

print("=== Docker Containers ===")
p_ps = subprocess.run(['docker', 'ps', '--format', '{{.Names}}\t{{.Status}}\t{{.Image}}'], capture_output=True, text=True)
print(p_ps.stdout)

print("\n=== Inspect n8n Mounts ===")
p_insp = subprocess.run(['docker', 'inspect', 'n8n-n8n-1'], capture_output=True, text=True)
if p_insp.returncode == 0:
    data = json.loads(p_insp.stdout)[0]
    mounts = data.get('Mounts', [])
    for m in mounts:
        print(f"Mount: {m.get('Source')} -> {m.get('Destination')}")

print("\n=== Check n8n logs (last 30 lines) ===")
p_logs = subprocess.run(['docker', 'logs', '--tail', '30', 'n8n-n8n-1'], capture_output=True, text=True)
print(p_logs.stdout)
if p_logs.stderr:
    print("Stderr:\n", p_logs.stderr)

print("\n=== Inspect Thaara DB container name and inspect job_runs ===")
p_dbs = subprocess.run(['docker', 'ps', '--filter', 'name=db', '--format', '{{.Names}}'], capture_output=True, text=True)
print("DB containers:", p_dbs.stdout.strip())
