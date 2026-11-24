"""Inspect standing worker delivery logs and audit events."""
import subprocess

p = subprocess.run([
    'docker', 'logs', '--tail', '50', 'thaara-phone115-worker'
], capture_output=True, text=True)
print("=== Phone 115 Worker Docker Logs ===")
print(p.stdout.strip() if p.stdout.strip() else p.stderr.strip())

p2 = subprocess.run([
    'docker', 'exec', '--user', 'postgres', 'thaara-v2-pilot-postgres-1',
    'psql', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-q', '-t', '-A', '-c',
    "SELECT action, target_type, target_id, payload, created_at FROM public.audit_events WHERE created_at >= '2026-11-18 06:00:00+00' ORDER BY created_at DESC LIMIT 10;"
], capture_output=True, text=True)
print("\n=== Audit Events after 06:00 UTC ===")
print(p2.stdout.strip())
