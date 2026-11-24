# Step 81 — Persistent n8n Connection Adapter

Date: 17 October 2026 (Asia/Calcutta)
Status: COMPLETE (isolated PostgreSQL + mocked KMS; production KMS/live providers remain `not_configured`)
Workspace: `C:\ThaaraProjects\thaara-ai-agent-v2`
Branch: `dev-thaara-continuation`
Base Commit (`HEAD`): `d3b2921` (`d3b2921d42e5581c1e1991a7cab5a63261a80b8e`)

## Implemented

1. **[`PostgresConnectorStateStore`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/src/services/postgres-connector-store.ts)**:
   - Implements `ConnectorStateStore` (`mode: 'mock'`, `storage: 'postgres_durable'`) over `TransactionalDbClient.withScopedTransaction`.
   - Calls only the reviewed restricted PostgreSQL entry points `public.read_workspace_connector_connection` and `public.commit_workspace_connector_connection` under `thaara_app` and `FORCE ROW LEVEL SECURITY`.
   - Enforces canonical SHA-256 server profile configuration fingerprints (`computeConnectorProfileFingerprint`), envelope structure validation (`isCredentialEnvelope`, `isConnectorBinding`), monotonic compare-and-swap revisions, disconnect tombstones (`profile_id = NULL`, `credential_envelope = NULL`), and atomic secret-free `audit_events` writes.
   - Maps SQL `42501` session/membership/role denials to `ForbiddenError` (`403`) and redacts all database/profile errors to `CONNECTOR_STORAGE_UNAVAILABLE` (`503`).
2. **[`DurableN8nSecurityPrototype`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/src/services/durable-n8n-security.ts) Enhancements**:
   - Reports `storage: 'postgres_durable'` when backed by `PostgresConnectorStateStore` (preserving `mock_restart_simulation` for in-memory `MockConnectorStore`).
   - Adds `rotate(scope, expectedRevision, keys)` integrating `ConnectorKeyRotationPreparation` with atomic `connector.connection.key_rotated` PostgreSQL commits.
   - Adds `transport(scope, existingAccess?)` returning a governed `N8nCreateOnlyTransport` that verifies the durable PostgreSQL binding and decrypts via mocked KMS before each call, enforces `workflow.active === false` (`CONNECTOR_WORKFLOW_ACTIVE_FORBIDDEN`), and re-verifies `assertCurrent(scope, access)` after completion or error so concurrent disconnects/rotations fence stale credentials and withhold delayed responses (`CONNECTOR_CONNECTION_CHANGED`, `409`).

## Verification

- **Focused Suites**: `73/73` passed across 4 files (`10/10` in [step79b-connector-security.runtime.test.ts](file:///c:/ThaaraProjects/thaara-ai-agent-v2/packages/db/test/step79b-connector-security.runtime.test.ts), `30/30` in [durable-connector-security.test.ts](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/test/durable-connector-security.test.ts), `17/17` in [connector-key-rotation.test.ts](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/test/connector-key-rotation.test.ts), `16/16` in [n8n-connections.test.ts](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/test/n8n-connections.test.ts)).
- **Isolation Check**: `node scripts/step74-initialize.mjs check` confirmed disposable test container identities and unchanged development `.env` / `thaara_v2` containers.

## Limitations & Recommended Step 82

- Production KMS remains `not_configured` (mocked KMS only), and Step 79A SQL remains review-only outside default runtime migrations until promoted with an approved KMS provider.
- **Recommended Step 82**: Wire optional durable PostgreSQL connector management into the `/api/v1/connectors/n8n` routes and governed step executor behind explicit test/approved configuration while keeping default runtime `not_configured` and all workflows inactive.
