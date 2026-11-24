from pathlib import Path

df_path = Path('/opt/thaara-v2-pilot/staging-phone-n8n-sync/Dockerfile')
if df_path.exists():
    lines = df_path.read_text(encoding='utf-8').splitlines()
    new_lines = []
    for l in lines:
        if l.startswith('RUN node --input-type=module -e'):
            # Replace with try/catch wrapped logging
            replacement = '''RUN node --input-type=module -e "import fs from 'node:fs'; \\
  try { \\
    const c = await import('@thaara/contracts'); \\
    if (!c.PhoneN8nCallSyncBatchRequestSchema) throw Error('Missing PhoneN8nCallSyncBatchRequestSchema'); \\
    if (!c.PHONE_RECORDING_PLAYBACK_ACTION) throw Error('Missing PHONE_RECORDING_PLAYBACK_ACTION'); \\
    const pol = await import('@thaara/policy'); \\
    if (!pol.defaultActionRegistry.has('phone.recordings.read')) throw Error('Missing phone.recordings.read policy registration'); \\
    const pns = await import('./dist/services/phone-n8n-sync.js'); \\
    if (typeof pns.PhoneN8nSyncService !== 'function') throw Error('Missing PhoneN8nSyncService'); \\
    const appMod = await import('./dist/app.js'); \\
    if (typeof appMod.buildApp !== 'function') throw Error('Missing buildApp'); \\
    const assets = fs.readdirSync('/app/apps/web/dist/assets'); \\
    const jsBundle = assets.find((n) => n.endsWith('.js') && n.startsWith('index-')); \\
    if (!jsBundle) throw Error('Missing web JS bundle'); \\
    const webJs = fs.readFileSync('/app/apps/web/dist/assets/' + jsBundle, 'utf8'); \\
    if (!webJs.includes('Call Recording') || !webJs.includes('Transcript')) throw Error('Web bundle missing Call Recording or Transcript'); \\
    if (!fs.existsSync('/app/apps/web/dist/assets/chat-voice-processor-v1.js')) throw Error('Missing chat-voice-processor worklet'); \\
    console.log('Phone n8n Sync overlay successfully verified in-container!'); \\
  } catch (err) { \\
    console.error('=== SMOKE_ERROR_DETAILS ===', err); \\
    process.exit(1); \\
  }"'''
            new_lines.append(replacement)
        else:
            new_lines.append(l)
    df_path.write_text('\n'.join(new_lines) + '\n', encoding='utf-8')
    print("Updated Dockerfile with detailed error logging.")
