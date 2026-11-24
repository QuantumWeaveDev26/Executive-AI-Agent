import pg from 'pg';
function unavailable(error) {
    const sanitized = new Error('Phone service connection unavailable.');
    const code = error?.code;
    if (typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code))
        sanitized.code = code;
    return sanitized;
}
const identitySql = `SELECT current_database() AS database_name,current_user AS role_name,session_user AS session_role_name,
 current_setting('server_version_num') AS server_version,r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolinherit,
 EXISTS(SELECT 1 FROM pg_catalog.pg_roles x WHERE x.rolname<>current_user AND pg_catalog.pg_has_role(current_user,x.oid,'MEMBER')) AS elevated_membership
 FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`;
/** Dedicated verified-TLS login pool. No role switching, owner session, credential logging or automatic retry. */
export class PhoneServicePool {
    #pool;
    #role;
    #database;
    #closed = false;
    #closing;
    #failClosed = () => {
        this.#closed = true;
        try {
            void this.close().catch(() => { });
        }
        catch { /* No raw driver error escapes a background event. */ }
    };
    constructor(options) {
        try {
            if (!options || typeof options !== 'object' || Array.isArray(options)
                || Object.keys(options).sort().join(',') !== 'connectionString,expectedDatabase,expectedHost,expectedPort,expectedRole'
                || typeof options.connectionString !== 'string' || /[\s\0]/.test(options.connectionString)
                || !['thaara_phone_ingest', 'thaara_app', 'thaara_phone_notify'].includes(options.expectedRole)
                || typeof options.expectedHost !== 'string' || !/^[A-Za-z0-9.-]{1,253}$/.test(options.expectedHost)
                || !Number.isSafeInteger(options.expectedPort) || options.expectedPort < 1 || options.expectedPort > 65535
                || typeof options.expectedDatabase !== 'string' || !/^[A-Za-z0-9_-]{1,63}$/.test(options.expectedDatabase))
                throw unavailable();
            const url = new URL(options.connectionString), password = decodeURIComponent(url.password);
            if (!['postgres:', 'postgresql:'].includes(url.protocol) || decodeURIComponent(url.username) !== options.expectedRole
                || !password || /[\x00-\x1f\x7f]/.test(password) || url.hostname.toLowerCase() !== options.expectedHost.toLowerCase()
                || Number(url.port || 5432) !== options.expectedPort || decodeURIComponent(url.pathname.slice(1)) !== options.expectedDatabase
                || url.hash || [...url.searchParams].length !== 1 || url.searchParams.get('sslmode') !== 'verify-full')
                throw unavailable();
            this.#role = options.expectedRole;
            this.#database = options.expectedDatabase;
            // Explicit driver fields prevent connection-string options overriding TLS or resource limits.
            this.#pool = new pg.Pool({ host: url.hostname, port: options.expectedPort, database: options.expectedDatabase,
                user: options.expectedRole, password, ssl: { rejectUnauthorized: true }, max: 2, connectionTimeoutMillis: 5000,
                idleTimeoutMillis: 10000, query_timeout: 6000, statement_timeout: 5000, lock_timeout: 1000,
                idle_in_transaction_session_timeout: 5000, application_name: 'thaara-phone-callback' });
            this.#pool.on('error', this.#failClosed);
        }
        catch (error) {
            throw unavailable(error);
        }
    }
    async connect() {
        if (this.#closed)
            throw unavailable();
        let client;
        try {
            client = await this.#pool.connect();
            if (this.#closed)
                throw unavailable();
            client.on('error', this.#failClosed);
            const rows = (await client.query(identitySql)).rows, row = rows[0];
            if (rows.length !== 1 || !row || row.database_name !== this.#database || row.role_name !== this.#role || row.session_role_name !== this.#role
                || typeof row.server_version !== 'string' || !/^16\d{4}$/.test(row.server_version)
                || ['rolsuper', 'rolbypassrls', 'rolcreaterole', 'rolcreatedb', 'rolreplication', 'elevated_membership'].some(key => row[key] !== false)
                || (this.#role !== 'thaara_app' ? row.rolinherit !== false : typeof row.rolinherit !== 'boolean'))
                throw unavailable();
            if (this.#closed)
                throw unavailable();
            const leased = client;
            let active = true;
            return {
                query: async (sql, parameters) => {
                    if (!active || this.#closed)
                        throw unavailable();
                    try {
                        const result = await leased.query(sql, parameters);
                        if (!active || this.#closed)
                            throw unavailable();
                        return { rows: result.rows, rowCount: result.rowCount };
                    }
                    catch (error) {
                        throw unavailable(error);
                    }
                },
                release: (discard = false) => {
                    if (!active)
                        return;
                    active = false;
                    try {
                        leased.release(discard || this.#closed ? true : undefined);
                    }
                    catch (error) {
                        throw unavailable(error);
                    }
                    finally {
                        leased.removeListener('error', this.#failClosed);
                    }
                },
            };
        }
        catch (error) {
            if (client) {
                try {
                    client.release(true);
                }
                catch {
                    throw unavailable();
                }
                finally {
                    client.removeListener('error', this.#failClosed);
                }
            }
            throw unavailable(error);
        }
    }
    close() {
        if (!this.#closing) {
            this.#closed = true;
            this.#closing = this.#pool.end().catch(error => { throw unavailable(error); });
        }
        return this.#closing;
    }
}
