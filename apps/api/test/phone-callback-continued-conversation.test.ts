import { expect, it } from 'vitest';
import { projectCallbackRequest } from '../src/services/phone-callback-notification.js';
import { projectSarvamCallbackCompletion } from '../src/services/phone-sarvam-callback-completion.js';

const call = { workspaceId: 'workspace', userId: 'owner', callId: 'call-continued', direction: 'inbound' as const,
  occurredAt: '2026-11-11T00:00:00Z', verifiedNumber: '+919000000001' };
const details = { requested: true as const, name: 'Ram', business: 'Retail', service: 'AI integration' };
const turns = [{ speaker: 'agent' as const, text: 'Ram, Retail, AI integration. May I record a callback request for our team?' },
  { speaker: 'caller' as const, text: 'Yes, please.' }];

it.each(['No', 'No, thanks', 'ಇಲ್ಲ', 'नहीं'])('retains callback consent after an unrelated closing answer: %s', answer => {
  expect(projectCallbackRequest({ ...call, turns: [...turns,
    { speaker: 'agent', text: 'Is there anything else you would like to know about our services?' },
    { speaker: 'caller', text: answer }] }, details)).toMatchObject({ notificationStatus: 'pending', phoneNumber: call.verifiedNumber });
});

it('still cancels a confirmed callback when the caller explicitly withdraws it', () => {
  expect(projectCallbackRequest({ ...call, turns: [...turns, { speaker: 'caller', text: 'Please do not call me.' }] }, details)).toBeNull();
});

it('uses the verified incoming number rather than an extracted inbound number', () => {
  const payload = { final_agent_variables: { callback_preference: 'requested', customer_name: details.name,
    business_type: details.business, requested_service: details.service, callback_phone_number: '+919000000099' },
    interaction_transcript: turns.map(turn => ({ role: turn.speaker === 'agent' ? 'agent' : 'user', en_text: turn.text })) };
  expect(projectSarvamCallbackCompletion(call, payload)).toMatchObject({ phoneNumber: call.verifiedNumber, numberSource: 'call_metadata', notificationStatus: 'pending' });
});

it('does not treat extracted requested status as consent without caller evidence', () => {
  expect(projectSarvamCallbackCompletion(call, {
    final_agent_variables: { callback_preference: 'requested', customer_name: 'Ram', business_type: 'Retail', requested_service: 'AI integration' },
    interaction_transcript: [{ role: 'agent', en_text: 'Would you like a callback?' }, { role: 'user', en_text: 'Tell me about your services.' }],
  })).toBeNull();
});

it('keeps a partial caller request for review without using the sample user_name as caller identity', () => {
  expect(projectSarvamCallbackCompletion(call, {
    final_agent_variables: { user_name: 'Manan', callback_preference: 'requested', customer_name: '', business_type: '', requested_service: '' },
    interaction_transcript: [{ role: 'user', en_text: 'Please call me back.' }],
  })).toMatchObject({ name: null, business: null, service: null, phoneNumber: call.verifiedNumber, notificationStatus: 'needs_review' });
});

it('does not create a callback after final extracted withdrawal', () => {
  expect(projectSarvamCallbackCompletion(call, {
    final_agent_variables: { callback_preference: 'declined', customer_name: 'Ram', business_type: 'Retail', requested_service: 'AI integration' },
    interaction_transcript: [...turns.map(turn => ({ role: turn.speaker === 'agent' ? 'agent' : 'user', en_text: turn.text })),
      { role: 'user', en_text: 'Please do not call me.' }],
  })).toBeNull();
});
