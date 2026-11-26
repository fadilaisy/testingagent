// Copies a ROAMR SQLite database (the pre-Postgres format) into Postgres.
//
//   DATABASE_URL=postgres://... node src/migrate-sqlite.js /data/roamr.db
//
// The target must be empty: the script refuses to run on a database that
// already has users, so it can't mix two sites' data. Everything is copied in
// one transaction, so a failure leaves the target empty again.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openDb, transaction } from './db.js';

// Parents before children, so foreign keys hold while copying.
export const TABLES = [
  'users',
  'sessions',
  'password_resets',
  'oauth_states',
  'subscriptions',
  'routes',
  'activity_plans',
  'activity_participants',
  'chat_messages',
  'track_reports',
  'communities',
  'community_members',
  'events',
  'event_participants',
  'event_payments',
  'notifications',
  'places',
  'content_reports',
];

const BATCH = 200;

// Returns { table: rowsCopied }.
export async function copySqliteToPostgres(sqliteFile, db) {
  if (!fs.existsSync(sqliteFile)) throw new Error(`No SQLite file at ${sqliteFile}`);
  // Opened read-write so rows still in the -wal file are included; SQLite
  // only folds them into the main file, nothing else is changed.
  const src = new DatabaseSync(sqliteFile);
  try {
    src.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    if ((await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n > 0) {
      throw new Error('The target database already has users; migrate into an empty database');
    }
    const counts = {};
    await transaction(db, async (tx) => {
      for (const table of TABLES) {
        const srcCols = new Set(src.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
        if (!srcCols.size) {
          counts[table] = 0;
          continue;
        }
        // Columns added in later releases may be missing from old files;
        // those take the Postgres defaults.
        const pgCols = (
          await tx
            .prepare('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position')
            .all(table)
        ).map((c) => c.column_name);
        const cols = pgCols.filter((c) => srcCols.has(c));
        const rows = src.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all();
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH);
          const values = batch.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ');
          await tx
            .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values}`)
            .run(...batch.flatMap((r) => cols.map((c) => r[c])));
        }
        // Identity columns must continue after the copied ids.
        if (pgCols.includes('id')) {
          await tx.exec(
            `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${table}`,
          );
        }
        counts[table] = rows.length;
      }
    });
    return counts;
  } finally {
    src.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: DATABASE_URL=postgres://... node src/migrate-sqlite.js <path to roamr.db>');
    process.exit(1);
  }
  const db = await openDb(loadConfig().database);
  try {
    const counts = await copySqliteToPostgres(file, db);
    for (const [table, n] of Object.entries(counts)) console.log(`${table.padEnd(22)} ${n}`);
    console.log('Done.');
  } catch (err) {
    console.error(`[migrate] ${err.message}`);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
