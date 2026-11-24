# Step 87 — Google Calendar Read-Only Foundation

Date: 17 October 2026 (Asia/Calcutta)
Status: COMPLETE — mock/synthetic foundation only; live Google Calendar remains `not_configured`
Workspace: `C:\ThaaraProjects\thaara-ai-agent-v2`
Branch: `dev-thaara-continuation`
Base Checkpoint (`HEAD`): `48511d7`

## Implemented

1. **Typed Calendar Event, Agenda, and n8n Snapshot Contracts ([`packages/contracts/src/google-calendar.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/packages/contracts/src/google-calendar.ts))**:
   - Published strict TypeBox schemas (`additionalProperties: false`) for `GoogleCalendarStatusSchema`, `GoogleCalendarStartSchema`, `GoogleCalendarCallbackSchema`, `GoogleCalendarEventSchema`, `GoogleCalendarListEventsSchema`, `GoogleCalendarListEventsResponseSchema`, `GoogleCalendarAgendaQuerySchema`, `GoogleCalendarAgendaResponseSchema`, and `GoogleCalendarN8nContextSchema`.
   - Every event, list response, and agenda response enforces `untrusted: true` and `mode: 'mock'`.
2. **PolicyGateway Action Registrations ([`packages/policy/src/registry.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/packages/policy/src/registry.ts))**:
   - Registered `calendar.connection.status` (`viewer`, `read`), `calendar.connection.start` (`member`, `write`), `calendar.connection.complete` (`member`, `write`), `calendar.connection.disconnect` (`member`, `write`), `calendar.events.list` (`member`, `read`), `calendar.events.read` (`member`, `read`), and `calendar.agenda.read` (`member`, `read`).
   - No event creation, update, deletion, invitation, or external execution actions are registered.
3. **Google Calendar Read-Only Service, Encrypted Vault, and Synthetic Provider ([`apps/api/src/services/google-calendar.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/src/services/google-calendar.ts))**:
   - `GoogleCalendarVault` encrypts OAuth pending states and tokens with AES-256-GCM and AAD bound to `['google_calendar', workspaceId, userId, purpose]`.
   - `GoogleCalendarFoundation` enforces fixed HTTPS callback URIs, single-use PKCE state/session binding, `https://www.googleapis.com/auth/calendar.readonly` scope, strict RFC3339 date-range validation (`windowEnd > windowStart`, max 31-day span), IANA timezone validation via `Intl.DateTimeFormat`, local-date day bucketing, overlapping conflict detection (`conflictEventIds`), read-only `n8nContext` (`read_agenda_snapshot`), unknown/HTML/secret field stripping, and epoch fencing across async operations.
   - `SyntheticGoogleCalendarProvider` provides deterministic synthetic calendar events for isolated test verification without external network calls.
4. **Authenticated API Routes ([`apps/api/src/routes/google-calendar.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/src/routes/google-calendar.ts), [`apps/api/src/app.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/src/app.ts))**:
   - Mounted `/api/v1/connectors/google-calendar/{status,oauth/start,oauth/callback,connection,events/list,events/:eventId,agenda}` with `no-store` headers, authentication, CSRF protection, pre/post-provider `resolve_session_scope` revalidation, secret-free RLS `audit_events`, and `NODE_ENV === 'test'` guard on mock injection.

## Verification

- **Focused Step 87 Suites**: `11/11` passed across 2 files (`6/6` in [`google-calendar-foundation.test.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/test/google-calendar-foundation.test.ts), `5/5` in [`google-calendar-api.test.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/test/google-calendar-api.test.ts)).
- **Full Verification (`pnpm.cmd verify`)**: `52/52` test files passed (`635/635` tests, `0` failed), plus full workspace build, lint, and typecheck.

## Limitations & Recommended Step 88

- Default runtime remains `not_configured` (`mode: 'disabled'`); real Google OAuth, durable Calendar token custody, and live Calendar API calls remain disabled.
- **Recommended Step 88**: Build the **Google Calendar Connection & Read-Only Agenda UI** (`CalendarScreen.tsx`) in the web dashboard, displaying connection status, timezone-aware daily agenda, conflict badges, untrusted text-only event details, and local disconnect.
