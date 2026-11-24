import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(process.cwd(), '../..');

describe('Google Drive Final Deployment Preparation Verification', () => {
  it('1. verifies release manifest pins all 24 reconciled artifacts onto Phone Step 115 baseline', () => {
    const manifestPath = path.join(ROOT, 'deploy/hostinger-pilot/google-drive-release-manifest.json');
    const release = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    expect(release.owner_approval_gate).toContain('CLOSED');
    expect(release.expected_live_base_image).toBe(
      'sha256:352cc60a6b5c89bacde094c8bb8ce9060e94009d86816010d050e759ae1ca02d'
    );
    expect(release.target_n8n_workflow_id).toBe('upU4clCyj1VvJlpk');
    expect(release.internal_webhook_url).toBe('http://n8n-n8n-1:5678/webhook/sub-gmail-operations');
    expect(release.manifest_file_count).toBe(24);

    const paths = new Set(release.manifest.map((m: { Path: string }) => m.Path));
    expect(paths.has('Dockerfile')).toBe(true);
    expect(paths.has('pilot-start/pilot-start.mjs')).toBe(true);
    expect(paths.has('contracts/google-drive.js')).toBe(true);
    expect(paths.has('policy/registry.js')).toBe(true);
    expect(paths.has('api-app/app.js')).toBe(true);
    expect(paths.has('api-routes/google-drive.js')).toBe(true);
    expect(paths.has('api-routes/conversations.js')).toBe(true);
    expect(paths.has('api-services/google-drive.js')).toBe(true);
    expect(paths.has('api-services/chat-google-drive-assistant.js')).toBe(true);
    expect(paths.has('n8n/Sub_05_Gmail_and_Google_Drive_Operations.workflow.json')).toBe(true);
    expect(paths.has('web-dist/index.html')).toBe(true);
    expect([...paths].some((p) => String(p).startsWith('web-dist/assets/index-') && String(p).endsWith('.js'))).toBe(
      true
    );
  });

  it('2. verifies Dockerfile.google-drive preserves Phone Step 115 runtime/routes and enforces build-time smoke checks', () => {
    const dockerfilePath = path.join(ROOT, 'deploy/hostinger-pilot/Dockerfile.google-drive');
    const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'deploy/hostinger-pilot/google-drive-release-manifest.json'), 'utf8')
    );

    const normalizedSha = crypto.createHash('sha256').update(dockerfile.replace(/\r\n/g, '\n')).digest('hex');
    expect(normalizedSha).toBe(manifest.dockerfile_sha256);

    expect(dockerfile).toContain(
      'ARG BASE_IMAGE=sha256:352cc60a6b5c89bacde094c8bb8ce9060e94009d86816010d050e759ae1ca02d'
    );
    expect(dockerfile).not.toMatch(/^ENV\s+N8N_/m);
    expect(dockerfile).toContain("pcfg.pilotEnvironment");
    expect(dockerfile).toContain('COPY --chown=1000:1000 pilot-start/pilot-start.mjs /app/apps/api/pilot-start.mjs');
    expect(dockerfile).toContain('COPY --chown=1000:1000 policy/ /app/packages/policy/dist/');
    expect(dockerfile).toContain('COPY --chown=1000:1000 web-dist/ /app/apps/web/dist/');
    expect(dockerfile).toContain('./phone-callback-owner-runtime.mjs');
    expect(dockerfile).toContain('./phone-callback-owner-admission.mjs');
    expect(dockerfile).toContain("webJs.includes('/integrations/drive')");
    expect(dockerfile).toContain("webJs.includes('drive-verify-btn')");
  });

  it('3. verifies publish-google-drive-final.py keeps approval gate CLOSED, guards Phone Step 115 peers, and includes Sub 05 backup/rollback', () => {
    const pubPyPath = path.join(ROOT, 'deploy/hostinger-pilot/publish-google-drive-final.py');
    const pubPy = fs.readFileSync(pubPyPath, 'utf8');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'deploy/hostinger-pilot/google-drive-release-manifest.json'), 'utf8')
    );

    expect(pubPy).toContain('OWNER_APPROVED_GOOGLE_DRIVE = False');
    expect(pubPy).toContain(
      "EXPECTED_BASE_IMAGE = 'sha256:352cc60a6b5c89bacde094c8bb8ce9060e94009d86816010d050e759ae1ca02d'"
    );
    expect(pubPy).toContain(`ARCHIVE_SHA = '${manifest.publication_archive_sha256}'`);
    expect(pubPy).toContain('thaara-phone115-receiver');
    expect(pubPy).toContain('--output=');
    expect(pubPy).toContain('pg_dump');
    expect(pubPy).toContain('backup_and_update_sub05');
    expect(pubPy).toContain('rollback_sub05');
    expect(pubPy).toContain('/tmp/thaara-deploy.lock');
  });

  it('4. verifies compiled web bundle contains GoogleDriveScreen, Phone Step 115 callback UI, and safe link attributes', () => {
    const assetsDir = path.join(ROOT, 'apps/web/dist/assets');
    const jsFile = fs.readdirSync(assetsDir).find((f) => f.endsWith('.js'));
    expect(jsFile).toBeTruthy();

    const bundle = fs.readFileSync(path.join(assetsDir, jsFile!), 'utf8');
    expect(bundle).toContain('/integrations/drive');
    expect(bundle).toContain('drive-verify-btn');
    expect(bundle).toContain('/integrations/phone/inbound');
    expect(bundle).toContain('UNTRUSTED EXTERNAL DOCUMENT PREVIEW');
    expect(bundle).toContain('noopener noreferrer');
  });
});
