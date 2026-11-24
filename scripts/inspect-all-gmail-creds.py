import subprocess
import json
import urllib.request

p = subprocess.run([
    'docker', 'exec', 'n8n-n8n-1', 'n8n', 'export:credentials', '--all', '--decrypted'
], capture_output=True, text=True)

text = p.stdout.strip()
idx = text.find('[')
if idx != -1:
    data = json.loads(text[idx:])
    for item in data:
        if item.get('type') == 'gmailOAuth2':
            cid = item.get('id')
            cname = item.get('name')
            cdata = item.get('data', {})
            has_oauth = bool(cdata.get('oauthTokenData'))
            token_data = cdata.get('oauthTokenData', {}) if has_oauth else {}
            scope = token_data.get('scope')
            has_refresh = bool(token_data.get('refresh_token'))
            has_access = bool(token_data.get('access_token'))
            print(f"Gmail Cred: ID={cid}, Name={cname}, HasOAuth={has_oauth}, HasRefresh={has_refresh}, HasAccess={has_access}, Scope={scope}")
            
            # If access token or refresh token is available, test getting user profile
            acc_token = token_data.get('access_token')
            if acc_token:
                try:
                    req = urllib.request.Request(
                        'https://gmail.googleapis.com/gmail/v1/users/me/profile',
                        headers={'Authorization': f'Bearer {acc_token}'}
                    )
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        prof = json.loads(resp.read().decode('utf-8'))
                        print(f"  -> EmailAddress: {prof.get('emailAddress')}, TotalMessages: {prof.get('messagesTotal')}")
                except Exception as e:
                    print(f"  -> Profile call error: {e}")
