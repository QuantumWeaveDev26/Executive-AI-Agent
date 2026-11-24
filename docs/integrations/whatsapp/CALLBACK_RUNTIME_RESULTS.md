# WhatsApp callback PostgreSQL acceptance — 27 October 2026

Owner approved the exact new Step1085 fixture/schema/test scope and confined fixes/repeats. **PASS:35/35 real PostgreSQL tests across2 files**, zero failed/skipped, exit0,55.60s initial run. After adding durable owner API assertions, the same35 cases passed again, exit0,136.21s. No assertion was removed or weakened; the second run additionally exercises default full API registration, real session resolution/CSRF, owner catalog/inbox/status, exact reservation/idempotency, durable callback ingestion and disconnect fencing through HTTP injection. No application listener was started.

Commands executed: DB/API builds; `scripts/step1085-runtime.ps1 -Mode initialize -Approved`, then `-Mode test -Approved`. Exact pins and boundaries remain in [preflight](CALLBACK_RUNTIME_PREFLIGHT.md); no SQL changes were required after execution. New1085 artifact SHA `0bee4ba36c23ec620bae3074efe637c6ee8355cf0de4ad5df78135525ed1c774`. Base1083 SHA `4ad4e53f5d1c30b6a2806728359b79ab47695399c79db354bcac1d479d18228e` unchanged.

## Isolation evidence

- New container `thaara-step1085-callback-postgres`, immutable ID `4243d722712b114d9230fe0bafc0d6cbcc5a41574b4d0823e2c0fd68b0e06017`.
- New internal network `thaara-step1085-isolated`, ID `cb090ff887c913027a49c6930145ecfe808428dc247e5a5ffcedc46305cf0270`.
- Database `thaara_step1085_test`; only127.0.0.1:15433. Fresh synthetic credentials in DPAPI-encrypted private cache; no real assets/data. Read-only root, tmpfs-only configuration, no persistent volumes/binds, zero restarts. Docker's Mounts metadata is empty for these HostConfig.Tmpfs entries; guard checks the exact three tmpfs paths separately.
- Original PostgreSQL `cc9e9aca55088a6ece90f8424dba5b217e3519acb3a249d8f10b48c56c442db3` remained healthy with `thaara-ai-agent-v2_postgres_data`. Original Redis `c72d268973fe1389cd0ebe3a8086a420030cfc7c235ccd06fbfd5841a5e03b25` remained healthy with `thaara-ai-agent-v2_redis_data`. No existing container/volume/database or application service changed/restarted. Earlier1084 fixture remains stopped.

## Acceptance established

Actual restricted-role PostgreSQL verifies owner/workspace/RLS and callback operation/revision binding; hidden hashes/guard privileges and approval-mutation denial; mixed/forged identity; expired/revoked principal; demoted membership; disconnect fencing; independent-pool one-use claims; exact current approval; receipt recipient/provider correlation; events-only direct-SQL receipt-association denial; current audit provenance/replay/immutability; transactional rollback/savepoints; duplicate/order safety and pool recreation persistence. Synthetic messages only, false sending gate, offline receipts remain unverified. Pool recreation is not a PostgreSQL server-restart test; tmpfs is deliberately disposable.

## n8n and owner setup checkpoint

Read-only remote inspection reconfirmed both existing Thaara workflows inactive, no active version, all I/O disabled and literal false send gate retained. IDs `ezIrlr7y9dEowujw` and `RrqXTplIBXginMSD`, versions `2624cdbf-e87e-46b0-9cdc-d367605fa0ac` and `0ecb733c-fb60-4fb0-a6d5-144ba17ae056`. Callback URLs still use thaara.invalid/REPLACE_CONNECTION. Sanitized output cannot certify credential assignment; dedicated Meta credentials remain owner-reported created/tested. No remote workflow mutation/execution, provider call, subscription or real send this slice.

Owner confirmed Thaara backend is **not hosted yet**. n8n cannot connect to localhost through its public origin. Hosting choice, approved deployment and matching private callback/webhook credentials are a real next boundary, not another code-only test. Production target migrations remain unapproved; this fixture must never become production. Managed-secret/outbound profile admission and LIVE-mode extension, HTTPS authentication, Meta ownership/signature/version/eligibility and separately approved activation/test-number message remain pending. Full WhatsApp/media/Chat integration is not complete.
