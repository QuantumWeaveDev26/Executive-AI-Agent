import React, { useEffect, useRef, useState } from 'react';
import { callbackNotificationLabel, loadPhoneCallbackReports, type CallbackReportFeed } from './phone-callback-reports';

export interface CallbackReportsState {
  status: 'loading' | 'ready' | 'not_configured';
  reports: CallbackReportFeed['reports'];
  error: string | null;
}
export interface PhoneCallbackReportsProps {
  callId?: string;
  direction?: 'inbound' | 'outbound';
  /** Synthetic/static rendering only. */
  initialState?: Partial<CallbackReportsState>;
}

/** Read-only callback results inside existing Phone/Chat views. Never starts a call or sends mail. */
export function PhoneCallbackReports({ callId, direction, initialState }: PhoneCallbackReportsProps): React.ReactElement {
  const [state, setState] = useState<CallbackReportsState>({ status: 'loading', reports: [], error: null, ...initialState });
  const request = useRef<AbortController | null>(null);
  const load = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    // Clear previous private data before a new read, including after session/permission changes.
    setState({ status: 'loading', reports: [], error: null });
    try {
      const feed = await loadPhoneCallbackReports(controller.signal);
      if (!controller.signal.aborted) setState({ ...feed, error: null });
    } catch (error) {
      if (!controller.signal.aborted) setState({ status: 'ready', reports: [], error: error instanceof Error ? error.message : 'Callback reports unavailable.' });
    }
  };
  useEffect(() => {
    if (!initialState) void load();
    return () => request.current?.abort();
  }, [callId, direction, initialState]);
  const reports = state.reports.filter(report => (!callId || report.callId === callId) && (!direction || report.direction === direction));
  return <section className="phone-history-details" aria-label="Callback requests" data-testid="phone-callback-reports">
    <h3>Callback requests</h3>
    {state.status === 'loading' && <p role="status">Loading callback reports…</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {state.status === 'not_configured' && <p>Callback reporting is not configured in this environment.</p>}
    {state.status === 'ready' && !state.error && !reports.length && <p>No saved callback request is available{callId ? ' for this call' : ''} in the latest reports.</p>}
    {reports.map(report => <article key={report.requestId} data-testid="phone-callback-report">
      <p><strong>{report.direction === 'inbound' ? 'Incoming' : 'Outgoing'} callback request</strong></p>
      <p><strong>Name:</strong> {report.name || 'Not provided'}</p>
      <p><strong>Phone:</strong> {report.phoneNumber || 'Not provided'}</p>
      <p><strong>Business:</strong> {report.business || 'Not provided'}</p>
      <p><strong>Service needed:</strong> {report.service || 'Not provided'}</p>
      <p><strong>Caller confirmation:</strong> {report.callbackConfirmed ? 'Confirmed' : 'Incomplete; human review required'}</p>
      <p><strong>Email status:</strong> {callbackNotificationLabel(report.notificationStatus)}</p>
      {!!report.missingFields.length && <p>Missing details: {report.missingFields.join(', ')}</p>}
    </article>)}
    <button type="button" className="btn btn-secondary" disabled={state.status === 'loading'} onClick={() => void load()}>Refresh callback reports</button>
  </section>;
}
