## Latest — Local call evidence and unsaved-number previews (not deployed)

Branch dev-thaara-continuation, HEAD 413f5a5; existing large dirty tree preserved. No Antigravity worktree/Bulk Campaign/WhatsApp edits. Owner reports real outbound call received; no new real call made by Codex.

Implemented: strict optional ordered report.conversation contract; bounded original-ASR/English-translation capture; uncertain speakers and truncation explicit; extractive highlights and adjacent Q/A pairs only. Shared PhoneCallReport renderer mounted in Chat and History Details; legacy records explicitly lack questions. Provider reader/webhook admission now retain both speakers locally. IMPORTANT: existing callback DB functions still persist recipient excerpts only; the new dialogue is NOT durably integrated into live callbacks. Read-only provider lookup does not replace the stored report. Terminal guards/original SQL unchanged.

Numbers: shared Indian mobile normalizer; exact authorized number matching, duplicate ambiguity preserved. Unsaved number creates owner-only pending one-call preview (no phone_contacts insertion). Name/recipient consent confirmation creates a separately immutable approval linked to original preview for reload/history lookup. Server-owned eligibility resolver required (absent => blocked); conservative 09:00–20:00 Asia/Kolkata window; repeat checks before approval/execution; directory collision fails closed. No production resolver configured. Existing PolicyGateway/provider fingerprint/daily cap/idempotency/audit remain. No arbitrary-number live activation.

Fresh verification: 127/127 in 10 focused files before final preview binding; affected 47/47 rerun after binding correction; evidence 5/5 after ordering/UTF8 tests. Combined latest per-file evidence 132/132, not a single 132-test invocation. Contracts build, API/web typechecks and web production build PASS (existing-size bundle warning; no refactor). Eligibility resolver exceptions fail closed without exposing diagnostics; final recipient tests 10/10. Existing Sarvam fixture tests used in-memory PGlite and fake network only; no Docker/PostgreSQL/provider requests. Initial sandbox spawn EPERM and one missing UUID-format-registry test failure corrected; final checks pass. Live deployment, storage, new-recipient dialing and company-answer quality NOT verified by these tests.

Browser read-only KB inspection attempted; Work settings disabled browser access. Actual running outbound version and attachment remain BLOCKED, historical v7/local KB files are not proof. No SSH/VPS access or credentials read. No agent/routing/SQL/approval-gate/deployment/commit/push changes.

Next: enable existing Chrome access and obtain read-only non-secret runtime version + provider KB attachment verification; prepare/review minimal existing report-write extension before separately authorized DB execution; configure reviewed recipient eligibility policy before deployment. Keep both features unactivated until these gates pass. Do not claim shared durable full-dialogue reports work live.

## Latest — Phone Chat fixes LIVE; existing-candidate activation PASS and browser preview PASS

Owner approved ONE activationmanifest c21647f3…35243a; allpins independentlymatched. Read-onlypreflight
healthy stable d19e baseline/existing213c candidate/tag verified;0activeDockerclients observed. Exactactivation
command ranONCE exit0. ONE isolatedcontainer360-filehashvalidation and correctedownedcleanup PASS;
NO BUILD. API-onlyswitch/currentprivatelinkrestore/health/auth401 PASS; other4services unchanged. Rollback
NOTrequired. NEW LIVE image sha256:213c9d89b6db4e3cc861f9adc548a629a0092285a9610bd147b56a3fd6bbc4e3.
4Phone/sharedroutefileschanged;356others/currentWhAppweb+modulespreserved. Agents28476/11564+authdirs
independentlyabsent. Protected rollback assets retained; gateconsumed,doNOTretry/reset.
FreshownerChromeChatthread 'Phone Chat activation verification'~17:24IST:exactwebsite-statuspurpose with
'Do not book an appointment or send a message' createdPhonepreview,NOTCalendar. ExistingCallkrishnanow
cardvisible/persistsafterreload;recipientmasked4634,5min,English/AIintro. NEVERclickedapprove/start. Normal
governedpreviewrows savedviaapp;no manualSQL/schema/appointments/provideractions. Authstatuslive_enabled,
durablehistorytrue,recordingfalse,speechVerifiedfalse. No realcall afteractivation. Browserhandedoffatpreview.
Evidence/scopedlimits:docs/integrations/phone/PHONE_CHAT_ACTIVATION_RESULT_2026-11-05.md pluscache receipts.
Next:separate ONE realcallapproval after freshconsent/credits/limits checks; no phoneagent/inbound/WhatsApp
changes. F03/appointmentsremainblocked. DoNOTclaim fullPhoneintegrationcomplete from previewalone.

## Latest — V3 built candidate213c9d…; stopped at cleanup guard, NO API switch

Owner-approvedV3ZIP/manifest allpins independentlymatched; oneattempt executed, exit1/isolated_validation/
validation_cleanup_unverified. CandidateBUILT sha256:213c9d89b6db4e3cc861f9adc548a629a0092285a9610bd147b56a3fd6bbc4e3.
Original d19e2e22…967df9healthyAPI/container/compose/other4services unchanged; publichealth/Phone/WhatsApp200.
No validationcontainers remain. Read-onlymissingIDprobeexit1 shows lowercase 'no such object'; guard required
uppercase 'No such object'. Confirmedcompatibilitybug; no APIchange/rollback reached. Eventsdidnotreturn
records; don'tclaim event destruction evidence/fullcandidate360match. Ownedagents/authdirs allabsent.
NO retry/rebuild/deploy/SQL/provider/calls. ConsumedV3gate andoldsource/ZIPpins unchanged. Localfixfull-ID
filteredlist(success+empty)8/8mocks; newexistingcandidateactivationONLY4/4rollback/configmocks;127functional
evidenceunchanged/historical. New ZIP aecbcb904955a9b0dac68b816e7a414f64801d5fda5c8db92a81e5356015eaf6;
newactivationmanifest c21647f348e2bdf01ecfda884d5fbd592026506f8de06d9a6f6460847835243a. NOTexecuted.
Exactresult/scope/command:PHONE_CHAT_V3_DEPLOYMENT_RESULT_2026-11-05.md. FreshapprovalneedsONE existing
candidatevalidation+conditionalAPIactivation/privatelink/rollback; NO BUILD/calls/messages/appointments.

## Latest — NEW d19e current-baseline Phone Chat package prepared; NOT built/deployed

Owner authorized readonlycurrentbaseline capture/localreconciliation only. Verifiedhealthy d19e2e22…967df9,
existinglocalFROMtag thaara-v2-whatsapp-enquiries:10831; strictSSH/ownedauthcleanup allpass.4Phoneinputs
unchanged; currentWhAppread/inbox/enquiry dependencies and newwebassets preserved. Newoverlay4APIjs only,
other356/360API+webhashes unchanged. Never reusedoldZIP or rebuiltrootfrontend; noWhatsApp/worktree edits.
Fresh merged backend106/106/8files:Phone41,WhatsApp60,Calendar5; newlive dependency initially missing from
localtestcopy capturedreadonly and blocked6files rerun71/71; original35passing unchangedPhonecases reused.
UI21/21. Currentdeploymentguards/diagnostics/rollback17/17mocks; package8/8guards.127functional+25preparation.
NoDockerbuild/container/deploy/SQL/calls/messages/credential/agent/F03changes. OriginalPGacceptance reused.
NewZIP output/THAARA_PHONE_CHAT_CURRENT_BASELINE_2026-11-05_V3.zip SHA256
855c92e8d49a8e2b4c4470766c068f7403e304beb14bd268c9b8b7871ddc29b8.
NEWmanifest PHONE_CHAT_CURRENT_DEPLOY_20261105.review.json SHA256
11c1b4fc0da75ccca4b1d38f8cf3b7723260a1f7aaf55a593923213d4aa78c26.
11ZIPentries/hashpinsreadbackverified; currentdeploymarker absent. Exactscope/command:
docs/integrations/phone/PHONE_CHAT_CURRENT_BASELINE_APPROVAL_2026-11-05.md.
Separateownerapprovalneeded for ONE build+isolatedvalidation+API-onlydeploy/existingprivate-linkrestore and
verifiedrollback to SAMEcurrentWhAppbaseline on post-switchfailure. No realcallapproval. Baseline/config
driftstop; nooldmarkers/pins reused. Stage/command/exit sanitizedreceipts retained; noloststderr-only failures.

## Latest — ONE approved SSH diagnosis PASS; live BASELINE CHANGED, STOPPED

Owner approved readonlymanifest8c31ade3…8b5de2; exacthash/allsourcepins matched before ONE execution.
Existing encryptedkey/temporaryagent auth and trustedSSHhost handshake PASS. No key/settings changes.
ACTUAL livehealthyAPI image sha256:d19e2e2217e8c41b8ce0eeb677b5585d7968acbd1bea6b37c69639a549d67df9;
container80be988beca504c3a2278a9409097772df86c655341505dd0bf9e37b57c77386.
This differs from required0287204a…7533161. STOPPED; no priorbuild/deploy package executed or repinned.
Currentimage has1localtag,0matching oldscript'sthaara-v2-pilot-api tagfilter; no tagnameexposed.
APIhealth/Phone/WhatsAppGET200. Agent27412/exactauthdir independentlyabsent. No builds,restarts,SQL,
provider/call/message actions or remotefilechanges. ExactpriorfailedSSH/remoteerror still unavailable;
doNOTclaim pastauthfailure. Confirmed NOW:SSHworks and baseline/container changed. Earlier strictbaseline
check wouldreject currentimage; previouslookup failure during possibletransition remainsunconfirmed.
Receipt:node_modules/.cache/phone-chat-build-v2-state-diagnostic-20261105.json. Permissionconsumed.
Next requires capture/reconciliation/pinning against NEW currentimage, firstchecking whether Phonefixes
alreadyexist; preservealllatestWhatsApp/Phone changes. Old expectedimage/manifests mustnotbe reused.

## Latest — Corrected build approval received; prerequisites FAILED, ZERO corrected builds executed

Owner approved correctedbuild manifest e18b4f85…488d1ca. Independently matched manifest/allsource/ZIP/base
pins; build gate unused. New owner-required read-only live/tag/concurrency preflight stopped at SSH remote
command stage. Subsequent read-only state check also stopped; exact remote exit/error lost by legacy
readonlywrapper. Do NOT infer missingtag, changedimage, authfailure or concurrentdeployment without evidence.
Stopped without invoking pinnedbuildwrapper:correctedbuildmarker absent. No build/deploy/restart/SQL/provider
actions. PublicAPIhealth/Phone/WhatsAppGET200 freshly confirmed, but CURRENTliveimage/tag/concurrency not
verified (last successfulimage0287204a…7533161 is HISTORICAL). Agents9688/9820 and ownedauthdirs absent.
Local-only readonlystatehelper now retains numeric remoteexit/safeerrorcategory or typed Dockerlookup
failure before aborting. Syntax/defaultreview-only pass; NOT executed remotely after this correction.
Next separate read-onlydiagnostic manifest PHONE_CHAT_BUILD_V2_STATE.review.json SHA256
8c31ade362984d9bb302f43acf4449932e7f82ba30a1bfaebef861c4918b5de2
should be independently rehashed before any future authorization (full actual hash in tool result/checkpoint).
Approved correctedbuild artifacts and consumed historicalmarkers retained unchanged. No automatic retry.

## Latest — ONE build-only diagnostic FAIL: FROM imageID incorrectly resolved as registry repository

Approvedonebuild executedwith allpins/preflight matched. docker build exit1; exact sanitized source-resolution
error docker.io/library/sha256/pullaccessdenied/insufficient_scope. Confirmed currentbuild cause:FROM
sha256:configID treatedasregistryrepo/tag. Originaldiscardederrornotretroactivelyrecovered. Noautomaticretry.
Live0287204a…7533161 unchangedhealthy; config/other4servicesidentical; health/Phone/WhatsApp200. No candidate,
runtimecontainer,deployment,restart,SQL,provideraction. Agent18552/tempdir independentlyabsent; consumedgate
preserved. LocalV2 usesexistingverifiedlocalprojecttag plusstdinDockerfile FROM-onlycorrection,no remotefile/
tagwrites;8/8mocks pass. NOT executed. NextONEcorrectedbuildapprovalmanifest e18b4f85…488d1ca, exactcommand
andfullpins:PHONE_CHAT_BUILD_DIAGNOSTIC_RESULT_2026-11-05.md. Noactivationauthorized. Phone/WhatsAppcode unchanged.

## Latest — ONE read-only failure diagnosis complete; historical command error NOT recoverable

All29 retained prebuild/path/hash/image/service checks pass now; package transfer/extraction verified.
LivehealthyAPI remains0287204a…7533161; no candidate image/validationcontainers/composeupdate. No scoped
logs or detailedreceipt retained; originalrun() discardedstderr/returncode and mainmasked command_failed.
Cannotconfirm historical failingcommand, exitcode or underlyingDocker cause. DoNOTguess orretrydeployment.
OneSSHdiagnostic authorized/completed; agent17612 and exactauthdir independentlyabsent; no productionwrites,
builds,restarts,SQL,provideractions. Permissionconsumed. Localcopyphone-chat-deploy.v2.review.py improves
sanitizedfailure/receiptcapture;6/6syntheticregressions pass. Originalpinnedfiles/ZIP/manifest/gates unchanged;
no newdeploymentZIPissued. Detailedrecord:PHONE_CHAT_FAILURE_DIAGNOSIS_2026-11-05.md. Nextrequires separate
pinnedbuild-onlydiagnostic approval,noAPIrestart/deploy; currentfailurecause remainsunconfirmed.

## Latest — ONE approved narrow Phone Chat deployment STOPPED; live WhatsApp baseline unchanged

Owner approved exact ZIP ada9bb97…f55d69 and manifest efd321d8…db5deb. Full hashes/source pins independently
matched; exact approved wrapper invoked ONCE. Exit1:deployment_check_failed, exact failed operation not retained.
SSH host verification/owned-auth cleanup passed. DO NOT RETRY:phone-chat-deploy-20261105.used.json consumed.
Separate read-only post-attempt verification within health/preservation scope confirms SAME original API
container/image healthy, compose hash unchanged, PostgreSQL/Redis/n8n/Traefik identities unchanged. Candidate
image absent; zero validation containers; no candidate/backup/rollback compose artifacts. Transferred protected
handoff/phone-chat-20261105 directory retained; no cleanup/removal authorization. No API restart or rollback.
Agents8024/6524 and owned auth dirs independently absent. No SQL/provider/agent/call/message actions.
Live Phone Chat approval card/routing fixes remain undeployed. WhatsApp preserved. Local86+17test evidence
unchanged, not a live success claim. Exact result/remaining uncertainty:
docs/integrations/phone/PHONE_CHAT_NARROW_DEPLOY_RESULT_2026-11-05.md.
Next:separate diagnostic-only approval to determine failed prebuild/build operation; no new execution allowed.

## Latest — Current WhatsApp baseline reconciled; narrow Phone Chat deployment package prepared, NOT deployed

Owner explicitly requested current live-image read/reconciliation and ONE pinned package only. Two read-only
SSH inventories agreed:API image sha256:0287204a4b9ba3db5febc37e5bf022e0d615f4c600d23a4452288f07a7533161,
healthy.360API/web files hashed; exact4compiledfiles captured. Protected compose/link hashes and other4service
identities retained locally. Temporary agents13836/17932 and owned auth directories absent independently.
No credential values output, remote writes/SQL/Docker setup/provider calls/deployment. Existing gates untouched.
Overlay patches the FOUR LIVE compiled files, not a root rebuild.356other API/web files including WhatsApp
and allwebassets unchanged. Exact compiled-overlay86/86 focused tests pass; additional17/17 mock/package
guards pass (5baseline,6deployment,6package). Package guard test initially found generated-wrapper syntax
error, corrected with literal-safe generator and reverified; no invalid wrapper used remotely.
ZIP output/THAARA_PHONE_CHAT_NARROW_DEPLOY_2026-11-05.zip,11entries readback/hash verified;
SHA256 ada9bb9714c8e398f028270b6fcd8d77180e81c81af9dc4b7d6e719f48f55d69.
Executionmanifest PHONE_CHAT_NARROW_DEPLOY_20261105.review.json SHA256
efd321d8ebefe74cea70a2948fe63ac2b9b7cfc9d7078dfc3b066ae6f7db5deb.
Exact scope/command:docs/integrations/phone/PHONE_CHAT_NARROW_DEPLOY_APPROVAL_2026-11-05.md.
Waiting separate owner approval before package transfer, image build/isolated validation/API restart and
existingprivate-link restoration; preserve exact currentWhatsAppbaseline for rollback. No Phone appointment,
F03,agent/routing,WhatsAppsource/worktree/frontend changes. No callapproval granted. Rootdirtywork preserved.

## Latest — Live outbound readiness checked; two Chat defects fixed LOCALLY, deployment NOT approved

5 Nov afternoon deadline sprint, branch dev-thaara-continuation/HEAD413f5a5; existing dirty work retained.
Fresh authenticated hosted /phone/ai/status:live_enabled,liveCallingEnabled=true,contactDirectoryConfigured=true,
durableCallHistory=true,simulationEnabled=false,recordingEnabled=false,speechVerified=false.
Fresh hosted history retains the owner's answered 10:34am call as Completed; report explicitly unverified.
No new call/provider test made. Step110 outbound operates independently of112h/113h/F03 appointment admission.
Created separate hosted Chat thread 'Phone website-status approval test'; only prepared one pending call for
krishna/number ending4634, maximum300s; did NOT approve/start it. Existing one-call permission is consumed.
Confirmed live defects:purpose containing 'Do not book an appointment' intercepted by Calendar; concise
explicit call gets LIVE preview text but no Call now card, including after reload. Calendar reports disconnected.
Local regressions independently reproduced BOTH failures before fixes. Phone plan lacked conversationId,
so existing conversation-message hydration omitted plan/approval metadata. Fixed server-owned conversation
context propagation through Phone service/store and narrow shared conversation-route Phone dispatch;
explicit call purpose now wins before Calendar intent. Existing Phone draft schema rejects extra public
fields; no externally supplied conversation context accepted. Plan/audit live mode reflects actual draft.
Shared route edits preserve WhatsApp logic; no frontend/WhatsApp/auth/nav/SQL/gates/live-agent changes.
Fresh final verification:86/86 tests across6root files,0fail; API typecheck and diff check pass. Evidence:
node_modules/.cache/phone-chat-deadline-final.json. Earlier shared run had45passing assertions but2archived
review copies failed dependency loading; final clean run excludes **/.agents/** and replaces that result.
No Docker/PostgreSQL/VPS/deploy/commit/push. Local fixes NOT live. No checksum-pinned deployment ready:
oldPHONE_DEPLOY_110 package already consumed and pins October image; current WhatsApp overlay baseline
must be preserved and freshly reconciled before any scoped API-only deployment approval. No reuse of old pins.
Appointments/inbound reporting stay gated:10unresolved effects,269unverified requirements,production admission
NOT ready;77historical UI tests/9historical storage cases not rerun or claimed as live. Current hosted menu
has legacy Call history/Contacts, not new local inbound/outbound pages. Sarvam inbound unchanged.
Next:prepare reviewed read-only current deployment inventory scope (noSQL/secrets), request owner approval,
then bind minimal Phone Chat correction to exact current deployment artifacts/rollback; deploy only with fresh
checksum-pinned approval. After that request ONE explicit website-status call approval and verify Chat/history.

## Latest — F-03 real catalog coverage fixes; evidence/review package ready, admission NOT ready

Root branch dev-thaara-continuation/HEAD413f5a5, dirty work preserved. Final4h sprint requested; no live
completion claim. New confirmed coverage defects:normalizer rejected all15 legitimate source triggers;
catalog query omitted thaara_definer. Fixed structured trigger fields/comparison, exact source-function/
table/name/deferral binding, firing mode, unsupported/transition rejection; query also fails closed for
disabled internal triggers. Read-only query candidate changed; original14 migration SQL hashes unchanged.
Do not reuse old query/normalizer approval pins or change any approval manifest. Query NOT run onPG.
Fresh135/135 focused local checks:134security/query/composition tests +1new coverage test binding all
269requirement IDs to fresh14-source/864-statement reduction. Existing80source-model tests/historical9DB
acceptance not rerun. Initial esbuild spawnEPERM resolved using reviewed local-test execution access.
The269condition requirements across15kinds are now enumerated with source/stage/expected predicate,
allowlisted proof shape and exact provenance bindings. Every entry remains NOT VERIFIED;10original
unresolved effects remain blocking. No evidence fabricated, no counts artificially reduced; expected
PG16 catalog, exact reference image/version and independent approval still missing. Native pgcrypto
routine/source coverage and generated base semantics are still unresolved. Reader remains disconnected.
One parallel helper hit usage limit before writing files; no helper results claimed as implementation.

Independent review ZIP:output/THAARA_PHONE_F03_ADMISSION_REVIEW_2026-11-05.zip,46entries verified against
per-fileSHA256 manifest. ZIP SHA256:7396701d7d71138aa6004299b6633056598f085e0cd4e9aa4d8368c7979ae1ed.
Handoff:F03_FINAL_ADMISSION_REVIEW_HANDOFF_2026-11-05.md; evidence requirements and inventory in same
docs/integrations/phone directory. No credentials/runtime secrets/cache/dumps included in ZIP.
Next:independent review of these fixes and all proof requirements, then prepare exact pinned isolated
source-reference evidence collection in existing framework; no execution authorization exists. Production
backup/install/identity/deploy/tool request can be finalized only after expected catalog/reference, target
evidence and independent reviewer acceptance. Do not label current contract final/execution-ready.
Livev5/v7/v9, WhatsApp worktree and source, UI, credentials, recovery kernel and approval gates untouched.
No VPS, Docker, persistentSQL, provider requests, calls, deployments, commits, pushes or merges.

## Latest — Phone appointment UI connected locally; production admission still blocked

Existing Phone Inbound details now mounts PhoneAppointmentReview with exact signed-in owner identity
(one Phone-only App.tsx prop change). Callback list shows customer, requested time, status and Review &
Approve. Existing CalendarMutationChatCard/canUserDecideApproval/decideApproval reused unchanged; no new
approval system. Owner-only response supplies existing plan/approval handles; provider response does not.
New authenticated GET appointment-review restores actual saved slot/approval after reopen without
proposal POST, automatic approval, Calendar access or another plan. UI confirmation still requires
backend event readback; completed plan alone never displays booking success. Double/uncertain approval
submission is not repeated; reload cannot silently re-enable the same attempted approval.
Fresh focused merged evidence:77/77 unique tests across9files (76 initial + affected-final27 replaces
3files),0failed/skipped. API/web typechecks and final web production build pass; existing chunk-size
warning retained, no config changes. Metadata/source hashes/test coverage:
node_modules/.cache/phone-appointment-ui-final-evidence-20261105.json. New standalone UI/client files,
PhoneInboundPage, one App prop, Phone-only shared contracts/report list and owner-review service/route
changed. No Calendar screen/card or shared authentication logic changed.
Parallel scoped F03 inspection/tests:80/80 across3unchanged reducer suites;10unresolved effects,269
unverified preconditions,279blocking conditions. No safe evidence-free reduction; expectedCatalog null,
productionAdmission/executionAuthorized false. Existing runtime review doc updated with review-only
identity/endpoint/tool delta, not execution authorization. Actual Sarvam call-bound capability issuance
and runtime admission remain required; never send owner session material to Sarvam or point its tool
at an owner UI endpoint. Current new owner/service routes remain test-only/unregistered.
No production approval package execution-ready. Minimum next review concerns independently specified
source/base semantics and stage-specific external proof; production migration/identity/deploy/tool
authorizations can be requested only after mandatory admission evidence is accepted.
Live inboundv5, outboundv7, candidatev9 and WhatsApp worktree untouched. No VPS, Docker, persistentSQL,
real calls, provider edits, credentials, commit/push/merge or gate changes. Existing DB acceptance reused
as historical storage evidence only; not proof of new deployed UI/appointment flow.

## Latest — owner-session appointment review, local only

Added owner-only inbound appointment proposal endpoint for an already durable, consent-backed journal
request. Authenticates exact current owner session before reading customer data; validates report identity,
workspace, owner, phone, consent and provider interaction binding. Reuses shared existing Calendar bridge.
No Sarvam owner-session delegation needed for THIS after-call owner-review path. This does not provide
in-call Calendar availability, service identity provisioning or automatic appointment capture. Existing
inbound service-tool path still requires production admission and a separately scoped identity.
Extracted common exact owner-session/slot validation; outbound owner follow-up now reuses it. No newSQL.
Fresh27/27 across3 affected API files,0failed; API typecheck passes. Prior48/48 remains historical for
unchanged principal/case5 checks. Evidence:phone-appointment-owner-20261105.json; source hashes in
phone-appointment-owner-20261105-sources.json under node_modules/.cache.
New routes remain unregistered/test-only. No UI appointment form added or live endpoint/Sarvam tool
connected. No production guard or approval changed. No VPS, Docker, real calls, credentials or provider
changes. Livev5/v7/v9 and WhatsApp untouched. Remaining critical blocker:112h/113h production admission
for durable inbound journal and principal, then scoped installation/deployment/tool approval. Current
UI can show existing pending Calendar approvals only after a proposal reaches the admitted backend.
Files:apps/api/src/services/phone-appointment-owner.ts, apps/api/src/services/phone-inbound-appointment-owner.ts, apps/api/src/routes/phone-inbound-appointment-owner.ts, apps/api/src/services/phone-outbound-appointments.ts, apps/api/test/phone-inbound-appointment-owner.test.ts.

## Latest — local bidirectional Calendar proposal bridge, 48/48 verified

Owner deferred voice testing; prioritizes appointments both directions and outbound KB.
Read-only Sarvam v7Committed: qw-company-kb-v1 attached, outbound instructions search shared KB
and return to exact approved purpose; unchanged. This does not prove hosted outbound uses v7.
Shared phone-appointment-calendar extracted from existing inbound bridge. Inbound durable journal
and principal gates unchanged. New outbound owner-session endpoint/service prepares a real governed
Calendar proposal tied to an existing durable completed outbound call; no Sarvam service grant or
automatic in-call capture. Never infer appointment consent from outbound calling consent. Owner
explicitly requests the proposal, then separately approves the existing Calendar action.
Only existing Calendar governance/PolicyGateway executes; confirmation requires verified receipt plus
exact event readback. No new SQL, request journal substitution, startup registration or production guard
removal. Pending/unavailable/failed saves stay truthful; saved proposals retain saved state on later
Calendar unavailability. Outbound request unavailable before proposal persistence -> saved:false.
Fresh 48/48 tests across5files, API typecheck and tracked targeted whitespace check pass. Includes
synthetic outbound Calendar event creation after owner approval, duplicates, slot changes, wrong scopes,
HTTP auth, storage/Calendar failures, cancelled event; actual Google/Sarvam not contacted by tests.
Existing in-memory fixture only; nine isolated PostgreSQL cases remain historical, not repeated.
Sources and hashes: node_modules/.cache/phone-appointments-bidirectional-20261105-sources.json.
Test evidence: node_modules/.cache/phone-appointments-bidirectional-20261105.json.
Changed files: apps/api/src/services/phone-appointment-calendar.ts, apps/api/src/services/phone-outbound-appointments.ts, apps/api/src/services/phone-inbound-appointments.ts, apps/api/src/routes/phone-outbound-appointments.ts, apps/api/test/phone-outbound-appointments.test.ts, packages/contracts/src/phone-inbound-appointments.ts.
Remaining: inbound112h/113h production admission, production call-scoped identity and trusted Calendar
owner delegation, approved endpoint deployment and Sarvam tool attachment. New outbound route is owner
follow-up only, NOT a during-call agent tool. No booking live, no call/deploy/provider mutations this slice.
Livev5 and candidatev9 preserved; v7Committed unchanged. WhatsApp worktree untouched.
Owner reiterates token efficiency: concise updates, targeted reads, focused checks, reuse verified evidence.

## Latest — owner-approved preservation and silent inbound candidate

Owner answered okay to preserving v7 unchanged as committed, then preparing a separate candidate;
live routing and paid calls explicitly excluded. Sarvam Genie preservation-only commit succeeded;
independent version selector shows v7 Committed with preservation note. Platform auto-createdv8Draft.
Edit from v5 dialog explicitly committed that unchanged latest copy and created exact v5 copy:
new candidate v9Draft. No live route update. Candidate instructions baseline preserved exactly as prefix,
only appended explicit English/Kannada requests for Hindi -> Change Output Language(Hindi), including
no false success on tool failure. Reload verified exact complete edited prompt persistence.
No sound selected and persisted after reload. Loaded settings verified Chaitra, qw-company-kb-v1,
English/Hindi/Kannada selected, switch-during-call and automatic-switch checked, five-minute maximum.
Existing Change Output Language system tool verified present. Live inbound deployment still Active v5.
No calls, paid simulations, credential changes, application deployment, SQL or Git commit/push.
Candidate remains v9Draft, untested audio. Not a fix deployed to outbound; actual prior call version
remains unverified. v7 is preserved as committed, not still Draft. Separate scoped approval required
for committing/admitting/routing candidate and any paid or real-call validation. Do not reuse consumed
one-call approval. No WhatsApp or application code modified during this candidate task.
## Latest — one real outbound call completed; language/sound follow-up

Owner explicitly approved ONE outbound test to existing contact ending4634, five-minute maximum,
20INRplusGST budget, no retry. Pre-call Sarvam balance38.92credits. Clicked Call krishna now ONCE.
Owner confirmed it rang and was answered. Hosted history shows5Nov10:34am Completed with actual
reported responses. Provider report remains labelled unverified; independent provider-result retrieval
was unavailable/pending. No additional call is authorized; approval consumed. No report-audio test.

Owner reports English -> Kannada worked, then requested Hindi but speech remained Kannada.
Read-only Sarvam inspection: committedv5 andv2 show Hindi enabled; v5 automatic language switching
and during-call switching checked. v2 prompt has general follow-language guidance, not an explicit
request-to-change-language/tool instruction. Exact call version and Hindi failure root cause NOT
confirmed; local pilot profile appVersion2 is historical configuration, not deployed-version proof.
Both inspected committed versions show Quiet office. All relevant controls disabled for committed
versions. Owner authorizes No sound, but no edit performed because Edit from this version risks
replacing preservedv7Draft. Need preservation-safe candidate/version authorization before proceeding.
v5/v7, voice, routing and all other integrations unchanged. No paid test, provider mutation or deployment.
# Thaara checkpoint — 5 November 2026

## Latest — direct hosted checks; outbound ALREADY live_enabled, no switch change needed

Branch dev-thaara-continuation, HEAD413f5a5; existing dirty Phone/WhatsApp changes preserved.
Owner requested a3–4hour critical-path sprint:appointments and approved outbound only; no unrelated work.
Connected owner-selected Chrome, existing logged-in Sarvam account. Read-only UI verified:
- Existing Thaara V2 - Inbound Voice deployment Active, committedv5, same number ending9780.
- Latest agent versionv7Draft; untouched. Committedv6 exists, outbound-only instructions, attached
  qw-company-kb-v1, Chaitra, five-minute maximum. Language control showsHindi/English/+1;
  third language not freshly expanded; earlier Kannada evidence remains historical.
- Committedv5 Custom tools tab EMPTY, Add tool disabled: appointment backend cannot be reached from
  this live agent. Do not Edit from this version, save a version, or overwritev7 without scoped approval.

Owner signed into hosted Thaara in Chrome. Authenticated GET /api/v1/connectors/phone/ai/status returned:
status:live_enabled,liveCallingEnabled:true,contactDirectoryConfigured:true,simulationEnabled:false,
durableCallHistory:true,recordingEnabled:false,speechVerified:false. This is CONFIGURATION evidence,
not proof of a connected call. Current loaded provider appVersion not exposed by this endpoint.
Dashboard displays Phone:unavailable because it uses legacy /connectors/phone/status, not /phone/ai/status.
No live config toggled; no SSH/SQL/credentials/providerAPI operation beyond existing read-only browser pages.

Existing contactkrishna, masked numberending4634, accepted by normal contact-resolution and draft flow.
Created ONE approval preview through existing Phone form; no Call krishna now click and no dialing.
Purpose:controlled integration test; check audibility and language preference; acknowledge actual answer,
end politely; no booking, message or follow-up. PreviewEnglish, maximum5minutes. Separate explicit owner
approval requested forONE real call, budget20INRplusGST, no retry, subject to available credits.
Approval pending at checkpoint creation. Do not reuse this statement as authorization. Draft may expire;
server must recheck consent/limits/profile/one-use approval at dispatch. No daily limits reset.

Sarvam public pricing checked5Nov:PAYG3.50INR/min plusVobiz0.20INR/30s, excludesGST;5min estimate19.50INR.
No recharge or purchase authorized. Current account credit balance still needs read-only verification.

Inbound appointment endpoint/Calendar bridge remains local test-only/unregistered.112h/113h production
admission F-03 stillOPEN. Reuse previous9isolated database cases, do not rerun. No production installation,
identity provisioning, endpoint deployment, Sarvam tool connection or real booking authorized yet.
Next immediate action:after explicit call approval, verify credits and exact current preview beforeONE
Call krishna now click, retain truthful call/history/provider-result evidence, no automatic redial.
Then complete existing inbound admission/deployment critical path without bypassing gates.
