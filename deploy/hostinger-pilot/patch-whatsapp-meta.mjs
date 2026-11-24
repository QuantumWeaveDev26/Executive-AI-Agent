// Step 108.28: exact-match CSP patch of the pilot's own compiled app.js (verified blob: images and audio only).
import fs from 'node:fs';
import { createHash } from 'node:crypto';
export function patchPilotCsp(source) {
  const needle = `imgSrc: ["'self'", 'data:']`;
  if (source.split(needle).length !== 2 || source.includes('mediaSrc')) throw Error('Pilot CSP patch precondition failed; no fallback rewrite');
  return source.replace(needle, () => `imgSrc: ["'self'", 'data:', 'blob:'],
                mediaSrc: ["'self'", 'blob:']`);
}
if (process.argv[2] === '--approved-image-build') {
  const app = '/app/apps/api/dist/app.js', expected = process.argv[3];
  if (createHash('sha256').update(fs.readFileSync(app)).digest('hex') !== expected) throw Error('Pilot app.js hash drift');
  const out = patchPilotCsp(fs.readFileSync(app, 'utf8'));
  if (/PhoneCallingService|PHONE_AI_CALL_ACTION/.test(out)) throw Error('Paused Phone code must not enter pilot image');
  fs.writeFileSync(app, out);
  console.log('Pilot CSP patched: blob: images and audio only');
}
