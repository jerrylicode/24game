/* =========================================================
   pwa.test.mjs —— PWA 静态一致性检查（不需要浏览器）
   运行： node test/pwa.test.mjs
   覆盖：manifest 字段合法、图标真实存在且尺寸正确、图标不是空白图、
        Service Worker 预缓存清单覆盖 index.html 引用的所有本地资源、
        meta / 图标 / manifest 都已经在页面里挂上
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = (p) => fs.readFileSync(path.join(root, p));
const exists = (p) => fs.existsSync(path.join(root, p));

const html = read('index.html').toString('utf8');
const manifest = JSON.parse(read('manifest.webmanifest').toString('utf8'));

let pass = 0;
const pending = [];
/** 同步用例 */
const test = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
};
/** 异步用例：登记后统一 await（否则失败会在汇总之后才冒出来） */
const testAsync = (name, fn) => {
  pending.push((async () => {
    try { await fn(); pass++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
  })());
};

/* ---------- PNG 读取（解 IHDR + 取像素，用来确认图标不是空白） ---------- */
function readPNG(rel) {
  const b = read(rel);
  assert.equal(b.slice(0, 8).toString('hex'), '89504e470d0a1a0a', `${rel} 不是合法 PNG`);
  let off = 8; let w = 0; let h = 0; let bitDepth = 0; let colorType = 0;
  const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.slice(off + 4, off + 8).toString('ascii');
    const data = b.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  return {
    w, h, bitDepth, colorType,
    px: (x, y) => {
      const i = y * (stride + 1) + 1 + x * 4;
      return [raw[i], raw[i + 1], raw[i + 2], raw[i + 3]];
    },
  };
}

/* ---------- Service Worker：在模拟环境里真正执行它的事件处理函数 ---------- */

const swSrc = read('sw.js').toString('utf8');
const SW_VERSION = (swSrc.match(/const VERSION = '([^']+)'/) || [])[1];
const SW_ASSET_BLOCK = (swSrc.match(/const ASSETS = \[([\s\S]*?)\];/) || [])[1] || '';
const SW_ASSETS = [...SW_ASSET_BLOCK.matchAll(/'([^']+)'/g)].map((m) => m[1]);

/** 造一个够用的 CacheStorage + fetch 环境，把 sw.js 跑起来 */
function makeSwEnv({ online = true, fail = [] } = {}) {
  const stores = new Map();                     // cacheName -> Map(绝对URL -> response)
  const abs = (u) => new URL(u, 'https://game.example.com/').href;
  const calls = { add: [], put: [], deleted: [], claim: 0, skipWaiting: 0, fetched: [] };
  const mkRes = (url, status = 200) => ({
    ok: status < 400, status, type: 'basic', url, body: 'BODY:' + url,
    clone() { return mkRes(url, status); },
  });
  const cachesApi = {
    keys: async () => [...stores.keys()],
    delete: async (k) => { calls.deleted.push(k); return stores.delete(k); },
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        add: async (req) => {
          const raw = typeof req === 'string' ? req : req.url;
          // 模拟部署时个别文件 404
          if (fail.some((re) => re.test(raw) || re.test(abs(raw)))) throw new TypeError('Failed to fetch');
          calls.add.push(raw);
          m.set(abs(raw), mkRes(abs(raw)));
        },
        put: async (req, res) => {
          const raw = typeof req === 'string' ? req : req.url;
          calls.put.push(raw);
          m.set(abs(raw), res);
        },
        match: async (req, opts = {}) => {
          const url = abs(typeof req === 'string' ? req : req.url);
          if (m.has(url)) return m.get(url);
          if (opts.ignoreSearch) {
            const base = url.split('?')[0];
            for (const [k, v] of m) if (k.split('?')[0] === base) return v;
          }
          return undefined;
        },
        keys: async () => [...m.keys()].map((u) => ({ url: u })),
      };
    },
  };
  const handlers = {};
  const sandbox = {
    self: {
      addEventListener: (t, fn) => { handlers[t] = fn; },
      skipWaiting: () => { calls.skipWaiting++; },
      location: { origin: 'https://game.example.com' },
      registration: {},
      clients: { claim: () => { calls.claim++; } },
    },
    caches: cachesApi,
    fetch: async (req) => {
      const url = typeof req === 'string' ? req : req.url;
      calls.fetched.push(url);
      if (!online) throw new TypeError('Failed to fetch');
      return mkRes(url);
    },
    Response: class Response {
      constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.ok = this.status < 400; }
      static error() { return mkRes('', 0); }
    },
    Request: class Request { constructor(url) { this.url = url; } },
    URL, console, Promise, Set, Map, Array, Object, JSON,
  };
  sandbox.self.self = sandbox.self;
  vm.createContext(sandbox);
  vm.runInContext(swSrc, sandbox, { filename: 'sw.js' });
  return { handlers, calls, stores, mkRes };
}

/** 触发 install/activate 这类生命周期事件，并等待其 waitUntil 里的异步完成 */
async function fireLifecycle(env, type, extra = {}) {
  const waits = [];
  env.handlers[type]({ waitUntil: (p) => waits.push(p), ...extra });
  await Promise.all(waits);
}

/** 触发一次 fetch 事件，返回 respondWith / waitUntil 的产物 */
function fireFetch(env, { url, mode = 'no-cors', method = 'GET', dest = '' }) {
  const request = { url, method, mode, destination: dest, clone() { return this; } };
  let responded = null;
  const waits = [];
  env.handlers.fetch({ request, respondWith: (p) => { responded = p; }, waitUntil: (p) => waits.push(p) });
  return { responded, waits };
}

console.log('\nPWA manifest');

test('必需字段齐全且取值合法', () => {
  for (const key of ['name', 'short_name', 'start_url', 'display', 'icons', 'theme_color', 'background_color']) {
    assert.ok(manifest[key], `manifest 缺少 ${key}`);
  }
  assert.ok(manifest.name.length <= 45, 'name 过长会装不下');
  assert.ok(manifest.short_name.length <= 12, 'short_name 建议 ≤12 字');
  assert.equal(manifest.start_url, './index.html', 'start_url 用相对路径，便于部署到任意子目录');
  assert.equal(manifest.scope, './');
  assert.ok(['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display));
  assert.ok(/^#[0-9a-f]{6}$/i.test(manifest.theme_color));
  assert.ok(/^#[0-9a-f]{6}$/i.test(manifest.background_color));
  assert.equal(manifest.lang, 'zh-CN');
});

test('图标清单包含 192/512 与 maskable，且文件真实存在、尺寸对得上', () => {
  const sizes = new Set();
  let maskable = false;
  for (const icon of manifest.icons) {
    assert.ok(exists(icon.src), `图标文件不存在: ${icon.src}`);
    if (icon.purpose === 'maskable') maskable = true;
    if (icon.type === 'image/svg+xml') { sizes.add('any'); continue; }
    const png = readPNG(icon.src);
    const [w, h] = icon.sizes.split('x').map(Number);
    assert.equal(png.w, w, `${icon.src} 实际宽度 ${png.w} 与声明 ${w} 不一致`);
    assert.equal(png.h, h, `${icon.src} 实际高度 ${png.h} 与声明 ${h} 不一致`);
    sizes.add(`${png.w}x${png.h}`);
  }
  assert.ok(sizes.has('192x192'), '缺少 192×192');
  assert.ok(sizes.has('512x512'), '缺少 512×512');
  assert.ok(maskable, '缺少 maskable 图标（安卓自适应图标会糊）');
});

test('图标是真实画出来的：有内容、圆角图标四角透明、maskable 四角不透明', () => {
  for (const icon of manifest.icons) {
    if (icon.type !== 'image/png') continue;
    const png = readPNG(icon.src);
    assert.equal(png.bitDepth, 8);
    assert.equal(png.colorType, 6, '应为 RGBA');
    const center = png.px(Math.floor(png.w / 2), Math.floor(png.h / 2));
    assert.ok(center[3] > 200, `${icon.src} 中心是透明的，像是空白图`);
    // 中心应当落在浅色牌面上（不是纯背景色）
    assert.ok(center[0] > 150 && center[1] > 150, `${icon.src} 中心不像牌面: ${center}`);
    const corner = png.px(2, 2);
    if (icon.purpose === 'maskable') {
      assert.equal(corner[3], 255, 'maskable 图标必须是满幅不透明，否则系统遮罩会露白');
    } else if (icon.src.includes('icon-')) {
      assert.equal(corner[3], 0, '普通图标应为圆角（四角透明）');
    }
  }
});

test('分享卡片尺寸符合微信/OG 建议', () => {
  const png = readPNG('icons/share-1200x630.png');
  assert.equal(png.w, 1200);
  assert.equal(png.h, 630);
  assert.equal(png.px(2, 2)[3], 255, '分享图不能透明（微信预览会发黑）');
});

console.log('\nService Worker');

testAsync('install：把清单里的每个资源都塞进缓存，并立刻接管', async () => {
  const env = makeSwEnv();
  await fireLifecycle(env, 'install');
  assert.equal(env.calls.skipWaiting, 1, '应调用 skipWaiting');
  const cached = env.calls.add;
  assert.equal(cached.length, SW_ASSETS.length, `应缓存 ${SW_ASSETS.length} 个资源，实际 ${cached.length}`);
  for (const rel of ['index.html', 'css/style.css', 'js/game.js', 'icons/icon-192.png']) {
    assert.ok(cached.includes('./' + rel), `漏缓存 ${rel}`);
  }
  assert.equal(env.stores.get(`game24-${SW_VERSION}`).size, SW_ASSETS.length);
});

test('index.html 里引用的本地资源必须全在预缓存清单里', () => {
  const refs = new Set();
  for (const m of html.matchAll(/(?:src|href)="((?!https?:|data:|#)[^"]+)"/g)) {
    const rel = m[1].replace(/^\.\//, '');
    if (rel.endsWith('.html')) continue;          // 页面本身单独校验
    refs.add(rel);
  }
  const missing = [...refs].filter((rel) => !SW_ASSETS.includes('./' + rel));
  assert.deepEqual(missing, [], '这些本地资源没被预缓存（离线会缺）: ' + missing.join(', '));
});

testAsync('install：个别资源拿不到也不会让整次安装失败（游戏仍能离线打开）', async () => {
  const env = makeSwEnv({ fail: [/share-1200x630\.png$/] });
  await fireLifecycle(env, 'install');
  const cache = env.stores.get(`game24-${SW_VERSION}`);
  assert.equal(cache.size, SW_ASSETS.length - 1, '只有失败的那个没进缓存，其余照常');
  assert.ok(cache.has('https://game.example.com/index.html'), 'index.html 必须在缓存里（否则离线打不开）');
  assert.equal(env.calls.skipWaiting, 1, '仍应完成安装并接管');
});

testAsync('activate：清掉自己的旧版本缓存，但不动同域其它应用的缓存', async () => {
  const env = makeSwEnv();
  env.stores.set('game24-v0.0.1', new Map());        // 旧版本
  env.stores.set('other-app-v2', new Map());         // 别人的
  env.stores.set(`game24-${SW_VERSION}`, new Map()); // 当前版本
  await fireLifecycle(env, 'activate');
  assert.deepEqual(env.calls.deleted, ['game24-v0.0.1']);
  assert.ok(env.stores.has('other-app-v2'), '不能误删同域其它应用的缓存');
  assert.equal(env.calls.claim, 1, '应立刻接管页面');
});

testAsync('离线导航：网络挂了也能从缓存里拿出 index.html', async () => {
  const env = makeSwEnv({ online: false });
  await fireLifecycle(env, 'install');
  const { responded } = fireFetch(env, { url: 'https://game.example.com/index.html', mode: 'navigate' });
  const res = await responded;
  assert.ok(res && res.status === 200, '离线时应返回缓存的 index.html');
  assert.equal(res.body, 'BODY:https://game.example.com/index.html');
});

testAsync('在线导航：拿最新页面并顺手更新缓存', async () => {
  const env = makeSwEnv();
  await fireLifecycle(env, 'install');
  const { responded } = fireFetch(env, { url: 'https://game.example.com/index.html', mode: 'navigate' });
  const res = await responded;
  assert.equal(res.body, 'BODY:https://game.example.com/index.html', '在线应走网络');
  assert.ok(env.calls.put.includes('./index.html'), '应把新页面写回缓存');
});

testAsync('静态资源：缓存优先，命中后后台静默更新', async () => {
  const env = makeSwEnv();
  await fireLifecycle(env, 'install');
  const before = env.calls.fetched.length;
  const { responded, waits } = fireFetch(env, { url: 'https://game.example.com/js/game.js', dest: 'script' });
  const res = await responded;
  assert.equal(res.body, 'BODY:https://game.example.com/js/game.js', '应直接给缓存里的版本');
  await Promise.all(waits);
  assert.ok(env.calls.fetched.length > before, '同时应发起后台更新请求');
});

testAsync('静态资源：带查询串也能命中缓存（?debug=1 不会绕过缓存）', async () => {
  const env = makeSwEnv();
  await fireLifecycle(env, 'install');
  const { responded } = fireFetch(env, { url: 'https://game.example.com/css/style.css?v=2', dest: 'style' });
  const res = await responded;
  assert.equal(res.body, 'BODY:https://game.example.com/css/style.css', 'ignoreSearch 应让查询串不影响命中');
});

testAsync('未缓存的资源：联网取回并写入缓存；彻底离线时给出明确的 504', async () => {
  const env = makeSwEnv();
  const { responded } = fireFetch(env, { url: 'https://game.example.com/extra.txt' });
  const res = await responded;
  assert.equal(res.status, 200);
  assert.ok(env.calls.put.includes('https://game.example.com/extra.txt'), '取回后应写入缓存');

  const env2 = makeSwEnv({ online: false });
  const { responded: r2 } = fireFetch(env2, { url: 'https://game.example.com/never-cached.txt' });
  const res2 = await r2;
  assert.equal(res2.status, 504, '离线且未缓存应返回 504 而不是崩掉');
});

test('跨域请求 / 非 GET 请求不进 Service Worker', () => {
  const env = makeSwEnv();
  const cross = fireFetch(env, { url: 'https://cdn.example.com/a.js' });
  assert.equal(cross.responded, null, '跨域应直接放行');
  const post = fireFetch(env, { url: 'https://game.example.com/api', method: 'POST' });
  assert.equal(post.responded, null, '非 GET 应直接放行');
});

test('支持 SKIP_WAITING 消息与版本查询（方便更新与自检）', async () => {
  const env = makeSwEnv();
  env.handlers.message({ data: { type: 'SKIP_WAITING' } });
  assert.equal(env.calls.skipWaiting, 1);
  let asked = null;
  env.handlers.message({ data: { type: 'VERSION' }, ports: [{ postMessage: (m) => { asked = m; } }] });
  assert.equal(asked.version, SW_VERSION);
  assert.equal(asked.assets, SW_ASSETS.length);
});

test('页面里挂上了 manifest / 图标 / 分享 meta', () => {
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest"/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png"/);
  assert.match(html, /<link rel="icon" href="icons\/favicon\.svg"/);
  assert.match(html, /<meta property="og:image" content="icons\/share-1200x630\.png"/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /<meta name="theme-color"/);
});

await Promise.all(pending);
console.log(`\n全部通过：${pass} 组断言${process.exitCode ? '（有失败）' : ''}\n`);
