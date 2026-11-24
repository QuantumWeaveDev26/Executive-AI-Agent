import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const root = process.cwd();
const stageDir = path.join(root, 'node_modules/.cache/whatsapp-appointment/publication');

if (fs.existsSync(stageDir)) {
  fs.rmSync(stageDir, { recursive: true, force: true });
}
fs.mkdirSync(stageDir, { recursive: true });

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

// 1. Contracts
copyFile(
  path.join(root, 'packages/contracts/dist/whatsapp-n8n.js'),
  path.join(stageDir, 'contracts/whatsapp-n8n.js')
);
copyFile(
  path.join(root, 'packages/contracts/dist/whatsapp-n8n.d.ts'),
  path.join(stageDir, 'contracts/whatsapp-n8n.d.ts')
);

// 2. API Services
for (const f of [
  'whatsapp-enquiries.js',
  'whatsapp-enquiries.d.ts',
  'whatsapp-durable.js',
  'whatsapp-durable.d.ts',
  'chat-whatsapp-assistant.js',
  'chat-whatsapp-assistant.d.ts'
]) {
  copyFile(
    path.join(root, 'apps/api/dist/services', f),
    path.join(stageDir, 'api-services', f)
  );
}

// 3. API Routes
for (const f of [
  'whatsapp-inbox.js',
  'whatsapp-inbox.d.ts'
]) {
  copyFile(
    path.join(root, 'apps/api/dist/routes', f),
    path.join(stageDir, 'api-routes', f)
  );
}

// 4. Web Dist
copyDir(
  path.join(root, 'apps/web/dist'),
  path.join(stageDir, 'web-dist')
);

// 5. Dockerfile
copyFile(
  path.join(root, 'deploy/hostinger-pilot/Dockerfile.whatsapp-appointment'),
  path.join(stageDir, 'Dockerfile')
);

// Compute manifest
function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function collectManifest(dir, base = '') {
  let list = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      list = list.concat(collectManifest(full, rel));
    } else {
      list.push({
        Path: rel.replace(/\\/g, '/'),
        SHA256: sha256File(full)
      });
    }
  }
  return list;
}

const manifest = collectManifest(stageDir);
fs.writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');

// Create tar.gz using bsdtar
const tarFile = path.join(root, 'node_modules/.cache/whatsapp-appointment/publication.tar.gz');
if (fs.existsSync(tarFile)) {
  fs.unlinkSync(tarFile);
}

const items = fs.readdirSync(stageDir).join(' ');
execSync(`tar.exe -czf "${tarFile}" ${items}`, { cwd: stageDir });

const archiveSha = sha256File(tarFile);
const dockerfileSha = sha256File(path.join(root, 'deploy/hostinger-pilot/Dockerfile.whatsapp-appointment'));

console.log('Staging completed successfully!');
console.log('Archive SHA256:', archiveSha);
console.log('Dockerfile SHA256:', dockerfileSha);
