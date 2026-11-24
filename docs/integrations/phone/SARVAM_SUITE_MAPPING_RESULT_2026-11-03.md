# Read-only existing-suite mapping result — no mapping present (`HTTP 404`)

Owner approved the exact pinned existing-suite variable-mapping inspection once (`pwsh -NoProfile -NonInteractive -File scripts/phone-sarvam-suite-mapping.review.ps1 -ApprovedSuiteMapping`).
Source checksums and SSH host pin (`SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4`) verified; command invoked once and exited `0`.
One VPS SSH connection; **two documented `GET` requests** executed using the existing protected VPS API key in memory only.
Zero provider mutations, zero simulations, zero real phone calls, zero credit spend, and zero remote file writes. No identifiers, raw suite/case names, variable values, scenario text, or credentials appear in this report.

## 1. Sanitized Findings

| Field | Result |
|---|---|
| Status | `mapping_readonly_complete` |
| Matching app-bound suites (`suiteCount`) | **1** |
| Existing test case count (`caseCount`) | **6** |
| Provider `GET` requests (`providerRequests`) | **2** |
| Provider mutations (`providerMutations`) | **0** |
| Remote file writes (`remoteWrites`) | **0** |
| Version binding checked (`versionBindingChecked`) | **true** |
| Finding (`finding`) | **`mapping_absent`** (documented `HTTP 404` on `GET .../mappings?app_id=Thaara-AI-V-db336de4-5453`) |
| Variable mapping exists (`mappingPresent`) | **false** |
| Mapped app version (`mappedAppVersion`) | **`null`** |
| Targets committed `v6` (`mappedVersionMatchesTargetV6`) | **false** |
| Mapped variable count (`mappedVariableCount`) | **0** |
| `call_purpose` mapped to `approved_purpose` (`callPurposeMappedToProposed`) | **false** |
| `user_name` mapped to `recipient_name` (`userNameMappedToProposed`) | **false** |
| Variable mapping matches proposal (`variableMappingMatchesProposed`) | **false** |
| Full mapping matches proposed `v6` (`fullMappingMatchesProposedV6`) | **false** |
| Local gate reset (`gateResetVerified`) | **true** (`PHONE_SARVAM_SUITE_MAPPING.review.json` reset to `false`) |
| Ephemeral SSH agent & temp directory cleanup (`cleanupVerified`) | **true** (independently verified `tempDirExists: false`, `agentPidRunning: false`) |

Sanitized execution artifact: `node_modules/.cache/sarvam-suite-mapping-20261103-execution.json`.

---

## 2. Direct Answers to the Six Inspection Questions

1. **Whether a variable mapping already exists**:
   - **No (`mappingPresent: false`, `finding: "mapping_absent"`).** `GET /api/evals/v1/01a10103-1b5d-78a1-9902-f391242c7537/01a10103-1b66-7123-96b1-43a6e96e016b/test-suites/{test_suite_id}/mappings?app_id=Thaara-AI-V-db336de4-5453` returned the documented `HTTP 404` response indicating no variable mapping has been created for this suite and app.
2. **Whether it targets `v6`**:
   - **No (`mappedAppVersion: null`, `mappedVersionMatchesTargetV6: false`).** No version mapping exists on the suite.
3. **Whether `call_purpose` and `user_name` are correctly mapped**:
   - **No (`callPurposeMappedToProposed: false`, `userNameMappedToProposed: false`, `mappedVariableCount: 0`).** Combined with the prior metadata lookup (`variableCount: 0`), neither suite variables nor agent variable mappings exist yet on the suite.
4. **Whether the proposed additive recovery could affect the six existing test cases**:
   - **During the additive recovery run itself**: **No.** The additive recovery uses `POST .../test-suites/{test_suite_id}/test-cases/{test_case_id}/runs` (`scope: "test_case"`, `frequency: 1`, `total_executions: 1`), which executes **only** the newly added 7th test case (`THAARA-B-OUT01-TaskAndBusiness-v6`) and does not run, edit, or delete any of the 6 existing test cases.
   - **For the shared suite state**: By patching the suite's `variables` with **empty default values** (`[{"name": "approved_purpose", "value": ""}, {"name": "recipient_name", "value": ""}]`) and supplying the non-empty Ram/website values strictly through **case-scoped `variable_overrides`** on the new 7th case (`THAARA-B-OUT01-TaskAndBusiness-v6`), the 6 existing cases (which have no `variable_overrides`) do not inherit Ram's name or website task.
5. **Remaining uncertainty or compatibility risks**:
   - **Persistent `v6` mapping with empty suite defaults (`""`)**: Because `POST .../mappings` binds `{"call_purpose": "approved_purpose", "user_name": "recipient_name"}` for `app_version: 6` on the shared suite, any future manual run of the existing outgoing cases (`OUT01`, `OUT02`, `OUT04`) against `v6` will receive `""` for `call_purpose` and `user_name` unless overridden on those cases. For `OUT04` (missing-purpose guardrail test), `""` matches the intended missing-purpose condition; if `OUT01` or `OUT02` are ever re-run in the future against `v6` and expect a specific purpose, they should also be given case-scoped `variable_overrides` at that time. Incoming `v5` cases (`IN01`–`IN03`) do not use `{{call_purpose}}` or `{{user_name}}` and `mappings` is scoped to `app_version: 6`.
   - **Existing suite `global_guardrails`**: Because the additive recovery preserves the existing suite's `global_guardrails` untouched rather than overwriting them, Sarvam's evaluator will grade `THAARA-B-OUT01-TaskAndBusiness-v6` against its 5 explicit `expected_behaviors` plus whatever `global_guardrails` are already on the existing suite.
6. **Exact next approval needed**:
   - Separate explicit owner approval is required before executing the prepared additive recovery package (`pwsh -NoProfile -NonInteractive -File scripts/phone-sarvam-eval-additive.review.ps1 -ApprovedAdditiveEval`), detailed in `docs/integrations/phone/PHONE_SARVAM_EVAL_ADDITIVE_APPROVAL_2026-11-03.md`.

**STOPPED after read-only mapping inspection. Authorization consumed. No provider mutation or simulation performed.**
