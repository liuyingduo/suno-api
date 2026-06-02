/**
 * 用 Playwright 打开 suno.com/create，填入 prompt 并点击 Create song
 *
 * 用法:
 *   npx tsx scripts/suno-create.ts "your song prompt here"
 *   npx tsx scripts/suno-create.ts "your song prompt here" --headless
 *
 * 默认使用 DB 中第一个 enabled 账户的 cookie
 */
import { chromium } from 'playwright';
import * as cookie from 'cookie';
import { getDb } from '../src/lib/db';

const PROMPT_TEXT = process.argv[2] ?? 'A chill lo-fi hip hop beat with soft piano and rain sounds';
const HEADLESS = process.argv.includes('--headless');

const TEXTAREA_XPATH =
  '//*[@id="main-container"]/div/div/div/div/div/div[3]/div/div[2]/div[3]/div/div[2]/div/div[2]/div/div[1]/div[1]/div[1]/textarea';
const CREATE_BTN_XPATH = '//button[@aria-label="Create song"]';

// 超时均设为 60 秒
const TIMEOUT = 60_000;

async function main() {
  console.log('Prompt:', PROMPT_TEXT);
  console.log('Headless:', HEADLESS);

  // ── 1. 从 DB 读账户 cookie ──────────────────────────────────────────
  const db = await getDb();
  const emailArg = process.argv.find(a => a.includes('@'));
  const row = emailArg
    ? db.prepare('SELECT id, email, cookie FROM accounts WHERE email = ? LIMIT 1').get([emailArg]) as any
    : db.prepare('SELECT id, email, cookie FROM accounts WHERE enabled = 1 ORDER BY rowid LIMIT 1').get() as any;
  if (!row) {
    console.error('No enabled accounts in DB');
    process.exit(1);
  }
  console.log('Using account:', row.email, '(id:', row.id + ')');

  const parsedCookies = cookie.parse(row.cookie as string);

  // ── 2. 启动浏览器 ───────────────────────────────────────────────────
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    slowMo: HEADLESS ? 0 : 100, // 非无头时稍微放慢，方便观察
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    storageState: {
      cookies: Object.entries(parsedCookies)
        .filter(([name, value]) => {
          const INVALID = /[\x00-\x1f\x7f;,"]/;
          if (INVALID.test(name) || INVALID.test(value as string)) {
            console.warn(`[warn] Skipping invalid cookie: ${name}`);
            return false;
          }
          return true;
        })
        .map(([name, value]) => ({
          name,
          value: value as string,
          domain: '.suno.com',
          path: '/',
          httpOnly: false,
          secure: true,
          sameSite: 'None' as const,
        })),
      origins: [],
    },
  });

  // ── 拦截 hcaptcha 请求 + generate 请求 ──────────────────────────────
  context.on('request', (req) => {
    const url = req.url();
    const isHcaptcha = url.includes('hcaptcha');
    const isGenerate = url.includes('studio-api-prod.suno.com') && req.method() === 'POST';
    if (!isHcaptcha && !isGenerate) return;

    console.log('\n[REQ]', req.method(), url);
    // 只打 hcaptcha 的请求头（generate 头太多）
    if (isHcaptcha) {
      console.log('[REQ headers]', JSON.stringify(req.headers(), null, 2));
    }
    const postData = req.postData();
    if (postData) {
      const display = postData.length > 3000 ? postData.slice(0, 3000) + '...(truncated)' : postData;
      console.log('[REQ body]', display);
    }
  });

  context.on('response', async (resp) => {
    const url = resp.url();
    const isHcaptcha = url.includes('hcaptcha');
    const isGenerate = url.includes('studio-api-prod.suno.com');
    if (!isHcaptcha && !isGenerate) return;

    const headers = resp.headers();
    console.log('\n[RESP]', resp.status(), url);

    try {
      const ct = headers['content-type'] ?? '';
      if (ct.includes('octet-stream') || ct.includes('msgpack')) {
        const buf = await resp.body();
        console.log('[RESP binary size]', buf.length);
        console.log('[RESP hex first 300]', buf.slice(0, 300).toString('hex'));
      } else {
        const text = await resp.text();
        const display = text.length > 4000 ? text.slice(0, 4000) + '...(truncated)' : text;
        console.log('[RESP body]', display);
      }
    } catch (e: any) {
      console.log('[RESP body error]', e.message);
    }
  });

  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  page.setDefaultNavigationTimeout(TIMEOUT);

  // ── 3. 导航到 /create ────────────────────────────────────────────────
  console.log('\nNavigating to https://suno.com/create ...');
  await page.goto('https://suno.com/create', {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT,
  });
  console.log('Page DOM loaded');

  // 再等待页面充分渲染（最多 15 秒）
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
    console.log('networkidle timeout, continuing anyway');
  });
  console.log('Page ready');

  // ── 4. 等待 textarea 出现 ────────────────────────────────────────────
  console.log('\nWaiting for textarea...');
  const textarea = page.locator(`xpath=${TEXTAREA_XPATH}`);
  await textarea.waitFor({ state: 'visible', timeout: TIMEOUT });
  console.log('Textarea found');

  // 等待 hCaptcha checksiteconfig（若有）。对于正常账户通常不会触发，超时忽略。
  console.log('Waiting for hCaptcha checksiteconfig (if any, max 8s)...');
  await Promise.race([
    page.waitForResponse(
      (r) => r.url().includes('checksiteconfig'),
      { timeout: 8_000 }
    ).then(() => console.log('checksiteconfig done')).catch(() => {}),
    page.waitForTimeout(8_000),
  ]);
  console.log('hCaptcha init window passed');

  // ── 5. 填入 prompt ───────────────────────────────────────────────────
  await textarea.click();
  await textarea.fill('');           // 先清空
  await page.waitForTimeout(500);
  await textarea.type(PROMPT_TEXT, { delay: 40 }); // 模拟人工输入
  console.log('Prompt typed');

  await page.waitForTimeout(1000);

  // ── 6. 等待 Create song 按钮可点击 ──────────────────────────────────
  console.log('\nWaiting for "Create song" button...');
  const createBtn = page.locator(`xpath=${CREATE_BTN_XPATH}`);
  await createBtn.waitFor({ state: 'visible', timeout: TIMEOUT });

  // 等待按钮变为可用（不被 disabled）
  await page.waitForFunction(
    () => {
      const btn = document.evaluate(
        '//button[@aria-label="Create song"]',
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue as HTMLButtonElement | null;
      return btn && !btn.disabled;
    },
    { timeout: TIMEOUT }
  );
  console.log('"Create song" button is enabled');

  // ── 7. 监听网络请求（抓生成接口） ────────────────────────────────────
  const generatePromise = page.waitForResponse(
    (resp) =>
      (resp.url().includes('/generate') || resp.url().includes('/custom_generate')) &&
      resp.status() < 400,
    { timeout: TIMEOUT }
  ).catch(() => null);

  // ── 8. 点击 Create song ──────────────────────────────────────────────
  console.log('\nClicking "Create song"...');
  await createBtn.click();
  console.log('Button clicked');

  // ── 9. 等待生成请求 ──────────────────────────────────────────────────
  console.log('Waiting for generate API response...');
  const genResp = await generatePromise;
  if (genResp) {
    console.log('\nGenerate API called:', genResp.url());
    console.log('Status:', genResp.status());
    try {
      const body = await genResp.json();
      console.log('Response (first 500):', JSON.stringify(body, null, 2).slice(0, 500));
    } catch {
      console.log('(non-JSON response body)');
    }
  } else {
    console.log('No generate API response captured within timeout');
  }

  // 额外等 3 秒观察页面状态（非无头时有用）
  await page.waitForTimeout(3000);

  await browser.close();
  console.log('\nDone.');
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
