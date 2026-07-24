import { ConsoleMessage, Frame, Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DIAGNOSTIC_DIR = path.join(process.cwd(), 'logs', 'captcha-diagnostics');

export interface CaptchaDiagnosticFiles {
  prefix: string;
  screenshotPath: string;
  htmlPath: string;
  jsonPath: string;
  frames: CaptchaFrameDiagnostic[];
}

export interface CaptchaFrameDiagnostic {
  index: number;
  name: string;
  url: string;
  parentUrl?: string;
  htmlPath: string;
  screenshotPath?: string;
  element?: Record<string, unknown>;
  error?: string;
}

interface CaptchaDiagnosticsInput {
  page: Page;
  userAgent: string;
  consoleMessages: string[];
  error?: unknown;
  outputDirectory?: string;
}

export function formatConsoleMessage(message: ConsoleMessage): string {
  return `[${message.type()}] ${message.text()}`;
}

export async function saveCaptchaFailureDiagnostics(
  input: CaptchaDiagnosticsInput
): Promise<CaptchaDiagnosticFiles> {
  const outputDirectory = input.outputDirectory ?? DIAGNOSTIC_DIR;
  await mkdir(outputDirectory, { recursive: true });
  const prefix = path.join(outputDirectory, createDiagnosticName());
  const files: CaptchaDiagnosticFiles = {
    prefix,
    screenshotPath: `${prefix}.png`,
    htmlPath: `${prefix}.html`,
    jsonPath: `${prefix}.json`,
    frames: []
  };
  const fingerprint = await readBrowserFingerprint(input.page);
  const frames = await saveFrameDiagnostics(input.page, prefix);
  files.frames = frames;
  await Promise.all([
    input.page.screenshot({ path: files.screenshotPath, fullPage: true }),
    writeFile(files.htmlPath, await input.page.content(), 'utf8'),
    writeFile(files.jsonPath, JSON.stringify({
      url: input.page.url(),
      userAgent: input.userAgent,
      error: serializeError(input.error),
      fingerprint,
      consoleMessages: input.consoleMessages,
      frames
    }, null, 2), 'utf8')
  ]);
  return files;
}

async function saveFrameDiagnostics(
  page: Page,
  prefix: string
): Promise<CaptchaFrameDiagnostic[]> {
  const frames = page.frames().filter((frame) => frame !== page.mainFrame());
  return Promise.all(frames.map((frame, index) => saveFrameDiagnostic(frame, index, prefix)));
}

async function saveFrameDiagnostic(
  frame: Frame,
  index: number,
  prefix: string
): Promise<CaptchaFrameDiagnostic> {
  const framePrefix = `${prefix}.frame-${String(index).padStart(2, '0')}`;
  const diagnostic: CaptchaFrameDiagnostic = {
    index,
    name: frame.name(),
    url: frame.url(),
    parentUrl: frame.parentFrame()?.url(),
    htmlPath: `${framePrefix}.html`
  };

  try {
    await writeFile(diagnostic.htmlPath, await frame.content(), 'utf8');
    const frameElement = await frame.frameElement();
    diagnostic.element = await readFrameElement(frameElement);
    const screenshotPath = `${framePrefix}.png`;
    await frameElement.screenshot({ path: screenshotPath, timeout: 10_000 });
    diagnostic.screenshotPath = screenshotPath;
  } catch (error) {
    diagnostic.error = serializeErrorMessage(error);
  }

  return diagnostic;
}

async function readFrameElement(
  frameElement: Awaited<ReturnType<Frame['frameElement']>>
): Promise<Record<string, unknown>> {
  return frameElement.evaluate((element) => {
    if (!(element instanceof Element)) {
      throw new Error('Frame owner is not an Element');
    }
    const rect = element.getBoundingClientRect();
    return {
      tagName: element.tagName,
      id: element.id,
      className: element.getAttribute('class'),
      title: element.getAttribute('title'),
      name: element.getAttribute('name'),
      src: element.getAttribute('src'),
      ariaLabel: element.getAttribute('aria-label'),
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      }
    };
  });
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

function serializeErrorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
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
