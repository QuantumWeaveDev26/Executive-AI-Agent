import { describe, it, expect } from 'vitest';
import { RequestScope } from '@thaara/contracts';
import { PolicyGateway, defaultPolicyGateway, defaultTestAdapter } from '../src/index.js';

describe('Policy Gateway', () => {
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

  it('allows safe read actions for viewer role', () => {
    const result = defaultPolicyGateway.evaluate(viewerScope, {
      actionName: 'system.read_status',
      parameters: {}
    });

    expect(result.allowed).toBe(true);
    expect(result.status).toBe('ALLOWED');
  });

  it('rejects action when caller role is below required role', () => {
    // system.reset_connector requires 'admin', caller is 'viewer'
    const result = defaultPolicyGateway.evaluate(viewerScope, {
      actionName: 'system.reset_connector',
      parameters: {},
      idempotencyKey: 'idemp-key-123456'
    });

    expect(result.allowed).toBe(false);
    expect(result.status).toBe('REJECTED_UNAUTHORIZED');
  });

  it('rejects mutating action when required approval is missing', () => {
    // system.reset_connector requires explicit approval
    const result = defaultPolicyGateway.evaluate(adminScope, {
      actionName: 'system.reset_connector',
      parameters: {},
      idempotencyKey: 'idemp-key-123456'
    });

    expect(result.allowed).toBe(false);
    expect(result.status).toBe('REJECTED_APPROVAL_REQUIRED');
  });

  it('rejects mutating action when idempotency key is missing', () => {
    const result = defaultPolicyGateway.evaluate(adminScope, {
      actionName: 'system.reset_connector',
      parameters: {}
    });

    expect(result.allowed).toBe(false);
    expect(result.status).toBe('REJECTED_IDEMPOTENCY_REQUIRED');
  });

  it('allows mutating action when valid approved approval is provided', () => {
    const validApproval = {
      id: '44444444-4444-4444-4444-444444444444',
      workspaceId: adminScope.workspaceId,
      actionName: 'system.reset_connector',
      actionParams: {},
      requesterUserId: adminScope.userId,
      approverUserId: '55555555-5555-5555-5555-555555555555',
      status: 'approved' as const,
      riskLevel: 'high' as const,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const result = defaultPolicyGateway.evaluate(
      adminScope,
      {
        actionName: 'system.reset_connector',
        parameters: {},
        idempotencyKey: 'idemp-key-123456',
        approvalId: validApproval.id
      },
      validApproval
    );

    expect(result.allowed).toBe(true);
    expect(result.status).toBe('ALLOWED');
  });

  it('truthfully reports not_configured state from test adapter', async () => {
    const status = await defaultTestAdapter.getStatus();
    expect(status.status).toBe('not_configured');
    expect(status.connected).toBe(false);
    expect(status.configured).toBe(false);
    expect(status.lastVerifiedAt).toBeNull();
    await expect(defaultTestAdapter.execute('test', {})).rejects.toThrow(/truthful 'not_configured' state/);
  });
});
