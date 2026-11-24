"""Run policy check inside current container."""
import subprocess

js = """
try {
  const fs = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  console.log('Resolving @thaara/policy...');
  const policyUrl = import.meta.resolve('@thaara/policy');
  console.log('policyUrl:', policyUrl);
  const policyDir = dirname(fs.realpathSync(fileURLToPath(policyUrl)));
  console.log('policyDir:', policyDir);
  const pol = await import('@thaara/policy');
  console.log('pol:', Object.keys(pol));
  console.log('isActionRegistered:', pol.defaultPolicyGateway.isActionRegistered('phone.recordings.read'));
} catch (e) {
  console.error('ERROR OCCURRED:', e);
}
"""

p = subprocess.run([
    'docker', 'exec', 'thaara-v2-pilot-api-1',
    'node', '--input-type=module', '-e', js
], capture_output=True, text=True)
print("STDOUT:\n", p.stdout)
print("STDERR:\n", p.stderr)
