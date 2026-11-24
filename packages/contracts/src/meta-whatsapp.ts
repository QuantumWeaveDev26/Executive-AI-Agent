import { Static, Type, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const AssetId = Type.String({ pattern: '^[0-9]{6,24}$' });
const LocalId = Type.String({ pattern: '^[a-zA-Z0-9_-]{1,128}$' });
export const MetaProviderMessageIdSchema = Type.String({ pattern: '^wamid\\.[a-zA-Z0-9._=+/-]{1,250}$' });
export const MetaWhatsAppRecipientAppointmentSchema = Type.Object({
  status: Type.Union([Type.Literal('REQUESTED'), Type.Literal('CONFIRMED'), Type.Literal('CANCELLED')]),
  date: Type.Optional(Type.String({ maxLength: 30 })),
  time: Type.Optional(Type.String({ maxLength: 30 })),
  startAt: Type.Optional(Type.String({ maxLength: 40 })),
  endAt: Type.Optional(Type.String({ maxLength: 40 })),
  timeZone: Type.Optional(Type.String({ maxLength: 60 })),
  calendarEventId: Type.Optional(Type.String({ maxLength: 128 })),
  confirmedAt: Type.Optional(Type.String({ maxLength: 40 })),
  service: Type.Optional(Type.String({ maxLength: 120 })),
  business: Type.Optional(Type.String({ maxLength: 120 })),
  customerName: Type.Optional(Type.String({ maxLength: 80 }))
}, { additionalProperties: false });
export type MetaWhatsAppRecipientAppointment = Static<typeof MetaWhatsAppRecipientAppointmentSchema>;

export const MetaWhatsAppTestConfigSchema = Type.Object({
  mode: Type.Literal('offline_test'),
  connectionId: LocalId,
  revision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  workspaceId: Type.String({ pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' }),
  userId: Type.String({ pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' }),
  businessAccountId: AssetId,
  phoneNumberId: AssetId,
  graphVersion: Type.String({ pattern: '^v[2-9][0-9]\\.0$' }),
  recipients: Type.Array(Type.Object({ id: LocalId, phoneE164: Type.String({ pattern: '^\\+[1-9][0-9]{7,14}$' }), optedIn: Type.Boolean(), displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })), appointment: Type.Optional(MetaWhatsAppRecipientAppointmentSchema) }, { additionalProperties: false }), { minItems: 1, maxItems: 50 })
}, { additionalProperties: false });
export type MetaWhatsAppTestConfig = Static<typeof MetaWhatsAppTestConfigSchema>;

export const MetaWhatsAppSendInputSchema = Type.Object({
  connectionId: LocalId,
  connectionRevision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  senderPhoneNumberId: AssetId,
  recipientId: LocalId,
  bodyText: Type.String({ minLength: 1, maxLength: 4096 }),
  replyToProviderMessageId: Type.Optional(MetaProviderMessageIdSchema),
  idempotencyKey: Type.String({ pattern: '^[a-zA-Z0-9_-]{8,128}$' })
}, { additionalProperties: false });
export type MetaWhatsAppSendInput = Static<typeof MetaWhatsAppSendInputSchema>;
// Step 108.25: template and media drafts (DB shape enforced by migration 10825). Exactly one content kind per draft.
const DraftBase = { connectionId: LocalId, connectionRevision: MetaWhatsAppSendInputSchema.properties.connectionRevision, senderPhoneNumberId: AssetId, recipientId: LocalId, idempotencyKey: MetaWhatsAppSendInputSchema.properties.idempotencyKey };
const TemplateParam = Type.String({ minLength: 1, maxLength: 1024 });
/** Meta Cloud API rejects template text parameters with newlines, tabs, control characters, or >4 consecutive spaces (error 132018). */
export function isValidWhatsAppTemplateParam(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 1024
    && !/[\r\n\t\u0000-\u001f\u007f]/.test(value) && !/ {5,}/.test(value);
}
export const MetaWhatsAppTemplateDraftSchema = Type.Object({ name: Type.String({ pattern: '^[a-z0-9_]{1,512}$' }), language: Type.String({ pattern: '^[a-z]{2,3}(?:_[A-Z]{2})?$' }),
  bodyParams: Type.Optional(Type.Array(TemplateParam, { maxItems: 20 })), headerParams: Type.Optional(Type.Array(TemplateParam, { maxItems: 1 })) }, { additionalProperties: false });
export const MetaWhatsAppMediaDraftSchema = Type.Object({ kind: Type.Union([Type.Literal('image'), Type.Literal('document'), Type.Literal('audio')]), mediaId: Type.String({ pattern: '^[0-9]{1,64}$' }),
  mimeType: Type.String({ pattern: '^[a-z0-9.+-]{1,64}/[a-z0-9.+-]{1,127}$' }), sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  caption: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })), filename: Type.Optional(Type.String({ minLength: 1, maxLength: 160, pattern: '^[^/\\\\\\u0000-\\u001f\\u007f]+$' })) }, { additionalProperties: false });
export const MetaWhatsAppTemplateSendInputSchema = Type.Object({ ...DraftBase, template: MetaWhatsAppTemplateDraftSchema }, { additionalProperties: false });
export const MetaWhatsAppMediaSendInputSchema = Type.Object({ ...DraftBase, media: MetaWhatsAppMediaDraftSchema, replyToProviderMessageId: Type.Optional(MetaProviderMessageIdSchema) }, { additionalProperties: false });
export const MetaWhatsAppAnySendInputSchema = Type.Union([MetaWhatsAppSendInputSchema, MetaWhatsAppTemplateSendInputSchema, MetaWhatsAppMediaSendInputSchema]);
export type MetaWhatsAppAnySendInput = Static<typeof MetaWhatsAppAnySendInputSchema>;
/** Shape check plus rules a schema cannot express: captions never on audio, filenames only on documents, valid template params. */
export function isMetaWhatsAppAnySendInput(value: unknown): value is MetaWhatsAppAnySendInput {
  if (!Value.Check(MetaWhatsAppAnySendInputSchema, value)) return false;
  const kinds = ['bodyText', 'template', 'media'].filter(k => Object.hasOwn(value as object, k));
  if (kinds.length !== 1) return false;
  const template = (value as { template?: { bodyParams?: string[]; headerParams?: string[] } }).template;
  if (template && ([...(template.headerParams ?? []), ...(template.bodyParams ?? [])].some(p => !isValidWhatsAppTemplateParam(p)))) return false;
  const media = (value as { media?: { kind: string; caption?: string; filename?: string } }).media;
  return !media || ((media.caption === undefined || media.kind !== 'audio') && (media.filename === undefined || media.kind === 'document'));
}
/** Human-readable stored preview of any draft (text as-is; template and media labelled, never fetched). */
export function whatsappDraftPreview(draft: MetaWhatsAppAnySendInput): string {
  if ('bodyText' in draft) return draft.bodyText;
  if ('template' in draft) return `[Template: ${draft.template.name} (${draft.template.language})]` + (draft.template.headerParams?.length ? ' Header: ' + draft.template.headerParams.join(' · ') : '') + (draft.template.bodyParams?.length ? ' ' + draft.template.bodyParams.join(' · ') : '');
  const label = { image: 'Image', document: 'Document', audio: 'Audio' }[draft.media.kind];
  return `[${label}${draft.media.filename ? ': ' + draft.media.filename : ''}]` + (draft.media.caption ? ' ' + draft.media.caption : '');
}

export const MetaWhatsAppReceiptSchema = Type.Object({
  mode: Type.Literal('offline_test'),
  status: Type.Union([Type.Literal('not_configured'), Type.Literal('unverified'), Type.Literal('sent'), Type.Literal('delivered'), Type.Literal('read'), Type.Literal('failed')]),
  providerMessageId: Type.Union([MetaProviderMessageIdSchema, Type.Null()]),
  verified: Type.Literal(false),
  reason: Type.Optional(Type.Literal('sending_disabled'))
}, { additionalProperties: false });
export type MetaWhatsAppReceipt = Static<typeof MetaWhatsAppReceiptSchema>;

const Timestamp = Type.String({ pattern: '^[0-9]{1,12}$' });
const Address = Type.String({ pattern: '^[1-9][0-9]{7,14}$' });
const Message = Type.Object({ id: MetaProviderMessageIdSchema, from: Address, timestamp: Timestamp, type: Type.Literal('text'), text: Type.Object({ body: Type.String({ maxLength: 4096 }) }) });
export const MetaWhatsAppStoredMediaSchema = Type.Object({
  kind: Type.Union([Type.Literal('image'), Type.Literal('document'), Type.Literal('audio')]),
  mediaId: Type.String({ pattern: '^[0-9]{1,64}$' }),
  mimeType: Type.String({ minLength: 3, maxLength: 192, pattern: '^[a-z0-9.+-]+/[a-z0-9.+-]+(?:;[ a-zA-Z0-9=.+-]+)?$' }),
  sha256: Type.String({ pattern: '^(?:[a-fA-F0-9]{64}|[A-Za-z0-9+/]{43}=)$' }),
  filename: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  downloadStatus: Type.Literal('not_downloaded')
}, { additionalProperties: false });
export type MetaWhatsAppStoredMedia = Static<typeof MetaWhatsAppStoredMediaSchema>;
export function isMetaWhatsAppStoredMedia(value: unknown): value is MetaWhatsAppStoredMedia {
  if (!Value.Check(MetaWhatsAppStoredMediaSchema, value)) return false;
  const mimeMatches = value.kind === 'image' ? value.mimeType.startsWith('image/') : value.kind === 'audio' ? value.mimeType.startsWith('audio/') : /^(application|text)\//.test(value.mimeType);
  return mimeMatches && (value.filename === undefined || (value.kind === 'document' && !/[\u0000-\u001f\u007f/\\]/.test(value.filename)));
}
const providerMedia = Type.Object({ id: MetaWhatsAppStoredMediaSchema.properties.mediaId, mime_type: MetaWhatsAppStoredMediaSchema.properties.mimeType, sha256: MetaWhatsAppStoredMediaSchema.properties.sha256, caption: Type.Optional(Type.String({ maxLength: 4096 })), filename: Type.Optional(Type.String({ maxLength: 512 })) });
const messageBase = { id: MetaProviderMessageIdSchema, from: Address, timestamp: Timestamp };
const DurableMessage = Type.Union([Message,
  Type.Object({ ...messageBase, type: Type.Literal('image'), image: providerMedia }),
  Type.Object({ ...messageBase, type: Type.Literal('document'), document: providerMedia }),
  Type.Object({ ...messageBase, type: Type.Literal('audio'), audio: providerMedia })
]);
const Status = Type.Object({ id: MetaProviderMessageIdSchema, recipient_id: Address, timestamp: Timestamp, status: Type.Union([Type.Literal('sent'), Type.Literal('delivered'), Type.Literal('read'), Type.Literal('failed')]) });
// Provider envelopes may add fields; only the explicitly selected fields are retained.
const webhook = <T extends TSchema>(message: T) => Type.Object({
  object: Type.Literal('whatsapp_business_account'),
  entry: Type.Array(Type.Object({ id: AssetId, changes: Type.Array(Type.Object({
    field: Type.Literal('messages'), value: Type.Object({ messaging_product: Type.Literal('whatsapp'), metadata: Type.Object({ phone_number_id: AssetId }), contacts: Type.Optional(Type.Array(Type.Object({ profile: Type.Optional(Type.Object({ name: Type.Optional(Type.String({ maxLength: 256 })) })), wa_id: Address }), { maxItems: 50 })), messages: Type.Optional(Type.Array(message, { minItems: 1, maxItems: 50 })), statuses: Type.Optional(Type.Array(Status, { minItems: 1, maxItems: 50 })) })
  }), { minItems: 1, maxItems: 50 }) }), { minItems: 1, maxItems: 10 })
});
export const MetaWhatsAppWebhookSchema = webhook(Message);
export const MetaWhatsAppDurableWebhookSchema = webhook(DurableMessage);
export type MetaWhatsAppWebhook = Static<typeof MetaWhatsAppWebhookSchema>;
