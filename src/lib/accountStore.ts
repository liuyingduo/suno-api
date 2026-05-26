import { promises as fs } from 'fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'accounts.json');

const g = global as unknown as {
  _sunoAccounts?: Account[];
  _sunoRrIdx?: number;
  _sunoAccountsLoaded?: boolean;
};

function getStore(): Account[] {
  if (!g._sunoAccounts) g._sunoAccounts = [];
  return g._sunoAccounts;
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function loadAccounts(): Promise<void> {
  await ensureDataDir();
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    g._sunoAccounts = JSON.parse(data);
  } catch {
    g._sunoAccounts = [];
  }
  g._sunoAccountsLoaded = true;
}

export async function ensureLoaded(): Promise<void> {
  if (!g._sunoAccountsLoaded) {
    await loadAccounts();
  }
}

export async function saveAccounts(): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(DATA_FILE, JSON.stringify(getStore(), null, 2), 'utf-8');
}

export function getAccounts(): Account[] {
  return getStore();
}

export function getAccountById(id: string): Account | undefined {
  return getStore().find(a => a.id === id);
}

export async function addAccount(email: string, cookie: string): Promise<Account> {
  await ensureLoaded();
  const account: Account = {
    id: randomUUID(),
    email: email.trim(),
    cookie: cookie.trim(),
    addedAt: new Date().toISOString(),
    enabled: true,
  };
  getStore().push(account);
  await saveAccounts();
  return account;
}

export async function removeAccount(id: string): Promise<boolean> {
  await ensureLoaded();
  const idx = getStore().findIndex(a => a.id === id);
  if (idx === -1) return false;
  getStore().splice(idx, 1);
  await saveAccounts();
  return true;
}

export async function updateAccountCredits(id: string, credits: AccountCredits): Promise<void> {
  const account = getAccountById(id);
  if (!account) return;
  account.credits = credits;
  account.lastRefreshed = new Date().toISOString();
  await saveAccounts();
}

export async function updateAccountCookie(id: string, newCookie: string): Promise<boolean> {
  const account = getAccountById(id);
  if (!account) return false;
  account.cookie = newCookie.trim();
  await saveAccounts();
  return true;
}

export async function toggleAccount(id: string): Promise<boolean | null> {
  const account = getAccountById(id);
  if (!account) return null;
  account.enabled = !account.enabled;
  await saveAccounts();
  return account.enabled;
}

/** 轮询选择一个启用的账号（Round-Robin） */
export function pickAccount(): Account | undefined {
  const enabled = getStore().filter(a => a.enabled);
  if (enabled.length === 0) return undefined;
  if (g._sunoRrIdx === undefined) g._sunoRrIdx = 0;
  const idx = g._sunoRrIdx % enabled.length;
  g._sunoRrIdx = (idx + 1) % enabled.length;
  return enabled[idx];
}
