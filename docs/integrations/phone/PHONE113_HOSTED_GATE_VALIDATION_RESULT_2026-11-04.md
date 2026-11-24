# Hosted inbound installation gates — isolated PostgreSQL9/9 PASS

## Execution

Owner explicitly approved one disposable local Docker setup, reviewed base/112h/113h SQL, nine cases,
reviewed access and cleanup.320 source checksums verified before execution. Exact approved command
ran ONCE, exit0, status passed, validationPlan hosted-gates. No automatic retry or SQL repair.
Manifest SHA256: `76b126c1cb3fa0e3a20fec8b8b3af292769fad6c9c5839d9847c2582e117649a`.
Retained timestamp and immutable owned IDs are in the used/result receipts, not repeated here.

## Migrations and cases

Parent applied only the twelve reviewed base migrations0001–0012. Cases05 and08 then successfully
applied112h and113h respectively inside the NEW local disposable database. Its name matched the
pilot solely to exercise target admission; it was not a VPS or existing database connection.

| Case | Result |
|---|---|
|01 Missing112h approval refuses without catalog changes | PASS |
|02 Wrong database in same new container refuses despite approval | PASS |
|03 Substituted installer role refuses; catalog unchanged | PASS |
|04 Unsafe worker role / missing FORCE RLS refuse; declared fixture settings restored and baseline matches | PASS |
|05 Approved112h creates the protected journal with expected columns | PASS |
|06 Duplicate112h refuses adoption; catalog unchanged | PASS |
|07 Missing113h approval / synthetic policy collision refuse; exact fixture policy removed and baseline matches | PASS |
|08 Approved113h creates restricted NOLOGIN roles, forced RLS, guard-owned functions and intended execute/schema privileges | PASS |
|09 Duplicate113h refuses adoption; catalog unchanged | PASS |

Totals9 passed,0 failed,0 skipped, failedCaseNumbers empty. Expected refusals asserted SQLSTATE P0001
and catalog fingerprints. Wrong major-version refusal remains statically checked, not tested using a
different PostgreSQL image. This does not validate a future persistent installer or live runtime.

## Isolation and cleanup evidence

All source/ownership/image/network/actual-tmpfs/private-transport checks passed. Admission proved actual
loopback listener, owned target and no Docker publication. No fallback or ambient database credentials.
Cleanup verified:true, containerRemoved:true, networkRemoved:true, failure:null, creationUncertain:false.
Runner independently confirmed resource absence, owned destroy event and free127.0.0.1:15436.
Listener/children/socketsClosed all true; supervisor faultReason null, activeChildren0, activeSockets0,
startPending false. No additional inspection or repeat after completion.

Retain `node_modules/.cache/phone113-hosted-gates-v1/{used,fixture,result}.json` and all earlier receipts.
This approval is consumed. Never reset its used marker or rerun under the same permission.

## Remaining before real inbound reporting

- Confirm production managed/TLS/secret requirements or obtain a specific controlled private-pilot
  exception for real caller callback data; the synthetic-pilot agreement alone does not grant it.
- Fresh protected backup and verified isolated restore immediately before persistent changes.31Oct
  recovery success is historical and its approval consumed; no recovery command is authorized now.
- Build/review the exact persistent installer with same-run112h receipt and full catalog/RLS/grant
  verification before113h; no adoption, destructive downgrade or schema rollback.
- Bind actual authenticated Thaara owner/tenant and provision expiring dedicated principal/secret
  references through approved secure setup. No values supplied by provider payloads or model text.
- Admit runtime composition, shared ingress and private logging without bypassing existing test guards.
- Verify supported live provider authentication/direction/save acknowledgement, then separately approve
  deployment/configuration and one owner-made controlled inbound end-to-end test.

No VPS, live inboundv5, outboundv6, Chat/Gmail/Calendar/WhatsApp/n8n, credentials, deployment or application
service changed. No provider request, real call/message/appointment, Git commit or push occurred.
Stop after this approved validation/report. Future external actions need separate scoped approvals.
