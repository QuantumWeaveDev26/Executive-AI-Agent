// Step 108.18 — provision a scrypt login password for the existing pilot owner user so the owner can
// sign in to the pilot web app at https://thaara-v2.quantumweaveai.io.
// RUN ONLY AFTER EXPLICIT OWNER APPROVAL. The password is written only to a root-only 0400 handoff file
// on the VPS and is never printed to stdout, logs or chat.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { PILOT_SEED } from './pilot-seed.mjs';

const deny = () => { throw Error('Pilot owner login provisioning denied'); };

export function hashPilotPassword(password, salt = randomBytes(16).toString('hex')) {
  if (typeof password !== 'string' || password.length < 16 || password.length > 256 || !/^[0-9a-f]{32}$/.test(salt)) deny();
  const key = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `${salt}:${key.toString('hex')}`;
}

export function verifyPilotPassword(password, combined) {
  const [salt, hex] = String(combined ?? '').split(':');
  if (!salt || !hex) return false;
  const key = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(Buffer.from(hex, 'hex'), key);
}

export async function provisionPilotOwnerLogin({ db, adminUrl, writePassword }) {
  const admin = new db.PostgresDatabase(adminUrl);
  try {
    const who = (await admin.query('SELECT current_database() AS db,current_user AS actor')).rows[0];
    if (who?.db !== 'thaara_vps_pilot' || who.actor !== 'postgres') deny();
    const owner = (await admin.query(
      `SELECT u.id AS user_id, u.email, w.id AS workspace_id
       FROM workspaces w JOIN memberships m ON m.workspace_id = w.id AND m.role = 'owner'
       JOIN users u ON u.id = m.user_id
       WHERE w.name = $1 AND u.email = $2`,
      [PILOT_SEED.workspaceName, PILOT_SEED.ownerEmail]
    )).rows;
    if (owner.length !== 1) deny();
    const password = randomBytes(24).toString('base64url');
    const passwordHash = hashPilotPassword(password);
    if (!verifyPilotPassword(password, passwordHash)) deny();
    const updated = await admin.query(
      'UPDATE public.users SET password_hash = $1 WHERE id = $2 AND email = $3 RETURNING id',
      [passwordHash, owner[0].user_id, PILOT_SEED.ownerEmail]
    );
    if (updated.rows.length !== 1) deny();
    await admin.query('UPDATE public.sessions SET revoked_at = clock_timestamp() WHERE user_id = $1 AND revoked_at IS NULL', [owner[0].user_id]);
    writePassword(password);
    return { workspaceId: owner[0].workspace_id, userId: owner[0].user_id, email: PILOT_SEED.ownerEmail, passwordUpdated: true };
  } finally {
    await admin.close().catch(() => {});
  }
}

if (process.argv[1]?.endsWith('pilot-owner-login.mjs') && process.argv[2] === '--approved') {
  try {
    if (process.env.THAARA_PILOT_OWNER_LOGIN_ACK !== 'owner_login_10818') deny();
    const secret = n => { const v = readFileSync('/run/secrets/' + n, 'utf8').trim(); if (!/^[A-Za-z0-9_-]{32,256}$/.test(v)) deny(); return v; };
    const db = await import('@thaara/db');
    const result = await provisionPilotOwnerLogin({
      db,
      adminUrl: `postgresql://postgres:${encodeURIComponent(secret('admin_password'))}@postgres:5432/thaara_vps_pilot`,
      writePassword: p => writeFileSync('/handoff/owner_login_password', p + '\n', { mode: 0o400 })
    });
    console.log(JSON.stringify(result));
  } catch {
    console.error('Pilot owner login provisioning stopped. No secret or raw database error is logged.');
    process.exitCode = 1;
  }
}
