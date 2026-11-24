# V2 isolated appointment-storage acceptance — approval required

PREPARED ONLY. No PostgreSQL, Docker, SQL, VPS or provider operation executed during preparation.
This document is not authorization. V1 authorization was consumed; old markers and receipts remain unchanged.

## Exact ONE execution requested

Workspace: C:\ThaaraProjects\thaara-ai-agent-v2

```powershell
node scripts/phone-appointment-storage-v2.review.mjs --approved-appointment-storage-v2 --manifest-sha256 5ded468440779ca439831b028fb91e78398f49977ead733e5c7fe3e126d7e0dd
```

Source-only preflight (safe, completed):
```powershell
node scripts/phone-appointment-storage-v2.review.mjs --preflight-only --manifest-sha256 5ded468440779ca439831b028fb91e78398f49977ead733e5c7fe3e126d7e0dd
```

Manifest SHA256: 5ded468440779ca439831b028fb91e78398f49977ead733e5c7fe3e126d7e0dd
Exact 318-file source/dependency/evidence inventory: PHONE_APPOINTMENT_STORAGE_V2.review.json.
New input snapshot is reviewOnly:true, executionAllowed:false, productionReady:false. It pins the corrected
transaction adapter; it neither replaces the historical release review nor grants production admission.
Source pins are checked before infrastructure, schema/test admission and after child completion.
Any mismatch stops; no automatic pin refresh, repair, rerun or fallback is approved.

## Expected results and preserved evidence

Historical ONLY: V1 cases 1–4 passed. V1 case 5 failed; 6–9 did not run. Exact original assertion was not retained.
V1 result, used marker, source manifest and independent cleanup receipt are pinned and checked by V2.
The local wrong-call403/503 defect was separately reproduced and corrected; PostgreSQL verification remains pending.

Fresh V2: five passing cases (5–9), zero failed, four intentionally skipped historical cases (1–4).
A beforeAll bootstrap necessarily installs and checks the empty fixture, unchanged112h/113h, restricted roles
and RLS; this is not a claim of fresh feature verification for skipped cases2–4.

5. Deny wrong credential, wrong call (403 after clean rollback), revoked and expired identity; zero writes.
6. Tenant/owner isolation; member and restricted ingest direct-read/role-escalation denials.
7. Endpoint and pool recreation preserves one request/audit; duplicate creates no second record.
8. Real transaction append followed by injected pre-commit failure rolls back; planned next submission saves once.
9. Missing caller consent and demoted owner cannot save requests.

Actual HTTP endpoint/principal/journal PostgreSQL transaction path; no in-memory database substitute.
Calendar owner-session resolver remains unavailable and Calendar/provider ports throw if invoked.
No real event, caller, provider or external connector is used. Case7 is pool/endpoint recreation, not DB restart.
Bail on first failure. Planned case8 submission is part of the test, not an automatic acceptance rerun.
Retain only allowlisted assertion/status/boolean/numeric-location diagnostics and explicit unexecuted cases.
Raw reporter errors, SQL, credential values and request bodies must not be retained or printed.

## Exact disposable scope

- One NEW container thaara-phone113-postgres-review; one NEW INTERNAL network thaara-phone113-network-review.
  Refuse existing names. Never adopt or delete pre-existing resources.
- Already-local image postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea; pull never.
- Fixed verified LOCAL Docker named-pipe endpoint only. No SSH, remote Docker, VPS or credential reads.
- Owned exec relay binds ONLY127.0.0.1:15436; Docker port publication NONE. Fresh temporary credentials.
- New disposable database named thaara_vps_pilot inside that new container ONLY, required by unchanged hosted SQL.
  It is not the hosted database. No existing database, container, volume or credential may be modified.
- Read-only root; tmpfs data512MiB, runtime16MiB, tmp32MiB; actual mountinfo/type/source/permissions checked.
  No binds or persistent volumes;768MiB RAM,1CPU,128PIDs, no-new-privileges, log driver none, no added capabilities.
- Apply ONLY twelve pinned base migrations0001–0012, original112h/113h and existing synthetic fixture setup.
  Temporary LOGIN/password setup affects only new fixture roles. Original SQL is unchanged.
- Verify image, resource IDs, run labels, isolation, network and filesystem before SQL.
- Existing timeout, bounded child output, fresh-session lifecycle and settlement checks remain required.

## Cleanup and evidence

Fresh one-use cache: node_modules/.cache/phone-appointment-storage-v2 (currently absent).
Exclusive used.json consumes this approval before creation; fixture.json/result.json retain sanitized proof.
Never reset or reuse V1/V2 markers. A failed run requires a new scoped approval before retry.
Close SQL clients, settle test child, close relay/listener/sockets/children before removal.
Re-inspect exact container/network IDs, image and ownership labels; delete ONLY resources created by this run.
Require containerAbsent, networkAbsent, destroyEventVerified, portFree and transport shutdown evidence.
Independently verify those same absent IDs, destruction event and free15436 afterward; retain sanitized
cleanup-independent.json in V2 cache. No broad prune, volume deletion or name-based cleanup fallback.
If identity/settlement cannot be verified, retain resources and report the exact blocker instead of deleting.

## Local preflight evidence and limitations

130 tests passed,0 failed;9 opt-in runtime tests skipped (12 files). No database engine or Docker used.
Evidence: node_modules/.cache/phone-appointment-v2-local-final.json.
Node syntax checks and git diff --check passed. Source-only preflight verifies318 pinned files.
Runtime engine/image availability, exact mount observations and PostgreSQL behavior remain unverified until approval.
Historical1–4 have not been rerun against the corrected adapter; no claim of fresh complete-nine-case acceptance.
F-03 remains OPEN; production admission/review gates unchanged. No production approval follows from local success.

## Selected SHA256 values

- scripts/phone-appointment-storage-v2.review.mjs: ff7f1fea96193acc52aaa99043141369768b409e55a12e8779cd702717b78768
- scripts/phone-appointment-storage-v2.review.test.ts: e40d582a4c683091129349a995e3683dbb4157f4fe50c5d1fcf3a6e4b850dccb
- docs/integrations/phone/PHONE_APPOINTMENT_STORAGE_V2_INPUT.review.json: 83a6ad5c1b0a4a9d8948be82f2a9c19ac73f2a49d8236a659f3d7680cda6cefa
- apps/api/test/phone-inbound-appointment-storage.runtime.test.ts: 470eb4563791a28957e03660334f03aa2797463982bc91b97963fb7c36831851
- scripts/phone-inbound-runtime-config.mjs: cfff1163b6462b4db24025cbed50361df9d7844bf9b758eaeb1695a6a20288b2
- scripts/phone-inbound-runtime-lifecycle.mjs: 1084747facd4535b0703a705700f0b509dd4fe063e3757e809479150b6600048
- scripts/phone-inbound-postgres-runtime.mjs: 77407505c5650e209d7954a3e9a2d59b94f1ae7d8b1a5bb37c05fcbb6ef24367
- docs/migrations/112h-phone-inbound-events.hosted-review.sql: 064ac927a1e059e25f2026a0251fa06e15e5849b4d35641d106273a641049a9f
- docs/migrations/113h-phone-inbound-principals.hosted-review.sql: 688922f79a552699028ce7e1cd450128a5156d585b13803e478f6412a3aee275

## Specific owner authorization needed

Approve ONE execution of the exact command above, including NEW isolated local Docker infrastructure,
127.0.0.1:15436 owned relay, unchanged reviewed SQL and synthetic fixture role/data setup, cases5–9,
reviewed local Docker access, identity-verified cleanup and independent read-only cleanup verification.
Do not authorize production identity setup, production migrations, deployment, Sarvam tools or real booking yet.
After successful acceptance, those are the next scoped deployment/connection/test milestones.
Preserve live inbound v5, outbound v7 draft, WhatsApp, Gmail, Calendar and all existing services.
