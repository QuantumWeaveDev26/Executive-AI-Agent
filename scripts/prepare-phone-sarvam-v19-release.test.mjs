import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseSarvamRuntimeProfile } from '../apps/api/dist/services/phone-sarvam-runtime.js';
import { prepareSarvamV19Release } from './prepare-phone-sarvam-v19-release.mjs';

const candidate = readFileSync('docs/integrations/phone/knowledge/runtime-v19-v21-20261108-review/runtime-profile.candidate.json');
const preview = { yielded: true, heardFullQuestion: true, answeredQuestion: true, droppedOldAnswer: true, language: 'kn-en' };
const evidence = {
  source: 'owner_voice_preview', checkedAt: '2026-11-09T06:00:00Z',
  outbound: { ...preview, version: 19, approvedPurposePreserved: true },
  inbound: { ...preview, version: 21, aiDisclosureHeard: true },
  duration: { source: 'sarvam_settings_readback', outboundVersion: 19, inboundVersion: 21, configuredSeconds: 300 },
};
const bytes = (value) => Buffer.from(JSON.stringify(value));

test('binds exact evidence to a separate deployable-format profile without modifying the review profile', () => {
  const raw = bytes(evidence);
  const result = prepareSarvamV19Release(candidate, raw);
  const profile = JSON.parse(result);
  assert.equal(profile.companyKnowledge.acceptanceEvidenceSha256, createHash('sha256').update(raw).digest('hex'));
  assert.equal(profile.verifiedMaxCallLengthMinutes, 5);
  assert.match(profile.verificationBasis, /configured/);
  assert.ok(parseSarvamRuntimeProfile(profile).profile);
  assert.ok(parseSarvamRuntimeProfile(JSON.parse(candidate)).reasons);
});

test('refuses incomplete, failed or wrong-version observations', () => {
  const invalid = [
    { ...evidence, outbound: { ...evidence.outbound, version: 18 } },
    { ...evidence, inbound: { ...evidence.inbound, yielded: false } },
    { ...evidence, outbound: { ...evidence.outbound, approvedPurposePreserved: false } },
    { ...evidence, inbound: { ...evidence.inbound, aiDisclosureHeard: false } },
    { ...evidence, duration: { ...evidence.duration, configuredSeconds: 301 } },
    { ...evidence, duration: { ...evidence.duration, outboundVersion: 2 } },
    { ...evidence, source: 'synthetic' },
    { ...evidence, recording: 'unexpected' },
    { ...evidence, checkedAt: '2026-11-09' },
  ];
  for (const receipt of invalid) {
    assert.throws(() => prepareSarvamV19Release(candidate, bytes(receipt)), /release_evidence_denied/);
  }
});

test('refuses an edited review candidate even with valid-shaped evidence', () => {
  const changed = Buffer.concat([candidate, Buffer.from('\n')]);
  assert.throws(() => prepareSarvamV19Release(changed, bytes(evidence)), /review_candidate_changed/);
});
