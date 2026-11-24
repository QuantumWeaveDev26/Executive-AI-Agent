import { describe, it, expect, beforeEach } from 'vitest';
import { PGliteDatabase } from '../src/pglite.js';
import { Migrator, MigrationFile } from '../src/migrator.js';

describe('Database Migrations', () => {
  let db: PGliteDatabase;
  let migrator: Migrator;

  beforeEach(() => {
    db = new PGliteDatabase();
    migrator = new Migrator(db);
  });

  it('applies migrations cleanly and the second run is a no-op', async () => {
    const files = migrator.loadMigrationFiles();
    expect(files.length).toBeGreaterThanOrEqual(2);

    // First run: all applied
    const firstRun = await migrator.migrate(files);
    expect(firstRun.applied.length).toBe(files.length);
    expect(firstRun.skipped.length).toBe(0);

    // Second run: no-op, all skipped
    const secondRun = await migrator.migrate(files);
    expect(secondRun.applied.length).toBe(0);
    expect(secondRun.skipped.length).toBe(files.length);
  });

  it('fails safely when migration state is altered or incompatible', async () => {
    const files = migrator.loadMigrationFiles();
    await migrator.migrate(files);

    // Tamper with a migration checksum
    const tamperedFiles: MigrationFile[] = files.map((f) => {
      if (f.version === '0001') {
        return { ...f, checksum: 'tampered-sha256-checksum' };
      }
      return f;
    });

    await expect(migrator.migrate(tamperedFiles)).rejects.toThrow(/Incompatible migration state/);
  });
});
