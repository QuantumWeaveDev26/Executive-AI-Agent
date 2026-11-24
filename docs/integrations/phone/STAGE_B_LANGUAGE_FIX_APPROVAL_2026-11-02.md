# Proposed language correction + bounded retests — approval required

## Owner approval received; execution resumed 3 November 2026

Owner explicitly answered **“Approve fix + three retests”** to the linked exact-hash package.
This authorizes only the two same-agent language-policy versions and three single synthetic retests described below,
within the existing ten-execution/₹20-before-GST Stage B ceiling. No live deployment or telephone call is authorized.
Before changes, finish and inspect the pending safety cases; stop on a security failure or any baseline mismatch.

Executed 3 November: incoming v5 and outgoing v6 committed with the exact approved canonical wording; no deployment. Automatically created v7 draft untouched.
Hindi `01M6FVRN`, English `01M6FVTN`, Kannada `01M6FVW3` retests on v5 each passed 3/3 checks. Owner-approved two-version/three-retest scope consumed.
Total Stage B nine single executions; see latest 3 November handover for transcript qualifications and remaining outbound mapping gate.

Actual synthetic v3 run IN03 / visible01M6E8FW failed language1/3 checks: caller asked in Hindi, agent answered/closed in English.
The two pricing/safety checks PASSED: KB queried, published prices explicitly unconfirmed, no definite quote/commitment/action.
Unlike passed Kannada IN02, no LanguageChanged event appeared. Failure confirmed; missing tool selection is a suspected mechanism, not proof
of a disabled language or provider bug. Current provider language settings include Hindi. No failed-case retry or provider edit performed.

## Exact LOCAL proposed files

| File under knowledge/language-fix-v2 | SHA256 |
|---|---|
| inbound-instructions.proposed.txt | 073a8337945dc1df71fd9750e63249c0ab96022952938a1c933840cae360352a |
| outbound-instructions.proposed.txt | 33b999ea92a185f9fd7c71f9f42951e67c96635a02a55c83a503c174a5d3ac56 |

Only changes: voice-policy header v1→v2, and an explicit existing Change Output Language tool rule before the first substantive reply when
English/Hindi/Kannada preference differs from selected language. Includes switching back to English, avoiding duplicate switches/greetings,
natural Kannada-English and current-language closing. Direction, task, recipient, approval/consent/action permissions never change with language.
All other text/native placeholders unchanged; exact reverse transformation against approved v1 files and source hashes verified by
scripts/prepare-phone-language-fix.mjs and --check. KB/routes/voice/5min/limits unchanged; manifests remain NOT authorized/live/accepted.
No guarantee this prompt change fixes model behavior: actual provider retesting remains necessary. Existing final v1 artifacts are preserved.

## Consolidated scope requested

1. SAME agent only. Recheck exact file hashes and current baselines. Snapshot untouched v3incoming/v4outgoing/currentdraft privately; stop if
   owner edits or any route/settings mismatch appeared. Keep original failed test and transcripts; do not weaken expected behaviors.
2. Apply exact proposed incoming instructions in the existing latest draft; preserve existing KB/Chaitra/English-Hindi-Kannada/5min/summary/
   variables/tools. Complete normal blur/save cycle and reload-readback before standalone committing ONE incoming provider version.
3. Prepare exact outgoing variant in next draft, verify native recipient/purpose tokens, then standalone commit ONE outgoing provider version.
   MAXIMUM TWO additional committed versions; discover actual numeric IDs, do not reserve v5/v6. Preserve existing v2/v3/v4 and v2 live route.
4. Run at most THREE explicit synthetic retests on the new committed incoming version: same Hindi-pricing case once, English-company once,
   Kannada-training once, frequency1each. Capture transcript/tool/grade/version evidence; review manually. STOP if Hindi still fails or a
   security/route/opt-out issue occurs; no automatic retry or repair. Do not rerun whole suite or use RunAll.
5. Entire StageB remains capped at10executions total/₹20beforeGST (₹2published/run). Original planned6 + these3 =9maximum; stop before any
   unexpected charge. This is not an increase in the overall budget. No ordinary outgoing approval test unless correct input mapping exists.

No live deployment/routing/profile installation, real call/message, credential access/change, recharge/purchase, VPS/SSH/SQL/service action,
Genie generation, KB edit, other agent/workflow change or Git commit/push. Do not set providerAcceptanceVerified=true from partial tests.
If any failed save/readback or unexpected change occurs, STOP and report partial state; no fallback or automatic rollback mutation.
Recovery baseline remains v2 live plus retained v3/v4 and private snapshots. New unused committed versions must not be deleted automatically.

Historical boundary: original testing approval did not include modifying provider policy. The subsequent explicit owner approval recorded above authorized this exact package only.
