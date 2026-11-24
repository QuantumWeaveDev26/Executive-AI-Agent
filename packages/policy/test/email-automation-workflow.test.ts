import { describe, it, expect } from 'vitest';
import { RequestScope, computeCanonicalParameterHash } from '@thaara/contracts';
import {
  defaultActionRegistry,
  defaultPolicyGateway,
  defaultActionAdapters,
  ComposeEmailWorkflowAdapter,
  DryRunEmailWorkflowAdapter,
  StageEmailWorkflowArtifactAdapter,
  computeEmailWorkflowHash,
  validateN8nWorkflowBlueprint
} from '../src/index.js';

describe('Phase 1A & Step 68: Safe Offline Email Automation Workflow Builder, Dry-Run Tester & Staging', () => {
  const viewerScope: RequestScope = {
    workspaceId: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    role: 'viewer'
  };

  const memberScope: RequestScope = {
    workspaceId: '11111111-1111-1111-1111-111111111111',
    userId: '33333333-3333-3333-3333-333333333333',
    role: 'member'
  };

  const baseContext = {
    workspaceId: '11111111-1111-1111-1111-111111111111',
    planId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    stepId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    idempotencyKey: 'step-exec:test-email-workflow'
  };

  const validComposeParams = {
    workflowName: 'New Client Inquiry Follow-Up',
    triggerType: 'new_lead_inquiry' as const,
    recipientVariable: 'recipient_email',
    emailSubject: 'Welcome to {{company_name}}, {{client_name}}!',
    emailBodyTemplate:
      'Hi {{client_name}},\n\nThank you for contacting {{company_name}} regarding {{inquiry_topic}}. We will follow up shortly.\n\nWarm regards,\nThaara Executive Desk',
    allowedVariables: ['recipient_email', 'client_name', 'company_name', 'inquiry_topic', 'lead_tier'],
    followUpConditions: [
      {
        field: 'lead_tier',
        operator: 'equals' as const,
        value: 'enterprise',
        delayMinutes: 15
      },
      {
        field: 'inquiry_topic',
        operator: 'exists' as const,
        delayMinutes: 0
      }
    ]
  };

  describe('1. Action Registry & Policy Gateway Enforcement', () => {
    it('registers automation.email.compose_workflow, automation.email.dry_run_test, and automation.email.stage_workflow_artifact in defaultActionRegistry and defaultActionAdapters', () => {
      const composeDef = defaultActionRegistry.get('automation.email.compose_workflow');
      const dryRunDef = defaultActionRegistry.get('automation.email.dry_run_test');
      const stageDef = defaultActionRegistry.get('automation.email.stage_workflow_artifact');

      expect(composeDef).toBeDefined();
      expect(composeDef!.actionClass).toBe('read');
      expect(composeDef!.risk).toBe('low');
      expect(composeDef!.approvalMode).toBe('none');
      expect(composeDef!.requiredRole).toBe('member');
      expect(composeDef!.capabilityScope).toBe('core_system');
      expect(composeDef!.schemaIdentifier).toBe('automation.email.compose_workflow.v1');

      expect(dryRunDef).toBeDefined();
      expect(dryRunDef!.actionClass).toBe('read');
      expect(dryRunDef!.risk).toBe('low');
      expect(dryRunDef!.approvalMode).toBe('none');
      expect(dryRunDef!.requiredRole).toBe('member');
      expect(dryRunDef!.capabilityScope).toBe('core_system');
      expect(dryRunDef!.schemaIdentifier).toBe('automation.email.dry_run_test.v1');

      expect(stageDef).toBeDefined();
      expect(stageDef!.actionClass).toBe('write');
      expect(stageDef!.risk).toBe('medium');
      expect(stageDef!.approvalMode).toBe('explicit');
      expect(stageDef!.requiredRole).toBe('member');
      expect(stageDef!.idempotencyRequired).toBe(true);
      expect(stageDef!.auditRequired).toBe(true);
      expect(stageDef!.capabilityScope).toBe('core_system');
      expect(stageDef!.schemaIdentifier).toBe('automation.email.stage_workflow_artifact.v1');

      expect(defaultActionAdapters.get('automation.email.compose_workflow')).toBeInstanceOf(
        ComposeEmailWorkflowAdapter
      );
      expect(defaultActionAdapters.get('automation.email.dry_run_test')).toBeInstanceOf(
        DryRunEmailWorkflowAdapter
      );
      expect(
        defaultActionAdapters.get('automation.email.stage_workflow_artifact')
      ).toBeInstanceOf(StageEmailWorkflowArtifactAdapter);
    });

    it('allows member role with valid parameters through PolicyGateway', () => {
      const composeEval = defaultPolicyGateway.evaluate(memberScope, {
        actionName: 'automation.email.compose_workflow',
        parameters: validComposeParams
      });
      expect(composeEval.allowed).toBe(true);
      expect(composeEval.status).toBe('ALLOWED');

      const dryRunEval = defaultPolicyGateway.evaluate(memberScope, {
        actionName: 'automation.email.dry_run_test',
        parameters: {
          ...validComposeParams,
          sampleData: {
            recipient_email: 'asha@bengalurutech.in',
            client_name: 'Asha',
            company_name: 'Quantum Weave Labs',
            inquiry_topic: 'Executive Automation',
            lead_tier: 'enterprise'
          }
        }
      });
      expect(dryRunEval.allowed).toBe(true);
      expect(dryRunEval.status).toBe('ALLOWED');
    });

    it('rejects viewer role with REJECTED_UNAUTHORIZED', () => {
      const res = defaultPolicyGateway.evaluate(viewerScope, {
        actionName: 'automation.email.compose_workflow',
        parameters: validComposeParams
      });
      expect(res.allowed).toBe(false);
      expect(res.status).toBe('REJECTED_UNAUTHORIZED');

      const stageViewerRes = defaultPolicyGateway.evaluate(viewerScope, {
        actionName: 'automation.email.stage_workflow_artifact',
        parameters: validComposeParams,
        idempotencyKey: 'stage-idemp-viewer-1'
      });
      expect(stageViewerRes.allowed).toBe(false);
      expect(stageViewerRes.status).toBe('REJECTED_UNAUTHORIZED');
    });

    it('rejects invalid input schemas at Gate 1 (unsupported triggerType, unsafe variable names, extraneous properties)', () => {
      const badTrigger = defaultPolicyGateway.evaluate(memberScope, {
        actionName: 'automation.email.compose_workflow',
        parameters: {
          ...validComposeParams,
          triggerType: 'arbitrary_shell_trigger'
        }
      });
      expect(badTrigger.allowed).toBe(false);
      expect(badTrigger.status).toBe('REJECTED_INVALID_PARAMETERS');

      const badVarIdentifier = defaultPolicyGateway.evaluate(memberScope, {
        actionName: 'automation.email.compose_workflow',
        parameters: {
          ...validComposeParams,
          allowedVariables: ['valid_var', 'invalid-var-with-hyphens;rm -rf']
        }
      });
      expect(badVarIdentifier.allowed).toBe(false);
      expect(badVarIdentifier.status).toBe('REJECTED_INVALID_PARAMETERS');

      const extraProp = defaultPolicyGateway.evaluate(memberScope, {
        actionName: 'automation.email.compose_workflow',
        parameters: {
          ...validComposeParams,
          autoSendLiveEmails: true
        }
      });
      expect(extraProp.allowed).toBe(false);
      expect(extraProp.status).toBe('REJECTED_INVALID_PARAMETERS');
    });
  });

  describe('2. ComposeEmailWorkflowAdapter (automation.email.compose_workflow)', () => {
    const adapter = new ComposeEmailWorkflowAdapter();

    it('generates a verified, deterministic workflow definition and offline-validated n8n blueprint with truthful telemetry', async () => {
      const result = await adapter.execute({
        ...baseContext,
        parameters: validComposeParams
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('verified');
      expect(result.verificationMethod).toBe('offline_workflow_schema_validation');

      const proof = result.proof as Record<string, any>;
      expect(proof.workflowGenerated).toBe(true);
      expect(proof.realEmailSent).toBe(false);
      expect(proof.externalDeploymentStatus).toBe('not_configured');
      expect(proof.externalAccountsContacted).toBe(false);

      expect(proof.n8nValidation).toEqual({
        offlineSchemaValid: true,
        graphIntegrityValid: true,
        externallyVerifiedWithLiveN8n: false,
        importReadiness: 'offline_schema_validated_not_live_verified'
      });

      const def = proof.workflowDefinition;
      expect(def.schemaVersion).toBe('thaara.email_automation.v1');
      expect(def.workflowName).toBe('New Client Inquiry Follow-Up');
      expect(def.referencedVariables).toEqual(['company_name', 'client_name', 'inquiry_topic']);
      expect(def.n8nBlueprint.active).toBe(false);
      expect(def.n8nBlueprint.meta.importReadiness).toBe(
        'offline_schema_validated_not_live_verified'
      );
      expect(def.n8nBlueprint.meta.externallyVerifiedWithLiveN8n).toBe(false);
      expect(def.n8nBlueprint.nodes.length).toBe(5); // Trigger + Wait_1 + Condition_1 + Condition_2 + Compose_Email_Draft_Payload
    });

    it('fails truthfully when template references undeclared variables not in allowedVariables', async () => {
      const result = await adapter.execute({
        ...baseContext,
        parameters: {
          ...validComposeParams,
          emailBodyTemplate: 'Hello {{client_name}}, your secret discount code is {{undeclared_discount}}!'
        }
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.error).toContain('undeclared_discount');
      expect(result.proof.workflowGenerated).toBe(false);
      expect(result.proof.realEmailSent).toBe(false);
      expect(result.proof.externalDeploymentStatus).toBe('not_configured');
    });

    it('rejects dangerous script/code injection or expression tags inside templates', async () => {
      const scriptAttempt = await adapter.execute({
        ...baseContext,
        parameters: {
          ...validComposeParams,
          emailBodyTemplate: 'Hi {{client_name}} <script>alert(1)</script>'
        }
      });
      expect(scriptAttempt.success).toBe(false);
      expect(scriptAttempt.status).toBe('failed');
      expect(scriptAttempt.error).toContain('<script>');

      const expressionAttempt = await adapter.execute({
        ...baseContext,
        parameters: {
          ...validComposeParams,
          emailBodyTemplate: 'Hi {{ $json.exec("whoami") }}'
        }
      });
      expect(expressionAttempt.success).toBe(false);
      expect(expressionAttempt.status).toBe('failed');
      expect(expressionAttempt.error).toContain('Invalid or unsafe template expression');
    });

    it('validates n8n blueprint structure and rejects active=true, unsupported nodes, or broken connections', () => {
      const brokenBlueprint = {
        name: 'Broken Workflow',
        active: true, // forbidden in Phase 1A
        versionId: 'v1-test',
        nodes: [
          {
            id: '1',
            name: 'Trigger',
            type: 'n8n-nodes-base.executeCommand', // forbidden node type
            typeVersion: 1,
            position: [0, 0],
            parameters: {}
          }
        ],
        connections: {},
        settings: { executionOrder: 'v1', saveManualExecutions: true },
        meta: {
          generatedBy: 'thaara-v2-offline-workflow-builder',
          importReadiness: 'offline_schema_validated_not_live_verified',
          externallyVerifiedWithLiveN8n: false
        }
      };

      const check = validateN8nWorkflowBlueprint(brokenBlueprint);
      expect(check.valid).toBe(false);
      expect(check.offlineSchemaValid).toBe(false);
    });
  });

  describe('3. DryRunEmailWorkflowAdapter (automation.email.dry_run_test)', () => {
    const dryRunAdapter = new DryRunEmailWorkflowAdapter();

    it('executes a safe offline dry run, renders subject and body, evaluates conditions, and reports truthful flags', async () => {
      const result = await dryRunAdapter.execute({
        ...baseContext,
        parameters: {
          ...validComposeParams,
          sampleData: {
            recipient_email: 'rohan@indiranagar.io',
            client_name: 'Rohan',
            company_name: 'Thaara Studio',
            inquiry_topic: 'Q4 Workflow Automation',
            lead_tier: 'enterprise'
          }
        }
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('verified');
      expect(result.verificationMethod).toBe('offline_sandbox_dry_run');

      const report = (result.proof as Record<string, any>).dryRunReport;
      expect(report.dryRunPassed).toBe(true);
      expect(report.missingVariables).toEqual([]);
      expect(report.undeclaredVariables).toEqual([]);
      expect(report.securityViolations).toEqual([]);
      expect(report.conditionsSatisfied).toBe(true);
      expect(report.realEmailSent).toBe(false);
      expect(report.externalDeploymentStatus).toBe('not_configured');
      expect(report.externalAccountsContacted).toBe(false);

      expect(report.renderedPreview).toEqual({
        recipient: 'rohan@indiranagar.io',
        subject: 'Welcome to Thaara Studio, Rohan!',
        body: 'Hi Rohan,\n\nThank you for contacting Thaara Studio regarding Q4 Workflow Automation. We will follow up shortly.\n\nWarm regards,\nThaara Executive Desk',
        totalDelayMinutes: 15
      });
    });

    it('fails truthfully when required sample variables are missing from sampleData', async () => {
      const result = await dryRunAdapter.execute({
        ...baseContext,
        parameters: {
          ...validComposeParams,
          sampleData: {
            recipient_email: 'rohan@indiranagar.io',
            client_name: 'Rohan'
            // missing company_name, inquiry_topic, lead_tier
          }
        }
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.error).toContain('Missing sample data for variables');

      const report = (result.proof as Record<string, any>).dryRunReport;
      expect(report.dryRunPassed).toBe(false);
      expect(report.missingVariables).toContain('company_name');
      expect(report.missingVariables).toContain('inquiry_topic');
      expect(report.missingVariables).toContain('lead_tier');
      expect(report.renderedPreview).toBeNull();
      expect(report.realEmailSent).toBe(false);
      expect(report.externalDeploymentStatus).toBe('not_configured');
    });

    it('fails truthfully when sample recipient email format is invalid or sampleData contains injection payloads', async () => {
      const badEmailRes = await dryRunAdapter.execute({
        ...baseContext,
        parameters: {
          ...validComposeParams,
          sampleData: {
            recipient_email: 'not-an-email-address',
            client_name: 'Rohan',
            company_name: 'Thaara Studio',
            inquiry_topic: 'Automation',
            lead_tier: 'enterprise'
          }
        }
      });

      expect(badEmailRes.success).toBe(false);
      expect(badEmailRes.status).toBe('failed');
      expect(badEmailRes.error).toContain('not a valid email address format');

      const injectionRes = await dryRunAdapter.execute({
        ...baseContext,
        parameters: {
          ...validComposeParams,
          sampleData: {
            recipient_email: 'rohan@indiranagar.io',
            client_name: '<script>stealCookies()</script>',
            company_name: 'Thaara Studio',
            inquiry_topic: 'Automation',
            lead_tier: 'enterprise'
          }
        }
      });

      expect(injectionRes.success).toBe(false);
      expect(injectionRes.status).toBe('failed');
      expect(injectionRes.error).toContain('<script>');
    });
  });

  describe('4. StageEmailWorkflowArtifactAdapter (automation.email.stage_workflow_artifact)', () => {
    const composeAdapter = new ComposeEmailWorkflowAdapter();
    const dryRunAdapter = new DryRunEmailWorkflowAdapter();
    const stageAdapter = new StageEmailWorkflowArtifactAdapter();

    it('enforces explicit approval and idempotency in PolicyGateway and stages an inactive offline workflow artifact only after verified compose and dry-run proofs match expectedWorkflowHash', async () => {
      const expectedWorkflowHash = computeEmailWorkflowHash(
        baseContext.workspaceId,
        validComposeParams
      );
      const stageParams = {
        ...validComposeParams,
        expectedWorkflowHash
      };

      // 1. PolicyGateway requires explicit approval
      const unapprovedEval = defaultPolicyGateway.evaluate(memberScope, {
        actionName: 'automation.email.stage_workflow_artifact',
        parameters: stageParams,
        idempotencyKey: 'step-exec:stage-1'
      });
      expect(unapprovedEval.allowed).toBe(false);
      expect(unapprovedEval.status).toBe('REJECTED_APPROVAL_REQUIRED');

      const approvalId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
      const approvedEval = defaultPolicyGateway.evaluate(
        memberScope,
        {
          actionName: 'automation.email.stage_workflow_artifact',
          parameters: stageParams,
          approvalId,
          idempotencyKey: 'step-exec:stage-1'
        },
        {
          id: approvalId,
          workspaceId: baseContext.workspaceId,
          actionName: 'automation.email.stage_workflow_artifact',
          actionParams: stageParams,
          parameterHash: computeCanonicalParameterHash(stageParams),
          requesterUserId: memberScope.userId,
          approverUserId: '99999999-9999-9999-9999-999999999999',
          status: 'approved',
          riskLevel: 'medium',
          expiresAt: new Date(Date.now() + 3600_000)
        }
      );
      expect(approvedEval.allowed).toBe(true);
      expect(approvedEval.status).toBe('ALLOWED');

      // 2. Execute upstream compose and dry-run to produce verified dependency proofs
      const composeRes = await composeAdapter.execute({
        ...baseContext,
        stepId: 'step-0-compose',
        parameters: validComposeParams
      });
      const dryRunRes = await dryRunAdapter.execute({
        ...baseContext,
        stepId: 'step-1-dryrun',
        parameters: {
          ...validComposeParams,
          sampleData: {
            recipient_email: 'rohan@indiranagar.io',
            client_name: 'Rohan',
            company_name: 'Thaara Studio',
            inquiry_topic: 'Q4 Workflow Automation',
            lead_tier: 'enterprise'
          }
        }
      });

      // 3. Stage the offline workflow artifact with both verified dependency proofs
      const stageRes = await stageAdapter.execute({
        ...baseContext,
        stepId: 'step-2-stage',
        parameters: stageParams,
        dependencyProofs: {
          'step-0-compose': composeRes.proof!,
          'step-1-dryrun': dryRunRes.proof!
        }
      });

      expect(stageRes.success).toBe(true);
      expect(stageRes.status).toBe('verified');
      expect(stageRes.verificationMethod).toBe('offline_workflow_artifact_staging');

      const proof = stageRes.proof as Record<string, any>;
      expect(proof.workflowStaged).toBe(true);
      expect(proof.workflowHash).toBe(expectedWorkflowHash);
      expect(proof.dryRunHash).toBe(dryRunRes.proof!.dryRunHash);
      expect(proof.artifactId).toBe(`stg_${expectedWorkflowHash.slice(0, 16)}`);
      expect(proof.realEmailSent).toBe(false);
      expect(proof.externalDeploymentStatus).toBe('not_configured');
      expect(proof.externalAccountsContacted).toBe(false);
      expect(proof.stagedArtifact.stagingStatus).toBe('staged_offline_inactive');
      expect(proof.stagedArtifact.active).toBe(false);
      expect(proof.stagedArtifact.workflowDefinition.n8nBlueprint.active).toBe(false);
    });

    it('fails closed when expectedWorkflowHash mismatches or verified compose/dry-run dependency proofs are missing or mismatched', async () => {
      const composeRes = await composeAdapter.execute({
        ...baseContext,
        parameters: validComposeParams
      });
      const dryRunRes = await dryRunAdapter.execute({
        ...baseContext,
        parameters: {
          ...validComposeParams,
          sampleData: {
            recipient_email: 'rohan@indiranagar.io',
            client_name: 'Rohan',
            company_name: 'Thaara Studio',
            inquiry_topic: 'Q4 Workflow Automation',
            lead_tier: 'enterprise'
          }
        }
      });

      // 1. Mismatched expectedWorkflowHash
      const hashMismatchRes = await stageAdapter.execute({
        ...baseContext,
        parameters: {
          ...validComposeParams,
          expectedWorkflowHash: '0'.repeat(64)
        },
        dependencyProofs: {
          'step-0-compose': composeRes.proof!,
          'step-1-dryrun': dryRunRes.proof!
        }
      });
      expect(hashMismatchRes.success).toBe(false);
      expect(hashMismatchRes.status).toBe('failed');
      expect(hashMismatchRes.error).toContain('Workflow hash mismatch');
      expect(hashMismatchRes.proof!.workflowStaged).toBe(false);

      // 2. Missing dry-run dependency proof
      const missingDepRes = await stageAdapter.execute({
        ...baseContext,
        parameters: validComposeParams,
        dependencyProofs: {
          'step-0-compose': composeRes.proof!
        }
      });
      expect(missingDepRes.success).toBe(false);
      expect(missingDepRes.status).toBe('failed');
      expect(missingDepRes.error).toContain(
        'Staging requires both verified compose and verified dry-run dependency proofs'
      );

      // 3. Tampered upstream dependency workflowHash
      const tamperedDepRes = await stageAdapter.execute({
        ...baseContext,
        parameters: validComposeParams,
        dependencyProofs: {
          'step-0-compose': composeRes.proof!,
          'step-1-dryrun': { ...dryRunRes.proof!, workflowHash: 'f'.repeat(64) }
        }
      });
      expect(tamperedDepRes.success).toBe(false);
      expect(tamperedDepRes.status).toBe('failed');
      expect(tamperedDepRes.error).toContain('Upstream dependency workflowHash mismatch');
    });
  });
});
