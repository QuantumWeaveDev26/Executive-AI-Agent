import { request } from './api';
export interface ConnectorDiagnostic {
 connectorName:'gmail'|'n8n';connectionScope:'user'|'workspace';
 connectionState:'not_configured'|'disconnected'|'connected_mock'|'configured_unverified'|'reconnect_required'|'unavailable';
 storageKind:'unavailable'|'ephemeral_encrypted_mock'|'postgres_durable';storageStatus:'not_configured'|'not_checked'|'readable'|'unavailable';
 kmsStatus:'not_configured'|'mock_only';lastDiagnostic:{code:'not_configured'|'local_metadata_read'|'local_metadata_unavailable';checkedAt:string;providerContacted:false};
}
export interface ConnectorDiagnosticsResponse {connectors:ConnectorDiagnostic[];}
export const getConnectorDiagnostics=()=>request<ConnectorDiagnosticsResponse>('/api/v1/admin/connectors/diagnostics');
