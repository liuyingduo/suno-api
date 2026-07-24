import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { clickTurnstileCheckbox } from './sunoTurnstileChallenge';

test('clicks the checkbox position inside a Cloudflare Turnstile iframe', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  try {
    await page.setContent(`
      <iframe
        id="turnstile-widget"
        title="Widget containing a Cloudflare security challenge"
        style="position:absolute;left:490px;top:364px;width:1px;height:1px;border:0"
        srcdoc="
          <style>html,body{width:300px;height:65px;margin:0}</style>
          <button
            aria-label='Verify you are human'
            onclick=&quot;parent.postMessage('turnstile-clicked', '*')&quot;
            style='position:absolute;left:8px;top:20px;width:24px;height:24px'
          ></button>
        "
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
    `);

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
