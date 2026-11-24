# Sarvam Rate-Paced Guard & Receipt Inspection Approval Package — 3 November 2026

## 1. Purpose & Scope

Following the `-ApprovedPacedEval` stop at `phase: "pinned_paced_eval_ssh"` (empty `ssh.exe` stdout after ~12–14s SSH window), this package provides a **zero-network, zero-credential** local VPS inspection of `/opt/thaara-v2-pilot-private/phone-eval-stage-b-20261103-v6-paced-once`.

- **Proposed Execution Command** (requires separate explicit owner approval):
  `pwsh -NoProfile -NonInteractive -File scripts/phone-sarvam-paced-readonly.review.ps1 -ApprovedReadOnlyPaced`
- **Sarvam API Requests**: `0` (`maximumProviderRequests: 0`, `providerQueried: false`)
- **Sarvam API Key Reads**: `0`
- **Remote Writes / Guard Modifications**: `0`

## 2. Exact Pinned Artifacts (SHA256)

| File | SHA256 |
| --- | --- |
| [`scripts/phone-sarvam-paced-readonly.review.ps1`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/scripts/phone-sarvam-paced-readonly.review.ps1) | `854a431b006231b24e50991970e7c0e87eac9bd1ed620cdd5f87d509752e2b98` |
| [`deploy/hostinger-pilot/phone-sarvam-paced-readonly.review.py`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/deploy/hostinger-pilot/phone-sarvam-paced-readonly.review.py) | `d65471890be3345b485531e5643f87c7802e0e4360a3d4466bcadc2a4a0bebaf` |
| [`docs/integrations/phone/PHONE_SARVAM_PACED_READONLY.review.json`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/docs/integrations/phone/PHONE_SARVAM_PACED_READONLY.review.json) | Locked (`"reviewOnly": true`, `"remoteExecutionAllowed": false`) |

## 3. What It Reports

1. **`guardDirectoryPresent`**:
   - `false` (`lastPhase: "not_started_guard_absent"`, `receiptCount: 0`) if `ssh.exe` timed out at `ConnectTimeout=12` before `python3` started on the VPS (proving `0` Sarvam requests were made).
   - `true` if `python3` started on the VPS before the SSH channel dropped.
2. **If `guardDirectoryPresent: true`**:
   - `receiptCount` (`1..10`), `lastPhase`, `phases` list, and boolean resource flags (`hasSuiteId`, `variablesPatched`, `variablesVerified`, `variablesAlreadyPresent`, `hasMappingId`, `mappingCreated`, `mappingAlreadyPresent`, `hasCaseId`, `caseAdded`, `caseAlreadyPresent`, `runSubmissionFencePresent`, `hasRunId`, `completedRunRecorded`).
   - If `10.json` (`completed_requires_manual_review`) was written on the VPS after `ssh.exe` disconnected: `providerJudgePassed`, `passedChecks`, `totalChecks`, `transcriptSha256`, `evaluationChecks`, and `transcriptTurns`.
