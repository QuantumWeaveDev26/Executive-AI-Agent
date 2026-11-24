import {randomUUID} from 'node:crypto';
import {Value} from '@sinclair/typebox/value';
import {PhoneContactCreateSchema,PhoneContactUpdateSchema,type PhoneContactCreate,type PhoneContactUpdate,type PhoneContactView} from '@thaara/contracts';
import type {AuthenticatedScope,PhoneContactInput,PhoneContactRecord,PhoneContactRepository} from '@thaara/db';
import {AppError,ForbiddenError} from '@thaara/observability';
import {maskPhoneCallNumber} from './phone.js';

const day=86400000;
const notConfigured=()=>new AppError('Saved phone contacts are not set up in this environment. Nothing was saved.','PHONE_CONTACTS_NOT_CONFIGURED',503);

/**
 * Owner contact management for AI calling. Consent is owner-attested and re-recorded (new reference, new time) on every
 * save, so editing a contact always re-affirms consent. Raw numbers are write-only: views carry the masked number.
 */
export class PhoneContactManagementService{
 constructor(private readonly repository?:PhoneContactRepository,private readonly now:()=>number=Date.now){}
 private repo(scope:AuthenticatedScope){
  if(!this.repository)throw notConfigured();
  if(!scope.sessionTokenHash||!['owner','admin','member'].includes(scope.role??''))throw new ForbiddenError('Phone contacts require an active member session.');
  return this.repository;
 }
 private view(c:PhoneContactRecord):PhoneContactView{
  return {contactId:c.contactId,revision:c.revision,displayName:c.displayName,aliases:[...c.aliases],maskedPhone:maskPhoneCallNumber(c.phoneE164),archived:c.archived,
   consent:{callingAllowed:c.consent.callingAllowed,source:c.consent.source,recordedAt:c.consent.recordedAt,expiresAt:c.consent.expiresAt,expired:Date.parse(c.consent.expiresAt)<=this.now()}};
 }
 private input(body:PhoneContactCreate|PhoneContactUpdate,phoneE164:string):PhoneContactInput{
  const recorded=this.now();
  return {displayName:body.displayName.trim(),aliases:[...new Set((body.aliases??[]).map(a=>a.trim()).filter(Boolean))],phoneE164,
   consent:{callingAllowed:body.consent.callingAllowed,source:body.consent.source,reference:'consent-'+randomUUID(),recordedAt:new Date(recorded).toISOString(),expiresAt:new Date(recorded+body.consent.validDays*day).toISOString()}};
 }
 async list(scope:AuthenticatedScope){return {contacts:(await this.repo(scope).listActive(scope)).map(c=>this.view(c))};}
 async create(scope:AuthenticatedScope,body:PhoneContactCreate){
  const repo=this.repo(scope);if(!Value.Check(PhoneContactCreateSchema,body))throw new AppError('Invalid phone contact.','PHONE_CONTACT_INPUT',400);
  return this.view(await repo.create(scope,'pc-'+randomUUID(),this.input(body,body.phoneE164)));
 }
 async update(scope:AuthenticatedScope,contactId:string,body:PhoneContactUpdate){
  const repo=this.repo(scope);if(!Value.Check(PhoneContactUpdateSchema,body))throw new AppError('Invalid phone contact.','PHONE_CONTACT_INPUT',400);
  // Keeping the number requires reading the current owner-scoped record; the revision fence still rejects concurrent changes.
  const current=body.phoneE164?undefined:(await repo.listActive(scope)).find(c=>c.contactId===contactId);
  const phone=body.phoneE164??current?.phoneE164;
  if(!phone)throw new AppError('This contact changed or was archived. Reload it before saving.','CONFLICT',409);
  return this.view(await repo.update(scope,contactId,body.expectedRevision,this.input(body,phone)));
 }
 async archive(scope:AuthenticatedScope,contactId:string,expectedRevision:number){return this.view(await this.repo(scope).archive(scope,contactId,expectedRevision));}
}
