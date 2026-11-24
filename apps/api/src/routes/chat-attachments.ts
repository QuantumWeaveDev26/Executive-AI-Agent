/**
 * Authenticated Chat Attachment Routes.
 *
 * Provides:
 * - POST /conversations/:id/attachments (Upload file, validate magic bytes, parse text)
 * - GET  /conversations/:id/attachments (List attachments for conversation)
 * - GET  /conversations/:id/attachments/:attachmentId (Retrieve attachment)
 */

import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { globalChatAttachmentStore } from '../services/chat-attachments.js';
import { AppError, NotFoundError } from '@thaara/observability';

export async function chatAttachmentRoutes(fastify: FastifyInstance): Promise<void> {
  // 1. POST /conversations/:id/attachments - Upload attachment
  fastify.post<{
    Params: { id: string };
    Body: {
      filename: string;
      mimeType: string;
      contentBase64: string;
    };
  }>(
    '/conversations/:id/attachments',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Upload an attachment for a conversation turn',
        tags: ['Conversations', 'Attachments'],
        params: Type.Object({
          id: Type.String({ format: 'uuid' })
        }),
        body: Type.Object({
          filename: Type.String({ minLength: 1, maxLength: 255 }),
          mimeType: Type.String({ minLength: 3, maxLength: 128 }),
          contentBase64: Type.String({ minLength: 4 })
        })
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const conversationId = request.params.id;
      const { filename, mimeType, contentBase64 } = request.body;

      // Check current conversation attachment count limit
      const existing = await globalChatAttachmentStore.listByConversation(scope, conversationId);
      if (existing.length >= 25) {
        throw new AppError('Conversation has reached the maximum attachment capacity.', 'ATTACHMENT_LIMIT_REACHED', 400);
      }

      let bytes: Buffer;
      try {
        bytes = Buffer.from(contentBase64, 'base64');
      } catch {
        throw new AppError('Invalid base64 payload.', 'ATTACHMENT_INVALID_BASE64', 400);
      }

      const record = await globalChatAttachmentStore.save(scope, conversationId, {
        filename,
        mimeType,
        bytes
      });

      return reply.status(201).send({
        id: record.id,
        filename: record.filename,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        extractedTextLength: record.extractedText?.length ?? 0,
        hasThumbnail: Boolean(record.thumbnailBase64),
        previewText: record.extractedText ? record.extractedText.slice(0, 300) : undefined,
        thumbnailBase64: record.thumbnailBase64
      });
    }
  );

  // 2. GET /conversations/:id/attachments - List attachments
  fastify.get<{
    Params: { id: string };
  }>(
    '/conversations/:id/attachments',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'List attachments for a conversation',
        tags: ['Conversations', 'Attachments'],
        params: Type.Object({
          id: Type.String({ format: 'uuid' })
        })
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const conversationId = request.params.id;
      const list = await globalChatAttachmentStore.listByConversation(scope, conversationId);
      return reply.send({ attachments: list });
    }
  );

  // 3. GET /conversations/:id/attachments/:attachmentId - Download or view
  fastify.get<{
    Params: { id: string; attachmentId: string };
  }>(
    '/conversations/:id/attachments/:attachmentId',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Retrieve attachment by ID',
        tags: ['Conversations', 'Attachments'],
        params: Type.Object({
          id: Type.String({ format: 'uuid' }),
          attachmentId: Type.String({ format: 'uuid' })
        })
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const { attachmentId } = request.params;
      const record = await globalChatAttachmentStore.findById(scope, attachmentId);
      if (!record) {
        throw new NotFoundError(`Attachment '${attachmentId}' not found.`);
      }

      reply.header('Content-Type', record.mimeType);
      reply.header('Content-Disposition', `inline; filename="${record.filename}"`);
      return reply.send(record.bytes);
    }
  );
}
