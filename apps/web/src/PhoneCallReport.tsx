import React from 'react';
import type {PhoneCallingRecord} from '../../../packages/contracts/src/phone-calling';
import {phoneCallExchanges,phoneCallHighlights} from '../../../packages/contracts/src/phone-call-evidence';
import {callReportSentence,phoneCallingStateLabel} from './phone-calling';

/** Both screens consume the same stored report. Never generate dialogue in the browser. */
export function PhoneCallReport({call}:{call:PhoneCallingRecord}){
 const evidence=call.report.conversation;
 const exchanges=evidence?phoneCallExchanges(evidence):[];
 const highlights=evidence?phoneCallHighlights(evidence):null;
 const outcome=highlights?.outcome??'';
 const exchange=({question,answer}:typeof exchanges[number])=><div key={question.sequence}>
  <p>Thaara: {question.text}</p><p>{call.draft.recipient.displayName}: {answer.text}</p>
  <small>{question.source==='provider_english_translation'||answer.source==='provider_english_translation'?'Provider English translation; not an exact quotation.':'Provider-labelled transcript; recognition may be uncertain.'}</small>
 </div>;
 return React.createElement(React.Fragment,null,<section data-testid="phone-shared-report">
  <p><strong>Contact:</strong> {call.draft.recipient.displayName}</p>
  <p><strong>Call purpose:</strong> {call.draft.purpose}</p>
  <p><strong>Call status:</strong> {phoneCallingStateLabel(call.state)}</p>
  <strong>Main outcome</strong><p>{outcome?`Customer reported (extractive ${outcome.length>500?'excerpt':'summary'}): ${outcome.slice(0,500)}${outcome.length>500?'…':''}`:callReportSentence(call)}</p>
  <p className="integration-muted">{call.simulated?'Synthetic test evidence.':'Provider speech-recognition evidence; not independently verified.'} A completed call does not confirm that the requested work was completed.</p>
  <strong>Important conversation</strong>
  {exchanges.slice(0,3).map(exchange)}
  {exchanges.length>3&&<details><summary>More conversation ({exchanges.length-3} exchanges)</summary>{exchanges.slice(3).map(exchange)}</details>}
  {!exchanges.length&&<p>Matching questions and answers were not captured in this stored report. No dialogue has been inferred.</p>}
  {!!highlights?.blockers.length&&<p>Possible blockers mentioned (provider text): {highlights.blockers.map(t=>t.text).join(' ')}</p>}
  {!!highlights?.timeframes.length&&<p>Dates or timeframes mentioned (not verified commitments): {highlights.timeframes.map(t=>t.text).join(' ')}</p>}
  <strong>Next action (suggested)</strong><p>{highlights?.timeframes.length?'Confirm the recorded timeframe, then follow up on it.':'Review the recorded answers and confirm any dates or commitments before following up.'} No follow-up has been scheduled.</p>
  <details><summary>{evidence?.truncated?'Available transcript excerpt (truncated)':'Available transcript'}</summary>
   {evidence?.turns.length?evidence.turns.map(t=><p key={t.sequence}>{t.speaker==='thaara'?'Thaara':t.speaker==='customer'?call.draft.recipient.displayName:'Speaker uncertain'}: {t.text}</p>):
    <><p>Only recipient excerpts are available; Thaara’s turns are missing.</p>{call.report.quotedResponses.map((text,i)=><p key={i}>{text}</p>)}</>}
  </details>
 </section>);
}
