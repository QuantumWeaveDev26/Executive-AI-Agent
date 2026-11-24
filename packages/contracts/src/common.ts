import { Type, Static } from '@sinclair/typebox';

export const ErrorDetailSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  details: Type.Optional(Type.Unknown())
});

export const ErrorResponseSchema = Type.Object({
  error: ErrorDetailSchema
});
export type ErrorResponse = Static<typeof ErrorResponseSchema>;

export const HealthResponseSchema = Type.Object({
  status: Type.Literal('ok'),
  version: Type.String(),
  timestamp: Type.String()
});
export type HealthResponse = Static<typeof HealthResponseSchema>;
