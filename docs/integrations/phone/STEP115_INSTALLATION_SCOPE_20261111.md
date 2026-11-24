# Step 115 disabled installation approval scope

**Superseded authorization status:** The original approval led to an attempt that stopped before SQL because the WhatsApp team changed the API image. A subsequent read-only check confirmed unchanged schema. The owner then instructed production to remain unchanged and required isolated PostgreSQL 16.15 and backup/restore checks before any new approval request. Do not execute this historical scope. See `STEP115_SQL_EFFECTS_AND_RECOVERY_20261111.md` and the refreshed review manifest `PHONE_STEP115_INSTALL_20261111_R3.review.json`.

The read-only inspection is complete. Applying this installation requires a separate owner decision.

- Target database `thaara_vps_pilot`, PostgreSQL version `160015`.
- Observed API image `sha256:953a089698496c46d479eba46590b9afbd3dce672531f85f5ff29b4163038514`. Recheck it before any production action and stop on drift.
- SQL `docs/migrations/115-step115-hosted-install-20261111-r2.review.sql`.
- SQL SHA-256 `c809ba7c0a44f9bdf3b76a1566edf1fbe6fc33e39a1d0c1d25e58a53025dcf8e`.
- Manifest `docs/integrations/phone/PHONE_STEP115_INSTALL_20261111_R2.review.json`.
- Manifest SHA-256 `d0ed08bdcaab46e4c5ed6fae578adc8ad823a7a5312e142c38ba1576d85839ca`.

One transaction adds seven Phone tables, four restricted NOLOGIN roles and the reviewed functions/policies. It validates the existing callback function hashes and all 46 observed Phone columns. The restricted guard roles receive reviewed read/row-lock access on memberships and approvals, plus audit insert access. Their RLS write checks prohibit changing membership and approval rows. Installation creates schema without rewriting existing records. Runtime grants are normalized to minimum table/column permissions, including when default privileges are broad. The final checks reject unexpected inherited access.

Any SQL error rolls back the entire installation. After a successful disabled installation, retain the additive objects and any later records during an application rollback. Database object removal is outside this scope.

No server restart, container replacement, role login/password, secret provisioning, worker activation, real call or real email is included in this approval. Those actions need a subsequent admitted release and their scoped authorization. Existing production startup and provider admission guards remain.

R3 supersedes earlier review artifacts for installation planning. Validation includes 97 passing acceptance tests and six offline metadata-runner checks, including default-permission attacks against approval history and immutable dispatch snapshots. A read-only security follow-up found no further actionable issues in the reviewed installation hardening.
