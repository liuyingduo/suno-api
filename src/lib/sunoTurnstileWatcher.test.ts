import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { watchForVisibleTurnstile } from './sunoTurnstileWatcher';

test('captures the transition from a hidden to visible Turnstile iframe', async () => {
  const browser = await chromium.launch({ headless: true });
  const controller = new AbortController();
  let visibleCount = 0;

  try {
    const page = await browser.newPage();
    await page.setContent(`
      <iframe
        title="Widget containing a Cloudflare security challenge"
        style="width: 1px; height: 1px"
      ></iframe>
    `);
    const watcher = watchForVisibleTurnstile(
      page,
      controller.signal,
      { info: () => undefined, warn: () => undefined },
      async () => {
        visibleCount++;
      }
    );

    await page.locator('iframe').evaluate((frame) => {
      frame.style.width = '300px';
      frame.style.height = '65px';
    });
    await watcher;

    assert.equal(visibleCount, 1);
  } finally {
    controller.abort();
    await browser.close();
  }
});
