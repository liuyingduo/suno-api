import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'suno.db');

/** { key: val } → { "@key": val }，用于 sql.js 命名参数 */
function toNamed(params: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(params)) {
    out[`@${k}`] = v;
  }
  return out;
}

function resolveParams(p?: any[] | Record<string, any>): any[] | Record<string, any> | undefined {
  if (p === undefined || p === null) return undefined;
  if (Array.isArray(p)) return p;
  return toNamed(p);
}

export class Db {
  private _inTx = false;
  constructor(private _db: any) {}

  prepare(sql: string) {
    const self = this;
    return {
      get(params?: any[] | Record<string, any>): any {
        const stmt = self._db.prepare(sql);
        const p = resolveParams(params);
        if (p) stmt.bind(p);
        const result = stmt.step() ? { ...stmt.getAsObject() } : undefined;
        stmt.free();
        return result;
      },
      all(params?: any[] | Record<string, any>): any[] {
        const stmt = self._db.prepare(sql);
        const p = resolveParams(params);
        if (p) stmt.bind(p);
        const rows: any[] = [];
        while (stmt.step()) rows.push({ ...stmt.getAsObject() });
        stmt.free();
        return rows;
      },
      run(params?: any[] | Record<string, any>): { changes: number } {
        const stmt = self._db.prepare(sql);
        const p = resolveParams(params);
        stmt.run(p);
        stmt.free();
        const changes: number = self._db.getRowsModified();
        if (!self._inTx) self._persist();
        return { changes };
      },
    };
  }

  exec(sql: string): void {
    this._db.exec(sql);
    if (!this._inTx) this._persist();
  }

  transaction(fn: () => void): () => void {
    const self = this;
    return () => {
      self._inTx = true;
      try {
        self._db.run('BEGIN');
        fn();
        self._db.run('COMMIT');
        self._persist();
      } catch (e) {
        try { self._db.run('ROLLBACK'); } catch { /* ignore */ }
        throw e;
      } finally {
        self._inTx = false;
      }
    };
  }

  private _persist(): void {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DB_FILE, Buffer.from(this._db.export()));
  }
}

const g = global as unknown as { _sunoDbPromise?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!g._sunoDbPromise) {
    g._sunoDbPromise = _initDb();
  }
  return g._sunoDbPromise;
}

async function _initDb(): Promise<Db> {
  // 动态 require 避免 webpack 静态打包 sql.js（WASM 模块）
  const initSqlJs = require('sql.js') as (cfg: object) => Promise<any>;
  const SQL: any = await initSqlJs({
    locateFile: (file: string) =>
      path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
  });

  mkdirSync(DATA_DIR, { recursive: true });
  const raw = existsSync(DB_FILE) ? readFileSync(DB_FILE) : null;
  const sqlJsDb = raw ? new SQL.Database(raw) : new SQL.Database();

  const db = new Db(sqlJsDb);
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id               TEXT PRIMARY KEY,
      email            TEXT NOT NULL,
      cookie           TEXT NOT NULL,
      credits_left     INTEGER,
      period           TEXT,
      monthly_limit    INTEGER,
      monthly_usage    INTEGER,
      last_refreshed   TEXT,
      added_at         TEXT NOT NULL,
      enabled          INTEGER NOT NULL DEFAULT 1
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

  return db;
}

