import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
const strict = { additionalProperties: false };
export const PhoneCallTurnSchema = Type.Object({
    sequence: Type.Integer({ minimum: 0, maximum: 199 }),
    speaker: Type.Union([Type.Literal('thaara'), Type.Literal('customer'), Type.Literal('unknown')]),
    text: Type.String({ minLength: 1, maxLength: 1000 }),
    source: Type.Union([Type.Literal('provider_transcript'), Type.Literal('provider_english_translation')]),
    attribution: Type.Union([Type.Literal('provider_labelled'), Type.Literal('uncertain')]),
}, strict);
export const PhoneCallEvidenceSchema = Type.Object({
    version: Type.Literal(1), turns: Type.Array(PhoneCallTurnSchema, { maxItems: 24 }),
    truncated: Type.Boolean(), verified: Type.Literal(false),
    taskOutcome: Type.Literal('not_independently_verified'),
}, strict);
export const isPhoneCallEvidence = (v) => Value.Check(PhoneCallEvidenceSchema, v)
    && v.turns.every((t, i) => (i === 0 || t.sequence > v.turns[i - 1].sequence)
        && (t.speaker === 'unknown' ? t.attribution === 'uncertain' : t.attribution === 'provider_labelled'));
/** Extractive only: no dialogue, dates, commitments or agreement are generated. */
export function capturePhoneCallEvidence(messages, source) {
    const turns = [];
    let truncated = messages.length > 24, bytes = 0;
    for (const [sequence, message] of messages.slice(0, 24).entries()) {
        if (typeof message.text !== 'string' || !message.text.trim())
            continue;
        const text = message.text.trim();
        truncated ||= text.length > 1000;
        const speaker = message.role === 'assistant' ? 'thaara' : message.role === 'user' ? 'customer' : 'unknown';
        const turn = { sequence, speaker, text: text.slice(0, 1000), source, attribution: speaker === 'unknown' ? 'uncertain' : 'provider_labelled' };
        bytes += new TextEncoder().encode(JSON.stringify(turn)).length;
        if (bytes > 16000) {
            truncated = true;
            break;
        }
        turns.push(turn);
    }
    return { version: 1, turns, truncated, verified: false, taskOutcome: 'not_independently_verified' };
}
/** Adjacency is correspondence, not proof that an answer resolves the question. Unknown turns break the pair. */
export function phoneCallExchanges(evidence) {
    return evidence.turns.flatMap((turn, index) => {
        const answer = evidence.turns[index + 1];
        return turn.speaker === 'thaara' && turn.attribution === 'provider_labelled' && answer?.speaker === 'customer' && answer.attribution === 'provider_labelled' && answer.sequence === turn.sequence + 1
            ? [{ question: turn, answer }] : [];
    });
}
/** Evidence excerpts, not inferred promises or a model-generated interpretation. */
export function phoneCallHighlights(evidence) {
    const answers = evidence.turns.filter(t => t.speaker === 'customer' && t.attribution === 'provider_labelled');
    return {
        outcome: answers.map(t => t.text).join(' ').slice(0, 3000),
        blockers: answers.filter(t => /\b(pending|blocked|delay|cannot|can't|not ready)\b/i.test(t.text)),
        timeframes: answers.filter(t => /\b(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|days?|weeks?|months?|pm|am)\b|\d{1,4}[-/:]\d{1,2}/i.test(t.text)),
    };
}
export const PHONE_PROVIDER_CALL_ID_PATTERN = "^([A-Za-z0-9_.:-]{1,128}|[0-9]{8}/[A-Za-z0-9][A-Za-z0-9_.:-]{0,99})$";
export const isPhoneProviderCallId = (value) => typeof value === 'string' && new RegExp(PHONE_PROVIDER_CALL_ID_PATTERN).test(value);
