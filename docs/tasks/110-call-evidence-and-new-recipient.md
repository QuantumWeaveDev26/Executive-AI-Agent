# Call evidence and new recipient previews

Local only. Preserve existing Phone approvals, terminal call immutability, provider binding and WhatsApp/Bulk Campaign work.

- [x] Preserve ordered provider-labelled dialogue in a bounded shared report contract; label ASR/translation and missing evidence explicitly.
- [x] Share Chat/History rendering. Never replace a stored report with an independently generated browser summary.
- [x] Normalize explicit Indian mobile numbers, exact directory matching and blocked one-call recipient previews; no implicit contact save or eligibility grant.
- [x] Test positive and negative evidence, recipient, authorization and failure paths. Typecheck affected packages.

Dependencies: existing Phone ledger, consent and approval gateway. Existing terminal-state database functions cannot store new dialogue without separate review; do not bypass them. No SQL, Docker, provider operations, deployment or real calls authorized. Active outbound KB remains unverified until the running version and provider attachment are inspected read-only.

Verification: 132 current focused tests across 10 files (127 initial; affected 47 rerun, expanded evidence 5 and recipient 10, recipient 10), contracts build and API/web typechecks pass. Live durable dialogue persistence and active outbound KB verification remain blocked; production new-recipient eligibility resolver absent. No deployment readiness claim. See latest November 5 handover.
