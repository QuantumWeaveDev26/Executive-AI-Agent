# HTTP 409 ROOT-CAUSE ANALYSIS — local evidence only

**Later approved inspection supersedes endpoint uncertainty:** stable VPS snapshot contains only `claimed`. Failing operation is now confirmed
create-suite POST; mapping/run submission not reached. Detailed conflict cause and provider/billing state remain unverified.
See `SARVAM_HTTP409_READONLY_RESULT_2026-11-03.md`. The original local-only analysis below is preserved as historical evidence.

## Confirmed

- Exactly one approved wrapper invocation ended with `status=stopped`, `category=http_409`, `phase=pinned_synthetic_eval_ssh`.
  SSH host verification/authentication and local cleanup passed. The simulation execution gate is still false.
- Existing wrapper, Python payload and plan checksums still match the executed package. None was modified during this investigation.
- Only the saved execution receipt contains the relevant live error in targeted local Sarvam JSON/eval-log searches.
  Other similarly named JSON files are historical synthetic test/regression evidence, not a second live diagnostic log.
- In `phone-sarvam-eval.review.py`, every HTTP409 becomes the SAME `Stop('http_409')`; raw error body/headers are discarded, and the
  outer handler returns no operation name. The wrapper adds only its SSH phase. No endpoint-specific local trace survives.
- Seven local mock injections (create suite, read suite, create mapping, read mapping, submit run, poll run, read results) all reproduce that
  same sanitized category. These mocks make no network requests and do not represent seven real attempts.

**Confirmed failing operation: not yet identifiable from local evidence.** HTTP409 alone does not prove duplicate suite, mapping conflict,
failed run submission, lack of resource creation or absence of billing.

## Endpoint candidates — sanitized templates, no private identifiers

Let `S = https://apps.sarvam.ai/api/evals/v1/{org}/{workspace}/test-suites`.

| Last complete retained receipt | Candidate failed operation/endpoint after that phase |
|---|---|
| `claimed` only | POST `S` — create suite |
| `suite_created` | GET `S/{suite}` OR POST `S/{suite}/mappings` |
| `mapping_created` | GET `S/{suite}/mappings?app_id={app}` |
| `before_run` | POST `S/{suite}/test-cases/{case}/runs` |
| `run_id_received_unverified` | Inconsistent with this HTTP409 path; investigate without inferring a new request |
| `run_created` | GET `S/{suite}/runs/{run}` OR GET `S/{suite}/runs/{run}/test-cases/{case}` |

These are inferences from the pinned program order **conditional on a stable, valid retained snapshot**, not observations of the remote files.
Some receipt states narrow to two endpoints; do not overclaim that phase inspection always resolves the exact operation.

## Resource and billing state

Root-owned guard/phase receipts were created before provider requests by the executed payload, but no post-failure remote snapshot has been read.
The top-level local receipt contains no suite/mapping/run IDs. A valid `suite_created` or `mapping_created` phase would show that the provider returned
the expected successful creation response; it would not establish that the resource still exists now. A returned run ID is not proof of a passing simulation.
Resources **may** have been created before409. Do not create, reuse, overwrite or delete anything to test that hypothesis.

Historical UI immediately before/after the attempt: 79.12 credits and the same nine runs. No visible debit/new run. This is not billing-ledger
reconciliation; no provider billing entry has been read in this local-only investigation. Billing remains **unverified**.

## Hypotheses and safest correction

An existing/conflicting evaluation resource is one hypothesis, not a confirmed cause. There is currently no evidence selecting a specific conflicting
resource, provider uniqueness rule or API defect. No operational correction is justified yet; leave existing resources and guards intact.

The confirmed local observability gap can be corrected later by including an allowlisted operation enum in sanitized failures, without raw bodies or
secrets. That would improve future evidence; it cannot retroactively recover the lost409 detail or resolve the provider conflict. No executor change made.

First read the existing phase receipts using the separately proposed read-only package. If still ambiguous, prepare a further narrowly scoped read-only
provider/log/billing inspection after approval; do not reissue the failed request to obtain its error body.
No paid simulation is necessary for diagnosis. Whether another simulation is needed depends on whether a run was already accepted and its results can
be inspected under a future read-only approval. No new run is authorized by this report.

## Local verification and stop boundary

Prepared NEW read-only reader/wrapper, separate from the unchanged simulation executor and its gate. Reader exposes only phase enums/count/ID-presence
flags and verifies root-owned non-symlink paths, bounded regular files, complete contiguous phase prefix and stable snapshot. No identifiers in output.
Remote interpreter uses `-B`; receipt opens use `O_RDONLY|O_NOFOLLOW|O_NOATIME`. No credential/API/network, subprocess, write or delete operation in reader.

Fresh local tests: receipt analysis8/8 and copied-wrapper approval tests7/7 PASS. Read-only default/helper syntax and whitespace PASS.
Independent source review found no consequential issue. No fresh remote permission, filesystem, account or billing proof claimed.

Exact proposed command, pinned sources, expected output and access scope:
`PHONE_SARVAM_409_READONLY_APPROVAL_2026-11-03.md`. Its separate diagnostic gate is FALSE. No SSH connection/provider operation performed.
