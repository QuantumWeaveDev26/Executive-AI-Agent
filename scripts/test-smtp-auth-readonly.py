import subprocess
import json
import smtplib
import ssl

# Read credentials from n8n container without logging password
p = subprocess.run([
    'docker', 'exec', 'n8n-n8n-1', 'n8n', 'export:credentials', '--id=G1VGVGldX32ch2xV', '--decrypted'
], capture_output=True, text=True)

text = p.stdout.strip()
idx = text.find('[')
if idx != -1:
    data = json.loads(text[idx:])
    cdata = data[0].get('data', {})
    user = cdata.get('user')
    password = cdata.get('password')
    host = cdata.get('host', 'smtp.gmail.com')
    
    print(f"Testing SMTP Auth to {host} for user: {user}...")
    
    # Test connection and auth without sending mail
    try:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, 465, context=context, timeout=10) as server:
            server.ehlo()
            code, resp = server.login(user, password)
            print(f"SMTP Auth Result: Code={code}, Response={resp.decode('utf-8', errors='ignore')}")
            server.noop()
            server.quit()
            print("SUCCESS: SMTP Credentials are valid and accepted by Google SMTP. NO MAIL WAS SENT.")
    except Exception as e:
        print(f"SMTP Auth Failed: {e}")
else:
    print("Could not retrieve credentials.")
