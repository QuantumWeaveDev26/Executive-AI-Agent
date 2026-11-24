import { FastifyInstance, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  GoogleCalendarAgendaQuery,
  GoogleCalendarAgendaQuerySchema,
  GoogleCalendarAgendaResponseSchema,
  GoogleCalendarBriefingQuery,
  GoogleCalendarBriefingQuerySchema,
  GoogleCalendarBriefingResponseSchema,
  GoogleCalendarCallback,
  GoogleCalendarCallbackSchema,
  GoogleCalendarCancelEventInput,
  GoogleCalendarCreateEventInput,
  GoogleCalendarEmptySchema,
  GoogleCalendarEventIdSchema,
  GoogleCalendarEventSchema,
  GoogleCalendarListEvents,
  GoogleCalendarListEventsResponseSchema,
  GoogleCalendarListEventsSchema,
  GoogleCalendarPreparedMutationSchema,
  GoogleCalendarPrepareCancel,
  GoogleCalendarPrepareCancelSchema,
  GoogleCalendarPrepareCreate,
  GoogleCalendarPrepareCreateSchema,
  GoogleCalendarPrepareReschedule,
  GoogleCalendarPrepareRescheduleSchema,
  GoogleCalendarRescheduleEventInput,
  GoogleCalendarStartSchema,
  GoogleCalendarStatusSchema
} from '@thaara/contracts';
import { AuditEventRepository, AuthenticatedScope, TransactionalDbClient } from '@thaara/db';
import { AppError, ForbiddenError } from '@thaara/observability';
import { PolicyGateway } from '@thaara/policy';
import {
  createGovernedCalendarMutation,
  normalizeAttendeeEmail,
  normalizeAttendeeList
} from '../services/calendar-mutation-governance.js';
import {
  DEFAULT_CALENDAR_REMINDERS,
  GOOGLE_CALENDAR_CANCEL_EVENT_ACTION,
  GOOGLE_CALENDAR_CREATE_EVENT_ACTION,
  GOOGLE_CALENDAR_RESCHEDULE_EVENT_ACTION,
  GoogleCalendarFoundation,
  GoogleCalendarOptions,
  GoogleCalendarWriteReadinessReason,
  parseStrictRfc3339,
  validateIanaTimeZone
} from '../services/google-calendar.js';

export function calendarWriteReadinessError(reason: GoogleCalendarWriteReadinessReason): AppError {
  switch (reason) {
    case 'not_configured':
      return new AppError(
        'Google Calendar scheduling is not set up in this environment.',
        'CALENDAR_NOT_CONFIGURED',
        503
      );
    case 'disconnected':
      return new AppError(
        'Google Calendar is not connected. Please connect Google Calendar first.',
        'CALENDAR_DISCONNECTED',
        409
      );
    case 'reconnect_required':
      return new AppError(
        'Your Google Calendar connection expired. Please reconnect Google Calendar.',
        'CALENDAR_RECONNECT_REQUIRED',
        409
      );
    case 'write_permission_missing':
      return new AppError(
        'Google Calendar scheduling is not allowed yet. Please disconnect and reconnect Google Calendar to grant scheduling permission (calendar.events.owned).',
        'CALENDAR_WRITE_SCOPE_REQUIRED',
        403
      );
    default:
      return new AppError(
        'We could not confirm which Google Calendar is connected. Please reconnect Google Calendar.',
        'CALENDAR_ACCOUNT_UNVERIFIED',
        409
      );
  }
}

export async function googleCalendarRoutes(
  app: FastifyInstance,
  options: {
    db: TransactionalDbClient;
    policyGateway: PolicyGateway;
    googleCalendar?: GoogleCalendarOptions;
  }
): Promise<GoogleCalendarFoundation> {
  async function scoped(
    scope: AuthenticatedScope,
    action?: string,
    payload: Record<string, unknown> = {}
  ) {
    await options.db.withScopedTransaction(scope, async (tx) => {
      const { rows } = await tx.query<{ workspace_id: string; user_id: string; role: string }>(
        'SELECT workspace_id,user_id,role FROM public.resolve_session_scope($1)',
        [scope.sessionTokenHash]
      );
      const current = rows[0];
      if (
        !current ||
        current.workspace_id !== scope.workspaceId ||
        current.user_id !== scope.userId ||
        current.role !== scope.role
      ) {
        throw new ForbiddenError('Active matching workspace membership is required.');
      }
      if (action) {
        await new AuditEventRepository(tx).create(
          scope.workspaceId,
          action,
          'google_calendar_connection',
          payload,
          scope.userId
        );
      }
    });
  }

  const service = new GoogleCalendarFoundation({
    ...options.googleCalendar,
    policyGateway: options.policyGateway,
    audit: (scope, action, payload) => scoped(scope, action, payload)
  });

  const preHandler = [
    async (_request: unknown, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    },
    app.requireAuth
  ];
  const tags = ['GoogleCalendar'];

  app.get(
    '/connectors/google-calendar/status',
    { preHandler, schema: { tags, response: { 200: GoogleCalendarStatusSchema } } },
    async (request) => {
      await scoped(request.scope!);
      return service.status(request.scope!);
    }
  );

  app.post(
    '/connectors/google-calendar/oauth/start',
    {
      preHandler,
      schema: { tags, body: GoogleCalendarEmptySchema, response: { 200: GoogleCalendarStartSchema } }
    },
    async (request) => service.start(request.scope!)
  );

  app.get<{ Querystring: GoogleCalendarCallback }>(
    '/connectors/google-calendar/oauth/callback',
    {
      preHandler,
      schema: {
        tags,
        querystring: GoogleCalendarCallbackSchema,
        response: { 200: GoogleCalendarStatusSchema }
      }
    },
    async (request) => service.complete(request.scope!, request.query)
  );

  app.delete(
    '/connectors/google-calendar/connection',
    { preHandler, schema: { tags, response: { 200: GoogleCalendarStatusSchema } } },
    async (request) => {
      await scoped(request.scope!);
      return service.disconnect(request.scope!);
    }
  );

  app.post<{ Body: GoogleCalendarListEvents }>(
    '/connectors/google-calendar/events/list',
    {
      preHandler,
      schema: {
        tags,
        body: GoogleCalendarListEventsSchema,
        response: { 200: GoogleCalendarListEventsResponseSchema }
      }
    },
    async (request) => service.listEvents(request.scope!, request.body)
  );

  app.get<{ Params: { eventId: string } }>(
    '/connectors/google-calendar/events/:eventId',
    {
      preHandler,
      schema: {
        tags,
        params: Type.Object({ eventId: GoogleCalendarEventIdSchema }, { additionalProperties: false }),
        response: { 200: GoogleCalendarEventSchema }
      }
    },
    async (request) => service.readEvent(request.scope!, request.params.eventId)
  );

  app.post<{ Body: GoogleCalendarAgendaQuery }>(
    '/connectors/google-calendar/agenda',
    {
      preHandler,
      schema: {
        tags,
        body: GoogleCalendarAgendaQuerySchema,
        response: { 200: GoogleCalendarAgendaResponseSchema }
      }
    },
    async (request) => service.readAgenda(request.scope!, request.body)
  );

  app.post<{ Body: GoogleCalendarBriefingQuery }>(
    '/connectors/google-calendar/briefing',
    {
      preHandler,
      schema: {
        tags,
        body: GoogleCalendarBriefingQuerySchema,
        response: { 200: GoogleCalendarBriefingResponseSchema }
      }
    },
    async (request) => service.prepareBriefing(request.scope!, request.body)
  );

  app.post<{ Body: GoogleCalendarPrepareCreate }>(
    '/connectors/google-calendar/events/create',
    {
      preHandler,
      schema: {
        tags,
        body: GoogleCalendarPrepareCreateSchema,
        response: { 200: GoogleCalendarPreparedMutationSchema }
      }
    },
    async (request) => {
      const scope = request.scope!;
      await scoped(scope);
      const summary = request.body.summary.replace(/[\r\n]+/g, ' ').trim();
      if (!summary) {
        throw new AppError('Please enter a meeting title.', 'CALENDAR_INVALID_INPUT', 400);
      }
      const timeZone = validateIanaTimeZone(request.body.timeZone ?? 'Asia/Kolkata');
      const startMs = parseStrictRfc3339(request.body.startAt, 'startAt');
      const endMs = parseStrictRfc3339(request.body.endAt, 'endAt');
      if (endMs <= startMs) {
        throw new AppError(
          'Meeting end time must be after the start time.',
          'CALENDAR_INVALID_RANGE',
          400
        );
      }
      if (endMs - startMs > 24 * 60 * 60 * 1000) {
        throw new AppError(
          'Single meeting duration cannot exceed 24 hours.',
          'CALENDAR_INVALID_RANGE',
          400
        );
      }
      if (request.body.attendees) {
        for (const rawEmail of request.body.attendees) {
          if (!normalizeAttendeeEmail(rawEmail)) {
            throw new AppError(
              `Invalid attendee email address: ${rawEmail}`,
              'CALENDAR_INVALID_ATTENDEE',
              400
            );
          }
        }
      }
      const attendees = normalizeAttendeeList(request.body.attendees);
      const readiness = await service.writeReadiness(scope, 'create');
      if (!readiness.ready || !readiness.connectedCalendar) {
        throw calendarWriteReadinessError(readiness.reason);
      }
      const conflicts = await service.findConflicts(scope, {
        startAt: request.body.startAt,
        endAt: request.body.endAt,
        timeZone
      });
      const description = request.body.description?.trim()
        ? request.body.description.trim().slice(0, 4000)
        : undefined;
      const location = request.body.location?.replace(/[\r\n]+/g, ' ').trim()
        ? request.body.location.replace(/[\r\n]+/g, ' ').trim().slice(0, 500)
        : undefined;
      const sendUpdates: 'all' | 'none' =
        request.body.sendUpdates ?? (attendees.length > 0 ? 'all' : 'none');
      const reminders = request.body.reminders ?? DEFAULT_CALENDAR_REMINDERS;
      const origin = request.body.origin ?? 'thaara_ui';

      const params: GoogleCalendarCreateEventInput = {
        connectedCalendar: readiness.connectedCalendar,
        summary: summary.slice(0, 250),
        ...(description ? { description } : {}),
        ...(location ? { location } : {}),
        startAt: request.body.startAt,
        endAt: request.body.endAt,
        timeZone,
        ...(attendees.length > 0 ? { attendees } : {}),
        sendUpdates,
        reminders,
        origin
      };

      const created = await createGovernedCalendarMutation(options.db, scope, {
        actionName: GOOGLE_CALENDAR_CREATE_EVENT_ACTION,
        params: params as unknown as Record<string, unknown>,
        title: `Schedule meeting: ${params.summary}`,
        description: 'Approval-gated Google Calendar meeting creation',
        metadata: {
          origin: 'calendar_ui',
          thaaraOrigin: origin,
          conversationId: null,
          connectedCalendar: readiness.connectedCalendar,
          operation: 'create',
          summary: params.summary,
          startAt: params.startAt,
          endAt: params.endAt,
          timeZone,
          ...(attendees.length > 0 ? { attendees } : {}),
          sendUpdates,
          reminders,
          conflictCount: conflicts.length
        },
        auditAction: 'calendar.events.create_prepared',
        auditPayload: {
          summary: params.summary,
          startAt: params.startAt,
          endAt: params.endAt,
          timeZone,
          attendeeCount: attendees.length,
          sendUpdates,
          reminders,
          conflictCount: conflicts.length,
          connectedCalendar: readiness.connectedCalendar,
          origin: 'calendar_ui',
          thaaraOrigin: origin
        }
      });

      return {
        planId: created.planId,
        approvalId: created.approvalId,
        status: 'awaiting_approval' as const,
        operation: 'create' as const,
        connectedCalendar: readiness.connectedCalendar,
        summary: params.summary,
        ...(description ? { description } : {}),
        ...(location ? { location } : {}),
        startAt: params.startAt,
        endAt: params.endAt,
        timeZone,
        ...(attendees.length > 0 ? { attendees } : {}),
        sendUpdates,
        reminders,
        origin,
        conflicts,
        expiresAt: created.expiresAt
      };
    }
  );

  app.post<{ Body: GoogleCalendarPrepareReschedule }>(
    '/connectors/google-calendar/events/reschedule',
    {
      preHandler,
      schema: {
        tags,
        body: GoogleCalendarPrepareRescheduleSchema,
        response: { 200: GoogleCalendarPreparedMutationSchema }
      }
    },
    async (request) => {
      const scope = request.scope!;
      await scoped(scope);
      const timeZone = validateIanaTimeZone(request.body.timeZone ?? 'Asia/Kolkata');
      const newStartMs = parseStrictRfc3339(request.body.newStartAt, 'newStartAt');
      const newEndMs = parseStrictRfc3339(request.body.newEndAt, 'newEndAt');
      if (newEndMs <= newStartMs) {
        throw new AppError(
          'New meeting end time must be after the start time.',
          'CALENDAR_INVALID_RANGE',
          400
        );
      }
      if (newEndMs - newStartMs > 24 * 60 * 60 * 1000) {
        throw new AppError(
          'Single meeting duration cannot exceed 24 hours.',
          'CALENDAR_INVALID_RANGE',
          400
        );
      }
      const readiness = await service.writeReadiness(scope, 'reschedule');
      if (!readiness.ready || !readiness.connectedCalendar) {
        throw calendarWriteReadinessError(readiness.reason);
      }
      const sourceEvent = await service.readEvent(scope, request.body.eventId);
      if (sourceEvent.status === 'cancelled') {
        throw new AppError(
          'This meeting is already cancelled and cannot be rescheduled.',
          'CALENDAR_EVENT_CANCELLED',
          409
        );
      }
      const conflicts = await service.findConflicts(scope, {
        startAt: request.body.newStartAt,
        endAt: request.body.newEndAt,
        timeZone,
        excludeEventId: sourceEvent.id
      });
      const hasGuests = sourceEvent.attendees.some((a) => !a.self && a.email);
      const sendUpdates: 'all' | 'none' =
        request.body.sendUpdates ?? (hasGuests ? 'all' : 'none');
      const reminders = request.body.reminders ?? sourceEvent.reminders;

      const params: GoogleCalendarRescheduleEventInput = {
        eventId: sourceEvent.id,
        connectedCalendar: readiness.connectedCalendar,
        summary: sourceEvent.summary,
        expectedStartAt: sourceEvent.startAt,
        expectedEndAt: sourceEvent.endAt,
        expectedStatus: sourceEvent.status,
        newStartAt: request.body.newStartAt,
        newEndAt: request.body.newEndAt,
        timeZone,
        sendUpdates,
        ...(reminders ? { reminders } : {})
      };

      const created = await createGovernedCalendarMutation(options.db, scope, {
        actionName: GOOGLE_CALENDAR_RESCHEDULE_EVENT_ACTION,
        params: params as unknown as Record<string, unknown>,
        title: `Reschedule meeting: ${sourceEvent.summary}`,
        description: 'Approval-gated Google Calendar meeting reschedule',
        metadata: {
          origin: 'calendar_ui',
          conversationId: null,
          connectedCalendar: readiness.connectedCalendar,
          operation: 'reschedule',
          eventId: sourceEvent.id,
          summary: sourceEvent.summary,
          previousStartAt: sourceEvent.startAt,
          previousEndAt: sourceEvent.endAt,
          startAt: request.body.newStartAt,
          endAt: request.body.newEndAt,
          timeZone,
          sendUpdates,
          ...(reminders ? { reminders } : {}),
          conflictCount: conflicts.length
        },
        auditAction: 'calendar.events.reschedule_prepared',
        auditPayload: {
          eventId: sourceEvent.id,
          summary: sourceEvent.summary,
          previousStartAt: sourceEvent.startAt,
          previousEndAt: sourceEvent.endAt,
          newStartAt: request.body.newStartAt,
          newEndAt: request.body.newEndAt,
          timeZone,
          sendUpdates,
          ...(reminders ? { reminders } : {}),
          conflictCount: conflicts.length,
          connectedCalendar: readiness.connectedCalendar,
          origin: 'calendar_ui'
        }
      });

      return {
        planId: created.planId,
        approvalId: created.approvalId,
        status: 'awaiting_approval' as const,
        operation: 'reschedule' as const,
        connectedCalendar: readiness.connectedCalendar,
        eventId: sourceEvent.id,
        summary: sourceEvent.summary,
        startAt: request.body.newStartAt,
        endAt: request.body.newEndAt,
        previousStartAt: sourceEvent.startAt,
        previousEndAt: sourceEvent.endAt,
        timeZone,
        sendUpdates,
        ...(reminders ? { reminders } : {}),
        conflicts,
        expiresAt: created.expiresAt
      };
    }
  );

  app.post<{ Body: GoogleCalendarPrepareCancel }>(
    '/connectors/google-calendar/events/cancel',
    {
      preHandler,
      schema: {
        tags,
        body: GoogleCalendarPrepareCancelSchema,
        response: { 200: GoogleCalendarPreparedMutationSchema }
      }
    },
    async (request) => {
      const scope = request.scope!;
      await scoped(scope);
      const timeZone = validateIanaTimeZone(request.body.timeZone ?? 'Asia/Kolkata');
      const readiness = await service.writeReadiness(scope, 'cancel');
      if (!readiness.ready || !readiness.connectedCalendar) {
        throw calendarWriteReadinessError(readiness.reason);
      }
      const sourceEvent = await service.readEvent(scope, request.body.eventId);
      if (sourceEvent.status === 'cancelled') {
        throw new AppError(
          'This meeting is already cancelled.',
          'CALENDAR_EVENT_CANCELLED',
          409
        );
      }
      const guestEmails = sourceEvent.attendees
        .filter((a) => !a.self && typeof a.email === 'string' && a.email.trim())
        .map((a) => a.email!);
      const sendUpdates: 'all' | 'none' =
        request.body.sendUpdates ?? (guestEmails.length > 0 ? 'all' : 'none');

      const params: GoogleCalendarCancelEventInput = {
        eventId: sourceEvent.id,
        connectedCalendar: readiness.connectedCalendar,
        summary: sourceEvent.summary,
        expectedStartAt: sourceEvent.startAt,
        expectedEndAt: sourceEvent.endAt,
        expectedStatus: sourceEvent.status,
        timeZone,
        sendUpdates
      };

      const created = await createGovernedCalendarMutation(options.db, scope, {
        actionName: GOOGLE_CALENDAR_CANCEL_EVENT_ACTION,
        params: params as unknown as Record<string, unknown>,
        title: `Cancel meeting: ${sourceEvent.summary}`,
        description: 'Approval-gated Google Calendar meeting cancellation',
        metadata: {
          origin: 'calendar_ui',
          conversationId: null,
          connectedCalendar: readiness.connectedCalendar,
          operation: 'cancel',
          eventId: sourceEvent.id,
          summary: sourceEvent.summary,
          startAt: sourceEvent.startAt,
          endAt: sourceEvent.endAt,
          timeZone,
          ...(guestEmails.length > 0 ? { attendees: guestEmails } : {}),
          sendUpdates
        },
        auditAction: 'calendar.events.cancel_prepared',
        auditPayload: {
          eventId: sourceEvent.id,
          summary: sourceEvent.summary,
          expectedStartAt: sourceEvent.startAt,
          expectedEndAt: sourceEvent.endAt,
          timeZone,
          sendUpdates,
          guestCount: guestEmails.length,
          connectedCalendar: readiness.connectedCalendar,
          origin: 'calendar_ui'
        }
      });

      return {
        planId: created.planId,
        approvalId: created.approvalId,
        status: 'awaiting_approval' as const,
        operation: 'cancel' as const,
        connectedCalendar: readiness.connectedCalendar,
        eventId: sourceEvent.id,
        summary: sourceEvent.summary,
        startAt: sourceEvent.startAt,
        endAt: sourceEvent.endAt,
        timeZone,
        ...(guestEmails.length > 0 ? { attendees: guestEmails } : {}),
        sendUpdates,
        conflicts: [],
        expiresAt: created.expiresAt
      };
    }
  );

  return service;
}
