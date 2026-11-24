import {Type,type Static} from '@sinclair/typebox';
import {PhoneInboundOutcomeSchema} from './phone-inbound.js';
export const PhoneInboundCallbackReceiptSchema=Type.Object({saved:Type.Literal(true),reportId:Type.String({pattern:'^[a-f0-9]{64}$'}),
 action:Type.Union([Type.Literal('callback_requested'),Type.Literal('callback_withdrawn'),Type.Literal('needs_review')]),
 callbackRequestId:Type.Union([Type.String({maxLength:128}),Type.Null()]),outcome:PhoneInboundOutcomeSchema},{additionalProperties:false});
export const PhoneInboundCompletionReceiptSchema=Type.Object({saved:Type.Literal(true),reportId:Type.String({pattern:'^[a-f0-9]{64}$'}),outcome:PhoneInboundOutcomeSchema},{additionalProperties:false});
export type PhoneInboundCallbackReceipt=Static<typeof PhoneInboundCallbackReceiptSchema>;
export type PhoneInboundCompletionReceipt=Static<typeof PhoneInboundCompletionReceiptSchema>;
