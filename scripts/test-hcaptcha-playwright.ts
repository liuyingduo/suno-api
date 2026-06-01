/**
 * 用真实 Chromium（Playwright）完整跑 hCaptcha hsw 流程
 * 运行: npx tsx scripts/test-hcaptcha-playwright.ts
 *
 * 策略：
 *   1. 从 DB 拿账户 cookie
 *   2. 打开一个隐身 Chromium，注入 cookie，拦截所有 hcaptcha 请求
 *   3. 导航到一个空白页，在页面内用 fetch 发 checksiteconfig + getcaptcha
 *      （浏览器原生 WASM / 加密 / JS 全部由页面上下文处理）
 *   4. 捕获 generated_pass_UUID，拼成 token 返回
 */
import { chromium, BrowserContext } from 'playwright';
import * as cookie from 'cookie';
import { getDb } from '../src/lib/db';

const HCAPTCHA_SITEKEY = 'd65453de-3f1a-4aac-9366-a0f06e52b2ce';
const HCAPTCHA_API    = 'https://hcaptcha-endpoint-prod.suno.com';
const HCAPTCHA_ASSETS = 'https://hcaptcha-assets-prod.suno.com';
const HCAPTCHA_VERSION = 'be2fb915d274e0153a2483e68ec5703d502b9d3d';

async function main() {
  const db = await getDb();
  const row = db.prepare(
    'SELECT id, email, cookie FROM accounts WHERE enabled = 1 LIMIT 1'
  ).get() as any;
  if (!row) { console.error('No enabled accounts in DB'); process.exit(1); }
  console.log('Using account:', row.email, '(id:', row.id + ')');

  const cookies = cookie.parse(row.cookie as string);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context: BrowserContext = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    // 注入账户 cookie（suno.com 域）
    storageState: {
      cookies: Object.entries(cookies).map(([name, value]) => ({
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

  // 拦截并记录 getcaptcha 响应，抓 token
  context.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/getcaptcha/')) {
      console.log('\n[intercept] getcaptcha response:', response.status());
      try {
        const ct = response.headers()['content-type'] ?? '';
        let body: any;
        if (ct.includes('octet-stream') || ct.includes('msgpack')) {
          const buf = await response.body();
          console.log('[intercept] binary body size:', buf.length);
          // 把 raw bytes 打出来以便分析
          console.log('[intercept] body hex (first 200):', buf.slice(0, 200).toString('hex'));
        } else {
          body = await response.json().catch(() => null);
          if (body) {
            const safe = { ...body };
            delete safe.tasklist;
            console.log('[intercept] json body:', JSON.stringify(safe, null, 2));
          }
        }
      } catch { /* ignore */ }
    }
  });

  const page = await context.newPage();

  // 导航到 suno.com，让 Cookie 生效（同源）
  console.log('\nNavigating to suno.com...');
  await page.goto('https://suno.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('Page loaded');

  // 在页面上下文内完整执行 hCaptcha PoW 流程
  console.log('\nRunning hCaptcha PoW in browser context...');
  const result: any = await page.evaluate(async ({
    SITEKEY, API, ASSETS, VERSION,
  }: {
    SITEKEY: string;
    API: string;
    ASSETS: string;
    VERSION: string;
  }) => {
    const log: string[] = [];
    function L(msg: string) { log.push(msg); console.log('[page]', msg); }

    // ─── Step 1: checksiteconfig ─────────────────────────────────────
    L('Step 1: checksiteconfig');
    let configResp: any;
    try {
      const r = await fetch(
        `${API}/checksiteconfig?v=${VERSION}&host=suno.com&sitekey=${SITEKEY}&sc=1&swa=1&spst=1`,
        {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'content-type': 'application/json; charset=UTF-8',
            'origin': ASSETS,
            'referer': `${ASSETS}/`,
          },
        }
      );
      configResp = await r.json();
      L(`checksiteconfig pass=${configResp.pass} c.type=${configResp.c?.type} enc_get_req=${configResp.features?.enc_get_req}`);
    } catch (e: any) {
      return { error: 'checksiteconfig failed: ' + e.message, log };
    }

    if (configResp?.c?.type !== 'hsw') {
      return { error: 'non-hsw type: ' + configResp?.c?.type, log };
    }

    const encGetReq: boolean = configResp.features?.enc_get_req === true;
    L(`enc_get_req=${encGetReq}`);

    // ─── Step 2: 加载 hsw.js ────────────────────────────────────────
    async function loadHsw(lPath: string): Promise<(jwt: string, opts: any) => Promise<string>> {
      let url = lPath;
      if (url.startsWith('/')) url = ASSETS + url;
      if (!url.endsWith('.js')) url = url + '/hsw.js';
      L('Loading hsw.js: ' + url);
      const code = await fetch(url, {
        headers: { referer: `${ASSETS}/captcha/v1/${VERSION}/static/hcaptcha.html` },
      }).then(r => r.text());
      L('hsw.js size: ' + code.length);
      // eval 到当前页面作用域
      // eslint-disable-next-line no-eval
      eval(code);
      const fn = (window as any).hsw;
      if (typeof fn !== 'function') throw new Error('hsw not found after eval');
      return fn;
    }

    // ─── Step 3: 解 PoW ─────────────────────────────────────────────
    async function solvePoW(challengeSpec: any): Promise<string> {
      const reqJwt: string = challengeSpec.req;
      // JWT payload
      const parts = reqJwt.split('.');
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      L(`JWT l=${payload.l} n=${payload.n} c=${payload.c}`);

      const hswFn = await loadHsw(payload.l);

      const opts = {
        href: 'https://suno.com/',
        ardata: null,
        vm_data: null,
        uj_data: null,
      };
      L('Calling hsw...');
      const proof = await hswFn(reqJwt, opts);
      L('proof (first 60): ' + String(proof).substring(0, 60));
      return String(proof);
    }

    // ─── Step 4: getcaptcha 循环 ─────────────────────────────────────
    let token: string | null = null;
    let currentSpec = configResp.c;
    let proof = await solvePoW(currentSpec).catch((e: any) => {
      L('solvePoW error: ' + e.message); return null;
    });
    if (!proof) return { error: 'initial solvePoW failed', log };

    for (let round = 0; round < 6; round++) {
      L(`getcaptcha round ${round + 1}`);
      const st = Date.now();
      const formData: Record<string, string> = {
        v: VERSION,
        sitekey: SITEKEY,
        host: 'suno.com',
        hl: 'en',
        n: proof,
        c: JSON.stringify(currentSpec),
        motionData: JSON.stringify({
          st, dct: st, v: 1,
          topLevel: { st, dct: st, mm: [], md: [], mu: [], ku: [], v: 1 },
          session: [],
        }),
      };

      let respData: any = null;
      try {
        const r = await fetch(`${API}/getcaptcha/${SITEKEY}`, {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
            'origin': ASSETS,
            'referer': `${ASSETS}/`,
          },
          body: new URLSearchParams(formData).toString(),
        });
        L(`getcaptcha status: ${r.status}`);
        respData = await r.json();
        const safe = { ...respData }; delete safe.tasklist;
        L('response: ' + JSON.stringify(safe));
      } catch (e: any) {
        L('getcaptcha error: ' + e.message);
        break;
      }

      if (respData?.generated_pass_UUID) {
        token = 'P1_' + respData.generated_pass_UUID;
        L('TOKEN FOUND: ' + token);
        break;
      }

      if (respData?.success === false && respData?.c?.type === 'hsw' && respData?.c?.req) {
        L('New HSW challenge, re-solving...');
        currentSpec = respData.c;
        proof = await solvePoW(currentSpec).catch((e: any) => {
          L('re-solvePoW error: ' + e.message); return null;
        });
        if (!proof) break;
        continue;
      }

      L('No token, no new challenge - stopping');
      break;
    }

    return { token, log };
  }, { SITEKEY: HCAPTCHA_SITEKEY, API: HCAPTCHA_API, ASSETS: HCAPTCHA_ASSETS, VERSION: HCAPTCHA_VERSION });

  await browser.close();

  console.log('\n=== Page logs ===');
  if (result?.log) {
    for (const line of result.log) console.log(' ', line);
  }
  if (result?.error) {
    console.error('\n❌ Error:', result.error);
  } else if (result?.token) {
    console.log('\n✅ hCaptcha token:', result.token);
  } else {
    console.log('\n❌ Failed to get token');
  }
}

main().catch(console.error);
