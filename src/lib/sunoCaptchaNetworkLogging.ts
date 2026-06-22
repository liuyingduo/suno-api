import { BrowserContext, Page, Request } from 'playwright';

interface CaptchaNetworkLogger {
  info(message: string): void;
  warn(message: string): void;
}

const CAPTCHA_URL_PARTS = [
  'hcaptcha.com',
  'hcaptcha-endpoint-prod.suno.com',
  'hcaptcha-assets-prod.suno.com',
  'hcaptcha-imgs-prod.suno.com',
  'hcaptcha-reportapi-prod.suno.com',
  'checksiteconfig',
  '/getcaptcha/',
  '/checkcaptcha/',
  '/siteverify'
];

export function isGenerateRequestUrl(url: string, generateUrlPart: string): boolean {
  return url.includes(generateUrlPart);
}

function isHcaptchaRequestUrl(url: string): boolean {
  return CAPTCHA_URL_PARTS.some((part) => url.includes(part));
}

function isCaptchaDiagnosticUrl(url: string, generateUrlPart: string): boolean {
  return isGenerateRequestUrl(url, generateUrlPart) || isHcaptchaRequestUrl(url);
}

export function attachCaptchaNetworkLogging(
  context: BrowserContext,
  generateUrlPart: string,
  logger: CaptchaNetworkLogger
): void {
  context.on('request', (request) => {
    if (!isCaptchaDiagnosticUrl(request.url(), generateUrlPart)) {
      return;
    }
    logger.info(`SunoCaptchaSolver request: ${formatRequest(request)}`);
  });

  context.on('response', (response) => {
    if (!isCaptchaDiagnosticUrl(response.url(), generateUrlPart)) {
      return;
    }
    logger.info(
      `SunoCaptchaSolver response: ${response.status()} ${response.request().resourceType()} ${response.url()}`
    );
  });

  context.on('requestfailed', (request) => {
    if (!isCaptchaDiagnosticUrl(request.url(), generateUrlPart)) {
      return;
    }
    logger.warn(`SunoCaptchaSolver request failed: ${formatRequestFailure(request)}`);
  });
}

export async function logCaptchaRequestsAfterClick(
  page: Page,
  generateUrlPart: string,
  logger: CaptchaNetworkLogger,
  click: () => Promise<void>
): Promise<void> {
  const onRequest = (request: Request) => {
    if (!isCaptchaDiagnosticUrl(request.url(), generateUrlPart)) {
      return;
    }
    logger.info(`SunoCaptchaSolver after-click request: ${formatRequest(request)}`);
  };
  const onResponse = (response: import('playwright').Response) => {
    if (!isCaptchaDiagnosticUrl(response.url(), generateUrlPart)) {
      return;
    }
    logger.info(
      `SunoCaptchaSolver after-click response: ${response.status()} ${response.request().resourceType()} ${response.url()}`
    );
  };
  const onRequestFailed = (request: Request) => {
    if (!isCaptchaDiagnosticUrl(request.url(), generateUrlPart)) {
      return;
    }
    logger.warn(`SunoCaptchaSolver after-click request failed: ${formatRequestFailure(request)}`);
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);
  try {
    await click();
    await page.waitForTimeout(15_000);
  } finally {
    page.off('request', onRequest);
    page.off('response', onResponse);
    page.off('requestfailed', onRequestFailed);
  }
}

function formatRequest(request: Request): string {
  return `${request.method()} ${request.resourceType()} ${request.url()}`;
}

function formatRequestFailure(request: Request): string {
  return `${formatRequest(request)} ${request.failure()?.errorText ?? ''}`;
}
