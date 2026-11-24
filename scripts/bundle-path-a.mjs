import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const stageDir = path.join(root, 'deploy/hostinger-pilot/phone-n8n-sync-release');
const tarPath = path.join(stageDir, 'publication.tar.gz');

if (!fs.existsSync(tarPath)) {
  throw new Error(`Missing ${tarPath}`);
}

const tarBase64 = fs.readFileSync(tarPath).toString('base64');
const template = fs.readFileSync(path.join(root, 'deploy/hostinger-pilot/publish-path-a.py'), 'utf8');

const bundled = template.replace('PAYLOAD = ""  # PAYLOAD_BASE64_PLACEHOLDER', `PAYLOAD = """${tarBase64}"""`);

const bundledPath = path.join(root, 'deploy/hostinger-pilot/publish-path-a.bundled.py');
fs.writeFileSync(bundledPath, bundled);
console.log('Generated bundled script at:', bundledPath, 'size:', bundled.length);
