import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AutomationDashboardView } from '../src/AutomationDashboard';
import { WorkflowInspector, copyWorkflowBlueprint, downloadWorkflowBlueprint } from '../src/WorkflowInspector';
import { StagedEmailWorkflowArtifactItem } from '../src/api';
import { listAutomations, loadAutomationDetail } from '../src/automation-api';

const automation = {
  id: 'plan-a', title: '<script>external text</script>', status: 'completed', display_status: 'completed',
  created_at: '2026-10-16T10:00:00Z', updated_at: '2026-10-16T10:01:00Z'
};
const detail = {
  ...automation,
  steps: [{ id: 'step-a', step_index: 0, action_name: 'automation.email.stage_workflow_artifact', status: 'verified',
    approval_mode: 'explicit', depends_on_step_ids: [] }],
  approvals: [{ id: 'approval-a', step_id: 'step-a', status: 'approved', risk_level: 'low', requester_user_id: 'user-a',
    approver_user_id: 'owner-a', created_at: '2026-10-16T10:00:00Z', updated_at: '2026-10-16T10:01:00Z',
    expires_at: '2026-10-17T10:00:00Z', bound_at: '2026-10-16T10:00:00Z' }],
  receipts: [{ id: 'receipt-a', plan_step_id: 'step-a', action_name: 'automation.email.stage_workflow_artifact',
    status: 'verified', verification_method: 'offline_schema_validation',
    issued_at: '2026-10-16T10:01:00Z', verified_at: '2026-10-16T10:01:00Z' }]
};
const artifact: StagedEmailWorkflowArtifactItem = {
  schemaVersion: 'thaara.staged_email_workflow_artifact.v1', artifactId: 'artifact-a', workspaceId: 'workspace-a', planId: 'plan-a', stepId: 'step-a',
  workflowHash: 'a'.repeat(64), parameterHash: 'b'.repeat(64), verifiedComposeStepId: 'compose-a', verifiedDryRunStepId: 'dry-run-a',
  workflowDefinition: { schemaVersion: 'thaara.email_automation.v1', workflowId: 'workflow-a', workflowName: 'Offline follow-up',
    triggerType: 'form_submission', recipientVariable: 'email', emailSubject: 'Hello', emailBodyTemplate: 'Hello', allowedVariables: ['email'],
    referencedVariables: ['email'], followUpConditions: [],
    n8nBlueprint: { name: 'Offline follow-up', active: false, versionId: '1', nodes: [
      { id: 'node-a', name: 'Form trigger', type: 'n8n-nodes-base.webhook', typeVersion: 1, position: [0,0], parameters: {} },
      { id: 'node-b', name: 'Draft email', type: 'n8n-nodes-base.set', typeVersion: 1, position: [200,0], parameters: {} }
    ], connections: {}, settings: { executionOrder: 'v1', saveManualExecutions: false },
      meta: { generatedBy: 'thaara-v2-offline-workflow-builder', importReadiness: 'offline_schema_validated_not_live_verified', externallyVerifiedWithLiveN8n: false } }
  }, dryRunSummary: { dryRunPassed: true, conditionsSatisfied: true,
    renderedPreview: { recipient: 'private@example.test', subject: 'Hello', body: 'private preview', totalDelayMinutes: 0 } },
  stagingStatus: 'staged_offline_inactive', active: false, realEmailSent: false, externalDeploymentStatus: 'not_configured', externalAccountsContacted: false
};
function render(overrides: Record<string, unknown> = {}) {
  return renderToStaticMarkup(<AutomationDashboardView {...({
    items: [], loading: false, error: null, status: '', offset: 0, nextOffset: null,
    detail: null, detailLoading: false, detailError: null, artifact: null, artifactLoading: false,
    artifactError: null, selectedId: null, copied: false,
    onFilter: () => {}, onRefresh: () => {}, onPage: () => {}, onSelect: () => {},
    onInspect: () => {}, onCopy: () => {}, onDownload: () => {}, ...overrides
  } as any)} />);
}

describe('Step 71 dashboard presentation', () => {
  it('shows loading rather than an empty or stale result', () => {
    const html = render({ loading: true });
    expect(html).toContain('Loading automations');
    expect(html).not.toContain('No automations');
  });
  it('distinguishes empty workspace, filtered empty results and errors', () => {
    expect(render()).toContain('No automations in this workspace');
    expect(render({ status: 'failed' })).toContain('No automations match this status');
    const error = render({ error: 'Could not load automations. Try refreshing.' });
    expect(error).toContain('role="alert"');
    expect(error).not.toContain('No automations in this workspace');
  });
  it('shows unauthorized state without leaking previously loaded plans', () => {
    const html = render({ error: 'Your session has expired. Sign in again.', items: [automation] });
    expect(html).toContain('Sign in again');
    expect(html).not.toContain('external text');
  });
  it('presents persisted completed status without claiming external execution and escapes untrusted titles', () => {
    const html = render({ items: [automation] });
    expect(html).toContain('completed');
    expect(html).toContain('&lt;script&gt;external text&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Offline');
  });
  it('shows available approval records and verified receipt evidence', () => {
    const html = render({ items: [automation], selectedId: 'plan-a', detail });
    expect(html).toContain('approved');
    expect(html).toContain('approval-a');
    expect(html).toContain('receipt-a');
    expect(html).toContain('offline_schema_validation');
    expect(html).toContain('View workflow');
    expect(html).not.toContain('Deploy');
    expect(html).not.toContain('Approve</button>');
  });
  it('renders detail loading and error without stale evidence or export actions', () => {
    expect(render({ detailLoading: true, selectedId: 'plan-a' })).toContain('Loading automation details');
    const html = render({ detail, selectedId: 'plan-a', detailError: 'Access denied.' });
    expect(html).toContain('Access denied.');
    expect(html).not.toContain('receipt-a');
    expect(html).not.toContain('View workflow');
  });
  it('does not offer workflow export for pending or unverified staging', () => {
    const html = render({ selectedId: 'plan-a', detail: { ...detail, status: 'awaiting_approval',
      display_status: 'awaiting_approval', steps: [{ ...detail.steps[0], status: 'awaiting_approval' }], receipts: [] } });
    expect(html).not.toContain('View workflow');
    expect(html).not.toContain('Download JSON');
  });
  it('keeps Download JSON available when clipboard permission fails', () => {
    const html = render({ detail, selectedId: 'plan-a', artifact, exportError: 'Clipboard access failed. Download the JSON instead.' });
    expect(html).toContain('Clipboard access failed');
    expect(html).toContain('Download JSON');
    expect(html).toContain('Form trigger');
  });

  it('shows an artifact access failure without exposing a cached JSON payload', () => {
    const html = render({ detail, selectedId: 'plan-a', artifactError: 'Workflow access denied.' });
    expect(html).toContain('Workflow access denied.');
    expect(html).not.toContain('Download JSON');
  });
  it('renders truthful unverified outcome and server pagination controls', () => {
    const html = render({ items: [{ ...automation, status: 'failed', display_status: 'unverified' }], offset: 20, nextOffset: 40 });
    expect(html).toContain('unverified');
    expect(html).toContain('Previous');
    expect(html).toContain('Next');
  });
});

describe('Step 71 persisted dashboard reads', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('applies filter and pagination on the server and propagates cancellation', async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [automation], nextOffset: null }) });
    vi.stubGlobal('fetch', fetch);
    expect((await listAutomations('unverified', 20, controller.signal)).items).toEqual([automation]);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/v1/automations?limit=20&offset=20&status=unverified');
    expect(options).toMatchObject({ method: 'GET', cache: 'no-store', signal: controller.signal, credentials: 'include' });
  });
  it('surfaces backend permission errors with HTTP status for explicit unauthorized states', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403,
      json: async () => ({ error: { message: 'Active workspace membership is required.' } }) }));
    await expect(loadAutomationDetail('plan/a')).rejects.toMatchObject({
      status: 403, message: 'Active workspace membership is required.'
    });
  });
});

describe('Shared verified offline inspector and export', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('shows the existing blueprint nodes and truthful inactive state', () => {
    const html = renderToStaticMarkup(<WorkflowInspector artifact={artifact} copied={false} onCopy={() => {}} onDownload={() => {}} />);
    expect(html).toContain('Form trigger'); expect(html).toContain('Draft email');
    expect(html).toContain('active: false'); expect(html).not.toContain('private preview');
  });
  it('copies only inactive blueprint JSON and reports unavailable clipboard truthfully', async () => {
    vi.stubGlobal('navigator', {});
    await expect(copyWorkflowBlueprint(artifact)).rejects.toThrow('Clipboard unavailable');
    let text = ''; vi.stubGlobal('navigator', { clipboard: { writeText: async (value: string) => { text = value; } } });
    await copyWorkflowBlueprint(artifact);
    expect(JSON.parse(text)).toMatchObject({ name: 'Offline follow-up', active: false });
    expect(text).not.toContain('private@example.test');
    await expect(copyWorkflowBlueprint({ ...artifact, active: true } as any)).rejects.toThrow('Only inactive offline');
  });
  it('downloads only blueprint JSON, cleans the temporary URL and rejects active artifacts', async () => {
    let blob: Blob | undefined; let revoked = false; let clicked = false; let removed = false;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => { blob = value as Blob; return 'blob:offline-test'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { revoked = true; });
    const link = { href: '', download: '', click: () => { clicked = true; }, remove: () => { removed = true; } };
    vi.stubGlobal('document', { createElement: () => link, body: { appendChild: () => {} } });
    downloadWorkflowBlueprint(artifact);
    expect(clicked && removed && revoked).toBe(true);
    expect(JSON.parse(await blob!.text())).toMatchObject({ name: 'Offline follow-up', active: false });
    expect(await blob!.text()).not.toContain('private preview');
    expect(() => downloadWorkflowBlueprint({ ...artifact, active: true } as any)).toThrow('Only inactive offline');
  });
});
