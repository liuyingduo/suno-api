import { encode as npmEncode } from '@msgpack/msgpack';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const fakeEncrypted = new Uint8Array([1,2,3,4,5]);
const fakeC = '{"type":"hsw","req":"test"}';

// @msgpack/msgpack 编码结果
const body1 = npmEncode([fakeC, fakeEncrypted]);
console.log('@msgpack/msgpack hex:', Buffer.from(body1).toString('hex'));

// 提取 bundle 里的 msgpack
const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, 'hcaptcha-bundle.html'), 'utf-8');

// bundle 里的 msgpack 从 .msgpack=t() 所在的 !function 开始
// 找结束位置：紧跟在 })(1)})); 之后，且前面是 msgpack 内容
const idx = html.indexOf('.msgpack=t()}}');
if (idx === -1) { console.log('not found'); process.exit(1); }

// 从 idx 向前找 !function(t){ 的起始（bundle msgpack 的入口）
const funcMarker = '!function(t){if("object"==typeof exports';
const start = html.lastIndexOf(funcMarker, idx);
if (start === -1) { console.log('!function marker not found'); process.exit(1); }
console.log('msgpack start:', start, 'context:', html.slice(start, start+40));

// 向后找到 (1)})); 结束
const endMarker = '}(1)}));';
let end = html.indexOf(endMarker, idx);
end = end !== -1 ? end + endMarker.length : html.indexOf('}));', idx + 100) + 4;
console.log('msgpack end:', end, 'context:', html.slice(end-20, end+20));

const msgpackSrc = html.slice(start, end);
console.log('msgpack src length:', msgpackSrc.length);

// 执行，捕获 module.exports
const mod = { exports: {} };
try {
  const wrapped = `(function(module, exports){ ${msgpackSrc} })`;
  const fn = eval(wrapped);
  fn(mod, mod.exports);
  const bundleMsgpack = mod.exports;
  console.log('bundle msgpack type:', typeof bundleMsgpack, 'keys:', Object.keys(bundleMsgpack || {}).join(','));
  if (bundleMsgpack && typeof bundleMsgpack.encode === 'function') {
    const body2 = bundleMsgpack.encode([fakeC, fakeEncrypted]);
    const buf2 = Buffer.from(body2 instanceof Uint8Array ? body2 : body2);
    console.log('bundle msgpack hex:  ', buf2.toString('hex'));
    console.log('SAME?', Buffer.from(body1).toString('hex') === buf2.toString('hex'));
  } else {
    console.log('encode not found, exports:', bundleMsgpack);
  }
} catch(e) {
  console.log('eval error:', e.message.slice(0, 200));
}
