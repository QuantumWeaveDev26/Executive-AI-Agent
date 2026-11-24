import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute } from 'node:path';
const denied = () => new Error('WhatsApp lead bridge secret is unavailable.');
async function protectedText(path, leaf, max) {
    if (!isAbsolute(path) || !path.endsWith('/' + leaf) && !path.endsWith('\\' + leaf))
        throw denied();
    let handle;
    try {
        const before = await lstat(path);
        if (!before.isFile() || before.isSymbolicLink())
            throw denied();
        handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const stat = await handle.stat();
        if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.size < 1 || stat.size > max + 2)
            throw denied();
        if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
            throw denied();
        const buffer = Buffer.alloc(max + 3);
        const result = await handle.read(buffer, 0, buffer.length, 0);
        const text = buffer.subarray(0, result.bytesRead).toString('utf8').trim();
        buffer.fill(0);
        if (!text || text.length > max)
            return Promise.reject(denied());
        return text;
    }
    catch {
        throw denied();
    }
    finally {
        await handle?.close();
    }
}
/** Approved WhatsApp pilot exception only; no Phone file names are admitted. */
export function createWhatsAppLeadFileSecretResolver(path = '/run/secrets/thaara-whatsapp-leads-bridge') {
    if (!isAbsolute(path) || !path.endsWith('thaara-whatsapp-leads-bridge'))
        throw denied();
    return async () => { const token = await protectedText(path, 'thaara-whatsapp-leads-bridge', 256); if (!/^[A-Za-z0-9_-]{32,256}$/.test(token))
        throw denied(); return token; };
}
export function createWhatsAppLeadDatabaseUrlResolver(path = '/run/secrets/thaara-whatsapp-leads-database-url') {
    return async () => protectedText(path, 'thaara-whatsapp-leads-database-url', 4096);
}
export function createWhatsAppLeadRedisUrlResolver(path = '/run/secrets/thaara-whatsapp-leads-redis-url') {
    return async () => protectedText(path, 'thaara-whatsapp-leads-redis-url', 4096);
}
//# sourceMappingURL=whatsapp-lead-secret-file.js.map