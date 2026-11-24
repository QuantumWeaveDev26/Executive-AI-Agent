# Sarvam Minimal-Request / Diagnostic Suite-Variable `PATCH` Approval Package — 3 November 2026

## 1. Purpose & Scope

This package implements **Option 1 (Minimal-Request / Diagnostic `PATCH`)**:
- Eliminates redundant preflight API calls (`GET .../test-suites?app_id=...` and `GET .../mappings?app_id=...`) before `PATCH` by reading and cross-verifying the `suiteId` from the two existing root-owned (`0600`) VPS receipts (`phone-eval-stage-b-20261103-v6-additive-once/02.json` and `phone-eval-stage-b-20261103-v6-paced-once/02.json`).
- Performs **at most 3 requests total** (`1` preflight `GET /test-suites/{suite_id}` → `>= 15.0s` wait → `1` conditional `PATCH /test-suites/{suite_id}` → `>= 15.0s` wait → `1` readback `GET /test-suites/{suite_id}`), and **only 1 request (`0` mutations)** if `variables` were already applied.
- Captures sanitized `HTTP 429` (and any other HTTP error) diagnostics (`httpStatus`, `failedOperation`, `errorBodyShape`, `errorCode`, `errorMessage`, `retryAfterSeconds`, `rateLimitHeaders`, `diagnosticClassification`) with secrets, ULIDs, UUIDs, and `app_id` redacted.
- **Zero** mappings created, **zero** test cases added, **zero** simulation runs submitted, **zero** telephone calls, and **₹0** simulation cost.

---

## 2. Verified Facts vs. Hypotheses

### Verified Facts
1. **Documented Sarvam Evals Rate Limits** (`https://docs.sarvam.ai/voice-agents/api/tests/overview.md`):
   - `60 requests / minute` per API key within an org and workspace across every Tests endpoint.
   - `10 runs / 5 minutes` per organization for suite runs; `20 runs / minute` per organization for single test-case runs.
   - Exceeding a limit returns `HTTP 429 Too Many Requests` with `Retry-After: <seconds>` (documented example: `Retry-After: 60`) and an error JSON body (`{"error": {"code": "...", "message": "..."}}` per `update.md` or `{"detail": "..."}` per `overview.md`).
2. **Documented `PATCH` Behaviour** (`https://docs.sarvam.ai/voice-agents/api/tests/update.md`):
   - `PATCH https://apps.sarvam.ai/api/evals/v1/{org_id}/{workspace_id}/test-suites/{test_suite_id}`
   - Partial update only: *"Only the fields you send are changed. Test cases are edited through their own endpoints."*
   - Has no dry-run query parameter; a `200 OK` response permanently updates the sent fields (`variables`).
3. **Observed `HTTP 429` Pattern Across Both Prior Attempts (`12:31` IST and `13:31` IST)**:
   - Both attempts were separated by **59 minutes**, and in both attempts the first 3 `GET` requests succeeded (`200`, `200`, `404`) while the 4th request (`PATCH .../test-suites/{suite_id}`) returned `HTTP 429`.
   - Neither `additive-once` nor `paced-once` modified the suite (`variables: []` verified by `GET .../test-suites/{suite_id}` in `paced-once`).
   - Both attempts recorded the verified `suiteId` in local root-owned (`0600`) receipt files (`02.json`) on the VPS.

### Hypotheses (Distinguished by This Diagnostic Step)
- **Hypothesis A — Short Burst / Sliding-Window Limit Across Evals Endpoints**:
  - Firing 3 preflight `GET` requests before `PATCH` consumes a 3-request short burst window, causing the 4th request (`PATCH`) to fail with `HTTP 429`. Sending `PATCH` as only the **2nd** request after a **minimum 15-second interval** directly tests this hypothesis.
- **Hypothesis B — Endpoint-Specific Write Restriction / Plan Quota on `PATCH /test-suites/{suite_id}`**:
  - If `PATCH` still returns `HTTP 429` as the 2nd request after `>= 15s`, `extract_sanitized_http_error` captures the sanitized `errorCode`, `errorMessage`, `retryAfterSeconds`, `rateLimitHeaders`, and classifies whether it is `rate_limit_window_with_retry_after`, `rate_limit_without_retry_after_header`, `quota_or_plan_restriction`, or `endpoint_or_burst_throttled_without_retry_after`.

---

## 3. Whether This Diagnostic Modifies the Suite If Accepted (`HTTP 200`)

- **Yes**: Because Sarvam's `PATCH .../test-suites/{test_suite_id}` endpoint has no dry-run mode, if Sarvam accepts the `PATCH` (`HTTP 200`), it **permanently applies the Step 1 additive change** to the existing app-bound suite:
  ```json
  {
    "variables": [
      { "name": "approved_purpose", "value": "" },
      { "name": "recipient_name", "value": "" }
    ]
  }
  ```
- **Safety of this modification**:
  - Both variables have empty string defaults (`""`), no `v6` variable mapping exists yet, and all 6 existing test cases have `variable_overrides: []`.
  - If `PATCH` returns `HTTP 200`, the script waits `>= 15.0s` and performs 1 readback `GET /test-suites/{suite_id}` verifying that `name`, `description`, `global_guardrails`, and all 6 existing `test_cases` are unchanged (`existingCasesPreserved: 6`).
  - Once applied, any future run of the full evaluation package (`phone-sarvam-eval-paced.review.ps1`) will see `variablesAlreadyPresent: true` and skip `PATCH` automatically.

---

## 4. Pinned Artifacts & Exact Approval Command

| Artifact | Path | SHA256 |
|---|---|---|
| PowerShell Wrapper | `scripts/phone-sarvam-patch-diag.review.ps1` | `788d27e90a0037da80635a7403c54fbac34ab69625ecd713ce691e554e009bcc` |
| Remote Python Payload | `deploy/hostinger-pilot/phone-sarvam-patch-diag.review.py` | `67ec16f0a2914af834df2b1059dc638e11e105a6521bc639ee28261945472564` |
| Pinned Request Plan | `docs/integrations/phone/knowledge/eval-review-v1/request-plan.review.json` | `76b6885c16496202d7bcad26e11bc0f099f7611215be2b8579b701cf4aadec52` |
| Gate Manifest (locked `false`) | `docs/integrations/phone/PHONE_SARVAM_PATCH_DIAG.review.json` | `remoteExecutionAllowed: false` |

- **Dedicated One-Use Remote Guard**:
  `/opt/thaara-v2-pilot-private/phone-eval-stage-b-20261103-v6-patch-diag-once` (all prior guards preserved untouched).
- **Exact Command Upon Owner Approval**:
  `pwsh -NoProfile -NonInteractive -File scripts/phone-sarvam-patch-diag.review.ps1 -ApprovedPatchDiag`
