import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {PhoneInboundPage} from '../src/PhoneInboundPage';
import {NAV_ITEMS,resolvePageFromLocation} from '../src/navigation';
const summary={id:'call-a',occurredAt:'2026-11-03T12:00:00Z',maskedPhone:'•••• 0001',outcome:'callback_requested' as const,providerVerified:false as const};
describe('inbound callback reports',()=>{
 it('connects a saved request to owner Calendar review with customer, requested time and pending-booking notice',()=>{
  const report={...summary,id:'a'.repeat(64),customerName:'Ram',preferredContactTime:'Friday afternoon'};
  const detail={...report,callerPhone:'+919000000001',business:'Retail',serviceNeeded:'Automation',enquirySummary:'Asked for an appointment',callbackRequestId:'callback-'+report.id,callbackConsent:'confirmed'};
  const html=renderToStaticMarkup(<PhoneInboundPage role="owner" ownerIdentity={{userId:'owner',workspaceId:'workspace'}} initialState={{status:'ready',reports:[report],detail}}/>);
  for(const text of ['Ram','Friday afternoon','Review &amp; Approve','Prepare Calendar review','Appointment not confirmed'])expect(html).toContain(text);
  expect(html).not.toContain('Appointment confirmed.');
 });
 it('adds separate inbound/outbound routes and preserves existing history',()=>{
  expect(resolvePageFromLocation('/integrations/phone/inbound')).toBe('phone-inbound');
  expect(resolvePageFromLocation('/integrations/phone/outbound')).toBe('phone-outbound');
  expect(resolvePageFromLocation('/integrations/phone/history')).toBe('phone-history');
  expect(NAV_ITEMS.filter(x=>['Inbound calls','Outbound calls'].includes(x.label)).length).toBe(2);
 });
 it('does not imply real records exist when intake is not configured',()=>{
  const html=renderToStaticMarkup(<PhoneInboundPage role="owner" initialState={{status:'not_configured',reports:[]}}/>);
  expect(html).toContain('Inbound call reports are not connected yet');expect(html).not.toContain('No incoming calls');
 });
 it('shows callback and enquiry separately and counts loaded records',()=>{
  const html=renderToStaticMarkup(<PhoneInboundPage role="owner" initialState={{status:'ready',reports:[summary,{...summary,id:'call-b',outcome:'enquired'}]}}/>);
  for(const text of ['Callback requested','Enquired','2 calls shown','Details'])expect(html).toContain(text);
  expect(html).not.toContain('Booked appointment');expect(html).not.toContain('Calendar');
 });
 it('shows customer fields only in details and escapes untrusted report text',()=>{
  const html=renderToStaticMarkup(<PhoneInboundPage role="owner" initialState={{status:'ready',reports:[summary],detail:{...summary,callerPhone:'+919000000001',customerName:'Ram',business:'Retail',serviceNeeded:'Automation',enquirySummary:'<script>unsafe</script>',callbackRequestId:'request-a'}}}/>);
  for(const text of ['Ram','Retail','Automation','+919000000001','Provider-reported'])expect(html).toContain(text);
  expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');
 });
 it('does not invent missing information or claim review-pending records are booked',()=>{
  const detail={...summary,outcome:'needs_review' as const,callerPhone:null,customerName:null,business:null,serviceNeeded:null,enquirySummary:null,callbackRequestId:null};
  const html=renderToStaticMarkup(<PhoneInboundPage role="owner" initialState={{status:'ready',reports:[detail],detail}}/>);
  expect(html).toContain('Needs review');expect(html).toContain('Not recorded');expect(html).not.toContain('booked');
 });
 it('hides previously loaded customer details immediately when owner access is absent',()=>{
  const detail={...summary,callerPhone:'+919000000001',customerName:'Private name',business:'Private business',serviceNeeded:'Automation',enquirySummary:'Private enquiry',callbackRequestId:'request-a'};
  const html=renderToStaticMarkup(<PhoneInboundPage role="member" initialState={{status:'ready',reports:[summary],detail}}/>);
  expect(html).toContain('Only the workspace owner');
  for(const secret of ['+919000000001','Private name','Private business','Private enquiry','•••• 0001'])expect(html).not.toContain(secret);
 });
 it('shows verified appointment details separately from a callback request',()=>{
  const detail={...summary,outcome:'booked_appointment' as const,callerPhone:'+919000000001',customerName:'Ram',business:'Retail',serviceNeeded:'Automation',enquirySummary:'Asked about services',callbackRequestId:null,
   appointment:{eventId:'verified-event',startsAt:'2026-11-04T10:00:00Z',endsAt:'2026-11-04T10:30:00Z',timezone:'Asia/Kolkata',verification:'verified' as const},durationSeconds:42,providerInteractionId:'20261103/test-call',callStatus:'ended'};
  const html=renderToStaticMarkup(<PhoneInboundPage role="owner" initialState={{status:'ready',reports:[detail],detail}}/>);
  for(const value of ['Booked appointment','Verified appointment','verified-event','42 seconds','20261103/test-call'])expect(html).toContain(value);
 });
 it('does not render expired transcript content or external recording links',()=>{
  const detail={...summary,callerPhone:null,customerName:null,business:null,serviceNeeded:null,enquirySummary:null,callbackRequestId:'request-a',
   transcript:[{speaker:'caller' as const,text:'Expired private conversation',languageBasis:'provider_english' as const}],transcriptExpiresAt:'2000-01-01T00:00:00Z',recordingReference:null};
  const html=renderToStaticMarkup(<PhoneInboundPage role="owner" initialState={{status:'ready',reports:[summary],detail}}/>);
  expect(html).not.toContain('Expired private conversation');expect(html).toContain('Not retained or unavailable');expect(html).not.toContain('<audio');
 });
});
