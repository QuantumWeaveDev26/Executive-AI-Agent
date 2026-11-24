// Step 108.13 — add the receive-only Meta test-number connection to the existing pilot owner and
// move the existing events-only n8n relay principal onto it (no new token, nothing to copy).
// RUN ONLY AFTER EXPLICIT OWNER APPROVAL. Values come from a non-secret params file the owner confirmed.
import { readFileSync } from 'node:fs';
import { PILOT_SEED } from './pilot-seed.mjs';
export const META_CONNECTION_ID = 'wa_pilot_meta_test_10813';
const deny = () => { throw Error('Pilot Meta connection denied'); };

export function validateMetaParams(p) {
  const keys = Object.keys(p ?? {}).sort().join(',');
  if (keys !== 'businessAccountId,graphVersion,ownerPhoneE164,phoneNumberId') deny();
  if (!/^[0-9]{6,20}$/.test(p.phoneNumberId) || !/^[0-9]{6,20}$/.test(p.businessAccountId) || p.phoneNumberId === p.businessAccountId) deny();
  if (p.phoneNumberId === PILOT_SEED.phoneNumberId || p.businessAccountId === PILOT_SEED.businessAccountId) deny();
  if (!/^v[2-9][0-9]\.0$/.test(p.graphVersion) || !/^\+[1-9][0-9]{7,14}$/.test(p.ownerPhoneE164) || p.ownerPhoneE164.startsWith('+1555')) deny();
  return Object.freeze({ ...p });
}

export async function addMetaConnection({ db, adminUrl, appUrl, params }) {
  const p = validateMetaParams(params);
  const admin = new db.PostgresDatabase(adminUrl), app = new db.PostgresDatabase(appUrl);
  let sessionId;
  try {
    const who = (await admin.query('SELECT current_database() AS db,current_user AS actor')).rows[0];
    if (who?.db !== 'thaara_vps_pilot' || who.actor !== 'postgres') deny();
    // Exactly the 108.12 state: one pilot owner, only the synthetic connection, one live events-only principal.
    const owner = (await admin.query(`SELECT w.id AS workspace_id,u.id AS user_id FROM workspaces w JOIN memberships m ON m.workspace_id=w.id AND m.role='owner'
      JOIN users u ON u.id=m.user_id WHERE w.name=$1 AND u.email=$2`, [PILOT_SEED.workspaceName, PILOT_SEED.ownerEmail])).rows;
    const conns = (await admin.query('SELECT connection_id FROM public.whatsapp_n8n_connections ORDER BY connection_id')).rows.map(r => r.connection_id);
    const principals = (await admin.query(`SELECT id,connection_id,allowed_operations FROM public.whatsapp_n8n_relay_principals
      WHERE enabled AND revoked_at IS NULL AND expires_at>clock_timestamp()`)).rows;
    if (owner.length !== 1 || conns.join(',') !== PILOT_SEED.connectionId || principals.length !== 1
      || principals[0].connection_id !== PILOT_SEED.connectionId || principals[0].allowed_operations.join(',') !== 'events') deny();
    const { workspace_id: workspaceId, user_id: userId } = owner[0];
    const sessionToken = db.generateSessionToken();
    sessionId = (await new db.SessionRepository(admin).create(userId, workspaceId, sessionToken, 600)).id;
    const scope = { workspaceId, userId, role: 'owner', sessionTokenHash: db.hashSessionToken(sessionToken) };
    await new db.PostgresWhatsAppStateStore(app).createOffline(scope, {
      mode: 'offline_test', connectionId: META_CONNECTION_ID, revision: 1, workspaceId, userId,
      businessAccountId: p.businessAccountId, phoneNumberId: p.phoneNumberId, graphVersion: p.graphVersion,
      recipients: [{ id: 'owner_test_phone', phoneE164: p.ownerPhoneE164, optedIn: true }]
    });
    await new db.SessionRepository(admin).revoke(sessionId); sessionId = undefined;
    const moved = await admin.query(`UPDATE public.whatsapp_n8n_relay_principals SET connection_id=$1
      WHERE id=$2 AND connection_id=$3 AND allowed_operations=ARRAY['events'] RETURNING id,expires_at`, [META_CONNECTION_ID, principals[0].id, PILOT_SEED.connectionId]);
    if (moved.rows.length !== 1) deny();
    return { connectionId: META_CONNECTION_ID, principalId: moved.rows[0].id, allowedOperations: ['events'], expiresAt: new Date(moved.rows[0].expires_at).toISOString(), recipients: 1 };
  } finally {
    if (sessionId) await new db.SessionRepository(admin).revoke(sessionId).catch(() => {});
    await app.close().catch(() => {}); await admin.close().catch(() => {});
  }
}

if (process.argv[1]?.endsWith('pilot-meta-connection.mjs') && process.argv[2] === '--approved') {
  try {
    if (process.env.THAARA_PILOT_META_ACK !== 'receive_only_10813') deny();
    const secret = n => { const v = readFileSync('/run/secrets/' + n, 'utf8').trim(); if (!/^[A-Za-z0-9_-]{32,256}$/.test(v)) deny(); return v; };
    const db = await import('@thaara/db');
    const result = await addMetaConnection({ db, params: JSON.parse(readFileSync('/params/meta-test-params.json', 'utf8')),
      adminUrl: `postgresql://postgres:${encodeURIComponent(secret('admin_password'))}@postgres:5432/thaara_vps_pilot`,
      appUrl: `postgresql://thaara_app:${encodeURIComponent(secret('api_password'))}@postgres:5432/thaara_vps_pilot` });
    console.log(JSON.stringify(result));
  } catch { console.error('Pilot Meta connection stopped. No secret or raw database error is logged.'); process.exitCode = 1; }
}
