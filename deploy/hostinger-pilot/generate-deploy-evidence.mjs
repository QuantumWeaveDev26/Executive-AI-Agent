import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const tarFile = path.join(root, 'node_modules/.cache/whatsapp-appointment/publication.tar.gz');
const pyFile = path.join(root, 'deploy/hostinger-pilot/publish-whatsapp-appointment.py');
const shFile = path.join(root, 'node_modules/.cache/whatsapp-appointment/publish.sh');

const tarBuf = fs.readFileSync(tarFile);
const tarB64 = tarBuf.toString('base64');
const pyContent = fs.readFileSync(pyFile, 'utf8');

const shContent = `set -euo pipefail
python3 - <<'THAARA_WHATSAPP_PY'
OWNER_APPROVED_WHATSAPP_APPOINTMENT = True
PAYLOAD = '${tarB64}'
${pyContent}
THAARA_WHATSAPP_PY
`;

fs.writeFileSync(shFile, shContent, { encoding: 'utf8' });

const tarSha = crypto.createHash('sha256').update(tarBuf).digest('hex');
const pySha = crypto.createHash('sha256').update(fs.readFileSync(pyFile)).digest('hex');
const shSha = crypto.createHash('sha256').update(fs.readFileSync(shFile)).digest('hex');
const dfSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'deploy/hostinger-pilot/Dockerfile.whatsapp-appointment'))).digest('hex');

console.log('--- PACKAGING EVIDENCE ---');
console.log('Archive (publication.tar.gz):', tarSha);
console.log('Script (publish-whatsapp-appointment.py):', pySha);
console.log('Standalone deploy script (publish.sh):', shSha);
console.log('Dockerfile (Dockerfile.whatsapp-appointment):', dfSha);
