import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { patchPilotWhatsAppApp, patchPilotWhatsAppRegistry, patchPilotContractsIndex } from '../deploy/hostinger-pilot/patch-whatsapp-compose.mjs';
const cache = new URL('../node_modules/.cache/step10827/', import.meta.url);
// Publication acceptance uses an explicit read-only capture of the actual pilot; fresh clones report this fixture as skipped.
const captured = fs.existsSync(new URL('base-source.json', cache));
const actualBase = (part: string) => {
  const metadata = JSON.parse(fs.readFileSync(new URL('base-source.json', cache), 'utf8'));
  expect(metadata.image).toBe('sha256:85fea59e583aa761b6759fe2347b5624433fc4ea06a46361f7756e2b5bddbd4b');
  const bytes = fs.readFileSync(new URL('base-' + part + '.js', cache));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(metadata.files[part].sha256);
  return bytes.toString('utf8');
};
describe.skipIf(!captured)('phone-preserving pilot transforms against checksum-pinned actual base; offline only', () => {
  it('patches only the exact original WhatsApp registration and adds the audited upload guard', () => {
    const source = actualBase('app'), patched = patchPilotWhatsAppApp(source);
    expect(patched).toContain('createWhatsAppUploadAdmission(db, policyGateway)'); expect(patched).not.toMatch(/PhoneCallingService|PHONE_AI_CALL_ACTION/);
    expect(patched).toContain('await phoneRoutes'); expect(patched).toContain('await gmailRoutes'); expect(patched).toContain('await googleCalendarRoutes');
    expect(() => patchPilotWhatsAppApp(patched)).toThrow(); expect(() => patchPilotWhatsAppApp(source.replace('await whatsappDurableInboxRoutes(child, durableWhatsApp);', 'await whatsappDurableInboxRoutes(child, different);'))).toThrow();
  });
  it('adds explicit upload and read-only preview policies while preserving all other registry source', () => {
    const source = actualBase('registry'), patched = patchPilotWhatsAppRegistry(source);
    expect(patched).toContain("name:'whatsapp.media.preview'"); expect(patched).toContain('approvalMode:\'explicit\''); expect(patched).toContain('MetaWhatsAppAnySendInputSchema');
    expect(patched).not.toContain('PHONE_AI_CALL_ACTION'); expect(() => patchPilotWhatsAppRegistry(patched)).toThrow();
  });
  it('adds the browser/server upload export without replacing the index', () => {
    const source = "export * from './meta-whatsapp.js';\n"; expect(patchPilotContractsIndex(source)).toBe(source + "\nexport * from './whatsapp-upload.js';\n");
    expect(() => patchPilotContractsIndex(patchPilotContractsIndex(source))).toThrow();
  });
});
describe.skipIf(!captured)('patched pilot modules are valid JavaScript (parse check)', () => {
  it('app, registry and contracts index parse after patching, and injected patterns keep their $ anchors', async () => {
    const { execFileSync } = await import('node:child_process');
    const os = await import('node:os'), path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thaara-10827-parse-'));
    try {
      const outputs: Record<string, string> = { app: patchPilotWhatsAppApp(actualBase('app')), registry: patchPilotWhatsAppRegistry(actualBase('registry')), index: patchPilotContractsIndex(actualBase('index')) };
      for (const [name, source] of Object.entries(outputs)) {
        const file = path.join(dir, name + '.mjs'); fs.writeFileSync(file, source);
        expect(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })).not.toThrow();
      }
      expect(outputs.registry).toContain("pattern:'^[a-zA-Z0-9_-]{1,128}$'");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
