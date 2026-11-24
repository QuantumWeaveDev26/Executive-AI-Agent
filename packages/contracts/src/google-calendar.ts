import { Type, Static } from '@sinclair/typebox';
import { N8nWorkflowBlueprintSchema } from './automation.js';

export const GoogleCalendarEmptySchema = Type.Object({}, { additionalProperties: false });
export const GoogleCalendarEventIdSchema = Type.String({ pattern: '^[a-zA-Z0-9_-]{1,256}$' });
export const GoogleCalendarTimeZoneSchema = Type.String({
  pattern: '^[A-Za-z0-9_+-]+(?:/[A-Za-z0-9_+-]+){0,2}$',
  minLength: 1,
  maxLength: 64
});
export const GoogleCalendarIsoDateTimeSchema = Type.String({ minLength: 10, maxLength: 64 });

export const GoogleCalendarCallbackSchema = Type.Object(
  {
    state: Type.String({ minLength: 32, maxLength: 128 }),
    code: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
    error: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    scope: Type.Optional(Type.String({ maxLength: 4096 })),
    authuser: Type.Optional(Type.String({ maxLength: 32 })),
    prompt: Type.Optional(Type.String({ maxLength: 64 })),
    iss: Type.Optional(Type.String({ maxLength: 256 }))
  },
  { additionalProperties: false }
);
export type GoogleCalendarCallback = Static<typeof GoogleCalendarCallbackSchema>;

export const GoogleCalendarStatusSchema = Type.Object(
  {
    connectorName: Type.Literal('google_calendar'),
    status: Type.Union([
      Type.Literal('not_configured'),
      Type.Literal('disconnected'),
      Type.Literal('connected'),
      Type.Literal('reconnect_required')
    ]),
    configured: Type.Boolean(),
    connected: Type.Boolean(),
    mode: Type.Union([Type.Literal('disabled'), Type.Literal('mock'), Type.Literal('live')]),
    scopes: Type.Array(Type.String()),
    lastVerifiedAt: Type.Union([Type.String(), Type.Null()]),
    connectedEmail: Type.Optional(Type.String({ minLength: 3, maxLength: 320 })),
    connectedCalendarSummary: Type.Optional(Type.String({ minLength: 1, maxLength: 256 }))
  },
  { additionalProperties: false }
);
export type GoogleCalendarStatus = Static<typeof GoogleCalendarStatusSchema>;

export const GoogleCalendarStartSchema = Type.Object(
  {
    authorizationUrl: Type.String(),
    expiresAt: Type.String(),
    mode: Type.Union([Type.Literal('mock'), Type.Literal('live')])
  },
  { additionalProperties: false }
);
export type GoogleCalendarStart = Static<typeof GoogleCalendarStartSchema>;

export const GoogleCalendarEventAttendeeSchema = Type.Object(
  {
    email: Type.Optional(Type.String({ minLength: 3, maxLength: 320 })),
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    responseStatus: Type.Optional(
      Type.Union([
        Type.Literal('needsAction'),
        Type.Literal('declined'),
        Type.Literal('tentative'),
        Type.Literal('accepted')
      ])
    ),
    organizer: Type.Optional(Type.Boolean()),
    self: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);
export type GoogleCalendarEventAttendee = Static<typeof GoogleCalendarEventAttendeeSchema>;

export const GoogleCalendarReminderOverrideSchema = Type.Object(
  {
    method: Type.Union([Type.Literal('popup'), Type.Literal('email')]),
    minutes: Type.Integer({ minimum: 0, maximum: 40320 })
  },
  { additionalProperties: false }
);
export type GoogleCalendarReminderOverride = Static<typeof GoogleCalendarReminderOverrideSchema>;

export const GoogleCalendarRemindersSchema = Type.Object(
  {
    useDefault: Type.Boolean(),
    overrides: Type.Optional(
      Type.Array(GoogleCalendarReminderOverrideSchema, { maxItems: 5 })
    )
  },
  { additionalProperties: false }
);
export type GoogleCalendarReminders = Static<typeof GoogleCalendarRemindersSchema>;

export const GoogleCalendarEventOriginSchema = Type.Union([
  Type.Literal('thaara_chat'),
  Type.Literal('thaara_ui'),
  Type.Literal('thaara_gmail_explicit'),
  Type.Literal('external_calendar')
]);
export type GoogleCalendarEventOrigin = Static<typeof GoogleCalendarEventOriginSchema>;

export const GoogleCalendarEventSchema = Type.Object(
  {
    id: GoogleCalendarEventIdSchema,
    calendarId: Type.String({ minLength: 1, maxLength: 256 }),
    summary: Type.String({ minLength: 1, maxLength: 1024 }),
    description: Type.Optional(Type.String({ maxLength: 8192 })),
    location: Type.Optional(Type.String({ maxLength: 1024 })),
    startAt: GoogleCalendarIsoDateTimeSchema,
    endAt: GoogleCalendarIsoDateTimeSchema,
    timeZone: GoogleCalendarTimeZoneSchema,
    allDay: Type.Boolean(),
    status: Type.Union([
      Type.Literal('confirmed'),
      Type.Literal('tentative'),
      Type.Literal('cancelled')
    ]),
    organizerEmail: Type.Optional(Type.String({ minLength: 3, maxLength: 320 })),
    attendees: Type.Array(GoogleCalendarEventAttendeeSchema, { maxItems: 50 }),
    reminders: Type.Optional(GoogleCalendarRemindersSchema),
    thaaraOrigin: Type.Optional(GoogleCalendarEventOriginSchema),
    ownerSaved: Type.Optional(Type.Boolean()),
    untrusted: Type.Literal(true),
    mode: Type.Union([Type.Literal('mock'), Type.Literal('live')])
  },
  { additionalProperties: false }
);
export type GoogleCalendarEvent = Static<typeof GoogleCalendarEventSchema>;

export const GoogleCalendarListEventsSchema = Type.Object(
  {
    windowStart: GoogleCalendarIsoDateTimeSchema,
    windowEnd: GoogleCalendarIsoDateTimeSchema,
    timeZone: Type.Optional(GoogleCalendarTimeZoneSchema),
    query: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    includeCancelled: Type.Optional(Type.Boolean()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    pageToken: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 }))
  },
  { additionalProperties: false }
);
export type GoogleCalendarListEvents = Static<typeof GoogleCalendarListEventsSchema>;

export const GoogleCalendarListEventsResponseSchema = Type.Object(
  {
    events: Type.Array(GoogleCalendarEventSchema, { maxItems: 50 }),
    windowStart: GoogleCalendarIsoDateTimeSchema,
    windowEnd: GoogleCalendarIsoDateTimeSchema,
    timeZone: GoogleCalendarTimeZoneSchema,
    nextPageToken: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    untrusted: Type.Literal(true),
    mode: Type.Union([Type.Literal('mock'), Type.Literal('live')])
  },
  { additionalProperties: false }
);
export type GoogleCalendarListEventsResponse = Static<typeof GoogleCalendarListEventsResponseSchema>;

export const GoogleCalendarAgendaDayGroupSchema = Type.Object(
  {
    localDate: Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }),
    events: Type.Array(GoogleCalendarEventSchema, { maxItems: 50 })
  },
  { additionalProperties: false }
);
export type GoogleCalendarAgendaDayGroup = Static<typeof GoogleCalendarAgendaDayGroupSchema>;

export const GoogleCalendarAgendaQuerySchema = Type.Object(
  {
    windowStart: GoogleCalendarIsoDateTimeSchema,
    windowEnd: GoogleCalendarIsoDateTimeSchema,
    timeZone: GoogleCalendarTimeZoneSchema,
    includeCancelled: Type.Optional(Type.Boolean()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 }))
  },
  { additionalProperties: false }
);
export type GoogleCalendarAgendaQuery = Static<typeof GoogleCalendarAgendaQuerySchema>;

export const GoogleCalendarN8nContextSchema = Type.Object(
  {
    connector: Type.Literal('google_calendar'),
    operation: Type.Literal('read_agenda_snapshot'),
    readOnly: Type.Literal(true),
    timeZone: GoogleCalendarTimeZoneSchema,
    windowStart: GoogleCalendarIsoDateTimeSchema,
    windowEnd: GoogleCalendarIsoDateTimeSchema,
    eventIds: Type.Array(GoogleCalendarEventIdSchema, { maxItems: 50 })
  },
  { additionalProperties: false }
);
export type GoogleCalendarN8nContext = Static<typeof GoogleCalendarN8nContextSchema>;

export const GoogleCalendarAgendaResponseSchema = Type.Object(
  {
    windowStart: GoogleCalendarIsoDateTimeSchema,
    windowEnd: GoogleCalendarIsoDateTimeSchema,
    timeZone: GoogleCalendarTimeZoneSchema,
    totalEvents: Type.Integer({ minimum: 0, maximum: 50 }),
    conflictEventIds: Type.Array(GoogleCalendarEventIdSchema, { maxItems: 50 }),
    days: Type.Array(GoogleCalendarAgendaDayGroupSchema, { maxItems: 32 }),
    n8nContext: GoogleCalendarN8nContextSchema,
    untrusted: Type.Literal(true),
    mode: Type.Union([Type.Literal('mock'), Type.Literal('live')])
  },
  { additionalProperties: false }
);
export type GoogleCalendarAgendaResponse = Static<typeof GoogleCalendarAgendaResponseSchema>;

export const GoogleCalendarBriefingQuerySchema = Type.Object(
  {
    windowStart: GoogleCalendarIsoDateTimeSchema,
    windowEnd: GoogleCalendarIsoDateTimeSchema,
    timeZone: GoogleCalendarTimeZoneSchema,
    includeCancelled: Type.Optional(Type.Boolean()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    generateWorkflowBlueprint: Type.Optional(Type.Boolean()),
    workflowName: Type.Optional(Type.String({ minLength: 3, maxLength: 120 }))
  },
  { additionalProperties: false }
);
export type GoogleCalendarBriefingQuery = Static<typeof GoogleCalendarBriefingQuerySchema>;

export const GoogleCalendarBriefingAppointmentSchema = Type.Object(
  {
    id: GoogleCalendarEventIdSchema,
    summary: Type.String({ minLength: 1, maxLength: 1024 }),
    startAt: GoogleCalendarIsoDateTimeSchema,
    endAt: GoogleCalendarIsoDateTimeSchema,
    localDate: Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }),
    localTimeRange: Type.String({ minLength: 1, maxLength: 256 }),
    location: Type.Optional(Type.String({ maxLength: 1024 })),
    status: Type.Union([
      Type.Literal('confirmed'),
      Type.Literal('tentative'),
      Type.Literal('cancelled')
    ]),
    hasConflict: Type.Boolean(),
    attendeeCount: Type.Integer({ minimum: 0, maximum: 50 }),
    descriptionSnippet: Type.Optional(Type.String({ maxLength: 280 })),
    untrusted: Type.Literal(true)
  },
  { additionalProperties: false }
);
export type GoogleCalendarBriefingAppointment = Static<
  typeof GoogleCalendarBriefingAppointmentSchema
>;

export const GoogleCalendarBriefingResponseSchema = Type.Object(
  {
    windowStart: GoogleCalendarIsoDateTimeSchema,
    windowEnd: GoogleCalendarIsoDateTimeSchema,
    timeZone: GoogleCalendarTimeZoneSchema,
    totalEvents: Type.Integer({ minimum: 0, maximum: 50 }),
    conflictCount: Type.Integer({ minimum: 0, maximum: 50 }),
    conflictEventIds: Type.Array(GoogleCalendarEventIdSchema, { maxItems: 50 }),
    headline: Type.String({ minLength: 1, maxLength: 1024 }),
    appointments: Type.Array(GoogleCalendarBriefingAppointmentSchema, { maxItems: 50 }),
    n8nContext: GoogleCalendarN8nContextSchema,
    n8nBlueprint: Type.Optional(N8nWorkflowBlueprintSchema),
    workflowHash: Type.Optional(Type.String({ minLength: 16, maxLength: 128 })),
    untrusted: Type.Literal(true),
    mode: Type.Union([Type.Literal('mock'), Type.Literal('live')])
  },
  { additionalProperties: false }
);
export type GoogleCalendarBriefingResponse = Static<typeof GoogleCalendarBriefingResponseSchema>;

export const GoogleCalendarSendUpdatesSchema = Type.Union([
  Type.Literal('all'),
  Type.Literal('none')
]);
export type GoogleCalendarSendUpdates = Static<typeof GoogleCalendarSendUpdatesSchema>;

export const GoogleCalendarCreateEventInputSchema = Type.Object(
  {
    connectedCalendar: Type.String({ minLength: 1, maxLength: 320 }),
    summary: Type.String({ minLength: 1, maxLength: 500 }),
    description: Type.Optional(Type.String({ maxLength: 4000 })),
    location: Type.Optional(Type.String({ maxLength: 500 })),
    startAt: GoogleCalendarIsoDateTimeSchema,
    endAt: GoogleCalendarIsoDateTimeSchema,
    timeZone: GoogleCalendarTimeZoneSchema,
    attendees: Type.Optional(
      Type.Array(Type.String({ minLength: 3, maxLength: 320 }), { maxItems: 25 })
    ),
    reminders: Type.Optional(GoogleCalendarRemindersSchema),
    origin: Type.Optional(GoogleCalendarEventOriginSchema),
    sendUpdates: GoogleCalendarSendUpdatesSchema
  },
  { additionalProperties: false }
);
export type GoogleCalendarCreateEventInput = Static<typeof GoogleCalendarCreateEventInputSchema>;

export const GoogleCalendarRescheduleEventInputSchema = Type.Object(
  {
    connectedCalendar: Type.String({ minLength: 1, maxLength: 320 }),
    eventId: GoogleCalendarEventIdSchema,
    summary: Type.String({ minLength: 1, maxLength: 1024 }),
    expectedStartAt: GoogleCalendarIsoDateTimeSchema,
    expectedEndAt: GoogleCalendarIsoDateTimeSchema,
    expectedStatus: Type.Union([Type.Literal('confirmed'), Type.Literal('tentative')]),
    newStartAt: GoogleCalendarIsoDateTimeSchema,
    newEndAt: GoogleCalendarIsoDateTimeSchema,
    timeZone: GoogleCalendarTimeZoneSchema,
    reminders: Type.Optional(GoogleCalendarRemindersSchema),
    sendUpdates: GoogleCalendarSendUpdatesSchema
  },
  { additionalProperties: false }
);
export type GoogleCalendarRescheduleEventInput = Static<
  typeof GoogleCalendarRescheduleEventInputSchema
>;

export const GoogleCalendarCancelEventInputSchema = Type.Object(
  {
    connectedCalendar: Type.String({ minLength: 1, maxLength: 320 }),
    eventId: GoogleCalendarEventIdSchema,
    summary: Type.String({ minLength: 1, maxLength: 1024 }),
    expectedStartAt: GoogleCalendarIsoDateTimeSchema,
    expectedEndAt: GoogleCalendarIsoDateTimeSchema,
    expectedStatus: Type.Union([Type.Literal('confirmed'), Type.Literal('tentative')]),
    timeZone: GoogleCalendarTimeZoneSchema,
    sendUpdates: GoogleCalendarSendUpdatesSchema
  },
  { additionalProperties: false }
);
export type GoogleCalendarCancelEventInput = Static<typeof GoogleCalendarCancelEventInputSchema>;

export const GoogleCalendarMutationReceiptSchema = Type.Object(
  {
    connectorName: Type.Literal('google_calendar'),
    mode: Type.Union([Type.Literal('mock'), Type.Literal('live')]),
    operation: Type.Union([
      Type.Literal('create'),
      Type.Literal('reschedule'),
      Type.Literal('cancel')
    ]),
    status: Type.Union([
      Type.Literal('event_created'),
      Type.Literal('event_rescheduled'),
      Type.Literal('event_cancelled')
    ]),
    providerEventId: GoogleCalendarEventIdSchema,
    connectedCalendar: Type.String({ minLength: 1, maxLength: 320 }),
    summary: Type.String({ minLength: 1, maxLength: 1024 }),
    startAt: GoogleCalendarIsoDateTimeSchema,
    endAt: GoogleCalendarIsoDateTimeSchema,
    timeZone: GoogleCalendarTimeZoneSchema,
    previousStartAt: Type.Optional(GoogleCalendarIsoDateTimeSchema),
    previousEndAt: Type.Optional(GoogleCalendarIsoDateTimeSchema),
    attendees: Type.Optional(
      Type.Array(Type.String({ minLength: 3, maxLength: 320 }), { maxItems: 50 })
    ),
    reminders: Type.Optional(GoogleCalendarRemindersSchema),
    origin: Type.Optional(GoogleCalendarEventOriginSchema),
    sendUpdates: GoogleCalendarSendUpdatesSchema,
    completedAt: Type.String(),
    note: Type.String({ minLength: 1, maxLength: 500 })
  },
  { additionalProperties: false }
);
export type GoogleCalendarMutationReceipt = Static<typeof GoogleCalendarMutationReceiptSchema>;

export const GoogleCalendarPrepareCreateSchema = Type.Object(
  {
    summary: Type.String({ minLength: 1, maxLength: 500 }),
    description: Type.Optional(Type.String({ maxLength: 4000 })),
    location: Type.Optional(Type.String({ maxLength: 500 })),
    startAt: GoogleCalendarIsoDateTimeSchema,
    endAt: GoogleCalendarIsoDateTimeSchema,
    timeZone: Type.Optional(GoogleCalendarTimeZoneSchema),
    attendees: Type.Optional(
      Type.Array(Type.String({ minLength: 3, maxLength: 320 }), { maxItems: 25 })
    ),
    reminders: Type.Optional(GoogleCalendarRemindersSchema),
    origin: Type.Optional(GoogleCalendarEventOriginSchema),
    sendUpdates: Type.Optional(GoogleCalendarSendUpdatesSchema)
  },
  { additionalProperties: false }
);
export type GoogleCalendarPrepareCreate = Static<typeof GoogleCalendarPrepareCreateSchema>;

export const GoogleCalendarPrepareRescheduleSchema = Type.Object(
  {
    eventId: GoogleCalendarEventIdSchema,
    newStartAt: GoogleCalendarIsoDateTimeSchema,
    newEndAt: GoogleCalendarIsoDateTimeSchema,
    timeZone: Type.Optional(GoogleCalendarTimeZoneSchema),
    reminders: Type.Optional(GoogleCalendarRemindersSchema),
    sendUpdates: Type.Optional(GoogleCalendarSendUpdatesSchema)
  },
  { additionalProperties: false }
);
export type GoogleCalendarPrepareReschedule = Static<typeof GoogleCalendarPrepareRescheduleSchema>;

export const GoogleCalendarPrepareCancelSchema = Type.Object(
  {
    eventId: GoogleCalendarEventIdSchema,
    timeZone: Type.Optional(GoogleCalendarTimeZoneSchema),
    sendUpdates: Type.Optional(GoogleCalendarSendUpdatesSchema)
  },
  { additionalProperties: false }
);
export type GoogleCalendarPrepareCancel = Static<typeof GoogleCalendarPrepareCancelSchema>;

export const GoogleCalendarConflictSummarySchema = Type.Object(
  {
    id: GoogleCalendarEventIdSchema,
    summary: Type.String({ minLength: 1, maxLength: 1024 }),
    startAt: GoogleCalendarIsoDateTimeSchema,
    endAt: GoogleCalendarIsoDateTimeSchema,
    localTimeRange: Type.String({ minLength: 1, maxLength: 256 })
  },
  { additionalProperties: false }
);
export type GoogleCalendarConflictSummary = Static<typeof GoogleCalendarConflictSummarySchema>;

export const GoogleCalendarPreparedMutationSchema = Type.Object(
  {
    planId: Type.String({ format: 'uuid' }),
    approvalId: Type.String({ format: 'uuid' }),
    status: Type.Literal('awaiting_approval'),
    operation: Type.Union([
      Type.Literal('create'),
      Type.Literal('reschedule'),
      Type.Literal('cancel')
    ]),
    connectedCalendar: Type.String({ minLength: 1, maxLength: 320 }),
    eventId: Type.Optional(GoogleCalendarEventIdSchema),
    summary: Type.String({ minLength: 1, maxLength: 1024 }),
    description: Type.Optional(Type.String({ maxLength: 4000 })),
    location: Type.Optional(Type.String({ maxLength: 1024 })),
    startAt: GoogleCalendarIsoDateTimeSchema,
    endAt: GoogleCalendarIsoDateTimeSchema,
    previousStartAt: Type.Optional(GoogleCalendarIsoDateTimeSchema),
    previousEndAt: Type.Optional(GoogleCalendarIsoDateTimeSchema),
    timeZone: GoogleCalendarTimeZoneSchema,
    attendees: Type.Optional(
      Type.Array(Type.String({ minLength: 3, maxLength: 320 }), { maxItems: 50 })
    ),
    reminders: Type.Optional(GoogleCalendarRemindersSchema),
    origin: Type.Optional(GoogleCalendarEventOriginSchema),
    sendUpdates: GoogleCalendarSendUpdatesSchema,
    conflicts: Type.Array(GoogleCalendarConflictSummarySchema, { maxItems: 20 }),
    expiresAt: Type.String()
  },
  { additionalProperties: false }
);
export type GoogleCalendarPreparedMutation = Static<typeof GoogleCalendarPreparedMutationSchema>;
