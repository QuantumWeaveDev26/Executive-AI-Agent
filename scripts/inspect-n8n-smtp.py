import subprocess
import json

# Check credentials in n8n SQLite DB (redacting password)
node_cmd = """
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite');
db.all("SELECT id, name, type, createdAt, updatedAt FROM credentials_entity WHERE type = 'smtp' OR id = 'G1VGVGldX32ch2xV';", [], (err, rows) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(JSON.stringify(rows, null, 2));
});
"""

p = subprocess.run([
    'docker', 'exec', 'n8n-n8n-1', 'node', '-e', node_cmd
], capture_output=True, text=True)

print("Credential entities:\n", p.stdout.strip())
