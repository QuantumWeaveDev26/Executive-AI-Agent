import subprocess
import json

# Check if there are any files or references to resend webhook
p = subprocess.run([
    'grep', '-rnI', 'resend' , '/opt/thaara-v2-pilot-private'
], capture_output=True, text=True)
print("Grepping resend in /opt/thaara-v2-pilot-private:\n", p.stdout.strip()[:1000])

# Check nginx or traefik configurations
p2 = subprocess.run([
    'docker', 'exec', 'n8n-traefik-1', 'traefik', 'version'
], capture_output=True, text=True)
print("\nTraefik version:", p2.stdout.strip())
