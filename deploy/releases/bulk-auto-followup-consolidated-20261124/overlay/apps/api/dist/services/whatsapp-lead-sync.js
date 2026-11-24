import { createHash, randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import { ActionRegistry, PolicyGateway } from '@thaara/policy';
import { LEAD_HEADERS, leadCells } from './whatsapp-lead-register.js';
import { auditLead } from './whatsapp-lead-postgres.js';
export const LEAD_SYNC_ACTION = 'whatsapp.leads.sheets.upsert';
export function createLeadPolicyGateway() {
    const registry = new ActionRegistry();
    registry.register({ metadata: { name: LEAD_SYNC_ACTION, actionClass: 'write', risk: 'high', approvalMode: 'explicit', idempotencyRequired: true, timeoutMs: 15000, retryPolicy: { maxRetries: 0, backoffMs: 1000, exponential: true }, requiredRole: 'owner', auditRequired: true, capabilityScope: 'external_connector' }, inputSchema: Type.Object({ connectionId: Type.String({ minLength: 1, maxLength: 128 }), spreadsheetId: Type.String({ pattern: '^[A-Za-z0-9_-]{10,200}$' }), sheetName: Type.Literal('WhatsApp Enquiries'), leadId: Type.String({ pattern: '^[a-f0-9]{64}$' }), version: Type.Integer({ minimum: 1 }), row: Type.Integer({ minimum: 2, maximum: 1000000 }), cellsHash: Type.String({ pattern: '^[a-f0-9]{64}$' }), erase: Type.Boolean() }, { additionalProperties: false }) });
    return new PolicyGateway({ registry });
}
/** Invoke in the EXISTING bounded job runner. No timer, cron, new principal or automatic approval issuer. */
export class WhatsAppLeadSync {
    db;
    sheets;
    approvalFor;
    gateway;
    serviceViews;
    constructor(db, sheets, approvalFor = async () => null, gateway = createLeadPolicyGateway(), serviceViews = false) {
        this.db = db;
        this.sheets = sheets;
        this.approvalFor = approvalFor;
        this.gateway = gateway;
        this.serviceViews = serviceViews;
    }
    async syncOne(scope, connectionId, target) {
        scope = { ...scope };
        target = { ...target };
        if (!/^[A-Za-z0-9_-]{10,200}$/.test(target.spreadsheetId) || target.sheetName !== 'WhatsApp Enquiries')
            throw Error('Lead target denied');
        const claim = randomUUID(), base = [scope.workspaceId, scope.userId, connectionId];
        // Commit an in-flight marker BEFORE external work. Process crash or DB rollback can never silently retry an uncertain write.
        const claimed = await this.db.withScopedTransaction(scope, async (tx) => {
            const row = (await tx.query(`SELECT * FROM public.whatsapp_lead_register_v1 WHERE workspace_id=$1 AND owner_user_id=$2 AND connection_id=$3 AND sync_status IN ('queued','awaiting_approval') AND next_attempt_at<=now() ORDER BY sheet_row FOR UPDATE SKIP LOCKED LIMIT 1`, base)).rows[0];
            if (!row)
                return false;
            // Persist the exact derived approval in this claim transaction BEFORE any connector I/O.
            const prepared = parametersFor(target, row);
            const activeBefore = (await tx.query(`SELECT connection_id FROM ${this.serviceViews ? 'public.whatsapp_lead_source_connections_v1' : 'public.whatsapp_n8n_connections'} WHERE workspace_id=$1 AND owner_user_id=$2 AND connection_id=$3 AND disconnected=false`, base)).rows.length === 1;
            const priorApproval = activeBefore ? await this.approvalFor(tx, scope, prepared.params) : null;
            const priorMatches = priorApproval && priorApproval.workspaceId === scope.workspaceId && priorApproval.requesterUserId === scope.userId && Number.isFinite(Date.parse(priorApproval.expiresAt));
            if (!priorMatches || !this.gateway.evaluate(scope, { actionName: LEAD_SYNC_ACTION, parameters: { ...prepared.params }, idempotencyKey: `${row.lead_id}:${row.version}` }, priorApproval).allowed) {
                await this.finish(tx, row, 'awaiting_approval', 'APPROVAL_REQUIRED');
                return { status: 'awaiting_approval' };
            }
            await tx.query(`UPDATE public.whatsapp_lead_register_v1 SET sync_status='inflight',claim_token=$5 WHERE workspace_id=$1 AND owner_user_id=$2 AND connection_id=$3 AND lead_id=$4`, [...base, row.lead_id, claim]);
            await auditLead(tx, row, 'claimed');
            return true;
        });
        if (!claimed)
            return { status: 'idle' };
        if (typeof claimed === 'object')
            return claimed;
        return this.db.withScopedTransaction(scope, async (tx) => {
            const row = (await tx.query(`SELECT * FROM public.whatsapp_lead_register_v1 WHERE workspace_id=$1 AND owner_user_id=$2 AND connection_id=$3 AND claim_token=$4 AND sync_status='inflight' FOR UPDATE`, [...base, claim])).rows[0];
            if (!row)
                throw Error('Lead claim unavailable');
            const active = (await tx.query(`SELECT connection_id FROM ${this.serviceViews ? 'public.whatsapp_lead_source_connections_v1' : 'public.whatsapp_n8n_connections'} WHERE workspace_id=$1 AND owner_user_id=$2 AND connection_id=$3 AND disconnected=false`, base)).rows.length === 1;
            const { cells, params } = parametersFor(target, row);
            const approval = active ? await this.approvalFor(tx, scope, params) : null;
            const validApproval = approval && approval.workspaceId === scope.workspaceId && approval.requesterUserId === scope.userId && Number.isFinite(Date.parse(approval.expiresAt));
            const decision = this.gateway.evaluate(scope, { actionName: LEAD_SYNC_ACTION, parameters: { ...params }, idempotencyKey: `${row.lead_id}:${row.version}` }, validApproval ? approval : null);
            if (!active || !decision.allowed) {
                await this.finish(tx, row, 'awaiting_approval', 'APPROVAL_REQUIRED');
                return { status: 'awaiting_approval' };
            }
            let writeStarted = false;
            try {
                const headers = await this.sheets.read(target, 1);
                if (JSON.stringify(headers) !== JSON.stringify(LEAD_HEADERS))
                    throw Error('HEADER_MISMATCH');
                const positions = await this.sheets.locate(target, row.lead_id);
                if (positions.length > 1 || positions.length === 1 && positions[0] !== params.row)
                    throw Error('ROW_MAPPING_CHANGED');
                const before = await this.sheets.read(target, params.row);
                if (before.some(Boolean) && before[14] !== row.lead_id)
                    throw Error('ROW_COLLISION');
                const currentApproval = await this.approvalFor(tx, scope, params);
                if (!currentApproval || currentApproval.id !== approval?.id || !this.gateway.evaluate(scope, { actionName: LEAD_SYNC_ACTION, parameters: { ...params }, idempotencyKey: `${row.lead_id}:${row.version}` }, currentApproval).allowed)
                    throw Error('APPROVAL_EXPIRED');
                writeStarted = true;
                await this.sheets.write(target, params.row, cells);
                const after = await this.sheets.read(target, params.row);
                if (JSON.stringify(after) !== JSON.stringify(cells))
                    throw Error('UNVERIFIED');
                await this.finish(tx, row, 'synced', null);
                return { status: 'synced', verified: true };
            }
            catch (error) {
                // A failed read is safe to retry. Once PUT may have left the process, hold until operator/execution reconciliation.
                const localCode = error instanceof Error && ['HEADER_MISMATCH', 'ROW_COLLISION', 'ROW_MAPPING_CHANGED', 'APPROVAL_EXPIRED'].includes(error.message) ? error.message : 'PREWRITE_CHECK_FAILED';
                const state = writeStarted ? 'unverified' : localCode === 'APPROVAL_EXPIRED' ? 'awaiting_approval' : row.attempts >= 7 ? 'failed' : 'queued';
                await this.finish(tx, row, state, writeStarted ? 'WRITE_OUTCOME_UNKNOWN' : localCode);
                return { status: state, verified: false };
            }
        });
    }
    async finish(tx, row, status, error) {
        await tx.query(`UPDATE public.whatsapp_lead_register_v1 SET sync_status=$5,claim_token=NULL,attempts=attempts+1,last_error_code=$6,next_attempt_at=now()+LEAST(3600,30*power(2,LEAST(attempts,7))) * interval '1 second' WHERE workspace_id=$1 AND owner_user_id=$2 AND connection_id=$3 AND lead_id=$4`, [row.workspace_id, row.owner_user_id, row.connection_id, row.lead_id, status, error]);
        await auditLead(tx, row, status === 'queued' ? 'retry' : status);
    }
}
function parametersFor(target, row) {
    const cells = leadCells(row.payload, Number(row.version));
    const params = { ...target, connectionId: row.connection_id, leadId: row.lead_id, version: Number(row.version), row: Number(row.sheet_row), cellsHash: createHash('sha256').update(JSON.stringify(cells)).digest('hex'), erase: row.payload.erased };
    return { cells, params };
}
//# sourceMappingURL=whatsapp-lead-sync.js.map