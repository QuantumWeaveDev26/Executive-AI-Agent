// Step 108.16 owner terminal commands (the pilot has no hosted UI/login yet).
//   prepare "<text>"   -> server-built reply draft + PENDING high-risk approval (nothing reserved or sent)
//   approve <id>       -> the OWNER's explicit approval: approve, reserve, hand over to the Thaara outgoing workflow
// Every send rule stays server-side: exact approval, 24 h window, single recipient, approved test cap, profile expiry.
import { readFileSync } from 'node:fs';
import { PILOT_SEED } from './pilot-seed.mjs';
export const SEND_CONNECTION_ID = 'wa_pilot_meta_test_10813b';
const RECIPIENT = 'owner_test_phone', ACTION = 'whatsapp.meta.messages.send';
const deny = m => { throw Error(m); };

async function ownerScope(db, admin) {
  const rows = (await admin.query(`SELECT w.id AS workspace_id,u.id AS user_id FROM workspaces w JOIN memberships m ON m.workspace_id=w.id AND m.role='owner'
    JOIN users u ON u.id=m.user_id WHERE w.name=$1 AND u.email=$2`, [PILOT_SEED.workspaceName, PILOT_SEED.ownerEmail])).rows;
  if (rows.length !== 1) deny('Pilot owner not found');
  const token = db.generateSessionToken(), session = await new db.SessionRepository(admin).create(rows[0].user_id, rows[0].workspace_id, token, 600);
  return { scope: { workspaceId: rows[0].workspace_id, userId: rows[0].user_id, role: 'owner', sessionTokenHash: db.hashSessionToken(token) }, sessionId: session.id };
}

export async function prepareReply({ db, admin, app, durable, text }) {
  if (typeof text !== 'string' || !text.trim() || text.length > 1000) deny('Reply text must be 1-1000 characters');
  const { scope, sessionId } = await ownerScope(db, admin);
  try {
    const { draft } = await durable.replyDraft(scope, SEND_CONNECTION_ID, { recipientId: RECIPIENT, bodyText: text });
    const approval = await app.withScopedTransaction(scope, tx => new db.ApprovalRepository(tx).create(scope.workspaceId, ACTION, draft, scope.userId, 'high', 900));
    return { approvalId: approval.id, text: draft.bodyText, expiresInMinutes: 15, sent: false };
  } finally { await new db.SessionRepository(admin).revoke(sessionId).catch(() => {}); }
}

// Never echo free-form provider strings: even allowed fields can contain credentials or false success claims.
export function sanitizeWorkflowAnswer(value) {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const out = {};
  if (['failed', 'failed_before_provider_acceptance', 'not_configured', 'unverified'].includes(v.status)) out.status = v.status;
  if (v.verified !== undefined) out.verified = false;
  const code = typeof v.providerErrorCode === 'string' || typeof v.providerErrorCode === 'number' ? String(v.providerErrorCode) : '';
  if (v.providerErrorCode !== undefined && v.providerErrorCode !== null) out.providerErrorCode = /^\d{1,6}$/.test(code) ? code : 'unknown';
  if (v.providerErrorMessage !== undefined && v.providerErrorMessage !== null) {
    const text = typeof v.providerErrorMessage === 'string' ? v.providerErrorMessage.slice(0, 2000) : '';
    out.providerErrorMessage = code === '190' || /authorization failed|invalid.*token|access token.*expired|authentication failed/i.test(text)
      ? 'Provider authentication failed.' : code === '131030' ? 'Recipient is not allowed for this sender.'
      : code === '131047' ? 'The customer-service window is closed; an approved template may be required.'
      : 'Provider error details are unavailable in the safe report; check diagnostics privately.';
  }
  return out;
}
export async function approveReply({ db, admin, app, durable, approvalId }) {
  if (!/^[0-9a-f-]{36}$/.test(approvalId ?? '')) deny('Approval ID required');
  const { scope, sessionId } = await ownerScope(db, admin);
  try {
    const approval = await app.withScopedTransaction(scope, async tx => {
      const repo = new db.ApprovalRepository(tx), a = await repo.findById(scope.workspaceId, approvalId);
      if (!a || a.status !== 'pending' || a.action_name !== ACTION || a.action_params?.connectionId !== SEND_CONNECTION_ID || a.action_params?.recipientId !== RECIPIENT) deny('Approval not found or not pending');
      await repo.transitionStatus(scope.workspaceId, approvalId, 'pending', 'approved', scope.userId);
      return a;
    });
    const receipt = await durable.reserve(scope, SEND_CONNECTION_ID, approval.action_params, approvalId);
    return { dispatchId: receipt.dispatchId, status: receipt.status, verified: receipt.verified };
  } finally { await new db.SessionRepository(admin).revoke(sessionId).catch(() => {}); }
}

if (process.argv[1]?.endsWith('pilot-send-cli.mjs')) {
  const [mode, arg] = process.argv.slice(2);
  let admin, app;
  try {
    if (process.env.THAARA_PILOT_SEND_CLI_ACK !== 'controlled_send_10816' || !['prepare', 'approve'].includes(mode)) deny('Usage: prepare "<text>" | approve <approvalId>');
    const secret = n => { const v = readFileSync('/run/secrets/' + n, 'utf8').trim(); if (!/^[A-Za-z0-9_-]{32,256}$/.test(v)) deny('secret'); return v; };
    const db = await import('@thaara/db'), { defaultPolicyGateway } = await import('@thaara/policy');
    const { DurableWhatsAppService } = await import('./dist/services/whatsapp-durable.js');
    admin = new db.PostgresDatabase(`postgresql://postgres:${encodeURIComponent(secret('admin_password'))}@postgres:5432/thaara_vps_pilot`);
    app = new db.PostgresDatabase(`postgresql://thaara_app:${encodeURIComponent(secret('api_password'))}@postgres:5432/thaara_vps_pilot`);
    let send; const handover = {};
    if (mode === 'approve') {
      const { pilotSendSettings } = await import('./pilot-config.mjs'), { createPilotWhatsAppDispatcher, PILOT_N8N_ORIGIN } = await import('./dist/services/whatsapp-pilot-dispatch.js');
      const s = pilotSendSettings({ THAARA_WHATSAPP_SEND_ENABLED: 'true' });
      createPilotWhatsAppDispatcher(s.dispatch); // same configuration validation as the API transport
      // Same request as the API transport, but the sanitized workflow answer is shown to the owner.
      const dispatcher = { async submit({ revision, dispatchId }) {
        const r = await fetch(PILOT_N8N_ORIGIN + s.dispatch.webhookPath, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
          headers: { 'content-type': 'application/json', [s.dispatch.headerName]: s.dispatch.secret }, body: JSON.stringify({ dispatchId, connectionRevision: revision }) });
        handover.httpStatus = r.status; try { handover.workflow = sanitizeWorkflowAnswer(await r.json()); } catch { /* non-JSON answer */ }
        if (!r.ok) throw Error('handover not accepted');
      } };
      send = { profile: () => s.profile, dispatcher };
    }
    const durable = new DurableWhatsAppService(new db.PostgresWhatsAppStateStore(app), defaultPolicyGateway, Date.now, send);
    const out = mode === 'prepare' ? await prepareReply({ db, admin, app, durable, text: arg }) : await approveReply({ db, admin, app, durable, approvalId: arg });
    console.log(JSON.stringify(mode === 'approve' ? { ...out, handover } : out));
  } catch { console.error('Stopped. Send outcome is unknown; check the stored receipt before any retry.'); process.exitCode = 1; }
  finally { await app?.close().catch(() => {}); await admin?.close().catch(() => {}); }
}
