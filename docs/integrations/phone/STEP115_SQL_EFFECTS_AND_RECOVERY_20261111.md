# Step 115 SQL effects and recovery review

Owner instruction on 11 November 2026: keep production unchanged after the WhatsApp team's image update. Do not retry installation until the checks below are complete and a new installation approval is granted.

## Verified target and previous stop

The latest metadata receipt is `node_modules/.cache/phone-step115-install-verification-20261111.result.json`, SHA-256 `c80b9137b71ef7d09bd7ff4b1ebdc2625f3f175b91db16c72ae814e743f34ff8`. It observed API image `sha256:3985893e8cef0ac5117af145e4785c5ae60bb95e3c997a74532b164860bd1cf9`. The PostgreSQL container, image and returned schema metadata match the previous baseline exactly. No Step 115 table or role was installed. The first installer checked container identities before invoking SQL, stopped on API drift, and its consumed marker prevents retry. Temporary SSH agent and directory cleanup were independently checked. No production action is authorized by this document.

## Exact transaction

File `docs/migrations/115-step115-hosted-install-20261111-r2.review.sql`, SHA-256 `c809ba7c0a44f9bdf3b76a1566edf1fbe6fc33e39a1d0c1d25e58a53025dcf8e`, remains unchanged. It starts one transaction, uses a three-second lock timeout and a thirty-second statement timeout, verifies the exact database/version/admin, and commits only after effective permission checks. It refuses existing candidate objects and changed dependency definitions/columns.

It creates these seven forced-RLS tables:

- `phone_inbound_call_events`
- `phone_inbound_principals`
- `phone_callback_requests`
- `phone_callback_notification_grants`
- `phone_callback_notification_grant_uses`
- `phone_callback_worker_principals`
- `phone_callback_dispatch_numbers`

It creates four restricted NOLOGIN, NOINHERIT, non-superuser, non-bypass roles: `thaara_phone_ingest`, `thaara_phone_guard`, `thaara_phone_notify`, `thaara_phone_notify_guard`. It provisions no passwords, service tokens, owner notification grants or memberships in these roles.

It creates ten Phone functions: `phone_inbound_resolve_grant`, `phone_inbound_scope_matches`, `phone_inbound_append_event`, `complete_phone_provider_report`, `phone_callback_validate_grant`, `phone_callback_record_grant_use`, `phone_callback_worker_operation`, `phone_callback_inbound_save`, `phone_callback_outbound_context`, and `phone_callback_outbound_save`. It installs callback grant validation/history triggers and the inbound history index. It adds the claiming-worker column and foreign key to the newly created callback table.

**This is more than adding callback tables.** It also installs inbound/report dependencies and changes restricted access on existing shared authorization/audit tables:

- Membership and approval SELECT plus column-level UPDATE permissions support row locking. The new UPDATE policies have `WITH CHECK(false)`, so those roles cannot change the protected rows.
- Selected audit INSERT permissions/policies allow the restricted Phone functions to record later authorized Phone operations.
- New security-definer Phone functions receive explicit ownership/EXECUTE permissions. Temporary schema CREATE grants used for function ownership changes are revoked in the same transaction.
- Application/worker privileges on the new Phone tables are reset and narrowed. Existing original provider callback functions are checked by hash and retained.

Creating these functions does not execute their bodies. Installation itself does not send mail, call a provider, create Calendar events, update contacts, complete calls, or insert audit/application records. Later admitted function calls can update Phone records and append audit evidence within their scoped authorization boundaries.

## Shared-feature preservation

The transaction contains no installation-time INSERT, UPDATE, DELETE, TRUNCATE or DROP against WhatsApp, Bulk Campaigns, Chat, Gmail or Calendar data. Existing data is not copied, rewritten or replaced. Shared approval/membership/audit policies described above are a real schema effect and must be included in production review.

Fresh isolated in-memory tests snapshot all existing public-table rows before installation and compare them afterward. Another test injects an error before COMMIT and verifies unchanged existing rows and absence of all seven candidate tables and four roles after ROLLBACK. These tests passed, along with the approval/wrong-target refusal check. Evidence: `node_modules/.cache/phone-step115-rollback-isolation-tests.result.json` (3 passed). This is PGlite evidence, not a completed PostgreSQL 16.15 rehearsal.

## Backup and rollback procedure

Before a future production installation, separately authorize a protected consistent database backup, role/ownership/ACL metadata capture, checksum verification and isolated restore rehearsal. Use the existing `deploy/hostinger-pilot/phone-backup-restore.review.py` procedure only after reviewing its current target pins. It uses `pg_dump`/`pg_restore`, compares schema/role/database ownership and ACLs, verifies backup hashes and source identity, and cleans up its owned isolated restore container. Keep backups in protected storage; do not export application rows or credentials into review artifacts. No production backup was taken during this continuation.

For a SQL error before COMMIT, the transaction rolls back. A transport failure near COMMIT has an uncertain outcome: consume the attempt, inspect only metadata, and never retry blindly. After a successful installation, application rollback retains the additive Phone schema and records. Disable new worker claims first, preserve pending/unverified attempts, and restore only the separately approved exact prior application image if deployment rollback is needed. Destructive schema removal or restoring over the production database needs a separate recovery decision and authorization.

## Remaining acceptance gates

- [x] Exact SQL effects reviewed and shared-data preservation checked in fresh memory.
- [x] Failed-install transaction rollback tested in fresh memory.
- [x] Fixed image pins stopped the attempt before SQL when WhatsApp changed the baseline.
- [x] Refreshed installation wrapper remains unauthorized and disabled.
- [x] Run the exact guarded transaction on isolated PostgreSQL 16.15 with a synthetic production-compatible baseline.
- [x] Rehearse real `pg_dump`/`pg_restore` and compare ownership, RLS, ACLs and synthetic data on that isolated runtime.
- [ ] Reconcile and review current shared-runtime changes before a deployment proposal.
- [ ] Request a new production installation approval only after the above database gates pass.

The earlier standard-path check missed the per-user Docker installation. Expanded discovery found `C:/Users/Admin/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe`, a running local engine and the exact cached production PostgreSQL image. The completed rehearsal, cleanup and seven offline boundary tests are recorded in `STEP115_PG16_REHEARSAL_20261111.md`. No software was installed and no VPS test database was created. The candidate neither enables Phone calling nor email sending. Existing live Phone settings were not changed or independently reverified as disabled; their current state must not be inferred from this disabled candidate. The next separate approval is defined in `STEP115_NEXT_INSTALLATION_SCOPE_20261111.md`.
