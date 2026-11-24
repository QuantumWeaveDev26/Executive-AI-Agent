import { TypeCompiler } from '@sinclair/typebox/compiler';
import {
  ComposeEmailWorkflowInput,
  ComposeEmailWorkflowInputSchema,
  DryRunConditionEvaluation,
  DryRunEmailWorkflowInput,
  DryRunEmailWorkflowInputSchema,
  EmailAutomationWorkflowDefinition,
  EmailAutomationWorkflowDefinitionSchema,
  EmailFollowUpCondition,
  EmailWorkflowDryRunReport,
  EmailWorkflowDryRunReportSchema,
  N8nWorkflowBlueprint,
  N8nWorkflowBlueprintSchema,
  N8nWorkflowNode,
  StageEmailWorkflowArtifactInput,
  StageEmailWorkflowArtifactInputSchema,
  StagedEmailWorkflowArtifact,
  StagedEmailWorkflowArtifactSchema,
  computeCanonicalParameterHash
} from '@thaara/contracts';
import { ActionAdapter, ActionExecutionContext, ActionResult, IdempotencySupport } from './adapter.js';

/**
 * Step 64B Multi-Step Governance Note:
 * `apps/api/src/routes/plans.ts`, `apps/api/src/routes/approvals.ts`, and `apps/worker/src/processor.ts`
 * coordinate dependency satisfaction and approval bindings so downstream approval-gated steps only
 * transition to `'queued'` after both upstream steps are `'verified'` and the bound approval is `'approved'`.
 */

const ComposeInputValidator = TypeCompiler.Compile(ComposeEmailWorkflowInputSchema);
const DryRunInputValidator = TypeCompiler.Compile(DryRunEmailWorkflowInputSchema);
const StageInputValidator = TypeCompiler.Compile(StageEmailWorkflowArtifactInputSchema);
const N8nBlueprintValidator = TypeCompiler.Compile(N8nWorkflowBlueprintSchema);
const WorkflowDefinitionValidator = TypeCompiler.Compile(EmailAutomationWorkflowDefinitionSchema);
const DryRunReportValidator = TypeCompiler.Compile(EmailWorkflowDryRunReportSchema);
const StagedArtifactValidator = TypeCompiler.Compile(StagedEmailWorkflowArtifactSchema);

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /<\s*script\b/i, reason: 'HTML <script> tags are forbidden in email templates.' },
  { pattern: /javascript\s*:/i, reason: 'javascript: URLs are forbidden in email templates.' },
  { pattern: /\beval\s*\(/i, reason: 'Arbitrary code evaluation (eval) is forbidden.' },
  { pattern: /\bnew\s+Function\b|\bFunction\s*\(/i, reason: 'Dynamic Function constructors are forbidden.' },
  { pattern: /\bchild_process\b|\bexecSync\b|\bspawnSync\b/i, reason: 'Process execution primitives are forbidden.' },
  { pattern: /\bprocess\.env\b/i, reason: 'Environment variable access (process.env) is forbidden.' },
  { pattern: /__proto__|prototype|constructor/i, reason: 'Prototype pollution tokens (__proto__, prototype, constructor) are forbidden.' },
  { pattern: /\$\([^)]+\)/, reason: 'Shell command substitution $(...) is forbidden.' }
];

const SAFE_VARIABLE_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Scans strings for dangerous code/script injection patterns and invalid mustache expressions.
 */
export function detectWorkflowSecurityViolations(texts: string[]): string[] {
  const violations: string[] = [];

  for (const text of texts) {
    for (const rule of DANGEROUS_PATTERNS) {
      if (rule.pattern.test(text) && !violations.includes(rule.reason)) {
        violations.push(rule.reason);
      }
    }

    // Inspect all {{...}} mustache blocks to forbid expressions (e.g. {{ $json.exec() }} or {{ a + b }})
    const rawMatches = text.matchAll(/\{\{([\s\S]*?)\}\}/g);
    for (const match of rawMatches) {
      const inner = (match[1] ?? '').trim();
      if (!SAFE_VARIABLE_REGEX.test(inner)) {
        const msg = `Invalid or unsafe template expression '{{${inner}}}'. Only simple variable identifiers matching /^[a-zA-Z_][a-zA-Z0-9_]*$/ are permitted.`;
        if (!violations.includes(msg)) {
          violations.push(msg);
        }
      }
    }
  }

  return violations;
}

/**
 * Extracts deduplicated valid `{{variable}}` names referenced in one or more template strings.
 */
export function extractTemplateVariables(texts: string[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    const matches = text.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g);
    for (const match of matches) {
      if (match[1]) {
        found.add(match[1]);
      }
    }
  }
  return Array.from(found);
}

/**
 * Validates an offline n8n workflow blueprint against both our TypeBox schema and graph integrity rules.
 */
export function validateN8nWorkflowBlueprint(blueprint: unknown): {
  valid: boolean;
  offlineSchemaValid: boolean;
  graphIntegrityValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const offlineSchemaValid = N8nBlueprintValidator.Check(blueprint);
  if (!offlineSchemaValid) {
    for (const err of N8nBlueprintValidator.Errors(blueprint)) {
      errors.push(`${err.path}: ${err.message}`);
    }
    return {
      valid: false,
      offlineSchemaValid: false,
      graphIntegrityValid: false,
      errors
    };
  }

  const typed = blueprint as N8nWorkflowBlueprint;
  const nodeNames = new Set(typed.nodes.map((n) => n.name));
  if (nodeNames.size !== typed.nodes.length) {
    errors.push('n8n blueprint contains duplicate node names.');
  }

  for (const [sourceNode, connObj] of Object.entries(typed.connections)) {
    if (!nodeNames.has(sourceNode)) {
      errors.push(`Connection source node '${sourceNode}' does not exist in nodes array.`);
    }
    for (const branch of connObj.main) {
      for (const target of branch) {
        if (!nodeNames.has(target.node)) {
          errors.push(`Connection target node '${target.node}' does not exist in nodes array.`);
        }
        if (target.node === sourceNode) {
          errors.push(`Node '${sourceNode}' cannot connect to itself.`);
        }
      }
    }
  }

  const graphIntegrityValid = errors.length === 0;
  return {
    valid: offlineSchemaValid && graphIntegrityValid,
    offlineSchemaValid,
    graphIntegrityValid,
    errors
  };
}

/**
 * Builds a deterministic, offline-validated n8n workflow blueprint using only safe declarative nodes.
 * Never activates the workflow (`active: false`) and never embeds live credentials.
 */
function buildSafeN8nBlueprint(
  input: ComposeEmailWorkflowInput,
  workflowHash: string,
  recipientVariable: string
): N8nWorkflowBlueprint {
  const nodes: N8nWorkflowNode[] = [];
  const connections: N8nWorkflowBlueprint['connections'] = {};

  const triggerNodeName = 'Trigger';
  if (input.triggerType === 'scheduled_digest') {
    nodes.push({
      id: `node-trigger-${workflowHash.slice(0, 8)}`,
      name: triggerNodeName,
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1,
      position: [240, 300],
      parameters: {
        triggerType: input.triggerType,
        mode: 'everyDay'
      }
    });
  } else {
    nodes.push({
      id: `node-trigger-${workflowHash.slice(0, 8)}`,
      name: triggerNodeName,
      type: 'n8n-nodes-base.webhook',
      typeVersion: 1,
      position: [240, 300],
      parameters: {
        httpMethod: 'POST',
        path: `thaara-offline-${workflowHash.slice(0, 12)}`,
        triggerType: input.triggerType
      }
    });
  }

  let previousNodeName = triggerNodeName;
  let xPos = 480;

  const conditions = input.followUpConditions ?? [];
  conditions.forEach((cond, idx) => {
    if (cond.delayMinutes > 0) {
      const waitNodeName = `Wait_${idx + 1}_${cond.delayMinutes}m`;
      nodes.push({
        id: `node-wait-${idx + 1}-${workflowHash.slice(0, 8)}`,
        name: waitNodeName,
        type: 'n8n-nodes-base.wait',
        typeVersion: 1,
        position: [xPos, 300],
        parameters: {
          amount: cond.delayMinutes,
          unit: 'minutes'
        }
      });
      connections[previousNodeName] = {
        main: [[{ node: waitNodeName, type: 'main', index: 0 }]]
      };
      previousNodeName = waitNodeName;
      xPos += 240;
    }

    const ifNodeName = `Condition_${idx + 1}_${cond.field}`;
    nodes.push({
      id: `node-if-${idx + 1}-${workflowHash.slice(0, 8)}`,
      name: ifNodeName,
      type: 'n8n-nodes-base.if',
      typeVersion: 1,
      position: [xPos, 300],
      parameters: {
        field: cond.field,
        operator: cond.operator,
        value: cond.value ?? null
      }
    });
    connections[previousNodeName] = {
      main: [[{ node: ifNodeName, type: 'main', index: 0 }]]
    };
    previousNodeName = ifNodeName;
    xPos += 240;
  });

  const draftNodeName = 'Compose_Email_Draft_Payload';
  nodes.push({
    id: `node-draft-${workflowHash.slice(0, 8)}`,
    name: draftNodeName,
    type: 'n8n-nodes-base.set',
    typeVersion: 1,
    position: [xPos, 300],
    parameters: {
      recipientVariable,
      subjectTemplate: input.emailSubject,
      bodyTemplate: input.emailBodyTemplate,
      allowedVariables: input.allowedVariables,
      deliveryMode: 'offline_draft_only_no_live_send'
    }
  });

  connections[previousNodeName] = {
    main: [[{ node: draftNodeName, type: 'main', index: 0 }]]
  };

  return {
    name: input.workflowName.trim(),
    active: false,
    versionId: `v1-${workflowHash.slice(0, 16)}`,
    nodes,
    connections,
    settings: {
      executionOrder: 'v1',
      saveManualExecutions: true
    },
    meta: {
      generatedBy: 'thaara-v2-offline-workflow-builder',
      importReadiness: 'offline_schema_validated_not_live_verified',
      externallyVerifiedWithLiveN8n: false
    }
  };
}

/**
 * Evaluates a single follow-up condition against sample data deterministically.
 */
function evaluateCondition(
  condition: EmailFollowUpCondition,
  sampleData: Record<string, string | number | boolean>
): DryRunConditionEvaluation {
  const rawVal = sampleData[condition.field];
  const actualValue = rawVal === undefined || rawVal === null ? null : String(rawVal);
  const expectedValue = condition.value ?? null;

  let matched = false;
  switch (condition.operator) {
    case 'exists':
      matched = actualValue !== null && actualValue.trim().length > 0;
      break;
    case 'equals':
      matched = actualValue !== null && expectedValue !== null && actualValue === expectedValue;
      break;
    case 'not_equals':
      matched = actualValue !== expectedValue;
      break;
    case 'contains':
      matched =
        actualValue !== null &&
        expectedValue !== null &&
        actualValue.toLowerCase().includes(expectedValue.toLowerCase());
      break;
  }

  return {
    field: condition.field,
    operator: condition.operator,
    expectedValue,
    actualValue,
    matched,
    delayMinutes: condition.delayMinutes
  };
}

/**
 * Performs safe, plain-text substitution of validated `{{variable}}` tokens without executing code.
 */
function renderSafeTemplate(
  template: string,
  sampleData: Record<string, string | number | boolean>
): string {
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_full, varName: string) => {
    const val = sampleData[varName];
    return val === undefined || val === null ? '' : String(val);
  });
}

/**
 * Phase 1A Adapter 1: `automation.email.compose_workflow`
 * Generates a structured email automation definition and an offline-schema-validated n8n blueprint.
 * Cannot send real email, deploy workflows, or contact external accounts.
 */
export class ComposeEmailWorkflowAdapter implements ActionAdapter {
  public readonly name = 'automation.email.compose_workflow';
  public readonly idempotencySupport: IdempotencySupport = 'native';

  async execute(context: ActionExecutionContext): Promise<ActionResult> {
    const rawParams = context.parameters;

    if (!ComposeInputValidator.Check(rawParams)) {
      const schemaErrors = [...ComposeInputValidator.Errors(rawParams)].map(
        (e) => `${e.path}: ${e.message}`
      );
      return {
        success: false,
        status: 'failed',
        verificationMethod: 'offline_workflow_schema_validation',
        error: `Invalid email workflow composition parameters: ${schemaErrors.join('; ')}`,
        proof: {
          workflowGenerated: false,
          validationErrors: schemaErrors,
          realEmailSent: false,
          externalDeploymentStatus: 'not_configured',
          externalAccountsContacted: false
        }
      };
    }

    const input = rawParams as ComposeEmailWorkflowInput;
    const recipientVariable = input.recipientVariable ?? 'recipient_email';
    const followUpConditions = input.followUpConditions ?? [];

    // 1. Security scan for forbidden code/script/injection patterns
    const securityViolations = detectWorkflowSecurityViolations([
      input.workflowName,
      input.emailSubject,
      input.emailBodyTemplate,
      ...followUpConditions.map((c) => c.value ?? '')
    ]);

    if (securityViolations.length > 0) {
      return {
        success: false,
        status: 'failed',
        verificationMethod: 'offline_workflow_security_gate',
        error: `Security validation failed: ${securityViolations.join(' ')}`,
        proof: {
          workflowGenerated: false,
          securityViolations,
          realEmailSent: false,
          externalDeploymentStatus: 'not_configured',
          externalAccountsContacted: false
        }
      };
    }

    // 2. Validate that all referenced variables and condition fields are declared in allowedVariables
    const allowedSet = new Set(input.allowedVariables);
    const referencedVariables = extractTemplateVariables([
      input.emailSubject,
      input.emailBodyTemplate
    ]);

    const undeclaredVariables = referencedVariables.filter((v) => !allowedSet.has(v));
    if (!allowedSet.has(recipientVariable)) {
      undeclaredVariables.push(recipientVariable);
    }

    const conditionErrors: string[] = [];
    for (const cond of followUpConditions) {
      if (!allowedSet.has(cond.field)) {
        undeclaredVariables.push(cond.field);
      }
      if (cond.operator !== 'exists' && (!cond.value || cond.value.trim().length === 0)) {
        conditionErrors.push(
          `Condition on field '${cond.field}' with operator '${cond.operator}' requires a non-empty 'value'.`
        );
      }
    }

    if (undeclaredVariables.length > 0 || conditionErrors.length > 0) {
      const deduplicatedUndeclared = Array.from(new Set(undeclaredVariables));
      const errParts: string[] = [];
      if (deduplicatedUndeclared.length > 0) {
        errParts.push(
          `Undeclared variables referenced but missing from allowedVariables: ${deduplicatedUndeclared.join(', ')}.`
        );
      }
      if (conditionErrors.length > 0) {
        errParts.push(...conditionErrors);
      }

      return {
        success: false,
        status: 'failed',
        verificationMethod: 'offline_workflow_schema_validation',
        error: errParts.join(' '),
        proof: {
          workflowGenerated: false,
          undeclaredVariables: deduplicatedUndeclared,
          conditionErrors,
          realEmailSent: false,
          externalDeploymentStatus: 'not_configured',
          externalAccountsContacted: false
        }
      };
    }

    // 3. Build canonical workflow definition + offline n8n blueprint
    const workflowHash = computeCanonicalParameterHash({
      workspaceId: context.workspaceId,
      workflowName: input.workflowName.trim(),
      triggerType: input.triggerType,
      recipientVariable,
      emailSubject: input.emailSubject,
      emailBodyTemplate: input.emailBodyTemplate,
      allowedVariables: [...input.allowedVariables].sort(),
      followUpConditions
    });

    const n8nBlueprint = buildSafeN8nBlueprint(input, workflowHash, recipientVariable);
    const blueprintValidation = validateN8nWorkflowBlueprint(n8nBlueprint);

    if (!blueprintValidation.valid) {
      return {
        success: false,
        status: 'failed',
        verificationMethod: 'offline_n8n_blueprint_schema_check',
        error: `Generated n8n blueprint failed offline schema validation: ${blueprintValidation.errors.join('; ')}`,
        proof: {
          workflowGenerated: false,
          blueprintErrors: blueprintValidation.errors,
          realEmailSent: false,
          externalDeploymentStatus: 'not_configured',
          externalAccountsContacted: false
        }
      };
    }

    const workflowDefinition: EmailAutomationWorkflowDefinition = {
      schemaVersion: 'thaara.email_automation.v1',
      workflowId: `wf_${workflowHash.slice(0, 16)}`,
      workflowName: input.workflowName.trim(),
      triggerType: input.triggerType,
      recipientVariable,
      emailSubject: input.emailSubject,
      emailBodyTemplate: input.emailBodyTemplate,
      allowedVariables: Array.from(allowedSet),
      referencedVariables,
      followUpConditions,
      n8nBlueprint
    };

    if (!WorkflowDefinitionValidator.Check(workflowDefinition)) {
      return {
        success: false,
        status: 'failed',
        verificationMethod: 'offline_workflow_schema_validation',
        error: 'Composed workflow definition failed internal contract validation.',
        proof: {
          workflowGenerated: false,
          realEmailSent: false,
          externalDeploymentStatus: 'not_configured',
          externalAccountsContacted: false
        }
      };
    }

    return {
      success: true,
      status: 'verified',
      verificationMethod: 'offline_workflow_schema_validation',
      proof: {
        workflowGenerated: true,
        workflowHash,
        workflowDefinition,
        n8nValidation: {
          offlineSchemaValid: blueprintValidation.offlineSchemaValid,
          graphIntegrityValid: blueprintValidation.graphIntegrityValid,
          externallyVerifiedWithLiveN8n: false,
          importReadiness: 'offline_schema_validated_not_live_verified'
        },
        realEmailSent: false,
        externalDeploymentStatus: 'not_configured',
        externalAccountsContacted: false
      }
    };
  }

  async reconcile(context: ActionExecutionContext): Promise<ActionResult | null> {
    return this.execute(context);
  }
}

/**
 * Phase 1A Adapter 2: `automation.email.dry_run_test`
 * Safely tests an email automation template and conditions against sample customer data offline.
 * Never sends real email or contacts external services.
 */
export class DryRunEmailWorkflowAdapter implements ActionAdapter {
  public readonly name = 'automation.email.dry_run_test';
  public readonly idempotencySupport: IdempotencySupport = 'native';

  async execute(context: ActionExecutionContext): Promise<ActionResult> {
    const rawParams = context.parameters;

    if (!DryRunInputValidator.Check(rawParams)) {
      const schemaErrors = [...DryRunInputValidator.Errors(rawParams)].map(
        (e) => `${e.path}: ${e.message}`
      );
      return {
        success: false,
        status: 'failed',
        verificationMethod: 'offline_sandbox_dry_run',
        error: `Invalid dry-run parameters: ${schemaErrors.join('; ')}`,
        proof: {
          dryRunPassed: false,
          validationErrors: schemaErrors,
          realEmailSent: false,
          externalDeploymentStatus: 'not_configured',
          externalAccountsContacted: false
        }
      };
    }

    const input = rawParams as DryRunEmailWorkflowInput;
    const recipientVariable = input.recipientVariable ?? 'recipient_email';
    const followUpConditions = input.followUpConditions ?? [];
    const allowedSet = new Set(input.allowedVariables);

    // 1. Security scan across template and sample data values
    const sampleStrings = Object.values(input.sampleData).map((v) => String(v));
    const securityViolations = detectWorkflowSecurityViolations([
      input.workflowName,
      input.emailSubject,
      input.emailBodyTemplate,
      ...followUpConditions.map((c) => c.value ?? ''),
      ...sampleStrings
    ]);

    // 2. Check referenced variables vs allowedVariables and sampleData
    const referencedVariables = extractTemplateVariables([
      input.emailSubject,
      input.emailBodyTemplate
    ]);

    const requiredVars = new Set<string>([
      recipientVariable,
      ...referencedVariables,
      ...followUpConditions.map((c) => c.field)
    ]);

    const undeclaredVariables = Array.from(requiredVars).filter((v) => !allowedSet.has(v));
    const missingVariables = Array.from(requiredVars).filter((v) => {
      const val = input.sampleData[v];
      return val === undefined || val === null || String(val).trim().length === 0;
    });

    // Check recipient email format if present in sampleData
    const rawRecipient = input.sampleData[recipientVariable];
    if (
      rawRecipient !== undefined &&
      rawRecipient !== null &&
      String(rawRecipient).trim().length > 0 &&
      !SIMPLE_EMAIL_REGEX.test(String(rawRecipient).trim())
    ) {
      securityViolations.push(
        `Sample recipient '${String(rawRecipient)}' in '${recipientVariable}' is not a valid email address format.`
      );
    }

    // Check condition operator integrity
    for (const cond of followUpConditions) {
      if (cond.operator !== 'exists' && (!cond.value || cond.value.trim().length === 0)) {
        securityViolations.push(
          `Condition on field '${cond.field}' with operator '${cond.operator}' is missing a comparison value.`
        );
      }
    }

    // 3. Evaluate follow-up conditions
    const conditionEvaluations = followUpConditions.map((cond) =>
      evaluateCondition(cond, input.sampleData)
    );
    const conditionsSatisfied = conditionEvaluations.every((c) => c.matched);
    const totalDelayMinutes = conditionEvaluations.reduce((sum, c) => sum + c.delayMinutes, 0);

    const hasErrors =
      securityViolations.length > 0 ||
      undeclaredVariables.length > 0 ||
      missingVariables.length > 0;

    const renderedPreview = hasErrors
      ? null
      : {
          recipient: String(input.sampleData[recipientVariable]).trim(),
          subject: renderSafeTemplate(input.emailSubject, input.sampleData),
          body: renderSafeTemplate(input.emailBodyTemplate, input.sampleData),
          totalDelayMinutes
        };

    const dryRunReport: EmailWorkflowDryRunReport = {
      dryRunPassed: !hasErrors,
      workflowName: input.workflowName.trim(),
      triggerType: input.triggerType,
      referencedVariables,
      missingVariables,
      undeclaredVariables,
      securityViolations,
      conditionsSatisfied,
      conditionEvaluations,
      renderedPreview,
      realEmailSent: false,
      externalDeploymentStatus: 'not_configured',
      externalAccountsContacted: false
    };

    if (!DryRunReportValidator.Check(dryRunReport)) {
      return {
        success: false,
        status: 'failed',
        verificationMethod: 'offline_sandbox_dry_run',
        error: 'Dry-run report failed internal schema check.',
        proof: {
          dryRunPassed: false,
          realEmailSent: false,
          externalDeploymentStatus: 'not_configured',
          externalAccountsContacted: false
        }
      };
    }

    if (hasErrors) {
      const reasons: string[] = [];
      if (securityViolations.length > 0) {
        reasons.push(`Security/validation violations: ${securityViolations.join(' ')}`);
      }
      if (undeclaredVariables.length > 0) {
        reasons.push(`Undeclared variables: ${undeclaredVariables.join(', ')}`);
      }
      if (missingVariables.length > 0) {
        reasons.push(`Missing sample data for variables: ${missingVariables.join(', ')}`);
      }

      return {
        success: false,
        status: 'failed',
        verificationMethod: 'offline_sandbox_dry_run',
        error: `Dry run failed: ${reasons.join(' | ')}`,
        proof: {
          dryRunPassed: false,
          dryRunReport,
          realEmailSent: false,
          externalDeploymentStatus: 'not_configured',
          externalAccountsContacted: false
        }
      };
    }

    const workflowHash = computeCanonicalParameterHash({
      workspaceId: context.workspaceId,
      workflowName: input.workflowName.trim(),
      triggerType: input.triggerType,
      recipientVariable,
      emailSubject: input.emailSubject,
      emailBodyTemplate: input.emailBodyTemplate,
      allowedVariables: [...input.allowedVariables].sort(),
      followUpConditions
    });

    if (context.dependencyProofs) {
      for (const [parentStepId, parentProof] of Object.entries(context.dependencyProofs)) {
        if (
          typeof parentProof?.workflowHash === 'string' &&
          parentProof.workflowHash !== workflowHash
        ) {
          return {
            success: false,
            status: 'failed',
            verificationMethod: 'offline_sandbox_dry_run',
            error: `Dry-run workflow definition does not match verified upstream composition workflowHash from step '${parentStepId}'.`,
            proof: {
              dryRunPassed: false,
              workflowHash,
              expectedParentWorkflowHash: parentProof.workflowHash,
              realEmailSent: false,
              externalDeploymentStatus: 'not_configured',
              externalAccountsContacted: false
            }
          };
        }
      }
    }

    return {
      success: true,
      status: 'verified',
      verificationMethod: 'offline_sandbox_dry_run',
      proof: {
        dryRunPassed: true,
        workflowHash,
        dryRunHash: workflowHash,
        dryRunReport,
        realEmailSent: false,
        externalDeploymentStatus: 'not_configured',
        externalAccountsContacted: false
      }
    };
  }

  async reconcile(context: ActionExecutionContext): Promise<ActionResult | null> {
    return this.execute(context);
  }
}

/**
 * Computes the deterministic workspace-scoped workflowHash for an email automation workflow.
 */
export function computeEmailWorkflowHash(
  workspaceId: string,
  input: Pick<
    ComposeEmailWorkflowInput,
    | 'workflowName'
    | 'triggerType'
    | 'recipientVariable'
    | 'emailSubject'
    | 'emailBodyTemplate'
    | 'allowedVariables'
    | 'followUpConditions'
  >
): string {
  const recipientVariable = input.recipientVariable ?? 'recipient_email';
  const followUpConditions = input.followUpConditions ?? [];
  return computeCanonicalParameterHash({
    workspaceId,
    workflowName: input.workflowName.trim(),
    triggerType: input.triggerType,
    recipientVariable,
    emailSubject: input.emailSubject,
    emailBodyTemplate: input.emailBodyTemplate,
    allowedVariables: [...input.allowedVariables].sort(),
    followUpConditions
  });
}

/**
 * Phase 1B Adapter: `automation.email.stage_workflow_artifact`
 * Stages an offline, inactive (`active: false`) email workflow artifact ONLY after:
 * 1. Explicit approval is granted and verified by PolicyGateway
 * 2. Both upstream compose and dry-run dependency proofs are verified and match the canonical workflowHash
 * 3. Parameters and optional expectedWorkflowHash pass schema, security, and hash checks.
 * Never activates a live n8n workflow and never sends a real email.
 */
export class StageEmailWorkflowArtifactAdapter implements ActionAdapter {
  public readonly name = 'automation.email.stage_workflow_artifact';
  public readonly idempotencySupport: IdempotencySupport = 'native';

  async execute(context: ActionExecutionContext): Promise<ActionResult> {
    const rawParams = context.parameters;

    if (!StageInputValidator.Check(rawParams)) {
      const schemaErrors = [...StageInputValidator.Errors(rawParams)].map(
        (e) => `${e.path}: ${e.message}`
      );
      return {
        success: false,
        status: 'failed',
        verificationMethod: 'offline_workflow_artifact_staging',
        error: `Invalid workflow staging parameters: ${schemaErrors.join('; ')}`,
        proof: {
          staged: false,
          workflowStaged: false,
          validationErrors: schemaErrors,
          realEmailSent: false,
          externalDeploymentStatus: 'not_configured',
          externalAccountsContacted: false
        }
      };
    }

    const input = rawParams as StageEmailWorkflowArtifactInput;
    const recipientVariable = input.recipientVariable ?? 'recipient_email';
    const followUpConditions = input.followUpConditions ?? [];
    const allowedSet = new Set(input.allowedVariables);

    // 1. Security scan for forbidden code/script/injection patterns
    const securityViolations = detectWorkflowSecurityViolations([
      input.workflowName,
      input.emailSubject,
      input.emailBodyTemplate,
      ...followUpConditions.map((c) => c.value ?? '')
    ]);

    if (securityViolations.length > 0) {
      return {
        success: false,
        status: 'failed',
        verificationMethod: 'offline_workflow_artifact_staging',
        error: `Security validation failed during staging: ${securityViolations.join(' ')}`,
        proof: {
          staged: false,
          workflowStaged: false,
          securityViolations,
          realEmailSent: false,
          externalDeploymentStatus: 'not_configured',
          externalAccountsContacted: false
        }
      };
    }

    // 2. Validate variable declarations
    const referencedVariables = extractTemplateVariables([
      input.emailSubject,
      input.emailBodyTemplate
    ]);
    const undeclaredVariables = referencedVariables.filter((v) => !allowedSet.has(v));
    if (!allowedSet.has(recipientVariable)) {
      undeclaredVariables.push(recipientVariable);
    }
    for (const cond of followUpConditions) {
      if (!allowedSet.has(cond.field)) {
        undeclaredVariables.push(cond.field);
      }
    }

    if (undeclaredVariables.length > 0) {
      const deduplicated = Array.from(new Set(undeclaredVariables));
      return {
        success: false,
        status: 'failed',
        verificationMethod: 'offline_workflow_artifact_staging',
        error: `Undeclared variables in staged workflow: ${deduplicated.join(', ')}.`,
        proof: {
          staged: false,
          workflowStaged: false,
          undeclaredVariables: deduplicated,
          realEmailSent: false,
          externalDeploymentStatus: 'not_configured',
          externalAccountsContacted: false
        }
      };
    }

    // 3. Compute canonical workspace-scoped workflowHash and verify expectedWorkflowHash if provided
    const workflowHash = computeEmailWorkflowHash(context.workspaceId, input);
    if (input.expectedWorkflowHash && input.expectedWorkflowHash !== workflowHash) {
      return {
        success: false,
        status: 'failed',
        verificationMethod: 'offline_workflow_artifact_staging',
        error: `Workflow hash mismatch: expected '${input.expectedWorkflowHash}', computed '${workflowHash}'.`,
        proof: {
          staged: false,
          workflowStaged: false,
          workflowHash,
          expectedWorkflowHash: input.expectedWorkflowHash,
          realEmailSent: false,
          externalDeploymentStatus: 'not_configured',
          externalAccountsContacted: false
        }
      };
    }

    // 4. Require both verified compose and verified dry-run dependency proofs
    const depEntries = Object.entries(context.dependencyProofs ?? {});
    let verifiedComposeStepId: string | null = null;
    let composeProof: Record<string, unknown> | null = null;
    let verifiedDryRunStepId: string | null = null;
    let dryRunProof: Record<string, unknown> | null = null;

    for (const [depStepId, proof] of depEntries) {
      if (proof && proof.workflowGenerated === true) {
        verifiedComposeStepId = depStepId;
        composeProof = proof;
      }
      if (proof && proof.dryRunPassed === true) {
        verifiedDryRunStepId = depStepId;
        dryRunProof = proof;
      }
    }

    if (!verifiedComposeStepId || !composeProof || !verifiedDryRunStepId || !dryRunProof) {
      return {
        success: false,
        status: 'failed',
        verificationMethod: 'offline_workflow_artifact_staging',
        error:
          'Staging requires both verified compose and verified dry-run dependency proofs before staging an offline workflow artifact.',
        proof: {
          staged: false,
          workflowStaged: false,
          hasVerifiedComposeProof: Boolean(verifiedComposeStepId),
          hasVerifiedDryRunProof: Boolean(verifiedDryRunStepId),
          realEmailSent: false,
          externalDeploymentStatus: 'not_configured',
          externalAccountsContacted: false
        }
      };
    }

    const composeHash =
      typeof composeProof.workflowHash === 'string' ? composeProof.workflowHash : null;
    const dryRunHash =
      typeof dryRunProof.workflowHash === 'string' ? dryRunProof.workflowHash : null;

    if (composeHash !== workflowHash || dryRunHash !== workflowHash) {
      return {
        success: false,
        status: 'failed',
        verificationMethod: 'offline_workflow_artifact_staging',
        error: `Upstream dependency workflowHash mismatch (compose: '${composeHash ?? 'missing'}', dryRun: '${dryRunHash ?? 'missing'}', staged: '${workflowHash}').`,
        proof: {
          staged: false,
          workflowStaged: false,
          workflowHash,
          composeWorkflowHash: composeHash,
          dryRunWorkflowHash: dryRunHash,
          realEmailSent: false,
          externalDeploymentStatus: 'not_configured',
          externalAccountsContacted: false
        }
      };
    }

    // 5. Build and validate the inactive n8n blueprint & workflow definition
    const n8nBlueprint = buildSafeN8nBlueprint(input, workflowHash, recipientVariable);
    const blueprintValidation = validateN8nWorkflowBlueprint(n8nBlueprint);
    if (!blueprintValidation.valid || n8nBlueprint.active !== false) {
      return {
        success: false,
        status: 'failed',
        verificationMethod: 'offline_workflow_artifact_staging',
        error: `Staged n8n blueprint failed offline validation: ${blueprintValidation.errors.join('; ')}`,
        proof: {
          staged: false,
          workflowStaged: false,
          blueprintErrors: blueprintValidation.errors,
          realEmailSent: false,
          externalDeploymentStatus: 'not_configured',
          externalAccountsContacted: false
        }
      };
    }

    const workflowDefinition: EmailAutomationWorkflowDefinition = {
      schemaVersion: 'thaara.email_automation.v1',
      workflowId: `wf_${workflowHash.slice(0, 16)}`,
      workflowName: input.workflowName.trim(),
      triggerType: input.triggerType,
      recipientVariable,
      emailSubject: input.emailSubject,
      emailBodyTemplate: input.emailBodyTemplate,
      allowedVariables: Array.from(allowedSet),
      referencedVariables,
      followUpConditions,
      n8nBlueprint
    };

    const upstreamDryRunReport = dryRunProof.dryRunReport as
      | EmailWorkflowDryRunReport
      | undefined;

    const parameterHash = computeCanonicalParameterHash(context.parameters);
    const artifactId = `stg_${workflowHash.slice(0, 16)}`;

    const stagedArtifact: StagedEmailWorkflowArtifact = {
      schemaVersion: 'thaara.staged_email_workflow_artifact.v1',
      artifactId,
      workspaceId: context.workspaceId,
      planId: context.planId,
      stepId: context.stepId,
      workflowHash,
      parameterHash,
      verifiedComposeStepId,
      verifiedDryRunStepId,
      workflowDefinition,
      dryRunSummary: {
        dryRunPassed: true,
        conditionsSatisfied: upstreamDryRunReport?.conditionsSatisfied ?? true,
        renderedPreview: upstreamDryRunReport?.renderedPreview ?? null
      },
      stagingStatus: 'staged_offline_inactive',
      active: false,
      realEmailSent: false,
      externalDeploymentStatus: 'not_configured',
      externalAccountsContacted: false
    };

    if (!StagedArtifactValidator.Check(stagedArtifact)) {
      return {
        success: false,
        status: 'failed',
        verificationMethod: 'offline_workflow_artifact_staging',
        error: 'Staged workflow artifact failed internal contract validation.',
        proof: {
          staged: false,
          workflowStaged: false,
          realEmailSent: false,
          externalDeploymentStatus: 'not_configured',
          externalAccountsContacted: false
        }
      };
    }

    return {
      success: true,
      status: 'verified',
      verificationMethod: 'offline_workflow_artifact_staging',
      proof: {
        staged: true,
        workflowStaged: true,
        artifactId,
        workflowHash,
        dryRunHash: workflowHash,
        parameterHash,
        verifiedComposeStepId,
        verifiedDryRunStepId,
        stagedArtifact,
        realEmailSent: false,
        externalDeploymentStatus: 'not_configured',
        externalAccountsContacted: false
      }
    };
  }

  async reconcile(context: ActionExecutionContext): Promise<ActionResult | null> {
    return this.execute(context);
  }
}
