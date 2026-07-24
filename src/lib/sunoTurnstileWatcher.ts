import { Page } from 'playwright';

const TURNSTILE_FRAME_SELECTOR = 'iframe[title*="Cloudflare security challenge"]';
const POLL_INTERVAL_MS = 500;
const MIN_VISIBLE_WIDTH = 100;
const MIN_VISIBLE_HEIGHT = 40;

interface TurnstileWatcherLogger {
  info(message: string): void;
  warn(message: string): void;
}

export async function watchForVisibleTurnstile(
  page: Page,
  signal: AbortSignal,
  logger: TurnstileWatcherLogger,
  onVisible: () => Promise<unknown>
): Promise<void> {
  try {
    while (!signal.aborted) {
      const frames = page.locator(TURNSTILE_FRAME_SELECTOR);
      const count = await frames.count();
      for (let index = 0; index < count; index++) {
        const box = await frames.nth(index).boundingBox();
        if (box && box.width >= MIN_VISIBLE_WIDTH && box.height >= MIN_VISIBLE_HEIGHT) {
          logger.info(
            `SunoCaptchaSolver: visible Cloudflare Turnstile detected at ${JSON.stringify(box)}`
          );
          await onVisible();
          return;
        }
      }
      await page.waitForTimeout(POLL_INTERVAL_MS);
    }
  } catch (error) {
    if (!signal.aborted) {
      logger.warn(`SunoCaptchaSolver: Turnstile watcher failed: ${formatError(error)}`);
    }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
