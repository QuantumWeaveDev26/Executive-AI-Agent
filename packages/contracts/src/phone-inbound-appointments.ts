import {Type,type Static} from '@sinclair/typebox';
export const PhoneAppointmentSlotSchema=Type.Object({
 startAt:Type.String({minLength:20,maxLength:40}),endAt:Type.String({minLength:20,maxLength:40}),timeZone:Type.String({minLength:1,maxLength:64})
},{additionalProperties:false});
export const PhoneAppointmentRequestSchema=Type.Object({payload:Type.Record(Type.String(),Type.Unknown()),slot:PhoneAppointmentSlotSchema},{additionalProperties:false});
export type PhoneAppointmentSlot=Static<typeof PhoneAppointmentSlotSchema>;
export type PhoneAppointmentRequest=Static<typeof PhoneAppointmentRequestSchema>;
/** Owner-side proposal for an existing outbound call; no caller-supplied identity or approval. */
export const PhoneOutboundAppointmentRequestSchema=Type.Object({slot:PhoneAppointmentSlotSchema},{additionalProperties:false});
export type PhoneOutboundAppointmentRequest=Static<typeof PhoneOutboundAppointmentRequestSchema>;
const savedRequest={saved:Type.Literal(true),requestId:Type.String({pattern:'^[a-f0-9]{64}$'})};
export const PhoneAppointmentResponseSchema=Type.Union([
 Type.Object({...savedRequest,status:Type.Union(['request_saved','approval_pending','slot_unavailable','needs_review'].map(v=>Type.Literal(v))),appointmentConfirmed:Type.Literal(false)},{additionalProperties:false}),
 Type.Object({...savedRequest,status:Type.Literal('appointment_confirmed'),appointmentConfirmed:Type.Literal(true),eventId:Type.String({minLength:1,maxLength:256}),...PhoneAppointmentSlotSchema.properties},{additionalProperties:false})
]);
const calendarApproval=Type.Optional(Type.Object({planId:Type.String({pattern:'^[a-fA-F0-9-]{36}$'}),approvalId:Type.String({pattern:'^[a-fA-F0-9-]{36}$'})},{additionalProperties:false}));
export const PhoneAppointmentOwnerReviewSnapshotSchema=Type.Union([
 Type.Object({status:Type.Literal('not_prepared'),slot:Type.Null(),calendarApproval:Type.Null()},{additionalProperties:false}),
 Type.Object({status:Type.Literal('ready'),slot:PhoneAppointmentSlotSchema,calendarApproval:Type.Object({planId:Type.String({pattern:'^[a-fA-F0-9-]{36}$'}),approvalId:Type.String({pattern:'^[a-fA-F0-9-]{36}$'})},{additionalProperties:false})},{additionalProperties:false})
]);
/** Owner UI may receive existing approval handles; the provider-facing response stays unchanged. */
export const PhoneAppointmentOwnerResponseSchema=Type.Union([
 Type.Object({...savedRequest,calendarApproval,status:Type.Union(['request_saved','approval_pending','slot_unavailable','needs_review'].map(v=>Type.Literal(v))),appointmentConfirmed:Type.Literal(false)},{additionalProperties:false}),
 Type.Object({...savedRequest,calendarApproval,status:Type.Literal('appointment_confirmed'),appointmentConfirmed:Type.Literal(true),eventId:Type.String({minLength:1,maxLength:256}),...PhoneAppointmentSlotSchema.properties},{additionalProperties:false})
]);
export const PhoneOutboundAppointmentResponseSchema=Type.Union([
 PhoneAppointmentOwnerResponseSchema,
 Type.Object({saved:Type.Literal(false),appointmentConfirmed:Type.Literal(false),status:Type.Union(['request_not_saved','slot_unavailable','needs_review'].map(v=>Type.Literal(v)))},{additionalProperties:false})
]);
