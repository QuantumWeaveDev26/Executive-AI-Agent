import { TypeCompiler } from '@sinclair/typebox/compiler';
import { MetaWhatsAppStoredMediaSchema, type MetaWhatsAppStoredMedia } from '@thaara/contracts';
import { ForbiddenError } from '@thaara/observability';
import { sanitizeWhatsAppText } from './whatsapp.js';

const Media = TypeCompiler.Compile(MetaWhatsAppStoredMediaSchema);
const deny = () => new ForbiddenError('WhatsApp media metadata denied.');
/** Selected metadata only. Never follows URLs or reads/downloads/inspects file bytes. */
export function normalizeWhatsAppIncomingContent(message: { type: string; [key: string]: any }): { textPreview: string; media?: MetaWhatsAppStoredMedia } {
  if (message.type === 'text') return { textPreview: sanitizeWhatsAppText(message.text.body) };
  const kind = message.type;
  if (!['image', 'document', 'audio'].includes(kind)) throw deny();
  const input = message[kind];
  const mime = typeof input?.mime_type === 'string' ? input.mime_type : '';
  if ((kind === 'image' && !mime.startsWith('image/')) || (kind === 'audio' && !mime.startsWith('audio/')) || (kind === 'document' && !/^(application|text)\//.test(mime))) throw deny();
  const name = kind === 'document' && typeof input?.filename === 'string' ? sanitizeWhatsAppText(input.filename).replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(0, 160) : '';
  const media = { kind, mediaId: input?.id, mimeType: mime, sha256: input?.sha256, ...(name ? { filename: name } : {}), downloadStatus: 'not_downloaded' };
  if (!Media.Check(media)) throw deny();
  const caption = kind !== 'audio' && typeof input?.caption === 'string' ? sanitizeWhatsAppText(input.caption).trim() : '';
  const label = { image: 'Image', document: 'Document', audio: 'Audio' }[kind as 'image' | 'document' | 'audio'];
  return { textPreview: (`[${label} attachment — not downloaded]` + (caption ? ' ' + caption : '')).slice(0, 4096), media };
}
