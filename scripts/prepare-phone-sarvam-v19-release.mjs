import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSarvamRuntimeProfile } from '../apps/api/dist/services/phone-sarvam-runtime.js';

const reviewPath = new URL('../docs/integrations/phone/knowledge/runtime-v19-v21-20261108-review/runtime-profile.candidate.json', import.meta.url);
const outputPath = new URL('../node_modules/.cache/phone-sarvam-v19-profile.review.json', import.meta.url);
const candidateHash = '356817ecbc08500d9d73943eb988caa5b4d3490eee3fb070426a5036cc657a3e';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const listeningChecks = ['yielded', 'heardFullQuestion', 'answeredQuestion', 'droppedOldAnswer'];

function passedPreview(value, version, additionalCheck) {
  return exactKeys(value, ['version', 'language', additionalCheck, ...listeningChecks]) &&
    value.version === version && ['en-IN', 'kn-IN', 'kn-en'].includes(value.language) &&
    [...listeningChecks, additionalCheck].every((check) => value[check] === true);
}

export function prepareSarvamV19Release(candidateBytes, evidenceBytes) {
  if (hash(candidateBytes) !== candidateHash) throw new Error('review_candidate_changed');
  if (evidenceBytes.length === 0 || evidenceBytes.length > 8192) throw new Error('release_evidence_denied');
  const evidence = JSON.parse(evidenceBytes);
  if (!exactKeys(evidence, ['source', 'checkedAt', 'outbound', 'inbound', 'duration']) ||
      evidence.source !== 'owner_voice_preview' ||
      typeof evidence.checkedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(evidence.checkedAt) ||
      !Number.isFinite(Date.parse(evidence.checkedAt)) ||
      !passedPreview(evidence.outbound, 19, 'approvedPurposePreserved') ||
      !passedPreview(evidence.inbound, 21, 'aiDisclosureHeard') ||
      !exactKeys(evidence.duration, ['source', 'outboundVersion', 'inboundVersion', 'configuredSeconds']) ||
      evidence.duration.source !== 'sarvam_settings_readback' || evidence.duration.outboundVersion !== 19 ||
      evidence.duration.inboundVersion !== 21 || evidence.duration.configuredSeconds !== 300) {
    throw new Error('release_evidence_denied');
  }
  const candidate = JSON.parse(candidateBytes);
  const profile = {
    ...candidate,
    reviewOnly: false,
    runtimeProfile: true,
    verifiedMaxCallLengthMinutes: 5,
    verificationBasis: 'Owner Voice previews on v19 and v21 and Sarvam readback of the configured five-minute cap. Telephone interruption and timed hang-up remain separate live checks.',
    companyKnowledge: {
      ...candidate.companyKnowledge,
      reviewOnly: false,
      providerAcceptanceVerified: true,
      acceptanceEvidenceSha256: hash(evidenceBytes),
    },
  };
  if (!parseSarvamRuntimeProfile(profile).profile) throw new Error('profile_parser_denied');
  return Buffer.from(JSON.stringify(profile, null, 2) + '\n');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [evidencePath] = process.argv.slice(2);
    if (!evidencePath || process.argv.length !== 3) throw new Error('evidence_path_required');
    const evidence = readFileSync(evidencePath);
    const profile = prepareSarvamV19Release(readFileSync(reviewPath), evidence);
    writeFileSync(outputPath, profile, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: 'prepared_for_approval', evidenceSha256: hash(evidence), profileSha256: hash(profile) }));
  } catch {
    console.error('Profile preparation stopped. Check the evidence format, candidate checksum and output path.');
    process.exitCode = 1;
  }
}
