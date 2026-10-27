/* =========================================================
   check.cjs —— 小程序版逻辑回归测试
   跑法（在仓库根目录）：
     node miniprogram/test/check.cjs
   覆盖两块最容易出错的地方：
     1. 页面逻辑：发牌 / 吸附判定 / 合成 / 判胜负 / 判死局
     2. WXS 拖拽：setStyle 调用、位移计算、callMethod 参数结构
   这两块用 node 模拟运行时验证，不需要开发者工具。
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

/* =========================================================
   第一部分：页面逻辑
   ========================================================= */

let toast = '';
global.wx = {
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
  vibrateShort: () => {},
  showToast: (o) => { toast = o.title; },
};

let pageOpts = null;
global.Page = (opts) => { pageOpts = opts; };

const G24 = require(path.join(ROOT, 'utils/g24.js'));
require(path.join(ROOT, 'pages/game/game.js'));

if (!pageOpts) throw new Error('Page() 没有被调用');

const page = Object.assign({}, pageOpts);
page.data = JSON.parse(JSON.stringify(pageOpts.data));
page.setData = function (patch) { Object.assign(this.data, patch); };

section('逻辑层加载');
ok(!!G24.Fraction && !!G24.Solver && !!G24.Dealer && !!G24.LEVELS, 'G24 四个模块都挂上了');
ok(G24.Fraction.of(24).eq(new G24.Fraction(24)), 'Fraction 可用');

section('页面初始化');
page.onLoad();
ok(page.data.cards.length === 4, '第一关发出 4 张牌', page.data.cards.length + ' 张');
ok(page.data.cardSize > 0 && page.data.cardSize <= 88, '牌宽计算合理', page.data.cardSize + 'px');
ok(page.data.cards.map((c) => c.disp).join(',') === '1,2,3,4', '第一关牌面是 1,2,3,4');
ok(page.data.status === 'playing', '初始状态 playing');
const xs = page.data.cards.map((c) => c.x);
ok(xs.every((x, i) => i === 0 || x > xs[i - 1]), '四张牌横向排开不重叠');

section('吸附判定');
const dx = page.data.cards[1].x - page.data.cards[0].x;
page.onDrop({ idx: 0, dx, dy: 0 });
ok(!!page.data.pending, '拖到相邻牌上能吸附');
ok(page.data.pending && page.data.pending.from === 0 && page.data.pending.to === 1, '吸附目标是第 2 张牌');
page.setData({ pending: null });
page.onDrop({ idx: 0, dx: 4, dy: 0 });
ok(!page.data.pending, '只挪 4px 不该吸附（防误触）');
page.onDrop({ idx: '0', dx: String(dx), dy: '0' });
ok(!!page.data.pending, 'dataset 传来的字符串参数也能解析');

section('合成');
page.applyOp({ currentTarget: { dataset: { key: '*' } } });
ok(page.data.cards.length === 3, '合成后剩 3 张牌', page.data.cards.length + ' 张');
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
ok(page.data.cards.map((c) => c.disp).join(',') === '6,4', '牌面 6,4', page.data.cards.map((c) => c.disp).join(','));
ok(dragTo(0), '6 拖到 4 能吸附');
page.applyOp({ currentTarget: { dataset: { key: '*' } } });
ok(page.data.cards.length === 1, '只剩一张牌');
ok(page.data.status === 'win', '6 × 4 = 24 判定通关', page.data.status);

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
   第二部分：WXS 拖拽
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
  const e = { instance: env.el, touches: [{ clientX: 100, clientY: 200 }], currentTarget: { dataset: { idx: 0 } } };
  drag.start(e, env.owner);
  ok(env.state.sx === 100 && env.state.sy === 200, 'start 记下起始坐标');
  ok(env.state.moved === false, 'start 重置 moved');
  ok(env.styles[0] && env.styles[0].transition === 'none', 'start 关掉过渡');
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
  ok(env.calls.length === 1, 'end 调了一次 callMethod');
  ok(env.calls[0].name === 'onDrop', '调的是 onDrop');
  const args = env.calls[0].args;
  ok(args && typeof args === 'object' && !Array.isArray(args), 'callMethod 只传一个参数对象');
  ok(args.idx === 2 && args.dx === 40 && args.dy === 10, '参数里 idx/dx/dy 都对', JSON.stringify(args));
  ok(env.styles[env.styles.length - 1].transform === 'translate(0px, 0px)', 'end 把 transform 归零');
  ok(env.state.sx === undefined, 'end 清掉起始坐标');
}

{
  const env = makeEnv();
  drag.start({ instance: env.el, touches: [{ clientX: 100, clientY: 200 }], currentTarget: { dataset: { idx: 0 } } }, env.owner);
  drag.end({ instance: env.el, changedTouches: [{ clientX: 100, clientY: 200 }], currentTarget: { dataset: { idx: 0 } } }, env.owner);
  ok(env.calls.length === 0, '纯点击（没移动）不触发 onDrop');
}

{
  const env = makeEnv();
  drag.start({ touches: [{ clientX: 10, clientY: 10 }], currentTarget: { dataset: { idx: 1 } } }, env.owner);
  ok(env.state.sx === 10, 'event.instance 缺失时靠 selectComponent 兜底');
}

console.log('\n' + (fails.length ? '有失败：' + fails.join(' / ') : '全部通过') + `（${pass} 组断言）\n`);
process.exit(fails.length ? 1 : 0);
