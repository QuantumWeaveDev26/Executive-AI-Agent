import pg from 'pg';
import crypto from 'node:crypto';

const { Client } = pg;

export interface ProvisionResult {
  migratorUrl: string;
  appUrl: string;
  dbName: string;
  migratorRole: string;
  migratorPassword: string;
  appPassword: string;
  host: string;
}

export async function provisionTask004Fresh(rootAdminUrl?: string, validateTarget?: (url: string) => unknown): Promise<ProvisionResult> {
  const adminUrl =
    rootAdminUrl ||
    process.env.BOOTSTRAP_DATABASE_URL ||
    process.env.MIGRATION_DATABASE_URL;

  if (!adminUrl) {
    throw new Error(
      '[Task 004 Provisioning] Administrative database URL is required. ' +
        'Set MIGRATION_DATABASE_URL or BOOTSTRAP_DATABASE_URL. ' +
        'Hardcoded postgres:postgres credentials have been removed.'
    );
  }

  const migratorPassword =
    process.env.TASK004_MIGRATOR_PASSWORD ||
    crypto.randomBytes(16).toString('hex');

  const appPassword =
    process.env.EPHEMERAL_APP_SECRET ||
    process.env.TASK004_APP_PASSWORD ||
    crypto.randomBytes(16).toString('hex');

  const dbName = 'thaara_task004_fresh';
  const migratorRole = 'thaara_migrator_test';

  // Reject derived targets before any connection or destructive query.
  if (validateTarget) {
    validateTarget(adminUrl);
    const target = new URL(adminUrl);
    target.pathname = '/' + dbName;
    validateTarget(target.href);
  }

  const client = new Client({ connectionString: adminUrl });
  await client.connect();

  try {
    // Terminate existing connections to the target fresh database
    await client.query(
      `
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid();
    `,
      [dbName]
    );

    const escId = (id: string) => client.escapeIdentifier(id);
    const escLit = (lit: string) => client.escapeLiteral(lit);

    // Drop previous isolated database and role if present
    await client.query(`DROP DATABASE IF EXISTS ${escId(dbName)};`);
    await client.query(`DROP ROLE IF EXISTS ${escId(migratorRole)};`);

    // Ensure thaara_app exists with valid credentials
    const appRoleCheck = await client.query(
      `SELECT 1 FROM pg_roles WHERE rolname = $1;`,
      ['thaara_app']
    );
    if (appRoleCheck.rows.length === 0) {
      await client.query(
        `CREATE ROLE ${escId('thaara_app')} WITH LOGIN PASSWORD ${escLit(appPassword)};`
      );
    } else {
      await client.query(
        `ALTER ROLE ${escId('thaara_app')} WITH LOGIN PASSWORD ${escLit(appPassword)};`
      );
    }

    // Create non-superuser migration identity with CREATEROLE and BYPASSRLS
    await client.query(
      `CREATE ROLE ${escId(migratorRole)} WITH LOGIN PASSWORD ${escLit(migratorPassword)} NOSUPERUSER CREATEROLE BYPASSRLS;`
    );

    // Create fresh isolated database owned by non-superuser migration identity
    await client.query(
      `CREATE DATABASE ${escId(dbName)} WITH OWNER = ${escId(migratorRole)};`
    );
    await client.query(
      `GRANT ALL PRIVILEGES ON DATABASE ${escId(dbName)} TO ${escId(migratorRole)};`
    );

    // Connect to fresh isolated database as admin to assign public schema ownership to migration identity
    const freshDbAdminUrlObj = new URL(adminUrl);
    freshDbAdminUrlObj.pathname = `/${dbName}`;
    const freshDbClient = new Client({ connectionString: freshDbAdminUrlObj.toString() });
    await freshDbClient.connect();
    try {
      await freshDbClient.query(`GRANT ALL ON SCHEMA public TO ${escId(migratorRole)};`);
      await freshDbClient.query(`ALTER SCHEMA public OWNER TO ${escId(migratorRole)};`);
    } finally {
      await freshDbClient.end();
    }

    // Grant thaara_app membership to migrator identity with admin option
    await client.query(
      `GRANT ${escId('thaara_app')} TO ${escId(migratorRole)} WITH ADMIN OPTION;`
    );

    // Build connection URLs
    const urlObj = new URL(adminUrl);
    const host = urlObj.host;
    const adminUser = urlObj.username || 'postgres';

    // Grant administrative roles to migrator identity with admin option
    // (Including adminUser/postgres so migration 0009 can transfer procedure ownership to postgres)
    const optionalAdminRoles = [
      adminUser,
      'postgres',
      'thaara_platform_owner',
      'thaara_definer',
      'thaara_worker'
    ];
    for (const r of optionalAdminRoles) {
      if (!r) continue;
      const exists = await client.query(
        `SELECT 1 FROM pg_roles WHERE rolname = $1;`,
        [r]
      );
      if (exists.rows.length > 0) {
        await client.query(
          `GRANT ${escId(r)} TO ${escId(migratorRole)} WITH ADMIN OPTION;`
        );
      }
    }

    urlObj.username = migratorRole;
    urlObj.password = migratorPassword;
    urlObj.pathname = `/${dbName}`;
    const migratorUrl = urlObj.toString();

    urlObj.username = 'thaara_app';
    urlObj.password = appPassword;
    const appUrl = urlObj.toString();

    return {
      migratorUrl,
      appUrl,
      dbName,
      migratorRole,
      migratorPassword,
      appPassword,
      host
    };
  } catch (err) {
    const rawMsg = (err as Error).message || String(err);
    const safeMsg = redactSecrets(rawMsg, [migratorPassword, appPassword]);
    const sanitizedError = new Error(safeMsg);
    if ((err as Error).stack) {
      sanitizedError.stack = redactSecrets((err as Error).stack!, [migratorPassword, appPassword]);
    }
    throw sanitizedError;
  } finally {
    await client.end();
  }
}

function redactSecrets(text: string, secrets: string[] = []): string {
  let safe = text.replace(/:\/\/[^:]+:[^@]+@/g, '://[REDACTED]:[REDACTED]@');
  for (const s of secrets) {
    if (s && s.length >= 6) {
      safe = safe.split(s).join('[REDACTED]');
    }
  }
  return safe;
}

// Standalone CLI execution
if (process.argv[1] && process.argv[1].includes('provision-task004-fresh')) {
  provisionTask004Fresh()
    .then(async (result) => {
      // 1. Never print credentials to stdout or logs. Log only host, database name, and role name.
      console.log(
        `[Task 004 Provisioning] Successfully initialized isolated database "${result.dbName}" on host "${result.host}".`
      );
      console.log(
        `[Task 004 Provisioning] Configured roles: "${result.migratorRole}" (non-superuser migration identity) and "thaara_app" (application runtime).`
      );

      // 2. Safely mask credentials in GitHub Actions environment without printing
      if (process.env.GITHUB_ENV) {
        // Mask passwords and URLs so GitHub Actions redacts them everywhere
        console.log(`::add-mask::${result.migratorPassword}`);
        console.log(`::add-mask::${result.appPassword}`);
        console.log(`::add-mask::${result.migratorUrl}`);
        console.log(`::add-mask::${result.appUrl}`);

        const fs = await import('node:fs');
        fs.appendFileSync(
          process.env.GITHUB_ENV,
          `TASK004_MIGRATOR_PASSWORD=${result.migratorPassword}\nTASK004_APP_PASSWORD=${result.appPassword}\nTASK004_MIGRATION_DATABASE_URL=${result.migratorUrl}\nTASK004_DATABASE_URL=${result.appUrl}\n`
        );
      }
    })
    .catch((err) => {
      // Avoid secret-bearing error output
      const rawMsg = (err as Error).message || String(err);
      const safeMsg = redactSecrets(rawMsg);
      console.error('[Task 004 Provisioning Error]:', safeMsg);
      process.exit(1);
    });
}
