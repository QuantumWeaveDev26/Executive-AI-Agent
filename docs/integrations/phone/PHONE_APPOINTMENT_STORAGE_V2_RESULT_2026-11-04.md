# Appointment-storage V2 acceptance result — 4 November 2026

One explicitly approved execution completed. No retry. Manifest SHA256:
5ded468440779ca439831b028fb91e78398f49977ead733e5c7fe3e126d7e0dd

Source preflight318/318 passed; isolated fixture admission and12 base migrations passed.
Fresh beforeAll bootstrap applied unchanged112h/113h and checked restricted roles/RLS.
Fresh cases5–9:5PASS/0FAIL. Cases1–4:4 intentional skips, historical V1 evidence only.

-5 PASS: wrong credentials/call binding/revoked/expired identities refused; no writes.
-6 PASS: tenant/owner access and restricted ingest role boundaries.
-7 PASS: endpoint/pool recreation and duplicate persistence (not database restart).
-8 PASS: pre-commit failure rollback and planned explicit recovery submission.
-9 PASS: missing consent and demoted owner denied.

Runner cleanup passed. Independent exact-ID Docker queries confirmed container/network absent,
matching run-labelled destroy event, free127.0.0.1:15436, closed relay,0children/0sockets.
No persistent volumes used. Existing V1 evidence and consumed marker preserved. V2 marker retained.
No provider/Calendar operation, real call/appointment, VPS, deployment or production migration.

Evidence SHA256:
- node_modules/.cache/phone-appointment-storage-v2/used.json: ded2a42d58504234451e7d09c3e89bd94b1c7fb52deb6f5c1989542e62359376
- node_modules/.cache/phone-appointment-storage-v2/fixture.json: af4df1afc67b1113b6e94e2003465697a2f5459e655515abaf18c1bf32888bb6
- node_modules/.cache/phone-appointment-storage-v2/result.json: 1007e3b6f7f594b93e39fed0bed98101be9755c4688aab8e2a4c001868ddc45b
- node_modules/.cache/phone-appointment-storage-v2/cleanup-independent.json: bdf4091225fec95b45339e734fd9892b22e5d989f8cd09638061f7b7bb91df5e

Remaining blockers: production Phone database admission and scoped installation approval; dedicated
production identity/secret provisioning; appointment endpoint deployment and trusted owner-session
resolution; reviewed Sarvam tool connection preserving v5/v7; separately approved real booking test.
F-03 remains OPEN. Local acceptance does not grant production admission or prove live Calendar booking.
Stopped after reporting as instructed. No further execution authorized.
