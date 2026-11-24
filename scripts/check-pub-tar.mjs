import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const stageDir = path.join(root, 'deploy/hostinger-pilot/phone-n8n-sync-release');
const tarPath = path.join(stageDir, 'publication.tar.gz');

if (!fs.existsSync(tarPath)) {
  throw new Error(`Missing ${tarPath}`);
}

const tarBase64 = fs.readFileSync(tarPath).toString('base64');
const tarSha = '4da8338ff1c91f11a92ba0187c85213878573f30e61fde507c81b62d73648342';

console.log('Publication tar size:', tarBase64.length, 'sha:', tarSha);
