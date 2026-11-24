import fs from 'node:fs';
import crypto from 'node:crypto';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const source = 'scripts/phone-step115-schema-20261111.readonly.ps1';
const path = 'scripts/phone-step115-install-verification-20261111.readonly.ps1';
let script = fs.readFileSync(source, 'utf8').replaceAll('PHONE_STEP115_SCHEMA_20261111', 'PHONE_STEP115_INSTALL_VERIFICATION_20261111')
  .replaceAll('ApprovedPhoneRuntimeReadOnly', 'ApprovedInstallVerificationReadOnly')
  .replaceAll('phone-step115-schema-20261111.used.json', 'phone-step115-install-verification-20261111.used.json')
  .replaceAll('phone-step115-schema-20261111.result.json', 'phone-step115-install-verification-20261111.result.json')
  .replaceAll('one_readonly_phone_step115_schema_metadata', 'one_readonly_verification_of_approved_disabled_install');
fs.writeFileSync(path, script);
const manifest = { remoteExecutionAllowed: true, readOnly: true,
  authorization: 'Read-only catalog verification of the owner-approved disabled installation after an unverified command result; no retry or DDL',
  artifacts: [path, 'deploy/hostinger-pilot/phone-step115-schema-20261111.readonly.py', 'docs/integrations/phone/STEP115_PRODUCTION_SCHEMA_PREFLIGHT.review.sql']
    .map(path => ({ path, sha256: hash(fs.readFileSync(path)) })) };
const destination = 'docs/integrations/phone/PHONE_STEP115_INSTALL_VERIFICATION_20261111.review.json';
fs.writeFileSync(destination, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ path, manifestSha256: hash(fs.readFileSync(destination)) }));
