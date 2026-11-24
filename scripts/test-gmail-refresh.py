import subprocess
import json
import urllib.request
import urllib.parse

p = subprocess.run([
    'docker', 'exec', 'n8n-n8n-1', 'n8n', 'export:credentials', '--all', '--decrypted'
], capture_output=True, text=True)

text = p.stdout.strip()
idx = text.find('[')
if idx != -1:
    data = json.loads(text[idx:])
    for item in data:
        cid = item.get('id')
        cname = item.get('name')
        if cid in ['XmHYwmapfhSF94WA', 'VNE8c5XfExHEBeaY', 'tAvpIQQ4DKM5g6sj', 'jtLOWVgBKhDXKrUH']:
            cdata = item.get('data', {})
            client_id = cdata.get('clientId')
            client_secret = cdata.get('clientSecret')
            oauth = cdata.get('oauthTokenData', {})
            refresh_token = oauth.get('refresh_token')
            
            print(f"\nChecking credential {cid} ({cname}):")
            print(f"  client_id prefix: {client_id[:12] if client_id else 'None'}")
            print(f"  has_refresh_token: {bool(refresh_token)}")
            
            if refresh_token and client_id and client_secret:
                try:
                    # Request new access token using refresh_token
                    params = urllib.parse.urlencode({
                        'client_id': client_id,
                        'client_secret': client_secret,
                        'refresh_token': refresh_token,
                        'grant_type': 'refresh_token'
                    }).encode('utf-8')
                    
                    req = urllib.request.Request('https://oauth2.googleapis.com/token', data=params, method='POST')
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        tok_data = json.loads(resp.read().decode('utf-8'))
                        new_access = tok_data.get('access_token')
                        
                    # Now query users/me/profile
                    req_prof = urllib.request.Request(
                        'https://gmail.googleapis.com/gmail/v1/users/me/profile',
                        headers={'Authorization': f'Bearer {new_access}'}
                    )
                    with urllib.request.urlopen(req_prof, timeout=10) as resp:
                        prof = json.loads(resp.read().decode('utf-8'))
                        print(f"  -> SUCCESS! Authenticated Email: {prof.get('emailAddress')}")
                        
                    # Check send-as aliases
                    req_sendas = urllib.request.Request(
                        'https://gmail.googleapis.com/gmail/v1/users/me/sendAs',
                        headers={'Authorization': f'Bearer {new_access}'}
                    )
                    with urllib.request.urlopen(req_sendas, timeout=10) as resp:
                        sendas_list = json.loads(resp.read().decode('utf-8')).get('sendAs', [])
                        print("  -> SendAs Aliases:", [s.get('sendAsEmail') for s in sendas_list])
                except urllib.error.HTTPError as e:
                    print(f"  -> HTTP Error: {e.code} - {e.read().decode('utf-8', errors='ignore')}")
                except Exception as e:
                    print(f"  -> Error: {e}")
