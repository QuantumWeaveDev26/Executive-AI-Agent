# Step 88 — Google Calendar Connection & Agenda UI

Date: 19 October 2026 (Asia/Calcutta)
Status: COMPLETE — mock/synthetic Calendar UI only; live Google Calendar connection remains `not_configured`
Workspace: `C:\ThaaraProjects\thaara-ai-agent-v2`
Branch: `dev-thaara-continuation`
Base Checkpoint (`HEAD`): `b9519f3`

## Implemented

1. **Browser Calendar API Boundary & Sanitizer ([`apps/web/src/calendar-api.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/web/src/calendar-api.ts))**:
   - Reuses `request()` cookie authentication and CSRF token headers (`x-csrf-token`) for `POST /api/v1/connectors/google-calendar/agenda` and `DELETE /api/v1/connectors/google-calendar/connection`.
   - Validates RFC3339 date ranges (`windowEnd > windowStart`, max 31-day span), IANA timezones via `Intl.DateTimeFormat`, and event IDs before any network request.
   - Rejects `live` mode responses, missing `untrusted: true` markers, mismatched IDs, and strips unknown/HTML/secret properties from returned events and attendees.
   - Formats event time ranges in the user's selected IANA timezone (`formatCalendarEventWindow`).
2. **State Machine & Subject/Epoch Fencing ([`apps/web/src/calendar-model.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/web/src/calendar-model.ts))**:
   - Enforces role gating (`owner`/`admin`/`member` allowed; `viewer` blocked immediately with `unauthorized: true` and zero API calls).
   - Supports 7-day range navigation (`shiftWindow(-7)`, `shiftWindow(7)`, `resetToToday()`), IANA timezone switching (`setTimeZone`), cancelled-event filtering (`toggleCancelled`), fresh event detail reads (`selectEvent`), and immediate fail-closed `disconnect()`.
   - Tracks `epoch`, `agendaVersion`, `detailVersion`, and `AbortController` so workspace/user/role changes, refreshes, or disconnects discard stale responses.
3. **Google Calendar Dashboard UI ([`apps/web/src/CalendarScreen.tsx`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/web/src/CalendarScreen.tsx), [`apps/web/src/App.tsx`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/web/src/App.tsx))**:
   - Mounted beside `GmailScreen` with composite subject key `'calendar-' + workspaceId + userId + role`.
   - Displays connection status badge, disabled `Connect Google Calendar` button, `Refresh Calendar`, `Local disconnect`, date-range navigation (`Previous 7 days`, `Today`, `Next 7 days`), `Include cancelled` toggle, and `Time zone` selector.
   - Renders schedule conflict alerts/badges (`conflictEventIds`), timezone-grouped daily event lists, read-only `n8n` snapshot metadata (`read_agenda_snapshot`), and plain-text untrusted event detail preview (`Untrusted calendar content`).

## Verification

- **Focused Step 88 Suites**: `31/31` passed across 5 files (`20/20` new browser tests in `calendar-api.test.ts` [9], `calendar-model.test.ts` [7], and `calendar-screen.test.tsx` [4], plus `11/11` in `google-calendar-api.test.ts` [5] and `google-calendar-foundation.test.ts` [6]).
- **Full Verification (`pnpm.cmd verify`)**: `55/55` test files passed (`655/655` tests, `0` failed), plus full workspace build, lint, and typecheck.

## Limitations & Recommended Step 89

- Real Google OAuth and live Calendar API calls remain `not_configured` (`mode: 'disabled'`).
- **Recommended Step 89**: Build the **Governed Calendar Briefing & Offline n8n Agenda Workflow Blueprint Composition** (allowing Thaara to compose and dry-run inactive `active: false` daily briefing workflows from the read-only `n8nContext` agenda snapshot without external execution).
