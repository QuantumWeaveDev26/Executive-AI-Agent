# Phone113 — fresh isolated acceptance v2

Status: CONSUMED — explicitly approved one execution, completed9/9 PASS with verified cleanup.

Owner explicitly approved temporary Docker setup, reviewed SQL, nine tests and cleanup using reviewed
access.309 pins verified; exact command ran ONCE and exited0. Base0001–0012 and112r/113r applied only
in disposable database. Allnine tests passed; no failures/skips. Container/network removal, destroy-event
evidence, free port and relay shutdown verified. Used/fixture/result retained; never reset/reuse.
Result: `PHONE113_OWNED_RELAY_V2_RESULT_2026-11-04.md`. Original reviewed scope follows.

## Why this is ready

The separately approved Docker access check succeeded through the tool's reviewed access path.
The same context and container inventory operation had returned access denied through the restricted
execution path. This establishes a working access path; it does not prove the original acceptance
run's exact failure or establish that remaining image/network/isolation checks will pass.
Evidence: `node_modules/.cache/phone113-reviewed-access-check-20261104.json`.
No Docker setting, ACL, key, service or existing container was modified.

Local diagnostic propagation now identifies six preflight boundaries using finite sanitized categories.
New v2 launcher uses exclusive v2 evidence storage; consumed v1/diagnostic markers remain unchanged.
Fresh145/145 local tests PASS, nine PostgreSQL cases SKIPPED; receipt
`node_modules/.cache/phone113-owned-relay-v2-local-20261104.json`. Syntax, SQL text and whitespace checks PASS.
No new SQL changes. No database runtime tests or provider operations executed during preparation.

## Exact scoped approval requested

Approve ONE execution of this exact command through the same separately reviewed tool access path:

```powershell
node scripts/phone-inbound-owned-relay-v2.review.mjs --approved-owned-relay-acceptance --manifest-sha256 c32f0cafa76baf984af3f2c0dae776e21fd817e859d85ee14363b697e17b9266
```

Manifest `PHONE113_OWNED_RELAY_ACCEPTANCE_V2.review.json` pins309 files. Stop before authentication or
infrastructure on checksum mismatch. Any automatic access review rejection must be reported, never bypassed.
No command retry, fallback, source repair, SQL alteration or approval/marker regeneration.

## Scope and unchanged safeguards

All resource, SQL, transport, test and cleanup restrictions in
`PHONE113_OWNED_RELAY_ACCEPTANCE_APPROVAL_2026-11-04.md` apply; its CONSUMED execution stays historical.
The new execution differs only by improved finite diagnostics, fresh v2 launcher/manifest/evidence paths,
and the explicitly reviewed access-permission path. No security or timeout check is weakened.

- One NEW `thaara-phone113-postgres-review` container and NEW `thaara-phone113-network-review` internal
  network; fresh database `thaara_phone113_review`, fresh in-memory fixture passwords, existing pinned image,
  no pull. Refuse occupied names. No existing databases, containers, volumes or credentials changed.
- Read-only root, tmpfs-only storage, strict actual kernel-mount and ownership/network checks.
  No Docker published ports or persistent volume. Resource limits unchanged.
- Preflight binds/closes127.0.0.1:15436 as availability probe; after full isolation checks, supervised
  data relay verifies actual127.0.0.1:15436 address and immutable new-container target through verified local
  Docker npipe. Fixed internal5432; no fallback. Maximum16 owned tunnels; bounded proven shutdown.
- Apply only the twelve reviewed base migrations, unchanged112r/113r candidates and fixture LOGIN setup
  inside this disposable database. Run the same nine synthetic acceptance cases, bail on first failure.
- Close SQL sessions before metadata inspection. Stop on any unexpected error, no automatic repair/retry.
  Verify owned IDs/labels before removal, empty network, independent absence/destroy event/free port.
  Unknown child termination blocks container removal and is reported rather than guessed successful.
- New retained evidence only under `node_modules/.cache/phone113-owned-relay-v2/{used,fixture,result}.json`.
  Preserve all earlier consumed receipts and guards. No log/command argument exposure of credentials.

No VPS, production/development database, live Sarvam inboundv5, outboundv6, provider request, simulation,
call, message, appointment, Gmail/Calendar/WhatsApp/n8n change, service restart, deployment, commit or push.
Report preflight, migrations, nine case results, finite failures, relay and cleanup evidence. Stop after
this one run; successful testing does not authorize production integration or live calls.
