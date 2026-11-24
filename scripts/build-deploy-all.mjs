import fs from 'node:fs';
import path from 'node:path';

const wfPath = path.resolve('deploy/n8n/Sub_05_Gmail_and_Google_Drive_Operations.workflow.json');
const wfContent = fs.readFileSync(wfPath);
const wfB64 = wfContent.toString('base64');

const publishShPath = path.resolve('node_modules/.cache/google-drive/publish.sh');
const publishSh = fs.readFileSync(publishShPath, 'utf8');

const updatePy = fs.readFileSync(path.resolve('node_modules/.cache/google-drive/update-n8n-wf.py'), 'utf8');

// Note: publishSh already begins with 'set -euo pipefail', so we can run publishSh as its section
const combined = [
  'set -euo pipefail',
  'echo "=== [STAGE 1/2] UPDATING N8N WORKFLOW upU4clCyj1VvJlpk ==="',
  "cat << 'EOF_WF_B64' | base64 -d > /tmp/Sub_05_Gmail_and_Google_Drive_Operations.workflow.json",
  wfB64,
  'EOF_WF_B64',
  '',
  "python3 - << 'EOF_UPDATE_PY'",
  updatePy,
  'EOF_UPDATE_PY',
  '',
  'echo "=== [STAGE 2/2] EXECUTING THAARA API CONTAINER DEPLOYMENT ==="',
  publishSh,
  ''
].join('\n');

const outPath = path.resolve('node_modules/.cache/google-drive/deploy-all.sh');
fs.writeFileSync(outPath, combined, 'utf8');
console.log('deploy-all.sh generated successfully. Size:', combined.length);
