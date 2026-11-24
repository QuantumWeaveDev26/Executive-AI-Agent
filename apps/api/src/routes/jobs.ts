import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  ErrorResponseSchema,
  JobRun,
  JobRunSchema,
  JobSubmission,
  JobSubmissionSchema
} from '@thaara/contracts';
import {
  AuditEventRepository,
  IdempotencyRepository,
  JobRunRepository,
  TransactionalDbClient
} from '@thaara/db';
import { NotFoundError } from '@thaara/observability';

export interface JobQueueService {
  enqueue(workspaceId: string, jobRunId: string, jobName: string, payload: Record<string, unknown>): Promise<void>;
}

export async function jobRoutes(
  fastify: FastifyInstance,
  options: { db: TransactionalDbClient; queueService?: JobQueueService }
): Promise<void> {
  const { db, queueService } = options;

  // POST /jobs - Enqueue job with idempotency
  fastify.post<{ Body: JobSubmission; Reply: JobRun }>(
    '/jobs',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Submit an asynchronous job with idempotency',
        tags: ['Jobs'],
        body: JobSubmissionSchema,
        response: {
          202: JobRunSchema,
          400: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const { jobName, payload, idempotencyKey } = request.body;

      const jobRun = await db.withScopedTransaction(scope, async (txClient) => {
        const idempotencyRepo = new IdempotencyRepository(txClient);
        const jobRepo = new JobRunRepository(txClient);
        const auditRepo = new AuditEventRepository(txClient);

        // Check idempotency if key provided
        if (idempotencyKey) {
          const claimResult = await idempotencyRepo.claim(
            scope.workspaceId,
            idempotencyKey,
            scope.userId,
            '/api/v1/jobs'
          );

          if (!claimResult.claimed) {
            // Already submitted with this idempotency key
            const existingJob = await jobRepo.findByIdempotencyKey(scope.workspaceId, idempotencyKey);
            if (existingJob) {
              return existingJob;
            }
          }
        }

        const run = await jobRepo.create(scope.workspaceId, jobName, payload, idempotencyKey);

        await auditRepo.create(
          scope.workspaceId,
          'job.enqueued',
          'job_run',
          { jobName, idempotencyKey },
          scope.userId,
          run.id
        );

        return run;
      });

      // Queue in BullMQ / worker if queue service is present
      if (queueService) {
        await queueService.enqueue(scope.workspaceId, jobRun.id, jobName, payload);
      }

      reply.status(202);
      return {
        id: jobRun.id,
        workspaceId: jobRun.workspace_id,
        jobName: jobRun.job_name,
        status: jobRun.status,
        idempotencyKey: jobRun.idempotency_key,
        payload: jobRun.payload,
        result: jobRun.result,
        error: jobRun.error,
        retriesCount: jobRun.retries_count,
        createdAt: jobRun.created_at,
        updatedAt: jobRun.updated_at,
        completedAt: jobRun.completed_at
      };
    }
  );

  // GET /jobs/:id - Get job run status
  fastify.get<{ Params: { id: string }; Reply: JobRun }>(
    '/jobs/:id',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Get status of an enqueued job',
        tags: ['Jobs'],
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: {
          200: JobRunSchema,
          404: ErrorResponseSchema
        }
      }
    },
    async (request) => {
      const scope = request.scope!;
      const { id } = request.params;

      return await db.withScopedTransaction(scope, async (txClient) => {
        const jobRepo = new JobRunRepository(txClient);
        const job = await jobRepo.findById(scope.workspaceId, id);
        if (!job) {
          throw new NotFoundError(`Job run '${id}' not found in current workspace.`);
        }
        return {
          id: job.id,
          workspaceId: job.workspace_id,
          jobName: job.job_name,
          status: job.status,
          idempotencyKey: job.idempotency_key,
          payload: job.payload,
          result: job.result,
          error: job.error,
          retriesCount: job.retries_count,
          createdAt: job.created_at,
          updatedAt: job.updated_at,
          completedAt: job.completed_at
        };
      });
    }
  );
}
