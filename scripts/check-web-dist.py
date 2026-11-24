"""Check if PhoneCallMediaOptions is built in container web-dist."""
import subprocess

p = subprocess.run([
    'docker', 'exec', 'thaara-v2-pilot-api-1',
    'grep', '-l', 'Copy All', '/app/apps/web/dist/assets/index.js'
], capture_output=True, text=True)

if p.returncode == 0:
    print("Found 'Copy All' in /app/apps/web/dist/assets/index.js")
else:
    # Find asset files in web dist
    p2 = subprocess.run([
        'docker', 'exec', 'thaara-v2-pilot-api-1',
        'ls', '-la', '/app/apps/web/dist/assets'
    ], capture_output=True, text=True)
    print(p2.stdout)
