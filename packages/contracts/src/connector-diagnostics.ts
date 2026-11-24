import { Type,Static } from '@sinclair/typebox';
export const ConnectorDiagnosticSchema=Type.Object({
 connectorName:Type.Union([Type.Literal('gmail'),Type.Literal('n8n')]),connectionScope:Type.Union([Type.Literal('user'),Type.Literal('workspace')]),
 connectionState:Type.Union(['not_configured','disconnected','connected_mock','configured_unverified','reconnect_required','unavailable'].map(v=>Type.Literal(v))),
 storageKind:Type.Union(['unavailable','ephemeral_encrypted_mock','postgres_durable'].map(v=>Type.Literal(v))),
 storageStatus:Type.Union(['not_configured','not_checked','readable','unavailable'].map(v=>Type.Literal(v))),
 kmsStatus:Type.Union([Type.Literal('not_configured'),Type.Literal('mock_only')]),
 lastDiagnostic:Type.Object({code:Type.Union(['not_configured','local_metadata_read','local_metadata_unavailable'].map(v=>Type.Literal(v))),
  checkedAt:Type.String({format:'date-time'}),providerContacted:Type.Literal(false)},{additionalProperties:false})
},{additionalProperties:false});
export const ConnectorDiagnosticsSchema=Type.Object({connectors:Type.Array(ConnectorDiagnosticSchema,{minItems:2,maxItems:2})},{additionalProperties:false});
export type ConnectorDiagnostic=Static<typeof ConnectorDiagnosticSchema>;
export type ConnectorDiagnostics=Static<typeof ConnectorDiagnosticsSchema>;
