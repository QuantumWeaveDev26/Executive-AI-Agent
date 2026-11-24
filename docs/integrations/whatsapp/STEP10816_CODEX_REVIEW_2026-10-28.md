# Step 108.16 continuation review — 28 Oct 2026

Branch `dev-thaara-continuation`, HEAD `d6331e0`; preceding local commit `f6553cb`. Existing `.gitattributes` staging and all dirty/untracked work preserved. No remote changes, credential access, provider requests, SQL, infrastructure changes, commit or push performed.

## Reviewed behavior

Reviewed the uncommitted durable send profile, post-commit hand-over, fixed-origin pilot transport, shared claim contract, pilot configuration and enable/disable/owner CLI scripts. The durable claim rechecks approval, scope, connection revision, opt-in and the customer-service window. The profile narrows connection, recipient, expiry and claimed-attempt count. PostgreSQL repository connection-row locking serializes claims; this session did not repeat PostgreSQL runtime acceptance. Production status/LIVE labelling remains a separate known gap.

## Findings

1. **Fixed locally: misleading CLI failure output.** The catch handler previously printed arbitrary exception text and asserted that nothing was sent, even though an error can occur after a hand-over. It now emits a fixed, secret-free message that the outcome is unknown and the stored receipt must be checked before retrying. A subprocess regression deliberately fails before any database/secret/network access. Red confirmed the old misleading output; green confirmed the corrected output.
2. **Fixed locally: incomplete enable rollback.** The old enable script left widened permissions and temporary send files behind on failure. It now requires the disable script and a send-off starting state, captures restore files before mutation, and traps errors/signals to run containment. Failed enable still exits nonzero, including after successful cleanup. Synthetic failure after permission widening proves events-only restoration, send-off and removal of all three temporary files.
3. **Fixed locally: shutdown success was not enforced.** Shutdown now restricts the relay first, continues all containment steps despite failures, requires API health and an exact send-off flag, checks removal of all temporary send files, and exits nonzero on any failed operation or missing restore files. It reports residual uncertainty without secret values. A failed permission restriction or API recreation cannot produce a successful shutdown result.
4. Added executable synthetic failure tests in `scripts/whatsapp-send-script-safety.test.ts`. They run the actual scripts with only fixed pilot paths rewritten to disposable test directories and a fake Docker shell function. They cover enable failure after widening, API shutdown failure, normal shutdown, relay revocation failure and missing restore files. No Docker client/server, VPS or external database is contacted. Initial restricted Git Bash launch failed due to Windows named-object permissions; the approved local unsandboxed run reproduced the two actual bugs, then passed after correction.

These are local review findings, not evidence that the recorded remote shutdown failed. Remote OFF state is historical handoff evidence; it was not independently probed this session.

## Fresh verification

- Before the CLI correction: 67/67 focused tests, four files, exit 0.
- New CLI regression: failed as expected against the old code (one failing selected test).
- Final focused run: `pnpm.cmd exec vitest run scripts/whatsapp-send-script-safety.test.ts scripts/hostinger-pilot-db.test.ts apps/api/test/whatsapp-pilot-send.test.ts apps/api/test/whatsapp-durable.test.ts scripts/hostinger-pilot.test.ts` — **73/73**, five files, zero failed/skipped, exit 0, 17.44 seconds. The two shell failure regressions first failed against the old scripts; all five shell cases pass after correction.
- `pnpm.cmd --filter @thaara/api typecheck` — exit 0.
- `git diff --check` — exit 0 after source changes; checked again after final documentation updates.
- Earlier 392/392 regression and 9/9 PostgreSQL harness results remain historical handoff evidence, not fresh results from this session. No migration-dependent suite rerun.

## Next boundary

Remain on the same task. Obtain owner confirmation of the privately updated Meta token, then request one concrete consolidated retry approval. The request must include transferring and checksum-verifying the corrected enable/disable/CLI scripts before using them; the VPS still has the earlier versions. Do not reuse consumed approvals or commit without permission. Preserve outbound execution saving OFF and use only `n8n-link-v2.sh`. No unrelated n8n workflow access is required. Synthetic cleanup tests are not proof of remote shutdown or successful delivery.
