/**
 * 用真实 Chromium 浏览器模拟 hCaptcha hsw 全链路
 * 运行: npx tsx scripts/test-hcaptcha-browser.ts
 *
 * 思路：
 *  1. 在 Playwright Chromium 里加载一个空白页面，注入账户 cookie
 *  2. 拦截 /getcaptcha/ 响应，等待 generated_pass_UUID 字段出现
 *  3. 在页面 JS 里执行完整 hCaptcha 流程（checksiteconfig → hsw.js → getcaptcha）
 *     - WASM、加密全由浏览器原生处理
 *  4. 打印最终 P1_ token
 */
import { chromium } from 'playwright';
import * as cookie from 'cookie';
import { getDb } from '../src/lib/db';

const HCAPTCHA_SITEKEY = 'd65453de-3f1a-4aac-9366-a0f06e52b2ce';
const HCAPTCHA_API    = 'https://hcaptcha-endpoint-prod.suno.com';
const HCAPTCHA_ASSETS = 'https://hcaptcha-assets-prod.suno.com';
const HCAPTCHA_VERSION = 'be2fb915d274e0153a2483e68ec5703d502b9d3d';
const MAX_ROUNDS = 8;

async function main() {
  // 1. 从 DB 读账户 cookie
  const db  = await getDb();
  const row = db.prepare(
    'SELECT id, email, cookie FROM accounts WHERE enabled = 1 LIMIT 1',
  ).get() as any;
  if (!row) { console.error('No enabled accounts'); process.exit(1); }
  console.log('Using account:', row.email, '(id:', row.id + ')');

  const parsedCookies = cookie.parse(row.cookie as string);

  // 2. 启动浏览器
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
      'accept-language': 'en-US,en;q=0.9',
    },
  });

  // 注入账户 cookie 到 suno.com 域
  const cookieList = Object.entries(parsedCookies).map(([name, value]) => ({
    name,
    value: value as string,
    domain: '.suno.com',
    path: '/',
  }));
  await context.addCookies(cookieList);

  const page = await context.newPage();

  // 3. 监听控制台（便于调试）
  page.on('console', msg => {
    if (msg.type() === 'error') console.error('[browser error]', msg.text());
    else console.log('[browser]', msg.text());
  });

  // 4. 导航到空白页，设置 origin 为 suno.com
  await page.goto('https://suno.com', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {
    // suno.com 可能重定向/加载慢，无所谓，我们只需要 cookie domain
  });

  // 5. 在浏览器里执行完整 hCaptcha 流程
  console.log('\n--- Running hCaptcha flow in browser ---');
  const result = await page.evaluate(async ({
    apiBase, assetsBase, version, sitekey, maxRounds,
  }) => {
    // =========================================================
    // 全部在浏览器 JS 里运行
    // =========================================================

    function decodeJwt(jwt: string): any {
      const part = jwt.split('.')[1];
      const padded = part.replace(/-/g, '+').replace(/_/g, '/')
        + '='.repeat((4 - part.length % 4) % 4);
      return JSON.parse(atob(padded));
    }

    // Step A: checksiteconfig
    const configResp = await fetch(
      `${apiBase}/checksiteconfig?v=${version}&host=suno.com&sitekey=${sitekey}&sc=1&swa=1&spst=1`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json; charset=UTF-8',
          origin: assetsBase,
          referer: `${assetsBase}/`,
        },
      },
    );
    const configData = await configResp.json();
    console.log('checksiteconfig:', JSON.stringify({ pass: configData.pass, type: configData.c?.type, enc: configData.features?.enc_get_req }));

    if (configData?.c?.type !== 'hsw') {
      return { error: 'non-hsw type: ' + configData?.c?.type };
    }

    // Step B: 加载 hsw.js 并初始化
    const challengeSpec = configData.c as { type: string; req: string };
    const jwtPayload = decodeJwt(challengeSpec.req);
    const lPath: string = jwtPayload.l;

    let hswUrl = `${assetsBase}${lPath}/hsw.js`;
    console.log('Loading hsw.js from:', hswUrl);

    const hswResp = await fetch(hswUrl, {
      headers: { referer: `${assetsBase}/captcha/v1/${version}/static/hcaptcha.html` },
    });
    const hswCode = await hswResp.text();
    console.log('hsw.js loaded, size:', hswCode.length);

    // eval in browser — WASM 原生加载
    // eslint-disable-next-line no-eval
    eval(hswCode);
    const hswFn = (window as any).hsw as Function;
    if (typeof hswFn !== 'function') return { error: 'hsw not found after eval' };

    // Step C: 循环提交 proof
    let currentSpec = challengeSpec;
    let token: string | null = null;

    for (let round = 0; round < maxRounds; round++) {
      const payload = decodeJwt(currentSpec.req);
      console.log(`Round ${round + 1}: lPath=${payload.l?.slice(-20)}, n=${payload.n}, c=${payload.c}`);

      // 如果 lPath 变了，重新加载 hsw.js
      if (payload.l !== lPath) {
        const newHswUrl = `${assetsBase}${payload.l}/hsw.js`;
        console.log('Reloading hsw.js:', newHswUrl);
        const r2 = await fetch(newHswUrl, {
          headers: { referer: `${assetsBase}/captcha/v1/${version}/static/hcaptcha.html` },
        });
        const code2 = await r2.text();
        eval(code2);
      }

      // 生成 proof（按真实浏览器：hsw(jwt, options)）
      const opts = { href: 'https://suno.com/', ardata: null, vm_data: null, uj_data: null };
      const proof = await (window as any).hsw(currentSpec.req, opts) as string;
      console.log('Proof (first 60):', proof.substring(0, 60));

      // 提交 getcaptcha（plain form-urlencoded）
      const st = Date.now();
      const formData = new URLSearchParams({
        v: version,
        sitekey: sitekey,
        host: 'suno.com',
        hl: 'en',
        n: proof,
        c: JSON.stringify(currentSpec),
        motionData: JSON.stringify({
          st, dct: st, v: 1,
          topLevel: { st, dct: st, mm: [], md: [], mu: [], ku: [], v: 1 },
          session: [],
        }),
      });

      const getResp = await fetch(`${apiBase}/getcaptcha/${sitekey}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
          origin: assetsBase,
          referer: `${assetsBase}/`,
        },
        body: formData.toString(),
      });
      const getData = await getResp.json();
      console.log('getcaptcha status:', getResp.status, '| success:', getData.success,
        '| UUID:', getData.generated_pass_UUID?.substring(0, 20) ?? 'none');

      if (getData.generated_pass_UUID) {
        token = 'P1_' + getData.generated_pass_UUID;
        break;
      }

      if (getData.success === false && getData.c?.type === 'hsw' && getData.c?.req) {
        currentSpec = getData.c;
        continue;
      }

      console.log('Unexpected response:', JSON.stringify(getData));
      break;
    }

    return { token };
  }, {
    apiBase: HCAPTCHA_API,
    assetsBase: HCAPTCHA_ASSETS,
    version: HCAPTCHA_VERSION,
    sitekey: HCAPTCHA_SITEKEY,
    maxRounds: MAX_ROUNDS,
  });

  await browser.close();

  if (result?.token) {
    console.log('\n✅ hCaptcha token:', result.token);
  } else if (result?.error) {
    console.error('\n❌ Error:', result.error);
  } else {
    console.error('\n❌ Failed to get token');
  }
}

main().catch(console.error);
