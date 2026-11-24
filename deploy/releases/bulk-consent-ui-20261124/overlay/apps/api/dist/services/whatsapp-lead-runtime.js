import { PostgresWhatsAppLeadRegister } from './whatsapp-lead-postgres.js';
import { WhatsAppLeadSync } from './whatsapp-lead-sync.js';
import { createN8nLeadSheetsPort } from './whatsapp-lead-sheets-n8n.js';
import { createWhatsAppLeadJob } from './whatsapp-lead-job.js';
export const WHATSAPP_LEAD_TARGET = { spreadsheetId: '1Roo0IaLx5flncIiESj5QqiOtNWqpZgnAuSsnWAyo3QQ', sheetName: 'WhatsApp Enquiries' };
/** Server-only composition for the existing job runner; does not register a timer or enable a deployment. */
export function createWhatsAppLeadRuntime(options) {
    const target = { ...WHATSAPP_LEAD_TARGET };
    const register = new PostgresWhatsAppLeadRegister(options.db, options.serviceViews);
    const sheets = createN8nLeadSheetsPort({ enabled: options.enabled, target, resolveSecret: options.resolveBridgeSecret, fetch: options.fetch });
    const sync = new WhatsAppLeadSync(options.db, sheets, options.approvalFor, undefined, options.serviceViews);
    return createWhatsAppLeadJob({ enabled: options.enabled, register, sync, resolveApprovedBinding: async () => {
            const binding = await options.resolveApprovedBinding();
            if (!binding || binding.target.spreadsheetId !== target.spreadsheetId || binding.target.sheetName !== target.sheetName)
                return null;
            return { ...binding, scope: { ...binding.scope }, target: { ...target } };
        } });
}
/** Registration adapter for the EXISTING job service. Queue metadata can select only the approved binding. */
export function createWhatsAppLeadQueueHandler(options) {
    return async (data) => {
        if (!options.enabled)
            return { success: false, result: { status: 'not_configured' } };
        if (data.jobName !== 'whatsapp.leads.sync' || Object.keys(data.payload).some(k => k !== 'connectionId'))
            return { success: false, result: { status: 'awaiting_approval' } };
        const binding = await options.resolveApprovedBinding();
        if (!binding || binding.scope.workspaceId !== data.workspaceId || binding.connectionId !== data.payload.connectionId)
            return { success: false, result: { status: 'awaiting_approval' } };
        const result = await createWhatsAppLeadRuntime({ ...options, resolveApprovedBinding: async () => binding })();
        return { success: result.status === 'idle', result };
    };
}
//# sourceMappingURL=whatsapp-lead-runtime.js.map