import dns from 'node:dns/promises';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { AuthenticatedScope } from '@thaara/db';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { N8nWhatsAppDispatchAcknowledgementSchema, type N8nWhatsAppDispatchAcknowledgement } from '@thaara/contracts';
import { AppError, ForbiddenError } from '@thaara/observability';

interface DispatchProfile {
  workspaceId: string;
  ownerUserId: string;
  connectionId: string;
  revision: number;
  webhookOrigin: string;
  credentialRef: string;
}
interface DispatchContext {
  readonly scope: Readonly<AuthenticatedScope>;
  readonly connectionId: string;
  readonly revision: number;
  readonly dispatchId: string;
  readonly credentialRef: string;
}
interface Options {
  profile: DispatchProfile;
  // The future runtime must atomically verify policy, exact approval, durable reservation,
  // active membership/profile/revision and audit admission here. No permissive default.
  assertDispatchAuthorized(context: DispatchContext): Promise<void>;
  credentials: { readonly mode: 'managed'; resolveToken(context: DispatchContext): Promise<string> };
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const id = /^[a-zA-Z0-9_-]{1,128}$/;
const Acknowledgement = TypeCompiler.Compile(N8nWhatsAppDispatchAcknowledgementSchema);
const unavailable = () => new AppError('WhatsApp dispatch transport is unavailable.', 'WHATSAPP_DISPATCH_UNAVAILABLE', 503);
const uncertain = () => new AppError('WhatsApp dispatch outcome is unverified; do not retry.', 'WHATSAPP_DISPATCH_UNVERIFIED', 502);
const denied = () => new ForbiddenError('WhatsApp dispatch is not authorized.');
const blocked4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
] as const) blocked4.addSubnet(address, prefix, 'ipv4');
const global6 = new BlockList(), blocked6 = new BlockList();
global6.addSubnet('2000::', 3, 'ipv6');
blocked6.addSubnet('2001::', 23, 'ipv6');
blocked6.addSubnet('2001:db8::', 32, 'ipv6');
blocked6.addSubnet('2002::', 16, 'ipv6');
blocked6.addSubnet('3fff::', 20, 'ipv6');
function publicAddress(address: string, family: number) {
  return isIP(address) === family && (family === 4 ? !blocked4.check(address, 'ipv4')
    : family === 6 && global6.check(address, 'ipv6') && !blocked6.check(address, 'ipv6'));
}

/** Internal transport only; deliberately not constructed or registered by app/server.
 * No policy bypass, credential provisioning, schema installation, provider calls or retries.
 * A successful HTTP acknowledgement never constitutes sent/delivered/read verification.
 */
export class WhatsAppDispatchHttpTransport {
  readonly #profile: Readonly<DispatchProfile>;
  readonly #url: URL;
  readonly #authorize: Options['assertDispatchAuthorized'];
  readonly #resolveToken: Options['credentials']['resolveToken'];

  constructor(options: Options) {
    const p = options.profile;
    if (!p || !uuid.test(p.workspaceId) || !uuid.test(p.ownerUserId) || !id.test(p.connectionId)
      || !Number.isSafeInteger(p.revision) || p.revision < 1 || typeof p.credentialRef !== 'string'
      || !/^[a-zA-Z0-9_/-]{1,256}$/.test(p.credentialRef) || typeof options.assertDispatchAuthorized !== 'function'
      || options.credentials?.mode !== 'managed' || typeof options.credentials.resolveToken !== 'function') throw unavailable();
    let origin: URL;
    try { origin = new URL(p.webhookOrigin); } catch { throw unavailable(); }
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash
      || (origin.port && origin.port !== '443') || origin.pathname !== '/'
      || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(origin.hostname)
      || /\.(?:localhost|local|internal|invalid|test)$/i.test(origin.hostname) || isIP(origin.hostname)) throw unavailable();
    this.#profile = Object.freeze({ ...p });
    this.#url = new URL('/webhook/thaara-v2-dev-whatsapp-approved-1082', origin.origin);
    this.#authorize = options.assertDispatchAuthorized.bind(options);
    this.#resolveToken = options.credentials.resolveToken.bind(options.credentials);
  }

  async submit(scope: AuthenticatedScope, dispatchId: string, revision: number): Promise<N8nWhatsAppDispatchAcknowledgement> {
    const p = this.#profile;
    if (!scope || scope.workspaceId !== p.workspaceId || scope.userId !== p.ownerUserId
      || !['member', 'admin', 'owner'].includes(scope.role) || typeof scope.sessionTokenHash !== 'string'
      || !scope.sessionTokenHash.trim() || revision !== p.revision || !uuid.test(dispatchId)) throw denied();
    const context: DispatchContext = Object.freeze({ scope: Object.freeze({ ...scope }), connectionId: p.connectionId, revision, dispatchId, credentialRef: p.credentialRef });
    const abort = new AbortController();
    let started = false, timer: ReturnType<typeof setTimeout> | undefined;
    const fresh = async () => {
      if (abort.signal.aborted) throw unavailable();
      try { await this.#authorize(context); } catch { throw denied(); }
      if (abort.signal.aborted) throw unavailable();
    };
    const work = async () => {
      await fresh();
      let addresses: Awaited<ReturnType<typeof dns.lookup>>;
      // Resolve once and pin the selected address in the actual TLS socket lookup.
      const answers = await dns.lookup(this.#url.hostname, { all: true, verbatim: true });
      if (abort.signal.aborted || !answers.length || answers.length > 32 || answers.some(a => !publicAddress(a.address, a.family))) throw unavailable();
      addresses = answers[0]!;
      await fresh();
      let token: string;
      try { token = await this.#resolveToken(context); } catch { throw unavailable(); }
      if (abort.signal.aborted || typeof token !== 'string' || !/^[a-zA-Z0-9_-]{32,256}$/.test(token)) throw unavailable();
      await fresh();
      const body = JSON.stringify({ dispatchId, connectionRevision: revision });
      return new Promise<N8nWhatsAppDispatchAcknowledgement>((resolve, reject) => {
        if (abort.signal.aborted) { reject(unavailable()); return; }
        started = true;
        const request = https.request(this.#url, {
          method: 'POST', agent: false, rejectUnauthorized: true, servername: this.#url.hostname,
          family: addresses.family, signal: abort.signal,
          lookup: (_hostname, _options, callback) => callback(null, addresses.address, addresses.family),
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, response => {
          const fail = () => { reject(uncertain()); response.destroy(); request.destroy(); };
          if (response.statusCode !== 200 || response.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
            || (response.headers['content-length'] !== undefined && (!/^\d+$/.test(response.headers['content-length']) || Number(response.headers['content-length']) > 16384))) { fail(); return; }
          let size = 0;
          const chunks: Buffer[] = [];
          response.on('error', () => reject(uncertain()));
          response.on('aborted', () => reject(uncertain()));
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 16384) { fail(); return; }
            chunks.push(Buffer.from(chunk));
          });
          response.on('end', () => {
            try {
              const ack: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              if (!Acknowledgement.Check(ack) || ack.dispatchId !== dispatchId) throw uncertain();
              resolve({ dispatchId, status: ack.status, verified: false });
            } catch { reject(uncertain()); }
          });
        });
        request.on('error', () => reject(uncertain()));
        request.end(body);
      });
    };
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { abort.abort(); reject(started ? uncertain() : unavailable()); }, 3000);
      });
      return await Promise.race([work(), deadline]);
    } catch (error) {
      if (error instanceof ForbiddenError) throw error;
      throw started ? uncertain() : unavailable();
    } finally { if (timer) clearTimeout(timer); }
  }
}
