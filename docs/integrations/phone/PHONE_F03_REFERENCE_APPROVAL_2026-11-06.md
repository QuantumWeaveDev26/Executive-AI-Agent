# One isolated PG16 reference capture — approval required

Prepared locally only. NOT a production installation or declaration that F03 has passed.

Manifest: `PHONE_F03_REFERENCE_V1.review.json`

SHA256: `88527b9b169d6a701c00828fc0bb7cf6634ea87207c9a434baf62e3ad15f1312`

Exact proposed execution (NOT run):

```powershell
node scripts/phone-f03-reference.review.mjs --approved-isolated-f03-reference --manifest-sha256 88527b9b169d6a701c00828fc0bb7cf6634ea87207c9a434baf62e3ad15f1312
```

## Exact scope

- One NEW disposable container `thaara-phone113-postgres-review`, NEW internal network
  `thaara-phone113-network-review`. Refuse existing matching resources; do not reuse/delete them.
- Existing reviewed pinned PostgreSQL image
  `postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`.
  No pull/build. Record and verify actual image/container/network IDs.
- Fresh in-memory test credentials, tmpfs-only storage, read-only root filesystem, existing
  isolation/ownership/resource/timeout checks. No Docker port publication; owned relay listens only
  on127.0.0.1:15436. No existing volumes or database URLs. The isolated database is named
  `thaara_vps_pilot` solely so unchanged hosted SQL target checks work; no VPS connection exists.
- Apply exactly the twelve pinned base migrations using existing Migrator, then unchanged112h/113h.
  No110/114SQL, customer records, service identity provisioning, provider operations or nine-case rerun.
- Three ordered checks: exact fresh fixture/version/pgcrypto environment; after112h read-only catalog;
  after113h read-only catalog. Catalog query runs in REPEATABLE READ, READ ONLY with pg_catalog path.
- Execute immutable verified SQL snapshots. Child checks exact parent manifest SHA. Pin308 files,
  including transitive lifecycle, session, relay, proxy and diagnostics dependencies. Hash mismatch stops.
- Retain unapproved schema-only captures and source/version/image/run provenance; no data-row dump.
  Unsupported query output stops and remains unapproved. Never copy the capture into expectedCatalog.
- Stop on first failure, no automatic repair/retry. Retain fixed phase/SQLSTATE/category only;
  never error messages, credentials or environment values. Preserve old markers/evidence.
- Always close/settle owned SQL/child/relay first. Delete only exact run-owned container/network IDs
  after ownership verification. Independently verify destruction, absence and free port. If ownership,
  child settlement or cleanup cannot be verified, stop and report retained resources; do not broaden deletion.

## Retained artifacts

`node_modules/.cache/phone-f03-reference-v1/`: used.json,fixture.json,environment.json,
after112.json,after113.json,result.json and failure.json only if needed. Fresh cache must be absent/empty
and its resolved path must remain inside this workspace. No approval marker exists yet.

## Local verification

-49/49 database-free tests PASS;3 runtime cases skipped/OFF. API typecheck PASS.
- Source-only preflight with the exact final manifest PASS;308 pins verified; Docker/SQL not touched.
- Focused reviewer found omitted dependencies and re-read SQL; corrected closure, immutable verified
  inputs and parent-to-child hash binding. Re-review found no further blocking source defect. Receipt
  provenance now uses the already verified manifest hash rather than a later filesystem read.
- PostgreSQL query syntax, generated definitions, grantors and ownership effects remain unverified.
  Successful collection still requires independent SQL-derived reference review, protected approval
  provenance and target-specific evidence.269 requirements remain pending until separately evidenced.

## Consolidated authorization text

“I approve ONE isolated F03 reference capture using the exact command and manifest SHA256 above:
new disposable Docker infrastructure, fresh credentials, tmpfs storage, owned127.0.0.1:15436 relay,
unchanged twelve base migrations and112h/113h, three reference checks and verified owned cleanup.
No retry, VPS access, production SQL, SQL114, Sarvam changes, calls, messages, deployment or Git operations.”

This boundary cannot be replaced with generic deployment permission. A final production release package
will be prepared only after reference/admission evidence is valid; no production activation is authorized here.
