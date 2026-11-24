import subprocess
import json

domains = [
    'bounces.brandmintai.io',
    'mail.brandmintai.io',
    'resend.brandmintai.io',
    'send.brandmintai.io'
]
res = {}
for d in domains:
    res[d] = {}
    for t in ['TXT', 'MX', 'CNAME']:
        p = subprocess.run(['dig', '+short', t, d], capture_output=True, text=True)
        if p.stdout.strip():
            res[d][t] = p.stdout.strip().splitlines()

print(json.dumps(res, indent=2))
