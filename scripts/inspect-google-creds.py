import sqlite3
import json
import os
import re
import subprocess
from pathlib import Path

print("=== N8N & GOOGLE CREDENTIALS DEEP INSPECTION ===")

# 1. Check running containers
try:
    res = subprocess.run(["docker", "ps", "--format", "{{.Names}} \t {{.Image}}"], capture_output=True, text=True)
    print("Containers running:")
    print(res.stdout.strip())
except Exception as e:
    print(f"Error checking containers: {e}")

db_path = "/var/lib/docker/volumes/n8n_data/_data/database.sqlite"
config_path = "/var/lib/docker/volumes/n8n_data/_data/config"

if not os.path.exists(db_path):
    print(f"ERROR: DB path {db_path} does not exist!")
    exit(1)

conn = sqlite3.connect(db_path)
cur = conn.cursor()

# 2. Check credentials_entity schema and rows
cur.execute("PRAGMA table_info(credentials_entity)")
cols = [c[1] for c in cur.fetchall()]
print(f"\ncredentials_entity columns: {cols}")

cur.execute("SELECT id, name, type, createdAt, updatedAt FROM credentials_entity")
all_creds = cur.fetchall()
print(f"\nAll credentials in n8n ({len(all_creds)} total):")
for c in all_creds:
    print(f"  - [{c[0]}] '{c[1]}' (type: {c[2]}), updated: {c[4]}")

# 3. Find Gmail and Google Drive credentials specifically
cur.execute("SELECT id, name, type, data FROM credentials_entity WHERE type LIKE '%gmail%' OR type LIKE '%google%'")
google_creds = cur.fetchall()
print(f"\nGoogle credentials found: {len(google_creds)}")

# 4. Read n8n encryption key
enc_key = None
if os.path.exists(config_path):
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
            enc_key = cfg.get("encryptionKey")
            print(f"Found encryptionKey in {config_path}: length {len(enc_key) if enc_key else 0}")
    except Exception as e:
        print(f"Could not read config file: {e}")

# If not in file, check n8n container env
n8n_container = None
ps_res = subprocess.run(["docker", "ps", "--format", "{{.Names}}"], capture_output=True, text=True)
for cname in ps_res.stdout.splitlines():
    if "n8n" in cname.lower():
        n8n_container = cname.strip()
        break

print(f"Target n8n container: {n8n_container}")

if not enc_key and n8n_container:
    inspect_res = subprocess.run(["docker", "inspect", n8n_container, "--format", "{{range .Config.Env}}{{println .}}{{end}}"], capture_output=True, text=True)
    for line in inspect_res.stdout.splitlines():
        if line.startswith("N8N_ENCRYPTION_KEY="):
            enc_key = line.split("=", 1)[1].strip()
            print("Found N8N_ENCRYPTION_KEY from container environment")
            break

# 5. Decrypt credentials using Node.js inside n8n container or via direct script
for cid, cname, ctype, cdata in google_creds:
    print(f"\n--- Analyzing Credential: [{cid}] '{cname}' ({ctype}) ---")
    if n8n_container:
        # Use node inside n8n container to decrypt safely
        # n8n has internal credential decryption logic or we can run node with crypto
        node_script = f"""
const fs = require('fs');
const path = require('path');
try {{
    // Check if n8n modules are available
    let key = process.env.N8N_ENCRYPTION_KEY;
    if (!key) {{
        const cfgPath = '/home/node/.n8n/config';
        if (fs.existsSync(cfgPath)) {{
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            key = cfg.encryptionKey;
        }}
    }}
    
    // Attempt decryption using n8n Cipher or standard crypto
    const rawData = {json.dumps(cdata)};
    
    // Print safe metadata only: client_id, scopes, email, user, but NEVER secrets or tokens
    // We will test if rawData is plaintext or ciphertext
    if (rawData.startsWith('{{') || rawData.startsWith('[')) {{
        const parsed = JSON.parse(rawData);
        console.log(JSON.stringify({{
            clientId: parsed.clientId || parsed.client_id || (parsed.oauthTokenData && parsed.oauthTokenData.clientId),
            scope: parsed.scope || parsed.scopes,
            user: parsed.user || parsed.email || (parsed.oauthTokenData && parsed.oauthTokenData.email)
        }}));
    }} else {{
        // n8n encrypted data format is typically ciphertext:iv or similar
        // Let's use n8n's internal decrypt if available
        try {{
            // In n8n v1+, credentials are decrypted using Cipher
            const {{ Cipher }} = require('@n8n/core') || require('n8n-core');
            if (Cipher) {{
                const cipher = new Cipher(key);
                const decrypted = cipher.decrypt(rawData);
                const parsed = JSON.parse(decrypted);
                const safe = {{
                    clientId: parsed.clientId || parsed.client_id || (parsed.oauthTokenData && parsed.oauthTokenData.client_id),
                    scope: parsed.scope || parsed.scopes,
                    authEmail: parsed.email || (parsed.oauthTokenData && (parsed.oauthTokenData.email || parsed.oauthTokenData.userEmail)),
                    hasRefreshToken: !!parsed.oauthTokenData?.refresh_token,
                    tokenExpiry: parsed.oauthTokenData?.expires_at || parsed.oauthTokenData?.expiry_date
                }};
                console.log("SAFE_DECRYPTED:" + JSON.stringify(safe));
            }}
        }} catch (decErr) {{
            console.log("DEC_ERR:" + decErr.message);
        }}
    }}
}} catch (err) {{
    console.log("NODE_ERR:" + err.message);
}}
"""
        res = subprocess.run(["docker", "exec", "-i", n8n_container, "node", "-e", node_script], capture_output=True, text=True)
        print("Node decryption probe output:")
        print(res.stdout.strip())
        if res.stderr.strip():
            print("Node stderr:", res.stderr.strip())

# 6. Check workflow upU4clCyj1VvJlpk node configurations
print("\n=== WORKFLOW upU4clCyj1VvJlpk CREDENTIAL REFERENCES ===")
cur.execute("SELECT nodes FROM workflow_entity WHERE id='upU4clCyj1VvJlpk'")
wf_row = cur.fetchone()
if wf_row:
    nodes = json.loads(wf_row[0]) if isinstance(wf_row[0], str) else wf_row[0]
    for n in nodes:
        creds = n.get("credentials")
        if creds:
            print(f"Node '{n.get('name')}' ({n.get('type')}) uses credentials: {json.dumps(creds)}")

# 7. Check recent execution_data for Gmail & Google Drive to find authenticated user email
print("\n=== INSPECTING RECENT EXECUTION DATA FOR SENDER / USER EMAIL ===")
cur.execute("""
    SELECT id, finished, mode, retryOf, retrySuccessId, status 
    FROM execution_entity 
    WHERE workflowId = 'upU4clCyj1VvJlpk' 
    ORDER BY id DESC LIMIT 10
""")
recent_execs = cur.fetchall()
for r in recent_execs:
    print(f"Execution {r[0]}: status={r[5]}, finished={r[1]}")

# Look inside execution_data for any email strings (team.quantumweaveai@gmail.com, etc.)
cur.execute("""
    SELECT executionId, data 
    FROM execution_data 
    WHERE executionId IN (
        SELECT id FROM execution_entity WHERE workflowId = 'upU4clCyj1VvJlpk' ORDER BY id DESC LIMIT 5
    )
""")
for exec_id, edata in cur.fetchall():
    if not edata:
        continue
    # Search for email patterns safely
    emails = set(re.findall(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+', str(edata)))
    # Search for googleusercontent or client_id patterns
    client_ids = set(re.findall(r'\d+-[a-zA-Z0-9_]+\.apps\.googleusercontent\.com', str(edata)))
    print(f"Execution {exec_id} data snippet:")
    print(f"  Emails found: {list(emails)[:5]}")
    if client_ids:
        print(f"  Client IDs found: {list(client_ids)}")

conn.close()
print("\n=== INSPECTION SCRIPT FINISHED ===")
