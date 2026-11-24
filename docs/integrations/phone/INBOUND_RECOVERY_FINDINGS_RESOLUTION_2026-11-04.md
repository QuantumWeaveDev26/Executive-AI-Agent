# Independent review findings — local resolution and re-review request

Status: LOCAL FIXES ONLY. Not approved or execution-ready. No VPS/credentials/Docker/SQL/provider
operation ran. Existing independentReviewComplete:false and every other approval field are unchanged.
Only source-file checksums in the review manifest were refreshed, with the new process regression added.
The original review ZIP remains unchanged; a separate fixes bundle provides current inventory and hashes.

## Findings validated independently

| Finding | Evidence and disposition | Exact changed locations |
|---|---|---|
| F-01 HIGH | Confirmed missing fresh source count observation: the old core compared restored counts to its exported snapshot, while the new hook compared clone counts to that same old snapshot. Source image/identity rechecks did not recount tables. Added a fresh read-only source snapshot AFTER clone rehearsal, required before successful receipt. A mismatch fails closed as source_count_drift. | Payload `recount_source` lines74–80; generated core integration line143 and category mapping lines153–155. Wrapper success receipt checks line168; receipt fields line174. |
| F-02 MEDIUM | Confirmed: the old function-wide grantee set allowed ingest EXECUTE on scope_matches too. SQL now permits ingest only on exact resolve_grant(text,text,text) and append_event(jsonb) signatures. Independent Python validation enforces all three per-function ACLs, owner rights, no PUBLIC/unknown grantees and no ingest grant option. | Payload SQL lines43–47; `validate_function_catalog` lines82–95; hook call line196. |
| F-03 MEDIUM | Confirmed design limitation, not independently verified schema approval. The operation captures a new observed fingerprint; no approved expected fingerprint is supplied or compared. Added explicit catalogPurpose=observed_unapproved_baseline and independentBaselineVerified:false to private proof, payload and wrapper receipt. Independent expected-baseline verification remains NOT IMPLEMENTED and required before persistent installation. | Payload `capture_status` lines70–72; generated receipt line146; proof/return lines200–203. Wrapper capture-only validation line169 and receipt line174. |
| F-04 MEDIUM | Confirmed and reproduced: synchronous stdin Write ran before the old WaitForExit timeout. A4MiB input to a synthetic child sleeping without reading exceeded its budget and returned a broken-pipe failure rather than timeout. Replaced it with asynchronous write/flush and one elapsed deadline shared with process/output waits. Cleanup kill/waits are bounded; uncertain cleanup is reported, not certified or retried. | Wrapper `Invoke-OwnedProcess` lines15–59: deadline18–25, async stdin38–39, process/output42–43, cleanup47–57. New regression `scripts/phone-inbound-owned-process.test.ts` lines19–33. |

Line numbers above refer to the corrected files in this review revision. The legacy multipurpose
`deploy/hostinger-pilot/phone-backup-restore.review.py` is UNCHANGED; its behavior is extended only through
the dedicated inbound wrapper's verified backup-only extraction. Hosted112h/113h SQL and the original
agent-only authentication helper are also unchanged. No shared application/auth/navigation/WhatsApp edit.

## F-01 interpretation and safe failure

The original exported snapshot remains the reference for archive/restore consistency. The new source
recount is a separate fresh point-in-time observation, not a reused transaction. The session always
closes, including on query failure. A successful receipt requires both sourceCountsRechecked:true and
sourceCountsMatchSnapshot:true; missing/failed/mismatching recount cannot certify the combined operation.

Normal application activity may legitimately change counts while this read-only backup is running.
Such drift now makes the combined operation fail verification; it does NOT prove the operator mutated
the source or that the consistent archive is corrupt. No source repair, pause, lockout or retry is added.
Equal counts also do NOT prove unchanged row contents or rule out writes after the observation.
sourceMutated:false describes the operator's read-only behavior, not a guarantee about other writers.

## F-03 capture versus independent verification

Canonicalization produces a repeatable description of WHAT WAS OBSERVED. Hashing it makes it comparable;
it does not establish that it is the intended approved schema. This package remains capture-only.
The new metadata never grants permission or marks a baseline independently verified. An installer must
obtain an independently reviewed/reference fingerprint with provenance tied to exact SQL/image/context,
then compare it inside the protected install boundary. It must not copy an observed hash into its
expected field and treat that as independent approval. The existing test-only sequence contract still
requires an expected fingerprint; this recovery payload does not fulfill that approval requirement.

## Tests actually run — local only

```powershell
& C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe -B scripts/phone_inbound_recovery_rehearsal_test.py
pnpm exec vitest run scripts/phone-inbound-recovery-rehearsal.test.ts scripts/phone-inbound-owned-process.test.ts scripts/phone-inbound-install-sequence.test.ts scripts/phone-inbound-hosted-install-review.test.ts --exclude '**/.agents/worktrees/**' --pool=threads --poolOptions.threads.singleThread --reporter=json --outputFile=node_modules/.cache/phone-inbound-findings-fixes-20261104.json
git diff --check
```

- Python17/17 PASS. Fresh source match/drift/error/close mocks; per-function excessive grant/grant-option/
  PUBLIC rejection; a full mocked clone handoff, including rejection even when SQL booleans falsely
  claim success; capture-only proof metadata. Every SQL/Docker interaction is a fake.
- Vitest23/23 PASS. Includes a REAL BENIGN LOCAL Python child, no stdin reader,4MiB synthetic input,
 800ms deadline; verifies timeout, elapsed<3000ms including observed cleanup, a startup PID record and
  that exact child no longer exists. Normal synthetic input/output also passes. No SSH executable,
  credential, recovery execution mode, Docker or SQL is used by that process test.
- The pre-fix stalled-input regression failed; initial new Python behavior tests also failed before fixes.
- Whitespace check PASS. No API/web source changed, so unchanged historical builds were not rerun.
- Machine receipts: `node_modules/.cache/phone-inbound-findings-fixes-20261104.json` and
  `phone-inbound-findings-python-20261104.json`.

## Current source SHA256

| File | SHA256 |
|---|---|
| scripts/phone-inbound-recovery-rehearsal.review.ps1 |1f89b251c3253be2ddff36f449713a0b802f946e7996cf4dae8b2852acc4ecd2|
| deploy/hostinger-pilot/phone-inbound-recovery-rehearsal.review.py |ae0a97f07d7b5a06754ebec751a3206082f4abc611efc0979f4e86c51f5b5b9a|
| scripts/phone_inbound_recovery_rehearsal_test.py |665adfcfd5e7809973e55be016f6db8ff42301f881e580d2e645bd6d49aba6cb|
| scripts/phone-inbound-owned-process.test.ts |59f80c59f80a988f999d144b479ae893c6f1ff6d789e5d450bea5c4ccd401d92|
| docs/integrations/phone/PHONE_INBOUND_RECOVERY_REHEARSAL_V1.review.json |4bad27600da28ffe3eed2fb2d18a919e652a14016e9d8c5bf94ddb60a04f036a|

These are review snapshot hashes, NOT execution authorization. The manifest now lists10 artifacts;
its non-artifact fields are byte-value equivalent to the original JSON values. No gates changed.
Full updated source/bundle inventory is in `INBOUND_RECOVERY_FINDINGS_FIX_INVENTORY_2026-11-04.json`.

## Runtime assumptions and next independent review

1. No new PostgreSQL query, per-function regprocedure predicate, source recount, Linux backup/restore,
   SSH session, real tmpfs proof or real cleanup was exercised. These fixes require independent review
   and a NEW scoped runtime authorization before any such test. Old9/9 results do not validate new code.
2. Re-review fresh-snapshot timing, normal concurrent count drift, capture-only wording and provenance.
3. Re-review exact per-function SQL/Python allowlists and rejection of inherited/excess privileges.
4. Re-review shared stdin/process/drain deadline and bounded kill/I/O settlement. Unkillable processes,
   OS-level startup stalls, inherited pipe handles and real SSH behavior remain unverified. Output size
   is still checked after ReadToEndAsync; an incremental memory bound was not introduced by this fix.
5. F-03 remains an OPEN independent expected-baseline design requirement. Do not close it as a runtime
   verifier merely because capture metadata is now honest. Keep execution and runtime admission blocked.

No approval gate flip, key/secret read, service change, migration execution, commit/push/merge, call or
message occurred. All pre-existing uncommitted work and Antigravity's worktree were preserved.
