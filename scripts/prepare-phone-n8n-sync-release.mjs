import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const root = process.cwd();
const stageDir = path.join(root, 'deploy/hostinger-pilot/phone-n8n-sync-release');

if (fs.existsSync(stageDir)) {
  fs.rmSync(stageDir, { recursive: true, force: true });
}
fs.mkdirSync(stageDir, { recursive: true });

// 1. Copy Dockerfile
fs.copyFileSync(
  path.join(root, 'deploy/hostinger-pilot/Dockerfile.phone-n8n-sync'),
  path.join(stageDir, 'Dockerfile')
);

// 2. Copy pilot-start.mjs
fs.copyFileSync(
  path.join(root, 'deploy/hostinger-pilot/pilot-start.mjs'),
  path.join(stageDir, 'pilot-start.mjs')
);

// 2b. Copy smoke-check.mjs
fs.copyFileSync(
  path.join(root, 'deploy/hostinger-pilot/smoke-check.mjs'),
  path.join(stageDir, 'smoke-check.mjs')
);

// 3. Copy contracts
fs.cpSync(
  path.join(root, 'packages/contracts/dist'),
  path.join(stageDir, 'contracts'),
  { recursive: true }
);

// 4. Copy policy
fs.cpSync(
  path.join(root, 'packages/policy/dist'),
  path.join(stageDir, 'policy'),
  { recursive: true }
);

// 5. Copy api-services
fs.cpSync(
  path.join(root, 'apps/api/dist/services'),
  path.join(stageDir, 'api-services'),
  { recursive: true }
);

// 6. Copy api-routes
fs.cpSync(
  path.join(root, 'apps/api/dist/routes'),
  path.join(stageDir, 'api-routes'),
  { recursive: true }
);

// 7. Copy api-app
fs.mkdirSync(path.join(stageDir, 'api-app'), { recursive: true });
fs.copyFileSync(
  path.join(root, 'apps/api/dist/app.js'),
  path.join(stageDir, 'api-app/app.js')
);
fs.copyFileSync(
  path.join(root, 'apps/api/dist/app.d.ts'),
  path.join(stageDir, 'api-app/app.d.ts')
);

// 7b. Copy api-knowledge
fs.cpSync(
  path.join(root, 'apps/api/dist/knowledge'),
  path.join(stageDir, 'api-knowledge'),
  { recursive: true }
);

// 8. Copy web-dist
fs.cpSync(
  path.join(root, 'apps/web/dist'),
  path.join(stageDir, 'web-dist'),
  { recursive: true }
);

console.log('Staged release files in:', stageDir);

// Build publication.tar.gz using tar (available via git/windows)
const tarGzPath = path.join(stageDir, 'publication.tar.gz');
execSync(`tar -czf publication.tar.gz -C "${stageDir}" Dockerfile pilot-start.mjs smoke-check.mjs contracts policy api-services api-routes api-app api-knowledge web-dist`, {
  cwd: stageDir,
  stdio: 'inherit'
});

const tarBytes = fs.readFileSync(tarGzPath);
const tarSha = crypto.createHash('sha256').update(tarBytes).digest('hex');
console.log('Built publication.tar.gz: size =', tarBytes.length, 'sha256 =', tarSha);

// Write manifest
const manifest = {
  name: 'thaara-v2-phone-n8n-sync',
  version: 'r1',
  createdAt: new Date().toISOString(),
  baseImage: 'sha256:6f18f77eccaf224a0279c89d69b196e9670d6161e6e4465683f0781e9f99e195',
  baseImageTag: 'thaara-v2-pilot-api:chat-voice-r7-bulk-sim-r1',
  archiveSha256: tarSha,
  archiveSizeBytes: tarBytes.length
};
fs.writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Manifest:', manifest);
