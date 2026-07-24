import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { clickTurnstileCheckbox } from './sunoTurnstileChallenge';

test('clicks the checkbox position inside a cross-origin Turnstile iframe', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  try {
    await page.route('https://suno.com/create', (route) => route.fulfill({
      contentType: 'text/html',
      body: createParentPage()
    }));
    await page.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: createTurnstileFrame()
    }));
    await page.goto('https://suno.com/create');

    await clickTurnstileCheckbox(page);
    await page.waitForFunction(() => (
      window as typeof window & { turnstileClicked: boolean }
    ).turnstileClicked);
    assert.equal(
      await page.evaluate(() => (
        window as typeof window & { turnstileClicked: boolean }
      ).turnstileClicked),
      true
    );
  } finally {
    await browser.close();
  }
});

function createParentPage(): string {
  return `
    <iframe
      id="turnstile-widget"
      title="Widget containing a Cloudflare security challenge"
      src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/turnstile/test"
      style="position:absolute;left:490px;top:364px;width:1px;height:1px;border:0"
    ></iframe>
    <script>
      window.turnstileClicked = false;
      setTimeout(() => {
        const iframe = document.querySelector('#turnstile-widget');
        iframe.style.width = '300px';
        iframe.style.height = '65px';
      }, 100);
      window.addEventListener('message', (event) => {
        if (event.data === 'turnstile-clicked') window.turnstileClicked = true;
      });
    </script>
  `;
}

function createTurnstileFrame(): string {
  return `
    <style>html,body{width:300px;height:65px;margin:0}</style>
    <script>
      setTimeout(() => {
        const button = document.createElement('button');
        button.setAttribute('aria-label', 'Verify you are human');
        button.style.cssText = 'position:absolute;left:8px;top:20px;width:24px;height:24px';
        button.addEventListener('click', () => parent.postMessage('turnstile-clicked', '*'));
        document.body.append(button);
      }, 500);
    </script>
  `;
}
