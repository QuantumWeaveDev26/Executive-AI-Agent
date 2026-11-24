# Read-only Sarvam suite metadata lookup — separate approval required

**EXECUTION UPDATE:** Owner explicitly approved; one execution completed successfully, two GETs, one matching app-bound suite with different
name/configuration. Gates false, local auth cleanup verified at final check. No mutations/simulation. Approval consumed.
See `SARVAM_SUITE_METADATA_RESULT_2026-11-03.md`. The preparation scope below is historical, not renewed authorization.

**PREPARED ONLY.** No VPS authentication, API-key read or authenticated provider request performed. New gate is false.
This does not authorize a simulation, provider mutation, resource reuse or recovery.

## Exact documented requests

Host fixed: `https://apps.sarvam.ai`. IDs below are redacted in this document; their existing values are fixed in the checksum-pinned source.
They are not caller-supplied parameters. Only the previously configured Thaara organisation/workspace/agent are in scope.

1. **GET** `/api/evals/v1/{existing_org}/{existing_workspace}/test-suites?app_id={existing_Thaara_app}&limit=2&offset=0`
2. **GET** `/api/evals/v1/{existing_org}/{existing_workspace}/test-suites/{returned_suite_id}`

Request2 occurs ONLY after request1 returns exactly one suite with the exact expected app binding and no pagination. The suite identifier comes only
from that validated response and stays in memory. Zero matches ends after one GET. Multiple matches, wrong app, unexpected totals/pages/IDs or
changed identity/count/name between responses STOP; no pagination, workspace-wide fallback or additional lookup.

Official sources checked 3 November:
[List test suites](https://docs.sarvam.ai/voice-agents/api/tests/list), [Get a test suite](https://docs.sarvam.ai/voice-agents/api/tests/get).
The documented list operation supports an app filter and bounded offset/limit. The detail operation includes nested test cases; neither executes them.

## Fields retrieved versus fields reported

The API has no documented field-selection parameter. Full bounded JSON objects arrive on the VPS and are parsed transiently in memory.

| Response | Fields available/processed |
|---|---|
| Filtered list | `items`, `total`, `limit`, `offset`, `next_page_uri`, `prev_page_uri`; item suite ID, app binding, name, case count, last-run status; API may also return description, creator ID, creation/last-run timestamps. |
| Single suite | Suite ID, app binding, name, description, case count, variables, guardrails, nested cases (name/category/scenario/expected behaviors/variable overrides/max turns and assigned IDs); API may also return creator/updater identities and timestamps. |

**No raw names, IDs, creator details, variable values, descriptions, scenarios, behavior text, timestamps, credentials or raw error bodies are printed
or stored locally.** Raw provider JSON stays in remote process memory and is discarded when it exits. No response/transcript file is written on the VPS.
Server-assigned behavior/case IDs are ignored in semantic configuration comparisons and never emitted.

Allowed report fields only:

- Suite count (0/1); for one match, exact-app-binding Boolean, case count, variable count and an allowlisted last-run status.
- Booleans for proposed name, variables, guardrails, scenario and full reviewed configuration matching.
- Finding enum: `no_app_suite_visible`, `same_app_and_name_present` or `same_app_different_name_present`.
- Request count (1/2), providerMutations0, remoteWrites0; conflictCauseConfirmedfalse, billingReconciledfalse, versionBindingCheckedfalse.
- Sanitized error category and operation enum (`preflight`, `list_suites`, `read_suite`) on failure; no raw response message or identifiers.

The comparison target is the existing pinned revised v6 synthetic plan, not a new configuration. This reads app-bound suite metadata, NOT a version
mapping, KB attachment, call log, billing ledger or transcript. Same-name/app presence is evidence of an existing resource, not definitive proof of
the provider's409 constraint. Missing app-filtered results do not rule out a name conflict elsewhere; do not inspect unrelated apps automatically.

## Exact execution command — only after separate explicit approval

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-sarvam-suite-metadata.review.ps1 -ApprovedSuiteMetadata
```

Manifest `PHONE_SARVAM_SUITE_METADATA.review.json` remains `remoteExecutionAllowed:false`. After approval only, enable this NEW lookup gate once;
the helper consumes/resets only this gate. Do not change either prior execution/receipt-inspection gate or any remote guard/receipt.

| Pinned input | SHA256 |
|---|---|
| `scripts/phone-sarvam-suite-metadata.review.ps1` | `f630b760b20b5aae970c9a2f380a6a18570507d7b1b6d12c61812d558e13bd86` |
| `deploy/hostinger-pilot/phone-sarvam-suite-metadata.review.py` | `6e8c8ea059aa8fff7eba4b3c4cbb63b11a06a5d6be7b32a1a4a9d1e871de0a44` |
| `knowledge/eval-review-v1/request-plan.review.json` | `76b6885c16496202d7bcad26e11bc0f099f7611215be2b8579b701cf4aadec52` |

The remote reader also verifies canonical plan hash `184b47cc3b41669af34eefe6fc9e098dd79eb4b956e858f8a7e348c752dd1435`.
Stop on any mismatch; no automatic fix or substitution.

## Access, authentication, limits and cleanup

- One connection to the SAME existing VPS through the existing encrypted dedicated SSH identity and temporary agent. Preserve the recorded trusted
  ED25519 fingerprint, strict host checking and disabled forwarding. No unknown-host acceptance or plaintext SSH key file.
- On VPS, run `python3 -B - --approved-suite-metadata-read` with the pinned source and public comparison plan on stdin; no script installation.
- **Explicitly requested access:** read the existing protected file `/opt/thaara-v2-pilot-private/secrets/sarvam_api_key` only on the VPS, in memory,
  for `X-API-Key` authentication to this fixed HTTPS origin. No copying, creating, replacing, rotating, printing or hashing the key. Read-only/no-follow/
  no-atime opens, safe parent permissions, private secrets directory, regular0400/0600 single-link file with approved owner checks; fail closed.
  Python cannot promise erasure of all immutable memory copies; the process exits after the bounded lookup.
- Default TLS certificate/hostname checking; no redirects or proxy forwarding. **Maximum two GETs**,10seconds each,25second remote alarm/deadline,
  256KiB per-response limit; SSH process bound45seconds. No request/connection retry, pagination or alternative method/path. Stop on all errors,
  including401/402/403/404/409/429. No payment, top-up or upgrade action.
- No remote file writes, receipt/guard reads or changes, provider mutation, suite/mapping reuse, simulation/run/Instant Outbound/campaign request,
  real call/message, agent/version/knowledge/routing edit, DB/Docker/service/restart/deployment, Git commit/push or other integration change.
- Clean up only this invocation's owned local temporary SSH agent and `thaara-phone-suite-read-<uuid>` directory/public known_hosts/socket.
  Verify their identity and absence; never delete existing files or remote resources. Preserve committedv6/livev2 and all original receipts/gates.

No paid simulation is part of this scope. This does not reconcile past billing. Any later recovery or paid test needs a new explicit approval.

## Local validation and requested decision

Fresh **17/17 local tests passed** (10 reader,7 copied-wrapper approval checks), syntax/review-only/whitespace checks pass. Wrong-app/multiple-page/
identity/duplicate-variable/path/request-limit/tampered-plan cases fail closed; semantic comparisons ignore assigned IDs without exposing them.
Focused independent review found no consequential issue; no remote behavior or account permission claimed from mocks.

**Approval requested:** one execution of this exact pinned read-only lookup, including the protected existing key read on VPS and at most two scoped GETs.
Afterward report only sanitized metadata/comparisons, confirmed facts versus conflict hypotheses, and the safest proposed next step. Stop there.
