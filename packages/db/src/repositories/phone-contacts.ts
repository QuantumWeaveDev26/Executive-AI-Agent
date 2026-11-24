import type { AuthenticatedScope, DbClient, TransactionalDbClient } from '../client.js';
import { ConflictError, ForbiddenError, ValidationError } from '../errors.js';
import { AuditEventRepository } from './audit.js';

/** Requires the reviewed `docs/migrations/110a-phone-contacts.review.sql` schema. Not part of the installed chain. */
export type PhoneConsentSource = 'recipient_verbal' | 'recipient_written' | 'recipient_message';
export interface PhoneContactInput {
  displayName: string;
  aliases?: string[];
  phoneE164: string;
  consent: { callingAllowed: boolean; reference: string; source: PhoneConsentSource; recordedAt: string; expiresAt: string };
}
export interface PhoneContactRecord extends PhoneContactInput {
  workspaceId: string;
  userId: string;
  contactId: string;
  revision: number;
  aliases: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const SOURCES = new Set<PhoneConsentSource>(['recipient_verbal', 'recipient_written', 'recipient_message']);
const MAX_CONSENT_MS = 366 * 24 * 60 * 60 * 1000;
const COLUMNS = `workspace_id, owner_user_id, contact_id, revision, display_name, aliases, phone_e164, consent_calling_allowed,
  consent_reference, consent_source, consent_recorded_at, consent_expires_at, archived, created_at, updated_at`;
type Row = {
  workspace_id: string; owner_user_id: string; contact_id: string; revision: string | number; display_name: string; aliases: string[];
  phone_e164: string; consent_calling_allowed: boolean; consent_reference: string; consent_source: PhoneConsentSource;
  consent_recorded_at: string | Date; consent_expires_at: string | Date; archived: boolean; created_at: string | Date; updated_at: string | Date;
};
const iso = (v: string | Date) => new Date(v).toISOString();
async function uniqueAsConflict<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (e) {
    if ((e as { code?: string })?.code === '23505') throw new ConflictError('Another active contact already uses this number.');
    throw e;
  }
}

function toRecord(r: Row): PhoneContactRecord {
  return {
    workspaceId: r.workspace_id, userId: r.owner_user_id, contactId: r.contact_id, revision: Number(r.revision), displayName: r.display_name,
    aliases: [...r.aliases], phoneE164: r.phone_e164, archived: r.archived, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
    consent: { callingAllowed: r.consent_calling_allowed, reference: r.consent_reference, source: r.consent_source, recordedAt: iso(r.consent_recorded_at), expiresAt: iso(r.consent_expires_at) },
  };
}

function validate(input: PhoneContactInput): PhoneContactInput {
  const i = structuredClone(input);
  const text = (v: unknown) => typeof v === 'string' && v === v.trim() && v.length >= 1 && v.length <= 128 && !/[\u0000-\u001f\u007f<>]/.test(v);
  const aliases = i.aliases ?? [];
  const c = i.consent;
  const recorded = Date.parse(c?.recordedAt), expires = Date.parse(c?.expiresAt);
  if (!text(i.displayName) || !Array.isArray(aliases) || aliases.length > 20 || !aliases.every(text)
    || typeof i.phoneE164 !== 'string' || !/^\+91[6-9][0-9]{9}$/.test(i.phoneE164)
    || !c || typeof c.callingAllowed !== 'boolean' || typeof c.reference !== 'string' || !ID.test(c.reference) || !SOURCES.has(c.source)
    || !Number.isFinite(recorded) || !Number.isFinite(expires) || expires <= recorded || expires - recorded > MAX_CONSENT_MS) {
    throw new ValidationError('Invalid phone contact. Use a +91 mobile number, a short name and a consent record of at most one year.');
  }
  return { ...i, aliases };
}

/** Owner-scoped contact directory. Every write is revision-fenced and audited in the same transaction, without the raw number. */
export class PhoneContactRepository {
  constructor(private readonly db: TransactionalDbClient) {}

  private run<T>(scope: AuthenticatedScope, work: (tx: DbClient) => Promise<T>): Promise<T> {
    if (!scope.sessionTokenHash || !['owner', 'admin', 'member'].includes(scope.role ?? '')) throw new ForbiddenError('Phone contacts require an active member session.');
    return this.db.withScopedTransaction(scope, work);
  }

  private audit(tx: DbClient, scope: AuthenticatedScope, action: string, r: PhoneContactRecord) {
    return new AuditEventRepository(tx).create(scope.workspaceId!, action, 'phone_contact',
      { contactId: r.contactId, revision: r.revision, callingAllowed: r.consent.callingAllowed, consentSource: r.consent.source, archived: r.archived },
      scope.userId, r.contactId);
  }

  async listActive(scope: AuthenticatedScope): Promise<PhoneContactRecord[]> {
    return this.run(scope, async (tx) => {
      const { rows } = await tx.query<Row>(`SELECT ${COLUMNS} FROM public.phone_contacts
        WHERE workspace_id=$1 AND owner_user_id=$2 AND NOT archived ORDER BY display_name, contact_id LIMIT 1001`, [scope.workspaceId, scope.userId]);
      return rows.map(toRecord);
    });
  }

  async create(scope: AuthenticatedScope, contactId: string, input: PhoneContactInput): Promise<PhoneContactRecord> {
    if (!ID.test(contactId)) throw new ValidationError('Invalid phone contact id.');
    const i = validate(input);
    return this.run(scope, async (tx) => {
      const { rows } = await tx.query<Row>(`INSERT INTO public.phone_contacts (workspace_id, owner_user_id, contact_id, revision, display_name, aliases,
          phone_e164, consent_calling_allowed, consent_reference, consent_source, consent_recorded_at, consent_expires_at)
        VALUES ($1,$2,$3,1,$4,$5::jsonb,$6,$7,$8,$9,$10,$11)
        ON CONFLICT DO NOTHING RETURNING ${COLUMNS}`,
        [scope.workspaceId, scope.userId, contactId, i.displayName, JSON.stringify(i.aliases), i.phoneE164, i.consent.callingAllowed,
          i.consent.reference, i.consent.source, i.consent.recordedAt, i.consent.expiresAt]);
      if (!rows[0]) throw new ConflictError('A contact with this id or an active contact with this number already exists.');
      const record = toRecord(rows[0]);
      await this.audit(tx, scope, 'phone.contacts.created', record);
      return record;
    });
  }

  async update(scope: AuthenticatedScope, contactId: string, expectedRevision: number, input: PhoneContactInput): Promise<PhoneContactRecord> {
    if (!ID.test(contactId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new ValidationError('Invalid phone contact update.');
    const i = validate(input);
    return this.run(scope, async (tx) => {
      const { rows } = await uniqueAsConflict(() => tx.query<Row>(`UPDATE public.phone_contacts SET revision=revision+1, display_name=$5, aliases=$6::jsonb, phone_e164=$7,
          consent_calling_allowed=$8, consent_reference=$9, consent_source=$10, consent_recorded_at=$11, consent_expires_at=$12
        WHERE workspace_id=$1 AND owner_user_id=$2 AND contact_id=$3 AND revision=$4 AND NOT archived RETURNING ${COLUMNS}`,
        [scope.workspaceId, scope.userId, contactId, expectedRevision, i.displayName, JSON.stringify(i.aliases), i.phoneE164,
          i.consent.callingAllowed, i.consent.reference, i.consent.source, i.consent.recordedAt, i.consent.expiresAt]));
      if (!rows[0]) throw new ConflictError('This contact changed or was archived. Reload it before saving.');
      const record = toRecord(rows[0]);
      await this.audit(tx, scope, 'phone.contacts.updated', record);
      return record;
    });
  }

  async archive(scope: AuthenticatedScope, contactId: string, expectedRevision: number): Promise<PhoneContactRecord> {
    if (!ID.test(contactId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new ValidationError('Invalid phone contact archive.');
    return this.run(scope, async (tx) => {
      const { rows } = await tx.query<Row>(`UPDATE public.phone_contacts SET revision=revision+1, archived=true
        WHERE workspace_id=$1 AND owner_user_id=$2 AND contact_id=$3 AND revision=$4 AND NOT archived RETURNING ${COLUMNS}`,
        [scope.workspaceId, scope.userId, contactId, expectedRevision]);
      if (!rows[0]) throw new ConflictError('This contact changed or was already archived.');
      const record = toRecord(rows[0]);
      await this.audit(tx, scope, 'phone.contacts.archived', record);
      return record;
    });
  }
}
