// Step 108.12 — one-time synthetic pilot owner, offline_test WhatsApp connection and
// events-only n8n relay principal. RUN ONLY AFTER EXPLICIT OWNER APPROVAL.
// Synthetic identifiers only (no real Meta assets). The relay token is written once to a
// root-handoff file for the owner to copy into their own n8n credential; only its hash is stored.
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
export const PILOT_SEED = Object.freeze({
  workspaceName: 'Thaara Pilot Synthetic 10812',
  ownerEmail: 'pilot-owner-10812@thaara-pilot.invalid',
  connectionId: 'wa_pilot_synthetic_10812',
  businessAccountId: '900080007000', phoneNumberId: '100020003000', graphVersion: 'v26.0',
  recipients: [{ id: 'synthetic_ram', phoneE164: '+15550000001', optedIn: true }],
  allowedOperations: ['events'], principalDays: 29
});
const deny = () => { throw Error('Pilot seed denied'); };

export async function seedPilot({ db, adminUrl, appUrl, writeToken }) {
  const admin = new db.PostgresDatabase(adminUrl), app = new db.PostgresDatabase(appUrl);
  let sessionId;
  try {
    const who = (await admin.query('SELECT current_database() AS db,current_user AS actor')).rows[0];
    const actor = (await app.query('SELECT current_database() AS db,current_user AS actor')).rows[0];
    if (who?.db !== 'thaara_vps_pilot' || who.actor !== 'postgres' || actor?.db !== 'thaara_vps_pilot' || actor.actor !== 'thaara_app') deny();
    // Fresh-only: never adopt or overwrite existing identities, connections or principals.
    const existing = (await admin.query(`SELECT (SELECT count(*) FROM workspaces)::int AS w,(SELECT count(*) FROM users)::int AS u,
      (SELECT count(*) FROM public.whatsapp_n8n_connections)::int AS c,(SELECT count(*) FROM public.whatsapp_n8n_relay_principals)::int AS p`)).rows[0];
    if (existing.w || existing.u || existing.c || existing.p) deny();
    const workspace = await new db.WorkspaceRepository(admin).create(PILOT_SEED.workspaceName);
    const user = await new db.UserRepository(admin).create(PILOT_SEED.ownerEmail, 'synthetic-unused-hash-no-login', 'Pilot Synthetic Owner');
    await new db.MembershipRepository(admin).create(workspace.id, user.id, 'owner');
    // A short-lived owner session is needed only for the audited connection insert, then revoked.
    const sessionToken = db.generateSessionToken();
    const session = await new db.SessionRepository(admin).create(user.id, workspace.id, sessionToken, 600); sessionId = session.id;
    const scope = { workspaceId: workspace.id, userId: user.id, role: 'owner', sessionTokenHash: db.hashSessionToken(sessionToken) };
    await new db.PostgresWhatsAppStateStore(app).createOffline(scope, {
      mode: 'offline_test', connectionId: PILOT_SEED.connectionId, revision: 1, workspaceId: workspace.id, userId: user.id,
      businessAccountId: PILOT_SEED.businessAccountId, phoneNumberId: PILOT_SEED.phoneNumberId, graphVersion: PILOT_SEED.graphVersion,
      recipients: PILOT_SEED.recipients.map(r => ({ ...r }))
    });
    await new db.SessionRepository(admin).revoke(sessionId); sessionId = undefined;
    const relayToken = randomBytes(32).toString('base64url');
    const principalId = randomUUID();
    const expires = (await admin.query(`INSERT INTO public.whatsapp_n8n_relay_principals(id,workspace_id,owner_user_id,connection_id,revision,token_hash,allowed_operations,enabled,expires_at)
      VALUES($1,$2,$3,$4,1,$5,$6,true,clock_timestamp()+make_interval(days=>$7)) RETURNING expires_at`,
      [principalId, workspace.id, user.id, PILOT_SEED.connectionId, createHash('sha256').update(relayToken).digest('hex'), PILOT_SEED.allowedOperations, PILOT_SEED.principalDays])).rows[0].expires_at;
    writeToken(relayToken);
    return { workspaceId: workspace.id, userId: user.id, connectionId: PILOT_SEED.connectionId, principalId, allowedOperations: PILOT_SEED.allowedOperations, expiresAt: new Date(expires).toISOString() };
  } finally {
    if (sessionId) await new db.SessionRepository(admin).revoke(sessionId).catch(() => {});
    await app.close().catch(() => {}); await admin.close().catch(() => {});
  }
}

// Container entrypoint: node pilot-seed.mjs --approved (mounted into /app/apps/api so @thaara/db resolves).
if (process.argv[1]?.endsWith('pilot-seed.mjs') && process.argv[2] === '--approved') {
  try {
    if (process.env.THAARA_PILOT_SEED_ACK !== 'synthetic_relay_10812') deny();
    const secret = n => { const v = readFileSync('/run/secrets/' + n, 'utf8').trim(); if (!/^[A-Za-z0-9_-]{32,256}$/.test(v)) deny(); return v; };
    const db = await import('@thaara/db');
    const result = await seedPilot({ db,
      adminUrl: `postgresql://postgres:${encodeURIComponent(secret('admin_password'))}@postgres:5432/thaara_vps_pilot`,
      appUrl: `postgresql://thaara_app:${encodeURIComponent(secret('api_password'))}@postgres:5432/thaara_vps_pilot`,
      writeToken: t => writeFileSync('/handoff/n8n_relay_token', t + '\n', { mode: 0o400, flag: 'wx' }) });
    console.log(JSON.stringify(result));
  } catch { console.error('Pilot seed stopped. No secret or raw database error is logged.'); process.exitCode = 1; }
}
