# Local outbound evaluation planning helper

Parent active task: `110-quantum-weave-shared-voice-knowledge.md`; this is its bounded next slice, not another integration.
Owner continued after approved language retests. Existing detailed design: `STAGE_B_OUTBOUND_MAPPING_REVIEW_2026-11-03.md`.

## Design and limits

Use a dependency-free JavaScript helper with pure request planning and Node's test runner. It must never connect to a provider, read
credentials/environment files, change agent defaults or implement a live execution switch. Produce deterministic, checksum-bound synthetic
suite/mapping/single-run descriptors for the existing app's committed outgoing v6 only. Suite/case IDs remain unknown until separately
approved creation; do not invent provider IDs. Mapping/readback prerequisites must fail closed before a run descriptor can be built.
Local readback assertions are fixture checks, not authenticated provider or dispatch evidence. Full acceptance always stays false.

## Implementation plan

1. Add failing tests for pinned scope/version, real mapped input semantics, wrong endpoints/origin, encoded path injection, excess frequency,
   missing/mismatched readbacks, budget/replay handling and inert CLI behavior.
2. Implement pure builder/validator plus a dry-run-only CLI. Pin request method/path/payload; reject unknown arguments/fields that could grant
   execution, carry credentials, alter routes or expand spend. No generic HTTP executor or secret source.
3. Run focused tests; check all proposal/artifact hashes and whitespace. Preserve application/runtime/Vite files.
4. Record exact results and unresolved account/credential/API-readback prerequisites. Generate reviewable local JSON only.

Execution boundary: no authenticated provider request, suite/mapping creation, paid run, real call, secret-file access, VPS, migration, deployment,
Git commit/push. A later executable helper and secure credential path require separate review/approval. Do not claim this planner resolves access.

## Verified result

Steps 1–4 complete. Fresh 9/9 Node tests, syntax and whitespace PASS; independent focused review no consequential findings.
Generated review JSON and source/body checksums recorded in the mapping review. Vite/application code unchanged; no network or secrets used.
Owner confirmed key only on VPS. Next separate execution package must keep it there; no remote auth or provider request authorized yet.

## VPS-only execution preparation completed

Owner revision: replace website-only case with ONE outgoing-v6 task + company question + actual KB retrieval + natural return + truthful report case.
Five named checks; no answer supplied by synthetic Ram until Thaara resumes naturally. No extra paid evaluation/model call.
Updated failing tests then implementation; planner10 + executor16 + wrapper7 =33/33 pass. Pinned JSON/Python hash/manifest/approval document regenerated,
remote gate remains false. Manual retrieval/order/grounding review pending paid test; no claim of live backend persistence from synthetic transcript.

Prepared new reviewed wrapper/payload/false-gate manifest and `PHONE_SARVAM_EVAL_EXECUTION_APPROVAL_2026-11-03.md`, without executing remotely.
Fresh combined31/31 focused checks (15 executor,7 wrapper,9 planner); independent security review findings fixed and re-reviewed.
New remote root-owned guard/receipts and one synthetic suite/mapping/run require the exact separate scoped approval. No change to original SSH helper,
existing integrations, runtime profile, app source or Vite. Remaining status and exact pins: latest 3 November handover.
