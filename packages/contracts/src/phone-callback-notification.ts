import { Type, type Static } from '@sinclair/typebox';

const detail = Type.Optional(Type.Union([Type.String({ maxLength: 240 }), Type.Null()]));

/** Structured call details, with identity and routing deliberately absent. */
export const PhoneCallbackDetailsSchema = Type.Object({
  requested: Type.Literal(true),
  name: detail,
  business: detail,
  service: detail,
  phoneNumber: detail,
}, { additionalProperties: false });

export type PhoneCallbackDetails = Static<typeof PhoneCallbackDetailsSchema>;

export const PhoneCallbackNotificationStatusSchema = Type.Union([
  Type.Literal('pending'), Type.Literal('sending'), Type.Literal('submitted'),
  Type.Literal('failed'), Type.Literal('unverified'), Type.Literal('needs_review'),
]);
export type PhoneCallbackNotificationStatus = Static<typeof PhoneCallbackNotificationStatusSchema>;

export const PhoneCallbackReportSchema = Type.Object({
  requestId: Type.String(), callId: Type.String(), direction: Type.Union([Type.Literal('inbound'), Type.Literal('outbound')]),
  name: Type.Union([Type.String(), Type.Null()]), business: Type.Union([Type.String(), Type.Null()]),
  service: Type.Union([Type.String(), Type.Null()]), phoneNumber: Type.Union([Type.String(), Type.Null()]),
  callbackRequested: Type.Literal(true), callbackConfirmed: Type.Boolean(),
  notificationStatus: PhoneCallbackNotificationStatusSchema,
  notificationMeaning: Type.String(), missingFields: Type.Array(Type.String()), occurredAt: Type.String(),
}, { additionalProperties: false });
export type PhoneCallbackReport = Static<typeof PhoneCallbackReportSchema>;
export const PhoneCallbackNotificationGrantInputSchema = Type.Object({
  enabled: Type.Literal(true),
  sender: Type.Literal('notifications@brandmintai.io'),
  recipient: Type.Literal('connect@brandmintai.io'),
  expiresAt: Type.String({ maxLength: 40 }),
}, { additionalProperties: false });
export const PhoneCallbackGrantPrepareSchema = Type.Object({ expiresAt: Type.String({ maxLength: 40 }) }, { additionalProperties: false });
export const PhoneCallbackGrantActivateSchema = Type.Object({ approvalId: Type.String({ format: 'uuid' }) }, { additionalProperties: false });
export const PhoneCallbackGrantPreparedSchema = Type.Object({
  approvalId: Type.String({ format: 'uuid' }), status: Type.Literal('awaiting_approval'), parameters: PhoneCallbackNotificationGrantInputSchema,
}, { additionalProperties: false });
export const PhoneCallbackGrantActivatedSchema = Type.Object({ enabled: Type.Literal(true), approvalId: Type.String({ format: 'uuid' }) }, { additionalProperties: false });
export const PhoneCallbackGrantRevokedSchema = Type.Object({ enabled: Type.Literal(false) }, { additionalProperties: false });
export const PhoneCallbackReportListSchema = Type.Object({
  status: Type.Union([Type.Literal('ready'), Type.Literal('not_configured')]), reports: Type.Array(PhoneCallbackReportSchema),
}, { additionalProperties: false });
