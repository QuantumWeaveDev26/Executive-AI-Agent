import subprocess
import json

domains = [
    'brandmintai.io',
    'send.brandmintai.io',
    'resend._domainkey.brandmintai.io',
    'resend._domainkey.send.brandmintai.io',
    '_dmarc.brandmintai.io',
    '_dmarc.send.brandmintai.io',
    'bounces.brandmintai.io',
    'bounces.send.brandmintai.io'
]

dns_info = {}
for d in domains:
    dns_info[d] = {}
    for rtype in ['TXT', 'MX', 'CNAME', 'A']:
        cmd = ['dig', '+short', rtype, d]
        p = subprocess.run(cmd, capture_output=True, text=True)
        lines = [l.strip() for l in p.stdout.strip().splitlines() if l.strip()]
        if lines:
            dns_info[d][rtype] = lines

print(json.dumps(dns_info, indent=2))
