import subprocess

cmd = """
node --input-type=module -e "
import fs from 'node:fs';
try {
  const c = await import('@thaara/contracts');
  console.log('1. contracts:', Boolean(c.PhoneN8nCallSyncBatchRequestSchema), Boolean(c.PHONE_RECORDING_PLAYBACK_ACTION));
  const pol = await import('@thaara/policy');
  console.log('2. policy:', pol.defaultActionRegistry.has('phone.recordings.read'));
  const pns = await import('./dist/services/phone-n8n-sync.js');
  console.log('3. phone-n8n-sync:', typeof pns.PhoneN8nSyncService);
  const appMod = await import('./dist/app.js');
  console.log('4. buildApp:', typeof appMod.buildApp);
  const assets = fs.readdirSync('/app/apps/web/dist/assets');
  console.log('5. assets:', assets);
  const jsBundle = assets.find((n) => n.endsWith('.js') && n.startsWith('index-'));
  console.log('6. jsBundle:', jsBundle);
  const webJs = fs.readFileSync('/app/apps/web/dist/assets/' + jsBundle, 'utf8');
  console.log('7. includes Call Recording:', webJs.includes('Call Recording'));
  console.log('8. includes Transcript:', webJs.includes('Transcript'));
  console.log('9. chat-voice-processor-v1.js exists:', fs.existsSync('/app/apps/web/dist/assets/chat-voice-processor-v1.js'));
} catch (e) {
  console.error('ERROR in smoke test:', e);
}
"
"""

p = subprocess.run([
    'docker', 'exec', 'thaara-v2-pilot-api-1', 'sh', '-c', cmd
], capture_output=True, text=True)

print("STDOUT:\n", p.stdout)
print("STDERR:\n", p.stderr)
