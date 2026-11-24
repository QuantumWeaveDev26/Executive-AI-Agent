import { Type, Static, FormatRegistry } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

if (!FormatRegistry.Has('uuid')) {
  FormatRegistry.Set('uuid', (value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

export const TOPIC_PRIVACY_PURGE = 'privacy_purge';
export const ALLOWED_OUTBOX_TOPICS = [TOPIC_PRIVACY_PURGE] as const;
export type AllowedOutboxTopic = typeof ALLOWED_OUTBOX_TOPICS[number];

export const PrivacyPurgeOutboxPayloadSchema = Type.Object({
  operation_id: Type.String({ format: 'uuid' }),
  workspace_id: Type.String({ format: 'uuid' }),
  user_id: Type.String({ format: 'uuid' }),
  generation: Type.Integer({ minimum: 1 }),
  mode: Type.Union([Type.Literal('history_and_memory'), Type.Literal('account_closure')]),
  cutoff_at: Type.String()
}, { additionalProperties: false });

export type PrivacyPurgeOutboxPayload = Static<typeof PrivacyPurgeOutboxPayloadSchema>;

export const ALLOWED_ERROR_CODES = [
  'OUTBOX_QUEUE_UNAVAILABLE',
  'OUTBOX_UNKNOWN_TOPIC',
  'OUTBOX_MALFORMED_PAYLOAD',
  'OUTBOX_PAYLOAD_MISMATCH',
  'OUTBOX_MAX_RETRIES_EXCEEDED',
  'PURGE_LEASE_EXPIRED',
  'PURGE_FENCE_VIOLATION',
  'PURGE_CHECKPOINT_FAILED',
  'PURGE_LAST_OWNER_BLOCKED',
  'PURGE_MAX_ATTEMPTS_EXCEEDED'
] as const;
export type AllowedErrorCode = typeof ALLOWED_ERROR_CODES[number];

export const ALLOWED_ERROR_CATEGORIES = [
  'TRANSIENT_INFRASTRUCTURE',
  'SYSTEM_VALIDATION',
  'POLICY_VIOLATION',
  'DATABASE_ERROR'
] as const;
export type AllowedErrorCategory = typeof ALLOWED_ERROR_CATEGORIES[number];

export function validateTopicPayload(
  topic: string,
  payload: unknown
): { valid: true; data: PrivacyPurgeOutboxPayload } | { valid: false; errorCode: AllowedErrorCode; reason: string } {
  if (!ALLOWED_OUTBOX_TOPICS.includes(topic as AllowedOutboxTopic)) {
    return {
      valid: false,
      errorCode: 'OUTBOX_UNKNOWN_TOPIC',
      reason: `Topic '${topic}' is not in the allowed topic registry.`
    };
  }

  let parsed: unknown = payload;
  if (typeof payload === 'string') {
    try {
      parsed = JSON.parse(payload);
    } catch {
      return {
        valid: false,
        errorCode: 'OUTBOX_MALFORMED_PAYLOAD',
        reason: 'Outbox payload is not valid JSON.'
      };
    }
  }

  if (!Value.Check(PrivacyPurgeOutboxPayloadSchema, parsed)) {
    return {
      valid: false,
      errorCode: 'OUTBOX_MALFORMED_PAYLOAD',
      reason: 'Outbox payload failed schema validation or contains unauthorized properties.'
    };
  }

  return {
    valid: true,
    data: parsed as PrivacyPurgeOutboxPayload
  };
}
