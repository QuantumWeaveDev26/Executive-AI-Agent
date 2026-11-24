# Step 115 protected backup and disabled production installation result

The owner explicitly approved the exact scope in `STEP115_NEXT_INSTALLATION_SCOPE_20261111.md`. Both operations completed and verified on 11 November 2026. This approval did not include deployment, restart, credential provisioning, runtime enablement, calls or emails, and none occurred.

## Protected backup and restore

The pinned backup procedure passed for the existing production PostgreSQL container, with 38 tables. It verified row counts, schema ownership/ACLs, roles, source identity, checksums and isolated restore-container destruction. Private backup contents remained on the VPS under `/opt/thaara-v2-pilot-private/phone-backups/phone110-20261111T103201Z-211a42e36a921f4ad37aef0e2ef706f9`.

- Database archive SHA-256: `f367c7b7c29a097caaea9ca2c600499dd8243a602168c10e0dfb82ebfbeeecb3`.
- Globals SHA-256: `c60a6904828c5aa789cadf3df0565e1068527d22c68aadeb7a6d9c8dca1e4456`.
- Metadata-only receipt: `node_modules/.cache/phone-step115-protected-backup-20261111.result.json`, SHA-256 `aba15c91f51e3fcee208b76484849740ad93a071a4f9144bbf14be24156515af`.

The SQL launcher required this verified backup/restore receipt and pinned its checksum before installation.

## Disabled schema installation

Applied the exact unchanged transaction `docs/migrations/115-step115-hosted-install-20261111-r2.review.sql`, SHA-256 `c809ba7c0a44f9bdf3b76a1566edf1fbe6fc33e39a1d0c1d25e58a53025dcf8e`.

Post-installation catalog verification returned 10 Phone tables with 106 columns, all with forced RLS; seven selected scoped roles; and twelve selected Phone functions. Both original provider callback function hashes remain unchanged. The four new roles remain NOLOGIN/NOINHERIT with no elevated flags. All final SQL privilege checks passed before COMMIT.

The API stayed healthy on image `sha256:3985893e8cef0ac5117af145e4785c5ae60bb95e3c997a74532b164860bd1cf9`. The database container/image remained pinned and stable.

Metadata-only installation receipt: `node_modules/.cache/phone-step115-disabled-install-20261111-r2.result.json`, SHA-256 `1808e7c139a801195fedd5ab5ed6c030a489e19f7c4c23f9dc0aa4884b98f9a8`.

Both SSH wrappers reported verified cleanup. Agent PIDs 18472 and 28088 and their temporary directories were independently confirmed absent. Restore-container cleanup was verified by the reviewed backup procedure. No local rehearsal containers remain.

## Current limits and next work

Schema availability is complete. The new notification runtime remains disabled; no login, worker token, dedicated mail key, owner notification grant or service process was provisioned by these operations. Existing live service configuration was preserved; its Phone enablement state was not independently assessed as part of this scope.

Production runtime admission guards remain in the local callback owner repository, routes and provider composition. Before deployment, reconcile current shared runtime sources and startup, preserve the WhatsApp team's image behavior, admit the reviewed provider/worker identities, verify dedicated managed credentials, and prepare an exact candidate with rollback. Full automatic Chat message persistence and separately approved live call/email acceptance remain pending. Do not describe the full Phone integration as live or complete.

No further production changes are authorized by this result document. Preserve both consumed execution markers and backup data. Any later recovery, deployment, configuration or activation needs its appropriate separate scope.
