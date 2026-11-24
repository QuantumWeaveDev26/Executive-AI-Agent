import { lstat, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { PostgresDatabase } from '@thaara/db';
import { createConfiguredPhoneCallbackMailTransport, PHONE_CALLBACK_SENDER } from './services/phone-callback-mail.js';
import { createPhoneCallbackWorker } from './services/phone-callback-worker.js';

async function secret(name: 'database_url' | 'token' | 'resend_api_key' | 'profile') {
  const path = '/run/secrets/phone_callback_' + name;
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > 8192) throw Error('Phone callback secret configuration unavailable.');
  return (await readFile(path, 'utf8')).trim();
}

/** Separate, disabled-by-default process. It consumes only existing confirmed callback records. */
export async function runPhoneCallbackWorkerProcess(environment: Readonly<Record<string, string | undefined>>, signal: AbortSignal) {
  if (environment.THAARA_PHONE_CALLBACK_ENABLED !== 'true') return { status: 'off' as const };
  if (environment.THAARA_PHONE_CALLBACK_DOMAIN_VERIFIED !== 'true' || environment.THAARA_PHONE_CALLBACK_SENDER !== PHONE_CALLBACK_SENDER) {
    return { status: 'not_configured' as const };
  }
  if (signal.aborted) return { status: 'stopped' as const };
  let db: PostgresDatabase | undefined;
  try {
    const database = new URL(await secret('database_url'));
    if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.searchParams.get('sslmode') !== 'verify-full') {
      throw Error('Verified TLS is required.');
    }
    database.searchParams.set('options', '-c statement_timeout=5000 -c lock_timeout=1000');
    const profile = JSON.parse(await secret('profile'));
    const transport = createConfiguredPhoneCallbackMailTransport({ environment, apiKey: () => secret('resend_api_key') });
    db = new PostgresDatabase(database.toString());
    const worker = createPhoneCallbackWorker({ db, scope: profile, credential: () => secret('token'),
      transport: { sender: transport.sender, ready: async () => !signal.aborted && await transport.ready!(),
        send: mail => signal.aborted ? Promise.resolve('not_submitted' as const) : transport.send(mail) } });
    while (!signal.aborted) {
      await worker.run();
      if (!signal.aborted) {
        try { await pause(30_000, undefined, { signal }); } catch (error) { if (!signal.aborted) throw error; }
      }
    }
    return { status: 'stopped' as const };
  } catch {
    throw Error('Phone callback worker startup or execution is unavailable.');
  } finally { await db?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  process.once('SIGINT', () => controller.abort());
  runPhoneCallbackWorkerProcess(process.env, controller.signal)
    .then(result => { process.stdout.write(JSON.stringify(result) + '\n'); })
    .catch(() => { process.stderr.write('Phone callback worker unavailable.\n'); process.exitCode = 1; });
}
