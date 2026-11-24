"""Grep for PhoneCallMediaOptions features in index bundle."""
import subprocess

p = subprocess.run([
    'docker', 'exec', 'thaara-v2-pilot-api-1',
    'grep', '-o', 'Copy All', '/app/apps/web/dist/assets/index-Dw7huqnA.js'
], capture_output=True, text=True)
print("Copy All count:", len(p.stdout.strip().split('\n')) if p.stdout.strip() else 0)

p2 = subprocess.run([
    'docker', 'exec', 'thaara-v2-pilot-api-1',
    'grep', '-o', 'Recording Unavailable', '/app/apps/web/dist/assets/index-Dw7huqnA.js'
], capture_output=True, text=True)
print("Recording Unavailable count:", len(p2.stdout.strip().split('\n')) if p2.stdout.strip() else 0)
