# Step 115 next production approval scope

Status: prepared for owner review; **not authorized**. Earlier installation authorization ended at the API drift stop. The owner subsequently directed production to remain unchanged until the database/recovery checks passed. Those local checks are now evidenced in `STEP115_PG16_REHEARSAL_20261111.md`.

## Exact proposed work

1. Verify the pinned production API/database identities and database prerequisites. Stop on drift; do not adopt another development team's image or overwrite its files.
2. Create a protected consistent pre-install database backup and role/ownership/ACL recovery metadata on the VPS, verify checksums and the isolated restore using the reviewed backup procedure. Keep private backup contents on the VPS, with restricted access. Return only verification metadata/hashes. Do not proceed to installation if backup/recovery verification fails.
3. Apply the exact unchanged Step 115 SQL once, in its single guarded transaction, with all new runtime work disabled.
4. Read back catalog/permission metadata to verify the new objects, NOLOGIN roles and forced RLS. Preserve the receipt and any uncertain outcome; never retry blindly.

Target VPS: `1871828`. Database: `thaara_vps_pilot`, PostgreSQL `160015`.

Pinned API image: `sha256:3985893e8cef0ac5117af145e4785c5ae60bb95e3c997a74532b164860bd1cf9`.

Pinned database container: `340a0ab86ef4156d87651433676978473f58c82b32e1fa4c279664261ace7893`.

Pinned database image: `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`.

SQL: `docs/migrations/115-step115-hosted-install-20261111-r2.review.sql`.

SQL SHA-256: `c809ba7c0a44f9bdf3b76a1566edf1fbe6fc33e39a1d0c1d25e58a53025dcf8e`.

Refreshed target review: `docs/integrations/phone/PHONE_STEP115_INSTALL_20261111_R3.review.json`, SHA-256 `059bf652ce3422a77e76f84f48dd5bb960c2efe90b905f62c97ef225fc73b60d`.

Reviewed backup procedure: `deploy/hostinger-pilot/phone-backup-restore.review.py`, SHA-256 `650464fee1a727eeeccbf938d4e474fde3b3b336e58e812b1c55948ad326916e`, backup/restore mode only. Its private backup directory is `/opt/thaara-v2-pilot-private/phone-backups`; it owns and removes only its temporary restore fixture. No SQL migration mode or unrelated database action is included in the backup step.

## Effects and exclusions

The transaction adds seven Phone inbound/callback tables, four restricted NOLOGIN roles, ten Phone functions, associated triggers/indexes, and the specifically reviewed policies/permissions on existing memberships, approval_requests and audit_events. It does not rewrite existing feature data or replace existing provider callback functions. Full effects are in `STEP115_SQL_EFFECTS_AND_RECOVERY_20261111.md`.

Backup files and a temporary isolated restore fixture are real server resources within this proposed scope. No application restart, code deployment, container replacement, login/password/token provisioning, runtime enablement, owner notification-grant activation, real phone call or real email is included. No WhatsApp, Bulk Campaign, Chat, Gmail or Calendar data is rewritten. Existing live service configuration remains untouched; disablement of the new candidate must not be described as independently verified disablement of all existing Phone services.

An installation failure before COMMIT rolls back the transaction. After a successful installation, retain additive schema and records during application rollback. Destructive down migrations, restoring over production, exporting backup contents and activating messaging/calling require separate decisions and authorization.
