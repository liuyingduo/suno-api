import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { solveTurnstileChallenges } from './sunoTurnstileChallenge';

test('retries Turnstile failure inside a cross-origin closed shadow root', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const controller = new AbortController();

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
    assert.equal(await page.locator('iframe').count(), 0);

    const attempts: number[] = [];
    const solving = solveTurnstileChallenges(page, controller.signal, (attempt) => {
      attempts.push(attempt);
    });
    await page.waitForFunction(() => (
      window as typeof window & { turnstileClickCount: number }
    ).turnstileClickCount === 2, undefined, { timeout: 15_000 });
    controller.abort();
    await solving;
    assert.equal(
      await page.evaluate(() => (
        window as typeof window & { turnstileClickCount: number }
      ).turnstileClickCount),
      2
    );
    assert.deepEqual(attempts, [1, 2]);
    assert.deepEqual(
      await page.evaluate(() => (
        window as typeof window & { turnstileMouseEvents: string[] }
      ).turnstileMouseEvents),
      ['pointerdown:true', 'mousedown:true', 'pointerup:true', 'mouseup:true', 'click:true']
    );
  } finally {
    controller.abort();
    await browser.close();
  }
});

function createParentPage(): string {
  return `
    <body>
    <script>
      window.turnstileClickCount = 0;
      window.turnstileMouseEvents = [];
      const host = document.createElement('div');
      document.body.append(host);
      const shadowRoot = host.attachShadow({ mode: 'closed' });
      const iframe = document.createElement('iframe');
      iframe.title = 'Widget containing a Cloudflare security challenge';
      iframe.src = 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/turnstile/test';
      iframe.style.cssText = 'position:absolute;left:490px;top:364px;width:1px;height:1px;border:0';
      shadowRoot.append(iframe);
      setTimeout(() => {
        iframe.style.width = '300px';
        iframe.style.height = '65px';
      }, 100);
      window.addEventListener('message', (event) => {
        if (event.data === 'turnstile-clicked') window.turnstileClickCount++;
        if (event.data.type === 'turnstile-events') window.turnstileMouseEvents = event.data.events;
      });
    </script>
    </body>
  `;
}

function createTurnstileFrame(): string {
  return `
    <style>html,body{width:300px;height:65px;margin:0}</style>
    <script>
      const retryUrl = 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/turnstile/failure_retry/normal';
      setTimeout(() => {
        const button = document.createElement('button');
        button.setAttribute('aria-label', 'Verify you are human');
        button.style.cssText = 'position:absolute;left:8px;top:20px;width:24px;height:24px';
        const mouseEvents = [];
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          button.addEventListener(type, (event) => {
            mouseEvents.push(type + ':' + event.isTrusted);
          });
        }
        button.addEventListener('click', () => {
          parent.postMessage('turnstile-clicked', '*');
          parent.postMessage({ type: 'turnstile-events', events: mouseEvents }, '*');
          if (!location.href.includes('/failure_retry/')) {
            setTimeout(() => location.href = retryUrl, 100);
          }
        });
        document.body.append(button);
      }, 500);
    </script>
  `;
}
