import urllib.request
import json

# Check Thaara API connectors/gmail status endpoint
try:
    req = urllib.request.Request(
        'http://127.0.0.1:15440/api/v1/health'
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        print("API Health:", resp.read().decode('utf-8'))
except Exception as e:
    print("Health error:", e)
