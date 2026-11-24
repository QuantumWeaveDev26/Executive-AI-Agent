"""Build and capture entire log to file."""
import subprocess

p = subprocess.run([
    'bash', '-c',
    'docker build --no-cache --network=none --pull=false --progress=plain --build-arg BASE_IMAGE=thaara-v2-base:phone-n8n-sync-rebase -t test-build -f /opt/thaara-v2-pilot/staging-phone-n8n-sync/Dockerfile /opt/thaara-v2-pilot/staging-phone-n8n-sync > /tmp/build.log 2>&1'
])
with open('/tmp/build.log', 'r') as f:
    lines = f.readlines()
print("".join(lines[-40:]))
