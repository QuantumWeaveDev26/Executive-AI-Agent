import { FastifyInstance } from 'fastify';
import { TransactionalDbClient, AuthenticatedScope } from '@thaara/db';
import { PolicyGateway } from '@thaara/policy';
import { LocalConnectorDiagnosticReader } from './connector-diagnostics.js';
import { DurableN8nSecurityOptions } from '../services/durable-n8n-security.js';
import { N8nConnectionOptions } from '../services/n8n-connections.js';
export declare function registerN8nConnections(app: FastifyInstance, options: {
    db: TransactionalDbClient;
    policyGateway: PolicyGateway;
    connections?: N8nConnectionOptions;
    durable?: DurableN8nSecurityOptions;
}): Promise<{
    details: (scope: AuthenticatedScope) => Promise<{
        revision?: number | undefined;
        status: string;
        mode: "mock" | "disabled";
        connectorName: "n8n";
        configured: boolean;
        storage: "unavailable" | "ephemeral_encrypted_mock" | "postgres_durable";
        managementEnabled: boolean;
        selectedProfileId: string | null;
        profiles: {
            label: string;
            id: string;
        }[];
        liveProvidersStatus: "not_configured";
    }>;
    diagnostics: LocalConnectorDiagnosticReader;
    transport: (scope: AuthenticatedScope) => Promise<import("@thaara/policy").N8nCreateOnlyTransport | undefined>;
}>;
//# sourceMappingURL=n8n-connections.d.ts.map