import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  PhoneInboundHistoryDetailSchema,
  PhoneInboundHistoryListSchema,
  PhoneN8nCallSyncBatchRequestSchema,
  PhoneN8nCallSyncBatchResponseSchema,
  PhoneN8nCallbackEvaluateClaimRequestSchema,
  PhoneN8nCallbackEvaluateClaimResponseSchema,
  PhoneN8nCallbackReceiptRequestSchema,
  PhoneN8nCallbackReceiptResponseSchema,
  PhoneN8nSyncCheckpointResponseSchema,
  type PhoneN8nCallSyncBatchRequest,
  type PhoneN8nCallbackEvaluateClaimRequest,
  type PhoneN8nCallbackReceiptRequest
} from '@thaara/contracts';
import { AppError, ForbiddenError } from '@thaara/observability';
import type { PhoneCallingService } from '../services/phone-calling.js';
import type { PhoneN8nSyncService } from '../services/phone-n8n-sync.js';

const SYNC_TOKEN_HEADER = 'x-thaara-phone-sync-token';

export async function phoneN8nSyncRoutes(
  app: FastifyInstance,
  options: {
    syncService?: PhoneN8nSyncService;
    phoneCalling?: PhoneCallingService;
  }
) {
  const { syncService, phoneCalling } = options;
  const tags = ['PhoneN8nSync'];
  const noStore = async (
    _request: unknown,
    reply: { header(name: string, value: string): unknown }
  ) => {
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Referrer-Policy', 'no-referrer');
  };

  // --- Machine-authenticated n8n endpoints ---
  app.get(
    '/connectors/phone/n8n/checkpoint',
    {
      onSend: noStore,
      schema: {
        tags,
        response: { 200: PhoneN8nSyncCheckpointResponseSchema }
      }
    },
    async req => {
      if (!syncService) {
        throw new AppError('Phone n8n sync is not configured.', 'PHONE_N8N_NOT_CONFIGURED', 503);
      }
      return syncService.getCheckpoint(req.headers[SYNC_TOKEN_HEADER]);
    }
  );

  app.post<{ Body: PhoneN8nCallSyncBatchRequest }>(
    '/connectors/phone/n8n/calls/sync',
    {
      onSend: noStore,
      bodyLimit: 1048576,
      preValidation: async req => {
        if (!Value.Check(PhoneN8nCallSyncBatchRequestSchema, req.body)) {
          throw new AppError('Invalid phone call sync batch payload.', 'PHONE_N8N_INVALID_INPUT', 400);
        }
      },
      schema: {
        tags,
        body: PhoneN8nCallSyncBatchRequestSchema,
        response: { 200: PhoneN8nCallSyncBatchResponseSchema }
      }
    },
    async req => {
      if (!syncService) {
        throw new AppError('Phone n8n sync is not configured.', 'PHONE_N8N_NOT_CONFIGURED', 503);
      }
      return syncService.syncBatch(req.headers[SYNC_TOKEN_HEADER], req.body);
    }
  );

  app.post<{ Body: PhoneN8nCallbackEvaluateClaimRequest }>(
    '/connectors/phone/n8n/callbacks/evaluate-and-claim',
    {
      onSend: noStore,
      bodyLimit: 524288,
      preValidation: async req => {
        if (!Value.Check(PhoneN8nCallbackEvaluateClaimRequestSchema, req.body)) {
          throw new AppError('Invalid callback evaluation payload.', 'PHONE_N8N_INVALID_INPUT', 400);
        }
      },
      schema: {
        tags,
        body: PhoneN8nCallbackEvaluateClaimRequestSchema,
        response: { 200: PhoneN8nCallbackEvaluateClaimResponseSchema }
      }
    },
    async req => {
      if (!syncService) {
        throw new AppError('Phone n8n sync is not configured.', 'PHONE_N8N_NOT_CONFIGURED', 503);
      }
      return syncService.evaluateAndClaimCallback(req.headers[SYNC_TOKEN_HEADER], req.body);
    }
  );

  app.post<{ Body: PhoneN8nCallbackReceiptRequest }>(
    '/connectors/phone/n8n/callbacks/receipt',
    {
      onSend: noStore,
      bodyLimit: 32768,
      preValidation: async req => {
        if (!Value.Check(PhoneN8nCallbackReceiptRequestSchema, req.body)) {
          throw new AppError('Invalid callback receipt payload.', 'PHONE_N8N_INVALID_INPUT', 400);
        }
      },
      schema: {
        tags,
        body: PhoneN8nCallbackReceiptRequestSchema,
        response: { 200: PhoneN8nCallbackReceiptResponseSchema }
      }
    },
    async req => {
      if (!syncService) {
        throw new AppError('Phone n8n sync is not configured.', 'PHONE_N8N_NOT_CONFIGURED', 503);
      }
      return syncService.recordCallbackReceipt(req.headers[SYNC_TOKEN_HEADER], req.body);
    }
  );

  // --- Owner-authenticated Dashboard read & secure recording playback endpoints ---
  const preHandler = [app.requireAuth];

  app.get(
    '/connectors/phone/call-history/inbound',
    {
      preHandler,
      onSend: noStore,
      schema: {
        tags,
        response: { 200: PhoneInboundHistoryListSchema }
      }
    },
    async req => {
      if (req.scope?.role !== 'owner') {
        throw new ForbiddenError('Only the workspace owner can view inbound customer reports.');
      }
      if (!syncService) {
        return { status: 'not_configured' as const, reports: [] };
      }
      return syncService.listInboundHistory(req.scope);
    }
  );

  app.get<{ Params: { id: string } }>(
    '/connectors/phone/call-history/inbound/:id',
    {
      preHandler,
      onSend: noStore,
      schema: {
        tags,
        params: Type.Object(
          { id: Type.String({ pattern: '^[A-Za-z0-9_-]{1,128}$' }) },
          { additionalProperties: false }
        ),
        response: { 200: PhoneInboundHistoryDetailSchema }
      }
    },
    async req => {
      if (req.scope?.role !== 'owner') {
        throw new ForbiddenError('Only the workspace owner can view inbound customer reports.');
      }
      if (!syncService) {
        return { status: 'not_configured' as const, report: null };
      }
      return syncService.getInboundHistoryDetail(req.scope, req.params.id);
    }
  );

  app.get<{ Params: { direction: 'inbound' | 'outbound'; id: string } }>(
    '/connectors/phone/recordings/:direction/:id',
    {
      preHandler,
      onSend: noStore,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags,
        params: Type.Object(
          {
            direction: Type.Union([Type.Literal('inbound'), Type.Literal('outbound')]),
            id: Type.String({ pattern: '^[A-Za-z0-9_-]{1,128}$' })
          },
          { additionalProperties: false }
        )
      }
    },
    async (req, reply) => {
      if (req.scope?.role !== 'owner') {
        throw new ForbiddenError('Only the workspace owner can listen to call recordings.');
      }
      if (!syncService) {
        throw new AppError('Call recording playback is not configured.', 'PHONE_RECORDING_NOT_CONFIGURED', 503);
      }
      const { contentType, bytes } = await syncService.streamRecording(
        req.scope,
        req.params.direction,
        req.params.id,
        phoneCalling
      );
      return reply
        .header('Content-Disposition', 'inline')
        .header('X-Content-Type-Options', 'nosniff')
        .type(contentType)
        .send(bytes);
    }
  );

  app.get<{ Params: { direction: 'inbound' | 'outbound'; id: string } }>(
    '/connectors/phone/transcripts/:direction/:id',
    {
      preHandler,
      onSend: noStore,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags,
        params: Type.Object(
          {
            direction: Type.Union([Type.Literal('inbound'), Type.Literal('outbound')]),
            id: Type.String({ pattern: '^[A-Za-z0-9_-]{1,128}$' })
          },
          { additionalProperties: false }
        )
      }
    },
    async req => {
      if (req.scope?.role !== 'owner') {
        throw new ForbiddenError('Only the workspace owner can view call transcripts.');
      }
      if (!syncService) {
        return { callId: req.params.id, direction: req.params.direction, fullTranscriptAvailable: false, transcript: [] };
      }
      return syncService.readTranscript(req.scope, req.params.direction, req.params.id, phoneCalling);
    }
  );
}
