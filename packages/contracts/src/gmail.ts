
import { Type,Static } from '@sinclair/typebox';
export const GmailEmptySchema=Type.Object({}, {additionalProperties:false});
export const GmailMessageIdSchema=Type.String({pattern:'^[a-zA-Z0-9_-]{1,256}$'});
export const GmailSearchSchema=Type.Object({
 query:Type.String({minLength:1,maxLength:1000}),
 limit:Type.Optional(Type.Integer({minimum:1,maximum:50})),
 pageToken:Type.Optional(Type.String({minLength:1,maxLength:2048}))
},{additionalProperties:false});
export type GmailSearch=Static<typeof GmailSearchSchema>;
export const GmailCallbackSchema=Type.Object({
 state:Type.String({minLength:32,maxLength:128}),
 code:Type.Optional(Type.String({minLength:1,maxLength:4096})),
 error:Type.Optional(Type.String({minLength:1,maxLength:256})),
 scope:Type.Optional(Type.String({maxLength:4096})),authuser:Type.Optional(Type.String({maxLength:32})),
 prompt:Type.Optional(Type.String({maxLength:64})),iss:Type.Optional(Type.String({maxLength:256}))
},{additionalProperties:false});
export type GmailCallback=Static<typeof GmailCallbackSchema>;
export const GmailStatusSchema=Type.Object({
 connectorName:Type.Literal('gmail'),
 status:Type.Union([Type.Literal('not_configured'),Type.Literal('disconnected'),Type.Literal('connected'),Type.Literal('reconnect_required')]),
 configured:Type.Boolean(),connected:Type.Boolean(),mode:Type.Union([Type.Literal('disabled'),Type.Literal('mock'),Type.Literal('live')]),
 scopes:Type.Array(Type.String()),lastVerifiedAt:Type.Union([Type.String(),Type.Null()]),
 connectedEmail:Type.Optional(Type.Union([Type.String({minLength:3,maxLength:320}),Type.Null()]))
},{additionalProperties:false});
export type GmailStatus=Static<typeof GmailStatusSchema>;
export const GmailStartSchema=Type.Object({authorizationUrl:Type.String(),expiresAt:Type.String(),mode:Type.Union([Type.Literal('mock'),Type.Literal('live')])},{additionalProperties:false});
export const GmailMessageSchema=Type.Object({
 id:GmailMessageIdSchema,threadId:Type.Optional(GmailMessageIdSchema),
 subject:Type.Optional(Type.String({maxLength:4096})),from:Type.Optional(Type.String({maxLength:4096})),
 to:Type.Optional(Type.String({maxLength:4096})),cc:Type.Optional(Type.String({maxLength:4096})),
 replyTo:Type.Optional(Type.String({maxLength:4096})),
 messageIdHeader:Type.Optional(Type.String({maxLength:4096})),referencesHeader:Type.Optional(Type.String({maxLength:8192})),
 date:Type.Optional(Type.String({maxLength:256})),
 snippet:Type.Optional(Type.String({maxLength:4096})),bodyText:Type.Optional(Type.String({maxLength:100000})),
 isUnread:Type.Optional(Type.Boolean()),
 untrusted:Type.Literal(true),mode:Type.Union([Type.Literal('mock'),Type.Literal('live')])
},{additionalProperties:false});
export type GmailMessage=Static<typeof GmailMessageSchema>;
export const GmailSearchResponseSchema=Type.Object({
 messages:Type.Array(Type.Object({id:GmailMessageIdSchema,threadId:Type.Optional(GmailMessageIdSchema)},{additionalProperties:false}),{maxItems:50}),
 nextPageToken:Type.Optional(Type.String({minLength:1,maxLength:2048})),untrusted:Type.Literal(true),mode:Type.Union([Type.Literal('mock'),Type.Literal('live')])
},{additionalProperties:false});
export type GmailSearchResponse=Static<typeof GmailSearchResponseSchema>;
export const GmailSendReplyInputSchema=Type.Object({
 sourceMessageId:GmailMessageIdSchema,
 threadId:GmailMessageIdSchema,
 connectedEmail:Type.String({minLength:3,maxLength:320,pattern:'^[^\\s@\\r\\n<>]+@[^\\s@\\r\\n<>]+\\.[^\\s@\\r\\n<>]+$'}),
 to:Type.String({minLength:3,maxLength:320,pattern:'^[^\\s@\\r\\n<>]+@[^\\s@\\r\\n<>]+\\.[^\\s@\\r\\n<>]+$'}),
 cc:Type.Optional(Type.String({minLength:3,maxLength:2000})),
 subject:Type.String({minLength:1,maxLength:998}),
 inReplyTo:Type.Optional(Type.String({minLength:1,maxLength:998})),
 references:Type.Optional(Type.String({minLength:1,maxLength:4096})),
 bodyText:Type.String({minLength:1,maxLength:50000})
},{additionalProperties:false});
export type GmailSendReplyInput=Static<typeof GmailSendReplyInputSchema>;
export const GmailSendReplyReceiptSchema=Type.Object({
 connectorName:Type.Literal('gmail'),
 mode:Type.Union([Type.Literal('mock'),Type.Literal('live')]),
 status:Type.Union([Type.Literal('accepted_by_gmail'),Type.Literal('failed'),Type.Literal('unverified')]),
 providerMessageId:Type.Optional(Type.String({minLength:1,maxLength:256})),
 providerThreadId:Type.Optional(Type.String({minLength:1,maxLength:256})),
 sourceMessageId:GmailMessageIdSchema,
 to:Type.String({minLength:3,maxLength:320}),
 cc:Type.Optional(Type.String({minLength:3,maxLength:2000})),
 subject:Type.String({minLength:1,maxLength:998}),
 connectedEmail:Type.String({minLength:3,maxLength:320}),
 acceptedAt:Type.String(),
 note:Type.String()
},{additionalProperties:false});
export type GmailSendReplyReceipt=Static<typeof GmailSendReplyReceiptSchema>;
// Step 106: brand-new standalone email (no existing thread). Subject is optional because Gmail accepts
// messages without a Subject header. The connected sender account is bound into the approved payload.
const GmailAddressSchema=Type.String({minLength:3,maxLength:320,pattern:'^[^\\s@\\r\\n<>]+@[^\\s@\\r\\n<>]+\\.[^\\s@\\r\\n<>]+$'});
export const GmailSendNewInputSchema=Type.Object({
 connectedEmail:GmailAddressSchema,
 to:GmailAddressSchema,
 subject:Type.Optional(Type.String({minLength:1,maxLength:998})),
 bodyText:Type.String({minLength:1,maxLength:50000})
},{additionalProperties:false});
export type GmailSendNewInput=Static<typeof GmailSendNewInputSchema>;
export const GmailSendNewReceiptSchema=Type.Object({
 connectorName:Type.Literal('gmail'),
 mode:Type.Union([Type.Literal('mock'),Type.Literal('live')]),
 status:Type.Literal('accepted_by_gmail'),
 providerMessageId:Type.String({minLength:1,maxLength:256}),
 providerThreadId:Type.Optional(Type.String({minLength:1,maxLength:256})),
 to:Type.String({minLength:3,maxLength:320}),
 subject:Type.Optional(Type.String({minLength:1,maxLength:998})),
 connectedEmail:Type.String({minLength:3,maxLength:320}),
 acceptedAt:Type.String(),
 note:Type.String()
},{additionalProperties:false});
export type GmailSendNewReceipt=Static<typeof GmailSendNewReceiptSchema>;
// Request body for preparing a new email from the Gmail composer. The server binds the sender account.
export const GmailPrepareNewEmailSchema=Type.Object({
 to:Type.String({minLength:3,maxLength:320}),
 subject:Type.Optional(Type.String({maxLength:998})),
 bodyText:Type.String({minLength:1,maxLength:50000})
},{additionalProperties:false});
export type GmailPrepareNewEmail=Static<typeof GmailPrepareNewEmailSchema>;
export const GmailPrepareReplyEmailSchema=Type.Object({
 sourceMessageId:GmailMessageIdSchema,
 to:Type.Optional(Type.String({minLength:3,maxLength:320})),
 cc:Type.Optional(Type.String({maxLength:2000})),
 subject:Type.Optional(Type.String({maxLength:998})),
 bodyText:Type.String({minLength:1,maxLength:50000}),
 replyAll:Type.Optional(Type.Boolean())
},{additionalProperties:false});
export type GmailPrepareReplyEmail=Static<typeof GmailPrepareReplyEmailSchema>;
export const GmailPreparedSendSchema=Type.Object({
 planId:Type.String({format:'uuid'}),
 approvalId:Type.String({format:'uuid'}),
 status:Type.Literal('awaiting_approval'),
 from:Type.String({minLength:3,maxLength:320}),
 to:Type.String({minLength:3,maxLength:320}),
 cc:Type.Optional(Type.String({minLength:3,maxLength:2000})),
 subject:Type.Optional(Type.String({minLength:1,maxLength:998})),
 bodyText:Type.String({minLength:1,maxLength:50000}),
 threadId:Type.Optional(GmailMessageIdSchema),
 sourceMessageId:Type.Optional(GmailMessageIdSchema),
 expiresAt:Type.String()
},{additionalProperties:false});
export type GmailPreparedSend=Static<typeof GmailPreparedSendSchema>;
