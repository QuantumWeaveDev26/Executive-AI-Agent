# Step 115 real PostgreSQL 16.15 rehearsal

## Outcome

Passed on 11 November 2026 using the existing per-user Docker executable at `C:/Users/Admin/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe`. No software installation was needed. The `desktop-linux` context endpoint was checked as the local Docker Desktop named pipe. The cached image `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea` matches the previously observed production database image. The running test server returned version `160015`.

Evidence: `node_modules/.cache/phone-step115-pg16-local-rehearsal.result.json`. Reproducer: `scripts/phone_step115_pg16_local_rehearsal.py`. Seven offline boundary/regression tests passed in `scripts/phone_step115_pg16_local_rehearsal_test.py`.

## What was exercised

- Exact unchanged installation SQL, SHA-256 `c809ba7c0a44f9bdf3b76a1566edf1fbe6fc33e39a1d0c1d25e58a53025dcf8e`, including the real database/version/approval/dependency guards and final effective privilege checks.
- A synthetic production-compatible baseline built from the pilot database bundle, existing reviewed WhatsApp schema dependencies and Phone 110a/110b/110c dependencies. Shared-feature sentinel records covered WhatsApp, Bulk Campaigns, Chat, Gmail and Calendar. This was synthetic data; production rows and credentials were never accessed.
- Real `pg_dump` custom backups and `pg_restore` before and after installation. Schema/ownership/ACL statements, all synthetic public-table row fingerprints, selected role flags, application role memberships and database ownership/access metadata matched after restore.
- Failure injected after all installation statements and before COMMIT, followed by unchanged existing rows and a successful clean installation of the exact original transaction. New objects from the failed transaction did not obstruct that installation.
- Seven new empty tables with forced RLS, four new restricted NOLOGIN/NOINHERIT roles and no active service principals. Existing shared-table rows remained identical. The baseline had 38 tables and nine non-system roles; installed state had 45 tables and thirteen non-system roles.
- Local-only containers used unique nonce/name labels, no external network, no published ports, no host bind mounts, temporary in-memory database storage and bounded CPU/memory/process resources. All owned containers were removed and cleanup was verified. Other development resources were not altered.

The initial comparison detected PostgreSQL reparsing equivalent boolean parentheses in CHECK constraints. The harness reuses the existing reviewed backup canonicalizer for two known forms and adds one exact observed `(A OR B) OR C` normalization for `phone_inbound_principals_operations_check`. Regression tests verify changed limits or operations still fail equality. No installation SQL, business predicate, permission or production file was changed to make the comparison pass.

## Backup evidence

| State | Backup SHA-256 | Schema SHA-256 |
| --- | --- | --- |
| Before installation | `07499326ab1138522a855d702d718f13cd107f79d072ad09a7ea88a6b78e9198` | `3baa6931f7f3262cf5de02b3d3e63664b700a67f21d82e2335803da5783621d1` |
| After installation | `78f9cfdd49d165c96649b87405d368b1d1793f9c159c7d297aa28dbeecb9d2b8` | `ec012196ffb5b62dbb326725099352b24bba43c4f36ceed4f0fb287bd17f3bb4` |

Backups stayed in test-process memory and were actually restored. Role passwords were deliberately omitted; production credential recovery was not tested. Provider, worker and app processes were never started. There were zero phone/email requests and no production database connection. This evidence establishes the local database gate; it does not authorize installation or establish live Phone/Resend activation readiness.

Production remains unchanged. A protected production backup/recovery check and disabled installation require the separate scope in `STEP115_NEXT_INSTALLATION_SCOPE_20261111.md`. Runtime reconciliation, dedicated managed credentials, owner notification grant activation and separately authorized live acceptance remain later gates.
