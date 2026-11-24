import subprocess
import os

# Search for any string starting with re_ in /opt or /root or /etc or /var/log
p = subprocess.run(
    ['grep', '-roE', 're_[A-Za-z0-9_-]{20,}', '/opt', '/root', '/etc'],
    capture_output=True, text=True
)
print("Found keys:")
for line in p.stdout.splitlines():
    file_path, key = line.split(':', 1)
    print(f"File: {file_path}, prefix: {key[:8]}... len: {len(key)}")

# Check if there are any resend webhook logs or nginx/traefik logs
p_traefik = subprocess.run(
    ['docker', 'logs', '--since', '24h', 'n8n-traefik-1'],
    capture_output=True, text=True
)
resend_traefik = [l for l in p_traefik.stdout.splitlines() if 'resend' in l.lower()]
print("\nTraefik logs matching resend:", len(resend_traefik))

p_api = subprocess.run(
    ['docker', 'logs', '--since', '24h', 'thaara-v2-pilot-api-1'],
    capture_output=True, text=True
)
resend_api = [l for l in p_api.stdout.splitlines() if 'resend' in l.lower() or 'webhook' in l.lower()]
print("\nAPI logs matching resend/webhook:", len(resend_api))
