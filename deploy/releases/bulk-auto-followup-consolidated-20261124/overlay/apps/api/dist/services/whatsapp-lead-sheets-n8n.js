import { PILOT_N8N_ORIGIN } from './whatsapp-pilot-dispatch.js';
const unavailable = () => Error('WhatsApp lead sheet is unavailable.');
/** Dedicated bridge beside existing WhatsApp flows. Never reuses their send credential or executes a message. */
export function createN8nLeadSheetsPort(options) {
    const target = { ...options.target }, network = options.fetch ?? fetch;
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(target.spreadsheetId) || target.sheetName !== 'WhatsApp Enquiries')
        throw unavailable();
    async function call(operation, supplied, row, cells, leadId) {
        if (operation === 'locate' && !/^[a-f0-9]{64}$/.test(leadId ?? ''))
            throw unavailable();
        if (!options.enabled || supplied.spreadsheetId !== target.spreadsheetId || supplied.sheetName !== target.sheetName || !Number.isSafeInteger(row) || row < 1 || row > 1000 || operation === 'write' && (row === 1 || !cells || cells.length !== 16 || cells.some(c => typeof c !== 'string' || c.length > 2048)))
            throw unavailable();
        try {
            const secret = await options.resolveSecret();
            if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret))
                throw unavailable();
            const response = await network(PILOT_N8N_ORIGIN + '/webhook/thaara-whatsapp-leads-sheet-v1', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json', 'x-thaara-leads-token': secret }, body: JSON.stringify({ ...target, operation, row, ...(leadId ? { leadId } : {}), ...(operation === 'write' ? { cells, valueInputOption: 'RAW' } : {}) }) });
            if (!response.ok || !response.body)
                throw unavailable();
            const reader = response.body.getReader();
            const chunks = [];
            let size = 0;
            try {
                while (true) {
                    const part = await reader.read();
                    if (part.done)
                        break;
                    size += part.value.length;
                    if (size > 40000) {
                        await reader.cancel();
                        throw unavailable();
                    }
                    chunks.push(part.value);
                }
            }
            finally {
                reader.releaseLock();
            }
            const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (operation === 'locate') {
                if (!Array.isArray(result.rows) || result.rows.length > 2 || result.rows.some((n) => typeof n !== 'number' || !Number.isInteger(n) || n < 2 || n > 1000))
                    throw unavailable();
                return result.rows;
            }
            if (operation === 'write') {
                if (result.accepted !== true)
                    throw unavailable();
                return [];
            }
            if (!Array.isArray(result.cells) || result.cells.length > 16 || result.cells.some((c) => typeof c !== 'string' || c.length > 2048))
                throw unavailable();
            return result.cells;
        }
        catch {
            throw unavailable();
        }
    }
    return { locate: async (provided, id) => await call('locate', provided, 1, undefined, id), read: async (provided, row) => await call('read', provided, row), write: async (provided, row, cells) => { await call('write', provided, row, cells); } };
}
//# sourceMappingURL=whatsapp-lead-sheets-n8n.js.map