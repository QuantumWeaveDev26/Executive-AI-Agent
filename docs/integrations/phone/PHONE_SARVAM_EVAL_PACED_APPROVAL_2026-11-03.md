# Sarvam Stage B `v6` Post-`PATCH` & Post-Mapping Rate-Paced (`>=22s` / Rolling 60s Window) Evaluation Approval Package — 3 November 2026

## 1. Purpose & Scope

Following the verified creation of both the suite `variables` (`approved_purpose: ""`, `recipient_name: ""`) and the `v6` variable mapping (`call_purpose -> approved_purpose`, `user_name -> recipient_name`, `201 Created` in `final-once/04.json`), this final runner completes the remaining Stage B `v6` synthetic evaluation workflow:
1. **Reuses the verified `suiteId` and `mapId`** by cross-verifying the four root-owned (`0600`) VPS receipts (`additive-once/02.json`, `paced-once/02.json`, `patch-diag-once/02.json` + `04.json`, and `final-once/02.json` + `04.json`), eliminating `GET .../test-suites?app_id=...`.
2. **Skips both `PATCH .../test-suites/{suite_id}` and `POST .../test-suites/{suite_id}/mappings`**: both endpoints are excluded from `Transport`'s allowed request table. Preflight `GET /test-suites/{suite_id}` (`200`) and `GET /test-suites/{suite_id}/mappings?app_id=...` (`200`) verify that the two empty-default variables and the exact `v6` mapping (`map_id == trusted_mid`, `app_version == 6`) are already present and all 6 original test cases remain intact.
3. **Conditionally appends only the 7th synthetic test case** (`THAARA-B-OUT01-TaskAndBusiness-v6`) with case-scoped `variable_overrides` if `test_case_count == 6` (`POST .../test-cases`, `201`), verifying the returned `test_case_id` and `test_suite_id` directly without a redundant post-`POST` readback `GET`. If `test_case_count == 7`, verifies the 7th case and all 6 original cases on the initial `GET` and skips `POST .../test-cases`.
4. **Runs ONLY that 7th test case once** (`POST .../test-cases/{case_id}/runs` with `app_version: 6`, `frequency: 1`, `on_end_eval: true`).
5. **Enforces `>= 22.0s` spacing** between all setup/result requests, **`<= 3` requests per `62.0s` rolling window** (`rolling_window_delay`), **`30.0s` polling intervals** for `GET .../runs/{run_id}`, and `Retry-After` compliance up to `65.0s` (with immediate stop on `HTTP 429` and zero automatic retries).

---

## 2. Exact Request Sequence & Pacing

| Step | Minimum Delay / Rolling Window | Endpoint | Expected Status | Purpose |
|---|---|---|---|---|
| 1 | `0.0s` (`t = 0s`) | `GET .../test-suites/{suite_id}` | `200` | Verify suite identity, `variables` already present, 6 existing cases intact, and no active run |
| 2 | `>= 22.0s` (`t >= 22s`) | `GET .../test-suites/{suite_id}/mappings?app_id=Thaara-AI-V-db336de4-5453` | `200` | Verify existing `v6` mapping (`map_id == trusted_mid`, `app_version == 6`, `variable_mapping`) |
| 3 | `>= 22.0s` (`t >= 44s`) | `POST .../test-suites/{suite_id}/test-cases` *(only if `test_case_count == 6`)* | `201` | Append 7th case `THAARA-B-OUT01-TaskAndBusiness-v6` with case-scoped `variable_overrides` |
| 4 | `>= 22.0s` & `<= 3 req/62s` (`t >= 66s`) | `POST .../test-suites/{suite_id}/test-cases/{case_id}/runs` | `202` | Queue 1 single-case simulation run (`app_version: 6`, `frequency: 1`) |
| 5..N | `>= 30.0s` per poll & `<= 3 req/62s` | `GET .../test-suites/{suite_id}/runs/{run_id}` (up to 10 polls) | `200` | Poll every `30.0s` until `status == "completed"` (or stop on `"failed"`) |
| Final | `>= 22.0s` & `<= 3 req/62s` | `GET .../test-suites/{suite_id}/runs/{run_id}/test-cases/{case_id}` | `200` | Fetch transcript and AI judge verdicts for the single execution |

---

## 3. Pinned Artifacts, Guard & Expected Cost

| Artifact | Path | SHA256 |
|---|---|---|
| PowerShell Wrapper | `scripts/phone-sarvam-eval-paced.review.ps1` | `57be37ef8c6b32db9398d09b7bbb8c105c651f264017d746b3861783f1fee64a` |
| Remote Python Payload | `deploy/hostinger-pilot/phone-sarvam-eval-paced.review.py` | `f4ff9fec17ff90d4335c05b48f4798792ba386814db4f0e156a7fe54f4747e9c` |
| Pinned Request Plan | `docs/integrations/phone/knowledge/eval-review-v1/request-plan.review.json` | `76b6885c16496202d7bcad26e11bc0f099f7611215be2b8579b701cf4aadec52` |
| Gate Manifest (locked `false`) | `docs/integrations/phone/PHONE_SARVAM_EVAL_PACED.review.json` | `remoteExecutionAllowed: false` |

- **Dedicated One-Use Remote Guard**:
  `/opt/thaara-v2-pilot-private/phone-eval-stage-b-20261103-v6-run-once` (preserving all 5 prior guards untouched).
- **Expected Cost**:
  **₹2 plus applicable GST** (for the single simulated conversation run at `frequency: 1`; `0` real telephone calls).
- **Exact Command Upon Owner Approval**:
  `pwsh -NoProfile -NonInteractive -File scripts/phone-sarvam-eval-paced.review.ps1 -ApprovedPacedEval`
