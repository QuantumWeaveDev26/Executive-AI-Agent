import { loadConfig } from '@thaara/config';
import { PostgresDatabase } from '../client.js';
import { Migrator } from '../migrator.js';

async function run() {
  // Support distinct administrative migration credentials (MIGRATION_DATABASE_URL)
  // separating migration admin from runtime app user (DATABASE_URL / thaara_app)
  let migrationUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!migrationUrl) {
    const config = loadConfig();
    migrationUrl = config.DATABASE_URL;
  }

  console.log(`[Migrator] Connecting to database with administrative credentials...`);
  const db = new PostgresDatabase(migrationUrl);

  try {
    const migrator = new Migrator(db);
    const files = migrator.loadMigrationFiles();
    console.log(`[Migrator] Found ${files.length} migration files.`);
    const result = await migrator.migrate(files);
    console.log(`[Migrator] Applied: ${result.applied.join(', ') || 'none'}`);
    console.log(`[Migrator] Skipped: ${result.skipped.join(', ') || 'none'}`);
  } finally {
    await db.close();
  }
}

run().catch((err) => {
  console.error(`[Migrator Error]:`, err);
  process.exit(1);
});
