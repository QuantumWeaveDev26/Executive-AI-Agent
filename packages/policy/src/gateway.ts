import {
  ApprovalRequest,
  PolicyEvaluationRequest,
  PolicyEvaluationResult,
  RequestScope,
  Role,
  computeCanonicalParameterHash
} from '@thaara/contracts';
import { ActionRegistry, defaultActionRegistry } from './registry.js';

const ROLE_HIERARCHY: Record<Role, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4
};

export interface PolicyGatewayOptions {
  registry?: ActionRegistry;
}

export class PolicyGateway {
  private registry: ActionRegistry;

  constructor(options: PolicyGatewayOptions = {}) {
    this.registry = options.registry ?? defaultActionRegistry;
  }

  evaluate(
    scope: RequestScope,
    request: PolicyEvaluationRequest,
    existingApproval?: ApprovalRequest | null,
    planCreatorUserId?: string
  ): PolicyEvaluationResult {
    const action = this.registry.get(request.actionName);
    if (!action) {
      return {
        status: 'REJECTED_INVALID_ACTION',
        allowed: false,
        reason: `Action '${request.actionName}' is not registered in the policy catalog.`,
        requiredApprovalMode: 'explicit',
        risk: 'high',
        auditRequired: true
      };
    }

    // Gate 1: Parameter schema validation
    if (!action.validate(request.parameters)) {
      return {
        status: 'REJECTED_INVALID_PARAMETERS',
        allowed: false,
        reason: `Parameters for action '${request.actionName}' violate typed input schema.`,
        requiredApprovalMode: action.approvalMode,
        risk: action.risk,
        auditRequired: action.auditRequired
      };
    }

    // 1. Role / Authorization Check
    const callerWeight = ROLE_HIERARCHY[scope.role] ?? 0;
    const requiredWeight = ROLE_HIERARCHY[action.requiredRole] ?? 0;
    if (callerWeight < requiredWeight) {
      return {
        status: 'REJECTED_UNAUTHORIZED',
        allowed: false,
        reason: `Role '${scope.role}' is insufficient for action requiring '${action.requiredRole}'.`,
        requiredApprovalMode: action.approvalMode,
        risk: action.risk,
        auditRequired: action.auditRequired
      };
    }

    // 2. Idempotency Check
    if (action.idempotencyRequired && !request.idempotencyKey) {
      return {
        status: 'REJECTED_IDEMPOTENCY_REQUIRED',
        allowed: false,
        reason: `Action '${request.actionName}' requires an idempotency key.`,
        requiredApprovalMode: action.approvalMode,
        risk: action.risk,
        auditRequired: action.auditRequired
      };
    }

    // 3. Approval Gate for Mutations
    if (action.actionClass === 'write' && action.approvalMode !== 'none') {
      if (!existingApproval) {
        return {
          status: 'REJECTED_APPROVAL_REQUIRED',
          allowed: false,
          reason: `Action '${request.actionName}' is a mutating action requiring ${action.approvalMode} approval before execution.`,
          requiredApprovalMode: action.approvalMode,
          risk: action.risk,
          auditRequired: action.auditRequired
        };
      }

      if (existingApproval.status !== 'approved') {
        return {
          status: 'REJECTED_APPROVAL_REQUIRED',
          allowed: false,
          reason: `Approval request '${existingApproval.id}' has status '${existingApproval.status}', but must be 'approved'.`,
          requiredApprovalMode: action.approvalMode,
          risk: action.risk,
          auditRequired: action.auditRequired
        };
      }

      // Check tenant matching
      if (existingApproval.workspaceId !== scope.workspaceId) {
        return {
          status: 'REJECTED_UNAUTHORIZED',
          allowed: false,
          reason: `Approval request belongs to another workspace. Access denied.`,
          requiredApprovalMode: action.approvalMode,
          risk: action.risk,
          auditRequired: action.auditRequired
        };
      }

      // Check requester matches plan creator if provided
      if (planCreatorUserId && existingApproval.requesterUserId !== planCreatorUserId) {
        return {
          status: 'REJECTED_APPROVAL_REQUIRED',
          allowed: false,
          reason: `Approval requester '${existingApproval.requesterUserId}' does not match plan creator '${planCreatorUserId}'.`,
          requiredApprovalMode: action.approvalMode,
          risk: action.risk,
          auditRequired: action.auditRequired
        };
      }

      // Two-person rule enforcement
      if (action.approvalMode === 'two_person') {
        if (!existingApproval.approverUserId || existingApproval.approverUserId === existingApproval.requesterUserId) {
          return {
            status: 'REJECTED_APPROVAL_REQUIRED',
            allowed: false,
            reason: `Action requires two-person approval; approver cannot be the same user as the requester.`,
            requiredApprovalMode: action.approvalMode,
            risk: action.risk,
            auditRequired: action.auditRequired
          };
        }
      }

      // Check expiry
      if (new Date(existingApproval.expiresAt) < new Date()) {
        return {
          status: 'REJECTED_APPROVAL_REQUIRED',
          allowed: false,
          reason: `Approval request '${existingApproval.id}' has expired.`,
          requiredApprovalMode: action.approvalMode,
          risk: action.risk,
          auditRequired: action.auditRequired
        };
      }

      // Check action name matching
      if (existingApproval.actionName !== request.actionName) {
        return {
          status: 'REJECTED_APPROVAL_REQUIRED',
          allowed: false,
          reason: `Approval is for action '${existingApproval.actionName}', not '${request.actionName}'.`,
          requiredApprovalMode: action.approvalMode,
          risk: action.risk,
          auditRequired: action.auditRequired
        };
      }

      // Check parameter hash matching
      if (existingApproval.actionParams && request.parameters) {
        const approvalHash = computeCanonicalParameterHash(existingApproval.actionParams);
        const requestHash = computeCanonicalParameterHash(request.parameters);
        if (approvalHash !== requestHash) {
          return {
            status: 'REJECTED_APPROVAL_REQUIRED',
            allowed: false,
            reason: `Action parameters do not match approved parameters (parameter hash mismatch).`,
            requiredApprovalMode: action.approvalMode,
            risk: action.risk,
            auditRequired: action.auditRequired
          };
        }
      }
    }

    // Allowed
    return {
      status: 'ALLOWED',
      allowed: true,
      reason: 'Action passed deterministic policy evaluation.',
      requiredApprovalMode: action.approvalMode,
      risk: action.risk,
      auditRequired: action.auditRequired
    };
  }
}

export const defaultPolicyGateway = new PolicyGateway();
