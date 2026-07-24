import { Page } from 'playwright';

const TURNSTILE_IFRAME_SELECTOR = [
  'iframe[title*="Cloudflare security challenge"]',
  'iframe[src*="challenges.cloudflare.com"][src*="/turnstile/"]'
].join(',');
const TURNSTILE_WAIT_TIMEOUT_MS = 60_000;
const TURNSTILE_CHECKBOX_OFFSET_X = 20;
const TURNSTILE_MIN_WIDTH = 200;
const TURNSTILE_MIN_HEIGHT = 50;

export async function clickTurnstileCheckbox(page: Page): Promise<void> {
  const iframe = page.locator(TURNSTILE_IFRAME_SELECTOR).first();
  await iframe.waitFor({ state: 'visible', timeout: TURNSTILE_WAIT_TIMEOUT_MS });
  await page.waitForFunction(
    ({ selector, minWidth, minHeight }) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.width >= minWidth && rect.height >= minHeight;
    },
    {
      selector: TURNSTILE_IFRAME_SELECTOR,
      minWidth: TURNSTILE_MIN_WIDTH,
      minHeight: TURNSTILE_MIN_HEIGHT
    },
    { timeout: TURNSTILE_WAIT_TIMEOUT_MS }
  );
  const box = await iframe.boundingBox();
  if (!box) throw new Error('Cloudflare Turnstile iframe boundingBox is null');
  if (box.width < TURNSTILE_MIN_WIDTH || box.height < TURNSTILE_MIN_HEIGHT) {
    throw new Error(`Cloudflare Turnstile iframe has unexpected size ${box.width}x${box.height}`);
  }

  await page.mouse.click(
    box.x + TURNSTILE_CHECKBOX_OFFSET_X,
    box.y + box.height / 2
  );
}
