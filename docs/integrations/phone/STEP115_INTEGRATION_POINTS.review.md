# Step 115 shared integration points for review

Apply these changes individually during baseline reconciliation. The release archive deliberately omits full shared App and contracts-index replacements.

In `packages/contracts/src/index.ts`, retain all existing exports and ensure the following export exists once.

```ts
export * from './phone-callback-notification.js';
```

In `apps/api/src/app.ts`, retain all current routes and options. Add the two imports and the optional read-feed option alongside the existing Phone options.

```ts
import { phoneCallbackReportRoutes } from './routes/phone-callback-reports.js';
import type { PhoneCallbackReportReader } from './services/phone-callback-reports.js';

// BuildAppOptions
phoneCallbackReports?: PhoneCallbackReportReader;
```

Register the report route inside the existing authenticated `/api/v1` plugin, alongside `phoneInboundReportRoutes`.

```ts
await phoneCallbackReportRoutes(v1, options.phoneCallbackReports);
```

The default feed returns `not_configured`. Injected feeds remain protected by the existing production admission guard. Do not enable the production callback repository, provider binding or worker by removing that guard as part of an overlay. Admit those dependencies with the reviewed database principal and startup wiring first. The local `createPhoneCallbackRuntime` composes admission, committed capture, durable draining and owner reports without initiating a call or creating Calendar work.

The local grant workflow adds the following optional integration alongside the existing callback report routes. Preserve all current App options and registrations.

```ts
import { phoneCallbackAuthorizationRoutes, type PhoneCallbackAuthorization } from './routes/phone-callback-authorization.js';

// BuildAppOptions
phoneCallbackAuthorization?: PhoneCallbackAuthorization;

// Existing /api/v1 plugin
if (options.phoneCallbackAuthorization) {
  await phoneCallbackAuthorizationRoutes(v1, options.phoneCallbackAuthorization);
}
```

Pass the repository's bound `currentOwnerGrant` method to the dispatcher. Its returned approval identifier is rechecked in the same transaction that claims a notification. Keep the dedicated grant action separate from Gmail actions. The authorization routes retain their production guard.

Keep the existing Sarvam post-call capability validation and dispatch-attempt binding before callback projection. Bind the incoming number to verified telephony metadata and the outgoing number to the immutable approved dispatch. Incoming provider fields and model variables never choose the workspace, owner, direction or default phone number.

The local outbound App integration adds `phoneCallbackOutbound?: Parameters<typeof createPhoneCallbackOutboundCompletion>[0]`. It requires durable contacts/calls and the existing Sarvam webhook configuration, and it retains the production admission guard. When admitted, select `createCallbackAwarePhoneCallLedger(db)` and pass `createPhoneCallbackOutboundCompletion(pool)` to the Sarvam route. Preserve all existing ledger methods and default startup behavior.

In `PhoneLiveCallStore`, the new optional method is `bindCallbackNumber(scope, callId, phoneE164, draftHash): Promise<void>`. Invoke it after the one-use dispatch claim and before provider dispatch, using the revalidated contact number. Its failure must take the original audited failure path with `PHONE_CALLBACK_NUMBER_BINDING_FAILED` and a truthful no-call report. The release package omits complete shared PhoneCalling/App/index replacements. Review and merge these integration changes individually.

The dedicated worker uses `115w`, the inbound writer uses `115i` after the existing `112/113` principal schemas, and the outbound snapshot/completion writer uses `115o` after `110c/114`. These are isolated review SQL files with explicit target guards. Their hosted installation must be prepared from the approved production schema metadata and reviewed alongside all existing service identities.

## Callback report views

`apps/web/src/phone-callback-reports.ts` validates the owner-only read feed and supplies fixed notification status labels. `PhoneCallbackReports.tsx` renders the saved details as text, with a manual read-only refresh and request cancellation on refresh/unmount. No link, call, email or approval action is inferred from provider text.

Merge the three small UI integration points individually, preserving the shared files:

- `PhonePages.tsx`: import `PhoneCallbackReports`; render an outbound feed only when `ownerIdentity.role === 'owner'`, keyed by workspace/user.
- `PhoneInboundPage.tsx`: render an inbound feed after the existing owner access check, keyed by workspace/user.
- `PhoneCallChatCard.tsx`: render a feed filtered by exact `call.id` and outbound direction only after a real call reaches a terminal state. The API remains the authorization boundary.

These changes surface saved callbacks within an existing Chat call card. They do not create a new assistant message or complete the separate full-report Chat persistence work. Each feed reads the latest bounded report list once and supports manual refresh; an absent match is described as unavailable, never as caller refusal or successful delivery. A production API without admitted callback storage remains truthfully `not_configured`.
