import { createHash } from 'node:crypto';
import { AuthenticatedScope, TransactionalDbClient } from '@thaara/db';
import { AppError, ForbiddenError } from '@thaara/observability';
import {
  ConnectorAudit,
  ConnectorBinding,
  ConnectorKind,
  ConnectorRecord,
  ConnectorStateStore,
  CredentialEnvelope,
  isConnectorBinding,
  isCredentialEnvelope
} from './connector-security.js';

export interface PostgresConnectorProfileInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly label: string;
  readonly connector?: ConnectorKind;
  readonly configurationFingerprint?: string;
}

export interface PostgresConnectorStoreOptions {
  readonly mode: 'mock';
  readonly db: TransactionalDbClient;
  readonly profiles: ReadonlyArray<PostgresConnectorProfileInput>;
}

interface PostgresConnectorRow {
  workspace_id: string;
  connector_key: ConnectorKind;
  revision: string | number;
  status: 'configured_unverified' | 'disconnected';
  profile_id: string | null;
  profile_fingerprint: string | null;
  credential_envelope: CredentialEnvelope | null;
}

const allowedConnectors = new Set<ConnectorKind>(['n8n', 'gmail', 'calendar', 'whatsapp', 'phone']);
const uuidRegex = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const profileIdRegex = /^[A-Za-z0-9_-]{1,64}$/;
const labelRegex = /^[A-Za-z0-9 ._-]{1,60}$/;
const fingerprintRegex = /^[a-f0-9]{64}$/;

export function computeConnectorProfileFingerprint(input: {
  workspaceId: string;
  connector: ConnectorKind;
  id: string;
  label: string;
}): string {
  return createHash('sha256')
    .update(JSON.stringify([1, input.workspaceId, input.connector, input.id, input.label]))
    .digest('hex');
}

const storageUnavailable = () =>
  new AppError('Connector storage is unavailable.', 'CONNECTOR_STORAGE_UNAVAILABLE', 503);

export class PostgresConnectorStateStore implements ConnectorStateStore {
  readonly mode = 'mock' as const;
  readonly storage = 'postgres_durable' as const;
  private readonly profileFingerprints = new Map<string, string>();

  constructor(private readonly options: PostgresConnectorStoreOptions) {
    if (!options || options.mode !== 'mock' || !options.db) {
      throw new Error('Step 81 PostgreSQL connector store requires mock KMS mode and a transactional database client.');
    }
    for (const p of options.profiles) {
      const connector = p.connector ?? 'n8n';
      if (
        !uuidRegex.test(p.workspaceId) ||
        !allowedConnectors.has(connector) ||
        !profileIdRegex.test(p.id) ||
        !labelRegex.test(p.label)
      ) {
        throw new Error('Invalid connector server profile definition.');
      }
      const fp =
        p.configurationFingerprint ??
        computeConnectorProfileFingerprint({
          workspaceId: p.workspaceId,
          connector,
          id: p.id,
          label: p.label
        });
      if (!fingerprintRegex.test(fp)) {
        throw new Error('Connector server profile fingerprint must be a 64-character lowercase hex SHA-256 digest.');
      }
      const key = JSON.stringify([p.workspaceId, connector, p.id]);
      if (this.profileFingerprints.has(key)) {
        throw new Error('Duplicate connector server profile definition.');
      }
      this.profileFingerprints.set(key, fp);
    }
  }

  private validateScope(scope: AuthenticatedScope, connector: ConnectorKind) {
    if (
      !scope ||
      typeof scope.sessionTokenHash !== 'string' ||
      !scope.sessionTokenHash.trim() ||
      !uuidRegex.test(scope.workspaceId) ||
      !uuidRegex.test(scope.userId) ||
      !allowedConnectors.has(connector)
    ) {
      throw new ForbiddenError('Active matching workspace membership is required.');
    }
    if (!['admin', 'owner'].includes(scope.role)) {
      throw new ForbiddenError('Active matching workspace membership is required.');
    }
  }

  private fingerprintFor(workspaceId: string, connector: ConnectorKind, profileId: string): string | undefined {
    return this.profileFingerprints.get(JSON.stringify([workspaceId, connector, profileId]));
  }

  private mapDatabaseError(error: unknown): never {
    if (error instanceof ForbiddenError) {
      throw new ForbiddenError('Active matching workspace membership is required.');
    }
    const pgCode = (error as { code?: string })?.code;
    const msg = (error as { message?: string })?.message ?? '';
    if (
      pgCode === '42501' &&
      /Active workspace admin|Active session required/i.test(msg)
    ) {
      throw new ForbiddenError('Active matching workspace membership is required.');
    }
    throw storageUnavailable();
  }

  async read(subject: AuthenticatedScope, connector: ConnectorKind): Promise<ConnectorRecord | null> {
    const scope = Object.freeze({ ...subject });
    this.validateScope(scope, connector);
    try {
      const { rows } = await this.options.db.withScopedTransaction(scope, (tx) =>
        tx.query<PostgresConnectorRow>(
          'SELECT workspace_id, connector_key, revision, status, profile_id, profile_fingerprint, credential_envelope FROM public.read_workspace_connector_connection($1)',
          [connector]
        )
      );
      const row = rows[0];
      if (!row) return null;

      const revision = Number(row.revision);
      if (
        row.workspace_id !== scope.workspaceId ||
        row.connector_key !== connector ||
        !Number.isSafeInteger(revision) ||
        revision <= 0
      ) {
        throw storageUnavailable();
      }

      if (row.status === 'disconnected') {
        if (row.profile_id !== null || row.profile_fingerprint !== null || row.credential_envelope !== null) {
          throw storageUnavailable();
        }
        return {
          workspaceId: row.workspace_id,
          connector: row.connector_key,
          profileId: null,
          revision,
          state: 'disconnected',
          envelope: null
        };
      }

      if (row.status !== 'configured_unverified' || !row.profile_id || !row.profile_fingerprint || !row.credential_envelope) {
        throw storageUnavailable();
      }

      const expectedFingerprint = this.fingerprintFor(scope.workspaceId, connector, row.profile_id);
      const candidate: ConnectorRecord = {
        workspaceId: row.workspace_id,
        connector: row.connector_key,
        profileId: row.profile_id,
        revision,
        state: 'configured_unverified',
        envelope: Object.freeze({ ...row.credential_envelope })
      };

      if (
        !expectedFingerprint ||
        row.profile_fingerprint !== expectedFingerprint ||
        !isConnectorBinding(candidate as ConnectorBinding) ||
        !isCredentialEnvelope(candidate.envelope)
      ) {
        throw storageUnavailable();
      }

      return candidate;
    } catch (error) {
      this.mapDatabaseError(error);
    }
  }

  async commit(
    subject: AuthenticatedScope,
    connector: ConnectorKind,
    expectedRevision: number,
    nextRecord: ConnectorRecord,
    audit: ConnectorAudit
  ): Promise<boolean> {
    const scope = Object.freeze({ ...subject });
    this.validateScope(scope, connector);

    const next: ConnectorRecord = Object.freeze({
      ...nextRecord,
      envelope: nextRecord?.envelope ? Object.freeze({ ...nextRecord.envelope }) : null
    });

    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      expectedRevision >= Number.MAX_SAFE_INTEGER ||
      next.workspaceId !== scope.workspaceId ||
      next.connector !== connector ||
      next.revision !== expectedRevision + 1 ||
      audit?.workspaceId !== scope.workspaceId ||
      audit?.actorUserId !== scope.userId ||
      audit?.payload?.connector !== connector ||
      audit?.payload?.revision !== next.revision ||
      audit?.payload?.localOnly !== true
    ) {
      throw storageUnavailable();
    }

    let operation: 'configure' | 'rotate' | 'disconnect';
    let profileId: string | null = null;
    let profileFingerprint: string | null = null;
    let envelopeJson: string | null = null;

    if (next.state === 'disconnected') {
      if (next.profileId !== null || next.envelope !== null || audit.action !== 'connector.connection.disconnected') {
        throw storageUnavailable();
      }
      operation = 'disconnect';
    } else if (next.state === 'configured_unverified') {
      if (
        !next.profileId ||
        !isConnectorBinding(next as ConnectorBinding) ||
        !isCredentialEnvelope(next.envelope) ||
        !['connector.connection.configured', 'connector.connection.key_rotated'].includes(audit.action)
      ) {
        throw storageUnavailable();
      }
      const fp = this.fingerprintFor(scope.workspaceId, connector, next.profileId);
      if (!fp) {
        throw storageUnavailable();
      }
      operation = audit.action === 'connector.connection.key_rotated' ? 'rotate' : 'configure';
      profileId = next.profileId;
      profileFingerprint = fp;
      envelopeJson = JSON.stringify(next.envelope);
    } else {
      throw storageUnavailable();
    }

    try {
      const { rows } = await this.options.db.withScopedTransaction(scope, (tx) =>
        tx.query<{ rev: string | number | null }>(
          'SELECT public.commit_workspace_connector_connection($1, $2, $3, $4, $5, $6::jsonb) AS rev',
          [connector, expectedRevision, operation, profileId, profileFingerprint, envelopeJson]
        )
      );
      const committedRev = rows[0]?.rev;
      if (committedRev === null || committedRev === undefined) {
        return false;
      }
      return Number(committedRev) === next.revision;
    } catch (error) {
      this.mapDatabaseError(error);
    }
  }
}
