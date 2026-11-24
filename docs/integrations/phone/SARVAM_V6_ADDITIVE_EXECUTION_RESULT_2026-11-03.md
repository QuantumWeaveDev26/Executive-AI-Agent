# Additive Stage B v6 evaluation attempt — stopped on `HTTP 429` (`http_429`), no retry

Owner explicitly approved ONE execution of the reviewed, SHA-256-pinned additive recovery and synthetic evaluation package (`pwsh -NoProfile -NonInteractive -File scripts/phone-sarvam-eval-additive.review.ps1 -ApprovedAdditiveEval`).
The single execution attempt has been consumed with zero retries, zero reversals, and zero real phone calls.

## 1. Actual Execution & Sanitized Receipt

Invoked once:
```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-sarvam-eval-additive.review.ps1 -ApprovedAdditiveEval
```
Exited `1` after ~21 seconds (`12:32:04` to `12:32:25` IST). Sanitized receipt (`node_modules/.cache/sarvam-eval-additive-20261103-execution.json`):

```json
{"agentProcessId":25124,"phase":"pinned_additive_eval_ssh","hostHandshakeVerified":true,"category":"http_429","temporaryDirectoryName":"thaara-phone-add-d55783d235654e7aa28bccd4f3b379e2","status":"stopped","providerAcceptanceVerified":false,"hostRecordMatched":true,"gateResetVerified":true,"cleanupVerified":true,"telephoneCalls":0}
```

- **Confirmed**:
  - Artifact SHA-256 checksums, ED25519 SSH host pin (`SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4`), and SSH authentication succeeded.
  - Local gate `PHONE_SARVAM_EVAL_ADDITIVE.review.json` was consumed and reset to `false` (`gateResetVerified: true`).
  - Ephemeral SSH agent (`PID 25124`) and temporary directory (`thaara-phone-add-d55783d235654e7aa28bccd4f3b379e2`) were cleaned up (`cleanupVerified: true`, independently verified `tempDirExists: false`, `agentPidRunning: false`).
  - Sarvam returned **`HTTP 429 Too Many Requests`** (`category: "http_429"`).
  - Per the reviewed safety contract, the script stopped immediately on `HTTP 429` without retrying, looping, or reversing any completed step.

---

## 2. Exact Answers to Requested Post-Execution Questions

| Item | Truthful Status |
|---|---|
| **Exact operations completed** | **Unconfirmed pending local VPS receipt read**: The remote script writes append-only phase receipts (`01.json` through `09.json`) into `/opt/thaara-v2-pilot-private/phone-eval-stage-b-20261103-v6-additive-once` as each step (`claimed` → `preconditions_verified` → `variables_patched_empty_defaults` → `variables_verified_existing_cases_intact` → `mapping_created` → `case_added` → `before_run` → `run_id_received_unverified` → `run_created`) completes. Because the top-level stopped output returns only `{"status":"stopped","category":"http_429","providerAcceptanceVerified":false,"telephoneCalls":0}`, which exact step hit `HTTP 429` (e.g., whether setup + run submission succeeded and the 5-second `GET .../runs/{rid}` polling hit rate limiting after ~15–20s, or an earlier request hit `429`) is recorded in `/opt/thaara-v2-pilot-private/phone-eval-stage-b-20261103-v6-additive-once` and has **not** yet been read back. |
| **Whether the new simulation was accepted and completed** | **`UNVERIFIED` (`providerAcceptanceVerified: false`)** — the script stopped on `HTTP 429` before returning a completed run result. |
| **Relevant transcript and knowledge-retrieval evidence** | **Unavailable (`UNVERIFIED`)** — no transcript or `query_knowledge_base` trace was returned before the `HTTP 429` stop. None is invented or substituted. |
| **Whether Thaara answered the Quantum Weave services question correctly** | **`UNVERIFIED`** |
| **Whether Thaara returned to the website-status question** | **`UNVERIFIED`** |
| **Whether Ram actually said "Sunday afternoon."** | **`UNVERIFIED`** |
| **Whether Thaara accurately reported that answer** | **`UNVERIFIED`** |
| **Simulation cost and billing evidence** | **`UNVERIFIED` (billing not queried)**: If `HTTP 429` occurred before `POST .../runs` was accepted, `0` simulation credits were spent; if `POST .../runs` succeeded (`08.json`/`09.json` present) and `HTTP 429` occurred during `GET .../runs/{rid}` polling, up to 1 single-case simulation (~₹2 + GST) was queued. |
| **Real phone calls (`telephoneCalls`)** | **`0`** |

---

## 3. Safest Next Diagnostic Step (Prepared, Awaiting Separate Owner Approval)

Just as `phone-sarvam-409-readonly.review.ps1` inspected the local VPS receipt files after `http_409` with **zero provider HTTP requests and zero Sarvam API key reads**, we have prepared a standalone read-only receipt inspector for `/opt/thaara-v2-pilot-private/phone-eval-stage-b-20261103-v6-additive-once`:
- `deploy/hostinger-pilot/phone-sarvam-429-readonly.review.py` (`86f126e7821178644eeff731ac78aff65c3ade2530bad401c8dc8885ce98ee79`)
- `scripts/phone-sarvam-429-readonly.review.ps1` (`b13ea958550484267ab772cfff29a87474dd68333eca70f1aba8262c64069721`)
- `docs/integrations/phone/PHONE_SARVAM_429_READONLY.review.json` (`remoteExecutionAllowed: false`, `maximumProviderRequests: 0`)
- Details: `docs/integrations/phone/PHONE_SARVAM_429_READONLY_APPROVAL_2026-11-03.md`.

**STOPPED after the single approved execution. No retry, receipt read, or provider query performed.**
