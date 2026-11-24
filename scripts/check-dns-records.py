import subprocess
import json

domains_to_check = [
    'brandmintai.io',
    '_dmarc.brandmintai.io',
    'resend._domainkey.brandmintai.io',
    'k1._domainkey.brandmintai.io',
    'k2._domainkey.brandmintai.io',
    'smtp._domainkey.brandmintai.io'
]

results = {}
for d in domains_to_check:
    results[d] = {}
    for rtype in ['TXT', 'MX', 'CNAME', 'A']:
        cmd = ['dig', '+short', rtype, d]
        p = subprocess.run(cmd, capture_output=True, text=True)
        if p.stdout.strip():
            results[d][rtype] = p.stdout.strip().splitlines()

print(json.dumps(results, indent=2))
