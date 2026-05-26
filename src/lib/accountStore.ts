import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';

export interface AccountCredits {
  credits_left: number;
  period: string;
  monthly_limit: number;
  monthly_usage: number;
}

export interface Account {
  id: string;
  email: string;
  cookie: string;
  credits?: AccountCredits;
  lastRefreshed?: string;
  addedAt: string;
  enabled: boolean;
}

// SQLite 原始行结构
interface AccountRow {
  id: string;
  email: string;
  cookie: string;
  credits_left: number | null;
  period: string | null;
  monthly_limit: number | null;
  monthly_usage: number | null;
  last_refreshed: string | null;
  added_at: string;
  enabled: number;
}

function rowToAccount(row: AccountRow): Account {
  const account: Account = {
    id: row.id,
    email: row.email,
    cookie: row.cookie,
    addedAt: row.added_at,
    enabled: row.enabled === 1,
  };
  if (row.credits_left !== null) {
    account.credits = {
      credits_left: row.credits_left,
      period: row.period ?? '',
      monthly_limit: row.monthly_limit ?? 0,
      monthly_usage: row.monthly_usage ?? 0,
    };
    account.lastRefreshed = row.last_refreshed ?? undefined;
  }
  return account;
}

const g = global as unknown as { _sunoRrIdx?: number };

// SQLite 是同步的，保留 async 签名保持接口兼容
export async function ensureLoaded(): Promise<void> {
  getDb(); // 打开数据库（如未初始化则创建表）
}

export function getAccounts(): Account[] {
  const rows = getDb().prepare('SELECT * FROM accounts ORDER BY added_at ASC').all() as AccountRow[];
  return rows.map(rowToAccount);
}

export function getAccountById(id: string): Account | undefined {
  const row = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
  return row ? rowToAccount(row) : undefined;
}

export async function addAccount(email: string, cookie: string): Promise<Account> {
  const account: Account = {
    id: randomUUID(),
    email: email.trim(),
    cookie: cookie.trim(),
    addedAt: new Date().toISOString(),
    enabled: true,
  };
  getDb().prepare(`
    INSERT INTO accounts (id, email, cookie, added_at, enabled)
    VALUES (@id, @email, @cookie, @addedAt, 1)
  `).run(account);
  return account;
}

export async function removeAccount(id: string): Promise<boolean> {
  const result = getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id);
  return result.changes > 0;
}

export async function updateAccountCredits(id: string, credits: AccountCredits): Promise<void> {
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE accounts
    SET credits_left = @credits_left,
        period = @period,
        monthly_limit = @monthly_limit,
        monthly_usage = @monthly_usage,
        last_refreshed = @now
    WHERE id = @id
  `).run({ ...credits, now, id });
}

export async function updateAccountCookie(id: string, newCookie: string): Promise<boolean> {
  const result = getDb().prepare('UPDATE accounts SET cookie = ? WHERE id = ?').run(newCookie.trim(), id);
  return result.changes > 0;
}

export async function toggleAccount(id: string): Promise<boolean | null> {
  const row = getDb().prepare('SELECT enabled FROM accounts WHERE id = ?').get(id) as { enabled: number } | undefined;
  if (!row) return null;
  const newEnabled = row.enabled === 1 ? 0 : 1;
  getDb().prepare('UPDATE accounts SET enabled = ? WHERE id = ?').run(newEnabled, id);
  return newEnabled === 1;
}

/** 轮询选择一个启用的账号（Round-Robin） */
export function pickAccount(): Account | undefined {
  const enabled = getAccounts().filter(a => a.enabled);
  if (enabled.length === 0) return undefined;
  if (g._sunoRrIdx === undefined) g._sunoRrIdx = 0;
  const idx = g._sunoRrIdx % enabled.length;
  g._sunoRrIdx = (idx + 1) % enabled.length;
  return enabled[idx];
}

// loadAccounts 保留空实现，兼容旧调用方
export async function loadAccounts(): Promise<void> {
  getDb();
}
