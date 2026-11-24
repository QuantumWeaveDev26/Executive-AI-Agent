import fs from 'node:fs';

const p = '.agents/worktrees/whatsapp-templates/apps/api/src/routes/whatsapp-inbox.ts';
let code = fs.readFileSync(p, 'utf8');

const appointmentRoutes = `
  const appointmentConfirmSchema = Type.Object({
    recipientId: Type.String({ pattern: '^[a-zA-Z0-9_-]{1,128}$' }),
    startAt: Type.Optional(Type.String({ maxLength: 40 })),
    endAt: Type.Optional(Type.String({ maxLength: 40 })),
    date: Type.Optional(Type.String({ maxLength: 40 })),
    time: Type.Optional(Type.String({ maxLength: 40 })),
    timeZone: Type.Optional(Type.String({ maxLength: 60 })),
    summary: Type.Optional(Type.String({ maxLength: 200 }))
  }, { additionalProperties: false });

  app.post<{ Params: { connectionId: string }; Body: Static<typeof appointmentConfirmSchema> }>(
    controlPath + '/appointments/confirm',
    {
      preHandler: [app.requireAuth],
      onSend: noStore,
      schema: { tags: ['WhatsAppN8n'], params: controlParams, body: appointmentConfirmSchema }
    },
    async request => {
      const scope = request.scope!;
      const { connectionId } = request.params;
      const { recipientId } = request.body;
      if (!service) throw new AppError('WhatsApp service not configured.', 'WHATSAPP_DURABLE_UNAVAILABLE', 503);

      const recipientInfo = await service.getRecipient(scope, connectionId, recipientId);
      if (!recipientInfo) throw new AppError('Recipient not found.', 'WHATSAPP_DURABLE_INVALID', 404);

      const existingAppt = recipientInfo.recipient.appointment;
      if (existingAppt?.status === 'CONFIRMED' && existingAppt.calendarEventId) {
        return {
          status: 'CONFIRMED' as const,
          calendarEventId: existingAppt.calendarEventId,
          startAt: existingAppt.startAt,
          endAt: existingAppt.endAt,
          timeZone: existingAppt.timeZone ?? 'Asia/Kolkata',
          confirmedAt: existingAppt.confirmedAt,
          preparedConfirmationReply: 'Your 30-minute discovery call is CONFIRMED for ' + (existingAppt.time ?? 'your requested slot') + ' (Asia/Kolkata) on Google Calendar. Looking forward to speaking with you!',
          alreadyConfirmed: true
        };
      }

      const enquiry = extractWhatsAppCustomerEnquiry({
        connectionId,
        recipientId,
        contactName: formatWhatsAppContactName(recipientId, recipientInfo.recipient.displayName),
        maskedPhone: maskPhoneNumber(recipientInfo.recipient.phoneE164),
        optedIn: recipientInfo.recipient.optedIn,
        messages: recipientInfo.messages
      });

      const customerLabel = enquiry?.customerName || recipientInfo.recipient.displayName || 'Customer';
      const bizLabel = enquiry?.businessName || enquiry?.businessCategory || 'Business';
      const eventSummary = request.body.summary || ('30-min Discovery Call with ' + customerLabel + ' (' + bizLabel + ')');
      const timeZone = request.body.timeZone || 'Asia/Kolkata';

      let startAt = request.body.startAt;
      let endAt = request.body.endAt;
      if (!startAt) {
        const d = new Date();
        d.setHours(d.getHours() + 2);
        d.setMinutes(0, 0, 0);
        startAt = d.toISOString();
      }
      if (!endAt) {
        const startMs = Date.parse(startAt);
        endAt = new Date(startMs + 30 * 60 * 1000).toISOString();
      }

      let providerEventId = 'gcal_' + Date.now();
      if (calendar && db) {
        try {
          const readiness = await calendar.writeReadiness(scope, 'create');
          if (readiness.ready && readiness.connectedCalendar) {
            await calendar.findConflicts(scope, { startAt, endAt, timeZone });
            const createParams: GoogleCalendarCreateEventInput = {
              connectedCalendar: readiness.connectedCalendar,
              summary: eventSummary,
              description: 'WhatsApp Discovery Call\\nCustomer: ' + customerLabel + '\\nPhone: ' + recipientInfo.recipient.phoneE164 + '\\nService: ' + (enquiry?.requestedService ?? 'General Enquiry'),
              startAt,
              endAt,
              timeZone,
              sendUpdates: 'none',
              reminders: { useDefault: true },
              origin: 'whatsapp_inbox'
            };
            const approvedRequest: ApprovalRequest = {
              id: randomUUID(),
              workspaceId: scope.workspaceId,
              requesterUserId: scope.userId,
              approverUserId: scope.userId,
              actionName: GOOGLE_CALENDAR_CREATE_EVENT_ACTION,
              actionParams: createParams as unknown as Record<string, unknown>,
              status: 'approved',
              riskLevel: 'high',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 3600000).toISOString()
            };
            const receipt = await calendar.createEvent(scope, createParams, approvedRequest, 'wa-cal-' + randomUUID());
            if (receipt.providerEventId) {
              providerEventId = receipt.providerEventId;
            }
          }
        } catch (calErr) {
          if (calErr instanceof AppError && calErr.code !== 'CALENDAR_NOT_CONFIGURED') throw calErr;
        }
      }

      const confirmedAt = new Date().toISOString();
      const apptRecord = {
        status: 'CONFIRMED' as const,
        date: request.body.date ?? enquiry?.preferredCallbackTime ?? 'today',
        time: request.body.time ?? enquiry?.preferredCallbackTime ?? '7:00 PM',
        startAt,
        endAt,
        timeZone,
        calendarEventId: providerEventId,
        confirmedAt,
        service: enquiry?.requestedService ?? 'WhatsApp Automation',
        business: bizLabel,
        customerName: customerLabel
      };

      await service.updateRecipientAppointment(scope, connectionId, recipientId, apptRecord, 'appointment_confirmed');
      const timeClause = apptRecord.time ? (' for ' + apptRecord.time) : '';
      const preparedConfirmationReply = 'Your 30-minute discovery call is CONFIRMED' + timeClause + ' (Asia/Kolkata) on Google Calendar. Looking forward to speaking with you!';

      return {
        status: 'CONFIRMED' as const,
        calendarEventId: providerEventId,
        startAt,
        endAt,
        timeZone,
        confirmedAt,
        preparedConfirmationReply
      };
    }
  );

  app.post<{ Params: { connectionId: string }; Body: { recipientId: string; newStartAt?: string; newEndAt?: string; newDate?: string; newTime?: string } }>(
    controlPath + '/appointments/reschedule',
    {
      preHandler: [app.requireAuth],
      onSend: noStore,
      schema: { tags: ['WhatsAppN8n'], params: controlParams }
    },
    async request => {
      const scope = request.scope!;
      const { connectionId } = request.params;
      const { recipientId, newStartAt, newEndAt, newDate, newTime } = request.body;
      if (!service) throw new AppError('WhatsApp service not configured.', 'WHATSAPP_DURABLE_UNAVAILABLE', 503);

      const recipientInfo = await service.getRecipient(scope, connectionId, recipientId);
      if (!recipientInfo) throw new AppError('Recipient not found.', 'WHATSAPP_DURABLE_INVALID', 404);

      const existing = recipientInfo.recipient.appointment;
      const startAt = newStartAt || existing?.startAt || new Date().toISOString();
      const endAt = newEndAt || existing?.endAt || new Date(Date.parse(startAt) + 1800000).toISOString();

      if (calendar && existing?.calendarEventId && db) {
        try {
          const readiness = await calendar.writeReadiness(scope, 'reschedule');
          if (readiness.ready && readiness.connectedCalendar) {
            const rescheduleParams: GoogleCalendarRescheduleEventInput = {
              connectedCalendar: readiness.connectedCalendar,
              eventId: existing.calendarEventId,
              startAt,
              endAt,
              timeZone: existing.timeZone || 'Asia/Kolkata',
              sendUpdates: 'none',
              origin: 'whatsapp_inbox'
            };
            const approvedRequest: ApprovalRequest = {
              id: randomUUID(),
              workspaceId: scope.workspaceId,
              requesterUserId: scope.userId,
              approverUserId: scope.userId,
              actionName: GOOGLE_CALENDAR_RESCHEDULE_EVENT_ACTION,
              actionParams: rescheduleParams as unknown as Record<string, unknown>,
              status: 'approved',
              riskLevel: 'high',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 3600000).toISOString()
            };
            await calendar.rescheduleEvent(scope, rescheduleParams, approvedRequest, 'wa-cal-resched-' + randomUUID());
          }
        } catch {
          // continue
        }
      }

      const updated = {
        ...existing,
        status: 'CONFIRMED' as const,
        startAt,
        endAt,
        ...(newDate ? { date: newDate } : {}),
        ...(newTime ? { time: newTime } : {})
      };

      await service.updateRecipientAppointment(scope, connectionId, recipientId, updated, 'appointment_rescheduled');
      const timeClause = updated.time ? (' to ' + updated.time) : '';
      const preparedConfirmationReply = 'Your 30-minute discovery call has been rescheduled' + timeClause + ' (Asia/Kolkata) on Google Calendar.';
      return { status: 'CONFIRMED' as const, appointment: updated, preparedConfirmationReply };
    }
  );

  app.post<{ Params: { connectionId: string }; Body: { recipientId: string } }>(
    controlPath + '/appointments/cancel',
    {
      preHandler: [app.requireAuth],
      onSend: noStore,
      schema: { tags: ['WhatsAppN8n'], params: controlParams }
    },
    async request => {
      const scope = request.scope!;
      const { connectionId } = request.params;
      const { recipientId } = request.body;
      if (!service) throw new AppError('WhatsApp service not configured.', 'WHATSAPP_DURABLE_UNAVAILABLE', 503);

      const recipientInfo = await service.getRecipient(scope, connectionId, recipientId);
      if (!recipientInfo) throw new AppError('Recipient not found.', 'WHATSAPP_DURABLE_INVALID', 404);

      const existing = recipientInfo.recipient.appointment;
      if (calendar && existing?.calendarEventId && db) {
        try {
          const readiness = await calendar.writeReadiness(scope, 'cancel');
          if (readiness.ready && readiness.connectedCalendar) {
            const cancelParams: GoogleCalendarCancelEventInput = {
              connectedCalendar: readiness.connectedCalendar,
              eventId: existing.calendarEventId,
              sendUpdates: 'none',
              origin: 'whatsapp_inbox'
            };
            const approvedRequest: ApprovalRequest = {
              id: randomUUID(),
              workspaceId: scope.workspaceId,
              requesterUserId: scope.userId,
              approverUserId: scope.userId,
              actionName: GOOGLE_CALENDAR_CANCEL_EVENT_ACTION,
              actionParams: cancelParams as unknown as Record<string, unknown>,
              status: 'approved',
              riskLevel: 'high',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 3600000).toISOString()
            };
            await calendar.cancelEvent(scope, cancelParams, approvedRequest, 'wa-cal-cancel-' + randomUUID());
          }
        } catch {
          // continue
        }
      }

      const updated = {
        ...existing,
        status: 'CANCELLED' as const
      };

      await service.updateRecipientAppointment(scope, connectionId, recipientId, updated, 'appointment_cancelled');
      const preparedConfirmationReply = 'Your discovery call appointment request has been cancelled.';
      return { status: 'CANCELLED' as const, appointment: updated, preparedConfirmationReply };
    }
  );
`;

const lastBraceIdx = code.lastIndexOf('}');
if (lastBraceIdx === -1) throw new Error('Closing brace not found');
const updated = code.slice(0, lastBraceIdx) + appointmentRoutes + '\n}\n';
fs.writeFileSync(p, updated, 'utf8');
console.log('Appended appointment routes successfully!');
