"""Check recent executions in n8n database."""
import subprocess
import json

p = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  db.all("SELECT id, workflowId, status, mode, startedAt, stoppedAt FROM execution_entity WHERE workflowId IN ('ThaaraCbNotif001', 'ThaarSarvamSync1') ORDER BY startedAt DESC LIMIT 10;", (err, rows) => {
    console.log(JSON.stringify(rows));
    db.close();
  });
});
"""], capture_output=True, text=True)
print(p.stdout)
