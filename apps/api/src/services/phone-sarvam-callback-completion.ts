import { projectCallbackRequest, type AdmittedCallbackCall } from './phone-callback-notification.js';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

/** Call only after provider admission. Scope and the default number come from the admitted binding. */
export function projectSarvamCallbackCompletion(call: Omit<AdmittedCallbackCall, 'turns'>, payload: unknown) {
  const body = object(payload);
  const variables = { ...object(body.output_agent_variables), ...object(body.final_agent_variables) };
  const preference = typeof variables.callback_preference === 'string' ? variables.callback_preference.trim().toLowerCase() : '';
  if (!['yes', 'requested', 'callback requested'].includes(preference)) return null;
  if (!Array.isArray(body.interaction_transcript) || body.interaction_transcript.length > 200) return null;
  const turns: AdmittedCallbackCall['turns'][number][] = [];
  for (const value of body.interaction_transcript) {
    const turn = object(value);
    const text = typeof turn.indic_text === 'string' && turn.indic_text.trim() ? turn.indic_text : turn.en_text;
    if ((turn.role !== 'agent' && turn.role !== 'user') || typeof text !== 'string' || text.length > 2000) return null;
    turns.push({ speaker: turn.role === 'agent' ? 'agent' : 'caller', text,
      englishText: typeof turn.en_text === 'string' && turn.en_text.length <= 2000 ? turn.en_text : undefined });
  }
  const detail = (value: unknown) => typeof value === 'string' && value.trim().length <= 240 ? value.trim() : null;
  // Inbound callbacks use the admitted caller metadata. Model-extracted numbers cannot replace it.
  const phoneNumber = call.direction === 'inbound' ? null : variables.callback_phone_number;
  return projectCallbackRequest({ ...call, turns }, { requested: true,
    name: detail(variables.customer_name), business: detail(variables.business_type), service: detail(variables.requested_service),
    phoneNumber: phoneNumber == null ? null : detail(phoneNumber) || 'unverified',
  });
}
