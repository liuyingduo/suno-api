import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdirSync } from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'suno.db');

const g = global as unknown as { _sunoDB?: Database.Database };

function openDb(): Database.Database {
  if (g._sunoDB) return g._sunoDB;
  const db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id          TEXT PRIMARY KEY,
      email       TEXT NOT NULL,
      cookie      TEXT NOT NULL,
      credits_left     INTEGER,
      period           TEXT,
      monthly_limit    INTEGER,
      monthly_usage    INTEGER,
      last_refreshed   TEXT,
      added_at    TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS models (
      external_key          TEXT PRIMARY KEY,
      model_id              TEXT NOT NULL,
      name                  TEXT NOT NULL,
      major_version         INTEGER NOT NULL DEFAULT 0,
      description           TEXT NOT NULL DEFAULT '',
      is_default_free_model INTEGER NOT NULL DEFAULT 0,
      is_default_model      INTEGER NOT NULL DEFAULT 0,
      can_use               INTEGER NOT NULL DEFAULT 0,
      badges                TEXT NOT NULL DEFAULT '[]',
      capabilities          TEXT NOT NULL DEFAULT '[]',
      features              TEXT NOT NULL DEFAULT '[]',
      updated_at            TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  g._sunoDB = db;
  return db;
}

export function getDb(): Database.Database {
  return openDb();
}
