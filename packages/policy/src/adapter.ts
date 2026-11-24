import { ConnectorStatusResponse, computeCanonicalParameterHash } from '@thaara/contracts';

export interface ConnectorAdapter {
  readonly name: string;
  getStatus(): Promise<ConnectorStatusResponse>;
  execute(actionName: string, params: Record<string, unknown>): Promise<never>;
}

export class NotConfiguredConnectorTestAdapter implements ConnectorAdapter {
  public readonly name = 'test_unconfigured_service';

  async getStatus(): Promise<ConnectorStatusResponse> {
    return {
      connectorName: this.name,
      status: 'not_configured',
      connected: false,
      configured: false,
      message: 'Integration is not configured. Credentials, endpoints, or live tokens have not been verified.',
      lastVerifiedAt: null
    };
  }

  async execute(actionName: string, _params: Record<string, unknown>): Promise<never> {
    throw new Error(
      `Cannot execute action '${actionName}' on unconfigured connector '${this.name}'. Connector is in truthful 'not_configured' state.`
    );
  }
}

export const defaultTestAdapter = new NotConfiguredConnectorTestAdapter();

export type IdempotencySupport = 'native' | 'reconciliation_query' | 'none';

export interface ActionExecutionContext {
  workspaceId: string;
  planId: string;
  stepId: string;
  idempotencyKey: string;
  parameters: Record<string, unknown>;
  dependencyProofs?: Record<string, Record<string, unknown>>; scope?: unknown; approvedRequest?: unknown;
}

export interface ActionResult {
  success: boolean;
  proof: Record<string, unknown>;
  verificationMethod: string;
  status: 'verified' | 'unverified' | 'failed' | 'not_configured';
  error?: string;
}

export interface ActionAdapter {
  readonly name: string;
  readonly idempotencySupport: IdempotencySupport;
  execute(context: ActionExecutionContext): Promise<ActionResult>;
  reconcile?(context: ActionExecutionContext): Promise<ActionResult | null>;
}

export class TestDeterministicHashAdapter implements ActionAdapter {
  public readonly name = 'test.deterministic_hash_task';
  public readonly idempotencySupport: IdempotencySupport = 'native';

  async execute(context: ActionExecutionContext): Promise<ActionResult> {
    const hash = computeCanonicalParameterHash({
      idempotencyKey: context.idempotencyKey,
      parameters: context.parameters
    });
    return {
      success: true,
      status: 'verified',
      verificationMethod: 'cryptographic_hash_receipt',
      proof: {
        hash,
        executedAt: new Date().toISOString(),
        idempotencyKey: context.idempotencyKey
      }
    };
  }

  async reconcile(context: ActionExecutionContext): Promise<ActionResult | null> {
    return this.execute(context);
  }
}

export class TestApprovalGatedHashAdapter implements ActionAdapter {
  public readonly name = 'test.approval_gated_hash_task';
  public readonly idempotencySupport: IdempotencySupport = 'native';

  async execute(context: ActionExecutionContext): Promise<ActionResult> {
    const verifiedDependencyStepIds = Object.keys(context.dependencyProofs ?? {}).sort();
    const hash = computeCanonicalParameterHash({
      idempotencyKey: context.idempotencyKey,
      parameters: context.parameters,
      verifiedDependencyStepIds
    });
    return {
      success: true,
      status: 'verified',
      verificationMethod: 'cryptographic_hash_receipt',
      proof: {
        hash,
        executedAt: new Date().toISOString(),
        idempotencyKey: context.idempotencyKey,
        verifiedDependencyStepIds,
        realEmailSent: false,
        externalAccountsContacted: false
      }
    };
  }

  async reconcile(context: ActionExecutionContext): Promise<ActionResult | null> {
    return this.execute(context);
  }
}

export class TestUnverifiedAdapter implements ActionAdapter {
  public readonly name = 'test.unverified_task';
  public readonly idempotencySupport: IdempotencySupport = 'none';

  async execute(context: ActionExecutionContext): Promise<ActionResult> {
    return {
      success: false,
      status: 'unverified',
      verificationMethod: 'none',
      proof: {
        reason: 'External system does not emit cryptographically verifiable receipt',
        idempotencyKey: context.idempotencyKey
      }
    };
  }
}

export class TestFailingAdapter implements ActionAdapter {
  public readonly name = 'test.failing_task';
  public readonly idempotencySupport: IdempotencySupport = 'native';

  async execute(context: ActionExecutionContext): Promise<ActionResult> {
    const errorMsg = (context.parameters.errorMessage as string) ?? 'Adapter simulated failure';
    return {
      success: false,
      status: 'failed',
      verificationMethod: 'error_acknowledgement',
      proof: { error: errorMsg, idempotencyKey: context.idempotencyKey },
      error: errorMsg
    };
  }
}

export class NotConfiguredTestAdapter implements ActionAdapter {
  public readonly name = 'test.not_configured_task';
  public readonly idempotencySupport: IdempotencySupport = 'none';

  async execute(_context: ActionExecutionContext): Promise<ActionResult> {
    return {
      success: false,
      status: 'not_configured',
      verificationMethod: 'configuration_check',
      proof: { message: 'Connector credentials have not been configured in workspace' },
      error: 'Connector not configured'
    };
  }
}

export class DisabledMcpAdapter implements ActionAdapter {
  public readonly name = 'connector.mcp.disabled_stub';
  public readonly idempotencySupport: IdempotencySupport = 'none';

  async execute(_context: ActionExecutionContext): Promise<ActionResult> {
    return {
      success: false,
      status: 'not_configured',
      verificationMethod: 'adapter_disabled_policy',
      proof: { message: 'MCP connector integration is disabled in Task 004' },
      error: 'MCP connector disabled'
    };
  }
}

export class DisabledN8nAdapter implements ActionAdapter {
  public readonly name = 'connector.n8n.disabled_stub';
  public readonly idempotencySupport: IdempotencySupport = 'none';

  async execute(_context: ActionExecutionContext): Promise<ActionResult> {
    return {
      success: false,
      status: 'not_configured',
      verificationMethod: 'adapter_disabled_policy',
      proof: { message: 'n8n workflow integration is disabled in Task 004' },
      error: 'n8n connector disabled'
    };
  }
}

import {
  ComposeEmailWorkflowAdapter,
  DryRunEmailWorkflowAdapter,
  StageEmailWorkflowArtifactAdapter
} from './email-automation.js';

import { N8nInactiveWorkflowAdapter,N8N_CREATE_ACTION } from './n8n.js';

export const defaultActionAdapters: Map<string, ActionAdapter> = new Map<string, ActionAdapter>([
  ['phone.ai.calls.request', {name:'phone.ai.calls.request',idempotencySupport:'none',async execute(){return {success:false,status:'not_configured',verificationMethod:'phone_calling_disabled',proof:{dialed:false,liveCallingEnabled:false},error:'Real calling is disabled. Approval cannot enable telephony.'};}}],
  [N8N_CREATE_ACTION, new N8nInactiveWorkflowAdapter()],
  ['test.deterministic_hash_task', new TestDeterministicHashAdapter()],
  ['test.approval_gated_hash_task', new TestApprovalGatedHashAdapter()],
  ['test.unverified_task', new TestUnverifiedAdapter()],
  ['test.failing_task', new TestFailingAdapter()],
  ['test.not_configured_task', new NotConfiguredTestAdapter()],
  ['connector.mcp.disabled_stub', new DisabledMcpAdapter()],
  ['connector.n8n.disabled_stub', new DisabledN8nAdapter()],
  ['automation.email.compose_workflow', new ComposeEmailWorkflowAdapter()],
  ['automation.email.dry_run_test', new DryRunEmailWorkflowAdapter()],
  ['automation.email.stage_workflow_artifact', new StageEmailWorkflowArtifactAdapter()]
]);
