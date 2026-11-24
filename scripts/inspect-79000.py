"""Inspect execution data for successful run 79000."""
import subprocess
import json

script = """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  db.get("SELECT data FROM execution_data WHERE executionId = 79000;", (err, row) => {
    if (row && row.data) {
      const parsed = JSON.parse(row.data);
      console.log("RunData nodes:", Object.keys(parsed.resultData?.runData || {}));
      
      const syncNode = parsed.resultData?.runData?.['Sync Calls to Thaara Backend'];
      console.log("Sync node executed:", syncNode ? syncNode.length : 0);
      if (syncNode && syncNode[0]?.data?.main?.[0]) {
        console.log("Sync response:", JSON.stringify(syncNode[0].data.main[0].slice(0, 3)));
      }
      
      const attemptsNode = parsed.resultData?.runData?.['Fetch Inbound & Outbound Attempts'];
      if (attemptsNode && attemptsNode[0]?.data?.main?.[0]) {
        console.log("Attempts response count:", attemptsNode[0].data.main[0].length);
        console.log("Sample attempt:", JSON.stringify(attemptsNode[0].data.main[0][0]?.json));
      }
    } else {
      console.log("No data row for 79000");
    }
    db.close();
  });
});
"""

p = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', script], capture_output=True, text=True)
print(p.stdout)
if p.stderr:
    print(p.stderr)
