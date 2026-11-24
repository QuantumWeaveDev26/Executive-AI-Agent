"""Run the smoke verification in a test container."""
import subprocess

js = """
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

console.log('1. Resolving contracts...');
const contractsDir = dirname(fs.realpathSync(fileURLToPath(import.meta.resolve('@thaara/contracts'))));
console.log('contractsDir:', contractsDir);

console.log('2. Resolving policy...');
const policyDir = dirname(fs.realpathSync(fileURLToPath(import.meta.resolve('@thaara/policy'))));
console.log('policyDir:', policyDir);

console.log('3. Importing contracts...');
const c = await import('@thaara/contracts');
console.log('contracts keys:', Object.keys(c).filter(k => k.includes('PHONE') || k.includes('Phone')));

console.log('4. Importing policy...');
const pol = await import('@thaara/policy');
console.log('policy keys:', Object.keys(pol));

console.log('5. Importing services/phone-n8n-sync.js...');
try {
  const pns = await import('./dist/services/phone-n8n-sync.js');
  console.log('pns loaded:', typeof pns.PhoneN8nSyncService);
} catch (e) {
  console.error('Failed to import phone-n8n-sync.js:', e);
}

console.log('6. Importing dist/app.js...');
try {
  const appMod = await import('./dist/app.js');
  console.log('appMod loaded:', typeof appMod.buildApp);
} catch (e) {
  console.error('Failed to import app.js:', e);
}
"""

p = subprocess.run([
    'docker', 'run', '--rm', '-i',
    'thaara-v2-base:phone-n8n-sync-rebase',
    'node', '--input-type=module', '-e', js
], capture_output=True, text=True)

print("STDOUT:\n", p.stdout)
print("STDERR:\n", p.stderr)
