// 解析真实浏览器的 getcaptcha 请求，提取 formData 结构
// 并尝试直接 replay 这个请求看能否得到 success: true

import fs from 'fs';
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { decode as msgpackDecode } from '@msgpack/msgpack';

const PROXY = 'http://127.0.0.1:7897';
const agent = new HttpsProxyAgent(PROXY);

// 读取 curl 文件
const curlText = fs.readFileSync('scripts/getcaptcha_curl.txt', 'utf-8');

// 提取 --data-raw 的内容（$'...' 格式）
// 找到 --data-raw $' 开头的部分
const dataRawMatch = curlText.match(/--data-raw \$'([\s\S]+)'\s*$/);
if (!dataRawMatch) {
  console.error('找不到 --data-raw 内容');
  process.exit(1);
}

// 解析 $'...' bash ANSI-C 转义字符串 -> Buffer
function parseAnsiC(s) {
  const bytes = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\\') {
      i++;
      if (s[i] === 'u' || s[i] === 'U') {
        // \uXXXX 或 \UXXXXXXXX unicode 转义
        const hexLen = s[i] === 'u' ? 4 : 8;
        const hex = s.slice(i + 1, i + 1 + hexLen);
        const codePoint = parseInt(hex, 16);
        i += 1 + hexLen;
        // 转换为 UTF-8 bytes
        const str = String.fromCodePoint(codePoint);
        for (let j = 0; j < str.length; j++) {
          bytes.push(str.charCodeAt(j));
        }
      } else if (s[i] === 'x') {
        // \xXX 十六进制
        const hex = s.slice(i + 1, i + 3);
        bytes.push(parseInt(hex, 16));
        i += 3;
      } else if (s[i] === 'n') {
        bytes.push(0x0a); i++;
      } else if (s[i] === 'r') {
        bytes.push(0x0d); i++;
      } else if (s[i] === 't') {
        bytes.push(0x09); i++;
      } else if (s[i] === '\\') {
        bytes.push(0x5c); i++;
      } else if (s[i] === "'") {
        bytes.push(0x27); i++;
      } else if (s[i] === '!') {
        bytes.push(0x21); i++;
      } else if (s[i] >= '0' && s[i] <= '7') {
        // 八进制
        let oct = s[i];
        if (s[i+1] >= '0' && s[i+1] <= '7') { oct += s[i+1]; i++; }
        if (s[i+1] >= '0' && s[i+1] <= '7') { oct += s[i+1]; i++; }
        bytes.push(parseInt(oct, 8));
        i++;
      } else {
        bytes.push(s.charCodeAt(i)); i++;
      }
    } else {
      // 普通字符：直接用 charCode（可能是非ASCII）
      const code = s.charCodeAt(i);
      if (code < 128) {
        bytes.push(code);
      } else {
        // 多字节 UTF-8 字符（文件里的 non-ASCII 直接是 UTF-8）
        const char = s[i];
        const encoded = Buffer.from(char, 'utf-8');
        for (const b of encoded) bytes.push(b);
      }
      i++;
    }
  }
  return Buffer.from(bytes);
}

let rawBody;
try {
  rawBody = parseAnsiC(dataRawMatch[1]);
  console.log(`请求体原始长度: ${rawBody.length} bytes`);
  console.log(`前16字节 hex: ${rawBody.slice(0, 16).toString('hex')}`);
} catch(e) {
  console.error('解析 --data-raw 失败:', e.message);
  process.exit(1);
}

// 尝试解码 msgpack
console.log('\n--- 尝试解码 msgpack ---');
try {
  const decoded = msgpackDecode(rawBody);
  console.log('顶层结构类型:', typeof decoded, Array.isArray(decoded) ? `(array[${decoded.length}])` : '');
  
  if (Array.isArray(decoded)) {
    console.log('\n[0] challengeSpec:', JSON.stringify(decoded[0], null, 2));
    
    if (decoded[1]) {
      const enc = decoded[1];
      console.log('\n[1] encrypted data type:', typeof enc, enc instanceof Uint8Array ? `Uint8Array(${enc.length})` : '');
      if (enc instanceof Uint8Array) {
        console.log('[1] encrypted hex (前32字节):', Buffer.from(enc).slice(0, 32).toString('hex'));
      }
    }
  }
} catch(e) {
  console.log('标准 msgpack 解码失败:', e.message);
  console.log('前32字节 hex:', rawBody.slice(0, 32).toString('hex'));
  
  // 手动检查 msgpack 格式
  const b0 = rawBody[0];
  console.log(`首字节: 0x${b0.toString(16)} (${b0})`);
  if ((b0 & 0xf0) === 0x90) {
    console.log(`-> fixarray, 长度 = ${b0 & 0x0f}`);
  } else if (b0 === 0xdc) {
    console.log(`-> array16, 长度 = ${rawBody.readUInt16BE(1)}`);
  } else if (b0 === 0xdd) {
    console.log(`-> array32`);
  } else if (b0 === 0x92) {
    console.log(`-> fixarray(2) ✅`);
  }
}

// 提取 headers
const headers = {};
const headerMatches = curlText.matchAll(/-H '([^:]+): ([^']+)'/g);
for (const m of headerMatches) {
  headers[m[1].toLowerCase()] = m[2];
}
// 提取 cookie
const cookieMatch = curlText.match(/-b '([^']+)'/);
if (cookieMatch) headers['cookie'] = cookieMatch[1];

console.log('\n--- 请求 Headers ---');
const importantHeaders = ['accept', 'content-type', 'origin', 'referer', 'user-agent'];
for (const h of importantHeaders) {
  if (headers[h]) console.log(`  ${h}: ${headers[h].slice(0, 80)}`);
}

// 尝试 replay 这个请求
console.log('\n--- Replay 请求 ---');
const url = new URL('https://hcaptcha-endpoint-prod.suno.com/getcaptcha/d65453de-3f1a-4aac-9366-a0f06e52b2ce');

const requestHeaders = {
  'accept': 'application/json, application/octet-stream',
  'accept-language': 'zh-CN,zh;q=0.9',
  'content-type': 'application/octet-stream',
  'origin': 'https://hcaptcha-assets-prod.suno.com',
  'referer': 'https://hcaptcha-assets-prod.suno.com/',
  'user-agent': headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'sec-ch-ua': headers['sec-ch-ua'] || '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'priority': 'u=1, i',
};
// 不带 cookie（getcaptcha 不需要 suno 的 cookie）

const resp = await new Promise((resolve, reject) => {
  const req = https.request({
    hostname: url.hostname,
    path: url.pathname,
    method: 'POST',
    headers: requestHeaders,
    agent,
  }, resolve);
  req.on('error', reject);
  req.write(rawBody);
  req.end();
});

const chunks = [];
resp.on('data', c => chunks.push(c));
await new Promise(r => resp.on('end', r));
const respBody = Buffer.concat(chunks);

console.log(`响应状态: ${resp.statusCode}`);
console.log(`响应 Content-Type: ${resp.headers['content-type']}`);
console.log(`响应长度: ${respBody.length} bytes`);

if (respBody[0] === 0x7b || respBody[0] === 0x5b) {
  const json = JSON.parse(respBody.toString('utf-8'));
  console.log('响应 JSON:', JSON.stringify(json, null, 2));
} else {
  console.log('响应 hex (前64字节):', respBody.slice(0, 64).toString('hex'));
  try {
    const decoded = msgpackDecode(respBody);
    console.log('响应 msgpack:', JSON.stringify(decoded, null, 2));
  } catch(e) {
    console.log('响应无法解码:', e.message);
  }
}
