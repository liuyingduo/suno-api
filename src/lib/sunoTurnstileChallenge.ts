import { Frame, Page } from 'playwright';

const TURNSTILE_FRAME_ORIGIN = 'https://challenges.cloudflare.com/';
const TURNSTILE_FRAME_URL_PART = '/turnstile/';
const TURNSTILE_WAIT_TIMEOUT_MS = 60_000;
const TURNSTILE_POLL_INTERVAL_MS = 250;
const TURNSTILE_INTERACTIVE_WAIT_MS = 1_000;
const TURNSTILE_CLICK_DELAY_MS = 100;
const TURNSTILE_CHECKBOX_OFFSET_X = 20;
const TURNSTILE_MIN_WIDTH = 200;
const TURNSTILE_MIN_HEIGHT = 50;

export async function clickTurnstileCheckbox(page: Page): Promise<void> {
  const { frame, height } = await waitForTurnstileFrame(page);
  const frameBody = frame.locator('body');
  await frameBody.waitFor({ state: 'visible', timeout: TURNSTILE_WAIT_TIMEOUT_MS });
  await page.waitForTimeout(TURNSTILE_INTERACTIVE_WAIT_MS);
  await frameBody.click({
    force: true,
    delay: TURNSTILE_CLICK_DELAY_MS,
    position: {
      x: TURNSTILE_CHECKBOX_OFFSET_X,
      y: height / 2
    }
  });
}

async function waitForTurnstileFrame(page: Page): Promise<{ frame: Frame; height: number }> {
  const deadline = Date.now() + TURNSTILE_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (!isTurnstileFrame(frame)) continue;
      try {
        const box = await (await frame.frameElement()).boundingBox();
        if (box && box.width >= TURNSTILE_MIN_WIDTH && box.height >= TURNSTILE_MIN_HEIGHT) {
          return { frame, height: box.height };
        }
      } catch {
        // Turnstile replaces its frame while initializing; retry the active frame.
      }
    }
    await page.waitForTimeout(TURNSTILE_POLL_INTERVAL_MS);
  }
  throw new Error('Timed out waiting for a visible Cloudflare Turnstile frame');
}

function isTurnstileFrame(frame: Frame): boolean {
  const url = frame.url();
  return url.startsWith(TURNSTILE_FRAME_ORIGIN) && url.includes(TURNSTILE_FRAME_URL_PART);
}
