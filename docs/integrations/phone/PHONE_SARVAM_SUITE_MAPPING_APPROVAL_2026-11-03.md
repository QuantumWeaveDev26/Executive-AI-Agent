# Sarvam Existing-Suite Mapping Inspection & Non-Destructive Additive Recovery Design (3 November 2026)

## 1. Confirmed Official Sarvam Documentation Findings

All findings below were verified directly against Sarvam's official Voice Agents API reference markdown documentation (`https://docs.sarvam.ai/voice-agents/llms.txt` and `*.md` endpoints):

### 1.1 App-Bound Suite Uniqueness Constraint (Root Cause of HTTP 409)
- **Sources**:
  - `https://docs.sarvam.ai/voice-agents/api/tests/overview.md` (lines 46, 98, 114, 121)
  - `https://docs.sarvam.ai/voice-agents/api/tests/create.md` (lines 42, 69–72)
- **Confirmed Provider Rule**:
  - *"Suites are **workspace-scoped**. A suite created without an `app_id` is reusable across every agent in the workspace; a suite created with one is bound to that app, and each app can have at most one bound suite."*
  - `POST /api/evals/v1/{org_id}/{workspace_id}/test-suites` with `app_id: "Thaara-AI-V-db336de4-5453"` returns **`409 Conflict`** (`"An app-level suite already exists for this app"` / `{ "detail": "Test suite already exists for app_id: ..." }`) whenever an app-bound suite already exists for that `app_id`.
  - Suites and test cases cannot be deleted via the API (*"No deletion. Suites and test cases are created and edited through the API but removed only in the dashboard"*).
- **Combined with Confirmed Read-Only Metadata (`SARVAM_SUITE_METADATA_RESULT_2026-11-03.md`)**:
  - Exactly **1** app-bound suite already exists for `Thaara-AI-V-db336de4-5453` (`suiteCount: 1`, `caseCount: 6`, `variableCount: 0`, `proposedScenarioPresent: false`, `lastRunStatus: "completed"`).
  - Creating a second app-bound suite for `Thaara-AI-V-db336de4-5453` is prohibited by the provider's one-suite-per-app invariant.

### 1.2 Variable Mapping Semantics (`GET` / `POST .../mappings`)
- **Sources**:
  - `https://docs.sarvam.ai/voice-agents/api/tests/mappings/get.md`
  - `https://docs.sarvam.ai/voice-agents/api/tests/mappings/create.md`
  - `https://docs.sarvam.ai/voice-agents/api/tests/best-practices.md` (lines 55–73)
- **Confirmed Provider Rule**:
  - `GET /api/evals/v1/{org_id}/{workspace_id}/test-suites/{test_suite_id}/mappings?app_id={app_id}`:
    - Query parameter: `app_id` (required; no `app_version` query parameter exists on `GET .../mappings`).
    - Returns **`200`** with `{ map_id, test_suite_id, app_id, app_version, variable_mapping }` if a mapping exists for `(test_suite_id, app_id)`, or **`404 Not Found`** if no mapping exists yet.
  - `POST /api/evals/v1/{org_id}/{workspace_id}/test-suites/{test_suite_id}/mappings`:
    - Body: `{ app_id, app_version, variable_mapping }` where keys are the **agent's** variable names (`call_purpose`, `user_name`) and values are the **suite's** variable names (`approved_purpose`, `recipient_name`).
    - Documented guidance: *"Create a mapping whenever the agent's instruction uses variables and you want your test values to flow into them. Without one, the run still executes, but the agent falls back to its default variable values... Recreate the mapping when you commit a new app version."*

### 1.3 Single Test-Case Execution vs Full Suite Execution
- **Sources**:
  - `https://docs.sarvam.ai/voice-agents/api/tests/runs/run-test-case.md`
  - `https://docs.sarvam.ai/voice-agents/api/tests/runs/get.md`
  - `https://docs.sarvam.ai/voice-agents/api/tests/best-practices.md` (line 76)
- **Confirmed Provider Rule**:
  - `POST /api/evals/v1/{org_id}/{workspace_id}/test-suites/{test_suite_id}/runs` runs **every test case** in the suite (`scope: "suite"`), which on the existing 6-case suite would execute all 6 existing cases plus any new case.
  - `POST /api/evals/v1/{org_id}/{workspace_id}/test-suites/{test_suite_id}/test-cases/{test_case_id}/runs` runs **only a single specified test case** (`scope: "test_case"`, `frequency: 1`, `total_executions: 1`) against `{ app_id, app_version: 6, frequency: 1, run_name, on_end_eval: true }` and is polled through the same `GET .../runs/{run_id}` and `GET .../runs/{run_id}/test-cases/{test_case_id}` endpoints.

---

## 2. Scoped Approval Request — Read-Only Existing-Suite Mapping Inspection

Before proposing or executing any provider write or paid simulation, we have prepared a narrowly scoped, read-only inspection package to verify the existing suite's current `mappings` state for `Thaara-AI-V-db336de4-5453` and whether it is bound to committed `v6`.

### 2.1 Prepared Local Files & Checksums
- **Local PowerShell wrapper**: `scripts/phone-sarvam-suite-mapping.review.ps1`
  - SHA-256: `cb9020ab732ab6ce6a2853bd4dcf4fd2a0e833ee09b80e9965bdc644498253b3`
- **Remote read-only inspector**: `deploy/hostinger-pilot/phone-sarvam-suite-mapping.review.py`
  - SHA-256: `3f6358db680e73d1b4d3ef157b12fc5b2fc68f45162865c70c704ec6a0c670b7`
- **Reviewed request plan**: `docs/integrations/phone/knowledge/eval-review-v1/request-plan.review.json`
  - SHA-256: `76b6885c16496202d7bcad26e11bc0f099f7611215be2b8579b701cf4aadec52`
  - Canonical JSON SHA-256 (`PLAN_HASH`): `184b47cc3b41669af34eefe6fc9e098dd79eb4b956e858f8a7e348c752dd1435`
- **Gate manifest (locked `false`)**: `docs/integrations/phone/PHONE_SARVAM_SUITE_MAPPING.review.json`
  - `"reviewOnly": true`
  - `"remoteExecutionAllowed": false`
  - `"maximumProviderRequests": 2`
  - `"allowedMethod": "GET"`
- **Focused unit tests**:
  - `scripts/phone_sarvam_suite_mapping_test.py`
  - `scripts/phone_sarvam_suite_mapping_wrapper_test.py`

### 2.2 Exact Documented Endpoints, Methods, Request Limit, and Key-Access Scope
- **Allowed HTTP method**: `GET` only (`method='GET'`, `NoRedirect`, `ProxyHandler({})`, `ssl.create_default_context()`).
- **Hard request limit**: At most **2 `GET` requests** in a single process (`self.count < 2`, `25s` alarm deadline):
  1. `GET https://apps.sarvam.ai/api/evals/v1/01a10103-1b5d-78a1-9902-f391242c7537/01a10103-1b66-7123-96b1-43a6e96e016b/test-suites?app_id=Thaara-AI-V-db336de4-5453&limit=2&offset=0`
     - Resolves the single app-bound `test_suite_id` in memory only (required because `SARVAM_SUITE_METADATA_RESULT_2026-11-03.md` intentionally never persisted or printed `test_suite_id`).
  2. `GET https://apps.sarvam.ai/api/evals/v1/01a10103-1b5d-78a1-9902-f391242c7537/01a10103-1b66-7123-96b1-43a6e96e016b/test-suites/{test_suite_id}/mappings?app_id=Thaara-AI-V-db336de4-5453`
     - Accepts `200` (mapping present) or `404` (mapping absent) as documented read-only findings.
- **VPS & Key-Access Scope**:
  - One SSH connection to `root@76.13.217.50:22` pinned to ED25519 host key `SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4`, using a temporary isolated `ssh-agent` (`-t 120`) in an ACL-restricted temp directory (`thaara-phone-map-read-*`), cleaned up in `finally`.
  - Reads `/opt/thaara-v2-pilot-private/secrets/sarvam_api_key` in memory only via `os.open` directory-descriptor walk (`O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_NOATIME`, owner `uid 0` or `1000`, mode `0400` or `0600`, `st_nlink == 1`, `8..4096` bytes) solely for the `X-API-Key` header on those 2 `GET` calls.
  - Consumes and resets `PHONE_SARVAM_SUITE_MAPPING.review.json` (`remoteExecutionAllowed = false`) immediately before connecting and verifies reset in `finally`.
  - Zero remote file writes; remote guard `/opt/thaara-v2-pilot-private/phone-eval-stage-b-20261103-v6-once` and all other gate manifests remain untouched.

### 2.3 Exact Sanitized Output Fields
Only the following allowlisted booleans, bounded integers, and fixed status strings can be emitted:
- `status`: `"mapping_readonly_complete"` (or `"stopped"` with allowlisted `category`)
- `suiteCount`: `0 | 1`
- `caseCount`: `0..200` (expected `6`)
- `providerRequests`: `1 | 2`
- `providerMutations`: `0`
- `versionBindingChecked`: `bool`
- `finding`: `"mapping_absent"` | `"mapping_matches_proposed_v6"` | `"mapping_present_v6_different_variables"` | `"mapping_present_other_version"` | `"no_app_suite_visible"`
- `mappingPresent`: `bool`
- `mappedAppVersion`: `1..1000` | `null`
- `mappedVersionMatchesTargetV6`: `bool`
- `mappedVariableCount`: `0..200`
- `callPurposeMappedToProposed`: `bool`
- `userNameMappedToProposed`: `bool`
- `variableMappingMatchesProposed`: `bool`
- `fullMappingMatchesProposedV6`: `bool`
- Wrapper verification fields: `hostRecordMatched`, `hostHandshakeVerified`, `remoteWrites` (`0`), `gateResetVerified`, `cleanupVerified`, `agentProcessId`, `temporaryDirectoryName`.

No raw IDs (`test_suite_id`, `map_id`), suite/case names, variable values, scenario text, headers, secrets, or error bodies are ever printed or persisted.

---

## 3. Outline of Non-Destructive Additive Recovery Proposal (For Subsequent Separate Approval After Mapping Inspection)

Because Sarvam enforces at most one app-bound suite per `app_id` and does not support API deletion, the recovery design for running the single synthetic outbound `v6` test without disturbing the 6 existing cases is strictly **additive and non-destructive**:

1. **Preserve the Existing App-Bound Suite and All 6 Existing Test Cases Untouched**:
   - Do **not** call `POST .../test-suites`.
   - Do **not** delete, overwrite, or edit any of the 6 existing test cases.
   - Do **not** overwrite the existing suite's `name`, `description`, or `global_guardrails`.
2. **Define Empty-Default Suite Variable Placeholders (`PATCH .../test-suites/{test_suite_id}`)**:
   - Send `PATCH /api/evals/v1/{org_id}/{workspace_id}/test-suites/{test_suite_id}` supplying **only** `variables`:
     ```json
     {
       "variables": [
         { "name": "approved_purpose", "value": "" },
         { "name": "recipient_name", "value": "" }
       ]
     }
     ```
   - **Why empty default values (`""`) preserve the 6 existing cases' behavior**:
     - Per Sarvam's `update.md`, `PATCH` updates only supplied fields (`name`, `description`, `global_guardrails`, and existing test cases remain untouched).
     - Because the suite-level default values for `approved_purpose` and `recipient_name` are `""`, any existing test case that has no `variable_overrides` (including the existing `OUT04` missing-purpose guardrail test and `IN01`–`IN03`) continues to evaluate with empty `call_purpose` / `user_name` defaults, while the new outbound test case supplies its non-empty test values (`"Ask Ram when the website design project will be completed."` and `"Ram"`) strictly via case-scoped `variable_overrides`.
3. **Bind Committed `v6` Variable Mapping (`POST .../test-suites/{test_suite_id}/mappings`)**:
   - If the read-only mapping inspection shows `fullMappingMatchesProposedV6: false`, send `POST /api/evals/v1/{org_id}/{workspace_id}/test-suites/{test_suite_id}/mappings`:
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
4. **Add the Single Reviewed Outbound v6 Test Case (`POST .../test-suites/{test_suite_id}/test-cases`)**:
   - Append `THAARA-B-OUT01-TaskAndBusiness-v6` (`max_turns: 20`, 5 expected behaviors from `request-plan.review.json`) with case-scoped `variable_overrides`:
     ```json
     [
       { "name": "approved_purpose", "value": "Ask Ram when the website design project will be completed." },
       { "name": "recipient_name", "value": "Ram" }
     ]
     ```
5. **Run Only the Single New Test Case (`POST .../test-suites/{test_suite_id}/test-cases/{test_case_id}/runs`)**:
   - Instead of `POST .../test-suites/{test_suite_id}/runs` (which would run all 7 cases in the suite), call the documented single test-case run endpoint:
     `POST /api/evals/v1/{org_id}/{workspace_id}/test-suites/{test_suite_id}/test-cases/{test_case_id}/runs`
     ```json
     {
       "app_id": "Thaara-AI-V-db336de4-5453",
       "app_version": 6,
       "frequency": 1,
       "run_name": "THAARA-B-OUT01-TaskAndBusiness-v6-ONE-REVIEW-20261103",
       "on_end_eval": true
     }
     ```
   - This guarantees `scope: "test_case"` and `total_executions: 1` (1 synthetic conversation total, 0 real PSTN calls, 0 executions of the 6 existing cases), followed by bounded polling (`GET .../runs/{run_id}` and `GET .../runs/{run_id}/test-cases/{test_case_id}`).
