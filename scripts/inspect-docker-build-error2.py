"""Rerun docker build with plain progress."""
import subprocess

p = subprocess.run([
    'docker', 'build', '--no-cache', '--network=none', '--pull=false',
    '--progress=plain',
    '--build-arg', 'BASE_IMAGE=thaara-v2-base:phone-n8n-sync-rebase',
    '-t', 'test-build',
    '-f', '/opt/thaara-v2-pilot/staging-phone-n8n-sync/Dockerfile',
    '/opt/thaara-v2-pilot/staging-phone-n8n-sync'
], capture_output=True, text=True)
print("STDERR:\n", p.stderr[-4000:])
