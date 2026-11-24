# Sarvam Minimal-Request Suite-Variable `PATCH` Diagnostic Result — 3 November 2026

## 1. Execution Summary

- **Approved Command**:
  `pwsh -NoProfile -NonInteractive -File scripts/phone-sarvam-patch-diag.review.ps1 -ApprovedPatchDiag`
- **Wrapper SHA256**: `788d27e90a0037da80635a7403c54fbac34ab69625ecd713ce691e554e009bcc`
- **Payload SHA256**: `67ec16f0a2914af834df2b1059dc638e11e105a6521bc639ee28261945472564`
- **Plan SHA256**: `76b6885c16496202d7bcad26e11bc0f099f7611215be2b8579b701cf4aadec52`
- **Execution Window**: `13:51:07`–`13:52:02` IST (~55 seconds total, including two 15.0s pacing intervals)
- **Exit Code**: `0`
- **Local Sanitized Receipt** (`node_modules/.cache/sarvam-patch-diag-20261103-execution.json`):

```json
{
  "cleanupVerified": true,
  "variablesPatched": true,
  "stdinFaulted": false,
  "providerAcceptanceVerified": false,
  "hasRunId": false,
  "providerMutations": 1,
  "gateResetVerified": true,
  "telephoneCalls": 0,
  "existingCasesPreserved": 6,
  "runSubmissionFencePresent": false,
  "variablesVerified": true,
  "temporaryDirectoryName": "thaara-phone-pdiag-a9dfafc8eecc4189a478c6fb5fc064a4",
  "hostRecordMatched": true,
  "providerRequests": 3,
  "variablesAlreadyPresent": false,
  "status": "patch_diag_complete",
  "hostHandshakeVerified": true,
  "sshExitCode": 0,
  "stdinDelivered": true,
  "agentProcessId": 18020,
  "trustedReceiptsMatched": true
}
```

---

## 2. Exact Operations Completed and Verified Outcomes

1. **Trusted Receipt Cross-Verification (`trustedReceiptsMatched: true`)**:
   - Opened `/opt/thaara-v2-pilot-private/phone-eval-stage-b-20261103-v6-additive-once/02.json` and `/opt/thaara-v2-pilot-private/phone-eval-stage-b-20261103-v6-paced-once/02.json` (`0600` root-owned regular files) and verified both recorded `phase == "preconditions_verified"`, `existingCaseCount == 6`, and the exact same ULID `suiteId`.
2. **Request 1 (`t = 0.0s`) — Preflight Suite Detail `GET`**:
   - `GET /api/evals/v1/{org_id}/{workspace_id}/test-suites/{suite_id}` → **`HTTP 200 OK`**.
   - Verified `test_suite_id == sid`, `app_id == "Thaara-AI-V-db336de4-5453"`, `test_case_count == 6` (all 6 existing test case ULIDs intact), no active run, and `variables == []` (`variablesAlreadyPresent: false`).
3. **Request 2 (`t = +15.0s`) — Suite Variable `PATCH`**:
   - After a 15.0-second interval, sent `PATCH /api/evals/v1/{org_id}/{workspace_id}/test-suites/{suite_id}` with:
     ```json
     {
       "variables": [
         { "name": "approved_purpose", "value": "" },
         { "name": "recipient_name", "value": "" }
       ]
     }
     ```
   - Returned **`HTTP 200 OK`** (`variablesPatched: true`) and verified returned `test_suite_id == sid`.
4. **Request 3 (`t = +30.0s`) — Post-`PATCH` Readback `GET`**:
   - After another 15.0-second interval, sent `GET /api/evals/v1/{org_id}/{workspace_id}/test-suites/{suite_id}` → **`HTTP 200 OK`**.
   - Verified:
     - `variables` now equals `[{"name": "approved_purpose", "value": ""}, {"name": "recipient_name", "value": ""}]` (`variablesVerified: true`).
     - `test_suite_id`, `app_id`, `name`, `description`, and `global_guardrails` are unchanged (`suite_metadata_unchanged == True`).
     - All 6 original `test_cases` are byte-for-byte unchanged (`existingCasesPreserved: 6`).
5. **Cost & Boundaries**:
   - `providerRequests: 3`, `providerMutations: 1`, `runSubmissionFencePresent: false`, `hasRunId: false`, `telephoneCalls: 0`, **₹0** cost incurred.

---

## 3. Root-Cause Identification of the Earlier `HTTP 429`

- **Confirmed Cause**:
  - The earlier `HTTP 429` responses on `PATCH .../test-suites/{suite_id}` (both at `12:31` IST and `13:31` IST) were caused by **short-window / burst rate limiting across Evals endpoints** when 3 `GET` requests preceded `PATCH` within a 9-second window (`t = 0s, 3s, 6s, 9s` — 4 requests in 9 seconds).
  - It is **not** a permission, workspace, or plan/quota restriction on `PATCH`: when redundant preflight `GET`s were eliminated and a **15-second interval** was enforced between requests (`t = 0s, 15s, 30s`), `PATCH .../test-suites/{suite_id}` succeeded with `HTTP 200 OK` on the first attempt.
- **Implication for the Remaining `v6` Evaluation Sequence**:
  - Because `variables` (`approved_purpose`, `recipient_name`) are now permanently present and verified on the suite (`variablesVerified: true`), `PATCH .../test-suites/{suite_id}` does **not** need to be called again.
  - To avoid triggering the same short-window burst limit during the remaining steps (`POST /mappings` → `POST /test-cases` → `POST /runs`), the remaining evaluation workflow should:
    1. Resolve `suiteId` from the trusted VPS receipts (skipping `GET /test-suites?app_id=...`),
    2. Enforce `>= 15.0s` intervals between configuration/setup requests and `>= 15.0s` (or `15–20s`) between run-status polls, and
    3. Skip `PATCH /test-suites/{suite_id}` now that `variablesAlreadyPresent` is `true`.
