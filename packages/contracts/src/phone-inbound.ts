import {Type,type Static} from '@sinclair/typebox';
const text=()=>Type.Union([Type.String({maxLength:2000}),Type.Null()]);
export const PhoneInboundOutcomeSchema=Type.Union([Type.Literal('enquired'),Type.Literal('callback_requested'),Type.Literal('booked_appointment'),Type.Literal('needs_review')]);
export const PhoneInboundAppointmentSchema=Type.Object({eventId:Type.String({minLength:1,maxLength:256}),startsAt:Type.String({format:'date-time'}),endsAt:Type.String({format:'date-time'}),timezone:Type.String({maxLength:64}),verification:Type.Literal('verified')},{additionalProperties:false});
export const PhoneInboundReportSchema=Type.Object({
 id:Type.String({minLength:1,maxLength:128,pattern:'^[A-Za-z0-9_-]+$'}),
 occurredAt:Type.String({format:'date-time'}),maskedPhone:Type.String({maxLength:32}),
 callerPhone:Type.Union([Type.String({pattern:'^\\+[1-9][0-9]{7,14}$'}),Type.Null()]),
 customerName:text(),business:text(),serviceNeeded:text(),enquirySummary:text(),
 outcome:PhoneInboundOutcomeSchema,callbackRequestId:Type.Union([Type.String({maxLength:128}),Type.Null()]),
 providerVerified:Type.Literal(false),
 providerInteractionId:Type.Optional(Type.String({minLength:1,maxLength:256})),
 timestampSource:Type.Optional(Type.Union([Type.Literal('provider_started'),Type.Literal('provider_ended'),Type.Literal('received_at')])),
 durationSeconds:Type.Optional(Type.Union([Type.Number({minimum:0,maximum:86400}),Type.Null()])),
 callStatus:Type.Optional(Type.Union([Type.Literal('ended'),Type.Literal('interrupted'),Type.Literal('failed'),Type.Literal('unknown')])),
 preferredContactTime:Type.Optional(text()),
 callbackConsent:Type.Optional(Type.Union([Type.Literal('confirmed'),Type.Literal('declined'),Type.Literal('unknown')])),
 callbackPreference:Type.Optional(Type.Union([Type.Literal('requested'),Type.Literal('declined'),Type.Literal('unknown')])),
 appointment:Type.Optional(Type.Union([PhoneInboundAppointmentSchema,Type.Null()])),
 transcript:Type.Optional(Type.Array(Type.Object({speaker:Type.Union([Type.Literal('agent'),Type.Literal('caller')]),text:Type.String({maxLength:2000}),languageBasis:Type.Union([Type.Literal('provider_original'),Type.Literal('provider_english')])},{additionalProperties:false}),{maxItems:64})),
 transcriptExpiresAt:Type.Optional(Type.String({format:'date-time'})),
 recordingReference:Type.Optional(Type.Union([Type.Object({interactionId:Type.String({maxLength:256}),expiresAt:Type.String({format:'date-time'}),noticeConfirmed:Type.Literal(true)},{additionalProperties:false}),Type.Null()])),
},{additionalProperties:false});
export type PhoneInboundReport=Static<typeof PhoneInboundReportSchema>;
export const PhoneInboundSummarySchema=Type.Object({...Type.Pick(PhoneInboundReportSchema,['id','occurredAt','maskedPhone','outcome','providerVerified']).properties,
 customerName:Type.Optional(text()),preferredContactTime:Type.Optional(text())},{additionalProperties:false});
export const PhoneInboundListSchema=Type.Object({status:Type.Union([Type.Literal('ready'),Type.Literal('not_configured')]),reports:Type.Array(PhoneInboundSummarySchema,{maxItems:100})},{additionalProperties:false});
export const PhoneInboundDetailSchema=Type.Object({status:Type.Union([Type.Literal('ready'),Type.Literal('not_configured'),Type.Literal('not_found')]),report:Type.Union([PhoneInboundReportSchema,Type.Null()])},{additionalProperties:false});
