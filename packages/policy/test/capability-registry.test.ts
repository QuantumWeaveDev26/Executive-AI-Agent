import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  RequestScope,
  ActionMetadataSchema,
  CapabilityScopeSchema
} from '@thaara/contracts';
import {
  ActionRegistry,
  defaultActionRegistry,
  PolicyGateway,
  defaultPolicyGateway,
  defaultActionAdapters,
  DisabledMcpAdapter,
  DisabledN8nAdapter
} from '../src/index.js';

describe('Task 004 Phase A: Typed Capability Registry & Gate 1 Parameter Validation', () => {
  const viewerScope: RequestScope = {
    workspaceId: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    role: 'viewer'
  };

  const adminScope: RequestScope = {
    workspaceId: '11111111-1111-1111-1111-111111111111',
    userId: '33333333-3333-3333-3333-333333333333',
    role: 'admin'
  };

  describe('1. Valid Parameters (Gate 1 Pass)', () => {
    it('allows system.read_status with empty object parameters', () => {
      const result = defaultPolicyGateway.evaluate(viewerScope, {
        actionName: 'system.read_status',
        parameters: {}
      });

      expect(result.allowed).toBe(true);
      expect(result.status).toBe('ALLOWED');
    });

    it('allows system.reset_connector with optional connectorName parameter', () => {
      const result = defaultPolicyGateway.evaluate(adminScope, {
        actionName: 'system.reset_connector',
        parameters: { connectorName: 'salesforce' },
        idempotencyKey: 'idemp-key-123456'
      });

      // Valid parameters proceed past Gate 1 to Gate 3 (Approval check)
      expect(result.status).toBe('REJECTED_APPROVAL_REQUIRED');
      expect(result.allowed).toBe(false);
    });

    it('allows system.reset_connector with empty parameters ({})', () => {
      const result = defaultPolicyGateway.evaluate(adminScope, {
        actionName: 'system.reset_connector',
        parameters: {},
        idempotencyKey: 'idemp-key-123456'
      });

      // Valid parameters proceed past Gate 1 to Gate 3 (Approval check)
      expect(result.status).toBe('REJECTED_APPROVAL_REQUIRED');
      expect(result.allowed).toBe(false);
    });

    it('allows workspace.delete_data with optional confirmation parameter', () => {
      const result = defaultPolicyGateway.evaluate(adminScope, {
        actionName: 'workspace.delete_data',
        parameters: { confirmation: 'CONFIRM' },
        idempotencyKey: 'idemp-key-123456'
      });

      // Role check or approval check occurs, NOT parameter rejection
      expect(result.status).not.toBe('REJECTED_INVALID_PARAMETERS');
    });

    it('allows custom action with typed parameter schema when parameters are valid', () => {
      const customRegistry = new ActionRegistry();
      customRegistry.register({
        metadata: {
          name: 'inventory.adjust_stock',
          actionClass: 'write',
          risk: 'medium',
          approvalMode: 'none',
          idempotencyRequired: true,
          timeoutMs: 5000,
          retryPolicy: { maxRetries: 2, backoffMs: 100, exponential: false },
          requiredRole: 'admin',
          auditRequired: true,
          capabilityScope: 'core_system',
          schemaIdentifier: 'inventory.adjust_stock.v1'
        },
        inputSchema: Type.Object({
          sku: Type.String({ minLength: 3 }),
          delta: Type.Integer({ minimum: -100, maximum: 100 })
        }, { additionalProperties: false })
      });

      const gateway = new PolicyGateway({ registry: customRegistry });
      const result = gateway.evaluate(adminScope, {
        actionName: 'inventory.adjust_stock',
        parameters: { sku: 'ITEM-001', delta: 5 },
        idempotencyKey: 'idemp-key-123456'
      });

      expect(result.allowed).toBe(true);
      expect(result.status).toBe('ALLOWED');
    });
  });

  describe('2. Invalid Parameters (Gate 1 Rejection: REJECTED_INVALID_PARAMETERS)', () => {
    it('rejects system.read_status when extraneous parameters are provided (additionalProperties: false)', () => {
      const result = defaultPolicyGateway.evaluate(viewerScope, {
        actionName: 'system.read_status',
        parameters: { unexpectedKey: 'malicious_input' }
      });

      expect(result.allowed).toBe(false);
      expect(result.status).toBe('REJECTED_INVALID_PARAMETERS');
      expect(result.reason).toContain('violate typed input schema');
    });

    it('rejects system.reset_connector when connectorName is empty string (minLength: 1)', () => {
      const result = defaultPolicyGateway.evaluate(adminScope, {
        actionName: 'system.reset_connector',
        parameters: { connectorName: '' },
        idempotencyKey: 'idemp-key-123456'
      });

      expect(result.allowed).toBe(false);
      expect(result.status).toBe('REJECTED_INVALID_PARAMETERS');
    });

    it('rejects system.reset_connector when connectorName has wrong type', () => {
      const result = defaultPolicyGateway.evaluate(adminScope, {
        actionName: 'system.reset_connector',
        parameters: { connectorName: 12345 },
        idempotencyKey: 'idemp-key-123456'
      });

      expect(result.allowed).toBe(false);
      expect(result.status).toBe('REJECTED_INVALID_PARAMETERS');
    });

    it('rejects workspace.delete_data when unexpected parameters are injected', () => {
      const result = defaultPolicyGateway.evaluate(adminScope, {
        actionName: 'workspace.delete_data',
        parameters: { confirmation: 'CONFIRM', extraPayload: true },
        idempotencyKey: 'idemp-key-123456'
      });

      expect(result.allowed).toBe(false);
      expect(result.status).toBe('REJECTED_INVALID_PARAMETERS');
    });

    it('rejects custom action when parameter violates numeric bounds', () => {
      const customRegistry = new ActionRegistry();
      customRegistry.register({
        metadata: {
          name: 'inventory.adjust_stock',
          actionClass: 'write',
          risk: 'medium',
          approvalMode: 'none',
          idempotencyRequired: true,
          timeoutMs: 5000,
          retryPolicy: { maxRetries: 2, backoffMs: 100, exponential: false },
          requiredRole: 'admin',
          auditRequired: true,
          capabilityScope: 'core_system'
        },
        inputSchema: Type.Object({
          sku: Type.String({ minLength: 3 }),
          delta: Type.Integer({ minimum: -100, maximum: 100 })
        }, { additionalProperties: false })
      });

      const gateway = new PolicyGateway({ registry: customRegistry });
      const result = gateway.evaluate(adminScope, {
        actionName: 'inventory.adjust_stock',
        parameters: { sku: 'ITEM-001', delta: 999 }, // exceeds maximum: 100
        idempotencyKey: 'idemp-key-123456'
      });

      expect(result.allowed).toBe(false);
      expect(result.status).toBe('REJECTED_INVALID_PARAMETERS');
    });
  });

  describe('3. Unknown Actions (Gate 1 Rejection: REJECTED_INVALID_ACTION)', () => {
    it('rejects non-existent action with REJECTED_INVALID_ACTION', () => {
      const result = defaultPolicyGateway.evaluate(viewerScope, {
        actionName: 'unregistered.arbitrary_command',
        parameters: {}
      });

      expect(result.allowed).toBe(false);
      expect(result.status).toBe('REJECTED_INVALID_ACTION');
      expect(result.reason).toContain('is not registered in the policy catalog');
    });
  });

  describe('4. Metadata Serialization & Contract Integrity', () => {
    it('serializes ActionMetadata cleanly without raw TypeBox objects or functions', () => {
      const actions = defaultActionRegistry.list();
      expect(actions.length).toBeGreaterThanOrEqual(9);

      for (const action of actions) {
        // action.metadata should be plain serializable data
        const serialized = JSON.stringify(action.metadata);
        expect(serialized).not.toContain('compiledCheck');
        expect(serialized).not.toContain('validate');
        expect(serialized).not.toContain('inputSchema');

        const parsed = JSON.parse(serialized);
        expect(Value.Check(ActionMetadataSchema, parsed)).toBe(true);
        expect(Value.Check(CapabilityScopeSchema, parsed.capabilityScope)).toBe(true);
        expect(parsed.schemaIdentifier).toBeDefined();
        expect(parsed.schemaIdentifier.length).toBeGreaterThan(0);
      }
    });

    it('ensures action definitions expose both metadata sub-object and direct accessors', () => {
      const readAction = defaultActionRegistry.get('system.read_status')!;
      expect(readAction).toBeDefined();
      expect(readAction.name).toBe('system.read_status');
      expect(readAction.metadata.name).toBe('system.read_status');
      expect(readAction.capabilityScope).toBe('core_system');
      expect(readAction.schemaIdentifier).toBe('system.read_status.v1');
      expect(typeof readAction.validate).toBe('function');
      expect(readAction.validate({})).toBe(true);
      expect(readAction.validate({ unexpected: 1 })).toBe(false);
    });
  });

  describe('5. Disabled MCP and n8n Capability Declarations & Stubs', () => {
    it('registers connector.mcp.disabled_stub as external_connector with strict empty schema', () => {
      const mcpAction = defaultActionRegistry.get('connector.mcp.disabled_stub')!;
      expect(mcpAction).toBeDefined();
      expect(mcpAction.capabilityScope).toBe('external_connector');
      expect(mcpAction.schemaIdentifier).toBe('connector.mcp.disabled_stub.v1');
      expect(mcpAction.actionClass).toBe('write');
      expect(mcpAction.risk).toBe('high');
      expect(mcpAction.approvalMode).toBe('explicit');

      // Empty schema validates {}
      expect(mcpAction.validate({})).toBe(true);
      // Rejects arbitrary parameters
      expect(mcpAction.validate({ toolName: 'test', params: {} })).toBe(false);
    });

    it('registers connector.n8n.disabled_stub as external_connector with strict empty schema', () => {
      const n8nAction = defaultActionRegistry.get('connector.n8n.disabled_stub')!;
      expect(n8nAction).toBeDefined();
      expect(n8nAction.capabilityScope).toBe('external_connector');
      expect(n8nAction.schemaIdentifier).toBe('connector.n8n.disabled_stub.v1');
      expect(n8nAction.actionClass).toBe('write');

      expect(n8nAction.validate({})).toBe(true);
      expect(n8nAction.validate({ workflowId: '123' })).toBe(false);
    });

    it('truthfully reports not_configured state from DisabledMcpAdapter', async () => {
      const adapter = defaultActionAdapters.get('connector.mcp.disabled_stub');
      expect(adapter).toBeDefined();
      expect(adapter).toBeInstanceOf(DisabledMcpAdapter);

      const result = await adapter!.execute({
        workspaceId: '11111111-1111-1111-1111-111111111111',
        planId: '22222222-2222-2222-2222-222222222222',
        stepId: '33333333-3333-3333-3333-333333333333',
        idempotencyKey: 'idemp-12345',
        parameters: {}
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('not_configured');
      expect(result.verificationMethod).toBe('adapter_disabled_policy');
      expect(result.error).toContain('MCP connector disabled');
    });

    it('truthfully reports not_configured state from DisabledN8nAdapter', async () => {
      const adapter = defaultActionAdapters.get('connector.n8n.disabled_stub');
      expect(adapter).toBeDefined();
      expect(adapter).toBeInstanceOf(DisabledN8nAdapter);

      const result = await adapter!.execute({
        workspaceId: '11111111-1111-1111-1111-111111111111',
        planId: '22222222-2222-2222-2222-222222222222',
        stepId: '33333333-3333-3333-3333-333333333333',
        idempotencyKey: 'idemp-12345',
        parameters: {}
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('not_configured');
      expect(result.verificationMethod).toBe('adapter_disabled_policy');
      expect(result.error).toContain('n8n connector disabled');
    });
  });

  describe('6. Task 001–003 Compatibility', () => {
    it('allows registering flat actions without inputSchema when capabilityScope is explicitly declared', () => {
      const customRegistry = new ActionRegistry();
      const legacyAction = customRegistry.register({
        name: 'legacy.test_action',
        actionClass: 'read',
        risk: 'low',
        approvalMode: 'none',
        idempotencyRequired: false,
        timeoutMs: 5000,
        retryPolicy: { maxRetries: 1, backoffMs: 100, exponential: false },
        requiredRole: 'viewer',
        auditRequired: false,
        capabilityScope: 'core_system'
      });

      expect(legacyAction.name).toBe('legacy.test_action');
      expect(legacyAction.capabilityScope).toBe('core_system');
      expect(legacyAction.schemaIdentifier).toBe('legacy.test_action.v1');
      expect(legacyAction.validate({ anyKey: 'anyValue', numeric: 42 })).toBe(true);
    });

    it('preserves all default test actions required by Task 002 & Task 003 suites', () => {
      const expectedActions = [
        'system.read_status',
        'system.reset_connector',
        'workspace.delete_data',
        'test.deterministic_hash_task',
        'test.unverified_task',
        'test.failing_task',
        'test.not_configured_task',
        'connector.mcp.disabled_stub',
        'connector.n8n.disabled_stub'
      ];

      for (const name of expectedActions) {
        expect(defaultActionRegistry.has(name)).toBe(true);
      }
    });
  });

  describe('7. Mandatory Explicit Capability Scope Enforcement', () => {
    it('rejects registration at runtime when capabilityScope is missing (structured registration)', () => {
      const customRegistry = new ActionRegistry();
      expect(() => {
        customRegistry.register({
          metadata: {
            name: 'test.missing_scope',
            actionClass: 'read',
            risk: 'low',
            approvalMode: 'none',
            idempotencyRequired: false,
            timeoutMs: 5000,
            retryPolicy: { maxRetries: 1, backoffMs: 100, exponential: false },
            requiredRole: 'viewer',
            auditRequired: false
          } as any
        });
      }).toThrow(/must explicitly provide a valid capabilityScope/);
    });

    it('rejects registration at runtime when capabilityScope is missing (flat registration)', () => {
      const customRegistry = new ActionRegistry();
      expect(() => {
        customRegistry.register({
          name: 'test.missing_scope_flat',
          actionClass: 'read',
          risk: 'low',
          approvalMode: 'none',
          idempotencyRequired: false,
          timeoutMs: 5000,
          retryPolicy: { maxRetries: 1, backoffMs: 100, exponential: false },
          requiredRole: 'viewer',
          auditRequired: false
        } as any);
      }).toThrow(/must explicitly provide a valid capabilityScope/);
    });

    it('rejects registration at runtime when capabilityScope is invalid', () => {
      const customRegistry = new ActionRegistry();
      expect(() => {
        customRegistry.register({
          metadata: {
            name: 'test.invalid_scope',
            actionClass: 'read',
            risk: 'low',
            approvalMode: 'none',
            idempotencyRequired: false,
            timeoutMs: 5000,
            retryPolicy: { maxRetries: 1, backoffMs: 100, exponential: false },
            requiredRole: 'viewer',
            auditRequired: false,
            capabilityScope: 'unsupported_scope' as any
          }
        });
      }).toThrow(/must explicitly provide a valid capabilityScope \('core_system' \| 'external_connector'\)\. Received: 'unsupported_scope'/);
    });

    it('allows core_system registration only when explicitly declared', () => {
      const customRegistry = new ActionRegistry();
      const action = customRegistry.register({
        name: 'custom.core_action',
        actionClass: 'read',
        risk: 'low',
        approvalMode: 'none',
        idempotencyRequired: false,
        timeoutMs: 5000,
        retryPolicy: { maxRetries: 1, backoffMs: 100, exponential: false },
        requiredRole: 'viewer',
        auditRequired: false,
        capabilityScope: 'core_system'
      });

      expect(action.capabilityScope).toBe('core_system');
      expect(action.metadata.capabilityScope).toBe('core_system');
    });

    it('allows external_connector registration only when explicitly declared', () => {
      const customRegistry = new ActionRegistry();
      const action = customRegistry.register({
        metadata: {
          name: 'custom.connector_action',
          actionClass: 'write',
          risk: 'high',
          approvalMode: 'explicit',
          idempotencyRequired: true,
          timeoutMs: 10000,
          retryPolicy: { maxRetries: 2, backoffMs: 500, exponential: true },
          requiredRole: 'admin',
          auditRequired: true,
          capabilityScope: 'external_connector'
        },
        inputSchema: Type.Object({ endpoint: Type.String() }, { additionalProperties: false })
      });

      expect(action.capabilityScope).toBe('external_connector');
      expect(action.metadata.capabilityScope).toBe('external_connector');
    });

    it('ensures every registered action serialized metadata contains a valid capabilityScope', () => {
      const actions = defaultActionRegistry.list();
      expect(actions.length).toBeGreaterThanOrEqual(9);

      for (const action of actions) {
        const serialized = JSON.stringify(action.metadata);
        const parsed = JSON.parse(serialized);
        expect(parsed.capabilityScope).toBeDefined();
        expect(['core_system', 'external_connector']).toContain(parsed.capabilityScope);
        expect(Value.Check(CapabilityScopeSchema, parsed.capabilityScope)).toBe(true);
      }
    });
  });
});
