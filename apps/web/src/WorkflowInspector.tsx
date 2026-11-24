import React from 'react';
import { StagedEmailWorkflowArtifactItem } from './api';

function blueprintJson(artifact: StagedEmailWorkflowArtifactItem): string {
  if (artifact.active !== false || artifact.workflowDefinition.n8nBlueprint.active !== false ||
      artifact.realEmailSent !== false || artifact.externalAccountsContacted !== false ||
      artifact.externalDeploymentStatus !== 'not_configured') throw new Error('Only inactive offline workflows can be exported.');
  return JSON.stringify(artifact.workflowDefinition.n8nBlueprint, null, 2);
}

export async function copyWorkflowBlueprint(artifact: StagedEmailWorkflowArtifactItem): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) throw new Error('Clipboard unavailable. Download the JSON instead.');
  await navigator.clipboard.writeText(blueprintJson(artifact));
}

export function downloadWorkflowBlueprint(artifact: StagedEmailWorkflowArtifactItem): void {
  const blob = new Blob([blueprintJson(artifact)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = artifact.artifactId.replace(/[^a-zA-Z0-9_-]/g, '_') + '.n8n-workflow.json';
    document.body.appendChild(link);
    link.click();
  } finally { link.remove(); URL.revokeObjectURL(url); }
}

export function WorkflowInspector({ artifact, copied, onCopy, onDownload }: {
  artifact: StagedEmailWorkflowArtifactItem; copied: boolean; onCopy(): void; onDownload(): void;
}): React.ReactElement {
  return (
<div
                                    style={{
                                      marginTop: '0.65rem',
                                      padding: '0.85rem',
                                      background: 'var(--bg-muted)',
                                      border: '1px solid var(--accent-border)',
                                      borderRadius: '8px'
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                        gap: '0.5rem',
                                        marginBottom: '0.5rem'
                                      }}
                                    >
                                      <div>
                                        <strong>
                                          Verified Offline Workflow:{' '}
                                          {artifact.workflowDefinition.workflowName}
                                        </strong>
                                        <div
                                          style={{
                                            fontSize: '0.74rem',
                                            color: 'var(--text-muted)',
                                            fontFamily: 'monospace'
                                          }}
                                        >
                                          Artifact: {artifact.artifactId} | Trigger:{' '}
                                          {artifact.workflowDefinition.triggerType} |
                                          Status: {artifact.stagingStatus} (active:{' '}
                                          {String(
                                            artifact.workflowDefinition.n8nBlueprint
                                              .active
                                          )}
                                          )
                                        </div>
                                      </div>
                                      <div style={{ display: 'flex', gap: '0.45rem' }}>
                                        <button
                                          type="button"
                                          className="btn btn-secondary"
                                          onClick={onCopy}
                                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                                        >
                                          {copied
                                            ? 'Copied JSON!'
                                            : 'Copy JSON'}
                                        </button>
                                        <button
                                          type="button"
                                          className="btn"
                                          onClick={onDownload}
                                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                                        >
                                          Download JSON
                                        </button>
                                      </div>
                                    </div>

                                    <div
                                      style={{
                                        fontSize: '0.76rem',
                                        color: 'var(--text-muted)',
                                        marginBottom: '0.45rem'
                                      }}
                                    >
                                      <strong>Blueprint Nodes:</strong>
                                      <div
                                        style={{
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: '0.25rem',
                                          marginTop: '0.25rem'
                                        }}
                                      >
                                        {artifact.workflowDefinition.n8nBlueprint.nodes.map(
                                          (node, idx) => (
                                            <div
                                              key={node.id}
                                              style={{
                                                padding: '0.35rem 0.6rem',
                                                background: 'var(--bg-surface)',
                                                border: '1px solid var(--border)',
                                                borderRadius: '6px',
                                                color: 'var(--text-primary)',
                                                fontFamily: 'monospace'
                                              }}
                                            >
                                              {idx + 1}. {node.name} ({node.type})
                                            </div>
                                          )
                                        )}
                                      </div>
                                    </div>

                                    <div style={{ fontSize: '0.76rem', marginBottom: '0.35rem' }}>
                                      <strong>Safe n8n Blueprint JSON Preview (active: false):</strong>
                                    </div>
                                    <pre
                                      style={{
                                        margin: 0,
                                        padding: '0.75rem',
                                        maxHeight: '220px',
                                        overflow: 'auto',
                                        background: 'var(--bg-surface)',
                                        border: '1px solid var(--border)',
                                        borderRadius: '6px',
                                        fontSize: '0.74rem',
                                        color: 'var(--text-primary)'
                                      }}
                                    >
                                      {JSON.stringify(
                                        artifact.workflowDefinition.n8nBlueprint,
                                        null,
                                        2
                                      )}
                                    </pre>
                                  </div>
  );
}
