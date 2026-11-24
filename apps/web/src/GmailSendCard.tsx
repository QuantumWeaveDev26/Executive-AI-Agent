import type { ApprovalRequestItem, PlanWithStepsItem } from './api';
import { gmailSendOutcomeFromPlan } from './gmail-api';
import { sendResultMessage } from './gmail-model';

export interface GmailSendChatCardProps {
  approval?: ApprovalRequestItem;
  plan?: PlanWithStepsItem;
  canDecide: boolean;
  decideReason?: string;
  deciding: boolean;
  refreshing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onRefresh: () => void;
}

type CardState = 'waiting' | 'sending' | 'sent' | 'failed' | 'unverified' | 'cancelled' | 'expired';

const STATE_LABEL: Record<CardState, { text: string; className: string }> = {
  waiting: { text: 'Waiting for you', className: 'badge badge-warning' },
  sending: { text: 'Sending…', className: 'badge badge-info' },
  sent: { text: 'Sent', className: 'badge badge-success' },
  failed: { text: 'Not sent', className: 'badge badge-danger' },
  unverified: { text: 'Could not confirm', className: 'badge badge-danger' },
  cancelled: { text: 'Cancelled', className: 'badge badge-neutral' },
  expired: { text: 'Expired', className: 'badge badge-neutral' },
};

/**
 * Simple Gmail send card for Thaara Chat: shows To / Subject / Message with Confirm & Send and Cancel.
 * "Sent" is shown only for a verified receipt where Gmail accepted the message; technical identifiers
 * stay inside a collapsed "Technical details" section.
 */
export function GmailSendChatCard(p: GmailSendChatCardProps) {
  const step = p.plan?.steps.find(
    (s) => s.action_name === 'gmail.messages.send_new' || s.action_name === 'gmail.messages.send_reply',
  );
  const actionName = p.approval?.actionName ?? step?.action_name ?? 'gmail.messages.send_new';
  const isReply = actionName === 'gmail.messages.send_reply';
  const params = (p.approval?.actionParams ?? step?.parameters ?? {}) as Record<string, unknown>;
  const to = typeof params.to === 'string' ? params.to : '';
  const cc = typeof params.cc === 'string' && params.cc ? params.cc : null;
  const subject = typeof params.subject === 'string' && params.subject ? params.subject : 'optional';
  const body = typeof params.bodyText === 'string' ? params.bodyText : '';
  const from = typeof params.connectedEmail === 'string' ? params.connectedEmail : null;

  const outcome = p.plan ? gmailSendOutcomeFromPlan(p.plan, to) : null;
  const expired = Boolean(p.approval && p.approval.status === 'pending' && new Date(p.approval.expiresAt) < new Date());
  let state: CardState;
  if (outcome && outcome.kind !== 'pending') {
    state = outcome.kind;
  } else if (p.approval?.status === 'rejected') {
    state = 'cancelled';
  } else if (p.approval?.status === 'expired' || expired) {
    state = 'expired';
  } else if (p.approval?.status === 'approved') {
    state = 'sending';
  } else {
    state = 'waiting';
  }

  const receipt = step ? p.plan?.receipts.find((r) => r.plan_step_id === step.id) : undefined;
  const label = STATE_LABEL[state];
  const resultText =
    state === 'sent' || state === 'failed' || state === 'unverified' || state === 'cancelled'
      ? sendResultMessage(outcome && outcome.kind !== 'pending' ? outcome : { kind: state, to })
      : state === 'expired'
        ? 'This draft expired. No email was sent. Ask Thaara to prepare it again.'
        : state === 'sending'
          ? 'Approved. Waiting for Gmail to answer…'
          : null;

  return (
    <div className="chat-plan-card" data-testid="gmail-send-chat-card">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        <strong>{isReply ? 'Reply' : 'Email'} to {to || 'recipient'}</strong>
        <span className={label.className} data-testid="gmail-send-chat-status">
          {label.text}
        </span>
      </div>
      <div style={{ display: 'grid', gap: '0.25rem', fontSize: '0.84rem' }}>
        {from && (
          <div>
            <strong>From:</strong> {from}
          </div>
        )}
        <div>
          <strong>To:</strong> {to}
        </div>
        {cc && (
          <div>
            <strong>Cc:</strong> {cc}
          </div>
        )}
        <div>
          <strong>Subject:</strong> {subject}
        </div>
        <div>
          <strong>Message:</strong>
        </div>
        <pre
          style={{
            margin: 0,
            padding: '0.55rem 0.7rem',
            borderRadius: '6px',
            background: 'var(--surface-muted)',
            border: '1px solid var(--border-color)',
            fontFamily: 'var(--font-sans)',
            fontSize: '0.85rem',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
          data-testid="gmail-send-chat-body"
        >
          {body}
        </pre>
      </div>

      {state === 'waiting' &&
        (p.canDecide ? (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={p.deciding}
              onClick={p.onConfirm}
              data-testid="gmail-send-chat-confirm"
              style={{ padding: '0.35rem 0.8rem', fontSize: '0.8rem' }}
            >
              {p.deciding ? 'Sending…' : 'Approve & Send'}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={p.deciding}
              onClick={p.onCancel}
              data-testid="gmail-send-chat-cancel"
              style={{ padding: '0.35rem 0.8rem', fontSize: '0.8rem' }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ fontSize: '0.78rem', color: 'var(--warning)', marginTop: '0.5rem' }}>
            {p.decideReason || 'Only the person who prepared this email can send it.'}
          </div>
        ))}

      {resultText && (
        <p style={{ margin: '0.6rem 0 0', fontSize: '0.84rem' }} role="status" data-testid="gmail-send-chat-result">
          {resultText}
        </p>
      )}
      {state === 'sending' && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={p.refreshing}
          onClick={p.onRefresh}
          style={{ marginTop: '0.4rem', padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
        >
          {p.refreshing ? 'Checking…' : 'Check again'}
        </button>
      )}

      <details style={{ marginTop: '0.6rem', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
        <summary>Technical details</summary>
        <div style={{ fontFamily: 'var(--font-mono)', display: 'grid', gap: '0.15rem', marginTop: '0.3rem' }}>
          {p.plan && <div>Plan: {p.plan.id} ({p.plan.status})</div>}
          {p.approval && (
            <div>
              Approval: {p.approval.id} ({p.approval.status})
            </div>
          )}
          <div>Action: {actionName}</div>
          {step && <div>Step: {step.status}</div>}
          {receipt && (
            <div>
              Receipt: {receipt.status} via {receipt.verification_method}
            </div>
          )}
          {outcome?.providerMessageId && <div>Gmail message ID: {outcome.providerMessageId}</div>}
          {outcome?.providerThreadId && <div>Gmail thread ID: {outcome.providerThreadId}</div>}
        </div>
      </details>
    </div>
  );
}
