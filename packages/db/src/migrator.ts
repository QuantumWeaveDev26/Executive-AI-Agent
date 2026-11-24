import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface MigrationFile {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export interface DbClient {
  query<R = any>(sql: string, params?: any[]): Promise<{ rows: R[] }>;
  exec?(sql: string): Promise<any>;
}

export function computeChecksum(content: string): string {
  return crypto.createHash('sha256').update(content.trim()).digest('hex');
}

export class Migrator {
  constructor(private client: DbClient) {}

  async init(): Promise<void> {
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  loadMigrationFiles(migrationsDir?: string): MigrationFile[] {
    let dir = migrationsDir;
    if (!dir) {
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const distDir = path.join(currentDir, 'migrations');
      const srcDir = path.join(currentDir, '..', 'src', 'migrations');
      if (fs.existsSync(distDir)) {
        dir = distDir;
      } else if (fs.existsSync(srcDir)) {
        dir = srcDir;
      } else {
        dir = distDir;
      }
    }

    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    return files.map((fileName) => {
      const filePath = path.join(dir, fileName);
      const sql = fs.readFileSync(filePath, 'utf-8');
      const version = fileName.split('_')[0] || fileName;
      const checksum = computeChecksum(sql);
      return {
        version,
        name: fileName,
        sql,
        checksum
      };
    });
  }

  async migrate(migrations: MigrationFile[]): Promise<{ applied: string[]; skipped: string[] }> {
    await this.init();

    const { rows: appliedRows } = await this.client.query<{
      version: string;
      name: string;
      checksum: string;
    }>('SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC;');

    const appliedMap = new Map(appliedRows.map((r) => [r.version, r]));
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const migration of migrations) {
      const existing = appliedMap.get(migration.version);
      if (existing) {
        if (existing.checksum !== migration.checksum) {
          throw new Error(
            `Incompatible migration state: Migration ${migration.name} checksum mismatch! ` +
              `Stored: ${existing.checksum}, Current: ${migration.checksum}. Migration files must not be altered once applied.`
          );
        }
        skipped.push(migration.version);
      } else {
        // Apply migration within transaction
        await this.client.query('BEGIN;');
        try {
          if (this.client.exec) {
            await this.client.exec(migration.sql);
          } else {
            await this.client.query(migration.sql);
          }
          await this.client.query(
            'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3);',
            [migration.version, migration.name, migration.checksum]
          );
          await this.client.query('COMMIT;');
          applied.push(migration.version);
        } catch (error) {
          await this.client.query('ROLLBACK;');
          throw new Error(
            `Failed to apply migration ${migration.name}: ${(error as Error).message}`
          );
        }
      }
    }

    return { applied, skipped };
  }
}
