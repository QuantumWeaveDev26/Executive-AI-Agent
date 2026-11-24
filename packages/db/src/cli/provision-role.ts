import { PostgresDatabase } from '../client.js';

async function run() {
  const migrationUrl = process.env.BOOTSTRAP_DATABASE_URL || process.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl) {
    throw new Error('MIGRATION_DATABASE_URL or BOOTSTRAP_DATABASE_URL is required to provision thaara_app role.');
  }
  const secret = process.env.EPHEMERAL_APP_SECRET;

  if (!secret) {
    throw new Error('EPHEMERAL_APP_SECRET environment variable is required to provision thaara_app role.');
  }

  // Sanitize secret to ensure it contains only hexadecimal / alphanumeric characters
  if (!/^[a-zA-Z0-9_\-]+$/.test(secret)) {
    throw new Error('EPHEMERAL_APP_SECRET contains invalid characters.');
  }

  console.log('[Role Provisioning] Connecting as migration admin to set thaara_app password...');
  const db = new PostgresDatabase(migrationUrl);

  try {
    await db.exec(`ALTER ROLE thaara_app WITH LOGIN PASSWORD '${secret}';`);
    console.log('[Role Provisioning] thaara_app role successfully configured with login password.');
  } finally {
    await db.close();
  }
}

run().catch((err) => {
  console.error('[Role Provisioning Error]:', err);
  process.exit(1);
});
