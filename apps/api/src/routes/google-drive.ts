import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import {
  GoogleDriveCreateDocInput,
  GoogleDriveCreateDocInputSchema,
  GoogleDriveCreateFolderInput,
  GoogleDriveCreateFolderInputSchema,
  GoogleDriveDeleteInput,
  GoogleDriveDeleteInputSchema,
  GoogleDriveListFolderInput,
  GoogleDriveListFolderInputSchema,
  GoogleDriveOperationResultSchema,
  GoogleDriveReadFileInput,
  GoogleDriveReadFileInputSchema,
  GoogleDriveRenameMoveInput,
  GoogleDriveRenameMoveInputSchema,
  GoogleDriveSearchInput,
  GoogleDriveSearchInputSchema,
  GoogleDriveShareInput,
  GoogleDriveShareInputSchema,
  GoogleDriveStatusSchema,
  GoogleDriveUploadInput,
  GoogleDriveUploadInputSchema
} from '@thaara/contracts';
import { AuditEventRepository, AuthenticatedScope, TransactionalDbClient } from '@thaara/db';
import { ForbiddenError } from '@thaara/observability';
import { PolicyGateway } from '@thaara/policy';
import { GoogleDriveService } from '../services/google-drive.js';
import { ModelGatewayAdapter } from '../services/model-gateway.js';

const GoogleDriveStatusQuerySchema = Type.Object(
  {
    verify: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);
type GoogleDriveStatusQuery = Static<typeof GoogleDriveStatusQuerySchema>;

export async function googleDriveRoutes(
  app: FastifyInstance,
  options: {
    db: TransactionalDbClient;
    policyGateway: PolicyGateway;
    modelGateway?: ModelGatewayAdapter;
    googleDrive?: GoogleDriveService;
  }
): Promise<GoogleDriveService> {
  async function scoped(
    scope: AuthenticatedScope,
    action?: string,
    payload: Record<string, unknown> = {}
  ): Promise<void> {
    await options.db.withScopedTransaction(scope, async (tx) => {
      if (scope.sessionTokenHash) {
        const { rows } = await tx.query<{ workspace_id: string; user_id: string; role: string }>(
          'SELECT workspace_id,user_id,role FROM public.resolve_session_scope($1)',
          [scope.sessionTokenHash]
        );
        const current = rows[0];
        if (
          !current ||
          current.workspace_id !== scope.workspaceId ||
          current.user_id !== scope.userId ||
          current.role !== scope.role
        ) {
          throw new ForbiddenError('Active matching workspace membership is required.');
        }
      }
      if (action) {
        await new AuditEventRepository(tx).create(
          scope.workspaceId,
          action,
          'google_drive',
          payload,
          scope.userId
        );
      }
    });
  }

  const service =
    options.googleDrive ??
    new GoogleDriveService({
      policyGateway: options.policyGateway,
      modelGateway: options.modelGateway,
      audit: (scope, action, payload) => scoped(scope, action, payload)
    });

  service.attachGovernance({
    policyGateway: options.policyGateway,
    modelGateway: options.modelGateway,
    audit: (scope, action, payload) => scoped(scope, action, payload)
  });

  const preHandler = [
    async (_request: unknown, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    },
    app.requireAuth
  ];

  const tags = ['Google Drive'];

  app.get<{ Querystring: GoogleDriveStatusQuery }>(
    '/connectors/google-drive/status',
    {
      preHandler,
      schema: {
        tags,
        querystring: GoogleDriveStatusQuerySchema,
        response: { 200: GoogleDriveStatusSchema }
      }
    },
    async (request) => {
      await scoped(request.scope!);
      return service.getStatus(request.scope!, { verify: Boolean(request.query?.verify) });
    }
  );

  app.post<{ Body: GoogleDriveSearchInput }>(
    '/connectors/google-drive/search',
    {
      preHandler,
      schema: {
        tags,
        body: GoogleDriveSearchInputSchema,
        response: { 200: GoogleDriveOperationResultSchema }
      }
    },
    async (request) => {
      await scoped(request.scope!);
      return service.searchFiles(request.scope!, request.body);
    }
  );

  app.post<{ Body: GoogleDriveListFolderInput }>(
    '/connectors/google-drive/folders/list',
    {
      preHandler,
      schema: {
        tags,
        body: GoogleDriveListFolderInputSchema,
        response: { 200: GoogleDriveOperationResultSchema }
      }
    },
    async (request) => {
      await scoped(request.scope!);
      return service.listFolder(request.scope!, request.body.folderId, request.body.folderName);
    }
  );

  app.post<{ Body: GoogleDriveReadFileInput }>(
    '/connectors/google-drive/files/read',
    {
      preHandler,
      schema: {
        tags,
        body: GoogleDriveReadFileInputSchema,
        response: { 200: GoogleDriveOperationResultSchema }
      }
    },
    async (request) => {
      await scoped(request.scope!);
      return service.readFile(request.scope!, request.body.fileId, request.body.fileName);
    }
  );

  app.post<{ Body: GoogleDriveReadFileInput }>(
    '/connectors/google-drive/files/summarize',
    {
      preHandler,
      schema: {
        tags,
        body: GoogleDriveReadFileInputSchema,
        response: { 200: GoogleDriveOperationResultSchema }
      }
    },
    async (request) => {
      await scoped(request.scope!);
      return service.summarizeDocument(request.scope!, request.body.fileId, request.body.fileName);
    }
  );

  app.post<{ Body: GoogleDriveCreateFolderInput }>(
    '/connectors/google-drive/folders',
    {
      preHandler,
      schema: {
        tags,
        body: GoogleDriveCreateFolderInputSchema,
        response: { 200: GoogleDriveOperationResultSchema }
      }
    },
    async (request) => {
      await scoped(request.scope!);
      return service.createFolder(request.scope!, request.body);
    }
  );

  app.post<{ Body: GoogleDriveCreateDocInput }>(
    '/connectors/google-drive/docs',
    {
      preHandler,
      schema: {
        tags,
        body: GoogleDriveCreateDocInputSchema,
        response: { 200: GoogleDriveOperationResultSchema }
      }
    },
    async (request) => {
      await scoped(request.scope!);
      return service.createDoc(request.scope!, request.body);
    }
  );

  app.post<{ Body: GoogleDriveUploadInput }>(
    '/connectors/google-drive/files/upload',
    {
      preHandler,
      schema: {
        tags,
        body: GoogleDriveUploadInputSchema,
        response: { 200: GoogleDriveOperationResultSchema }
      }
    },
    async (request) => {
      await scoped(request.scope!);
      return service.uploadFile(
        request.scope!,
        request.body.name,
        request.body.content,
        request.body.mimeType,
        request.body.folderId
      );
    }
  );

  app.post<{ Body: GoogleDriveRenameMoveInput }>(
    '/connectors/google-drive/files/rename-move',
    {
      preHandler,
      schema: {
        tags,
        body: GoogleDriveRenameMoveInputSchema,
        response: { 200: GoogleDriveOperationResultSchema }
      }
    },
    async (request) => {
      await scoped(request.scope!);
      return service.renameOrMove(request.scope!, request.body);
    }
  );

  app.post<{ Body: GoogleDriveShareInput }>(
    '/connectors/google-drive/files/share',
    {
      preHandler,
      schema: {
        tags,
        body: GoogleDriveShareInputSchema,
        response: { 200: GoogleDriveOperationResultSchema }
      }
    },
    async (request) => {
      await scoped(request.scope!);
      return service.shareFile(request.scope!, request.body);
    }
  );

  app.post<{ Body: GoogleDriveDeleteInput }>(
    '/connectors/google-drive/files/delete',
    {
      preHandler,
      schema: {
        tags,
        body: GoogleDriveDeleteInputSchema,
        response: { 200: GoogleDriveOperationResultSchema }
      }
    },
    async (request) => {
      await scoped(request.scope!);
      return service.deleteFile(request.scope!, request.body);
    }
  );

  return service;
}
