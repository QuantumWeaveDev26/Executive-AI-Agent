import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { LEAD_SYNC_ACTION } from './whatsapp-lead-sync.js';
import { WHATSAPP_LEAD_TARGET, createWhatsAppLeadQueueHandler } from './whatsapp-lead-runtime.js';
export const WHATSAPP_LEAD_PROFILE = { workspaceId: '75d2f889-d3eb-4acc-861a-fada4691ecce', userId: '4b4cbc9c-df01-4cc2-8565-8a23a3435b9d', connectionId: 'wa_pilot_meta_test_10813b', ...WHATSAPP_LEAD_TARGET };
const unavailable = () => new Error('WhatsApp lead authorization is unavailable.');
const uuid = (v) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
/** Dedicated DB identity plus a purpose-bound owner approval. Never constructs a browser session or borrows Phone credentials. */
export class WhatsAppLeadDelegation {
    pool;
    approvalId;
    constructor(pool, approvalId) {
        this.pool = pool;
        this.approvalId = approvalId;
        if (!uuid(approvalId))
            throw unavailable();
    }
    valid(row) { return Boolean(row && row.workspace_id === WHATSAPP_LEAD_PROFILE.workspaceId && row.user_id === WHATSAPP_LEAD_PROFILE.userId && row.role === 'owner' && row.grant_id === this.approvalId && new Date(row.expires_at).getTime() > Date.now()); }
    async transaction(scope, operation) {
        let client;
        try {
            client = await this.pool.connect();
            await client.query('BEGIN');
            await client.query('SET LOCAL ROLE thaara_whatsapp_leads');
            const identity = (await client.query('SELECT session_user,current_user')).rows[0];
            if (identity?.session_user !== 'thaara_whatsapp_leads_user' || identity?.current_user !== 'thaara_whatsapp_leads')
                throw unavailable();
            await client.query("SET LOCAL statement_timeout='15s'");
            await client.query("SELECT pg_catalog.set_config('app.whatsapp_lead_approval_id',$1,true)", [this.approvalId]);
            const grant = (await client.query('SELECT * FROM public.whatsapp_lead_resolve_grant_v1($1)', [this.approvalId])).rows[0];
            const active = this.valid(grant) ? grant : null;
            if (scope && (!active || !('kind' in scope) || scope.kind !== 'whatsapp_leads_service' || scope.delegationId !== this.approvalId || scope.workspaceId !== active.workspace_id || scope.userId !== active.user_id || scope.role !== 'owner'))
                throw unavailable();
            if (active) {
                await client.query("SELECT pg_catalog.set_config('app.workspace_id',$1,true),pg_catalog.set_config('app.user_id',$2,true),pg_catalog.set_config('app.role','owner',true)", [active.workspace_id, active.user_id]);
            }
            const owned = client;
            const tx = { query: async (sql, params) => { const result = await owned.query(sql, params); return { rows: result.rows }; }, exec: async (sql) => { await owned.query(sql); } };
            const result = await operation(tx, active);
            await client.query('COMMIT');
            return result;
        }
        catch {
            if (client) {
                try {
                    await client.query('ROLLBACK');
                }
                catch { }
            }
            throw unavailable();
        }
        finally {
            client?.release();
        }
    }
    withScopedTransaction(scope, operation) { return this.transaction(scope, tx => operation(tx)); }
    async resolveApprovedBinding() {
        return this.transaction(null, async (_tx, grant) => {
            if (!grant)
                return null;
            const scope = { workspaceId: grant.workspace_id, userId: grant.user_id, role: 'owner', kind: 'whatsapp_leads_service', delegationId: grant.grant_id };
            return { scope, connectionId: WHATSAPP_LEAD_PROFILE.connectionId, target: { ...WHATSAPP_LEAD_TARGET }, approvalExpiresAt: new Date(grant.expires_at).getTime() };
        });
    }
    approvalFor = async (tx, scope, params) => {
        const grant = (await tx.query('SELECT * FROM public.whatsapp_lead_resolve_grant_v1($1)', [this.approvalId])).rows[0];
        if (!this.valid(grant) || !('kind' in scope) || scope.delegationId !== this.approvalId || scope.workspaceId !== grant.workspace_id || scope.userId !== grant.user_id || params.connectionId !== WHATSAPP_LEAD_PROFILE.connectionId || params.spreadsheetId !== WHATSAPP_LEAD_TARGET.spreadsheetId || params.sheetName !== WHATSAPP_LEAD_TARGET.sheetName)
            return null;
        const values = [grant.workspace_id, grant.user_id, params.connectionId, params.leadId, params.version, this.approvalId];
        await tx.query(`INSERT INTO public.whatsapp_lead_write_authorizations_v1(id,workspace_id,owner_user_id,connection_id,lead_id,version,grant_id,action_params,expires_at) VALUES($7,$1,$2,$3,$4,$5,$6,$8::jsonb,$9) ON CONFLICT(workspace_id,owner_user_id,connection_id,lead_id,version,grant_id) DO NOTHING`, [...values, randomUUID(), JSON.stringify(params), new Date(grant.expires_at).toISOString()]);
        const row = (await tx.query(`SELECT id,action_params,expires_at,created_at FROM public.whatsapp_lead_write_authorizations_v1 WHERE workspace_id=$1 AND owner_user_id=$2 AND connection_id=$3 AND lead_id=$4 AND version=$5 AND grant_id=$6`, values)).rows[0];
        if (!row || new Date(row.expires_at).getTime() <= Date.now() || Object.keys(params).some(k => JSON.stringify(params[k]) !== JSON.stringify(row.action_params[k])) || Object.keys(row.action_params).length !== Object.keys(params).length)
            return null;
        return { id: row.id, workspaceId: grant.workspace_id, requesterUserId: grant.user_id, approverUserId: grant.user_id, actionName: LEAD_SYNC_ACTION, actionParams: { ...params }, riskLevel: 'high', status: 'approved', createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString() };
    };
}
export function createDelegatedWhatsAppLeadHandler(options) {
    const run = createWhatsAppLeadQueueHandler({ enabled: options.enabled, serviceViews: true, db: options.delegation, resolveApprovedBinding: () => options.delegation.resolveApprovedBinding(), approvalFor: options.delegation.approvalFor, resolveBridgeSecret: options.resolveBridgeSecret, fetch: options.fetch });
    return async (data) => {
        const result = await run(data);
        const status = result.result.status;
        if (['idle', 'queued', 'inflight', 'unverified', 'failed', 'awaiting_approval', 'not_configured'].includes(status))
            console.log(JSON.stringify({ component: 'whatsapp_leads', status, projected: 'projected' in result.result ? result.result.projected : 0, synced: 'synced' in result.result ? result.result.synced : 0 }));
        return result;
    };
}
/** Reuse the existing DB package's installed driver. Certificate verification is mandatory. */
export function createWhatsAppLeadPool(databaseUrl) {
    try {
        const url = new URL(databaseUrl);
        if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== 'db-callback.quantumweaveai.io' || url.username !== 'thaara_whatsapp_leads_user' || decodeURIComponent(url.password).length < 32 || url.pathname.length < 2)
            throw unavailable();
        // Never let URL parameters turn off TLS or load an unrelated credential/certificate file.
        if ([...url.searchParams.keys()].some(k => !['sslmode', 'sslnegotiation'].includes(k)))
            throw unavailable();
        if (url.searchParams.has('sslmode') && url.searchParams.get('sslmode') !== 'verify-full')
            throw unavailable();
        if (url.searchParams.has('sslnegotiation') && url.searchParams.get('sslnegotiation') !== 'postgres')
            throw unavailable();
        url.search = '';
        const driver = createRequire(import.meta.resolve('@thaara/db'))('pg');
        const config = { connectionString: url.toString(), ssl: { rejectUnauthorized: true, servername: url.hostname }, sslnegotiation: 'postgres', max: 2, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000, application_name: 'thaara_whatsapp_leads_pilot' };
        const probe = new driver.Client(config);
        if (probe.sslNegotiation !== 'postgres' || probe.ssl?.rejectUnauthorized !== true)
            throw unavailable();
        const pool = new driver.Pool(config);
        pool.on?.('error', () => { console.error('WhatsApp lead database connection is unavailable.'); });
        return pool;
    }
    catch {
        throw unavailable();
    }
}
//# sourceMappingURL=whatsapp-lead-delegation.js.map