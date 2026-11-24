"""Run node check inside current container."""
import subprocess

js = """
try {
  const fs = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  console.log('Resolving @thaara/contracts...');
  const contractsUrl = import.meta.resolve('@thaara/contracts');
  console.log('contractsUrl:', contractsUrl);
  const contractsPath = fileURLToPath(contractsUrl);
  console.log('contractsPath:', contractsPath);
  const contractsReal = fs.realpathSync(contractsPath);
  console.log('contractsReal:', contractsReal);
  const contractsDir = dirname(contractsReal);
  console.log('contractsDir:', contractsDir);
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
