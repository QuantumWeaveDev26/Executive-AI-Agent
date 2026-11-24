import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { computeCanonicalParameterHash } from '@thaara/contracts';
import { PhoneServicePool } from '../../node_modules/@thaara/db/dist/phone-service-pool.js';
import { PHONE_CALLBACK_SCHEMA_ATTESTATIONS } from './phone-callback-schema-attestation.js';
export { PHONE_CALLBACK_SCHEMA_ATTESTATIONS };
export const PHONE_CALLBACK_STARTUP_FILES = Object.freeze({
    profile: '/run/secrets/phone_callback_api_profile',
    ingestDatabase: '/run/secrets/phone_callback_ingest_database_url',
    outboundDatabase: '/run/secrets/phone_callback_outbound_database_url',
    inboundToken: '/run/secrets/phone_callback_inbound_token',
});
const invalid = () => new Error('Phone callback startup configuration unavailable.');
const exact = (value, keys) => !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const uuid = (value) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
/** Fixed managed-secret paths only. The descriptor remains bound across both metadata checks. */
export const nodePhoneCallbackStartupFiles = Object.freeze({
    async read(path) {
        if (!Object.values(PHONE_CALLBACK_STARTUP_FILES).some(allowed => allowed === path)
            || !Number.isInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW <= 0)
            throw invalid();
        const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const before = await file.stat();
            if (!before.isFile() || before.size < 1 || before.size > 8192 || ![0o400, 0o600].includes(before.mode & 0o7777))
                throw invalid();
            const content = await file.readFile('utf8'), after = await file.stat();
            if (['dev', 'ino', 'size', 'mode', 'mtimeMs', 'ctimeMs'].some(key => before[key] !== after[key]))
                throw invalid();
            return { content, mode: after.mode, size: after.size, regular: true };
        }
        finally {
            await file.close();
        }
    },
});
async function privateText(files, path) {
    const file = await files.read(path);
    if (file.regular !== true || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o177777 || ![0o400, 0o600].includes(file.mode & 0o7777)
        || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 8192 || typeof file.content !== 'string'
        || Buffer.byteLength(file.content, 'utf8') !== file.size)
        throw invalid();
    return file.content.trim();
}
function parseProfile(raw) {
    if (!exact(raw, ['version', 'runtimeProfile', 'reviewOnly', 'databaseHost', 'databasePort', 'databaseName', 'inbound'])
        || raw.version !== 1 || raw.runtimeProfile !== true || raw.reviewOnly !== false
        || typeof raw.databaseHost !== 'string' || raw.databaseHost.length > 253 || raw.databaseHost.split('.').length < 2
        || !raw.databaseHost.split('.').every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))
        || !Number.isSafeInteger(raw.databasePort) || Number(raw.databasePort) < 1 || Number(raw.databasePort) > 65535
        || typeof raw.databaseName !== 'string' || !/^[A-Za-z0-9_-]{1,63}$/.test(raw.databaseName))
        throw invalid();
    const p = raw.inbound;
    if (!exact(p, ['routeId', 'workspaceId', 'ownerUserId', 'principalId', 'revision', 'appId', 'appVersion', 'deploymentId', 'agentPhoneNumber', 'maxCallLengthSeconds'])
        || !id(p.routeId) || !uuid(p.workspaceId) || !uuid(p.ownerUserId) || !uuid(p.principalId)
        || !Number.isSafeInteger(p.revision) || Number(p.revision) < 1 || !Number.isSafeInteger(p.appVersion) || Number(p.appVersion) < 1
        || ![p.appId, p.deploymentId].every(value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value))
        || typeof p.agentPhoneNumber !== 'string' || !/^\+[1-9][0-9]{7,14}$/.test(p.agentPhoneNumber) || p.maxCallLengthSeconds !== 300)
        throw invalid();
    return structuredClone(raw);
}
function validateDatabaseUrl(text, role, profile) {
    if (/[\s\0]/.test(text))
        throw invalid();
    const url = new URL(text);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || decodeURIComponent(url.username) !== role || !url.password
        || url.hostname.toLowerCase() !== profile.databaseHost.toLowerCase() || Number(url.port || 5432) !== profile.databasePort
        || decodeURIComponent(url.pathname.slice(1)) !== profile.databaseName || url.hash
        || [...url.searchParams].length !== 1 || url.searchParams.get('sslmode') !== 'verify-full')
        throw invalid();
}
const tables = ['phone_contacts', 'phone_calls', 'phone_call_events', 'phone_inbound_call_events', 'phone_inbound_principals',
    'phone_callback_requests', 'phone_callback_notification_grants', 'phone_callback_notification_grant_uses', 'phone_callback_worker_principals', 'phone_callback_dispatch_numbers'];
const functions = {
    thaara_phone_ingest: ['public.phone_inbound_resolve_grant(text,text,text)', 'public.phone_inbound_append_event(jsonb)', 'public.phone_callback_inbound_save(jsonb,text)'],
    thaara_app: ['public.phone_callback_outbound_context(uuid,text,text)', 'public.phone_callback_outbound_save(uuid,text,text,jsonb,text)', 'public.complete_phone_provider_report(uuid,text,text,text,text,jsonb)'],
};
const catalogSql = `SELECT current_database() AS database_name,current_user AS role_name,session_user AS session_role_name,
 current_setting('server_version_num') AS server_version,r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolinherit,
 pg_catalog.has_schema_privilege(current_user,'public','CREATE') AS schema_create,
 EXISTS(SELECT 1 FROM pg_catalog.pg_roles x WHERE x.rolname<>current_user AND pg_catalog.pg_has_role(current_user,x.oid,'MEMBER')) AS elevated_membership,
 EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relowner=r.oid) AS owns_protected,
 EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN('r','p','v','m','f') AND
  (pg_catalog.has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR pg_catalog.has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) AS direct_protected_access,
 (SELECT count(*)::int FROM pg_catalog.pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[])) AS required_tables,
 (SELECT bool_and(c.relkind IN('r','p') AND c.relrowsecurity AND c.relforcerowsecurity) FROM pg_catalog.pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[])) AS forced_rls,
 (SELECT bool_and(COALESCE(pg_catalog.has_function_privilege(current_user,pg_catalog.to_regprocedure(f),'EXECUTE'),false)) FROM unnest($2::text[]) f) AS functions_ok,
 (SELECT jsonb_agg(jsonb_build_object('signature',f.signature,'ownerRole',owner.rolname,'securityDefiner',p.prosecdef,
  'definitionSha256',encode(sha256(convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex')) ORDER BY f.signature)
  FROM unnest($3::text[]) f(signature) LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(f.signature)
  LEFT JOIN pg_catalog.pg_roles owner ON owner.oid=p.proowner) AS function_attestations
 FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`;
/** Catalog-only readiness check. It does not resolve a grant or authorize a provider/worker operation. */
export async function inspectPhoneCallbackDatabase(db, role, databaseName) {
    if (!Object.hasOwn(functions, role) || typeof databaseName !== 'string')
        return false;
    try {
        const rows = (await db.query(catalogSql, [tables, functions[role], PHONE_CALLBACK_SCHEMA_ATTESTATIONS.map(item => item.signature)])).rows, row = rows[0];
        const observed = row?.function_attestations;
        const attestationsMatch = Array.isArray(observed) && observed.length === PHONE_CALLBACK_SCHEMA_ATTESTATIONS.length
            && new Set(observed.map(item => item?.signature)).size === observed.length
            && PHONE_CALLBACK_SCHEMA_ATTESTATIONS.every(expected => observed.some(item => item?.signature === expected.signature
                && item.ownerRole === expected.ownerRole && item.securityDefiner === expected.securityDefiner && item.definitionSha256 === expected.definitionSha256));
        return rows.length === 1 && !!row && row.database_name === databaseName && row.role_name === role && row.session_role_name === role
            && typeof row.server_version === 'string' && /^16\d{4}$/.test(row.server_version)
            && ['rolsuper', 'rolbypassrls', 'rolcreaterole', 'rolcreatedb', 'rolreplication', 'schema_create', 'elevated_membership', 'owns_protected'].every(key => row[key] === false)
            && (role === 'thaara_phone_ingest' ? row.rolinherit === false : typeof row.rolinherit === 'boolean')
            && (role !== 'thaara_phone_ingest' || row.direct_protected_access === false)
            && row.required_tables === tables.length && row.forced_rls === true && row.functions_ok === true && attestationsMatch;
    }
    catch {
        return false;
    }
}
async function nativeProbe(request) {
    const url = new URL(request.databaseUrl);
    const pool = new PhoneServicePool({ connectionString: request.databaseUrl, expectedRole: request.role,
        expectedHost: url.hostname, expectedPort: Number(url.port || 5432), expectedDatabase: request.databaseName });
    let connection, discard = false;
    try {
        connection = await pool.connect();
        await connection.query('BEGIN READ ONLY');
        const result = await inspectPhoneCallbackDatabase(connection, request.role, request.databaseName);
        await connection.query('ROLLBACK');
        return result;
    }
    catch {
        discard = true;
        throw invalid();
    }
    finally {
        try {
            connection?.release(discard);
        }
        finally {
            await pool.close();
        }
    }
}
const admittedPools = new WeakMap();
/** Object identity only; a successful preflight, cloned pool or caller-supplied flag is never admission. */
export function isAdmittedPhoneCallbackPool(pool, role) {
    return ['thaara_phone_ingest', 'thaara_app'].includes(role) && !!pool && typeof pool === 'object' && admittedPools.get(pool)?.role === role;
}
/** Verify only own primitive data fields against the native server profile; never evaluate caller accessors. */
export function matchesPhoneCallbackPoolBinding(pool, binding, role = 'thaara_phone_ingest') {
    if (!isAdmittedPhoneCallbackPool(pool, role) || !binding || typeof binding !== 'object')
        return false;
    const expected = admittedPools.get(pool).binding;
    const keys = Object.keys(expected);
    if (Reflect.ownKeys(binding).length !== keys.length)
        return false;
    return keys.every(key => {
        const descriptor = Object.getOwnPropertyDescriptor(binding, key);
        return !!descriptor && Object.hasOwn(descriptor, 'value') && descriptor.value === expected[key];
    });
}
/** Existing API only: reuse its app credential in memory; owner endpoints still require a real session. */
export async function openPhoneCallbackOwnerResources(options) {
    if (!options || !exact(options, ['environment']) || !options.environment || typeof options.environment !== 'object')
        return { status: 'refused', runtimeAdmitted: false };
    if (options.environment.THAARA_PHONE_CALLBACK_OWNER_RESOURCES !== 'approved')
        return { status: 'off', runtimeAdmitted: false };
    let pool, closing;
    function close() {
        if (pool)
            admittedPools.delete(pool);
        return closing ??= Promise.resolve().then(() => pool?.close()).then(() => undefined, () => { throw invalid(); });
    }
    try {
        const profile = parseProfile(JSON.parse(await privateText(nodePhoneCallbackStartupFiles, PHONE_CALLBACK_STARTUP_FILES.profile)));
        const existing = options.environment.DATABASE_URL;
        if (typeof existing !== 'string' || /[\s\0]/.test(existing))
            throw invalid();
        const target = new URL(existing);
        if (!['postgres:', 'postgresql:'].includes(target.protocol) || decodeURIComponent(target.username) !== 'thaara_app'
            || !target.password || decodeURIComponent(target.pathname.slice(1)) !== profile.databaseName || target.search || target.hash)
            throw invalid();
        // Connect only to the profile's attested TLS endpoint. Never connect to the source URL or persist/copy its credential.
        target.hostname = profile.databaseHost;
        target.port = String(profile.databasePort);
        target.search = '?sslmode=verify-full';
        validateDatabaseUrl(target.href, 'thaara_app', profile);
        pool = new PhoneServicePool({ connectionString: target.href, expectedRole: 'thaara_app', expectedHost: profile.databaseHost,
            expectedPort: profile.databasePort, expectedDatabase: profile.databaseName });
        Object.freeze(pool);
        let connection, discard = false;
        try {
            connection = await pool.connect();
            await connection.query('BEGIN READ ONLY');
            if (!await inspectPhoneCallbackDatabase(connection, 'thaara_app', profile.databaseName))
                throw invalid();
            await connection.query('ROLLBACK');
        }
        catch {
            discard = true;
            try {
                await connection?.query('ROLLBACK');
            }
            catch { /* discard failed lease */ }
            throw invalid();
        }
        finally {
            connection?.release(discard);
        }
        const profileFingerprint = computeCanonicalParameterHash({ ...profile.inbound, policy: 'phone.inbound.service.v1', direction: 'inbound',
            callbackMeaning: 'human_team_request', consentPolicy: 'explicit-recap.v1', mediaRetention: 'off', calendarBooking: 'disabled' });
        const binding = Object.freeze({ routeId: profile.inbound.routeId, workspaceId: profile.inbound.workspaceId,
            ownerUserId: profile.inbound.ownerUserId, principalId: profile.inbound.principalId, revision: profile.inbound.revision, profileFingerprint });
        admittedPools.set(pool, { role: 'thaara_app', binding });
        return Object.freeze({ status: 'resources_ready', runtimeAdmitted: false, profileFingerprint,
            inboundProfile: Object.freeze(structuredClone(profile.inbound)), outboundPool: pool, close });
    }
    catch {
        try {
            await close();
        }
        catch { /* sanitized refusal only */ }
        return { status: 'refused', runtimeAdmitted: false };
    }
}
/** Isolated inbound receiver: never reads or admits the shared application's database credential. */
export async function openPhoneCallbackIngestResources(options) {
    if (!options || !exact(options, ['environment']) || !options.environment || typeof options.environment !== 'object')
        return { status: 'refused', runtimeAdmitted: false };
    if (options.environment.THAARA_PHONE_CALLBACK_INGEST_RESOURCES !== 'approved')
        return { status: 'off', runtimeAdmitted: false };
    let pool, closing;
    function close() {
        if (pool)
            admittedPools.delete(pool);
        return closing ??= Promise.resolve().then(() => pool?.close()).then(() => undefined, () => { throw invalid(); });
    }
    try {
        const profile = parseProfile(JSON.parse(await privateText(nodePhoneCallbackStartupFiles, PHONE_CALLBACK_STARTUP_FILES.profile)));
        const ingestUrl = await privateText(nodePhoneCallbackStartupFiles, PHONE_CALLBACK_STARTUP_FILES.ingestDatabase);
        const token = await privateText(nodePhoneCallbackStartupFiles, PHONE_CALLBACK_STARTUP_FILES.inboundToken);
        if (!/^[A-Za-z0-9_-]{32,256}$/.test(token))
            throw invalid();
        validateDatabaseUrl(ingestUrl, 'thaara_phone_ingest', profile);
        pool = new PhoneServicePool({ connectionString: ingestUrl, expectedRole: 'thaara_phone_ingest', expectedHost: profile.databaseHost,
            expectedPort: profile.databasePort, expectedDatabase: profile.databaseName });
        Object.freeze(pool);
        let connection, discard = false;
        try {
            connection = await pool.connect();
            await connection.query('BEGIN READ ONLY');
            if (!await inspectPhoneCallbackDatabase(connection, 'thaara_phone_ingest', profile.databaseName))
                throw invalid();
            await connection.query('ROLLBACK');
        }
        catch {
            discard = true;
            try {
                await connection?.query('ROLLBACK');
            }
            catch { /* discard the failed lease */ }
            throw invalid();
        }
        finally {
            connection?.release(discard);
        }
        const profileFingerprint = computeCanonicalParameterHash({ ...profile.inbound, policy: 'phone.inbound.service.v1', direction: 'inbound',
            callbackMeaning: 'human_team_request', consentPolicy: 'explicit-recap.v1', mediaRetention: 'off', calendarBooking: 'disabled' });
        const binding = Object.freeze({ routeId: profile.inbound.routeId, workspaceId: profile.inbound.workspaceId,
            ownerUserId: profile.inbound.ownerUserId, principalId: profile.inbound.principalId, revision: profile.inbound.revision, profileFingerprint });
        admittedPools.set(pool, { role: 'thaara_phone_ingest', binding });
        return Object.freeze({ status: 'resources_ready', runtimeAdmitted: false, profileFingerprint,
            inboundProfile: Object.freeze(structuredClone(profile.inbound)), ingestPool: pool, close });
    }
    catch {
        try {
            await close();
        }
        catch { /* never expose driver or secret errors */ }
        return { status: 'refused', runtimeAdmitted: false };
    }
}
/** Native fixed-path composition only. Resource readiness does not register routes, enable calling or send mail. */
export async function openPhoneCallbackRuntimeResources(options) {
    if (!options || !exact(options, ['environment']) || !options.environment || typeof options.environment !== 'object')
        return { status: 'refused', runtimeAdmitted: false };
    if (options.environment.THAARA_PHONE_CALLBACK_RESOURCES !== 'approved')
        return { status: 'off', runtimeAdmitted: false };
    const pools = [];
    let closing;
    function close() {
        // Revoke synchronously, before asynchronous cleanup; even a failed close cannot retain admission.
        for (const pool of pools)
            admittedPools.delete(pool);
        return closing ??= Promise.allSettled(pools.map(pool => Promise.resolve().then(() => pool.close()))).then(results => {
            if (results.some(result => result.status === 'rejected'))
                throw invalid();
        });
    }
    try {
        const profile = parseProfile(JSON.parse(await privateText(nodePhoneCallbackStartupFiles, PHONE_CALLBACK_STARTUP_FILES.profile)));
        const ingestUrl = await privateText(nodePhoneCallbackStartupFiles, PHONE_CALLBACK_STARTUP_FILES.ingestDatabase);
        const outboundUrl = await privateText(nodePhoneCallbackStartupFiles, PHONE_CALLBACK_STARTUP_FILES.outboundDatabase);
        const token = await privateText(nodePhoneCallbackStartupFiles, PHONE_CALLBACK_STARTUP_FILES.inboundToken);
        if (!/^[A-Za-z0-9_-]{32,256}$/.test(token))
            throw invalid();
        validateDatabaseUrl(ingestUrl, 'thaara_phone_ingest', profile);
        validateDatabaseUrl(outboundUrl, 'thaara_app', profile);
        for (const [role, connectionString] of [['thaara_phone_ingest', ingestUrl], ['thaara_app', outboundUrl]]) {
            const pool = new PhoneServicePool({ connectionString, expectedRole: role, expectedHost: profile.databaseHost,
                expectedPort: profile.databasePort, expectedDatabase: profile.databaseName });
            pools.push(pool);
            Object.freeze(pool);
            let connection, discard = false;
            try {
                connection = await pool.connect();
                await connection.query('BEGIN READ ONLY');
                if (!await inspectPhoneCallbackDatabase(connection, role, profile.databaseName))
                    throw invalid();
                await connection.query('ROLLBACK');
            }
            catch {
                discard = true;
                try {
                    await connection?.query('ROLLBACK');
                }
                catch { /* discard the failed lease */ }
                throw invalid();
            }
            finally {
                connection?.release(discard);
            }
        }
        const profileFingerprint = computeCanonicalParameterHash({ ...profile.inbound, policy: 'phone.inbound.service.v1', direction: 'inbound',
            callbackMeaning: 'human_team_request', consentPolicy: 'explicit-recap.v1', mediaRetention: 'off', calendarBooking: 'disabled' });
        const binding = Object.freeze({ routeId: profile.inbound.routeId, workspaceId: profile.inbound.workspaceId,
            ownerUserId: profile.inbound.ownerUserId, principalId: profile.inbound.principalId, revision: profile.inbound.revision, profileFingerprint });
        admittedPools.set(pools[0], { role: 'thaara_phone_ingest', binding });
        admittedPools.set(pools[1], { role: 'thaara_app', binding });
        return Object.freeze({ status: 'resources_ready', runtimeAdmitted: false, profileFingerprint,
            inboundProfile: Object.freeze(structuredClone(profile.inbound)), ingestPool: pools[0], outboundPool: pools[1], close });
    }
    catch {
        try {
            await close();
        }
        catch { /* all resources were attempted; never expose a driver or secret error */ }
        return { status: 'refused', runtimeAdmitted: false };
    }
}
/** Disabled by default; successful preflight is explicitly NOT production admission or execution approval. */
export async function preparePhoneCallbackStartup(options) {
    if (options.environment.THAARA_PHONE_CALLBACK_API_PREFLIGHT !== 'approved')
        return { status: 'off', runtimeAdmitted: false, reasons: ['switch_off'] };
    const files = options.files ?? nodePhoneCallbackStartupFiles, probe = options.probe ?? nativeProbe;
    let profile, ingest, outbound;
    try {
        profile = parseProfile(JSON.parse(await privateText(files, PHONE_CALLBACK_STARTUP_FILES.profile)));
        ingest = await privateText(files, PHONE_CALLBACK_STARTUP_FILES.ingestDatabase);
        outbound = await privateText(files, PHONE_CALLBACK_STARTUP_FILES.outboundDatabase);
        const token = await privateText(files, PHONE_CALLBACK_STARTUP_FILES.inboundToken);
        if (!/^[A-Za-z0-9_-]{32,256}$/.test(token))
            throw invalid();
        validateDatabaseUrl(ingest, 'thaara_phone_ingest', profile);
        validateDatabaseUrl(outbound, 'thaara_app', profile);
    }
    catch {
        return { status: 'refused', runtimeAdmitted: false, reasons: ['configuration_invalid'] };
    }
    for (const [role, databaseUrl, reason] of [
        ['thaara_phone_ingest', ingest, 'ingest_database_denied'], ['thaara_app', outbound, 'outbound_database_denied'],
    ]) {
        try {
            if (await probe(Object.freeze({ databaseUrl, role, databaseName: profile.databaseName })) !== true)
                return { status: 'refused', runtimeAdmitted: false, reasons: [reason] };
        }
        catch {
            return { status: 'refused', runtimeAdmitted: false, reasons: [reason] };
        }
    }
    const profileFingerprint = computeCanonicalParameterHash({ ...profile.inbound, policy: 'phone.inbound.service.v1', direction: 'inbound',
        callbackMeaning: 'human_team_request', consentPolicy: 'explicit-recap.v1', mediaRetention: 'off', calendarBooking: 'disabled' });
    return { status: 'validated', runtimeAdmitted: false, profileFingerprint, reasons: [] };
}
