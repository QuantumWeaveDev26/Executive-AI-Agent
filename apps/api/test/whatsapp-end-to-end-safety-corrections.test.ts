import { describe, expect, it } from 'vitest';
import { defaultPolicyGateway } from '@thaara/policy';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import {
  WhatsAppTransactionalFixture,
  waScope,
  waBinding,
  waNow
} from './helpers/whatsapp-durable-fixture.js';

describe('THAARA V2 — Safety Corrections Before Deployment', () => {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it('1. Stable Idempotency & Provider Acceptance: repeated clicks for same consultation do not duplicate sends, and alreadySent is true only after provider acceptance', async () => {
    const fixture = new WhatsAppTransactionalFixture();
    let clock = waNow;
    const service = new DurableWhatsAppService(fixture as any, defaultPolicyGateway, () => clock);

    // Initial confirmation by owner
    const appt: any = {
      status: 'AWAITING_CUSTOMER_BOOKING',
      calendlyUrl: 'https://calendly.com/team-brandmint/30min',
      customerName: 'Krishna',
      customerEmail: 'example@gmail.com',
      service: 'WhatsApp Automation',
      business: 'Clothing / Fashion',
      duration: '30 Minutes',
      startAt: '2026-11-12T10:00:00Z',
      date: '2026-11-12'
    };
    const bodyText = 'Your 30-minute consultation request has been approved.\n\nPlease select and confirm your preferred slot here:\nhttps://calendly.com/team-brandmint/30min\n\nWe look forward to speaking with you.';

    const first = await service.dispatchAppointmentApproval(
      waScope,
      waBinding.connectionId,
      'ram',
      appt,
      bodyText
    );

    expect(first.status).toBe('AWAITING_CUSTOMER_BOOKING');
    expect(first.bookingLinkSent).toBe(true);
    expect(first.receipt?.dispatchId).toBeDefined();
    expect(first.alreadySent).toBeUndefined();
    expect(fixture.state.dispatches.length).toBe(1);

    const firstDispatchId = first.receipt!.dispatchId;
    const firstDispatch = fixture.state.dispatches[0]!;
    // Must NOT fall back to generic 'consultation'
    expect(firstDispatch.draft.idempotencyKey).toBe(`calendly-link-${waBinding.connectionId}-ram-slot-2026-11-12T10:00:00Z`);
    expect(firstDispatch.approvalId).toMatch(UUID_REGEX);

    // Advance clock by 10 seconds (still within active reservation window, provider has NOT accepted yet)
    clock += 10000;

    // Repeated owner click while dispatch is pending/in-flight (provider has not accepted)
    const inFlightRetry = await service.dispatchAppointmentApproval(
      waScope,
      waBinding.connectionId,
      'ram',
      appt,
      bodyText
    );

    // Must return existing active dispatch without creating a second dispatch, and alreadySent must be FALSE
    expect(inFlightRetry.status).toBe('AWAITING_CUSTOMER_BOOKING');
    expect(inFlightRetry.alreadySent).toBe(false);
    expect(inFlightRetry.receipt?.dispatchId).toBe(firstDispatchId);
    expect(fixture.state.dispatches.length).toBe(1);

    // Now simulate WhatsApp provider accepting the message
    const liveDispatch = fixture.state.dispatches[0]!;
    liveDispatch.claimedAt = clock;
    liveDispatch.receipt.providerMessageId = 'wamid.HBgLMTU1NTAwMDAwMDEVAwASGCA0';
    liveDispatch.receipt.status = 'sent';

    // Repeated click AFTER provider accepted the dispatch
    const afterAccept = await service.dispatchAppointmentApproval(
      waScope,
      waBinding.connectionId,
      'ram',
      appt,
      bodyText
    );

    // Must report alreadySent: true now that provider has accepted
    expect(afterAccept.status).toBe('AWAITING_CUSTOMER_BOOKING');
    expect(afterAccept.alreadySent).toBe(true);
    expect(afterAccept.receipt?.dispatchId).toBe(firstDispatchId);
    expect(fixture.state.dispatches.length).toBe(1);

    // Later: Customer submits a distinct legitimate NEW consultation request for a different slot
    const secondAppt = {
      ...appt,
      consultationId: 'consultation-2026-11-20',
      startAt: '2026-11-20T14:00:00Z',
      date: '2026-11-20'
    };
    const distinctConsultation = await service.dispatchAppointmentApproval(
      waScope,
      waBinding.connectionId,
      'ram',
      secondAppt,
      bodyText
    );
    expect(distinctConsultation.status).toBe('AWAITING_CUSTOMER_BOOKING');
    expect(distinctConsultation.bookingLinkSent).toBe(true);
    expect(distinctConsultation.receipt?.dispatchId).toBeDefined();
    expect(distinctConsultation.receipt!.dispatchId).not.toBe(firstDispatchId);
    expect(fixture.state.dispatches.length).toBe(2);
    expect(fixture.state.dispatches[1]!.draft.idempotencyKey).toBe(`calendly-link-${waBinding.connectionId}-ram-consultation-2026-11-20`);
  });

  it('2. Safe Recovery: recovers safely from expired reservation with fresh reservation and UUID approval', async () => {
    const fixture = new WhatsAppTransactionalFixture();
    let clock = waNow;
    const service = new DurableWhatsAppService(fixture as any, defaultPolicyGateway, () => clock);

    const appt = {
      status: 'AWAITING_CUSTOMER_BOOKING',
      calendlyUrl: 'https://calendly.com/team-brandmint/30min'
    };
    const bodyText = 'Your 30-minute consultation request has been approved.';

    // First attempt
    const first = await service.dispatchAppointmentApproval(
      waScope,
      waBinding.connectionId,
      'ram',
      appt,
      bodyText
    );
    expect(fixture.state.dispatches.length).toBe(1);
    const firstDispatchId = first.receipt!.dispatchId;

    // Advance clock past 60s expiration without claim
    clock += 65000;

    // Retry after expiration
    const recovered = await service.dispatchAppointmentApproval(
      waScope,
      waBinding.connectionId,
      'ram',
      appt,
      bodyText
    );

    expect(recovered.status).toBe('AWAITING_CUSTOMER_BOOKING');
    expect(recovered.receipt?.dispatchId).toBeDefined();
    expect(recovered.receipt!.dispatchId).not.toBe(firstDispatchId);
    expect(recovered.alreadySent).toBeUndefined();
    expect(fixture.state.dispatches.length).toBe(1);

    const newDispatch = fixture.state.dispatches[0]!;
    expect(newDispatch.id).toBe(recovered.receipt!.dispatchId);
    expect(newDispatch.approvalId).toMatch(UUID_REGEX);
    expect(newDispatch.expiresAt).toBe(clock + 60000);
  });

  it('3. Safe Recovery: recovers safely from failed provider delivery with retry', async () => {
    const fixture = new WhatsAppTransactionalFixture();
    let clock = waNow;
    const service = new DurableWhatsAppService(fixture as any, defaultPolicyGateway, () => clock);

    // Add recent inbound message to open 24h window
    fixture.state.messages.push({
      recipientId: 'ram',
      providerMessageId: 'msg-recent',
      timestamp: new Date(clock).toISOString()
    });

    const appt = {
      status: 'AWAITING_CUSTOMER_BOOKING',
      calendlyUrl: 'https://calendly.com/team-brandmint/30min'
    };
    const bodyText = 'Your 30-minute consultation request has been approved.';

    const first = await service.dispatchAppointmentApproval(
      waScope,
      waBinding.connectionId,
      'ram',
      appt,
      bodyText
    );
    const firstDispatchId = first.receipt!.dispatchId;

    // Simulate n8n claiming the dispatch
    const relayScope = {
      authKind: 'whatsapp_relay' as const,
      principalId: 'relay_principal',
      workspaceId: waScope.workspaceId,
      userId: waScope.userId,
      role: 'owner' as const,
      connectionId: waBinding.connectionId,
      revision: waBinding.revision,
      operation: 'claim' as const,
      relayTokenHash: 'synthetic_hash'
    };
    const claimResult = await service.claim(relayScope as any, waBinding.connectionId, firstDispatchId, 1);
    expect(claimResult.authorized).toBe(true);

    // Simulate provider failure callback
    const receiptsRelayScope = {
      ...relayScope,
      operation: 'receipts' as const
    };
    // Mark receipt as failed
    fixture.state.dispatches[0]!.receipt.status = 'failed';

    // Owner retries sending the link
    const retried = await service.dispatchAppointmentApproval(
      waScope,
      waBinding.connectionId,
      'ram',
      appt,
      bodyText
    );

    expect(retried.status).toBe('AWAITING_CUSTOMER_BOOKING');
    expect(retried.receipt?.dispatchId).toBeDefined();
    expect(retried.receipt!.dispatchId).not.toBe(firstDispatchId);
    expect(fixture.state.dispatches.length).toBe(1);
    expect(fixture.state.dispatches[0]!.id).toBe(retried.receipt!.dispatchId);
  });

  it('4. Postgres Revision Fence Integrity: binding.recipients is never mutated and has only allowed keys', async () => {
    const fixture = new WhatsAppTransactionalFixture();
    const service = new DurableWhatsAppService(fixture as any, defaultPolicyGateway, () => waNow);

    const initialRecipientsSnapshot = JSON.stringify(fixture.state.binding.recipients);

    const appt = {
      status: 'AWAITING_CUSTOMER_BOOKING',
      calendlyUrl: 'https://calendly.com/team-brandmint/30min'
    };
    const bodyText = 'Your 30-minute consultation request has been approved.';

    await service.dispatchAppointmentApproval(
      waScope,
      waBinding.connectionId,
      'ram',
      appt,
      bodyText
    );

    // Check that binding.recipients was NOT mutated
    expect(JSON.stringify(fixture.state.binding.recipients)).toBe(initialRecipientsSnapshot);

    // Verify all keys in binding.recipients are strictly allowed by PostgreSQL trigger
    const allowedKeys = new Set(['id', 'phoneE164', 'optedIn', 'displayName']);
    for (const r of fixture.state.binding.recipients) {
      for (const key of Object.keys(r)) {
        expect(allowedKeys.has(key)).toBe(true);
      }
    }
  });

  it('5. Complete Outbound Lifecycle: Owner click -> Authenticated approval -> DB commit -> Valid UUID approval -> n8n claim -> Provider accept', async () => {
    const fixture = new WhatsAppTransactionalFixture();
    let clock = waNow;
    const service = new DurableWhatsAppService(fixture as any, defaultPolicyGateway, () => clock);

    // Add recent inbound message to open 24h customer service window
    fixture.state.messages.push({
      recipientId: 'ram',
      providerMessageId: 'inbound-001',
      timestamp: new Date(clock).toISOString()
    });

    const appt = {
      status: 'AWAITING_CUSTOMER_BOOKING',
      calendlyUrl: 'https://calendly.com/team-brandmint/30min'
    };
    const bodyText = 'Your 30-minute consultation request has been approved.\n\nPlease select and confirm your preferred slot here:\nhttps://calendly.com/team-brandmint/30min\n\nWe look forward to speaking with you.';

    // Step 1: Owner clicks "Confirm & Send Link"
    const confirmResult = await service.dispatchAppointmentApproval(
      waScope,
      waBinding.connectionId,
      'ram',
      appt,
      bodyText
    );
    expect(confirmResult.status).toBe('AWAITING_CUSTOMER_BOOKING');
    expect(confirmResult.bookingLinkSent).toBe(true);
    const dispatchId = confirmResult.receipt!.dispatchId;

    // Step 2: Database transaction committed audit event and valid UUID approval
    const reservedAudit = fixture.audits.find(a => a.action === 'whatsapp.durable.reserved');
    expect(reservedAudit).toBeDefined();
    expect(reservedAudit.details.dispatchId).toBe(dispatchId);

    const dispatchRecord = fixture.state.dispatches.find((d: any) => d.id === dispatchId);
    expect(dispatchRecord).toBeDefined();
    expect(dispatchRecord.approvalId).toMatch(UUID_REGEX);
    expect(dispatchRecord.claimedAt).toBeNull();

    // Step 3: n8n claims dispatch
    const relayScope = {
      authKind: 'whatsapp_relay' as const,
      principalId: 'relay_principal',
      workspaceId: waScope.workspaceId,
      userId: waScope.userId,
      role: 'owner' as const,
      connectionId: waBinding.connectionId,
      revision: waBinding.revision,
      operation: 'claim' as const,
      relayTokenHash: 'synthetic_hash'
    };
    const claim = await service.claim(relayScope as any, waBinding.connectionId, dispatchId, 1);
    expect(claim.authorized).toBe(true);
    expect(claim.dispatchId).toBe(dispatchId);
    expect(claim.recipientPhoneNumber).toBe('+15550000001');
    expect(claim.messageType).toBe('text');
    expect((claim as any).textBody).toBe(bodyText);

    // Claim marked dispatch as claimed and unverified
    const updatedRecord = fixture.state.dispatches.find((d: any) => d.id === dispatchId);
    expect(updatedRecord.claimedAt).toBe(clock);
    expect(updatedRecord.receipt.status).toBe('unverified');

    // Step 4: WhatsApp provider accepts and returns message ID
    // Add delivery event so reconcile advances receipt to 'delivered'
    fixture.state.events.push({
      providerMessageId: 'wamid.HBgLMTU1NTAwMDAwMDEVAwASGCAz',
      recipientAddress: '15550000001',
      status: 'delivered',
      timestamp: String(Math.floor((clock + 5000) / 1000))
    });

    const receiptsScope = {
      ...relayScope,
      operation: 'receipts' as const
    };
    const providerReceipt = await service.receipt(receiptsScope as any, waBinding.connectionId, {
      dispatchId,
      providerMessageId: 'wamid.HBgLMTU1NTAwMDAwMDEVAwASGCAz',
      recipientAddress: '15550000001'
    });

    expect(providerReceipt.providerMessageId).toBe('wamid.HBgLMTU1NTAwMDAwMDEVAwASGCAz');
    expect(providerReceipt.status).toBe('delivered');
  });

  it('6. Prompt Status Ingestion: status events record immediately without invoking auto-reply dispatcher', async () => {
    const fixture = new WhatsAppTransactionalFixture();
    let autoReplyInvoked = false;
    const mockDispatcher = {
      submit: async () => {
        autoReplyInvoked = true;
      }
    };
    const service = new DurableWhatsAppService(fixture as any, defaultPolicyGateway, () => waNow, {
      profile: () => ({ connectionId: waBinding.connectionId, recipientId: '*', expiresAt: waNow + 3600000, maxPerDay: 10 }),
      dispatcher: mockDispatcher
    });

    const statusRelayScope = {
      authKind: 'whatsapp_relay' as const,
      principalId: 'relay_principal',
      workspaceId: waScope.workspaceId,
      userId: waScope.userId,
      role: 'owner' as const,
      connectionId: waBinding.connectionId,
      revision: waBinding.revision,
      operation: 'events' as const,
      relayTokenHash: 'synthetic_hash'
    };

    const statusEvent = {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '15550000001', phone_number_id: waBinding.phoneNumberId },
      statuses: [
        {
          id: 'wamid.status_test',
          status: 'read',
          timestamp: String(Math.floor(waNow / 1000)),
          recipient_id: '15550000001'
        }
      ],
      field: 'messages'
    };

    const result = await service.ingest(statusRelayScope as any, waBinding.connectionId, statusEvent);
    expect(result.acceptedMessages).toBe(0);
    expect(autoReplyInvoked).toBe(false);
    expect(fixture.state.events.length).toBe(1);
    expect(fixture.state.events[0]!.status).toBe('read');
  });

  it('7. Durability across API restarts: consultation ID and appointment state survive process restart, preventing duplicate sends and reusing identical identity', async () => {
    const fixture = new WhatsAppTransactionalFixture();
    let clock = waNow;
    const serviceInstance1 = new DurableWhatsAppService(fixture as any, defaultPolicyGateway, () => clock);

    // Initial confirmation by owner on instance 1
    const appt: any = {
      status: 'AWAITING_CUSTOMER_BOOKING',
      calendlyUrl: 'https://calendly.com/team-brandmint/30min',
      customerName: 'Krishna',
      customerEmail: 'example@gmail.com',
      service: 'WhatsApp Automation',
      business: 'Clothing / Fashion',
      duration: '30 Minutes',
      startAt: '2026-11-15T11:00:00Z',
      date: '2026-11-15'
    };
    const bodyText = 'Your 30-minute consultation request has been approved.';

    const first = await serviceInstance1.dispatchAppointmentApproval(
      waScope,
      waBinding.connectionId,
      'ram',
      appt,
      bodyText
    );

    expect(first.status).toBe('AWAITING_CUSTOMER_BOOKING');
    const firstDispatchId = first.receipt!.dispatchId;
    const initialIdempotencyKey = fixture.state.dispatches[0]!.draft.idempotencyKey;
    expect(initialIdempotencyKey).toBe(`calendly-link-${waBinding.connectionId}-ram-slot-2026-11-15T11:00:00Z`);

    // Provider accepts and returns message ID
    fixture.state.dispatches[0]!.claimedAt = clock;
    fixture.state.dispatches[0]!.receipt.providerMessageId = 'wamid.HBgLMTU1NTAwMDAwMDEVAwASGCA9';
    fixture.state.dispatches[0]!.receipt.status = 'sent';

    // === SIMULATE API RESTART ===
    // Clear in-memory trackers to simulate a cold Node.js process restart with zero memory cache.
    (serviceInstance1 as any).getStoreTracker().appointments.clear();
    (serviceInstance1 as any).getStoreTracker().dynamicRecipientsByConnection.clear();

    const serviceInstance2 = new DurableWhatsAppService(fixture as any, defaultPolicyGateway, () => clock + 10000);
    (serviceInstance2 as any).getStoreTracker().appointments.clear();

    // 1. Calling getRecipient reconstructs appointment with persisted consultation identity from PostgreSQL
    const recipientInfo = await serviceInstance2.getRecipient(waScope, waBinding.connectionId, 'ram');
    expect(recipientInfo).not.toBeNull();
    expect(recipientInfo!.recipient.appointment).toBeDefined();
    expect(recipientInfo!.recipient.appointment.consultationId).toBe('slot-2026-11-15T11:00:00Z');
    expect(recipientInfo!.recipient.appointment.bookingLinkSent).toBe(true);
    expect(recipientInfo!.recipient.appointment.bookingEvidenceVerified).toBe(true);

    // 2. Owner clicks "Confirm & Send Link" again on the new instance (even without passing consultationId)
    const secondApptAttempt: any = {
      status: 'AWAITING_CUSTOMER_BOOKING',
      calendlyUrl: 'https://calendly.com/team-brandmint/30min',
      startAt: '2026-11-15T11:00:00Z',
      date: '2026-11-15'
    };
    const repeatOnInstance2 = await serviceInstance2.dispatchAppointmentApproval(
      waScope,
      waBinding.connectionId,
      'ram',
      secondApptAttempt,
      bodyText
    );

    // Must NOT create a new consultation ID or a new dispatch, and must report alreadySent: true
    expect(repeatOnInstance2.status).toBe('AWAITING_CUSTOMER_BOOKING');
    expect(repeatOnInstance2.alreadySent).toBe(true);
    expect(repeatOnInstance2.receipt?.dispatchId).toBe(firstDispatchId);
    expect(fixture.state.dispatches.length).toBe(1);
    expect(fixture.state.dispatches[0]!.draft.idempotencyKey).toBe(initialIdempotencyKey);
  });
});
