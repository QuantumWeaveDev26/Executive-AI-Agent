import {PhoneContactRepository,type TransactionalDbClient} from '@thaara/db';
import type {PhoneContact,PhoneContactDirectory} from './phone-calling.js';

/**
 * Durable, RLS-scoped directory for PhoneCallingService. Requires the reviewed 110a schema, so it is opt-in:
 * the default app never wires it. Consent is the owner-attested record; approval of a call never creates it.
 */
export function createPostgresPhoneContactDirectory(db:TransactionalDbClient):PhoneContactDirectory{
 const contacts=new PhoneContactRepository(db);
 return {async list(scope){
  return (await contacts.listActive(scope)).map((c):PhoneContact=>({workspaceId:c.workspaceId,userId:c.userId,id:c.contactId,revision:c.revision,displayName:c.displayName,aliases:c.aliases,phoneE164:c.phoneE164,consent:{reference:c.consent.reference,expiresAt:c.consent.expiresAt,callingAllowed:c.consent.callingAllowed}}));
 }};
}
