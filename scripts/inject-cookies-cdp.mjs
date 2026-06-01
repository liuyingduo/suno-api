// 通过 Chrome DevTools Protocol (CDP) 把 cookie 注入到已打开的 Chrome 中
// 前提：chrome.exe --remote-debugging-port=9222

import fs from 'fs';
import http from 'http';
import { WebSocket } from 'ws';

const CDP_HOST = 'http://localhost:9222';

// 读取账号 cookie
const accounts = JSON.parse(fs.readFileSync('data/accounts.json', 'utf-8'));
const target = accounts[0]; // nkmzh6ea@ada.rehearsalk.com
console.log('账号:', target.email);
console.log('Cookie 长度:', target.cookie.length);

// 解析 cookie 字符串为对象数组
function parseCookies(cookieStr) {
  return cookieStr.split('; ').map(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return null;
    return {
      name: pair.slice(0, idx).trim(),
      value: pair.slice(idx + 1).trim(),
    };
  }).filter(Boolean);
}

// HTTP GET 辅助
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(JSON.parse(data)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// CDP 命令封装
function cdpCommand(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const handler = (msg) => {
      const data = JSON.parse(msg);
      if (data.id === id) {
        ws.removeListener('message', handler);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  // 1. 获取所有 target
  const targets = await httpGet(`${CDP_HOST}/json`);
  console.log('\n当前打开的 Tab:');
  targets.forEach((t, i) => console.log(`  [${i}] ${t.type}: ${t.url}`));

  // 找到第一个 page 类型的 tab
  let pageTarget = targets.find(t => t.type === 'page' && !t.url.startsWith('devtools://'));
  if (!pageTarget) {
    // 如果没有普通页面，用第一个
    pageTarget = targets[0];
  }
  console.log('\n使用 Tab:', pageTarget.url);
  console.log('WebSocket URL:', pageTarget.webSocketDebuggerUrl);

  // 2. 连接 WebSocket
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  console.log('\n✅ CDP 连接成功');

  // 3. 启用 Network 域
  await cdpCommand(ws, 1, 'Network.enable', {});

  // 4. 清除 suno.com 的旧 cookie
  console.log('\n清除 suno.com 旧 cookie...');
  await cdpCommand(ws, 2, 'Network.clearBrowserCookies', {});

  // 5. 批量设置 cookie
  const cookies = parseCookies(target.cookie);
  console.log(`\n开始注入 ${cookies.length} 个 cookie...`);

  let cmdId = 10;
  let successCount = 0;
  let failCount = 0;

  for (const cookie of cookies) {
    try {
      const result = await cdpCommand(ws, cmdId++, 'Network.setCookie', {
        name: cookie.name,
        value: cookie.value,
        domain: '.suno.com',
        path: '/',
        secure: true,
        httpOnly: false,
        sameSite: 'None',
      });
      if (result.success) {
        successCount++;
      } else {
        console.warn(`  ⚠️  ${cookie.name} = 设置失败`);
        failCount++;
      }
    } catch (e) {
      console.warn(`  ❌ ${cookie.name}: ${e.message}`);
      failCount++;
    }
  }

  console.log(`\n注入完成: ✅ ${successCount} 成功, ❌ ${failCount} 失败`);

  // 6. 导航到 suno.com
  console.log('\n正在导航到 https://suno.com ...');
  await cdpCommand(ws, cmdId++, 'Page.navigate', { url: 'https://suno.com' });
  
  console.log('✅ 完成！浏览器应该已经跳转到 suno.com，带着注入的 cookie');
  console.log('   如果登录成功，页面会显示你的账号信息');
  console.log('   然后你可以在 Network 面板里找 hCaptcha 相关请求');

  ws.close();
}

main().catch(err => {
  console.error('❌ 出错:', err.message);
  process.exit(1);
});
