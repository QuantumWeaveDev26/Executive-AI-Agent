import pg from 'pg';

export interface BootstrapConfig {
  adminPassword?: string;
  workerPassword?: string;
  seederPassword?: string;
  databaseName?: string;
}

export const ALLOWED_RUNTIME_IDENTITIES = [
  {
    loginRole: 'thaara_admin_user',
    privilegeRole: 'thaara_admin',
    envVar: 'THAARA_DB_ADMIN_PASSWORD'
  },
  {
    loginRole: 'thaara_worker_user',
    privilegeRole: 'thaara_worker',
    envVar: 'THAARA_DB_WORKER_PASSWORD'
  },
  {
    loginRole: 'thaara_seeder_user',
    privilegeRole: 'thaara_seeder',
    envVar: 'THAARA_DB_SEEDER_PASSWORD'
  }
] as const;

export type AllowedLoginRole = (typeof ALLOWED_RUNTIME_IDENTITIES)[number]['loginRole'];
export type AllowedPrivilegeRole = (typeof ALLOWED_RUNTIME_IDENTITIES)[number]['privilegeRole'];

const SAFE_IDENTIFIER_REGEX = /^[a-zA-Z0-9_]{1,63}$/;

export async function bootstrapRuntimeIdentities(
  adminClient: pg.ClientBase | { query: (sql: string, params?: any[]) => Promise<any> },
  config?: BootstrapConfig
): Promise<{ configuredRoles: string[] }> {
  const dbName = config?.databaseName || process.env.PGDATABASE || 'thaara_v2';

  // 1. Strict validation of databaseName to prevent SQL injection
  if (!SAFE_IDENTIFIER_REGEX.test(dbName)) {
    throw new Error(`Invalid database name "${dbName}": must match ${SAFE_IDENTIFIER_REGEX}`);
  }

  const passwords: Record<AllowedLoginRole, string> = {
    thaara_admin_user: config?.adminPassword || process.env.THAARA_DB_ADMIN_PASSWORD || '',
    thaara_worker_user: config?.workerPassword || process.env.THAARA_DB_WORKER_PASSWORD || '',
    thaara_seeder_user: config?.seederPassword || process.env.THAARA_DB_SEEDER_PASSWORD || ''
  };

  const configuredRoles: string[] = [];

  // Validate credentials against allow-list and required length
  for (const identity of ALLOWED_RUNTIME_IDENTITIES) {
    const pw = passwords[identity.loginRole];
    if (!pw || pw.trim().length === 0) {
      throw new Error(`Missing required password for ${identity.loginRole} (env: ${identity.envVar})`);
    }
    if (pw.length < 8) {
      throw new Error(`Password for ${identity.loginRole} is too short (must be at least 8 characters)`);
    }
  }

  // Execute in single atomic transaction
  await adminClient.query('BEGIN;');
  try {
    // 2. Verify all three NOLOGIN group roles exist and possess safe, intended attributes
    const groupRoles = ALLOWED_RUNTIME_IDENTITIES.map((i) => i.privilegeRole);
    const privRolesRes = await adminClient.query(
      `SELECT rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
       FROM pg_catalog.pg_roles
       WHERE rolname = ANY($1);`,
      [groupRoles]
    );

    const foundGroupMap = new Map<string, any>();
    for (const row of privRolesRes.rows) {
      foundGroupMap.set(row.rolname, row);
    }

    for (const privRole of groupRoles) {
      const row = foundGroupMap.get(privRole);
      if (!row) {
        throw new Error(`Privilege role "${privRole}" does not exist. Run migration 0004 first.`);
      }
      if (row.rolcanlogin) {
        throw new Error(`Privilege group role "${privRole}" must have NOLOGIN attribute.`);
      }
      if (row.rolsuper || row.rolcreaterole || row.rolcreatedb || row.rolreplication || row.rolbypassrls) {
        throw new Error(`Privilege group role "${privRole}" possesses unsafe attributes (superuser/bypassrls/etc.).`);
      }
    }

    // 3. Configure and verify each dedicated login identity
    for (const identity of ALLOWED_RUNTIME_IDENTITIES) {
      const loginRole = identity.loginRole;
      const privilegeRole = identity.privilegeRole;
      const pw = passwords[loginRole]!;

      // Check existing identity attributes before reuse
      const existingRes = await adminClient.query(
        `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls
         FROM pg_catalog.pg_roles WHERE rolname = $1;`,
        [loginRole]
      );

      if (existingRes.rows && existingRes.rows.length > 0) {
        const row = existingRes.rows[0];
        if (row.rolsuper || row.rolcreaterole || row.rolcreatedb || row.rolreplication || row.rolbypassrls) {
          throw new Error(
            `Dangerous role attributes detected on existing identity "${loginRole}". Superuser/BypassRLS/CreateRole prohibited.`
          );
        }

        // Verify existing identity does not hold unexpected role memberships
        const membershipRes = await adminClient.query(
          `SELECT r.rolname
           FROM pg_catalog.pg_roles r
           JOIN pg_catalog.pg_auth_members m ON m.roleid = r.oid
           JOIN pg_catalog.pg_roles u ON u.oid = m.member
           WHERE u.rolname = $1;`,
          [loginRole]
        );

        for (const mRow of membershipRes.rows) {
          if (mRow.rolname !== privilegeRole) {
            throw new Error(
              `Unexpected role membership detected on identity "${loginRole}": member of "${mRow.rolname}". Only "${privilegeRole}" is permitted.`
            );
          }
        }
      }

      // Transfer password through transaction-local custom setting (never logged in query text)
      await adminClient.query("SELECT pg_catalog.set_config('app.ephemeral_bootstrap_pw', $1, true);", [pw]);

      // Create or alter login identity with least privilege attributes
      await adminClient.query(`
        DO $$
        DECLARE
          v_pw TEXT := pg_catalog.current_setting('app.ephemeral_bootstrap_pw', true);
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${loginRole}') THEN
            EXECUTE pg_catalog.format(
              'CREATE ROLE %I WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
              '${loginRole}', v_pw
            );
          ELSE
            EXECUTE pg_catalog.format(
              'ALTER ROLE %I WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
              '${loginRole}', v_pw
            );
          END IF;
        END $$;
      `);

      // Clear the temporary setting
      await adminClient.query("SELECT pg_catalog.set_config('app.ephemeral_bootstrap_pw', '', true);");

      // Verify post-condition attributes on created/altered role
      const verifyIdentityRes = await adminClient.query(
        `SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
         FROM pg_catalog.pg_roles WHERE rolname = $1;`,
        [loginRole]
      );
      const verifyRow = verifyIdentityRes.rows[0];
      if (!verifyRow || !verifyRow.rolcanlogin || verifyRow.rolinherit || verifyRow.rolsuper || verifyRow.rolcreaterole || verifyRow.rolbypassrls) {
        throw new Error(`Identity "${loginRole}" verification failed: expected LOGIN NOINHERIT NOSUPERUSER.`);
      }

      // Grant CONNECT ON DATABASE safely
      await adminClient.query(`
        DO $$
        BEGIN
          EXECUTE pg_catalog.format('GRANT CONNECT ON DATABASE %I TO %I', '${dbName}', '${loginRole}');
        END $$;
      `);

      // Grant privilege role membership
      await adminClient.query(`
        DO $$
        BEGIN
          EXECUTE pg_catalog.format('GRANT %I TO %I', '${privilegeRole}', '${loginRole}');
        END $$;
      `);

      configuredRoles.push(loginRole);
    }

    await adminClient.query('COMMIT;');
    return { configuredRoles };
  } catch (err) {
    await adminClient.query('ROLLBACK;');
    try {
      await adminClient.query("SELECT pg_catalog.set_config('app.ephemeral_bootstrap_pw', '', true);");
    } catch {
      // ignore
    }
    throw new Error(`[Bootstrap Failure]: ${(err as Error).message}`);
  }
}

// Auto-run if executed directly as script
if (
  process.argv[1]?.endsWith('bootstrap-runtime-identities.ts') ||
  process.argv[1]?.endsWith('bootstrap-runtime-identities.js')
) {
  const { Client } = pg;
  const migrationUrl = process.env.BOOTSTRAP_DATABASE_URL || process.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl) {
    console.error('[Bootstrap Error]: MIGRATION_DATABASE_URL or BOOTSTRAP_DATABASE_URL is required.');
    process.exit(1);
  }
  const client = new Client({ connectionString: migrationUrl });
  client
    .connect()
    .then(async () => {
      try {
        const res = await bootstrapRuntimeIdentities(client);
        console.log(`[Bootstrap] Configured runtime identities: ${res.configuredRoles.join(', ')}`);
        process.exit(0);
      } catch (err) {
        console.error('[Bootstrap Error]:', (err as Error).message);
        process.exit(1);
      } finally {
        await client.end();
      }
    })
    .catch((err) => {
      console.error('[Bootstrap Connection Error]:', (err as Error).message);
      process.exit(1);
    });
}
