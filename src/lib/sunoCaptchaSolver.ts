import pino from 'pino';
import {
  Browser,
  BrowserContext,
  chromium,
  Locator,
  Page,
  Request,
} from 'playwright';
import * as cookie from 'cookie';
import { YesCaptchaAction, YesCaptchaClient } from '@/lib/yesCaptchaClient';
import { sleep } from '@/lib/utils';
import { FeishuNotifier } from '@/lib/feishuNotifier';
import {
  formatConsoleMessage,
  saveCaptchaFailureDiagnostics
} from '@/lib/captchaDiagnostics';

const logger = pino();
const SUNO_CREATE_URL = 'https://suno.com/create';
const GENERATE_URL_PART = '/api/generate/v2-web/';
const CAPTCHA_TIMEOUT_MS = 180_000;
const HCAPTCHA_IMAGE_RE = /^https:\/\/img[a-zA-Z0-9]*\.hcaptcha\.com\/.*$/;
const INVALID_COOKIE_RE = /[\x00-\x1f\x7f;,"]/;
const PROMPT_TEXTAREA_XPATH =
  '//*[@id="main-container"]/div/div/div/div/div/div[3]/div/div[2]/div[3]/div/div[2]/div/div[2]/div/div[1]/div[1]/div[1]/textarea';
const CREATE_SONG_BUTTON_XPATH = '//button[@aria-label="Create song"]';

interface SunoCaptchaSolverOptions {
  cookies: Record<string, string | undefined>;
  userAgent: string;
  currentToken?: string;
}

interface CaptchaResult {
  token: string | null;
  authorizationToken?: string;
}

function isGenerateRequestUrl(url: string): boolean {
  return url.includes(GENERATE_URL_PART);
}

function isHcaptchaRequestUrl(url: string): boolean {
  return url.includes('hcaptcha.com') || url.includes('checksiteconfig') || url.includes('/getcaptcha/');
}

export class SunoCaptchaSolver {
  private readonly yesCaptcha = new YesCaptchaClient(process.env.YESCAPTCHA_KEY ?? '');
  private readonly feishuNotifier = new FeishuNotifier();
  private readonly consoleMessages: string[] = [];
  private tokenCaptured = false;

  constructor(private readonly options: SunoCaptchaSolverOptions) {}

  public async solve(): Promise<CaptchaResult> {
    logger.info('SunoCaptchaSolver: launching browser');
    const browser = await this.launchBrowser();
    const context = await this.createContext(browser);
    this.attachNetworkLogging(context);
    const page = await context.newPage();
    this.attachConsoleLogging(page);
    const abortController = new AbortController();
    let failure: unknown;

    try {
      const tokenPromise = this.captureGenerateToken(page, abortController);
      logger.info(`SunoCaptchaSolver: navigating to ${SUNO_CREATE_URL}`);
      await page.goto(SUNO_CREATE_URL, {
        referer: 'https://www.google.com/',
        waitUntil: 'domcontentloaded',
        timeout: 0
      });
      await this.waitForSunoReady(page);
      await this.triggerCaptcha(page);
      await Promise.race([this.solveChallenges(page, abortController.signal), tokenPromise])
        .catch((error) => {
          logger.warn(`SunoCaptchaSolver: challenge loop ended before token capture: ${error?.message ?? error}`);
        });
      logger.info('SunoCaptchaSolver: waiting for generate token capture');
      return await tokenPromise;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      if (!this.tokenCaptured) {
        await this.handleFailureDiagnostics(page, failure);
      }
      abortController.abort();
      await browser.close();
      logger.info('SunoCaptchaSolver: browser closed');
    }
  }

  private async launchBrowser(): Promise<Browser> {
    return chromium.launch({
      headless: process.env.BROWSER_HEADLESS !== 'false',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-features=site-per-process',
        '--disable-features=IsolateOrigins',
        '--disable-extensions',
        '--disable-infobars'
      ]
    });
  }

  private async createContext(browser: Browser): Promise<BrowserContext> {
    return browser.newContext({
      userAgent: this.options.userAgent,
      locale: process.env.BROWSER_LOCALE,
      viewport: { width: 1280, height: 800 },
      storageState: {
        cookies: this.toPlaywrightCookies(),
        origins: []
      }
    });
  }

  private attachNetworkLogging(context: BrowserContext): void {
    context.on('request', (request) => {
      const url = request.url();
      if (!isGenerateRequestUrl(url) && !isHcaptchaRequestUrl(url)) {
        return;
      }
      logger.info(`SunoCaptchaSolver request: ${request.method()} ${url}`);
    });

    context.on('response', (response) => {
      const url = response.url();
      if (!isGenerateRequestUrl(url) && !isHcaptchaRequestUrl(url)) {
        return;
      }
      logger.info(`SunoCaptchaSolver response: ${response.status()} ${url}`);
    });
  }

  private attachConsoleLogging(page: Page): void {
    page.on('console', (message) => {
      this.consoleMessages.push(formatConsoleMessage(message));
    });
  }

  private toPlaywrightCookies() {
    const entries = Object.entries(this.options.cookies).filter(([name, value]) => {
      if (!value) return false;
      return !INVALID_COOKIE_RE.test(name) && !INVALID_COOKIE_RE.test(value);
    });

    const cookies = entries.map(([name, value]) => ({
      name,
      value: value as string,
      domain: '.suno.com',
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: true,
      sameSite: 'None' as const
    }));

    if (this.options.currentToken) {
      cookies.push({
        name: '__session',
        value: this.options.currentToken,
        domain: '.suno.com',
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: 'None' as const
      });
    }
    return cookies;
  }

  private async waitForSunoReady(page: Page): Promise<void> {
    try {
      await page.waitForResponse((resp) => resp.url().includes('/api/project/'), { timeout: 60_000 });
      logger.info('SunoCaptchaSolver: Suno project list loaded');
    } catch {
      logger.warn('Timed out waiting for Suno project list; continuing to trigger captcha');
    }
  }

  private async triggerCaptcha(page: Page): Promise<void> {
    logger.info('SunoCaptchaSolver: triggering captcha from create page');
    await this.closePopups(page);
    const textarea = page.locator(`xpath=${PROMPT_TEXTAREA_XPATH}`);
    logger.info('SunoCaptchaSolver: waiting for prompt textarea');
    await textarea.waitFor({ state: 'visible', timeout: 60_000 });

    await Promise.race([
      page.waitForResponse((resp) => resp.url().includes('checksiteconfig'), { timeout: 8_000 })
        .then(() => logger.info('SunoCaptchaSolver: hCaptcha checksiteconfig observed'))
        .catch(() => logger.warn('SunoCaptchaSolver: hCaptcha checksiteconfig not observed within 8s')),
      page.waitForTimeout(8_000),
    ]);

    logger.info('SunoCaptchaSolver: filling prompt textarea');
    await textarea.click();
    await textarea.fill('');
    await page.waitForTimeout(500);
    await textarea.type('Lorem ipsum', { delay: 40 });

    const createButton = page.locator(`xpath=${CREATE_SONG_BUTTON_XPATH}`);
    logger.info('SunoCaptchaSolver: waiting for Create song button');
    await createButton.waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForFunction(
      () => {
        const button = document.evaluate(
          '//button[@aria-label="Create song"]',
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        ).singleNodeValue as HTMLButtonElement | null;
        return Boolean(button && !button.disabled);
      },
      { timeout: 60_000 }
    );
    logger.info('SunoCaptchaSolver: clicking Create song button');
    await createButton.click();
  }

  private async closePopups(page: Page): Promise<void> {
    try {
      await page.getByLabel('Close').click({ timeout: 2_000 });
    } catch {
      return;
    }
  }

  private captureGenerateToken(page: Page, abortController: AbortController): Promise<CaptchaResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for hCaptcha token from Suno generate request'));
      }, CAPTCHA_TIMEOUT_MS);

      page.route(`**${GENERATE_URL_PART}**`, async (route) => {
        try {
          const request = route.request();
          logger.info('SunoCaptchaSolver: captured Suno generate request');
          await route.abort();
          clearTimeout(timeout);
          abortController.abort();
          this.tokenCaptured = true;
          resolve(this.extractCaptchaResult(request));
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      }).catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private extractCaptchaResult(request: Request): CaptchaResult {
    const payload = request.postDataJSON() as { token?: string | null };
    const authorization = request.headers().authorization;
    const authorizationToken = authorization?.startsWith('Bearer ')
      ? authorization.replace('Bearer ', '')
      : undefined;
    return {
      token: payload?.token ?? null,
      authorizationToken
    };
  }

  private async solveChallenges(page: Page, signal: AbortSignal): Promise<void> {
    const frame = page.frameLocator('iframe[title*="hCaptcha"]');
    const challenge = frame.locator('.challenge-container');
    while (!signal.aborted) {
      await this.waitForHcaptchaImages(page, signal);
      const prompt = await this.readChallengePrompt(challenge);
      logger.info(`SunoCaptchaSolver: solving hCaptcha challenge: ${prompt}`);
      const actions = await this.yesCaptcha.solveHcaptchaByImage(
        await this.screenshotChallenge(challenge),
        prompt
      );
      await this.performActions(challenge, actions);
      await this.submitChallenge(frame.locator('.button-submit'));
    }
  }

  private async readChallengePrompt(challenge: Locator): Promise<string> {
    const prompt = await challenge.locator('.prompt-text').first().innerText({ timeout: 10_000 });
    return prompt.trim();
  }

  private async screenshotChallenge(challenge: Locator): Promise<string> {
    const image = await challenge.screenshot({ timeout: 10_000 });
    return image.toString('base64');
  }

  private async performActions(challenge: Locator, actions: YesCaptchaAction[]): Promise<void> {
    const box = await challenge.boundingBox();
    if (!box) {
      throw new Error('.challenge-container boundingBox is null');
    }

    for (const action of actions) {
      if (action.type === 'click') {
        await challenge.click({ force: true, position: action.point });
      } else {
        await challenge.page().mouse.move(box.x + action.start.x, box.y + action.start.y);
        await challenge.page().mouse.down();
        await sleep(1.1);
        await challenge.page().mouse.move(box.x + action.end.x, box.y + action.end.y, { steps: 30 });
        await challenge.page().mouse.up();
      }
      await sleep(0.2);
    }
  }

  private async submitChallenge(button: Locator): Promise<void> {
    await button.click({ force: true });
    await sleep(1);
  }

  private async waitForHcaptchaImages(page: Page, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | undefined;
      let activeRequestCount = 0;
      let requestOccurred = false;

      const cleanup = () => {
        page.off('request', onRequest);
        page.off('requestfinished', onRequestFinished);
        page.off('requestfailed', onRequestFinished);
        signal.removeEventListener('abort', onAbort);
        clearTimeout(initialTimeout);
        if (timeoutHandle) clearTimeout(timeoutHandle);
      };
      const finish = () => {
        cleanup();
        resolve();
      };
      const resetTimeout = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (activeRequestCount === 0) timeoutHandle = setTimeout(finish, 1_000);
      };
      const onRequest = (request: Request) => {
        if (!HCAPTCHA_IMAGE_RE.test(request.url())) return;
        logger.info(`SunoCaptchaSolver: hCaptcha image request ${request.url()}`);
        requestOccurred = true;
        activeRequestCount++;
        if (timeoutHandle) clearTimeout(timeoutHandle);
      };
      const onRequestFinished = (request: Request) => {
        if (!HCAPTCHA_IMAGE_RE.test(request.url())) return;
        activeRequestCount--;
        resetTimeout();
      };
      const onAbort = () => {
        cleanup();
        reject(new Error('AbortError'));
      };
      const initialTimeout = setTimeout(() => {
        if (!requestOccurred) {
          cleanup();
          reject(new Error('No hCaptcha image request occurred within 60 seconds'));
        } else {
          resetTimeout();
        }
      }, 60_000);

      page.on('request', onRequest);
      page.on('requestfinished', onRequestFinished);
      page.on('requestfailed', onRequestFinished);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async handleFailureDiagnostics(page: Page, error: unknown): Promise<void> {
    try {
      const files = await saveCaptchaFailureDiagnostics({
        page,
        userAgent: this.options.userAgent,
        consoleMessages: this.consoleMessages,
        error
      });
      logger.warn(`SunoCaptchaSolver: saved failure diagnostics to ${files.prefix}.*`);
      await this.notifyFailure(files.screenshotPath, files.jsonPath, error);
    } catch (diagnosticError) {
      logger.warn(
        `SunoCaptchaSolver: failed to save diagnostics: ${this.formatError(diagnosticError)}`
      );
    }
  }

  private async notifyFailure(
    screenshotPath: string,
    jsonPath: string,
    error: unknown
  ): Promise<void> {
    if (!this.feishuNotifier.enabled) {
      return;
    }
    try {
      await this.feishuNotifier.notify({
        title: 'SunoCaptchaSolver failed',
        text: [
          `Error: ${this.formatError(error)}`,
          `Screenshot: ${screenshotPath}`,
          `Diagnostics: ${jsonPath}`
        ].join('\n'),
        imagePath: screenshotPath
      });
      logger.info('SunoCaptchaSolver: sent failure diagnostics to Feishu');
    } catch (notifyError) {
      logger.warn(`SunoCaptchaSolver: failed to notify Feishu: ${this.formatError(notifyError)}`);
    }
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}

export function serializeCookieRecord(cookies: Record<string, string | undefined>): string {
  return Object.entries(cookies)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => cookie.serialize(key, value as string))
    .join('; ');
}
