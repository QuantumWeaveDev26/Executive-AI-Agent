# Step113 — approved one-time memory-only acceptance FAILED

3 November2026. Owner approved the exact prepared package with “procced”. One execution only:

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-inbound-principal-memory.review.ps1 -ApprovedInMemoryPhone113
```

## Confirmed execution and outcome

- Preflight: all103source/runtime pins matched; new marker and execution flag absent. Manifest SHA256
  `bff5216f14c99f352581383281bc7ba5c2deb94e4121e4802ac33a14e83704e3`, SQL113318eee…1680 and wrapper1e55af…de27
  matched the reviewed package.
- Marker start22:52:27IST; test start22:52:33IST; duration14.03s; wrapper exit1.
- beforeAll completed: twelve pinned base migrations, unchanged112dependency and NEW113applied to one NEW
  pathless memory-only PGlite engine; synthetic grant and users provisioned. This is SQL installation evidence,
  not evidence that the service functions/RLS work.
- First case, “saves callback and completion under the exact non-owner service identity”, FAILED during its
  first journal append. Sanitized error: `Inbound principal admission is unavailable.` Stack locates the failure
  at the principal gate, journal append and first test invocation; no successful call receipt was returned.
- Actual result: **0passed,1failed,9notrun**. Assertion records label the remaining nine pending with null
  durations; the JSON aggregate pending counter is0, so use assertion-level evidence rather than claim nine passes.
- No retry, SQL correction, guard reset, new database or additional database query attempted after failure.

## Diagnostic limits

The generic safety error did not retain a phase category or PostgreSQL SQLSTATE. Existing evidence cannot identify
whether restricted-role metadata verification, grant resolution or the append routine caused it. No root cause
is confirmed. Do not infer a privilege/RLS defect merely from this sanitized error. Local51/51mock checks are
historical evidence only and do not override this failed engine acceptance.

## Cleanup and preservation

The reviewed afterAll close hook ran without a reported hook error; the test child and wrapper ended. The new
database had no disk path, external connection, Docker resources, volumes or ports; process exit destroys its
in-memory state. No existing resource was deleted. Wrapper finally cleared its own approval flag; independent
check found it absent. One-use marker remains at `node_modules/.cache/phone113-in-memory-v1-used.json` with the
approved manifest SHA and in-memory-only scope. Keep it; approval is CONSUMED. Earlier111/112markers retained.

Saved JSON: `node_modules/.cache/phone113-in-memory-acceptance.json`, independently read back with success:false,
reportedPassed:0,reportedFailed:1 and the nine unexecuted assertion records. Postrun103-file pin check PASS;
the checksum checker itself executes no SQL. SQL111/112 and vite.config.ts hashes unchanged.

No production database, VPS, provider, Sarvam v5/v6, Gmail, Calendar, WhatsApp, n8n, credentials, deployment,
messages/calls/appointments, Gitcommit or push was accessed/changed. Branchdev-thaara-continuation HEAD413f5a5;
existing dirty work preserved.

## Safest next action

Prepare database-free, allowlisted phase/SQLSTATE diagnostics with synthetic failures. Preserve all authorization,
role, RLS, timeout and cleanup checks; do not expose raw SQL errors or credentials. Then prepare a NEW pinned,
one-time diagnostic-only engine package and request explicit approval before any further SQL execution. Do not
repair SQL or retry the acceptance suite under this consumed approval. Live inbound report integration remains
not_configured and is not ready for activation.
