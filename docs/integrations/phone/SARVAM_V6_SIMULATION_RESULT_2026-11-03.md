# Revised v6 simulation attempt — stopped on HTTP409, no retry

Owner explicitly approved the revised 3 November package: ONE synthetic v6 task + KB company question + return + actual-answer scenario,
expected ₹2 plus GST, no retry/real call/settings/routing/deployment changes. The one execution attempt is consumed; no automatic continuation.

## Preflight verified before execution

- Same agent committed v6; full canonical prompt matches approved outgoing language-fix artifact.
- `qw-company-kb-v1` attached. Existing KB ID `01a19bee-d7ed-778c-b0db-e320e8209de9`, Synced, one `quantum-weave-public.md` file Ready.
- Chaitra and five-minute setting retained. Live inbound still mapped to original v2, same number/schedule; no edits.
- Billing page showed **79.12 credits**, enough for expected single simulation; no additional payment/recharge requested.
- Exactly nine previous runs visible, matching recorded IDs. All three approved artifact hashes and canonical plan/input mapping/scenario/frequency verified.

## Actual execution

Invoked exactly once:
`pwsh -NoProfile -NonInteractive -File scripts/phone-sarvam-eval.review.ps1 -ApprovedSyntheticEval`.
It exited1 after ~9seconds. Sanitized receipt:

```json
{"category":"http_409","phase":"pinned_synthetic_eval_ssh","status":"stopped","hostHandshakeVerified":true,"hostRecordMatched":true,"cleanupVerified":true,"gateResetVerified":true,"telephoneCalls":0,"providerAcceptanceVerified":false}
```

SSH authentication and exact trusted host pin passed. Sarvam returned HTTP409 Conflict. No request or wrapper retry, fallback,
repair, provider-setting change, extra simulation or real call was performed. No source/payload modification after the failure.

**Confirmed failure:** HTTP409. **Suspected cause:** conflicting/existing evaluation resource. Exact provider endpoint/stage and detailed
conflict reason are not retained in this top-level sanitized receipt; do not assert an existing-suite conflict as confirmed.
No new suite/map/run ID returned locally. This does not prove no resource was created before the failure. The reviewed payload creates its
persistent guard before provider requests and retains phase receipts; they were not re-read remotely after failure.

## Requested test results

| Check | Result |
|---|---|
| Preflight version, KB attachment/readiness, credits, exact scenario | PASS |
| Approved synthetic evaluation attempt | FAILED / stopped HTTP409 |
| New simulation execution | Not confirmed; visible history remains the same nine runs |
| Actual `query_knowledge_base` use and grounded company answer | UNVERIFIED; no new transcript/tool evidence |
| Natural return to website-status objective | UNVERIFIED |
| Ram actually says Sunday afternoon and Thaara reports it | UNVERIFIED |
| Transcript excerpts | Unavailable; none invented or substituted from previous inbound tests |
| Live Thaara Chat call-reporting workflow | NOT TESTED |

After the attempt, read-only UI checks still showed **79.12 credits** and the same nine prior runs; no new run visible.
No debit is visible in that balance, but a final billing-ledger reconciliation was not performed; do not guarantee an eventual charge of zero.
No provider grade/acceptance/success claim is warranted. Existing inbound v2 was not changed; no credentials, service, DB, Docker, other integration,
deployment, Git commit or push was changed/performed.

## Cleanup and retained evidence

Helper reported cleanup; independently verified locally:

- Execution gate is Boolean false.
- Owned temporary agent PID1740 absent.
- Owned directory `thaara-phone-eval-bf3cf22707cc4ed99aa8661bde85a54a` absent from local temp root.

No plaintext SSH private-key file was written. Retained remote guard/phase receipts remain part of the approved anti-replay/recovery design;
remote existence/content and any provider-created test resource have not been independently inspected after failure. Do not delete/reset them.
Local sanitized evidence: `node_modules/.cache/sarvam-v6-revised-20261103-execution.json`.

**STOP:** no further execution is authorized. A separately approved read-only inspection of retained phase receipts is the minimum next diagnostic;
do not reconnect, query providers, alter the package, reuse a test suite, reset the gate/guard or retry without renewed scoped approval.
