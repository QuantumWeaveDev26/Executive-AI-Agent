import { FastifyInstance } from 'fastify';
import {
  ErrorResponseSchema,
  PolicyEvaluationRequest,
  PolicyEvaluationRequestSchema,
  PolicyEvaluationResult,
  PolicyEvaluationResultSchema
} from '@thaara/contracts';
import { ApprovalRepository, TransactionalDbClient } from '@thaara/db';
import { PolicyGateway } from '@thaara/policy';

export async function policyRoutes(
  fastify: FastifyInstance,
  options: { db: TransactionalDbClient; policyGateway: PolicyGateway }
): Promise<void> {
  const { db, policyGateway } = options;

  fastify.post<{ Body: PolicyEvaluationRequest; Reply: PolicyEvaluationResult }>(
    '/policy/evaluate',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Evaluate an action against tenant policy, risk, and approval requirements',
        tags: ['Policy'],
        body: PolicyEvaluationRequestSchema,
        response: {
          200: PolicyEvaluationResultSchema,
          400: ErrorResponseSchema
        }
      }
    },
    async (request) => {
      const scope = request.scope!;
      const evalRequest = request.body;

      let approvalRecord = null;
      if (evalRequest.approvalId) {
        approvalRecord = await db.withScopedTransaction(scope, async (txClient) => {
          const approvalRepo = new ApprovalRepository(txClient);
          return await approvalRepo.findById(scope.workspaceId, evalRequest.approvalId!);
        });
      }

      const result = policyGateway.evaluate(
        scope,
        evalRequest,
        approvalRecord
          ? {
              id: approvalRecord.id,
              workspaceId: approvalRecord.workspace_id,
              actionName: approvalRecord.action_name,
              actionParams: approvalRecord.action_params,
              requesterUserId: approvalRecord.requester_user_id,
              approverUserId: approvalRecord.approver_user_id,
              status: approvalRecord.status,
              riskLevel: approvalRecord.risk_level,
              expiresAt: approvalRecord.expires_at,
              createdAt: approvalRecord.created_at,
              updatedAt: approvalRecord.updated_at
            }
          : null
      );

      return result;
    }
  );
}
