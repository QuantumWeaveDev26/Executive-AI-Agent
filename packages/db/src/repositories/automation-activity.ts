import type { AutomationActivityEvent, AutomationActivityQuery, AutomationActivityResponse } from '@thaara/contracts';
import { DbClient } from '../migrator.js';

const HISTORY_NOTICE = 'Oldest first. Only retained events and records are shown; record observations are not a complete transition history. Offline verification does not confirm external deployment or email delivery.';

// Association comes ONLY from scoped relational IDs, never planId/stepId strings inside audit payloads.
// Arbitrary payloads, action parameters, proof, lease tokens, worker IDs and free-form errors are not selected.
const ACTIVITY_SQL = `
WITH steps AS (
  SELECT id, step_index, status, updated_at FROM public.plan_steps WHERE workspace_id=$1 AND plan_id=$2
), approvals AS (
  SELECT a.id, b.step_id, a.status, a.created_at, a.updated_at
  FROM public.plan_step_approval_bindings b
  JOIN public.approval_requests a ON a.workspace_id=b.workspace_id AND a.id=b.approval_request_id
  WHERE b.workspace_id=$1 AND b.plan_id=$2
), receipts AS (
  SELECT r.id, r.plan_step_id, r.status, r.issued_at
  FROM public.receipts r JOIN steps s ON s.id=r.plan_step_id WHERE r.workspace_id=$1 AND r.plan_id=$2
), executions AS (
  SELECT x.id, x.step_id, x.started_at, x.attempt_number
  FROM public.step_executions x JOIN steps s ON s.id=x.step_id WHERE x.workspace_id=$1 AND x.plan_id=$2
), linked_audit AS (
  SELECT e.id, e.created_at, e.action, e.payload->>'status' AS submitted_status,
    e.payload->>'receiptStatus' AS receipt_status,
    CASE WHEN e.payload->>'attemptNumber' ~ '^[1-9][0-9]{0,8}$'
      THEN (e.payload->>'attemptNumber')::integer ELSE NULL END AS attempt_number, COALESCE(s.id,a.step_id) AS step_id,
    a.id AS approval_id, COALESCE(s.step_index,aps.step_index) AS step_index
  FROM public.audit_events e
  LEFT JOIN steps s ON e.target_type='plan_step' AND e.target_id=s.id::text
  LEFT JOIN approvals a ON e.target_type='approval_request' AND e.target_id=a.id::text
  LEFT JOIN steps aps ON aps.id=a.step_id
  WHERE e.workspace_id=$1 AND (
    (e.target_type='plan' AND e.target_id=$2::text AND e.action IN
      ('plan.created','plan.submitted','plan.completed','plan.cancelled','plan.failed'))
    OR (s.id IS NOT NULL AND e.action IN
      ('plan.step_added','step.queued','step.started','step.retry_scheduled','step.verified','step.failed','step.unverified','step.not_configured','step.policy_rejected'))
    OR (a.id IS NOT NULL AND e.action IN ('approval.created','approval.approved','approval.rejected','approval.expired'))
  )
), normalized_audit AS (
  SELECT *,
    CASE WHEN action='plan.step_added' THEN 'step.created'
      WHEN action='step.verified' THEN 'step.completed'
      WHEN action='step.policy_rejected' THEN 'step.failed'
      WHEN action='approval.created' THEN 'approval.requested'
      WHEN action='step.failed' AND receipt_status='unverified' THEN 'step.unverified'
      WHEN action='step.failed' AND receipt_status='not_configured' THEN 'step.not_configured'
      ELSE action END AS event_type
  FROM linked_audit a
  WHERE a.action<>'step.policy_rejected' OR NOT EXISTS (
    SELECT 1 FROM linked_audit outcome WHERE outcome.step_id=a.step_id AND outcome.action='step.failed'
  )
), audit_rows AS (
  SELECT 'audit:'||a.id AS id, a.created_at AS timestamp, a.event_type,
    CASE WHEN a.event_type='step.retry_scheduled' THEN 'queued'
      WHEN a.event_type='step.completed' THEN 'verified'
      WHEN a.event_type='approval.requested' THEN 'pending'
      WHEN a.event_type='plan.submitted' THEN CASE
        WHEN a.submitted_status IN ('draft','awaiting_approval','queued','running','paused','completed','failed','cancelled')
        THEN a.submitted_status ELSE 'submitted' END
      ELSE split_part(a.event_type,'.',2) END AS status,
    'audit'::text AS source, a.step_id, a.approval_id, r.id AS receipt_id, a.step_index,
    a.attempt_number, CASE WHEN a.event_type='step.started' THEN
      'Execution attempt started; this does not confirm adapter dispatch.'
      WHEN a.event_type='step.retry_scheduled' THEN
      'Retry scheduled after an attempt; another execution is not yet confirmed.'
      ELSE 'Persisted audit event.' END::text AS details
  FROM normalized_audit a
  LEFT JOIN receipts r ON r.plan_step_id=a.step_id AND (
    (a.event_type='step.completed' AND r.status='verified') OR (a.event_type='step.failed' AND r.status='failed')
    OR (a.event_type='step.unverified' AND r.status='unverified') OR (a.event_type='step.not_configured' AND r.status='not_configured')
  )
), record_rows AS (
  SELECT 'plan-created:'||p.id AS id, p.created_at AS timestamp, 'plan.created'::text AS event_type,
    'created'::text AS status, 'plan_record'::text AS source, NULL::uuid AS step_id,
    NULL::uuid AS approval_id, NULL::uuid AS receipt_id, NULL::integer AS step_index, NULL::integer AS attempt_number,
    'Creation time from the persisted plan record.'::text AS details
  FROM public.plans p WHERE p.workspace_id=$1 AND p.id=$2
    AND NOT EXISTS (SELECT 1 FROM audit_rows WHERE event_type='plan.created')
  UNION ALL
  SELECT 'plan-state:'||p.id, p.updated_at, 'plan.'||p.status, p.status, 'plan_record', NULL::uuid,
    NULL::uuid, NULL::uuid, NULL::integer, NULL::integer, 'Latest terminal plan record; earlier transitions may not be retained.'
  FROM public.plans p WHERE p.workspace_id=$1 AND p.id=$2 AND p.status IN ('completed','cancelled','failed')
    AND NOT EXISTS (SELECT 1 FROM audit_rows WHERE event_type='plan.'||p.status)
  UNION ALL
  SELECT 'approval-request:'||a.id, a.created_at, 'approval.requested', 'pending', 'approval_record',
    a.step_id,a.id,NULL::uuid,s.step_index,NULL::integer,'Request creation time from the bound approval record.'
  FROM approvals a JOIN steps s ON s.id=a.step_id
  WHERE NOT EXISTS (SELECT 1 FROM audit_rows e WHERE e.approval_id=a.id AND e.event_type='approval.requested')
  UNION ALL
  SELECT 'approval-state:'||a.id, a.updated_at,
    CASE WHEN a.status IN ('approved','rejected','expired') THEN 'approval.'||a.status ELSE 'approval.status_observed' END,
    a.status,'approval_record',a.step_id,a.id,NULL::uuid,s.step_index,NULL::integer,
    'Latest approval record; earlier decisions may not be retained.'
  FROM approvals a JOIN steps s ON s.id=a.step_id WHERE a.status<>'pending'
    AND NOT EXISTS (SELECT 1 FROM audit_rows e WHERE e.approval_id=a.id AND e.status=a.status)
  UNION ALL
  SELECT 'execution:'||x.id, x.started_at, 'step.started','started','execution_record',
    x.step_id,NULL::uuid,NULL::uuid,s.step_index,x.attempt_number,
    'Start time of the latest retained execution attempt; earlier attempts may not be retained.'
  FROM executions x JOIN steps s ON s.id=x.step_id
  WHERE NOT EXISTS (SELECT 1 FROM audit_rows e WHERE e.step_id=x.step_id AND e.event_type='step.started' AND (e.timestamp=x.started_at OR e.attempt_number=x.attempt_number))
  UNION ALL
  SELECT 'receipt:'||r.id, r.issued_at,
    CASE WHEN r.status='verified' THEN 'step.completed' ELSE 'step.'||r.status END,
    r.status,'receipt',r.plan_step_id,NULL::uuid,r.id,s.step_index,NULL::integer,
    'Outcome from an immutable execution receipt. Raw proof is excluded.'
  FROM receipts r JOIN steps s ON s.id=r.plan_step_id
  WHERE NOT EXISTS (SELECT 1 FROM audit_rows e WHERE e.receipt_id=r.id)
  UNION ALL
  SELECT 'step-state:'||s.id,s.updated_at,
    CASE WHEN s.status='queued' THEN 'step.queued' ELSE 'step.status_observed' END,
    s.status,'step_record',s.id,NULL::uuid,NULL::uuid,s.step_index,NULL::integer,
    'Latest recorded step state at its update time; this is not a historical transition event.'
  FROM steps s WHERE s.status<>'blocked'
    AND NOT EXISTS (SELECT 1 FROM audit_rows e WHERE e.step_id=s.id AND
      (e.status=s.status OR (s.status='running' AND e.status='started')))
    AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.plan_step_id=s.id)
    AND NOT (s.status='running' AND EXISTS (SELECT 1 FROM executions x WHERE x.step_id=s.id))
)
SELECT * FROM (SELECT * FROM audit_rows UNION ALL SELECT * FROM record_rows) events
ORDER BY timestamp ASC,id ASC LIMIT $3 OFFSET $4
`;

export class AutomationActivityRepository {
  constructor(private client: DbClient) {}

  async list(workspaceId: string, planId: string, options: AutomationActivityQuery = {}): Promise<AutomationActivityResponse | null> {
    const plan = await this.client.query<{id:string}>(`
      SELECT p.id FROM public.plans p WHERE p.workspace_id=$1 AND p.id=$2 AND EXISTS (
        SELECT 1 FROM public.plan_steps s WHERE s.workspace_id=p.workspace_id AND s.plan_id=p.id
        AND s.action_name LIKE 'automation.%')`, [workspaceId,planId]);
    if (!plan.rows[0]) return null;
    const limit=options.limit ?? 20, offset=options.offset ?? 0;
    const result=await this.client.query<AutomationActivityEvent>(ACTIVITY_SQL,[workspaceId,planId,limit+1,offset]);
    return {items:result.rows.slice(0,limit),nextOffset:result.rows.length>limit?offset+limit:null,historyNotice:HISTORY_NOTICE};
  }
}
