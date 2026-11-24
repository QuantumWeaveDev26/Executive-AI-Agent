import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {capturePhoneCallEvidence} from '../../../packages/contracts/src/phone-call-evidence';
import type {PhoneCallingRecord} from '../../../packages/contracts/src/phone-calling';
import {PhoneCallReport} from '../src/PhoneCallReport';
import {PhoneCallChatCard} from '../src/PhoneCallChatCard';
import {PhoneHistoryPage} from '../src/PhonePages';
const call:PhoneCallingRecord={id:'call1',approvalId:'11111111-1111-4111-8111-111111111111',draft:{draftId:'d',contactId:'c',contactRevision:1,contactBindingHash:'a'.repeat(64),recipient:{displayName:'Krishna',maskedPhone:'+91 ******6718'},purpose:'Website status',language:'en-IN',maxDurationSeconds:300,aiDisclosure:'AI assistant',consentReference:'consent',idempotencyKey:'idem',mode:'live'},state:'completed',createdAt:'2026-11-05T00:00:00Z',updatedAt:'2026-11-05T00:00:00Z',providerCallId:'attempt',dispatchStatus:'unverified',verified:false,simulated:false,report:{text:'Provider report',spokenText:'Provider report',quotedResponses:['Still pending.'],evidenceIds:['e'],simulated:false,verified:false,conversation:capturePhoneCallEvidence([{role:'assistant',text:'Website status?'},{role:'user',text:'Still pending.'}],'provider_transcript')}};
describe('same stored call report in Chat and History',()=>{
 it('keeps the default report concise and puts remaining ordered exchanges in an expandable section',()=>{
  const record=structuredClone(call);record.report.conversation=capturePhoneCallEvidence(Array.from({length:5},(_,i)=>[{role:'assistant',text:'Question '+i+'?'},{role:'user',text:'Answer '+i+'.'}]).flat(),'provider_transcript');
  const html=renderToStaticMarkup(<PhoneCallReport call={record}/>);
  expect(html).toContain('<summary>More conversation (2 exchanges)</summary>');
  expect(html.indexOf('Thaara: Question 2?')).toBeLessThan(html.indexOf('<summary>More conversation'));
  expect(html.indexOf('Thaara: Question 3?')).toBeGreaterThan(html.indexOf('<summary>More conversation'));
  expect(html).toContain('Available transcript');expect(html).not.toContain('Website work is complete');
 });
 it('links a real completed Chat call to the existing appointment review and never links simulations or pending calls',()=>{
  const record={...call,id:'33333333-3333-4333-8333-333333333333'};
  const render=(c:PhoneCallingRecord)=>renderToStaticMarkup(<PhoneCallChatCard approvalId={c.approvalId} initialState={{call:c,loaded:true}}/>);
  expect(render(record)).toContain('/integrations/phone/outbound?callId='+record.id);
  expect(render({...record,simulated:true})).not.toContain('Review an appointment');
  expect(render({...record,state:'ringing'})).not.toContain('Review an appointment');
 });
 it('offers the existing Calendar review for completed real outbound calls to the authenticated owner only',()=>{
  const record={...call,id:'33333333-3333-4333-8333-333333333333'};
  const render=(role:string)=>renderToStaticMarkup(<PhoneHistoryPage initialState={{calls:[record],openId:record.id}} ownerIdentity={{role,userId:'owner',workspaceId:'workspace'}}/>);
  expect(render('owner')).toContain('Review &amp; Approve appointment');expect(render('owner')).toContain('Appointment not confirmed.');
  expect(render('member')).not.toContain('Review &amp; Approve appointment');
 });
 it('renders identical report markup on both screens, including evidence labels and transcript',()=>{
  const shared=renderToStaticMarkup(<PhoneCallReport call={call}/>);
  expect(renderToStaticMarkup(<PhoneCallChatCard approvalId={call.approvalId} initialState={{call,loaded:true}}/>)).toContain(shared);
  expect(renderToStaticMarkup(<PhoneHistoryPage initialState={{calls:[call],openId:call.id}}/>)).toContain(shared);
  expect(shared).toContain('Thaara: Website status?');expect(shared).toContain('Krishna: Still pending.');expect(shared).toContain('not independently verified');expect(shared).toContain('Available transcript');
 });
 it('never invents missing questions for historical recipient-only reports',()=>{
  const old=structuredClone(call);delete old.report.conversation;
  const html=renderToStaticMarkup(<PhoneCallReport call={old}/>);
  expect(html).toContain('Matching questions and answers were not captured');expect(html).not.toContain('Thaara: Website status?');
 });
 it('previews unsaved recipients but disables dialing until server eligibility is established',()=>{
  const draft={...call.draft,newRecipient:{phoneE164:'+918073486718',consentConfirmed:false,eligibility:'unverified' as const}};
  const html=renderToStaticMarkup(<PhoneCallChatCard approvalId={call.approvalId} initialState={{loaded:true,request:{approvalId:call.approvalId,status:'pending',expiresAt:'2026-11-06T00:00:00Z',draft}}}/>);
  expect(html).toContain('New recipient — not saved to contacts');expect(html).toMatch(/disabled=""[^>]*data-testid="phone-call-now"/);
 });
});
