"""Inspect execution error in n8n for latest executions."""
import subprocess
import json

p = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  db.all("SELECT id, workflowId, status, startedAt FROM execution_entity WHERE workflowId IN ('ThaaraCbNotif001', 'ThaarSarvamSync1') ORDER BY startedAt DESC LIMIT 2;", (err, rows) => {
    console.log("Recent executions:", rows);
    if (!rows || rows.length === 0) { db.close(); return; }
    
    const ids = rows.map(r => r.id);
    db.all(`SELECT executionId, data FROM execution_data WHERE executionId IN (${ids.join(',')});`, (err, dataRows) => {
      for (const d of (dataRows || [])) {
        try {
          const parsed = JSON.parse(d.data);
          console.log(`=== Execution ${d.executionId} Keys ===`, Object.keys(parsed));
          if (parsed.resultData) {
            console.log("resultData keys:", Object.keys(parsed.resultData));
            console.log("resultData snippet:", JSON.stringify(parsed.resultData).slice(0, 1000));
          } else {
            console.log("data snippet:", JSON.stringify(parsed).slice(0, 1000));
          }
        } catch (e) {
          console.log(`Execution ${d.executionId} parse error:`, e.message);
        }
      }
      db.close();
    });
  });
});
"""], capture_output=True, text=True)
print(p.stdout)
if p.stderr:
    print(p.stderr)
