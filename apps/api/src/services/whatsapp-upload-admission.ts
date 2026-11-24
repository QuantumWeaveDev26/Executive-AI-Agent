import { AuditEventRepository, type AuthenticatedScope, type TransactionalDbClient, type DbClient } from '@thaara/db';
import { computeCanonicalParameterHash, WHATSAPP_MEDIA_UPLOAD_ACTION, isWhatsAppUploadIntent, isN8nWhatsAppMediaUpload, type ApprovalRequest, type WhatsAppUploadIntent, type N8nWhatsAppMediaUpload } from '@thaara/contracts';
import type { PolicyGateway } from '@thaara/policy';
import { AppError, ForbiddenError } from '@thaara/observability';

export interface WhatsAppUploadAdmission {
  begin(scope: AuthenticatedScope, intent: WhatsAppUploadIntent, approvalId: string): Promise<{ fresh: true } | { fresh: false; result: N8nWhatsAppMediaUpload }>;
  complete(scope: AuthenticatedScope, intent: WhatsAppUploadIntent, approvalId: string, result: N8nWhatsAppMediaUpload): Promise<void>;
  fail(scope: AuthenticatedScope, intent: WhatsAppUploadIntent, approvalId: string): Promise<void>;
}
const denied = () => new ForbiddenError('WhatsApp file upload authorization denied.');
const key = (approvalId: string) => 'wa-media-upload:' + approvalId;
// Existing RLS-protected approval, audit and idempotency tables only. No new schema or secret storage.
export function createWhatsAppUploadAdmission(db: TransactionalDbClient, policy: PolicyGateway): WhatsAppUploadAdmission {
  async function authorize(tx: DbClient, scope: AuthenticatedScope, intent: WhatsAppUploadIntent, approvalId: string) {
    if (!scope.sessionTokenHash || !isWhatsAppUploadIntent(intent) || !/^[a-f0-9-]{36}$/i.test(approvalId)) throw denied();
    const { rows } = await tx.query<{ workspace_id: string; user_id: string; role: string }>('SELECT workspace_id,user_id,role FROM public.resolve_session_scope($1)', [scope.sessionTokenHash]);
    const actual = rows[0];
    if (!actual || actual.workspace_id !== scope.workspaceId || actual.user_id !== scope.userId || actual.role !== scope.role || !['owner', 'admin', 'member'].includes(actual.role)) throw denied();
    const locked = await tx.query('SELECT * FROM public.approval_requests WHERE workspace_id=$1 AND requester_user_id=$2 AND id=$3 FOR UPDATE', [scope.workspaceId, scope.userId, approvalId]);
    const a = locked.rows[0]; if (!a) throw denied();
    const approval: ApprovalRequest = { id: a.id, workspaceId: a.workspace_id, requesterUserId: a.requester_user_id, approverUserId: a.approver_user_id,
      actionName: a.action_name, actionParams: a.action_params, status: a.status, riskLevel: a.risk_level, createdAt: new Date(a.created_at).toISOString(), updatedAt: new Date(a.updated_at).toISOString(), expiresAt: new Date(a.expires_at).toISOString() };
    if (approval.approverUserId !== scope.userId || approval.riskLevel !== 'high' || !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= Date.now()
      || !policy.evaluate(scope, { actionName: WHATSAPP_MEDIA_UPLOAD_ACTION, parameters: intent, idempotencyKey: intent.idempotencyKey }, approval, scope.userId).allowed) throw denied();
    return approval;
  }
  const audit = (tx: DbClient, scope: AuthenticatedScope, approvalId: string, intent: WhatsAppUploadIntent, action: string) => new AuditEventRepository(tx).create(scope.workspaceId, action, 'whatsapp_media_upload', { connectionId: intent.connectionId, mimeType: intent.mimeType, bytes: intent.bytes }, scope.userId, approvalId);
  return {
    begin: (scope, intent, approvalId) => db.withScopedTransaction(scope, async tx => {
      const approval = await authorize(tx, scope, intent, approvalId), path = computeCanonicalParameterHash(intent);
      const inserted = await tx.query(`INSERT INTO public.idempotency_keys (key,workspace_id,user_id,request_path,status,expires_at)
        VALUES ($1,$2,$3,$4,'in_progress',$5) ON CONFLICT (workspace_id,key) DO NOTHING RETURNING key`,
        [key(approvalId), scope.workspaceId, scope.userId, path, new Date(Date.parse(approval.expiresAt) + 3600000).toISOString()]);
      if (!inserted.rows.length) {
        const existing = (await tx.query('SELECT user_id,request_path,status,response_body FROM public.idempotency_keys WHERE workspace_id=$1 AND key=$2 FOR UPDATE', [scope.workspaceId, key(approvalId)])).rows[0];
        if (!existing || existing.user_id !== scope.userId || existing.request_path !== path) throw denied();
        if (existing.status !== 'completed') throw new AppError('This upload was already started. Its outcome needs checking; do not retry automatically.', 'WHATSAPP_UPLOAD_REPLAY', 409);
        if (!isN8nWhatsAppMediaUpload(existing.response_body) || existing.response_body.media.sha256 !== intent.sha256 || existing.response_body.media.mimeType !== intent.mimeType) throw denied();
        return { fresh: false as const, result: existing.response_body };
      }
      await audit(tx, scope, approvalId, intent, 'whatsapp.media.upload_admitted');
      return { fresh: true as const };
    }),
    complete: (scope, intent, approvalId, result) => db.withScopedTransaction(scope, async tx => {
      await authorize(tx, scope, intent, approvalId);
      if (!isN8nWhatsAppMediaUpload(result) || result.media.sha256 !== intent.sha256 || result.media.mimeType !== intent.mimeType) throw denied();
      const updated = await tx.query(`UPDATE public.idempotency_keys SET status='completed',response_status=200,response_body=$4::jsonb
        WHERE workspace_id=$1 AND key=$2 AND user_id=$3 AND status='in_progress' AND request_path=$5 RETURNING key`, [scope.workspaceId, key(approvalId), scope.userId, JSON.stringify(result), computeCanonicalParameterHash(intent)]);
      if (updated.rows.length !== 1) throw denied();
      await audit(tx, scope, approvalId, intent, 'whatsapp.media.uploaded');
    }),
    fail: (scope, intent, approvalId) => db.withScopedTransaction(scope, async tx => {
      // Best effort only: a revoked session may prevent this audit. The committed in_progress row still fences retries.
      await authorize(tx, scope, intent, approvalId);
      await tx.query(`UPDATE public.idempotency_keys SET status='failed' WHERE workspace_id=$1 AND key=$2 AND user_id=$3 AND request_path=$4 AND status='in_progress'`, [scope.workspaceId, key(approvalId), scope.userId, computeCanonicalParameterHash(intent)]);
      await audit(tx, scope, approvalId, intent, 'whatsapp.media.upload_unverified');
    })
  };
}
