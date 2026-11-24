"""Inspect execution 79052 in n8n database."""
import subprocess
import json

script = """
const sqlite3 = require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY, (err) => {
  if (err) { console.error(err); process.exit(1); }
  db.get("SELECT data FROM execution_data WHERE executionId = 79052;", (err, row) => {
    if (row && row.data) {
      const parsed = JSON.parse(row.data);
      console.log("RunData nodes in 79052:", Object.keys(parsed.resultData?.runData || {}));
      
      const prepNode = parsed.resultData?.runData?.['Prepare Verification Payload'];
      if (prepNode && prepNode[0]?.data?.main?.[0]) {
        console.log("=== Prepare Verification Payload Output ===");
        console.log(JSON.stringify(prepNode[0].data.main[0], null, 2));
      }

      const verifyNode = parsed.resultData?.runData?.['Verify Consent & Claim Single Delivery'];
      if (verifyNode && verifyNode[0]?.data?.main?.[0]) {
        console.log("=== Verify Consent & Claim Single Delivery Output ===");
        console.log(JSON.stringify(verifyNode[0].data.main[0], null, 2));
      }

      const ifNode = parsed.resultData?.runData?.['Verified & Unsent?'];
      if (ifNode && ifNode[0]?.data) {
        console.log("=== Verified & Unsent? Branching ===");
        console.log("Main outputs count:", ifNode[0].data.main?.length);
        console.log("Branch 0 (true):", JSON.stringify(ifNode[0].data.main?.[0]));
        console.log("Branch 1 (false):", JSON.stringify(ifNode[0].data.main?.[1]));
      }
    } else {
      console.log("No execution_data row found for 79052");
    }
    db.close();
  });
});
"""

p = subprocess.run(['docker', 'exec', 'n8n-n8n-1', 'node', '-e', script], capture_output=True, text=True)
print(p.stdout)
if p.stderr:
    print("STDERR:\n", p.stderr)
