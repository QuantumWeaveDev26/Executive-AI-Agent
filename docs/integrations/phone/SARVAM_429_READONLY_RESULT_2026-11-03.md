# Sarvam HTTP 429 Retained Receipt Inspection Result — 3 November 2026

## 1. Execution Summary

- **Approved Command**:
  `pwsh -NoProfile -NonInteractive -File scripts/phone-sarvam-429-readonly.review.ps1 -ApprovedReadOnly429`
- **Wrapper SHA256**: `b13ea958550484267ab772cfff29a87474dd68333eca70f1aba8262c64069721`
- **Payload SHA256**: `86f126e7821178644eeff731ac78aff65c3ade2530bad401c8dc8885ce98ee79`
- **Host Pin Verified**: `SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4`
- **Sarvam API Requests**: `0` (`providerQueried: false`)
- **Sarvam API Key Reads**: `0`
- **Remote Writes / Guard Modifications**: `0` (`remoteWrites: 0`)
- **Exit Code**: `0`
- **Local Sanitized Evidence**: `node_modules/.cache/sarvam-429-readonly-20261103-execution.json`

```json
{
  "temporaryDirectoryName": "thaara-phone-429-read-3ec1f881f9e64887bc5e9ef561682941",
  "hasSuiteId": true,
  "cleanupVerified": true,
  "hasMappingId": false,
  "status": "readonly_complete",
  "variablesPatched": false,
  "runSubmissionFencePresent": false,
  "remoteWrites": 0,
  "hasCaseId": false,
  "snapshotStable": true,
  "hostRecordMatched": true,
  "gateResetVerified": true,
  "hasRunId": false,
  "variablesVerified": false,
  "agentProcessId": 25480,
  "billingReconciled": false,
  "providerQueried": false,
  "lastPhase": "preconditions_verified",
  "hostHandshakeVerified": true,
  "candidateOperations": [
    "patch_suite_variables"
  ],
  "receiptCount": 2
}
```

## 2. Deterministic Findings

1. **Last successfully completed phase**:
   - `preconditions_verified` (`receiptCount: 2`, corresponding to `01.json` `claimed` and `02.json` `preconditions_verified` in `/opt/thaara-v2-pilot-private/phone-eval-stage-b-20261103-v6-additive-once`).
   - All 3 initial preflight `GET` requests (`list suites`, `get suite detail`, `get v6 mapping -> 404`) succeeded, and the `HTTP 429` occurred immediately afterward on `patch_suite_variables` (`PATCH /api/evals/v1/{org}/{workspace}/test-suites/{suite_id}`).
2. **Whether suite variables were updated**:
   - `variablesPatched: false`, `variablesVerified: false` (`03.json` `variables_patched_empty_defaults` was not written because `PATCH` returned `HTTP 429`).
3. **Whether the `v6` mapping was created**:
   - **No** (`hasMappingId: false`). Execution stopped before reaching `POST .../mappings`.
4. **Whether the seventh test case was created**:
   - **No** (`hasCaseId: false`). Execution stopped before reaching `POST .../test-cases`.
5. **Whether a simulation run ID was received**:
   - **No** (`hasRunId: false`, `runSubmissionFencePresent: false`). Execution stopped before reaching `07.json` (`before_run`) or `POST .../runs`.
6. **Whether any paid run may already exist**:
   - **No paid simulation run was submitted** (`runSubmissionFencePresent: false`, `hasRunId: false`). Because execution never reached `before_run` or `POST .../runs`, no new simulation run was created and ₹0 simulation charge was incurred by that attempt.
7. **Local Cleanup & Gate Verification**:
   - `gateResetVerified: true`, `cleanupVerified: true`.
   - Independent check confirmed `tempDirExists: false` (`thaara-phone-429-read-3ec1f881f9e64887bc5e9ef561682941` removed), `agentPidRunning: false` (`PID 25480` terminated), and all 6 gate manifests have `remoteExecutionAllowed: false`.
