# Non-Destructive Additive Stage B v6 Outbound Simulation Recovery Package — Final Safety Review & Approval Request (3 November 2026)

## 1. Final 7-Point Local Safety Review of Exact Sarvam Payloads

### Check 1 — Suite `PATCH` Preserves All 6 Existing Test Cases, Global Guardrails, and Unrelated Settings
- **Documented Endpoint**: `PATCH https://apps.sarvam.ai/api/evals/v1/{org_id}/{workspace_id}/test-suites/{test_suite_id}` (`https://docs.sarvam.ai/voice-agents/api/tests/update.md`).
- **Exact `PATCH` Payload**:
  ```json
  {
    "variables": [
      { "name": "approved_purpose", "value": "" },
      { "name": "recipient_name", "value": "" }
    ]
  }
  ```
- **Verification**:
  - Per `update.md` (*"Only the fields you send are changed. Test cases are edited through their own endpoints"*), omitting `name`, `description`, and `global_guardrails` leaves them untouched on the provider, and `PATCH` returns `200 {"test_suite_id": "..."}`.
  - Immediately after `PATCH` (before `POST .../mappings` or `POST .../test-cases`), `phone-sarvam-eval-additive.review.py` performs a readback `GET .../test-suites/{sid}` and enforces:
    - `suite_metadata_unchanged(patched_suite, before)` (`test_suite_id`, `app_id`, `name`, `description`, and `global_guardrails` are identical to the pre-PATCH snapshot),
    - `patched_suite['variables'] == expected_vars`,
    - `patched_suite['test_case_count'] == 6`, and
    - `patched_suite['test_cases'] == before_cases` (full deep equality across all 6 existing test cases).

### Check 2 — Empty-Default Variables Cannot Introduce Unintended Behavior in Existing Tests
- **Verification**:
  - The suite-level `variables` added by `PATCH` have empty default values (`"approved_purpose": ""`, `"recipient_name": ""`).
  - Only the newly added 7th test case (`THAARA-B-OUT01-TaskAndBusiness-v6`) receives non-empty values via case-scoped `variable_overrides`:
    ```json
    "variable_overrides": [
      { "name": "approved_purpose", "value": "Ask Ram when the website design project will be completed." },
      { "name": "recipient_name", "value": "Ram" }
    ]
    ```
  - None of the 6 existing test cases are executed by this script, and none of the 6 existing test cases inherit Ram's name or the website question.

### Check 3 — Committed `v6` Mapping Cannot Overwrite or Conflict with Existing Mappings
- **Exact `POST .../mappings` Payload**:
  ```json
  {
    "app_id": "Thaara-AI-V-db336de4-5453",
    "app_version": 6,
    "variable_mapping": {
      "call_purpose": "approved_purpose",
      "user_name": "recipient_name"
    }
  }
  ```
- **Verification**:
  - Confirmed by the owner-approved read-only inspection (`SARVAM_SUITE_MAPPING_RESULT_2026-11-03.md`) that `GET .../test-suites/{sid}/mappings?app_id=Thaara-AI-V-db336de4-5453` currently returns `HTTP 404` (`finding: "mapping_absent"`, `mappingPresent: false`).
  - Furthermore, `phone-sarvam-eval-additive.review.py` re-verifies `GET .../mappings?app_id=Thaara-AI-V-db336de4-5453` == `404` immediately before `PATCH`; if any mapping is present, the script aborts with `mapping_mismatch` before making any write.

### Check 4 — Script Stops Safely on Any Preflight Check or Provider Mutation Failure
- **Verification**:
  - Before any write, the script validates:
    1. `GET .../test-suites?app_id=Thaara-AI-V-db336de4-5453&limit=2&offset=0` returns `total == 1` and `test_case_count == 6`.
    2. `GET .../test-suites/{sid}` returns `variables == []`, `len(test_cases) == 6`, 6 distinct valid ULIDs, and no existing case named `THAARA-B-OUT01-TaskAndBusiness-v6`.
    3. `GET .../test-suites/{sid}/mappings?app_id=Thaara-AI-V-db336de4-5453` returns `404`.
  - After every mutation (`PATCH /{sid}`, `POST /{sid}/mappings`, `POST /{sid}/test-cases`), the script performs an immediate `GET` readback and stops before `POST .../runs` if any field, count, or existing test case differs.

### Check 5 — No Automatic Repeat or Reversal if Paid Simulation Fails After Configuration Changes
- **Verification**:
  - There is zero rollback/delete/reverse logic and zero retry loop around mutations or `POST .../runs`.
  - Each phase writes an append-only receipt (`01.json` through `09.json` with `O_CREAT | O_EXCL`) inside the root-owned atomic directory guard `/opt/thaara-v2-pilot-private/phone-eval-stage-b-20261103-v6-additive-once`.
  - If `POST .../runs` or polling fails (`provider_run_failed`, `provider_grade_failed`, `poll_limit_outcome_unverified`, or `http_402`), the script records the state and exits `1` without repeating or reversing the suite variables, mapping, or test case.

### Check 6 — At Most One New Test Case and One Simulation Run, With No Automatic Retry
- **Exact `POST .../test-cases` Payload**:
  - Single case `THAARA-B-OUT01-TaskAndBusiness-v6` (`max_turns: 20`, 5 expected behaviors, case-scoped `variable_overrides` for `approved_purpose` and `recipient_name`).
- **Exact `POST .../test-cases/{cid}/runs` Payload**:
  ```json
  {
    "app_id": "Thaara-AI-V-db336de4-5453",
    "app_version": 6,
    "frequency": 1,
    "run_name": "THAARA-B-OUT01-TaskAndBusiness-v6-ONE-REVIEW-20261103",
    "on_end_eval": true
  }
  ```
- **Verification**:
  - Triple-layered single-execution enforcement:
    1. **Local wrapper gate (`PHONE_SARVAM_EVAL_ADDITIVE.review.json`)**: consumed and reset to `false` before SSH authentication (`finally` block verifies `remoteExecutionAllowed == false`).
    2. **Remote filesystem guard (`/opt/thaara-v2-pilot-private/phone-eval-stage-b-20261103-v6-additive-once`)**: atomic `os.mkdir(..., 0o700)` fails closed with `already_claimed` on any repeat invocation (while leaving the historical `phone-eval-stage-b-20261103-v6-once` guard untouched).
    3. **In-process transport write fence (`self.writes_attempted`)**: `Transport` tracks `suite_patch`, `mapping_post`, `case_post`, and `run_post` and raises `duplicate_write_rejected` if any write kind is called more than once.

### Check 7 — Expected Simulation Cost Remains ₹2 Plus Applicable GST
- **Verification**:
  - `POST .../test-suites/{sid}/test-cases/{cid}/runs` runs **only** the single new test case (`scope: "test_case"`, `frequency: 1`, `total_executions: 1`, `max_turns: 20`), with **0** PSTN phone calls and **0** executions of the 6 existing test cases.
  - At Sarvam's documented Stage B synthetic simulation rate (~₹2 per simulated conversation plus applicable GST; ₹3–₹3.50/min voice agent rate), the expected cost for this single 1-case (`frequency: 1`) simulation is **₹2 plus applicable GST**, with no other paid operations in the script.

---

## 2. Exact Pinned Artifacts & Checksums

- **Wrapper**: `scripts/phone-sarvam-eval-additive.review.ps1`
  - SHA-256: `027f072acafc1315527b955ba4fd599e855a31cb7a4f4e57a66ca6170c6ec9ea`
- **Remote payload**: `deploy/hostinger-pilot/phone-sarvam-eval-additive.review.py`
  - SHA-256: `f731220fde5915f54f74c988a24fe294a433ddf64afd27213ba7d706d5094ebb`
- **Reviewed plan**: `docs/integrations/phone/knowledge/eval-review-v1/request-plan.review.json`
  - SHA-256: `76b6885c16496202d7bcad26e11bc0f099f7611215be2b8579b701cf4aadec52`
  - Canonical `PLAN_HASH`: `184b47cc3b41669af34eefe6fc9e098dd79eb4b956e858f8a7e348c752dd1435`
- **Gate manifest (currently `false`)**: `docs/integrations/phone/PHONE_SARVAM_EVAL_ADDITIVE.review.json`

## 3. Exact Approval Command (Do Not Execute Without Separate Owner Approval)

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-sarvam-eval-additive.review.ps1 -ApprovedAdditiveEval
```
