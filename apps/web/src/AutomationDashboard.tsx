import React, { useEffect, useRef, useState } from 'react';
import { StagedEmailWorkflowArtifactItem } from './api';
import {
  AUTOMATION_PAGE_SIZE,
  AutomationDetail,
  AutomationListResponse,
  AutomationStatus,
  AutomationSummary,
  canInspectWorkflow,
  dashboardError,
  listAutomations,
  loadAutomationDetail,
  loadDashboardArtifact,
} from './automation-api';
import { AutomationActivity } from './AutomationActivity';
import { formatFriendlyDateTime } from './integration-ui';
import {
  WorkflowInspector,
  copyWorkflowBlueprint,
  downloadWorkflowBlueprint,
} from './WorkflowInspector';

const statuses: AutomationStatus[] = [
  'draft',
  'queued',
  'running',
  'awaiting_approval',
  'paused',
  'completed',
  'failed',
  'unverified',
  'cancelled',
];

function Status({ value }: { value: string }) {
  const variant = ['completed', 'verified', 'approved'].includes(value)
    ? 'success'
    : ['failed', 'unverified', 'rejected', 'expired', 'execution_failed'].includes(value)
      ? 'danger'
      : 'warning';
  return <span className={`badge badge-${variant}`}>{value.replaceAll('_', ' ')}</span>;
}

function timestamp(value: string | null) {
  if (!value) return 'Not verified';
  const formatted = formatFriendlyDateTime(value);
  return formatted === '—' ? 'Unavailable' : formatted;
}

interface ViewProps {
  items: AutomationSummary[];
  loading: boolean;
  error: string | null;
  status: AutomationStatus | '';
  offset: number;
  nextOffset: number | null;
  selectedId: string | null;
  detail: AutomationDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  artifact: StagedEmailWorkflowArtifactItem | null;
  artifactLoading: boolean;
  artifactError: string | null;
  exportError?: string | null;
  copied: boolean;
  onFilter(status: AutomationStatus | ''): void;
  onRefresh(): void;
  onPage(offset: number): void;
  onSelect(id: string): void;
  onInspect(): void;
  onCopy(): void;
  onDownload(): void;
}

export function AutomationDashboardView(props: ViewProps): React.ReactElement {
  const { loading, error, items, detail, detailLoading, detailError } = props;
  return (
    <section
      className="integration-card automation-dashboard"
      aria-labelledby="automations-heading"
      aria-busy={loading}
    >
      <div className="integration-header-bar">
        <div className="integration-header-left">
          <h2 id="automations-heading" className="integration-title">
            Automation Management
          </h2>
          <span className="badge badge-info">Offline Blueprints (Inactive)</span>
        </div>
        <div className="integration-header-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={props.onRefresh}
            disabled={loading}
            style={{ padding: '0.38rem 0.75rem', fontSize: '0.8rem' }}
          >
            Refresh automations
          </button>
        </div>
      </div>

      <p className="automation-muted" style={{ marginBottom: '0.75rem' }}>
        Offline automation plans and evidence from this workspace. Workflows remain inactive.
      </p>

      <div className="integration-filter-bar">
        <label
          htmlFor="automation-status"
          style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <span>Filter by status</span>
          <select
            id="automation-status"
            className="integration-select"
            style={{ marginTop: 0 }}
            value={props.status}
            onChange={(e) => props.onFilter(e.target.value as AutomationStatus | '')}
          >
            <option value="">All statuses</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        {!loading && !error && (
          <span className="automation-muted">{items.length} plans on this page</span>
        )}
      </div>

      {loading ? (
        <p role="status">Loading automations…</p>
      ) : error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : (
        <>
          {items.length === 0 ? (
            <p role="status">
              {props.status
                ? 'No automations match this status.'
                : 'No automations in this workspace yet. Create an offline automation in chat to get started.'}
            </p>
          ) : (
            <ul className="automation-list">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="automation-plan"
                    aria-pressed={item.id === props.selectedId}
                    onClick={() => props.onSelect(item.id)}
                  >
                    <span>
                      <strong>{item.title}</strong>
                      <small>Updated {timestamp(item.updated_at)}</small>
                    </span>
                    <Status value={item.display_status} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div
            className="automation-toolbar automation-pagination"
            aria-label="Automation pages"
          >
            <button
              type="button"
              className="btn btn-secondary"
              disabled={props.offset === 0}
              onClick={() => props.onPage(Math.max(0, props.offset - AUTOMATION_PAGE_SIZE))}
            >
              Previous
            </button>
            <span>Page {Math.floor(props.offset / AUTOMATION_PAGE_SIZE) + 1}</span>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={props.nextOffset === null}
              onClick={() => props.nextOffset !== null && props.onPage(props.nextOffset)}
            >
              Next
            </button>
          </div>

          {props.selectedId && (
            <div className="automation-detail" aria-live="polite" aria-busy={detailLoading}>
              {detailLoading ? (
                <p role="status">Loading automation details…</p>
              ) : detailError ? (
                <div className="error-banner" role="alert">
                  {detailError}
                </div>
              ) : (
                detail && (
                  <>
                    <div className="automation-toolbar">
                      <h3 style={{ margin: 0 }}>{detail.title}</h3>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <Status value={detail.display_status} />
                        <span className="automation-muted">
                          Persisted plan status: {detail.status.replaceAll('_', ' ')}
                        </span>
                      </div>
                    </div>

                    <AutomationActivity key={detail.id} planId={detail.id} />

                    <h4>Task steps</h4>
                    {detail.steps.length === 0 ? (
                      <p>No task steps recorded.</p>
                    ) : (
                      <ol className="automation-steps">
                        {detail.steps.map((step) => (
                          <li key={step.id}>
                            <div className="automation-toolbar">
                              <strong>{step.action_name}</strong>
                              <Status value={step.status} />
                            </div>
                            <p className="automation-muted">
                              Approval mode: {step.approval_mode}. Dependencies:{' '}
                              {step.depends_on_step_ids.join(', ') || 'None'}.
                            </p>
                          </li>
                        ))}
                      </ol>
                    )}

                    <h4>Approval records</h4>
                    <p className="automation-muted">
                      Available persisted records and decision timestamps; a full decision-event
                      history is not stored here.
                    </p>
                    {detail.approvals.length === 0 ? (
                      <p>No approval records for this plan.</p>
                    ) : (
                      detail.approvals.map((approval) => (
                        <article key={approval.id} className="automation-evidence">
                          <Status value={approval.status} />
                          <p>
                            Risk: {approval.risk_level} · Requested {timestamp(approval.created_at)}{' '}
                            · Updated {timestamp(approval.updated_at)}
                          </p>
                          <p>
                            Expires {timestamp(approval.expires_at)} · Bound{' '}
                            {timestamp(approval.bound_at)}
                          </p>
                        </article>
                      ))
                    )}

                    <h4>Execution receipts</h4>
                    {detail.receipts.length === 0 ? (
                      <p>No execution receipts yet. Execution is not verified.</p>
                    ) : (
                      detail.receipts.map((receipt) => (
                        <details key={receipt.id} className="automation-evidence">
                          <summary>
                            <Status value={receipt.status} /> {receipt.action_name}
                          </summary>
                          <p>Verification method: {receipt.verification_method}</p>
                          <p>
                            Issued {timestamp(receipt.issued_at)} · Verified:{' '}
                            {timestamp(receipt.verified_at)}
                          </p>
                          <p className="automation-muted">
                            Raw proof and private workflow payloads are excluded. Offline
                            verification does not confirm external deployment or email delivery.
                          </p>
                        </details>
                      ))
                    )}

                    {/* Progressive Disclosure: Technical Identifiers */}
                    <details className="integration-settings-drawer" style={{ marginTop: '0.75rem' }}>
                      <summary>Advanced Details &amp; Technical Identifiers</summary>
                      <div className="integration-settings-body">
                        <p className="automation-id" style={{ margin: 0 }}>
                          Plan: {detail.id}
                        </p>
                        {detail.steps.map((step) => (
                          <p key={step.id} className="automation-id" style={{ margin: 0 }}>
                            Step: {step.id}
                          </p>
                        ))}
                        {detail.approvals.map((approval) => (
                          <div key={approval.id}>
                            <p className="automation-id" style={{ margin: 0 }}>
                              Approval: {approval.id} · Step: {approval.step_id}
                            </p>
                            <p className="automation-id" style={{ margin: 0 }}>
                              Requester: {approval.requester_user_id} · Approver:{' '}
                              {approval.approver_user_id || 'No decision recorded'}
                            </p>
                          </div>
                        ))}
                        {detail.receipts.map((receipt) => (
                          <p key={receipt.id} className="automation-id" style={{ margin: 0 }}>
                            Receipt: {receipt.id} · Step: {receipt.plan_step_id}
                          </p>
                        ))}
                      </div>
                    </details>

                    {canInspectWorkflow(detail) && (
                      <div className="automation-artifact">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={props.artifactLoading}
                          onClick={props.onInspect}
                        >
                          {props.artifactLoading ? 'Loading verified workflow…' : 'View workflow'}
                        </button>
                        {props.exportError && (
                          <div className="error-banner" role="alert">
                            {props.exportError}
                          </div>
                        )}
                        {props.artifactError ? (
                          <div className="error-banner" role="alert">
                            {props.artifactError}
                          </div>
                        ) : (
                          !props.artifactLoading &&
                          props.artifact && (
                            <WorkflowInspector
                              artifact={props.artifact}
                              copied={props.copied}
                              onCopy={props.onCopy}
                              onDownload={props.onDownload}
                            />
                          )
                        )}
                      </div>
                    )}
                  </>
                )
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function AutomationDashboard() {
  const [query, setQuery] = useState<{
    status: AutomationStatus | '';
    offset: number;
    revision: number;
  }>({ status: '', offset: 0, revision: 0 });
  const [list, setList] = useState<AutomationListResponse>({ items: [], nextOffset: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AutomationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [inspection, setInspection] = useState(0);
  const [artifact, setArtifact] = useState<StagedEmailWorkflowArtifactItem | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyVersion = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setList({ items: [], nextOffset: null });
    listAutomations(query.status, query.offset, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setList(result);
        setSelectedId((id) => (result.items.some((item) => item.id === id) ? id : null));
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(dashboardError(err));
          setSelectedId(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setDetailError(null);
    setInspectId(null);
    setArtifact(null);
    setDetailLoading(Boolean(selectedId));
    if (selectedId)
      loadAutomationDetail(selectedId, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setDetail(result);
        })
        .catch((err: unknown) => {
          if (!controller.signal.aborted) setDetailError(dashboardError(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) setDetailLoading(false);
        });
    return () => controller.abort();
  }, [selectedId, query]);

  useEffect(() => {
    const controller = new AbortController();
    setArtifact(null);
    setArtifactError(null);
    setExportError(null);
    setCopied(false);
    copyVersion.current++;
    setArtifactLoading(Boolean(inspectId));
    if (inspectId)
      loadDashboardArtifact(inspectId, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setArtifact(result);
        })
        .catch((err: unknown) => {
          if (!controller.signal.aborted) setArtifactError(dashboardError(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) setArtifactLoading(false);
        });
    return () => {
      controller.abort();
      copyVersion.current++;
    };
  }, [inspectId, inspection, selectedId, query]);

  const resetSelection = () => {
    setSelectedId(null);
    setInspectId(null);
    setArtifact(null);
  };
  return (
    <AutomationDashboardView
      {...list}
      loading={loading}
      error={error}
      status={query.status}
      offset={query.offset}
      selectedId={selectedId}
      detail={detail}
      detailLoading={detailLoading}
      detailError={detailError}
      artifact={artifact}
      artifactLoading={artifactLoading}
      artifactError={artifactError}
      exportError={exportError}
      copied={copied}
      onFilter={(status) => {
        resetSelection();
        setQuery((q) => ({ ...q, status, offset: 0 }));
      }}
      onPage={(offset) => {
        resetSelection();
        setQuery((q) => ({ ...q, offset }));
      }}
      onRefresh={() => {
        setInspectId(null);
        setArtifact(null);
        setQuery((q) => ({ ...q, revision: q.revision + 1 }));
      }}
      onSelect={(id) => {
        if (id === selectedId) return;
        setDetail(null);
        setDetailLoading(true);
        setArtifact(null);
        setInspectId(null);
        setSelectedId(id);
      }}
      onInspect={() => {
        if (detail && canInspectWorkflow(detail)) {
          setArtifact(null);
          setArtifactLoading(true);
          setInspectId(detail.id);
          setInspection((n) => n + 1);
        }
      }}
      onCopy={() => {
        if (!artifact) return;
        setExportError(null);
        const version = copyVersion.current;
        void copyWorkflowBlueprint(artifact)
          .then(() => {
            if (version === copyVersion.current) setCopied(true);
          })
          .catch(() => {
            if (version === copyVersion.current)
              setExportError('Clipboard access failed. Download the JSON instead.');
          });
      }}
      onDownload={() => {
        if (artifact) {
          try {
            downloadWorkflowBlueprint(artifact);
          } catch {
            setExportError('Download failed. Try viewing the workflow again.');
          }
        }
      }}
    />
  );
}
