import subprocess
import json
import urllib.request

p = subprocess.run([
    'docker', 'exec', 'n8n-n8n-1', 'n8n', 'export:credentials', '--id=jtLOWVgBKhDXKrUH', '--decrypted'
], capture_output=True, text=True)

text = p.stdout.strip()
idx = text.find('[')
if idx != -1:
    data = json.loads(text[idx:])
    cdata = data[0].get('data', {})
    oauth = cdata.get('oauthTokenData', {})
    
    print("OAuth Scopes:", oauth.get('scope'))
    print("Expires at / in:", oauth.get('expiry_date') or oauth.get('expires_in'))
    
    # Check profile with access token (without logging token)
    token = oauth.get('access_token')
    if token:
        try:
            req = urllib.request.Request(
                'https://gmail.googleapis.com/gmail/v1/users/me/profile',
                headers={'Authorization': f'Bearer {token}'}
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                profile = json.loads(resp.read().decode('utf-8'))
                print("Gmail Profile:\n", json.dumps(profile, indent=2))
        except Exception as e:
            print("Error getting profile:", e)
            
        try:
            req2 = urllib.request.Request(
                'https://gmail.googleapis.com/gmail/v1/users/me/sendAs',
                headers={'Authorization': f'Bearer {token}'}
            )
            with urllib.request.urlopen(req2, timeout=10) as resp:
                send_as = json.loads(resp.read().decode('utf-8'))
                print("SendAs Aliases:\n", json.dumps(send_as, indent=2))
        except Exception as e:
            print("Error getting sendAs aliases:", e)
else:
    print("No credential data found.")
