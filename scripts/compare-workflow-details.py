"""Compare all columns of tjg7UEMxVdy2IF0y and ThaarSarvamSync1."""
import subprocess
import json

p = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  db.get("SELECT * FROM workflow_entity WHERE id = 'tjg7UEMxVdy2IF0y';", (err, row1) => {
    db.get("SELECT * FROM workflow_entity WHERE id = 'ThaarSarvamSync1';", (err2, row2) => {
      db.all("SELECT * FROM shared_workflow WHERE workflowId IN ('tjg7UEMxVdy2IF0y', 'ThaarSarvamSync1');", (err3, shared) => {
        console.log(JSON.stringify({
          active_ref: row1 ? { id: row1.id, name: row1.name, active: row1.active, triggerCount: row1.triggerCount, settings: row1.settings } : null,
          our_wf: row2 ? { id: row2.id, name: row2.name, active: row2.active, triggerCount: row2.triggerCount, settings: row2.settings } : null,
          shared: shared
        }));
        db.close();
      });
    });
  });
});
"""], capture_output=True, text=True)
print(p.stdout)
