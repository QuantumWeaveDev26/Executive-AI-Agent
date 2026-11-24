import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
export const WHATSAPP_MEDIA_UPLOAD_ACTION = 'whatsapp.meta.media.upload' as const;
const Id = Type.String({ pattern: '^[a-zA-Z0-9_-]{1,128}$' });
export const WhatsAppUploadDescriptionSchema = Type.Object({
  filename: Type.String({ minLength: 1, maxLength: 160, pattern: '^[^/\\\\\\u0000-\\u001f\\u007f]+$' }),
  mimeType: Type.String({ minLength: 3, maxLength: 192, pattern: '^[a-z0-9.+-]+/[a-z0-9.+-]+$' }),
  bytes: Type.Integer({ minimum: 1, maximum: 20 * 1024 * 1024 }), sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  idempotencyKey: Type.String({ pattern: '^[a-zA-Z0-9_-]{8,128}$' })
}, { additionalProperties: false });
export const WhatsAppUploadIntentSchema = Type.Object({ ...WhatsAppUploadDescriptionSchema.properties,
  connectionId: Id, connectionRevision: Type.Integer({ minimum: 1 }), senderPhoneNumberId: Type.String({ pattern: '^[0-9]{6,24}$' })
}, { additionalProperties: false });
export const WhatsAppUploadAuthorizationDraftSchema = Type.Object({ draft: WhatsAppUploadIntentSchema,
  actionName: Type.Literal(WHATSAPP_MEDIA_UPLOAD_ACTION), riskLevel: Type.Literal('high'), liveSendingEnabled: Type.Literal(false)
}, { additionalProperties: false });
export type WhatsAppUploadDescription = Static<typeof WhatsAppUploadDescriptionSchema>;
export type WhatsAppUploadIntent = Static<typeof WhatsAppUploadIntentSchema>;
export type WhatsAppUploadAuthorizationDraft = Static<typeof WhatsAppUploadAuthorizationDraftSchema>;
export const isWhatsAppUploadDescription = (input: unknown): input is WhatsAppUploadDescription => Value.Check(WhatsAppUploadDescriptionSchema, input);
export const isWhatsAppUploadIntent = (input: unknown): input is WhatsAppUploadIntent => Value.Check(WhatsAppUploadIntentSchema, input);
export const isWhatsAppUploadAuthorizationDraft = (input: unknown): input is WhatsAppUploadAuthorizationDraft => Value.Check(WhatsAppUploadAuthorizationDraftSchema, input);
