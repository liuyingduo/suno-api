import { ConsoleMessage, Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DIAGNOSTIC_DIR = path.join(process.cwd(), 'logs', 'captcha-diagnostics');

export interface CaptchaDiagnosticFiles {
  prefix: string;
  screenshotPath: string;
  htmlPath: string;
  jsonPath: string;
}

interface CaptchaDiagnosticsInput {
  page: Page;
  userAgent: string;
  consoleMessages: string[];
  error?: unknown;
}

export function formatConsoleMessage(message: ConsoleMessage): string {
  return `[${message.type()}] ${message.text()}`;
}

export async function saveCaptchaFailureDiagnostics(
  input: CaptchaDiagnosticsInput
): Promise<CaptchaDiagnosticFiles> {
  await mkdir(DIAGNOSTIC_DIR, { recursive: true });
  const prefix = path.join(DIAGNOSTIC_DIR, createDiagnosticName());
  const files = {
    prefix,
    screenshotPath: `${prefix}.png`,
    htmlPath: `${prefix}.html`,
    jsonPath: `${prefix}.json`
  };
  const fingerprint = await readBrowserFingerprint(input.page);
  await Promise.all([
    input.page.screenshot({ path: files.screenshotPath, fullPage: true }),
    writeFile(files.htmlPath, await input.page.content(), 'utf8'),
    writeFile(files.jsonPath, JSON.stringify({
      url: input.page.url(),
      userAgent: input.userAgent,
      error: serializeError(input.error),
      fingerprint,
      consoleMessages: input.consoleMessages
    }, null, 2), 'utf8')
  ]);
  return files;
}

function createDiagnosticName(): string {
  return `captcha-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

function serializeError(error: unknown): Record<string, string> | undefined {
  if (!error) {
    return undefined;
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? ''
    };
  }
  return { message: String(error) };
}

async function readBrowserFingerprint(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    webdriver: navigator.webdriver,
    languages: navigator.languages,
    language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: 'deviceMemory' in navigator ? navigator.deviceMemory : undefined,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio
    }
  }));
}
