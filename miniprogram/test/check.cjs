/* =========================================================
   check.cjs —— 小程序版逻辑回归测试
   跑法（在仓库根目录）：
     node miniprogram/test/check.cjs
   覆盖四块最容易出错的地方：
     1. 进度存储：只前进不后退
     2. 关卡地图：300 关解锁状态、档位统计
     3. 游戏页：发牌 / 吸附 / 合成 / 判胜负 / 关卡参数
     4. WXS 拖拽：setStyle 调用、位移、callMethod 参数结构
   全部用 node 模拟运行时验证，不需要开发者工具。
   ========================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let pass = 0;
const fails = [];
function ok(cond, name, extra) {
  if (cond) {
    pass++;
    console.log('  \u2713 ' + name);
  } else {
    fails.push(name);
    console.log('  \u2717 ' + name + (extra ? '  \u2192 ' + extra : ''));
  }
}
function section(title) {
  console.log('\n' + title);
}

/* ---------- 模拟小程序运行时 ---------- */

const store = {};
let lastPage = null;
let toast = '';
let navTo = '';

global.wx = {
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
  getStorageSync: (k) => (k in store ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v; },
  vibrateShort: () => {},
  showToast: (o) => { toast = o.title; },
  navigateTo: (o) => { navTo = o.url; },
  navigateBack: () => {},
  redirectTo: () => {},
};
global.Page = (opts) => { lastPage = opts; };

/** 每次重新执行页面模块，拿到干净的 Page 配置 */
function loadPage(file) {
  const p = require.resolve(path.join(ROOT, file));
  delete require.cache[p];
  lastPage = null;
  require(p);
  if (!lastPage) throw new Error(file + ' 没有调用 Page()');
  const inst = Object.assign({}, lastPage);
  inst.data = JSON.parse(JSON.stringify(lastPage.data));
  inst.setData = function (patch) { Object.assign(this.data, patch); };
  return inst;
}

const G24 = require(path.join(ROOT, 'utils/g24.js'));
const Progress = require(path.join(ROOT, 'utils/progress.js'));
const Sfx = require(path.join(ROOT, 'utils/sfx.js'));
const Fx = require(path.join(ROOT, 'utils/fx.js'));

/* =========================================================
   1. 进度存储
   ========================================================= */
section('进度存储');
Progress.reset();
ok(Progress.load().cleared === 0, '新玩家从 0 开始');
Progress.markCleared(0);
ok(Progress.load().cleared === 1, '通关第 1 关后进度到 1');
Progress.markCleared(0);
ok(Progress.load().cleared === 1, '重复通关同一关不会重复加分');
Progress.markCleared(5);
ok(Progress.load().cleared === 6, '跳到第 6 关通关后进度到 6');
Progress.markCleared(2);
ok(Progress.load().cleared === 6, '回头通关旧关卡不会把进度打回去');

/* =========================================================
   2. 关卡地图
   ========================================================= */
section('关卡地图');

Progress.reset();
let lvPage = loadPage('pages/levels/levels.js');
lvPage.onLoad();
ok(lvPage.data.tiers.length === 15, '15 个档位', lvPage.data.tiers.length);
ok(lvPage.data.total === 300, '总关卡数 300', lvPage.data.total);
ok(lvPage.data.tiers.every((t) => t.levels.length === 20), '每档 20 关');
ok(lvPage.data.tiers[0].levels[0].state === 'current', '新玩家第 1 关是「当前关」');
ok(lvPage.data.tiers[0].levels[1].state === 'lock', '第 2 关未解锁');
ok(lvPage.data.tiers[14].levels[19].state === 'lock', '最后一关未解锁');
ok(lvPage.data.pct === 0, '进度百分比为 0');

// 打通前 25 关
Progress.reset();
for (let i = 0; i < 25; i++) Progress.markCleared(i);
lvPage = loadPage('pages/levels/levels.js');
lvPage.onLoad();
ok(lvPage.data.cleared === 25, '进度读到 25');
ok(lvPage.data.pct === 8, '25/300 四舍五入为 8%', lvPage.data.pct + '%');
ok(lvPage.data.tiers[0].done === 20, '第 1 档 20 关全通');
ok(lvPage.data.tiers[1].done === 5, '第 2 档通了 5 关', lvPage.data.tiers[1].done);
ok(lvPage.data.tiers[1].levels[4].state === 'done', '第 25 关标记为已通关');
ok(lvPage.data.tiers[1].levels[5].state === 'current', '第 26 关是当前关');
ok(lvPage.data.tiers[1].levels[6].state === 'lock', '第 27 关仍锁定');

// 点锁定关要拦住
toast = '';
lvPage.pick({ currentTarget: { dataset: { gi: 100, state: 'lock' } } });
ok(toast === '先过前面的关卡', '点锁定关卡给出提示', toast);
ok(navTo === '', '锁定关卡不会跳转');

// 点当前关要能进
navTo = '';
lvPage.pick({ currentTarget: { dataset: { gi: 25, state: 'current' } } });
ok(navTo === '/pages/game/game?level=25', '点可玩关卡跳到对应关', navTo);

// 全部通关
Progress.reset();
for (let i = 0; i < 300; i++) Progress.markCleared(i);
lvPage = loadPage('pages/levels/levels.js');
lvPage.onLoad();
ok(lvPage.data.cleared === 300 && lvPage.data.pct === 100, '全通关时进度 100%');
ok(lvPage.data.tiers[14].levels[19].state === 'done', '最后一关变成已通关');
ok(lvPage.data.tiers.every((t) => t.done === 20), '所有档位都满格');

/* =========================================================
   3. 游戏页
   ========================================================= */
section('游戏页');

Progress.reset();
const page = loadPage('pages/game/game.js');
page.onLoad({ level: '0' });
ok(page.data.cards.length === 4, '发出 4 张牌');
ok(page.data.cards.map((c) => c.disp).join(',') === '1,2,3,4', '第 1 关牌面 1,2,3,4');
ok(page.data.tierName === '幼儿园', '档位名带出来了', page.data.tierName);
ok(page.data.isLast === false, '第 1 关不是最后一关');
ok(page.data.status === 'playing', '初始状态 playing');
const xs = page.data.cards.map((c) => c.x);
ok(xs.every((x, i) => i === 0 || x > xs[i - 1]), '四张牌横向排开不重叠');

section('关卡参数');
page.loadLevel(25);
ok(page.levelIndex === 25, '能跳到第 26 关');
ok(page.data.tierName === '小学生', '第 26 关属于第 2 档', page.data.tierName);
page.loadLevel(299);
ok(page.data.isLast === true, '最后一关 isLast 为 true');
page.loadLevel(0);

section('吸附判定');
const dx = page.data.cards[1].x - page.data.cards[0].x;
page.onDrop({ idx: 0, dx, dy: 0 });
ok(!!page.data.pending, '拖到相邻牌上能吸附');
ok(page.data.pending.from === 0 && page.data.pending.to === 1, '吸附目标是第 2 张牌');
page.setData({ pending: null });
page.onDrop({ idx: 0, dx: 4, dy: 0 });
ok(!page.data.pending, '只挪 4px 不该吸附（防误触）');
page.onDrop({ idx: '0', dx: String(dx), dy: '0' });
ok(!!page.data.pending, 'dataset 传来的字符串参数也能解析');

section('合成与通关');
page.applyOp({ currentTarget: { dataset: { key: '*' } } });
ok(page.data.cards.length === 3, '合成后剩 3 张牌');
ok(page.data.cards.map((c) => c.disp).join(',') === '2,3,4', '牌面 2,3,4（新牌插回原位）', page.data.cards.map((c) => c.disp).join(','));
ok(page.data.expr === '1 × 2 = 2', '算式回显正确', page.data.expr);

function dragTo(srcIdx) {
  const cards = page.data.cards;
  const target = srcIdx === 0 ? 1 : 0;
  page.onDrop({ idx: srcIdx, dx: cards[target].x - cards[srcIdx].x, dy: cards[target].y - cards[srcIdx].y });
  return !!page.data.pending;
}
ok(dragTo(0), '2 拖到 3 能吸附');
page.applyOp({ currentTarget: { dataset: { key: '*' } } });
ok(page.data.cards.map((c) => c.disp).join(',') === '6,4', '牌面 6,4');
ok(dragTo(0), '6 拖到 4 能吸附');
page.applyOp({ currentTarget: { dataset: { key: '*' } } });
ok(page.data.cards.length === 1, '只剩一张牌');
ok(page.data.status === 'win', '6 × 4 = 24 判定通关');
ok(Progress.load().cleared === 1, '通关后进度自动前进到 1', Progress.load().cleared);

section('复位与拦截');
page.retry();
ok(page.data.cards.length === 4 && page.data.status === 'playing', '重来能复位');

page.onDrop({ idx: 0, dx, dy: 0 });
toast = '';
page.applyOp({ currentTarget: { dataset: { key: '/' } } });
ok(page.data.cards.length === 4, '非整数中间值被拦下');
ok(toast === '本关只许整数', '给出整数规则提示', toast);

page.setData({ pending: null });
page.retry();
page.cards[1].v = G24.Fraction.of(0);
page.setData({ cards: page.data.cards.map((c, i) => (i === 1 ? Object.assign({}, c, { disp: '0' }) : c)) });
page.onDrop({ idx: 0, dx, dy: 0 });
toast = '';
page.applyOp({ currentTarget: { dataset: { key: '/' } } });
ok(page.data.cards.length === 4, '除零被拦下');
ok(toast === '这一步算不了', '除零给出提示', toast);

section('死局与牌面');
page.loadLevel(0);
page.cards = [
  { id: 'x1', v: G24.Fraction.of(1), disp: '1', x: 0, y: 0 },
  { id: 'x2', v: G24.Fraction.of(1), disp: '1', x: 0, y: 0 },
];
page.judge(page.cards);
ok(page.data.dead === true, '1 和 1 凑不出 24，判定死局');
const frac = G24.Fraction.of(8).div(G24.Fraction.of(3));
ok(frac.toDisplay() === '8/3', '分数牌面展示为 8/3');
ok(frac.toDisplay().length > 2, '分数会切小字号（阈值 3 字符）');

/* =========================================================
   4. 音效：拿不到 WebAudio 上下文时必须静默降级
   ========================================================= */
section('音效降级');
// 测试环境没有 wx.createWebAudioContext，等同于基础库 < 2.19.0
const ctxOrNull = Sfx.init();
ok(ctxOrNull === null, '没有 WebAudio 时 init 返回 null');
ok(Sfx.enabled === false, '自动关掉音效，不抛异常');
let sfxCrashed = false;
try {
  Sfx.pickup();
  Sfx.merge();
  Sfx.win();
  Sfx.deal();
  Sfx.invalid();
  Sfx.unlock();
  Sfx.setEnabled(true);
} catch (e) {
  sfxCrashed = true;
}
ok(!sfxCrashed, '所有音效方法在降级状态下调用都不崩');

/* =========================================================
   5. 粒子系统：canvas 驱动
   ========================================================= */
section('粒子系统');

function makeCanvasEnv() {
  const ops = [];
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key === 'canvas') return null;
      return (typeof key === 'string' && key.startsWith('_')) ? undefined : (...args) => { ops.push(key); };
    },
    set() { return true; },
  });
  const canvas = { requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} };
  return { ctx, canvas, ops };
}

{
  const env = makeCanvasEnv();
  ok(Fx.ready() === false, 'attach 之前不工作');
  Fx.burst(10, 10, { count: 5 });
  ok(Fx.parts.length === 0, 'attach 之前的调用被安全忽略');

  Fx.attach(env.canvas, env.ctx, 375, 812);
  ok(Fx.ready() === true, 'attach 之后就绪');

  Fx.burst(100, 100, { count: 10 });
  ok(Fx.parts.length === 10, 'burst 生成 10 个粒子', Fx.parts.length);
  ok(Fx.parts.every((p) => p.kind === 'dot'), 'burst 生成的是 dot 粒子');
  ok(Fx.running === true, '有粒子时循环自动启动');

  Fx.ring(50, 50, { size: 60 });
  ok(Fx.parts.length === 11 && Fx.parts[10].kind === 'ring', 'ring 追加一个光环粒子');

  Fx.floatText(80, 80, '1 + 2 = 3');
  const txt = Fx.parts[Fx.parts.length - 1];
  ok(txt.kind === 'text' && txt.text === '1 + 2 = 3', 'floatText 带上了算式文本');

  Fx.stamp(80, 80, '24');
  ok(Fx.parts[Fx.parts.length - 1].kind === 'stamp', 'stamp 生成盖章粒子');

  // 画一帧，确认不报错
  let drawCrashed = false;
  try { Fx._loop(); } catch (e) { drawCrashed = true; }
  ok(!drawCrashed, '渲染一帧不报错');
  ok(env.ops.includes('clearRect'), '每帧先清空画布');
}

{
  // 粒子过期后必须被回收，循环要能停下来
  const env = makeCanvasEnv();
  Fx.clear();
  Fx.attach(env.canvas, env.ctx, 375, 812);
  Fx.burst(10, 10, { count: 3 });
  ok(Fx.parts.length === 3, '重新生成 3 个粒子');
  Fx.parts.forEach((p) => { p.life = -1; });
  Fx._loop();
  ok(Fx.parts.length === 0, '寿命耗尽的粒子被回收');
  ok(Fx.running === false, '粒子清空后循环自动停止（不白耗电）');
}

{
  // 彩带的延迟要算进总时长，否则动画会从半路开始
  const env = makeCanvasEnv();
  Fx.clear();
  Fx.attach(env.canvas, env.ctx, 375, 812);
  Fx.confetti({ count: 6 });
  ok(Fx.parts.length === 6, 'confetti 生成 6 条彩带');
  const c = Fx.parts[0];
  ok(c.kind === 'confetti', '类型正确');
  ok(Math.abs(c.max - (c.dur + c.delay)) < 1e-9, '总时长 = 下落时长 + 延迟', c.max + ' vs ' + (c.dur + c.delay));
  ok(c.y0 < 0, '彩带从屏幕上方开始');

  // 延迟没走完时不该画
  const before = env.ops.length;
  Fx._loop();
  ok(Fx.parts.length === 6, '第一帧彩带都还在（延迟中）');
}

/* =========================================================
   6. WXS 拖拽
   ========================================================= */
section('WXS 拖拽');

const wxsSrc = fs.readFileSync(path.join(ROOT, 'wxs/drag.wxs'), 'utf8');
const wxsMod = { exports: {} };
new Function('module', 'exports', wxsSrc)(wxsMod, wxsMod.exports);
const drag = wxsMod.exports;

function makeEnv() {
  const state = {};
  const styles = [];
  const calls = [];
  const el = { getState: () => state, setStyle: (o) => styles.push(o) };
  const owner = {
    selectComponent: () => el,
    callMethod: (name, args) => calls.push({ name, args }),
  };
  return { state, styles, calls, el, owner };
}

{
  const env = makeEnv();
  drag.start({ instance: env.el, touches: [{ clientX: 100, clientY: 200 }], currentTarget: { dataset: { idx: 0 } } }, env.owner);
  ok(env.state.sx === 100 && env.state.sy === 200, 'start 记下起始坐标');
  ok(env.state.moved === false, 'start 重置 moved');
  ok(env.styles[0] && env.styles[0].transition === 'none', 'start 关掉过渡');
  ok(env.calls.length === 1 && env.calls[0].name === 'onGrab', 'start 通知逻辑层播拿起音');
}

{
  const env = makeEnv();
  drag.start({ instance: env.el, touches: [{ clientX: 100, clientY: 200 }], currentTarget: { dataset: { idx: 0 } } }, env.owner);
  drag.move({ instance: env.el, touches: [{ clientX: 150, clientY: 220 }], currentTarget: { dataset: { idx: 0 } } }, env.owner);
  const last = env.styles[env.styles.length - 1];
  ok(last.transform === 'translate(50px, 20px)', 'move 算出正确位移', last.transform);
  ok(env.state.moved === true, 'move 标记已拖动');
}

{
  const env = makeEnv();
  drag.start({ instance: env.el, touches: [{ clientX: 100, clientY: 200 }], currentTarget: { dataset: { idx: 0 } } }, env.owner);
  drag.move({ instance: env.el, touches: [{ clientX: 102, clientY: 200 }], currentTarget: { dataset: { idx: 0 } } }, env.owner);
  ok(env.state.moved === false, '2px 抖动不算拖动');
}

{
  const env = makeEnv();
  drag.start({ instance: env.el, touches: [{ clientX: 100, clientY: 200 }], currentTarget: { dataset: { idx: 2 } } }, env.owner);
  drag.move({ instance: env.el, touches: [{ clientX: 140, clientY: 210 }], currentTarget: { dataset: { idx: 2 } } }, env.owner);
  drag.end({ instance: env.el, changedTouches: [{ clientX: 140, clientY: 210 }], currentTarget: { dataset: { idx: 2 } } }, env.owner);
  const drops = env.calls.filter((c) => c.name === 'onDrop');
  ok(drops.length === 1, 'end 调了一次 onDrop');
  const args = drops[0].args;
  ok(args && typeof args === 'object' && !Array.isArray(args), 'callMethod 只传一个参数对象');
  ok(args.idx === 2 && args.dx === 40 && args.dy === 10, '参数里 idx/dx/dy 都对', JSON.stringify(args));
  ok(env.styles[env.styles.length - 1].transform === 'translate(0px, 0px)', 'end 把 transform 归零');
  ok(env.state.sx === undefined, 'end 清掉起始坐标');
}

{
  const env = makeEnv();
  drag.start({ instance: env.el, touches: [{ clientX: 100, clientY: 200 }], currentTarget: { dataset: { idx: 0 } } }, env.owner);
  drag.end({ instance: env.el, changedTouches: [{ clientX: 100, clientY: 200 }], currentTarget: { dataset: { idx: 0 } } }, env.owner);
  ok(!env.calls.some((c) => c.name === 'onDrop'), '纯点击（没移动）不触发 onDrop');
}

{
  const env = makeEnv();
  drag.start({ touches: [{ clientX: 10, clientY: 10 }], currentTarget: { dataset: { idx: 1 } } }, env.owner);
  ok(env.state.sx === 10, 'event.instance 缺失时靠 selectComponent 兜底');
}

console.log('\n' + (fails.length ? '有失败：' + fails.join(' / ') : '全部通过') + `（${pass} 组断言）\n`);
process.exit(fails.length ? 1 : 0);
