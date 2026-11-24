import type {BuildAppOptions} from '../app.js';
import type {DbClient,TransactionalDbClient} from '@thaara/db';
import {createInboundAppointments} from './phone-inbound-appointments.js';
import {createInboundAppointmentOwnerReview} from './phone-inbound-appointment-owner.js';
import {createOutboundAppointments} from './phone-outbound-appointments.js';
import {createPhoneAppointmentCalendarReceiptReader,type PhoneAppointmentCalendar} from './phone-appointment-calendar.js';
import {PhoneInboundEventRepository} from './phone-inbound-event-store.js';
import {createInboundJournalReportFeed} from './phone-inbound-journal-feed.js';
import type {InboundPrincipalTransactions} from './phone-inbound-principal.js';
import type {SarvamInboundServiceProfile} from './phone-sarvam-inbound-service.js';
import type {PhoneCallLedger} from './phone-calling.js';

export interface PhoneAppointmentIntegrationOptions {
 db:TransactionalDbClient;
 calendar:PhoneAppointmentCalendar;
 calls:Pick<PhoneCallLedger,'load'|'durable'>;
 /** Dedicated call-bound principal transaction adapter; never the owner's database session. */
 inbound:{profile:SarvamInboundServiceProfile;interactionId:string;transactions:InboundPrincipalTransactions<DbClient>};
 now?:()=>number;
}

/** Wire the existing appointment services into the existing buildApp options.
 * Local-only until 112h/113h schema admission, service identity and deployment are approved.
 * Does not open a pool, read credentials, register a provider tool or execute a Calendar mutation.
 * No owner-session resolver is selected for Sarvam: capture the inbound request first; the signed-in
 * owner subsequently checks availability and prepares the existing Calendar approval in Phone UI.
 * Outbound review is the existing authenticated follow-up for a completed durable call. This is not
 * an in-call outbound service tool and does not claim to capture unsaved caller speech automatically.
 */
export function createPhoneAppointmentIntegration(options:PhoneAppointmentIntegrationOptions):
 Pick<BuildAppOptions,'phoneAppointments'|'phoneInboundJournal'> {
 if(process.env.NODE_ENV!=='test')throw Error('Phone appointment integration is test-only pending production admission.');
 if(options.calls.durable!==true)throw Error('Phone appointments require the durable call ledger.');
 const {db,calendar,calls,now}=options;
 const profile=structuredClone(options.inbound.profile);
 const repository=new PhoneInboundEventRepository(db);
 const verifyAppointment=createPhoneAppointmentCalendarReceiptReader({db,calendar,now});
 const inbound=createInboundAppointments({
  db,calendar,now,profile,interactionId:options.inbound.interactionId,
  transactions:options.inbound.transactions,
  // An ordinary provider request must never borrow a logged-in owner's authority.
  resolveProposalOwnerSession:async()=>null,
 });
 const inboundOwner=createInboundAppointmentOwnerReview({db,calendar,repository,now});
 const outbound=createOutboundAppointments({db,calendar,calls,now});
 return Object.freeze({
  phoneAppointments:Object.freeze({inbound,inboundOwner,outbound}),
  phoneInboundJournal:createInboundJournalReportFeed({repository,verifyAppointment}),
 });
}
