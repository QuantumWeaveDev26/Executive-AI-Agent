import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const stageDir = path.join(root, 'deploy/hostinger-pilot/phone-n8n-sync-release');
const tarPath = path.join(stageDir, 'publication.tar.gz');

if (!fs.existsSync(tarPath)) {
  throw new Error(`Missing ${tarPath}`);
}

const tarBase64 = fs.readFileSync(tarPath).toString('base64');
const wf1Json = fs.readFileSync(path.join(root, 'deploy/n8n/thaara-callback-email-notifications.workflow.json'), 'utf8');
const wf2Json = fs.readFileSync(path.join(root, 'deploy/n8n/thaara-sarvam-call-history-sync.workflow.json'), 'utf8');

const template = fs.readFileSync(path.join(root, 'deploy/hostinger-pilot/publish-phone-n8n-sync.py'), 'utf8');

const bundled = template
  .replace('PAYLOAD = ""  # PAYLOAD_BASE64_PLACEHOLDER', `PAYLOAD = """${tarBase64}"""`)
  .replace('WF1_JSON = "" # WF1_JSON_PLACEHOLDER', `WF1_JSON = r'''${wf1Json}'''`)
  .replace('WF2_JSON = "" # WF2_JSON_PLACEHOLDER', `WF2_JSON = r'''${wf2Json}'''`);

const bundledPath = path.join(root, 'deploy/hostinger-pilot/publish-phone-n8n-sync.bundled.py');
fs.writeFileSync(bundledPath, bundled);
console.log('Generated bundled deployment script at:', bundledPath, 'size:', bundled.length);
