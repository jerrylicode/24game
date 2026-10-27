/* =========================================================
   h5.test.mjs —— H5 适配层单测（用极简假 DOM 跑，不需要浏览器）
   运行： node test/h5.test.mjs
   覆盖：视口高度兜底、触摸识别与强制覆盖、视口变化回调、
        旧内核 PointerEvent 兜底（touch → pointer 翻译）、布局体检数据
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'js', 'h5.js'), 'utf8');

/* ---------- 极简假 DOM ---------- */
function makeHarness({
  search = '', pointerEvents = true, touch = true, coarse = true, standalone = false,
  webAnimations = true, ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) Safari/604.1',
  weixinBridge = false, serviceWorker = null, protocol = 'https:', hostname = 'game.example.com',
  share = null, clipboard = null,
} = {}) {
  const docListeners = {};
  let win_weixin = null;
  const classSet = (el) => new Set((el._cls || []));
  function classListOf(el) {
    return {
      add: (c) => { el._cls.add(c); },
      remove: (c) => { el._cls.delete(c); },
      contains: (c) => el._cls.has(c),
      toggle: (c, on) => { const v = on == null ? !el._cls.has(c) : !!on; if (v) el._cls.add(c); else el._cls.delete(c); return v; },
      get value() { return [...el._cls].join(' '); },
    };
  }
  function makeEl(tag = 'div') {
    const el = {
      tagName: tag.toUpperCase(), _cls: new Set(), style: {}, dataset: {}, children: [],
      dispatched: [],
      setAttribute() {}, getAttribute() { return null; },
      addEventListener(t, fn) { (el._l ||= {})[t] = fn; },
      removeEventListener(t) { if (el._l) delete el._l[t]; },
      dispatchEvent(ev) { el.dispatched.push(ev); return true; },
      closest() { return el; },
      querySelector() { return null; },
      getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 }; },
      offsetWidth: 20, offsetHeight: 20,
    };
    el.style.setProperty = (k, v) => { el.style[k] = v; };
    el.style.getPropertyValue = (k) => el.style[k] || '';
    el.style.removeProperty = (k) => { delete el.style[k]; };
    el.classList = classListOf(el);
    return el;
  }
  const html = makeEl('html');
  html.scrollWidth = 390;
  html.scrollHeight = 844;
  const table = makeEl('main');
  const board = makeEl('div');
  const app = makeEl('div');
  const card = makeEl('div');
  board.children = [card];
  board.querySelector = (sel) => (sel === '.card' ? card : null);
  const popup = makeEl('div');
  popup.querySelector = () => null;

  const document_ = {
    documentElement: html,
    hidden: false,
    _l: docListeners,
    addEventListener(t, fn) { (docListeners[t] ||= []).push(fn); },
    removeEventListener() {},
    createElement: (t) => makeEl(t),
    getElementById: (id) => (id === 'app' ? app : null),
  };
  const vvListeners = {};
  const winListeners = {};
  class MouseEvent {
    constructor(type, params = {}) { this.type = type; Object.assign(this, params); }
  }
  const invokeCalls = [];
  win_weixin = { invoke: (name, params, cb) => { invokeCalls.push(name); if (cb) cb(); } };
  const navigator_ = {
    maxTouchPoints: touch ? 5 : 0,
    standalone,
    userAgent: ua,
    platform: 'iPhone',
  };
  if (serviceWorker) navigator_.serviceWorker = serviceWorker;
  if (share) navigator_.share = share;
  if (clipboard) navigator_.clipboard = clipboard;

  const win = {
    document: document_,
    innerWidth: 390,
    innerHeight: 844,
    location: { search, protocol, hostname, href: protocol + '//' + hostname + '/index.html' },
    navigator: navigator_,
    MouseEvent,
    _l: winListeners,
    addEventListener(t, fn) { (winListeners[t] ||= []).push(fn); },
    removeEventListener(t) { if (winListeners[t]) delete winListeners[t]; },
    matchMedia: (q) => ({ matches: (q.includes('coarse') && coarse) || (q.includes('display-mode') && standalone), addEventListener() {}, addListener() {} }),
    visualViewport: { height: 844, width: 390, addEventListener(t, fn) { (vvListeners[t] ||= []).push(fn); } },
    setTimeout,
    clearTimeout,
  };
  if (touch) win.ontouchstart = null;
  if (pointerEvents) win.PointerEvent = class PointerEvent extends MouseEvent {};
  if (weixinBridge) win.WeixinJSBridge = win_weixin;
  document_.body = { appendChild() {}, removeChild() {}, };
  document_.execCommand = () => true;
  // 假 Element：用来验证 WAAPI 兜底
  class Element {
    constructor() {
      this.style = {};
      this.classList = classListOf(this);
      this._cls = new Set();
    }
  }
  if (webAnimations) Element.prototype.animate = () => ({ finished: Promise.resolve() });
  win.Element = Element;
  win.window = win;

  return { win, document: document_, html, table, board, card, app, popup, docListeners, winListeners, vvListeners, invokeCalls, bridge: win_weixin };
}

function load(h) {
  const sandbox = { window: h.win, document: h.document, console, URLSearchParams, setTimeout, clearTimeout, Math, JSON, Object, Array, Float32Array, Number, String, Set, Promise, Element: h.win.Element, URL };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'h5.js' });
  return sandbox.window.G24.H5;
}

/* ---------- 断言 ---------- */
let pass = 0;
const pending = [];
/** 同步用例 */
const test = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
};
/** 异步用例：登记后统一 await */
const testAsync = (name, fn) => {
  pending.push((async () => {
    try { await fn(); pass++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
  })());
};

console.log('\nH5 适配层');

test('setup：写入 --app-h、打上 is-touch 标记', () => {
  const h = makeHarness();
  const H5 = load(h);
  H5.setup();
  assert.equal(h.html.style['--app-h'], '844px', '应把可视高度写进 --app-h');
  assert.ok(h.html.classList.contains('is-touch'), '触摸设备应标记 is-touch');
  assert.equal(H5.isTouch, true);
  assert.equal(H5.hasPointerEvent, true);
});

test('非触摸设备不会误判', () => {
  const h = makeHarness({ touch: false, coarse: false });
  const H5 = load(h);
  H5.setup();
  assert.equal(H5.isTouch, false);
  assert.ok(!h.html.classList.contains('is-touch'));
});

test('?touch=1 / ?touch=0 可以强制覆盖识别结果', () => {
  const a = makeHarness({ touch: false, coarse: false, search: '?touch=1' });
  const H5a = load(a); H5a.setup();
  assert.equal(H5a.isTouch, true, '?touch=1 应强制为触摸');
  const b = makeHarness({ touch: true, coarse: true, search: '?touch=0' });
  const H5b = load(b); H5b.setup();
  assert.equal(H5b.isTouch, false, '?touch=0 应强制为非触摸');
});

test('视口变化（转屏 / 地址栏伸缩）会更新高度并通知回调', () => {
  const h = makeHarness();
  const H5 = load(h);
  H5.setup();
  let calls = 0;
  H5.onViewportChange(() => { calls++; });
  // 模拟地址栏收起：可视变高
  h.win.visualViewport.height = 900;
  for (const fn of (h.winListeners.resize || [])) fn();
  assert.equal(calls, 1, '回调应被调用一次');
  assert.equal(h.html.style['--app-h'], '900px', '高度应同步更新');
  // 模拟 visualViewport 自己触发（软键盘）
  h.win.visualViewport.height = 520;
  for (const fn of (h.vvListeners.resize || [])) fn();
  assert.equal(calls, 2);
  assert.equal(h.html.style['--app-h'], '520px');
});

test('旧内核（无 PointerEvent）：装上兜底并翻译 touch → pointer', () => {
  const h = makeHarness({ pointerEvents: false, touch: true });
  const H5 = load(h);
  H5.setup();
  assert.equal(H5.hasPointerEvent, false);
  assert.ok(h.html.classList.contains('no-pointer-event'), '应标记 no-pointer-event');
  assert.equal(typeof h.win.PointerEvent, 'function', '应补上 PointerEvent');

  const target = h.card;
  const touches = [{ clientX: 12, clientY: 34, screenX: 12, screenY: 34, identifier: 7 }];
  const ev = { changedTouches: touches, touches, target, preventDefault() {} };
  // touchstart → 在目标元素上派发 pointerdown
  for (const fn of (h.docListeners.touchstart || [])) fn(ev);
  assert.equal(target.dispatched.length, 1, '应在原目标上派发 pointerdown');
  const down = target.dispatched[0];
  assert.equal(down.type, 'pointerdown');
  assert.equal(down.pointerType, 'touch');
  assert.equal(down.clientX, 12);
  assert.equal(down.clientY, 34);
  assert.equal(down.buttons, 1);
  assert.equal(down.bubbles, true, '必须冒泡，否则 board 上的委托监听收不到');

  // touchmove / touchend → 在 window 上派发（游戏把 move/up 挂在 window）
  const winDispatched = [];
  h.win.dispatchEvent = (e) => { winDispatched.push(e); return true; };
  for (const fn of (h.docListeners.touchmove || [])) fn(ev);
  for (const fn of (h.docListeners.touchend || [])) fn(ev);
  assert.deepEqual(winDispatched.map((e) => e.type), ['pointermove', 'pointerup']);
  assert.equal(winDispatched[1].buttons, 0, '抬起时 buttons 应为 0');
});

test('原生支持 PointerEvent 时不装兜底（避免重复派发）', () => {
  const h = makeHarness({ pointerEvents: true });
  const H5 = load(h);
  H5.setup();
  assert.equal(h.docListeners.touchstart, undefined, '不应注册 touchstart 兜底');
});

test('debugInfo 给出视口/布局体检数据', () => {
  const h = makeHarness();
  const H5 = load(h);
  H5.setup();
  const dom = { table: h.table, board: h.board, popup: h.popup };
  const info = H5.debugInfo(dom, { cards: [1, 2, 3, 4] });
  assert.equal(info.vw, 390);
  assert.equal(info.vh, 844);
  assert.equal(info.appH, 40, 'app 高度取自 getBoundingClientRect');
  assert.equal(info.overflowX, 0);
  assert.equal(info.boardFits, true);
  assert.equal(info.cardW, 20);
  assert.equal(info.isTouch, true);
});

test('长按菜单 / 捏合手势被拦下，且不影响其它监听', () => {
  const h = makeHarness();
  const H5 = load(h);
  H5.setup();
  assert.ok((h.docListeners.contextmenu || []).length >= 1, '应拦截 contextmenu');
  assert.ok((h.docListeners.gesturestart || []).length >= 1, '应拦截 iOS 捏合手势');
  let prevented = 0;
  const fake = { target: h.card, preventDefault() { prevented++; } };
  for (const fn of h.docListeners.gesturestart) fn(fake);
  assert.equal(prevented, 1);
});

test('极老内核（无 Web Animations API）：补上无动画兜底，直接落到最后一帧', () => {
  const h = makeHarness({ webAnimations: false });
  const H5 = load(h);
  H5.setup();
  assert.equal(H5.animationShimmed, true, '应安装动画兜底');

  const el = new h.win.Element();
  const anim = el.animate([
    { transform: 'scale(.3)', opacity: 0 },
    { transform: 'scale(1)', opacity: 1 },
  ], { duration: 400 });
  assert.equal(el.style.transform, 'scale(1)', '应直接应用最后一帧');
  assert.equal(el.style.opacity, 1);
  let resolved = false;
  anim.finished.then(() => { resolved = true; });
  assert.ok(anim.finished instanceof Promise, 'finished 必须是 Promise，否则 await 会崩');
  return Promise.resolve().then(() => assert.equal(resolved, true));
});

test('支持 WAAPI 的内核不会被动兜底覆盖', () => {
  const h = makeHarness({ webAnimations: true });
  const H5 = load(h);
  H5.setup();
  assert.equal(H5.animationShimmed, false);
  const el = new h.win.Element();
  const ret = el.animate([{ opacity: 0 }], { duration: 10 });
  assert.ok(ret && ret.finished, '应使用原生实现');
  assert.equal(el.style.opacity, undefined, '原生实现不应写内联样式');
});

/* ---------- 微信 / PWA / 分享 / 姿态 ---------- */

const WX_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.40(0x18002832) NetType/WIFI Language/zh_CN';

testAsync('微信内：识别出来、桥就绪后解锁音频并预热音频通道', () => {
  const h = makeHarness({ ua: WX_UA });
  const unlocks = [];
  h.win.G24 = { Sfx: { unlock: () => unlocks.push(1) } };
  const H5 = load(h);
  H5.setup();
  assert.equal(H5.isWeChat, true, '应识别出微信');
  assert.ok(h.html.classList.contains('is-wechat'));
  const readyHandlers = h.docListeners.WeixinJSBridgeReady || [];
  assert.equal(readyHandlers.length, 1, '没有桥时应挂上 WeixinJSBridgeReady 监听');

  h.win.WeixinJSBridge = h.bridge;      // 微信注入桥之后才触发 ready 事件
  readyHandlers[0]();
  assert.equal(H5.weixinReady, true);
  assert.equal(unlocks.length, 1, '桥就绪后应解锁音频');
  assert.deepEqual(h.invokeCalls, ['getNetworkType'], '应用空调用预热音频通道（微信首音常被吞）');
});

testAsync('微信桥已存在时立刻解锁，不依赖事件', () => {
  const h = makeHarness({ ua: WX_UA, weixinBridge: true });
  const unlocks = [];
  h.win.G24 = { Sfx: { unlock: () => unlocks.push(1) } };
  const H5 = load(h);
  H5.setup();
  assert.equal(H5.weixinReady, true);
  assert.equal(unlocks.length, 1);
  assert.deepEqual(h.invokeCalls, ['getNetworkType']);
});

testAsync('onWeixinReady：未就绪时排队，就绪后立刻执行', () => {
  const h = makeHarness({ ua: WX_UA });
  const H5 = load(h);
  H5.setup();
  const fired = [];
  H5.onWeixinReady(() => fired.push('queued'));
  (h.docListeners.WeixinJSBridgeReady || [])[0]();
  assert.deepEqual(fired, ['queued']);
  H5.onWeixinReady(() => fired.push('now'));
  assert.deepEqual(fired, ['queued', 'now']);
});

test('?wx=1 可以在桌面浏览器上模拟微信环境（自动化测试用）', () => {
  const h = makeHarness({ search: '?wx=1', ua: 'Mozilla/5.0 (Macintosh) Chrome/120 Safari/537.36' });
  const H5 = load(h);
  H5.setup();
  assert.equal(H5.isWeChat, true);
  const h2 = makeHarness({ search: '?wx=0', ua: WX_UA });
  const H52 = load(h2);
  H52.setup();
  assert.equal(H52.isWeChat, false, '?wx=0 应强制关掉');
});

testAsync('非微信环境：页面 meta 与分享策略走系统分享', async () => {
  let shared = null;
  const h = makeHarness({ share: async (d) => { shared = d; } });
  const H5 = load(h);
  H5.setup();
  const r = await H5.share({ title: '24Game', text: '试试', url: 'https://x/y' });
  assert.equal(r.via, 'share');
  assert.equal(shared.title, '24Game');
});

testAsync('没有系统分享时退回剪贴板复制', async () => {
  let copied = null;
  const h = makeHarness({ clipboard: { writeText: async (t) => { copied = t; } } });
  const H5 = load(h);
  H5.setup();
  const r = await H5.share({ title: 't', text: 'x', url: 'https://x/y' });
  assert.equal(r.via, 'clipboard');
  assert.equal(copied, 'https://x/y');
});

testAsync('微信内不做系统分享，改为引导点右上角', async () => {
  const h = makeHarness({ ua: WX_UA, share: async () => { throw new Error('微信里不该调系统分享'); } });
  const H5 = load(h);
  H5.setup();
  const r = await H5.share({ title: 't' });
  assert.equal(r.via, 'guide');
});

testAsync('用户取消系统分享不会当成失败', async () => {
  const err = new Error('abort');
  err.name = 'AbortError';
  const h = makeHarness({ share: async () => { throw err; } });
  const H5 = load(h);
  H5.setup();
  const r = await H5.share({ title: 't' });
  assert.equal(r.via, 'cancel');
});

test('横屏姿态判断：矮视口才算“憋屈”', () => {
  const h = makeHarness();
  const H5 = load(h);
  H5.setup();
  h.win.innerWidth = 844; h.win.innerHeight = 390;
  h.win.visualViewport.height = 390;
  h.win.matchMedia = (q) => ({ matches: q.includes('landscape'), addEventListener() {}, addListener() {} });
  assert.equal(H5.orientation(), 'landscape');
  assert.equal(H5.isCrampedLandscape(), true, '触摸 + 横屏 + 视口 390 高 → 应提示转竖屏');

  h.win.visualViewport.height = 700;
  assert.equal(H5.isCrampedLandscape(), false, '横屏但空间够就不打扰用户');

  h.win.matchMedia = (q) => ({ matches: false, addEventListener() {}, addListener() {} });
  h.win.innerWidth = 390; h.win.innerHeight = 844;
  assert.equal(H5.orientation(), 'portrait');
  assert.equal(H5.isCrampedLandscape(), false, '竖屏不该提示');
});

test('从后台切回来：重新量视口并补一次音频解锁（iOS/微信会挂起音频）', () => {
  const h = makeHarness();
  const unlocks = [];
  h.win.G24 = { Sfx: { unlock: () => unlocks.push(1) } };
  const H5 = load(h);
  H5.setup();
  const handlers = h.docListeners.visibilitychange || [];
  assert.ok(handlers.length >= 1, '应监听 visibilitychange');
  h.document.hidden = true;
  handlers.forEach((fn) => fn());
  assert.equal(unlocks.length, 0, '还在后台时不该动音频');
  h.document.hidden = false;
  handlers.forEach((fn) => fn());
  assert.equal(unlocks.length, 1, '回到前台应重新解锁音频');
  assert.ok(h.html.style['--app-h'], '同时应重新量一次视口高度');
});


testAsync('Service Worker：file:// 或 http 非 localhost 时明确跳过并给出原因', async () => {
  const file = makeHarness({ protocol: 'file:', hostname: '', serviceWorker: { register: async () => ({}) } });
  const H5f = load(file);
  H5f.setup();
  assert.equal(await H5f.registerServiceWorker(), false);
  assert.match(H5f.swError, /http/);

  const insecure = makeHarness({ protocol: 'http:', hostname: 'game.example.com', serviceWorker: { register: async () => ({}) } });
  const H5i = load(insecure);
  H5i.setup();
  assert.equal(await H5i.registerServiceWorker(), false);
  assert.match(H5i.swError, /localhost/);

  const noSw = makeHarness();
  const H5n = load(noSw);
  H5n.setup();
  assert.equal(await H5n.registerServiceWorker(), false);
  assert.match(H5n.swError, /不支持/);
});

testAsync('Service Worker：安全上下文下注册成功并能读取预缓存体检结果', async () => {
  const registered = [];
  const fakeCache = {
    // 真实 Cache.keys() 返回的是 Request 对象（有 .url），这里按其形状造一个
    keys: async () => [
      { url: 'https://game.example.com/index.html' },
      { url: 'https://game.example.com/css/style.css' },
    ],
  };
  const h = makeHarness({
    protocol: 'http:',
    hostname: 'localhost',
    serviceWorker: {
      register: async (url, opts) => { registered.push([url, opts]); return { addEventListener() {} }; },
      controller: null,
    },
  });
  h.win.caches = {
    keys: async () => ['game24-v1.0.0', 'other-app-v2'],
    open: async () => fakeCache,
  };
  const H5 = load(h);
  H5.setup();
  assert.equal(await H5.registerServiceWorker(), true);
  assert.equal(H5.swReady, true);
  assert.equal(registered[0][0], './sw.js');
  assert.equal(registered[0][1].scope, './');

  const info = await H5.inspectCache();
  assert.equal(info.active, 'game24-v1.0.0', '只认自己的缓存前缀');
  assert.equal(info.hasIndex, true, '应确认 index.html 已在缓存里');
  assert.equal(info.count, 2);
});

testAsync('Service Worker 注册失败会把原因记下来（不抛异常打断游戏）', async () => {
  const h = makeHarness({
    protocol: 'https:',
    serviceWorker: { register: async () => { throw new Error('scope 冲突'); } },
  });
  const H5 = load(h);
  H5.setup();
  assert.equal(await H5.registerServiceWorker(), false);
  assert.equal(H5.swReady, false);
  assert.match(H5.swError, /scope 冲突/);
});


await Promise.all(pending);
console.log(`\n全部通过：${pass} 组断言${process.exitCode ? '（有失败）' : ''}\n`);
