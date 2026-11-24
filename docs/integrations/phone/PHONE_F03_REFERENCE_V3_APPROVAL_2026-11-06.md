# F03 V3 — one consolidated dependency-evidence capture

V2 succeeded3/3 with verified cleanup. Its evidence is retained and its authorization consumed.
Offline source checks matched95modeled owner/ACLsets,8fresh-role declarations and6default scopes.
These are unapproved reference comparisons, not proof of production preconditions or final admission.

## Why another capture is necessary

The V2 catalog has complete native declarations but only an opaque dependency-edge hash. It cannot
prove explicit extension name/version/schema/owner or routine membership. V3 adds the separately
prepared read-only extension metadata query in the SAME repeatable-read snapshot as each catalog
query, plus a source-only bootstrap receipt. No nine-case appointment rerun is included.

## Exact proposed command — NOT EXECUTED

```powershell
node scripts/phone-f03-reference.review.mjs --approved-isolated-f03-reference --manifest-sha256 354ee548f3a7ce997dcae87ad49c03bb42cbd0d599cdedf401ea0113709155a9
```

Manifest: `PHONE_F03_REFERENCE_V3.review.json`, SHA256
`354ee548f3a7ce997dcae87ad49c03bb42cbd0d599cdedf401ea0113709155a9` —313 pinned files.

## Scope and limits

- Use the previously verified Docker-capable tool execution context. No permission/configuration changes.
- One NEW disposable container and internal network, fresh credentials, tmpfs-only storage, read-only
  root, same resource/ownership/isolation checks, owned127.0.0.1:15436 relay, no Docker publication/volumes.
- Same pinned local image `postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`;
  no image pull/build, existing-resource reuse or modification.
- Same twelve original base migrations and unchanged112h/113h, only inside the new disposable target.
  Existing target-name requirement uses local database named thaara_vps_pilot; no VPS connection.
- Three ordered checks: environment/version+matching TS/compiled bootstrap SQL provenance; after112
  catalog+extension membership; after113 catalog+extension membership. Execute exact verified snapshots.
- The additional SELECT is `F03_PG16_EXTENSION_PROVENANCE.review.sql`. Its fields come only from PG16
  system catalogs. No customer-row query or mutation, external provider, SQL114 or extra migration.
- Bind every native declaration to matching explicit extension membership, exact captured definition,
  version/stage/image/source/query/projection. Reject missing/duplicate/unknown metadata. Evidence
  remains unapproved; never set expectedCatalogApproved or productionAdmission to true.
- Stop on first failure; retain allowlisted phase/SQLSTATE; no repair/retry. Close owned sessions,
  child and relay, verify exact IDs/labels before removing ONLY this run's container/network. Independently
  verify destruction/absence/free port and relay shutdown. Stop/report if cleanup cannot be proved.
- Retain all V1/V2 markers, receipts and captures. Fresh V3 cache must be absent/empty. Retain only
  schema/provenance artifacts in phone-f03-reference-v3; no credentials or customer data.

## Local evidence

37/37 focused tests PASS,3runtime checks OFF; API typecheck PASS.313pins source-only preflight PASS.
Reviewer rechecked immutable inputs, parent hash, sidecar same-snapshot binding and failure cleanup;
no concrete blocking source issue found. New SELECT and combined V3 runtime behavior are unexecuted.
Actual PG16.15 dollar-quoted symbols and cross-stage/version rejection have focused regressions.
V2's exact executed308sources were checksum-verified and archived before preparing V3; archive SHA
`83c614000d99ee10bb868559fff8a7a510ed7a6cbc438d77062ec5ee4b46f0a4`.

## Approval text

“Approve ONE isolated F03 V3 run with manifest SHA256 above: fresh Docker setup, reviewed unchanged
base/112h/113h SQL, additional read-only extension provenance query, three checks and verified owned
cleanup. Preserve V1/V2 evidence. No automatic retry, VPS/production access, SQL114, deployment,
Sarvam/WhatsApp changes, credentials changes, real calls/messages or Git operations.”

Success is reference evidence only. An independently approved expected schema and target-specific
preconditions remain required before a production deployment approval can be prepared.
