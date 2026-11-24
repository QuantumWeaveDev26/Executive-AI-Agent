# Read-Only Local VPS Receipt Inspection for `http_429` Stop — Awaiting Separate Owner Approval (3 November 2026)

## 1. Context

The single owner-approved invocation of `scripts/phone-sarvam-eval-additive.review.ps1 -ApprovedAdditiveEval` stopped after ~21 seconds with:
```json
{"status":"stopped","category":"http_429","phase":"pinned_additive_eval_ssh","hostRecordMatched":true,"hostHandshakeVerified":true,"cleanupVerified":true,"gateResetVerified":true,"telephoneCalls":0,"providerAcceptanceVerified":false}
```

During execution, `deploy/hostinger-pilot/phone-sarvam-eval-additive.review.py` wrote append-only stage receipts (`01.json` through `09.json`) into `/opt/thaara-v2-pilot-private/phone-eval-stage-b-20261103-v6-additive-once`:
1. `01.json`: `claimed`
2. `02.json`: `preconditions_verified` (initial 3 `GET`s verified `caseCount == 6`, `variables == []`, `mapping == 404`)
3. `03.json`: `variables_patched_empty_defaults` (`PATCH /{sid}` succeeded)
4. `04.json`: `variables_verified_existing_cases_intact` (`GET /{sid}` verified all 6 existing cases & guardrails intact)
5. `05.json`: `mapping_created` (`POST /{sid}/mappings` succeeded)
6. `06.json`: `case_added` (`GET` mapping readback + `POST /{sid}/test-cases` succeeded)
7. `07.json`: `before_run` (`GET /{sid}` verified `test_case_count == 7` and all 6 existing cases intact, right before `POST .../runs`)
8. `08.json`: `run_id_received_unverified` (`POST /{sid}/test-cases/{cid}/runs` returned `202` with `run_id`)
9. `09.json`: `run_created` (`queued` response validated, immediately before the 5-second `GET /{sid}/runs/{rid}` polling loop)

## 2. Prepared Zero-Network, Zero-Credential Receipt Reader Package

To determine deterministically which phases completed and whether `run_id` was already queued when `HTTP 429` occurred — **without accessing the Sarvam API key and without making any HTTP request to Sarvam** — we prepared:

- **Wrapper**: `scripts/phone-sarvam-429-readonly.review.ps1`
  - SHA-256: `b13ea958550484267ab772cfff29a87474dd68333eca70f1aba8262c64069721`
- **Remote receipt reader**: `deploy/hostinger-pilot/phone-sarvam-429-readonly.review.py`
  - SHA-256: `86f126e7821178644eeff731ac78aff65c3ade2530bad401c8dc8885ce98ee79`
- **Gate manifest (locked `false`)**: `docs/integrations/phone/PHONE_SARVAM_429_READONLY.review.json`
  - `"reviewOnly": true`
  - `"remoteExecutionAllowed": false`
  - `"maximumProviderRequests": 0`

### Scope & Security Properties
- **1 SSH connection** to `root@76.13.217.50:22` pinned to `SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4`.
- **0 provider HTTP requests** (`urllib` / `http` is not even imported in `phone-sarvam-429-readonly.review.py`).
- **0 Sarvam API key reads** (`/opt/thaara-v2-pilot-private/secrets/sarvam_api_key` is never opened).
- **0 remote file writes** (`O_RDONLY | O_NOFOLLOW | O_NOATIME` only on `/opt/thaara-v2-pilot-private/phone-eval-stage-b-20261103-v6-additive-once`).
- **Sanitized output allowlist only**:
  - `status`, `receiptCount` (`1..9`), `lastPhase`, `hasSuiteId`, `variablesPatched`, `variablesVerified`, `hasMappingId`, `hasCaseId`, `runSubmissionFencePresent`, `hasRunId`, `candidateOperations`, `providerQueried` (`false`), `billingReconciled` (`false`), `snapshotStable` (`true`).
  - Never prints `suiteId`, `mapId`, `caseId`, or `runId`.

## 3. Exact Command for Separate Owner Approval

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-sarvam-429-readonly.review.ps1 -ApprovedReadOnly429
```
