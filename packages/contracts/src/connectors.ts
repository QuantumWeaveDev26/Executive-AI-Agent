import { Type, Static } from '@sinclair/typebox';
import { ConnectorStateSchema } from './states.js';

export const ConnectorStatusResponseSchema = Type.Object({
  connectorName: Type.String(),
  status: ConnectorStateSchema,
  connected: Type.Boolean(),
  configured: Type.Boolean(),
  message: Type.String(),
  lastVerifiedAt: Type.Union([Type.String(), Type.Null()])
});
export type ConnectorStatusResponse = Static<typeof ConnectorStatusResponseSchema>;
