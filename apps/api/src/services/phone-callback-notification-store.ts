import { computeCanonicalParameterHash } from '@thaara/contracts';
import { ApprovalRepository, AuditEventRepository, type AuthenticatedScope, type DbClient, type TransactionalDbClient } from '@thaara/db';
import { ConflictError, ForbiddenError } from '@thaara/observability';
import type { CallbackNotificationGrant, CallbackRepository, CallbackRequest, CallbackScope, NotificationResult } from './phone-callback-notification.js';
import { PHONE_CALLBACK_GRANT_ACTION, phoneCallbackGrantPolicy } from './phone-callback-grant-policy.js';
import { PHONE_CALLBACK_RECIPIENT, PHONE_CALLBACK_SENDER } from './phone-callback-mail.js';

const table = 'public.phone_callback_requests';
const where = 'workspace_id=$1 AND owner_user_id=$2 AND request_id=$3';
const projection = `request_hash AS hash, jsonb_build_object(
 'id',request_id,'workspaceId',workspace_id,'userId',owner_user_id,'callId',call_id,'direction',direction,
 'occurredAt',occurred_at,'status',request_status,'notificationStatus',notification_status,
 'notificationAttemptId',notification_attempt_id,'providerMessageId',provider_message_id,'attempts',attempts) || details AS request`;
type Row = { hash: string; request: CallbackRequest };

/** Owner-scoped review storage. Provider roles need separate F-03 admission. */
export class PhoneCallbackNotificationRepository implements CallbackRepository {
  constructor(private readonly db: TransactionalDbClient, private readonly owner: AuthenticatedScope) {
    if (process.env.NODE_ENV !== 'test') throw new Error('Callback storage is test-only pending database admission.');
  }

  private run<T>(scope: CallbackScope, work: (tx: DbClient) => Promise<T>) {
    if (this.owner.role !== 'owner' || scope.workspaceId !== this.owner.workspaceId || scope.userId !== this.owner.userId) {
      throw new ForbiddenError('Callback scope denied.');
    }
    return this.db.withScopedTransaction(this.owner, async tx => {
      const { rows } = await tx.query<{ workspace_id: string; user_id: string; role: string }>(
        'SELECT workspace_id,user_id,role FROM public.resolve_session_scope($1)', [this.owner.sessionTokenHash]);
      if (rows.length !== 1 || rows[0]?.workspace_id !== scope.workspaceId || rows[0]?.user_id !== scope.userId || rows[0]?.role !== 'owner') {
        throw new ForbiddenError('Callback owner session denied.');
      }
      return work(tx);
    });
  }

  private audit(tx: DbClient, scope: CallbackScope, event: string, requestId: string, status: string) {
    return new AuditEventRepository(tx).create(scope.workspaceId, event, 'phone_callback_request', { requestId, status }, scope.userId, requestId);
  }

  async save(request: CallbackRequest) {
    const snapshot = structuredClone(request);
    const { id, workspaceId, userId, callId, direction, occurredAt, name, business, service, phoneNumber, numberSource, notificationStatus } = snapshot;
    if (snapshot.status !== 'requested' || !['pending', 'needs_review'].includes(notificationStatus) ||
        snapshot.attempts !== 0 || snapshot.notificationAttemptId !== null || snapshot.providerMessageId !== null) throw new ForbiddenError('Invalid callback state.');
    const hash = computeCanonicalParameterHash({ ...snapshot });
    return this.run(snapshot, async tx => {
      const params = [workspaceId, userId, id];
      const inserted = await tx.query<Row>(`INSERT INTO ${table}
        (workspace_id,owner_user_id,request_id,call_id,direction,request_hash,details,occurred_at,request_status,notification_status,attempts)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'requested',$9,0) ON CONFLICT DO NOTHING RETURNING ${projection}`,
      [...params, callId, direction, hash, JSON.stringify({ name, business, service, phoneNumber, numberSource }), occurredAt, notificationStatus]);
      if (inserted.rows[0]) {
        await this.audit(tx, snapshot, 'phone.callback.saved', id, notificationStatus);
        return inserted.rows[0].request;
      }
      const existing = (await tx.query<Row>(`SELECT ${projection} FROM ${table} WHERE ${where}`, params)).rows[0];
      if (!existing || existing.hash !== hash) throw new ConflictError('Callback replay differs from the saved request.');
      return existing.request;
    });
  }

  read(scope: CallbackScope, id: string) {
    return this.run(scope, async tx => (await tx.query<Row>(`SELECT ${projection} FROM ${table} WHERE ${where}`,
      [scope.workspaceId, scope.userId, id])).rows[0]?.request ?? null);
  }

  claim(scope: CallbackScope, id: string, attempt: string, approvalId?: string) {
    return this.run(scope, async tx => {
      if (approvalId) {
        const authorization = await tx.query(`SELECT g.approval_id FROM public.phone_callback_notification_grants g
          JOIN public.approval_requests a ON a.id=g.approval_id AND a.workspace_id=g.workspace_id
          WHERE g.workspace_id=$1 AND g.owner_user_id=$2 AND g.approval_id=$3 AND g.revoked_at IS NULL
          AND g.expires_at>clock_timestamp() AND a.status='approved' AND a.action_name=$4
          AND a.requester_user_id=g.owner_user_id AND a.approver_user_id=g.owner_user_id
          AND a.action_params=g.approved_params FOR SHARE OF g,a`,
        [scope.workspaceId, scope.userId, approvalId, PHONE_CALLBACK_GRANT_ACTION]);
        if (!authorization.rows.length) return null;
      }
      const result = await tx.query<{ attempts: number }>(`UPDATE ${table} SET notification_status='sending',notification_attempt_id=$4,attempts=attempts+1,sending_started_at=clock_timestamp()
        WHERE ${where} AND request_status='requested' AND notification_status='pending' AND attempts<2 AND next_attempt_at<=clock_timestamp() RETURNING attempts`,
      [scope.workspaceId, scope.userId, id, attempt]);
      if (!result.rows[0]) return null;
      await this.audit(tx, scope, 'phone.callback.notification_claimed', id, 'sending');
      return result.rows[0].attempts;
    });
  }

  async finish(scope: CallbackScope, id: string, attempt: string, result: NotificationResult, providerMessageId?: string) {
    await this.run(scope, async tx => {
      const updated = await tx.query(`UPDATE ${table} SET notification_status=$5,provider_message_id=$6,
        next_attempt_at=CASE WHEN $5='pending' THEN clock_timestamp()+interval '60 seconds' ELSE next_attempt_at END
        WHERE ${where} AND notification_status='sending' AND notification_attempt_id=$4 AND ($5<>'pending' OR attempts<2) RETURNING request_id`,
      [scope.workspaceId, scope.userId, id, attempt, result, providerMessageId ?? null]);
      if (updated.rows.length !== 1) throw new ConflictError('Callback notification attempt no longer matches.');
      await this.audit(tx, scope, 'phone.callback.notification_result', id, result);
    });
  }

  list(scope: CallbackScope) {
    return this.run(scope, async tx => (await tx.query<Row>(`SELECT ${projection} FROM ${table}
      WHERE workspace_id=$1 AND owner_user_id=$2 ORDER BY occurred_at DESC,request_id LIMIT 100`, [scope.workspaceId, scope.userId])).rows.map(row => row.request));
  }

  pending(scope: CallbackScope) {
    return this.run(scope, async tx => (await tx.query<{ id: string }>(`SELECT request_id AS id FROM ${table}
      WHERE workspace_id=$1 AND owner_user_id=$2 AND request_status='requested' AND notification_status='pending'
      AND attempts<2 AND next_attempt_at<=clock_timestamp() ORDER BY next_attempt_at,request_id LIMIT 25`, [scope.workspaceId, scope.userId])).rows.map(row => row.id));
  }

  async recoverInterrupted(scope: CallbackScope) {
    await this.run(scope, async tx => {
      const rows = (await tx.query<{ id: string }>(`UPDATE ${table} SET notification_status='unverified'
        WHERE workspace_id=$1 AND owner_user_id=$2 AND notification_status='sending'
        AND sending_started_at<clock_timestamp()-interval '5 minutes' RETURNING request_id AS id`, [scope.workspaceId, scope.userId])).rows;
      for (const row of rows) await this.audit(tx, scope, 'phone.callback.notification_interrupted', row.id, 'unverified');
    });
  }

  prepareNotificationGrant(scope: CallbackScope, expiresAt: string) {
    const expiry = Date.parse(expiresAt);
    const now = Date.now();
    if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 30 * 86_400_000) {
      throw new ForbiddenError('Callback notification authorization must expire within thirty days.');
    }
    const parameters = { enabled: true, sender: PHONE_CALLBACK_SENDER, recipient: PHONE_CALLBACK_RECIPIENT,
      expiresAt: new Date(expiry).toISOString() };
    return this.run(scope, async tx => {
      const approval = await new ApprovalRepository(tx).create(scope.workspaceId, PHONE_CALLBACK_GRANT_ACTION,
        parameters, scope.userId, 'high', 900);
      return { approvalId: approval.id, status: 'awaiting_approval' as const, parameters };
    });
  }

  activateNotificationGrant(scope: CallbackScope, approvalId: string) {
    return this.run(scope, async tx => {
      await tx.query('SELECT id FROM public.approval_requests WHERE workspace_id=$1 AND id=$2 FOR SHARE', [scope.workspaceId, approvalId]);
      const approval = await new ApprovalRepository(tx).findById(scope.workspaceId, approvalId);
      if (!approval || approval.requester_user_id !== scope.userId || approval.approver_user_id !== scope.userId) {
        throw new ForbiddenError('Callback notification owner approval is required.');
      }
      const allowed = phoneCallbackGrantPolicy.evaluate({ ...scope, role: 'owner' }, {
        actionName: PHONE_CALLBACK_GRANT_ACTION, parameters: approval.action_params, idempotencyKey: approvalId,
      }, { id: approval.id, workspaceId: approval.workspace_id, actionName: approval.action_name, actionParams: approval.action_params,
        requesterUserId: approval.requester_user_id, approverUserId: approval.approver_user_id, status: approval.status,
        riskLevel: approval.risk_level, expiresAt: new Date(approval.expires_at).toISOString(),
        createdAt: new Date(approval.created_at).toISOString(), updatedAt: new Date(approval.updated_at).toISOString() }, scope.userId);
      if (!allowed.allowed) throw new ForbiddenError('Callback notification approval did not pass policy.');
      const result = await tx.query(`INSERT INTO public.phone_callback_notification_grants
        (workspace_id,owner_user_id,approval_id,approved_params,expires_at)
        VALUES ($1,$2,$3,$4::jsonb,$5)
        ON CONFLICT (workspace_id,owner_user_id) DO UPDATE SET approval_id=excluded.approval_id,
        approved_params=excluded.approved_params,expires_at=excluded.expires_at,created_at=clock_timestamp(),revoked_at=NULL
        WHERE phone_callback_notification_grants.approval_id<>excluded.approval_id RETURNING approval_id`,
      [scope.workspaceId, scope.userId, approvalId, JSON.stringify(approval.action_params), approval.action_params.expiresAt]);
      if (!result.rows.length) {
        const current = await tx.query('SELECT approval_id FROM public.phone_callback_notification_grants WHERE workspace_id=$1 AND owner_user_id=$2 AND approval_id=$3 AND revoked_at IS NULL',
          [scope.workspaceId, scope.userId, approvalId]);
        if (!current.rows.length) throw new ForbiddenError('A revoked notification authorization needs a new approval.');
      } else await this.audit(tx, scope, 'phone.callback.notification_authorized', approvalId, 'enabled');
      return { enabled: true as const, approvalId };
    });
  }

  currentOwnerGrant(scope: CallbackScope) {
    return this.run(scope, async tx => (await tx.query<{ grant: CallbackNotificationGrant }>(`SELECT jsonb_build_object(
      'workspaceId',g.workspace_id,'userId',g.owner_user_id,'approvedByUserId',g.owner_user_id,'enabled',true,'approvalId',g.approval_id,
      'sender',g.approved_params->>'sender','recipient',g.approved_params->>'recipient','expiresAt',g.approved_params->>'expiresAt') AS grant
      FROM public.phone_callback_notification_grants g JOIN public.approval_requests a ON a.id=g.approval_id AND a.workspace_id=g.workspace_id
      WHERE g.workspace_id=$1 AND g.owner_user_id=$2 AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()
      AND a.status='approved' AND a.requester_user_id=g.owner_user_id AND a.approver_user_id=g.owner_user_id
      AND a.action_name=$3 AND a.action_params=g.approved_params`, [scope.workspaceId, scope.userId, PHONE_CALLBACK_GRANT_ACTION])).rows[0]?.grant ?? null);
  }

  async revokeNotificationGrant(scope: CallbackScope) {
    await this.run(scope, async tx => {
      const result = await tx.query<{ approval_id: string }>(`UPDATE public.phone_callback_notification_grants SET revoked_at=clock_timestamp()
        WHERE workspace_id=$1 AND owner_user_id=$2 AND revoked_at IS NULL RETURNING approval_id`, [scope.workspaceId, scope.userId]);
      if (result.rows[0]) await this.audit(tx, scope, 'phone.callback.notification_revoked', result.rows[0].approval_id, 'disabled');
    });
  }
}
