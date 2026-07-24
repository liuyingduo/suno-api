import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { saveCaptchaDiagnostics } from './captchaDiagnostics';

test('captures HTML, screenshot, and coordinates for unknown captcha frames', async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'suno-captcha-diagnostics-'));
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent(`
      <!doctype html>
      <html>
        <body>
          <iframe
            name="captcha-frame"
            title="Unknown captcha"
            style="width: 360px; height: 120px"
            srcdoc="<button id='verify-human'>Verify you are human</button>"
          ></iframe>
        </body>
      </html>
    `);

    const files = await saveCaptchaDiagnostics({
      page,
      userAgent: 'diagnostic-test',
      consoleMessages: [],
      error: new Error('Timed out waiting for captcha token'),
      namePrefix: 'captcha-after-80s',
      reason: 'Captured 80 seconds after clicking Create',
      outputDirectory
    });
    const childFrame = files.frames.find((frame) => frame.name === 'captcha-frame');

    assert.ok(childFrame);
    assert.match(await readFile(childFrame.htmlPath, 'utf8'), /verify-human/);
    assert.ok(childFrame.screenshotPath);
    assert.ok((await stat(childFrame.screenshotPath)).size > 0);
    assert.equal(childFrame.element?.title, 'Unknown captcha');
    assert.ok(Number((childFrame.element?.rect as { width: number }).width) > 0);
    assert.ok((await stat(files.viewportScreenshotPath)).size > 0);
    assert.ok((await stat(files.screenshotPath)).size > 0);
    assert.match(path.basename(files.prefix), /^captcha-after-80s-/);

    const manifest = JSON.parse(await readFile(files.jsonPath, 'utf8')) as {
      reason: string;
      frames: Array<{ name: string; htmlPath: string }>;
    };
    assert.equal(manifest.reason, 'Captured 80 seconds after clicking Create');
    assert.ok(manifest.frames.some((frame) => frame.name === 'captcha-frame'));
  } finally {
    await browser.close();
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
