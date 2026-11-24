import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, 'node_modules', '.cache', 'whatsapp-appointment');
const archivePath = path.join(cache, 'publication.tar.gz');
const rawArchive = fs.readFileSync(archivePath);
const archiveB64 = rawArchive.toString('base64');

const templatePath = path.join(cache, 'check-candidate-build.sh');
let scriptContent = fs.readFileSync(templatePath, 'utf8');
scriptContent = `STAGED_ARCHIVE_B64="${archiveB64}"\n` + scriptContent;

const populatedPath = path.join(cache, 'check-candidate-build-populated.sh');
fs.writeFileSync(populatedPath, scriptContent.replace(/\r\n/g, '\n'), 'utf8');

console.log('Populated candidate build check script. Ready to run via remote-whatsapp.ps1');
