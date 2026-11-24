"""Check columns and settings of an active workflow in n8n."""
import subprocess
import json

p = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  db.get("SELECT id, name, active, triggerCount, versionId FROM workflow_entity WHERE id = 'VBfY6LE5CYFuyBHz';", (err, row) => {
    db.get("SELECT id, name, active, triggerCount, versionId FROM workflow_entity WHERE id = 'ThaarSarvamSync1';", (err2, row2) => {
      console.log(JSON.stringify({active_ref: row, our_wf: row2}));
      db.close();
    });
  });
});
"""], capture_output=True, text=True)
print(p.stdout)
