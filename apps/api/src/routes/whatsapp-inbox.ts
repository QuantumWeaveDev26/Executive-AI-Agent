import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Static } from '@sinclair/typebox';
import type { ApprovalRequest, GoogleCalendarRescheduleEventInput, GoogleCalendarCancelEventInput } from '@thaara/contracts';
import { GOOGLE_CALENDAR_RESCHEDULE_EVENT_ACTION, GOOGLE_CALENDAR_CANCEL_EVENT_ACTION, getZonedHourMs, type GoogleCalendarFoundation } from '../services/google-calendar.js';
import type { TransactionalDbClient } from '@thaara/db';
import { extractWhatsAppCustomerEnquiry, formatAppointmentNaturalSlot, isRealCustomerName } from '../services/whatsapp-enquiries.js';
import { formatWhatsAppContactName } from '../services/whatsapp-inbox.js';
import { maskPhoneNumber } from '../services/whatsapp.js';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { N8nWhatsAppDispatchSchema, N8nWhatsAppReceiptSchema, N8nWhatsAppDurableStatusSchema, N8nWhatsAppDisconnectSchema, CalendlyBookingEvidenceSchema, type MetaWhatsAppSendInput } from '@thaara/contracts';
import { N8nWhatsAppConnectionsSchema, N8nWhatsAppInboxSchema, N8nWhatsAppInboxQuerySchema, N8nWhatsAppReplyDraftRequestSchema, N8nWhatsAppReplyDraftSchema, N8nWhatsAppContactsSchema, N8nWhatsAppTemplatesSchema, type N8nWhatsAppInboxQuery, type N8nWhatsAppReplyDraftRequest } from '@thaara/contracts';
import { AppError, ForbiddenError } from '@thaara/observability';
import type { DurableWhatsAppService } from '../services/whatsapp-durable.js';
import type { WhatsAppMediaPreviewService } from '../services/whatsapp-media-preview.js';
import type { WhatsAppTemplateService } from '../services/whatsapp-templates.js';
import type { WhatsAppMediaUploadService } from '../services/whatsapp-media-upload.js';
import { WhatsAppUploadDescriptionSchema, WhatsAppUploadAuthorizationDraftSchema, type WhatsAppUploadDescription } from '@thaara/contracts';
import { N8nWhatsAppPreparedDraftSchema, N8nWhatsAppTemplateDraftRequestSchema, N8nWhatsAppMediaDraftRequestSchema, N8nWhatsAppContactsUpdateSchema, N8nWhatsAppContactsUpdatedSchema, N8nWhatsAppMediaUploadSchema, type N8nWhatsAppTemplateDraftRequest } from '@thaara/contracts';
import { MetaProviderMessageIdSchema } from '@thaara/contracts';

export function resolveAppointmentDateTime(
  preferredText?: string,
  referenceTimestampMs = Date.now(),
  timeZone = 'Asia/Kolkata'
): { startAt: string; endAt: string; displaySlot: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(referenceTimestampMs));
  const num = (type: string) => Number.parseInt(parts.find(p => p.type === type)?.value ?? '0', 10);
  const year = num('year');
  const month = num('month');
  const day = num('day');
  const currentHour = num('hour');

  let dayOffset = 0;
  const lower = (preferredText || '').toLowerCase();
  if (/\b(?:tomorrow|nale|kal)\b/.test(lower)) {
    dayOffset = 1;
  } else if (/\b(?:today|indhu|aaj)\b/.test(lower)) {
    dayOffset = 0;
  }

  const timeMatch = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(lower);
  let hour = 11;
  let minute = 0;
  if (timeMatch && timeMatch[1]) {
    let rawHour = parseInt(timeMatch[1], 10);
    minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3];
    if (ampm === 'pm' && rawHour < 12) rawHour += 12;
    if (ampm === 'am' && rawHour === 12) rawHour = 0;
    if (!ampm) {
      if (rawHour >= 1 && rawHour <= 6) rawHour += 12;
      if (/\b(?:evening|night|sanje|shaam)\b/.test(lower) && rawHour < 12) rawHour += 12;
    }
    hour = rawHour;
  }

  if (dayOffset === 0 && !/\b(?:today|indhu|aaj)\b/.test(lower) && hour <= currentHour) {
    dayOffset = 1;
  }

  const d = new Date(Date.UTC(year, month - 1, day + dayOffset));
  const targetYear = d.getUTCFullYear();
  const targetMonth = d.getUTCMonth() + 1;
  const targetDay = d.getUTCDate();

  const startMs = getZonedHourMs(targetYear, targetMonth, targetDay, hour, minute, timeZone);
  const endMs = startMs + 30 * 60 * 1000;
  const startAt = new Date(startMs).toISOString();
  const endAt = new Date(endMs).toISOString();
  const displaySlot = preferredText || (dayOffset === 1 ? `Tomorrow at ${hour % 12 || 12}:${minute.toString().padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}` : `Today at ${hour % 12 || 12}:${minute.toString().padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`);
  return { startAt, endAt, displaySlot };
}

/** Owner-scoped durable controls and stored inbox. No provisioning, provider I/O or sends. */
export async function whatsappDurableInboxRoutes(
  app: FastifyInstance,
  service?: DurableWhatsAppService,
  media?: WhatsAppMediaPreviewService,
  templates?: WhatsAppTemplateService,
  uploads?: WhatsAppMediaUploadService,
  calendar?: GoogleCalendarFoundation,
  db?: TransactionalDbClient
) {
  const media0 = media;
  const controlPath = '/connectors/whatsapp/n8n/durable/:connectionId';
  const controlParams = Type.Object({ connectionId: Type.String({ pattern: '^[a-zA-Z0-9_-]{1,128}$' }) }, { additionalProperties: false });
  const control = async <T>(work: (configured: DurableWhatsAppService) => Promise<T>) => {
    try { if (!service) throw new Error(); return await work(service); }
    catch (error) {
      if (error instanceof ForbiddenError) throw new ForbiddenError('WhatsApp owner operation denied.');
      throw new AppError('WhatsApp durable storage is not configured or is unavailable.', 'WHATSAPP_DURABLE_UNAVAILABLE', 503);
    }
  };
  const emptyQuery = async (request: { query: unknown }) => { if (Object.keys(request.query as object).length) throw new AppError('Invalid owner query.', 'WHATSAPP_DURABLE_INVALID', 400); };
  const noStore = async (_request: unknown, reply: { header(name: string, value: string): unknown }) => { reply.header('Cache-Control', 'no-store'); };
  app.get<{ Params: { connectionId: string } }>(controlPath + '/status', {
    preHandler: [app.requireAuth], preValidation: emptyQuery, onSend: noStore,
    schema: { tags: ['WhatsAppN8n'], params: controlParams, response: { 200: N8nWhatsAppDurableStatusSchema } }
  }, request => control(configured => configured.status(request.scope!, request.params.connectionId)));
  app.post<{ Params: { connectionId: string }; Body: { draft: MetaWhatsAppSendInput; approvalId: string } }>(controlPath + '/dispatches', {
    bodyLimit: 16384, preHandler: [app.requireAuth], onSend: noStore,
    preValidation: async request => { await emptyQuery(request); if (!Value.Check(N8nWhatsAppDispatchSchema, request.body)) throw new AppError('Invalid dispatch.', 'WHATSAPP_DURABLE_INVALID', 400); },
    schema: { tags: ['WhatsAppN8n'], params: controlParams, body: N8nWhatsAppDispatchSchema, response: { 200: N8nWhatsAppReceiptSchema } }
  }, request => control(configured => {
    if (request.body.draft.connectionId !== request.params.connectionId) throw new ForbiddenError('WhatsApp owner operation denied.');
    return configured.reserve(request.scope!, request.params.connectionId, request.body.draft, request.body.approvalId);
  }));
  app.post<{ Params: { connectionId: string }; Body: N8nWhatsAppReplyDraftRequest }>(controlPath + '/reply-drafts', {
    bodyLimit: 16384, preHandler: [app.requireAuth], onSend: noStore,
    preValidation: async request => { await emptyQuery(request); if (!Value.Check(N8nWhatsAppReplyDraftRequestSchema, request.body)) throw new AppError('Invalid WhatsApp reply.', 'WHATSAPP_DURABLE_INVALID', 400); },
    schema: { tags: ['WhatsAppN8n'], params: controlParams, body: N8nWhatsAppReplyDraftRequestSchema, response: { 200: N8nWhatsAppReplyDraftSchema } }
  }, request => control(configured => configured.replyDraft(request.scope!, request.params.connectionId, request.body)));
  app.delete<{ Params: { connectionId: string } }>(controlPath + '/connection', {
    preHandler: [app.requireAuth], onSend: noStore,
    preValidation: async request => { await emptyQuery(request); if (request.body !== undefined) throw new AppError('Disconnect takes no body.', 'WHATSAPP_DURABLE_INVALID', 400); },
    schema: { tags: ['WhatsAppN8n'], params: controlParams, response: { 200: N8nWhatsAppDisconnectSchema } }
  }, request => control(configured => configured.disconnect(request.scope!, request.params.connectionId)));
  app.get<{ Params: { connectionId: string } }>(controlPath + '/contacts', {
    preHandler: [app.requireAuth], preValidation: emptyQuery, onSend: noStore,
    schema: { tags: ['WhatsAppN8n'], params: controlParams, response: { 200: N8nWhatsAppContactsSchema } }
  }, request => control(configured => configured.contacts(request.scope!, request.params.connectionId)));
  app.get<{ Params: { connectionId: string } }>(controlPath + '/templates', {
    preHandler: [app.requireAuth], preValidation: emptyQuery, onSend: noStore,
    schema: { tags: ['WhatsAppN8n'], params: controlParams, response: { 200: N8nWhatsAppTemplatesSchema } }
  }, async request => {
    try { if (!templates) throw new AppError('WhatsApp templates are not set up.', 'WHATSAPP_TEMPLATES_NOT_CONFIGURED', 503); return await templates.list(request.scope!, request.params.connectionId); }
    catch (error) {
      if (error instanceof ForbiddenError) throw new ForbiddenError('WhatsApp templates denied.');
      if (error instanceof AppError && ['WHATSAPP_TEMPLATES_NOT_CONFIGURED', 'WHATSAPP_TEMPLATES_UNAVAILABLE'].includes(error.code)) throw error;
      throw new AppError('WhatsApp templates could not be loaded.', 'WHATSAPP_TEMPLATES_UNAVAILABLE', 502);
    }
  });
  // Step 108.26: owner contact management, template/media drafts and verified uploads. All still need per-message approval to send.
  const owned = async <T>(work: () => Promise<T>, passthrough: string[]) => {
    try { return await work(); }
    catch (error) {
      if (error instanceof ForbiddenError) throw new ForbiddenError('WhatsApp owner operation denied.');
      if (error instanceof AppError && passthrough.includes(error.code)) throw error;
      throw new AppError('WhatsApp durable storage is not configured or is unavailable.', 'WHATSAPP_DURABLE_UNAVAILABLE', 503);
    }
  };
  app.put<{ Params: { connectionId: string }; Body: { contacts: unknown } }>(controlPath + '/contacts', {
    bodyLimit: 8192, preHandler: [app.requireAuth], onSend: noStore, preValidation: emptyQuery,
    schema: { tags: ['WhatsAppN8n'], params: controlParams, body: N8nWhatsAppContactsUpdateSchema, response: { 200: N8nWhatsAppContactsUpdatedSchema } }
  }, request => owned(() => { if (!service) throw new Error(); return service.updateContacts(request.scope!, request.params.connectionId, request.body.contacts); }, ['WHATSAPP_DURABLE_INVALID']));
  app.post<{ Params: { connectionId: string }; Body: N8nWhatsAppTemplateDraftRequest }>(controlPath + '/template-drafts', {
    bodyLimit: 32768, preHandler: [app.requireAuth], onSend: noStore, preValidation: emptyQuery,
    schema: { tags: ['WhatsAppN8n'], params: controlParams, body: N8nWhatsAppTemplateDraftRequestSchema, response: { 200: N8nWhatsAppPreparedDraftSchema } }
  }, request => owned(() => { if (!templates) throw new AppError('WhatsApp templates are not set up.', 'WHATSAPP_TEMPLATES_NOT_CONFIGURED', 503); return templates.prepare(request.scope!, request.params.connectionId, request.body); },
    ['WHATSAPP_TEMPLATES_NOT_CONFIGURED', 'WHATSAPP_TEMPLATES_UNAVAILABLE', 'WHATSAPP_TEMPLATE_INVALID', 'WHATSAPP_DURABLE_INVALID']));
  app.post<{ Params: { connectionId: string }; Body: { recipientId: string; media: any } }>(controlPath + '/media-drafts', {
    bodyLimit: 8192, preHandler: [app.requireAuth], onSend: noStore, preValidation: emptyQuery,
    schema: { tags: ['WhatsAppN8n'], params: controlParams, body: N8nWhatsAppMediaDraftRequestSchema, response: { 200: N8nWhatsAppPreparedDraftSchema } }
  }, request => owned(() => { if (!service) throw new Error(); return service.contentDraft(request.scope!, request.params.connectionId, request.body.recipientId, { media: request.body.media }); }, ['WHATSAPP_WINDOW_CLOSED', 'WHATSAPP_DURABLE_INVALID']));
  await app.register(async scoped => {
    scoped.post<{ Params: { connectionId: string }; Body: WhatsAppUploadDescription }>(controlPath + '/media-upload-drafts', {
      bodyLimit: 2048, preHandler: [app.requireAuth], onSend: noStore, preValidation: emptyQuery,
      schema: { tags: ['WhatsAppN8n'], params: controlParams, body: WhatsAppUploadDescriptionSchema, response: { 200: WhatsAppUploadAuthorizationDraftSchema } }
    }, request => owned(() => { if (!uploads) throw new AppError('File upload is not set up.', 'WHATSAPP_UPLOAD_NOT_CONFIGURED', 503); return uploads.prepare(request.scope!, request.params.connectionId, request.body); }, ['WHATSAPP_UPLOAD_NOT_CONFIGURED', 'WHATSAPP_UPLOAD_REJECTED']));
    // Raw bytes only on this route; type and name come from explicit headers and are verified server-side.
    scoped.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 20 * 1024 * 1024 }, (_request, body, done) => done(null, body));
    scoped.post<{ Params: { connectionId: string } }>(controlPath + '/media-uploads', {
      bodyLimit: 20 * 1024 * 1024, preHandler: [app.requireAuth], onSend: noStore, preValidation: emptyQuery, schema: { tags: ['WhatsAppN8n'], params: controlParams, response: { 200: N8nWhatsAppMediaUploadSchema } }
    }, request => owned(() => {
      if (!uploads) throw new AppError('WhatsApp file sending is not set up.', 'WHATSAPP_UPLOAD_NOT_CONFIGURED', 503);
      const type = String(request.headers['x-thaara-file-type'] ?? ''), rawName = String(request.headers['x-thaara-file-name'] ?? '');
      let filename: string | undefined;
      try { filename = rawName ? decodeURIComponent(rawName).slice(0, 200) : undefined; } catch { filename = undefined; }
      if (!Buffer.isBuffer(request.body) || !/^[a-z0-9.+-]{1,64}\/[a-z0-9.+-]{1,127}$/.test(type)) throw new AppError('This file type or size cannot be sent.', 'WHATSAPP_UPLOAD_REJECTED', 400);
      return uploads.upload(request.scope!, request.params.connectionId, { bytes: request.body, mimeType: type, ...(filename ? { filename } : {}) }, {
        approvalId: String(request.headers['x-thaara-upload-approval'] ?? ''), idempotencyKey: String(request.headers['x-thaara-idempotency-key'] ?? '')
      });
    }, ['WHATSAPP_UPLOAD_NOT_CONFIGURED', 'WHATSAPP_UPLOAD_REJECTED', 'WHATSAPP_UPLOAD_RATE_LIMITED', 'WHATSAPP_UPLOAD_FAILED', 'WHATSAPP_UPLOAD_REPLAY']));
  });
  // Step 108.22: POST (CSRF-protected) so a cross-site page cannot trigger provider downloads with an <img> tag.
  app.post<{ Params: { connectionId: string; messageId: string } }>(controlPath + '/media/:messageId/preview', {
    bodyLimit: 64, preHandler: [app.requireAuth],
    preValidation: async request => { await emptyQuery(request); if (request.body !== undefined && (typeof request.body !== 'object' || request.body === null || Object.keys(request.body).length)) throw new AppError('Preview takes no input.', 'WHATSAPP_MEDIA_INVALID', 400); },
    schema: { tags: ['WhatsAppN8n'], params: Type.Object({ connectionId: controlParams.properties.connectionId, messageId: MetaProviderMessageIdSchema }, { additionalProperties: false }) }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    let preview;
    try { if (!media) throw new AppError('WhatsApp image preview is not set up.', 'WHATSAPP_MEDIA_NOT_CONFIGURED', 503); preview = await media.preview(request.scope!, request.params.connectionId, request.params.messageId); }
    catch (error) {
      if (error instanceof ForbiddenError) throw new ForbiddenError('WhatsApp media preview denied.');
      if (error instanceof AppError && ['WHATSAPP_MEDIA_NOT_CONFIGURED', 'WHATSAPP_MEDIA_RATE_LIMITED', 'WHATSAPP_MEDIA_UNVERIFIED'].includes(error.code)) throw error;
      throw new AppError('The image could not be verified.', 'WHATSAPP_MEDIA_UNVERIFIED', 502);
    }
    // Verified raster bytes only, served inert: no sniffing, no scripts, no framing, not cacheable, not cross-origin.
    return reply.type(preview.contentType).headers({
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': 'inline; filename="whatsapp-image.' + (preview.contentType === 'image/png' ? 'png' : 'jpg') + '"',
      'Cross-Origin-Resource-Policy': 'same-origin', 'Referrer-Policy': 'no-referrer'
    }).send(preview.bytes);
  });
  // Step 108.25: audio playback and document download share the preview protections; documents are never rendered inline.
  app.post<{ Params: { connectionId: string; messageId: string } }>(controlPath + '/media/:messageId/content', {
    bodyLimit: 64, preHandler: [app.requireAuth],
    preValidation: async request => { await emptyQuery(request); if (request.body !== undefined && (typeof request.body !== 'object' || request.body === null || Object.keys(request.body).length)) throw new AppError('Attachment request takes no input.', 'WHATSAPP_MEDIA_INVALID', 400); },
    schema: { tags: ['WhatsAppN8n'], params: Type.Object({ connectionId: controlParams.properties.connectionId, messageId: MetaProviderMessageIdSchema }, { additionalProperties: false }) }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    let media;
    try { if (!media0) throw new AppError('WhatsApp media access is not set up.', 'WHATSAPP_MEDIA_NOT_CONFIGURED', 503); media = await media0.content(request.scope!, request.params.connectionId, request.params.messageId); }
    catch (error) {
      if (error instanceof ForbiddenError) throw new ForbiddenError('WhatsApp media access denied.');
      if (error instanceof AppError && ['WHATSAPP_MEDIA_NOT_CONFIGURED', 'WHATSAPP_MEDIA_RATE_LIMITED', 'WHATSAPP_MEDIA_UNVERIFIED'].includes(error.code)) throw error;
      throw new AppError('The attachment could not be verified.', 'WHATSAPP_MEDIA_UNVERIFIED', 502);
    }
    const ext: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf', 'text/plain': 'txt', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'audio/amr': 'amr', 'audio/mp4': 'm4a' };
    const fallback = 'whatsapp-' + media.kind + '.' + (ext[media.contentType] ?? 'bin');
    const disposition = media.kind === 'document'
      ? 'attachment; filename="' + fallback + '"' + (media.filename ? "; filename*=UTF-8''" + encodeURIComponent(media.filename.replace(/["\\]/g, '_')) : '')
      : 'inline; filename="' + fallback + '"';
    return reply.type(media.contentType).headers({
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': disposition,
      'Cross-Origin-Resource-Policy': 'same-origin', 'Referrer-Policy': 'no-referrer', 'X-WhatsApp-Media-Kind': media.kind
    }).send(media.bytes);
  });
  app.get('/connectors/whatsapp/n8n/durable/connections', {
    preHandler: [app.requireAuth],
    preValidation: async request => { if (Object.keys(request.query as object).length) throw new AppError('Invalid connection query.', 'WHATSAPP_INBOX_INVALID', 400); },
    schema: { tags: ['WhatsAppN8n'], response: { 200: N8nWhatsAppConnectionsSchema } },
    onSend: async (_request, reply) => { reply.header('Cache-Control', 'no-store'); }
  }, async request => {
    try { if (!service) throw new Error(); return await service.connections(request.scope!); }
    catch (error) {
      if (error instanceof ForbiddenError) throw new ForbiddenError('WhatsApp inbox access denied.');
      throw new AppError('WhatsApp inbox storage is not configured or is unavailable.', 'WHATSAPP_INBOX_UNAVAILABLE', 503);
    }
  });
  app.get<{ Params: { connectionId: string }; Querystring: N8nWhatsAppInboxQuery }>('/connectors/whatsapp/n8n/durable/:connectionId/inbox', {
    preHandler: [app.requireAuth],
    preValidation: async request => {
      if (Object.keys(request.query).some(k => !['query', 'recipientId', 'pageSize', 'pageToken'].includes(k))) throw new AppError('Invalid WhatsApp inbox query.', 'WHATSAPP_INBOX_INVALID', 400);
    },
    schema: { tags: ['WhatsAppN8n'], params: Type.Object({ connectionId: Type.String({ pattern: '^[a-zA-Z0-9_-]{1,128}$' }) }, { additionalProperties: false }), querystring: N8nWhatsAppInboxQuerySchema, response: { 200: N8nWhatsAppInboxSchema } },
    onSend: async (_request, reply) => { reply.header('Cache-Control', 'no-store'); }
  }, async request => {
    try {
      if (!service) throw new Error('Storage unavailable');
      return await service.inbox(request.scope!, request.params.connectionId, request.query);
    } catch (error) {
      if (error instanceof ForbiddenError) throw new ForbiddenError('WhatsApp inbox access denied.');
      if (error instanceof AppError && ['WHATSAPP_INBOX_INVALID', 'WHATSAPP_INBOX_CHANGED'].includes(error.code)) throw error;
      throw new AppError('WhatsApp inbox storage is not configured or is unavailable.', 'WHATSAPP_INBOX_UNAVAILABLE', 503);
    }
  });

  const appointmentConfirmSchema = Type.Object({
    recipientId: Type.String({ pattern: '^[a-zA-Z0-9_-]{1,128}$' }),
    startAt: Type.Optional(Type.String({ maxLength: 40 })),
    endAt: Type.Optional(Type.String({ maxLength: 40 })),
    date: Type.Optional(Type.String({ maxLength: 40 })),
    time: Type.Optional(Type.String({ maxLength: 40 })),
    timeZone: Type.Optional(Type.String({ maxLength: 60 })),
    summary: Type.Optional(Type.String({ maxLength: 200 })),
    customerEmail: Type.Optional(Type.String({ maxLength: 120 })),
    calendlyBookingEvidence: Type.Optional(CalendlyBookingEvidenceSchema),
    calendlyEvidence: Type.Optional(CalendlyBookingEvidenceSchema)
  }, { additionalProperties: false });

  app.post<{ Params: { connectionId: string }; Body: Static<typeof appointmentConfirmSchema> }>(
    controlPath + '/appointments/confirm',
    {
      preHandler: [app.requireAuth],
      onSend: noStore,
      schema: { tags: ['WhatsAppN8n'], params: controlParams, body: appointmentConfirmSchema }
    },
    async request => {
      const scope = request.scope!;
      const { connectionId } = request.params;
      const { recipientId } = request.body;
      if (scope.role === 'viewer') throw new ForbiddenError('WhatsApp owner operation denied.');
      if (!service) throw new AppError('WhatsApp service not configured.', 'WHATSAPP_DURABLE_UNAVAILABLE', 503);

      const recipientInfo = await service.getRecipient(scope, connectionId, recipientId);
      if (!recipientInfo) throw new AppError('Recipient not found.', 'WHATSAPP_DURABLE_INVALID', 404);

      const existingAppt = recipientInfo.recipient.appointment;
      if (existingAppt?.status === 'CONFIRMED') {
        const naturalSlot = formatAppointmentNaturalSlot(existingAppt.time, existingAppt.startAt, existingAppt.timeZone ?? 'Asia/Kolkata');
        return {
          status: 'CONFIRMED' as const,
          ...(existingAppt.calendarEventId ? { calendarEventId: existingAppt.calendarEventId } : {}),
          ...(existingAppt.calendlyBookingId ? { calendlyBookingId: existingAppt.calendlyBookingId } : {}),
          startAt: existingAppt.startAt,
          endAt: existingAppt.endAt,
          timeZone: existingAppt.timeZone ?? 'Asia/Kolkata',
          confirmedAt: existingAppt.confirmedAt,
          preparedConfirmationReply: existingAppt.calendarEventId
            ? `Your 30-minute discovery call is CONFIRMED for ${naturalSlot}. Looking forward to speaking with you!`
            : `Your consultation is CONFIRMED. Looking forward to speaking with you!`,
          alreadyConfirmed: true
        };
      }

      // When verified Calendly booking evidence is supplied, confirm the booking
      const calendlyEvidence = request.body.calendlyBookingEvidence ?? request.body.calendlyEvidence;
      if (calendlyEvidence) {
        const evidence = calendlyEvidence;
        if (!evidence.bookingId || !evidence.eventUri || !evidence.inviteeUri || evidence.status !== 'active') {
          throw new AppError('Invalid Calendly booking evidence.', 'CALENDLY_EVIDENCE_INVALID', 400);
        }
        const confirmedAt = new Date().toISOString();
        const preferredText = request.body.startAt
          ? undefined
          : (request.body.date || request.body.time || existingAppt?.time);
        const resolved = resolveAppointmentDateTime(preferredText, Date.now(), request.body.timeZone || 'Asia/Kolkata');
        const startAt = request.body.startAt || resolved.startAt;
        const endAt = request.body.endAt || resolved.endAt;
        const apptRecord = {
          status: 'CONFIRMED' as const,
          calendlyBookingId: evidence.bookingId,
          calendlyUrl: 'https://calendly.com/team-brandmint/30min',
          date: request.body.date ?? existingAppt?.date ?? resolved.displaySlot,
          time: request.body.time ?? existingAppt?.time ?? resolved.displaySlot,
          startAt,
          endAt,
          timeZone: request.body.timeZone || existingAppt?.timeZone || 'Asia/Kolkata',
          confirmedAt,
          service: existingAppt?.service ?? 'Consultation',
          business: existingAppt?.business ?? 'Business',
          customerName: existingAppt?.customerName ?? 'Customer',
          customerEmail: existingAppt?.customerEmail ?? request.body.customerEmail
        };
        await service.updateRecipientAppointment(scope, connectionId, recipientId, apptRecord, 'appointment_confirmed');
        return {
          status: 'CONFIRMED' as const,
          calendlyBookingId: evidence.bookingId,
          startAt,
          endAt,
          timeZone: apptRecord.timeZone,
          confirmedAt,
          preparedConfirmationReply: 'Your consultation is confirmed with our team. Looking forward to speaking with you!'
        };
      }

      if (typeof service?.dispatchAppointmentApproval !== 'function' && existingAppt?.status === 'AWAITING_CUSTOMER_BOOKING' && existingAppt.bookingLinkSent) {
        const isProviderAccepted = Boolean(existingAppt.bookingEvidenceVerified || existingAppt.status === 'CONFIRMED');
        return {
          status: 'AWAITING_CUSTOMER_BOOKING' as const,
          calendlyUrl: existingAppt.calendlyUrl ?? 'https://calendly.com/team-brandmint/30min',
          startAt: existingAppt.startAt,
          endAt: existingAppt.endAt,
          timeZone: existingAppt.timeZone ?? 'Asia/Kolkata',
          bookingLinkSent: true as const,
          alreadySent: isProviderAccepted,
          preparedConfirmationReply: `Your 30-minute consultation request has been approved.\n\nPlease select and confirm your preferred slot here:\n${existingAppt.calendlyUrl ?? 'https://calendly.com/team-brandmint/30min'}\n\nWe look forward to speaking with you.`
        };
      }

      const enquiry = extractWhatsAppCustomerEnquiry({
        connectionId,
        recipientId,
        contactName: formatWhatsAppContactName(recipientId, recipientInfo.recipient.displayName),
        maskedPhone: maskPhoneNumber(recipientInfo.recipient.phoneE164),
        optedIn: recipientInfo.recipient.optedIn,
        messages: recipientInfo.messages.map(m => ({
          providerMessageId: m.providerMessageId,
          direction: ((m as any).direction ?? 'inbound') as 'inbound' | 'outbound',
          textPreview: m.textPreview,
          timestamp: m.timestamp
        }))
      });

      const rawCustomer = enquiry?.customerName || recipientInfo.recipient.displayName;
      const customerLabel = rawCustomer && isRealCustomerName(rawCustomer) ? rawCustomer : 'Customer';
      const bizLabel = enquiry?.businessName || enquiry?.businessCategory || enquiry?.businessType || 'Business';
      const timeZone = request.body.timeZone || 'Asia/Kolkata';

      const preferredText = request.body.startAt
        ? undefined
        : (request.body.date || request.body.time || enquiry?.preferredCallbackTime);
      const resolved = resolveAppointmentDateTime(preferredText, Date.now(), timeZone);
      const startAt = request.body.startAt || resolved.startAt;
      const endAt = request.body.endAt || resolved.endAt;

      // Owner approves the appointment invitation -> share verified Calendly link.
      // WhatsApp appointment flow does NOT create a Google Calendar event; appointment remains
      // in AWAITING_CUSTOMER_BOOKING until verified Calendly evidence is available.
      const calendlyUrl = 'https://calendly.com/team-brandmint/30min';
      const preparedConfirmationReply =
        `Your 30-minute consultation request has been approved.\n\nPlease select and confirm your preferred slot here:\n${calendlyUrl}\n\nWe look forward to speaking with you.`;

      const sameSlot = existingAppt && (!request.body.startAt || request.body.startAt === existingAppt.startAt) && (!request.body.date || request.body.date === existingAppt.date);
      const consultationId =
        (request.body as { consultationId?: string }).consultationId ??
        (sameSlot && existingAppt?.consultationId ? existingAppt.consultationId : `consult-${createHash('sha256').update(`${recipientId}:${customerLabel}:${startAt ?? request.body.date ?? enquiry?.preferredCallbackTime ?? resolved.displaySlot ?? Date.now()}`).digest('hex').slice(0, 16)}`);

      const apptRecord = {
        status: 'AWAITING_CUSTOMER_BOOKING' as const,
        calendlyUrl,
        linkSentAt: new Date().toISOString(),
        date: request.body.date ?? enquiry?.preferredCallbackTime ?? resolved.displaySlot,
        time: request.body.time ?? enquiry?.preferredCallbackTime ?? resolved.displaySlot,
        startAt,
        endAt,
        timeZone,
        service: enquiry?.requestedService ?? 'Consultation',
        business: bizLabel,
        customerName: customerLabel,
        customerEmail: enquiry?.customerEmail ?? request.body.customerEmail,
        bookingLinkSent: true,
        consultationId
      };

      if (typeof service.dispatchAppointmentApproval === 'function') {
        return await service.dispatchAppointmentApproval(scope, connectionId, recipientId, apptRecord, preparedConfirmationReply);
      }

      await service.updateRecipientAppointment(scope, connectionId, recipientId, apptRecord, 'appointment_confirmed');
      return {
        status: 'AWAITING_CUSTOMER_BOOKING' as const,
        calendlyUrl,
        startAt,
        endAt,
        timeZone,
        bookingLinkSent: true,
        preparedConfirmationReply
      };
    }
  );

  app.post<{ Params: { connectionId: string }; Body: { recipientId: string } }>(
    controlPath + '/appointments/decline',
    {
      preHandler: [app.requireAuth],
      onSend: noStore,
      schema: { tags: ['WhatsAppN8n'], params: controlParams, body: Type.Object({ recipientId: Type.String({ pattern: '^[a-zA-Z0-9_-]{1,128}$' }) }, { additionalProperties: false }) }
    },
    async request => {
      const scope = request.scope!;
      const { connectionId } = request.params;
      const { recipientId } = request.body;
      if (scope.role === 'viewer') throw new ForbiddenError('WhatsApp owner operation denied.');
      if (!service) throw new AppError('WhatsApp service not configured.', 'WHATSAPP_DURABLE_UNAVAILABLE', 503);

      const recipientInfo = await service.getRecipient(scope, connectionId, recipientId);
      if (!recipientInfo) throw new AppError('Recipient not found.', 'WHATSAPP_DURABLE_INVALID', 404);

      const existing = recipientInfo.recipient.appointment;
      const updated = {
        ...existing,
        status: 'CANCELLED' as const,
        declinedAt: new Date().toISOString()
      };

      await service.updateRecipientAppointment(scope, connectionId, recipientId, updated, 'appointment_cancelled');
      return { status: 'CANCELLED' as const, appointment: updated };
    }
  );

  app.post<{ Params: { connectionId: string }; Body: { recipientId: string; newStartAt?: string; newEndAt?: string; newDate?: string; newTime?: string } }>(
    controlPath + '/appointments/reschedule',
    {
      preHandler: [app.requireAuth],
      onSend: noStore,
      schema: { tags: ['WhatsAppN8n'], params: controlParams }
    },
    async request => {
      const scope = request.scope!;
      const { connectionId } = request.params;
      const { recipientId, newStartAt, newEndAt, newDate, newTime } = request.body;
      if (!service) throw new AppError('WhatsApp service not configured.', 'WHATSAPP_DURABLE_UNAVAILABLE', 503);

      const recipientInfo = await service.getRecipient(scope, connectionId, recipientId);
      if (!recipientInfo) throw new AppError('Recipient not found.', 'WHATSAPP_DURABLE_INVALID', 404);

      const existing = recipientInfo.recipient.appointment;
      const startAt = newStartAt || existing?.startAt || new Date().toISOString();
      const endAt = newEndAt || existing?.endAt || new Date(Date.parse(startAt) + 1800000).toISOString();

      if (calendar && existing?.calendarEventId && db) {
        try {
          const readiness = await calendar.writeReadiness(scope, 'reschedule');
          if (readiness.ready && readiness.connectedCalendar) {
            const rescheduleParams: GoogleCalendarRescheduleEventInput = {
              connectedCalendar: readiness.connectedCalendar,
              eventId: existing.calendarEventId,
              summary: '30-min Discovery Call with ' + (existing?.customerName ?? 'Customer'),
              expectedStartAt: existing?.startAt ?? startAt,
              expectedEndAt: existing?.endAt ?? endAt,
              expectedStatus: 'confirmed',
              newStartAt: startAt,
              newEndAt: endAt,
              timeZone: existing?.timeZone || 'Asia/Kolkata',
              sendUpdates: 'none'
            };
            const approvedRequest: ApprovalRequest = {
              id: randomUUID(),
              workspaceId: scope.workspaceId,
              requesterUserId: scope.userId,
              approverUserId: scope.userId,
              actionName: GOOGLE_CALENDAR_RESCHEDULE_EVENT_ACTION,
              actionParams: rescheduleParams as unknown as Record<string, unknown>,
              status: 'approved',
              riskLevel: 'high',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 3600000).toISOString()
            };
            await calendar.rescheduleEvent(scope, rescheduleParams, approvedRequest, 'wa-cal-resched-' + randomUUID());
          }
        } catch {
          // continue
        }
      }

      const updated = {
        ...existing,
        status: 'CONFIRMED' as const,
        startAt,
        endAt,
        ...(newDate ? { date: newDate } : {}),
        ...(newTime ? { time: newTime } : {})
      };

      await service.updateRecipientAppointment(scope, connectionId, recipientId, updated, 'appointment_rescheduled');
      const naturalSlot = formatAppointmentNaturalSlot(updated.time, updated.startAt, updated.timeZone ?? 'Asia/Kolkata');
      const preparedConfirmationReply = `Your 30-minute discovery call has been rescheduled for ${naturalSlot}. Looking forward to speaking with you!`;
      return { status: 'CONFIRMED' as const, appointment: updated, preparedConfirmationReply };
    }
  );

  app.post<{ Params: { connectionId: string }; Body: { recipientId: string } }>(
    controlPath + '/appointments/cancel',
    {
      preHandler: [app.requireAuth],
      onSend: noStore,
      schema: { tags: ['WhatsAppN8n'], params: controlParams }
    },
    async request => {
      const scope = request.scope!;
      const { connectionId } = request.params;
      const { recipientId } = request.body;
      if (!service) throw new AppError('WhatsApp service not configured.', 'WHATSAPP_DURABLE_UNAVAILABLE', 503);

      const recipientInfo = await service.getRecipient(scope, connectionId, recipientId);
      if (!recipientInfo) throw new AppError('Recipient not found.', 'WHATSAPP_DURABLE_INVALID', 404);

      const existing = recipientInfo.recipient.appointment;
      if (calendar && existing?.calendarEventId && db) {
        try {
          const readiness = await calendar.writeReadiness(scope, 'cancel');
          if (readiness.ready && readiness.connectedCalendar) {
            const cancelParams: GoogleCalendarCancelEventInput = {
              connectedCalendar: readiness.connectedCalendar,
              eventId: existing.calendarEventId,
              summary: '30-min Discovery Call with ' + (existing?.customerName ?? 'Customer'),
              expectedStartAt: existing?.startAt ?? new Date().toISOString(),
              expectedEndAt: existing?.endAt ?? new Date().toISOString(),
              expectedStatus: 'confirmed',
              timeZone: existing?.timeZone || 'Asia/Kolkata',
              sendUpdates: 'none'
            };
            const approvedRequest: ApprovalRequest = {
              id: randomUUID(),
              workspaceId: scope.workspaceId,
              requesterUserId: scope.userId,
              approverUserId: scope.userId,
              actionName: GOOGLE_CALENDAR_CANCEL_EVENT_ACTION,
              actionParams: cancelParams as unknown as Record<string, unknown>,
              status: 'approved',
              riskLevel: 'high',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 3600000).toISOString()
            };
            await calendar.cancelEvent(scope, cancelParams, approvedRequest, 'wa-cal-cancel-' + randomUUID());
          }
        } catch {
          // continue
        }
      }

      const updated = {
        ...existing,
        status: 'CANCELLED' as const
      };

      await service.updateRecipientAppointment(scope, connectionId, recipientId, updated, 'appointment_cancelled');
      const naturalSlot = formatAppointmentNaturalSlot(existing?.time, existing?.startAt, existing?.timeZone ?? 'Asia/Kolkata');
      const preparedConfirmationReply = `Your 30-minute discovery call scheduled for ${naturalSlot} has been cancelled. Let us know if you'd like to book another time.`;
      return { status: 'CANCELLED' as const, appointment: updated, preparedConfirmationReply };
    }
  );

}
