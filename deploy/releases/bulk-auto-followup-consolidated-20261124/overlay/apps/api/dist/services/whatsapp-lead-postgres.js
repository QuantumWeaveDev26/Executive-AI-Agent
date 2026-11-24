import { whatsappDraftPreview } from '@thaara/contracts';
import { buildWhatsAppLead, isLeadErasureRequest } from './whatsapp-lead-register.js';
/** Projection of the EXISTING durable inbox. No webhook/send or conversation-memory changes. */
export class PostgresWhatsAppLeadRegister {
    db;
    serviceViews;
    constructor(db, serviceViews = false) {
        this.db = db;
        this.serviceViews = serviceViews;
    }
    source(name) { return this.serviceViews ? 'public.whatsapp_lead_source_' + name + '_v1' : 'public.whatsapp_n8n_' + name; }
    async captureConnection(scope, connectionId) {
        scope = { ...scope };
        return this.db.withScopedTransaction(scope, async (tx) => {
            const key = [scope.workspaceId, scope.userId, connectionId];
            // Serialize projectors on their own lock, without holding the webhook's connection-row lock.
            await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [JSON.stringify(key)]);
            const binding = (await tx.query(`SELECT binding FROM ${this.source('connections')} WHERE workspace_id=$1 AND owner_user_id=$2 AND connection_id=$3 AND disconnected=false`, key)).rows[0]?.binding;
            if (!binding || binding.workspaceId !== scope.workspaceId || binding.userId !== scope.userId || binding.connectionId !== connectionId)
                throw Error('Lead connection denied');
            await tx.query(`INSERT INTO public.whatsapp_lead_projection_cursor_v1(workspace_id,owner_user_id,connection_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, key);
            const cursor = (await tx.query(`SELECT last_message_id FROM public.whatsapp_lead_projection_cursor_v1 WHERE workspace_id=$1 AND owner_user_id=$2 AND connection_id=$3 FOR UPDATE`, key)).rows[0].last_message_id;
            const source = (await tx.query(`SELECT record FROM ${this.source('messages')} WHERE workspace_id=$1 AND owner_user_id=$2 AND connection_id=$3 AND provider_message_id>$4 ORDER BY provider_message_id LIMIT 251`, [...key, cursor])).rows;
            const hasMore = source.length > 250;
            const messages = source.slice(0, 250).map(r => r.record);
            const dispatches = (await tx.query(`SELECT record FROM ${this.source('dispatches')} WHERE workspace_id=$1 AND owner_user_id=$2 AND connection_id=$3 ORDER BY dispatch_id LIMIT 1001`, key)).rows.map(r => r.record);
            const events = (await tx.query(`SELECT record FROM ${this.source('status_events')} WHERE workspace_id=$1 AND owner_user_id=$2 AND connection_id=$3 LIMIT 2001`, key)).rows.map(r => r.record);
            const previous = (await tx.query(`SELECT * FROM public.whatsapp_lead_register_v1 WHERE workspace_id=$1 AND owner_user_id=$2 AND connection_id=$3`, key)).rows;
            const groups = new Map();
            let unresolved = 0;
            for (const message of messages) {
                const phone = binding.recipients.find(r => r.id === message.recipientId)?.phoneE164 ?? (/^c_[1-9]\d{6,14}$/.test(message.recipientId) ? '+' + message.recipientId.slice(2) : '');
                if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
                    unresolved++;
                    continue;
                }
                const group = groups.get(phone) ?? [];
                group.push(message);
                groups.set(phone, group);
            }
            let projected = 0;
            for (const [phone, group] of groups) {
                const recipientId = group.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp)).at(-1).recipientId;
                const recipientIds = [...new Set([...group.map(m => m.recipientId), ...binding.recipients.filter(r => r.phoneE164 === phone).map(r => r.id), 'c_' + phone.slice(1)])];
                const earliest = (await tx.query(`SELECT min(record->>'timestamp') AS first_contact FROM ${this.source('messages')} WHERE workspace_id=$1 AND owner_user_id=$2 AND connection_id=$3 AND (record->>'recipientId')=ANY($4::text[])`, [...key, recipientIds])).rows[0]?.first_contact;
                // Search the entire admitted history for an exact privacy request, even if it lies beyond this bounded page.
                const privacy = (await tx.query(`SELECT record FROM ${this.source('messages')} WHERE workspace_id=$1 AND owner_user_id=$2 AND connection_id=$3 AND (record->>'recipientId')=ANY($4::text[]) AND ((record->>'textPreview') ~* $5 OR btrim(record->>'textPreview')=ANY($6::text[])) ORDER BY provider_message_id LIMIT 1`, [...key, recipientIds, '^(please\\s+)?(delete|erase|remove)\\s+(all\\s+)?my\\s+(data|details|information|record)[.!\\s]*$', ['ನನ್ನ ಮಾಹಿತಿಯನ್ನು ಅಳಿಸಿ', 'ನನ್ನ ಡೇಟಾ ಅಳಿಸಿ', 'मेरा डेटा हटाएं', 'मेरी जानकारी हटाएं']])).rows.map(r => r.record).filter(m => isLeadErasureRequest(m.textPreview));
                const admitted = [...group, ...privacy].map(m => ({ ...m, recipientId }));
                const first = buildWhatsAppLead({ workspaceId: scope.workspaceId, userId: scope.userId, connectionId, recipientId, phoneE164: phone, messages: admitted, outbound: [], firstContact: earliest });
                const outbound = dispatches.filter(d => group.some(m => m.recipientId === d.draft.recipientId)).map(d => ({ text: whatsappDraftPreview(d.draft), verifiedSent: events.some(e => e.providerMessageId === d.receipt.providerMessageId && e.recipientAddress === phone.slice(1) && ['sent', 'delivered', 'read'].includes(e.status)) }));
                const payload = buildWhatsAppLead({ workspaceId: scope.workspaceId, userId: scope.userId, connectionId, recipientId, phoneE164: phone, messages: admitted, outbound, previous: previous.find(r => r.lead_id === first.id)?.payload, firstContact: earliest });
                const changed = await tx.query(`INSERT INTO public.whatsapp_lead_register_v1(workspace_id,owner_user_id,connection_id,lead_id,payload) VALUES($1,$2,$3,$4,$5::jsonb)
     ON CONFLICT(workspace_id,owner_user_id,connection_id,lead_id) DO UPDATE SET payload=excluded.payload,version=whatsapp_lead_register_v1.version+1,
      sync_status=CASE WHEN whatsapp_lead_register_v1.sync_status IN ('inflight','unverified') THEN whatsapp_lead_register_v1.sync_status ELSE 'queued' END,
      attempts=CASE WHEN whatsapp_lead_register_v1.sync_status IN ('inflight','unverified') THEN whatsapp_lead_register_v1.attempts ELSE 0 END,next_attempt_at=now()
     WHERE whatsapp_lead_register_v1.payload IS DISTINCT FROM excluded.payload RETURNING lead_id`, [...key, payload.id, JSON.stringify(payload)]);
                projected += changed.rows.length;
            }
            await tx.query(`UPDATE public.whatsapp_lead_projection_cursor_v1 SET last_message_id=$4 WHERE workspace_id=$1 AND owner_user_id=$2 AND connection_id=$3`, [...key, hasMore ? messages.at(-1).providerMessageId : '']);
            return { projected, unresolved, hasMore };
        });
    }
    async diagnostics(scope, connectionId) { return this.db.withScopedTransaction(scope, tx => tx.query(`SELECT sync_status,count(*)::text AS count FROM public.whatsapp_lead_register_v1 WHERE workspace_id=$1 AND owner_user_id=$2 AND connection_id=$3 GROUP BY sync_status`, [scope.workspaceId, scope.userId, connectionId])); }
}
export async function auditLead(tx, row, outcome) { await tx.query(`INSERT INTO public.whatsapp_lead_sync_audit_v1(workspace_id,owner_user_id,connection_id,lead_id,version,outcome) VALUES($1,$2,$3,$4,$5,$6)`, [row.workspace_id, row.owner_user_id, row.connection_id, row.lead_id, row.version, outcome]); }
//# sourceMappingURL=whatsapp-lead-postgres.js.map