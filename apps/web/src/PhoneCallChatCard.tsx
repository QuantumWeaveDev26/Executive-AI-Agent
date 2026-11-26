import {PhoneCallReport} from './PhoneCallReport';
import {PhoneCallbackReports} from './PhoneCallbackReports';
import { useEffect, useRef, useState } from 'react';
import { ApiRequestError } from './api';
import {
  LANGUAGE_LABELS,
  callReportSentence,
  confirmPhoneCall,
  preparePhoneCall,
  fetchPhoneCallReportAudio,
  isTerminalCallState,
  loadPhoneCallingHistory,
  loadPhoneCallingRequests,
  phoneCallStartError,
  readPhoneCallProviderResult,
  speakPhoneCallReport,
  type PhoneCallingRecord,
  type PhoneCallingRequest,
} from './phone-calling';
import type {PhoneCallingProviderResult} from '../../../packages/contracts/src/phone-calling';

export interface PhoneCallChatCardState {
  request: PhoneCallingRequest | null;
  call: PhoneCallingRecord | null;
  loaded: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
}
export interface PhoneCallChatCardProps {
  approvalId: string | null;
  /** Tests/static rendering only; when given, nothing is loaded from the server. */
  initialState?: Partial<PhoneCallChatCardState>;
}
const EMPTY: PhoneCallChatCardState = { request: null, call: null, loaded: false, busy: false, error: null, notice: null };
const POLL_MS = 5000, POLL_LIMIT = 180; // up to 15 minutes while this chat is open

/**
 * Chat card for "call <person> and ask …". Shows the exact request; one tap on "Call now" is the owner's approval for this one
 * call. Then it follows the call and shows what the person said, with Thaara's voice on request. It never dials by itself.
 */
export function PhoneCallChatCard({ approvalId, initialState }: PhoneCallChatCardProps) {
  const [state, setState] = useState<PhoneCallChatCardState>({ ...EMPTY, ...initialState });
  const [providerResult,setProviderResult]=useState<PhoneCallingProviderResult|null>(null);
  const [checking,setChecking]=useState(false);
  const [recipientName,setRecipientName]=useState('');
  const [recipientConsent,setRecipientConsent]=useState(false);
  const reading=useRef(false);
  const patch = (p: Partial<PhoneCallChatCardState>) => setState((s) => ({ ...s, ...p }));
  const audioUrl = useRef<string | null>(null);
  const starting = useRef(false);
  const mounted = useRef(true);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; audio.current?.pause(); if (audioUrl.current) URL.revokeObjectURL(audioUrl.current); }; }, []);

  useEffect(() => {
    if (initialState || !approvalId) return;
    const controller = new AbortController();
    let polls = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const [reqRes, histRes] = await Promise.allSettled([
          loadPhoneCallingRequests(controller.signal),
          loadPhoneCallingHistory(controller.signal)
        ]);
        if (controller.signal.aborted) return;
        if (reqRes.status === 'rejected' && histRes.status === 'rejected') {
          throw reqRes.reason;
        }
        const requests = reqRes.status === 'fulfilled' ? reqRes.value : [];
        const calls = histRes.status === 'fulfilled' ? histRes.value.calls : [];
        const call = calls.find((c) => (c.approvalId === approvalId || c.draft.newRecipient?.previewApprovalId === approvalId)) ?? null;
        setState((s) => ({ ...s, loaded: true, request: requests.find((r) => (r.approvalId === approvalId || r.draft.newRecipient?.previewApprovalId === approvalId)) ?? null, call }));
        if (call && !isTerminalCallState(call.state) && ++polls < POLL_LIMIT) timer = setTimeout(() => void load(), POLL_MS);
      } catch {
        if (!controller.signal.aborted) patch({ loaded: true, request: null, call: null, error: 'Unable to load this call. Refresh to check its status.' });
      }
    };
    void load();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [approvalId, initialState, state.call?.id]);

  const callNow = async () => {
    if (!state.request || !approvalId || state.busy || starting.current || state.call) return;
    starting.current = true;
    patch({ busy: true, error: null });
    try {
      const call = await confirmPhoneCall(state.request.approvalId, state.request.draft);
      if (!mounted.current) return;
      patch({ busy: false, call });
    } catch (err) {
      const status = err instanceof ApiRequestError ? err.status : 0;
      if (mounted.current) patch({ busy: false, request: null, error: phoneCallStartError(status) });
    } finally {
      starting.current = false;
    }
  };

  const playReport = async () => {
    const call = state.call;
    if (!call) return;
    patch({ notice: null });
    try {
      const blob = await fetchPhoneCallReportAudio(call.id);
      if (!mounted.current) return;
      audio.current?.pause();
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = URL.createObjectURL(blob);
      audio.current = new Audio(audioUrl.current);
      await audio.current.play();
    } catch {
      if (!mounted.current) return;
      // Thaara's voice is not available: fall back to the browser voice reading the same written report.
      const outcome = speakPhoneCallReport({ ...call, report: { ...call.report, spokenText: callReportSentence(call) } });
      patch({ notice: outcome === 'speaking' ? "Reading with the browser voice (Thaara's voice is not set up)." : 'Voice playback is not available here. The written report is above.' });
    }
  };
  const checkProvider = async () => {
    if(!state.call||reading.current)return;
    reading.current=true;setChecking(true);patch({notice:null});
    try{const result=await readPhoneCallProviderResult(state.call.id);if(mounted.current)setProviderResult(result);}
    catch{if(mounted.current){setProviderResult(null);patch({notice:'Provider result is unavailable. No new call was requested.'});}}
    finally{reading.current=false;if(mounted.current)setChecking(false);}
  };

  if (!approvalId) return null;
  const { request, call } = state;
  const draft = call?.draft ?? request?.draft;

  return (
    <div className="chat-plan-card" data-testid="phone-call-chat-card">
      {!draft && <p className="integration-muted">{state.loaded ? 'This call request has expired or is not available.' : 'Loading call request…'}</p>}
      {draft && (
        <>
          <strong>{draft.mode === 'live' ? 'Phone call' : 'Phone call (test simulation)'}: {draft.recipient.displayName} ({draft.recipient.maskedPhone})</strong>
          <div className="integration-muted">Ask: {draft.purpose}</div>
          <div className="integration-muted">Maximum length: {draft.maxDurationSeconds / 60} minutes</div>
          <div className="integration-muted">Language: {LANGUAGE_LABELS[draft.language]} · Thaara will say first: “{draft.aiDisclosure}”</div>
        </>
      )}

      {draft?.newRecipient&&!call&&<div data-testid="phone-new-recipient">
        <strong>New recipient — not saved to contacts</strong>
        <p>{draft.newRecipient.phoneE164}</p>
        <label>Recipient name<input value={recipientName} maxLength={128} onChange={e=>setRecipientName(e.target.value)}/></label>
        <label><input type="checkbox" checked={recipientConsent} onChange={e=>setRecipientConsent(e.target.checked)}/>This person has agreed to this call for the displayed purpose.</label>
        <p>{draft.newRecipient.eligibility==='eligible'?'Eligibility checked; final approval is still required.':'Calling blocked until recipient consent, calling hours and provider eligibility are verified.'}</p>
        <button type="button" disabled={state.busy||!recipientName.trim()||!recipientConsent} onClick={async()=>{
          patch({busy:true,error:null});
          try{const p=await preparePhoneCall({contactQuery:draft.newRecipient!.phoneE164,purpose:draft.purpose,language:draft.language,maxDurationSeconds:draft.maxDurationSeconds,newRecipient:{previewApprovalId:draft.newRecipient?.previewApprovalId??state.request?.approvalId,displayName:recipientName.trim(),consentConfirmed:recipientConsent}});
            if(mounted.current)patch({busy:false,request:{approvalId:p.approvalId,status:'pending',expiresAt:new Date(Date.now()+900000).toISOString(),draft:p.draft}});
          }catch{if(mounted.current)patch({busy:false,error:'Recipient details could not be prepared. No call was made.'});}
        }}>Review this recipient</button>
      </div>}
      {draft && !call && draft.mode === 'live' && (
        <button type="button" className="btn btn-primary" disabled={state.busy || !request || !!draft.newRecipient&&(draft.newRecipient.eligibility!=='eligible'||!draft.newRecipient.consentConfirmed)} onClick={() => void callNow()} data-testid="phone-call-now">
          {state.busy ? 'Starting call…' : `Call ${draft.recipient.displayName} now`}
        </button>
      )}
      {draft && !call && draft.mode !== 'live' && (
        <p className="integration-muted" data-testid="phone-call-off">Real calling is switched off, so this request cannot place a call.</p>
      )}

      {call && (
        <div data-testid="phone-call-status" role="status">
          <PhoneCallReport call={call} />
          {!call.simulated && isTerminalCallState(call.state) && <PhoneCallbackReports key={call.id} callId={call.id} direction="outbound" />}
          {!call.simulated&&call.state==='completed'&&call.providerCallId&&/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(call.id)&&(
            <p><a href={`/integrations/phone/outbound?callId=${encodeURIComponent(call.id)}`}>Review an appointment for this call</a> — owner Calendar approval is required; this does not book an appointment.</p>
          )}
          {!call.simulated&&<button type="button" className="btn btn-secondary" disabled={checking} onClick={()=>void checkProvider()}>{checking?'Checking…':'Check provider result'}</button>}
          {providerResult&&<div data-testid="phone-provider-result">
            <strong>Provider-reported result · Unverified</strong>
            <p>{providerResult.status==='available'?`Call outcome: ${providerResult.outcome??'unavailable'}`:providerResult.status==='pending'?'Provider result is not available yet.':'Provider result could not be confirmed.'}</p>
            <p>Read-only provider lookup. This has not replaced the shared stored report above.</p>
            {providerResult.status==='available'&&providerResult.responses.length===0&&<p>No recipient transcript was returned.</p>}
          </div>}
          {isTerminalCallState(call.state) ? (
            <button type="button" className="btn btn-secondary" onClick={() => void playReport()} data-testid="phone-call-play">Play report</button>
          ) : (
            <p className="integration-muted">{call.dispatchStatus === 'unknown' || call.dispatchStatus === 'claimed'
              ? 'A call outcome is not confirmed. Check call history before taking any further action.'
              : 'Waiting for a provider update. Only recorded results will appear here.'}</p>
          )}
        </div>
      )}
      {state.error && <div className="error-banner" role="alert" data-testid="phone-call-error">{state.error}</div>}
      {state.notice && <p className="integration-muted" data-testid="phone-call-notice">{state.notice}</p>}
    </div>
  );
}
