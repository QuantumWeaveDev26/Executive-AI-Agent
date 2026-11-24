import { hasLeadAuthorization } from './whatsapp-lead-scope.js';
/** Add this bounded callback to the existing approved job schedule. No new polling loop, credentials or fabricated user session. */
export function createWhatsAppLeadJob(options) {
    return async () => {
        if (!options.enabled)
            return { status: 'not_configured', projected: 0, synced: 0 };
        const binding = await options.resolveApprovedBinding();
        if (!binding || !Number.isFinite(binding.approvalExpiresAt) || binding.approvalExpiresAt <= Date.now() || !hasLeadAuthorization(binding.scope))
            return { status: 'awaiting_approval', projected: 0, synced: 0 };
        const scope = { ...binding.scope }, target = { ...binding.target };
        let projected = 0, synced = 0, more = false;
        // The existing queue invokes subsequent runs for backlog/retry; each invocation is bounded.
        for (let page = 0; page < 4; page++) {
            const result = await options.register.captureConnection(scope, binding.connectionId);
            projected += result.projected;
            more = result.hasMore;
            if (!more)
                break;
        }
        for (let item = 0; item < 10; item++) {
            if (binding.approvalExpiresAt <= Date.now())
                return { status: 'awaiting_approval', projected, synced, backlog: more };
            const result = await options.sync.syncOne(scope, binding.connectionId, target);
            if (result.status === 'idle') {
                const states = options.register.diagnostics ? (await options.register.diagnostics(scope, binding.connectionId)).rows : [];
                const blocked = ['unverified', 'inflight', 'failed', 'awaiting_approval'].find(state => states.some(row => row.sync_status === state && Number(row.count) > 0));
                return { status: blocked ?? (more ? 'queued' : 'idle'), projected, synced, backlog: more };
            }
            if (result.status !== 'synced')
                return { status: result.status, projected, synced, backlog: more };
            synced++;
        }
        return { status: 'queued', projected, synced, backlog: true };
    };
}
//# sourceMappingURL=whatsapp-lead-job.js.map