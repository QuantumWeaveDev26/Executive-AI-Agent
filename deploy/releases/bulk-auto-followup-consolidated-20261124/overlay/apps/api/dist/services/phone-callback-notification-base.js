import {formatCallbackIntakeOwnerMessage} from '../../phone-callback-intake.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { PhoneCallbackDetailsSchema } from '@thaara/contracts';
import { ActionRegistry, PolicyGateway } from '@thaara/policy';
import { ForbiddenError } from '@thaara/observability';
import { isCallbackSender, PHONE_CALLBACK_RECIPIENT } from './phone-callback-mail.js';
const id = /^[A-Za-z0-9_./:-]{1,220}$/;
const phone = /^\+[1-9][0-9]{7,14}$/;
const recap = /\b(?:callback|call\s+(?:you\s+)?back|contact\s+you)\b|ಮರಳಿ ಕರೆ|ಮತ್ತೆ ಕರೆ|ಸಂಪರ್ಕ|वापस कॉल|दोबारा कॉल|संपर्क/iu;
const confirmationQuestion = /\b(?:may i|can i|should i|shall i|do you confirm)\b.*\b(?:record|submit|save|arrange|request|confirm)\b|ದಾಖಲಿಸಬಹುದೇ|ದಾಖಲಿಸಲೇ|ದೃಢಪಡಿಸುತ್ತೀರಾ|क्या मैं.*(?:दर्ज|भेज|अनुरोध)|क्या आप.*पुष्टि/iu;
const shareQuestion = /\b(?:may|can|should|shall) i share your callback request\b/iu;
const correction = /\b(?:actually|instead|correction|change|incorrect|wrong|no,)\b|\bmy (?:name|number|phone|business|service) is\b|ಬದಲ|ತಪ್ಪು|बदल|गलत/iu;
const yes = /^(?:yes(?:,? please)?|yes please contact me|ಹೌದು(?: ದಯವಿಟ್ಟು)?|हाँ|हां|जी हाँ|जी हां)[.!।\s]*$/iu;
const no = /^(?:no(?:,? thanks)?|ಬೇಡ|ಇಲ್ಲ|नहीं|नही)[.!।\s]*$/iu;
const withdrawal = /(?:do not|don['’]t).*?(?:call|contact)|cancel.*callback|stop (?:calling|contacting)|ಕರೆ ಮಾಡಬೇಡಿ|ಕರೆ ಬೇಡ|ಸಂಪರ್ಕಿಸಬೇಡಿ|कॉल मत|कॉल नहीं|कॉल न करें|संपर्क मत/iu;
const requestForCallback = /\b(?:(?:can|could|would) (?:you|someone|your team)|please) (?:call|contact) me (?:back|later)\b|\b(?:i (?:want|need)|requesting) a callback\b|ದಯವಿಟ್ಟು.*(?:ಮರಳಿ ಕರೆ|ಮತ್ತೆ ಕರೆ)|(?:कृपया|मुझे).*(?:वापस कॉल|दोबारा कॉल).*(?:करें|करना|करिए)/iu;
const clean = (value) => typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim().slice(0, 240) || null : null;
function recapNumber(text) {
    const numbers = [...text.matchAll(/\+?[0-9](?:[0-9 ()-]*[0-9])?/g)]
        .filter(match => match[0].replace(/\D/g, '').length >= 8);
    if (!numbers.length)
        return null;
    if (numbers.length !== 1 || /^\s*(?:ext\b|extension\b|x\s*\d|#\s*\d)/iu.test(text.slice(numbers[0].index + numbers[0][0].length)))
        return '';
    return '+' + numbers[0][0].replace(/\D/g, '');
}
/** Project structured details after the backend admits and binds the call. */
export function projectCallbackRequest(call, raw) {
    if (!Value.Check(PhoneCallbackDetailsSchema, raw) || ![call.workspaceId, call.userId, call.callId].every(value => typeof value === 'string' && id.test(value)) ||
        !['inbound', 'outbound'].includes(call.direction) || !Number.isFinite(Date.parse(call.occurredAt)) || call.turns.length > 200)
        return null;
    const defaultNumber = call.verifiedNumber && phone.test(call.verifiedNumber) ? call.verifiedNumber : null;
    const supplied = clean(raw.phoneNumber);
    const alternative = supplied !== null && supplied !== defaultNumber;
    const name = clean(raw.name) ?? clean(call.known?.name);
    const business = clean(raw.business) ?? clean(call.known?.business);
    const service = clean(raw.service) ?? clean(call.known?.service);
    let confirmed = false;
    let requested = false;
    let confirmedNumber = null;
    for (let index = 0; index < call.turns.length; index++) {
        const previous = call.turns[index - 1];
        const current = call.turns[index];
        if (current.speaker !== 'caller' || typeof current.text !== 'string' || current.text.length > 2000)
            continue;
        const callerText = current.text + ' ' + (current.englishText ?? '');
        if (withdrawal.test(callerText))
            return null;
        // A later "no" to an unrelated service/closing question does not withdraw callback consent.
        // Explicit withdrawal is handled above; refusal to a callback recap is handled below.
        if (confirmed && correction.test(callerText))
            confirmed = false;
        if (requestForCallback.test(current.text))
            requested = true;
        if (previous?.speaker !== 'agent' || typeof previous.text !== 'string' || previous.text.length > 2000 ||
            !recap.test(previous.text) || !(confirmationQuestion.test(previous.text) || shareQuestion.test(previous.text)))
            continue;
        if (no.test(current.text.trim()))
            return null;
        if (!yes.test(current.text.trim()))
            continue;
        requested = true;
        const normalize = (value) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, ' ').trim();
        const spoken = normalize(previous.text + ' ' + (previous.englishText ?? ''));
        confirmed = [name, business, service].every(value => !value || spoken.includes(normalize(value)));
        const spokenNumber = recapNumber(previous.text);
        if (alternative)
            confirmedNumber = supplied && phone.test(supplied) && spokenNumber === supplied ? supplied : null;
        else
            confirmedNumber = spokenNumber === null || spokenNumber === defaultNumber ? defaultNumber : null;
    }
    if (!confirmed && !requested)
        return null;
    const phoneNumber = confirmed ? confirmedNumber : alternative ? null : defaultNumber;
    const numberSource = phoneNumber ? (alternative ? 'caller_confirmed' : 'call_metadata') : null;
    const requestId = createHash('sha256').update(JSON.stringify([call.workspaceId, call.userId, call.direction, call.callId])).digest('hex');
    return { id: requestId, workspaceId: call.workspaceId, userId: call.userId, callId: call.callId, direction: call.direction,
        name, business, service, phoneNumber, numberSource, occurredAt: new Date(call.occurredAt).toISOString(), status: 'requested',
        notificationStatus: confirmed ? 'pending' : 'needs_review', notificationAttemptId: null, providerMessageId: null, attempts: 0 };
}
export function callbackMissingFields(request) {
    return ['name', 'business', 'service', 'phoneNumber'].filter(field => !request[field]);
}
export function formatCallbackEmail(request) {
    if(request.capturePhase==='during_call'){
        const {subject,bodyText}=formatCallbackIntakeOwnerMessage({id:request.id,callId:request.callId,details:request});
        return {subject,bodyText};
    }
    const missing = 'Not provided';
    return { subject: 'Thaara AI — New Callback Request',
        bodyText: `New Callback Request\n\nName: ${clean(request.name) ?? missing}\nPhone: ${clean(request.phoneNumber) ?? missing}\nBusiness: ${clean(request.business) ?? missing}\nService Needed: ${clean(request.service) ?? missing}` };
}
/** Call identity and scope come from the server-bound resolver. */
export function createCallbackCapture(options) {
    return async (input, structuredDetails) => {
        const details = structuredClone(structuredDetails);
        const call = await options.admit(input);
        if (!call)
            throw new ForbiddenError('Callback call admission was denied.');
        const request = projectCallbackRequest(call, details);
        if (!request)
            return { saved: false };
        const saved = await options.repository.save(request);
        return { saved: true, requestId: saved.id, notificationStatus: saved.notificationStatus, missingFields: callbackMissingFields(saved) };
    };
}
/** Server-only dispatcher. Its dependencies must come from the admitted Phone worker. */
export function createCallbackNotificationDispatcher(options) {
    const actionName = 'phone.callback.notify_company';
    const registry = new ActionRegistry();
    registry.register({ metadata: { name: actionName, actionClass: 'write', risk: 'high', approvalMode: 'none', idempotencyRequired: true,
            timeoutMs: 10000, retryPolicy: { maxRetries: 0, backoffMs: 0, exponential: false }, requiredRole: 'owner', auditRequired: true,
            capabilityScope: 'external_connector', schemaIdentifier: 'phone.callback.notify_company.v1' },
        inputSchema: Type.Object({ requestId: Type.String({ pattern: '^[a-f0-9]{64}$' }), to: Type.String(), from: Type.String() }, { additionalProperties: false }) });
    const policy = new PolicyGateway({ registry });
    return async (scope, requestId) => {
        const request = await options.repository.read(scope, requestId);
        if (!request || request.workspaceId !== scope.workspaceId || request.userId !== scope.userId ||
            request.notificationStatus !== 'pending' || request.status !== 'requested' || request.attempts >= 2)
            return 'not_eligible';
        if (options.transport.ready && !await options.transport.ready())
            return 'not_configured';
        const grant = await options.currentOwnerGrant(scope);
        const to = PHONE_CALLBACK_RECIPIENT;
        const from = options.transport.sender;
        if (!grant || grant.enabled !== true || grant.workspaceId !== scope.workspaceId || grant.userId !== scope.userId ||
            grant.approvedByUserId !== scope.userId || !(Date.parse(grant.expiresAt) > (options.now ?? Date.now)()) ||
            to !== grant.recipient || !isCallbackSender(from) || from !== grant.sender)
            return 'awaiting_owner_authorization';
        const idempotencyKey = 'callback:' + requestId;
        if (!policy.evaluate({ ...scope, role: 'owner' }, { actionName, parameters: { requestId, to, from }, idempotencyKey }).allowed) {
            return 'awaiting_owner_authorization';
        }
        const attempt = randomUUID();
        const claimedAttempt = await options.repository.claim(scope, requestId, attempt, grant.approvalId);
        if (claimedAttempt === null)
            return 'not_eligible';
        let outcome = 'unverified';
        let providerMessageId;
        try {
            const result = await options.transport.send({ ...formatCallbackEmail(request), to, from, idempotencyKey });
            if (typeof result === 'object' && result && /^[A-Za-z0-9_-]{1,128}$/.test(result.acceptedId)) {
                outcome = 'submitted';
                providerMessageId = result.acceptedId;
            }
            else if (result === 'rejected')
                outcome = 'failed';
            else if (result === 'not_submitted')
                outcome = claimedAttempt === 1 ? 'pending' : 'failed';
        }
        catch { /* Unknown submissions are never retried automatically. */ }
        await options.repository.finish(scope, requestId, attempt, outcome, providerMessageId);
        return outcome;
    };
}
//# sourceMappingURL=phone-callback-notification.js.map