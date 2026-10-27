/* =========================================================
   input-check.mjs —— 用真实鼠标输入（CDP Input.dispatchMouseEvent）跑一遍核心交互
   为什么单独有这一个：tools/selfcheck.mjs 用 --dump-dom + 虚拟时间，
   合成出来的 PointerEvent 不会真的移动光标，也就不会触发浏览器自己的命中测试；
   曾经因此漏掉一个致命 bug——被拖的牌跟着指针走，命中测试永远命中自己，
   松手永远找不到目标牌，圆环根本弹不出来（而合成事件下却是“通过”的）。
   这里走 Chrome DevTools Protocol 发**真的**鼠标事件，命中测试/指针捕获/点击
   全都走浏览器真实路径。
   CLI： node tools/input-check.mjs [--keep]
   ========================================================= */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const CHROME = process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
const failures = [];

function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { failures.push(label); console.log(`  ✗ ${label}`); }
}
function eq(actual, expected, label) {
  ok(JSON.stringify(actual) === JSON.stringify(expected), `${label}（实际 ${JSON.stringify(actual)}）`);
}

/* ---------------- 起一个带调试端口的 Chrome ---------------- */

async function launch(query, extraFlags = []) {
  const port = 9400 + Math.floor(Math.random() * 200);
  const url = `file://${path.join(root, 'index.html')}${query}`;
  const child = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
    '--disable-crash-reporter', '--no-first-run', '--hide-scrollbars',
    '--window-size=500,900',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(root, '.shots', 'input-' + port)}`,
    ...extraFlags,
    url,
  ], { stdio: 'ignore' });

  // 必须挑到“我们这一次打开的那个页面”：同一个浏览器里可能还有别的 page target
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(200);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      target = pages.find((t) => (t.url || '').includes(query)) || (pages.length === 1 ? pages[0] : null);
    } catch { /* 端口还没开 */ }
  }
  if (!target) { child.kill('SIGKILL'); throw new Error('连不上 Chrome 调试端口'); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true });
    ws.addEventListener('error', j, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++seq;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' :: ' + expr);
    return r.result.result.value;
  };
  await send('Runtime.enable');
  await sleep(400);

  const api = {
    evalJs,
    async mouse(type, x, y, button = 'none') {
      await send('Input.dispatchMouseEvent', {
        type, x, y, button, pointerType: 'mouse',
        buttons: button === 'left' ? (type === 'mouseReleased' ? 0 : 1) : 0,
        clickCount: button === 'left' ? 1 : 0,
      });
    },
    async tap(x, y) {
      await api.mouse('mouseMoved', x, y);
      await api.mouse('mousePressed', x, y, 'left');
      await api.mouse('mouseReleased', x, y, 'left');
    },
    async touch(type, x, y) {
      await send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1, id: 1 }],
      });
    },
    /** 真实触摸拖拽：手指位置与“画出来的牌”是错开的（牌被抬高 34px），最容易测出落点算错 */
    async dragTouch(from, to, steps = 8, hold = 30) {
      await api.touch('touchStart', from.x, from.y);
      for (let s = 1; s <= steps; s++) {
        await api.touch('touchMove',
          from.x + (to.x - from.x) * s / steps,
          from.y + (to.y - from.y) * s / steps);
        await sleep(hold);
      }
      await api.touch('touchEnd', to.x, to.y);
    },
    /** 真实拖拽：按下 → 分步移动（每步都会触发浏览器命中测试）→ 松手 */
    async drag(from, to, steps = 8, hold = 30) {
      await api.mouse('mouseMoved', from.x, from.y);
      await api.mouse('mousePressed', from.x, from.y, 'left');
      for (let s = 1; s <= steps; s++) {
        await api.mouse('mouseMoved',
          from.x + (to.x - from.x) * s / steps,
          from.y + (to.y - from.y) * s / steps, 'left');
        await sleep(hold);
      }
      await api.mouse('mouseReleased', to.x, to.y, 'left');
    },
    /** 跳到某个地址（不带参数即回到首页），用来验证存档恢复 */
    async goto(target) {
      await send('Page.navigate', { url: target || url });
      await sleep(1100);
    },
    close() {
      try { ws.close(); } catch { /* 已断开 */ }
      try { child.kill('SIGKILL'); } catch { /* 已退出 */ }
    },
  };
  return api;
}

const CENTERS = `[...document.querySelectorAll('.card')].map((el) => {
  const r = el.getBoundingClientRect();
  return { value: el.dataset.value, x: r.left + r.width / 2, y: r.top + r.height / 2 };
})`;
const RING_STATE = `(() => {
  const ring = document.getElementById('opRing');
  const items = [...ring.querySelectorAll('.op-ring__item')];
  return {
    open: !!(window.G24 && G24.app.popup.open),
    hidden: ring.hidden,
    isOpen: ring.classList.contains('is-open'),
    scrimOpacity: Number(getComputedStyle(ring.querySelector('.op-ring__scrim')).opacity),
    hubX: parseFloat(document.getElementById('ringHub').style.getPropertyValue('--x')) || 0,
    hubY: parseFloat(document.getElementById('ringHub').style.getPropertyValue('--y')) || 0,
    // 圆环是“按打开那一刻两张待合成牌的中点”定位的：这里取同一时刻的 rect
    pending: [...document.querySelectorAll('.card.is-pending')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }),
    items: items.map((b) => {
      const cs = getComputedStyle(b);
      const m = new DOMMatrixReadOnly(cs.transform);
      return { op: b.dataset.op, opacity: Number(cs.opacity), x: m.m41, y: m.m42, disabled: b.disabled };
    }),
  };
})()`;
const CARDS = `[...document.querySelectorAll('.card')].map((el) => el.dataset.value)`;

/* =========================================================
   场景 1：真实鼠标拖拽 → 圆环弹出（这就是之前坏掉的那条路径）
   ========================================================= */
console.log('\n真实输入自检');

{
  const api = await launch('?deal=7,5,6,2');
  const cards = await api.evalJs(CENTERS);
  eq(cards.map((c) => c.value), ['7', '5', '6', '2'], '开局四张牌');

  // 拖到一半先看“落点高亮”
  await api.mouse('mouseMoved', cards[0].x, cards[0].y);
  await api.mouse('mousePressed', cards[0].x, cards[0].y, 'left');
  for (let s = 1; s <= 6; s++) {
    await api.mouse('mouseMoved',
      cards[0].x + (cards[1].x - cards[0].x) * s / 6,
      cards[0].y + (cards[1].y - cards[0].y) * s / 6, 'left');
    await sleep(30);
  }
  const midDrag = await api.evalJs(`({
    targets: [...document.querySelectorAll('.card.is-target')].map((c) => c.dataset.value),
    dragging: [...document.querySelectorAll('.card.is-dragging')].length,
    hitPointerEvents: getComputedStyle(document.querySelector('.card.is-dragging') || document.body).pointerEvents,
  })`);
  eq(midDrag.targets, ['5'], '拖到一半：目标牌亮起（落点提示）');
  eq(midDrag.dragging, 1, '被拖的牌有 is-dragging');
  eq(midDrag.hitPointerEvents, 'none', '被拖的牌必须不吃指针事件，否则命中测试永远命中自己');

  await api.mouse('mouseReleased', cards[1].x, cards[1].y, 'left');
  await sleep(700);

  const ring = await api.evalJs(RING_STATE);
  ok(ring.open, '松手后弹窗状态为打开');
  ok(!ring.hidden && ring.isOpen, '圆环已显示并进入 is-open');
  ok(ring.scrimOpacity > 0.9, `遮罩应淡入（opacity ${ring.scrimOpacity}）`);
  eq(ring.items.length, 4, '圆环上有 4 个符号');
  ok(ring.items.every((it) => it.opacity > 0.9), '四个符号都已展开（opacity=1）');
  ok(ring.items.every((it) => Math.hypot(it.x, it.y) > 40),
    `四个符号应飞到各自的方位（位移 ${ring.items.map((i) => Math.round(Math.hypot(i.x, i.y))).join('/')}px）`);
  // 圆心应落在两张牌的中点：以“圆环打开那一刻”的待合成牌为准
  //（松手瞬间牌还带着拖动位移/待合成缩放，和松手前的坐标可能差十几像素，不能拿旧坐标比）
  eq(ring.pending.length, 2, '圆环打开时正好两张牌是待合成态');
  const midX = (ring.pending[0].x + ring.pending[1].x) / 2;
  const midY = (ring.pending[0].y + ring.pending[1].y) / 2;
  ok(Math.abs(ring.hubX - midX) < 3 && Math.abs(ring.hubY - midY) < 3,
    `圆心应在两张待合成牌的中点 (${Math.round(midX)},${Math.round(midY)})，实际 (${Math.round(ring.hubX)},${Math.round(ring.hubY)})`);
  // 再兜一层：圆心必须落在两张牌原始位置附近的区域里，防止“钉在屏幕中心”
  const oldMidX = (cards[0].x + cards[1].x) / 2, oldMidY = (cards[0].y + cards[1].y) / 2;
  ok(Math.abs(ring.hubX - oldMidX) < 40 && Math.abs(ring.hubY - oldMidY) < 40,
    `圆心不该漂到别处（松手前中点 ${Math.round(oldMidX)},${Math.round(oldMidY)}）`);
  eq(await api.evalJs(`[...document.querySelectorAll('.card.is-pending')].length`), 2, '两张参与的牌进入待合成态');

  // 真实点击“×”
  const mulBox = await api.evalJs(`(() => {
    const b = document.querySelector('.op-ring__item[data-op="*"]');
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await api.tap(mulBox.x, mulBox.y);
  await sleep(1400);
  eq(await api.evalJs(CARDS), ['35', '6', '2'], '点乘号后合成出新牌 35');
  const afterMerge = await api.evalJs(`({
    open: G24.app.popup.open,
    hidden: document.getElementById('opRing').hidden,
    moves: G24.app.state.moves,
    chips: document.querySelectorAll('.card__expr').length,
    title: document.querySelector('.card[data-value="35"]')?.getAttribute('title') || '',
    face: document.querySelector('.card[data-value="35"] .card__center')?.textContent || '',
  })`);
  eq(afterMerge.open, false, '合成后圆环关闭');
  ok(afterMerge.hidden, '合成后圆环隐藏');
  eq(afterMerge.moves, 1, '步数 +1');
  eq(afterMerge.chips, 0, '牌面上不该再有算式贴纸');
  eq(afterMerge.face, '35', '牌面只显示点数');
  ok(/×/.test(afterMerge.title), `算式只留在 title（${afterMerge.title}）`);

  api.close();
}

/* =========================================================
   场景 2：拖到空白处 → 回弹、不弹圆环
   ========================================================= */
{
  const api = await launch('?deal=7,5,6,2');
  const cards = await api.evalJs(CENTERS);
  const table = await api.evalJs(`(() => { const r = document.querySelector('.board').getBoundingClientRect(); return { x: r.left - 6, y: r.top - 6 }; })()`);
  await api.drag({ x: cards[0].x, y: cards[0].y }, table);
  await sleep(900);
  const st = await api.evalJs(`({
    open: G24.app.popup.open,
    cards: ${CARDS},
    targets: document.querySelectorAll('.card.is-target').length,
    dragging: document.querySelectorAll('.card.is-dragging').length,
    inline: [...document.querySelectorAll('.card')].map((c) => c.style.transform).join('|'),
  })`);
  eq(st.open, false, '落在空白处不弹圆环');
  eq(st.cards, ['7', '5', '6', '2'], '牌面不变');
  eq(st.targets, 0, '落点高亮已清理');
  eq(st.dragging, 0, '拖拽态已清理');
  ok(/^[|]*$/.test(st.inline || ''), `回弹后不残留 inline transform（${st.inline || '空'}）`);
  api.close();
}

/* =========================================================
   场景 3：依次点两张牌（不拖）也能弹圆环
   ========================================================= */
{
  const api = await launch('?deal=3,3,8,8');
  const cards = await api.evalJs(CENTERS);
  await api.tap(cards[0].x, cards[0].y);
  await sleep(200);
  eq(await api.evalJs(`document.querySelectorAll('.card.is-selected').length`), 1, '第一次点击选中一张牌');
  await api.tap(cards[1].x, cards[1].y);
  await sleep(700);
  const ring = await api.evalJs(RING_STATE);
  ok(ring.open && ring.isOpen, '点第二张牌也能弹圆环');
  eq(ring.items.filter((i) => i.disabled).map((i) => i.op), [], '3 和 8：四个符号都可用（允许分数）');

  // 点“取消”收起，牌回到原位
  const cancel = await api.evalJs(`(() => {
    const b = document.getElementById('ringCancel');
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await api.tap(cancel.x, cancel.y);
  await sleep(600);
  const after = await api.evalJs(`({
    open: G24.app.popup.open,
    hidden: document.getElementById('opRing').hidden,
    pending: document.querySelectorAll('.card.is-pending').length,
    cards: ${CARDS},
  })`);
  eq(after.open, false, '点“取消”后圆环关闭');
  ok(after.hidden, '取消后圆环隐藏');
  eq(after.pending, 0, '两张牌退出待合成态');
  eq(after.cards, ['3', '3', '8', '8'], '取消不改变牌面');
  api.close();
}

/* =========================================================
   场景 4：开了“只出整数”后，会出分数的符号当场禁用（不能点了没反应）
   ========================================================= */
{
  const api = await launch('?deal=3,8,7,5&integerOnly=1');
  const cards = await api.evalJs(CENTERS);
  eq(cards.map((c) => c.value), ['3', '8', '7', '5'], '整数模式下开局四张牌');
  await api.tap(cards[0].x, cards[0].y);
  await sleep(200);
  await api.tap(cards[1].x, cards[1].y);
  await sleep(700);
  const ring = await api.evalJs(RING_STATE);
  ok(ring.open && ring.isOpen, '3 与 8 也能弹圆环');
  eq(ring.items.filter((i) => i.disabled).map((i) => i.op), ['/'], '3÷8 不是整数：只有除号被禁用');
  const plusBox = await api.evalJs(`(() => {
    const b = document.querySelector('.op-ring__item[data-op="+"]');
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await api.tap(plusBox.x, plusBox.y);
  await sleep(1300);
  eq(await api.evalJs(CARDS), ['11', '7', '5'], '加号照常可用：3 + 8 = 11');
  api.close();
}

/* =========================================================
   场景 5：真触摸拖拽（手指在牌下方 34px，命中判定必须按手指算）
   ========================================================= */
{
  const api = await launch('?deal=7,5,6,2', ['--touch-events=enabled']);
  eq(await api.evalJs(`document.documentElement.classList.contains('is-touch')`), true, '页面识别为触摸设备');
  const cards = await api.evalJs(CENTERS);
  await api.touch('touchStart', cards[0].x, cards[0].y);
  for (let s = 1; s <= 6; s++) {
    await api.touch('touchMove', cards[0].x + (cards[1].x - cards[0].x) * s / 6, cards[0].y);
    await sleep(30);
  }
  const lifted = await api.evalJs(`(() => {
    const el = document.querySelector('.card.is-dragging');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, pe: getComputedStyle(el).pointerEvents };
  })()`);
  ok(lifted && Math.abs(lifted.cy - (cards[0].y - 34)) < 8,
    `触摸时牌被抬高 34px 让开手指（牌心 y≈${lifted && Math.round(lifted.cy)}，手指 y=${Math.round(cards[0].y)}）`);
  eq(lifted && lifted.pe, 'none', '触摸拖拽时牌同样不吃指针事件');
  await api.touch('touchEnd', cards[1].x, cards[0].y);
  await sleep(800);
  const ring = await api.evalJs(RING_STATE);
  ok(ring.open && ring.isOpen, '触摸松手也能弹圆环（按手指位置命中，不是按画出来的牌）');
  eq(ring.items.length, 4, '触摸下圆环同样是 4 个符号');
  const mulBox = await api.evalJs(`(() => {
    const b = document.querySelector('.op-ring__item[data-op="-"]');
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await api.touch('touchStart', mulBox.x, mulBox.y);
  await api.touch('touchEnd', mulBox.x, mulBox.y);
  await sleep(1400);
  eq(await api.evalJs(CARDS), ['2', '6', '2'], '触摸点减号：7 − 5 = 2');
  api.close();
}

/* =========================================================
   场景 6：通关面板只给结果（没有算式，牌上也只剩 24）
   ========================================================= */
{
  const api = await launch('?deal=3,8,3,8&demo=win');
  // 面板弹出前后一直盯着“24”飘字：它一秒钟内不能被更高层级的面板盖住
  await api.evalJs(`window.__stamp = [];
    (function poll() {
      const el = document.querySelector('.fx-stamp');
      if (el) {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1),
          Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1));
        window.__stamp.push({ cover: hit ? (hit.className || hit.tagName) + '' : null, op: Number(getComputedStyle(el).opacity) });
      }
      if (window.__stamp.length < 200) setTimeout(poll, 50);
    })();`);
  await sleep(3200);
  const win = await api.evalJs(`(() => {
    const modal = document.getElementById('winModal');
    const card = document.querySelector('.card.is-won');
    const expr = document.querySelector('.card__expr');
    const body = modal.cloneNode(true);
    body.querySelectorAll('.modal__actions').forEach((el) => el.remove());
    return {
      open: !modal.hidden,
      text: (body.textContent || '').replace(/\s+/g, ' ').trim(),
      hasExprNode: !!modal.querySelector('.win-expr'),
      exprChips: document.querySelectorAll('.card__expr').length,
      cardNumber: card ? (card.querySelector('.card__center')?.textContent || '').trim() : '',
    };
  })()`);
  ok(win.open, '通关面板应弹出');
  ok(!win.hasExprNode, '面板里不再有算式容器');
  ok(!/[=÷×+−]/.test(win.text), `面板正文没有算式符号（${win.text}）`);
  ok(/步/.test(win.text), '面板保留成绩（步数）');
  eq(win.cardNumber, '24', '通关那张牌显示 24');
  eq(win.exprChips, 0, '整副牌都没有算式贴纸');

  // “24”动画必须完整：飘字不被面板盖、徽章不被卡片裁
  const stamp = await api.evalJs(`window.__stamp.filter((s) => s.op > 0.05)`);
  ok(stamp.length >= 5, `应采到“24”飘字的可见帧（${stamp.length} 帧）`);
  const covered = stamp.filter((s) => /modal/.test(s.cover || ''));
  eq(covered.length, 0, `飘字不该被面板盖住（被盖 ${covered.length} 帧）`);
  const badge = await api.evalJs(`(() => {
    const b = document.querySelector('.win-badge').getBoundingClientRect();
    const c = document.querySelector('.modal__card--win').getBoundingClientRect();
    const card = document.querySelector('.modal__card--win');
    const above = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(c.top - 8));
    return {
      overhang: Math.round(c.top - b.top),
      overflow: getComputedStyle(card).overflow,
      aboveCls: above ? (above.className || above.tagName) + '' : null,
      badgeText: document.querySelector('.win-badge').textContent.trim(),
    };
  })()`);
  eq(badge.badgeText, '24', '徽章就是 24');
  ok(badge.overhang > 0, `徽章骑在卡片上沿（高出 ${badge.overhang}px）`);
  eq(badge.overflow, 'visible', '卡片不能 overflow:auto，否则会裁掉徽章');
  ok(/win-badge/.test(badge.aboveCls || ''), `徽章上沿要真的画出来（卡片上沿外命中 ${badge.aboveCls}）`);
  api.close();
}

/* =========================================================
   场景 7：闯关 —— 通关面板 → 下一关 → 关卡地图 → 刷新续玩
   ========================================================= */
{
  const api = await launch('?reset=1&level=1&demo=win');
  await sleep(3000);

  const before = await api.evalJs(`({
    level: G24.app.state.level,
    cleared: G24.app.state.cleared,
    chip: document.getElementById('level').textContent,
    tier: document.getElementById('tierName').textContent,
    modal: !document.getElementById('winModal').hidden,
    title: document.getElementById('winTitle').textContent,
    stats: document.getElementById('winStats').textContent,
    next: document.getElementById('winNext').textContent.trim(),
    savedLevel: localStorage.getItem('g24.level'),
    savedCleared: localStorage.getItem('g24.cleared'),
  })`);
  eq(before.level, 1, '演示停在第 1 关');
  eq(before.chip, '1', '记分牌显示第 1 关');
  eq(before.tier, '幼儿园', '记分牌显示档位');
  eq(before.modal, true, '通关面板已弹出');
  eq(before.title, '合成成功！');
  ok(/第1关/.test(before.stats), `面板写清第几关（${before.stats}）`);
  ok(/下一关/.test(before.next), `主按钮是“下一关”（${before.next}）`);
  eq(before.savedCleared, '1', '通关数已存档');
  eq(before.savedLevel, '2', '下一关已存档');

  // 真点“下一关”
  const nextBox = await api.evalJs(`(() => {
    const b = document.getElementById('winNext');
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await api.tap(nextBox.x, nextBox.y);
  await sleep(1900);

  const after = await api.evalJs(`({
    level: G24.app.state.level,
    cards: [...document.querySelectorAll('.card')].map((c) => c.querySelector('.card__center').textContent),
    chip: document.getElementById('level').textContent,
    moves: G24.app.state.moves,
    modal: !document.getElementById('winModal').hidden,
    banner: document.getElementById('banner').hidden ? '' : document.getElementById('bannerText').textContent,
  })`);
  eq(after.level, 2, '点一下进入第 2 关');
  eq(after.chip, '2', '记分牌同步到 2');
  const deal2 = (await api.evalJs(`G24.app.levelDef(2).n.join(',')`));
  eq(after.cards.join(','), deal2, `第 2 关是固定牌面（${deal2}）`);
  eq(after.moves, 0, '步数清零');
  eq(after.modal, false, '通关面板关闭');
  ok(/第 2 关/.test(after.banner), `横幅播报新关卡（${after.banner}）`);

  // 点记分牌上的关卡徽标 → 关卡地图
  const chipBox = await api.evalJs(`(() => {
    const b = document.getElementById('levelBtn');
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await api.tap(chipBox.x, chipBox.y);
  await sleep(600);
  const map = await api.evalJs(`({
    open: !document.getElementById('levelModal').hidden,
    tiers: document.querySelectorAll('.lvm__tab').length,
    pages: document.querySelectorAll('.lvm__page').length,
    progress: document.getElementById('levelProgress').textContent,
    cleared: [...document.querySelectorAll('.lvm__node.is-cleared')].map((n) => n.textContent),
    current: document.querySelector('.lvm__node.is-current')?.textContent,
    locked: document.querySelectorAll('.lvm__node.is-locked').length,
    pageNodes: document.querySelector('.lvm__page')?.querySelectorAll('.lvm__node').length,
    activeTab: document.querySelector('.lvm__tab.is-active')?.querySelector('.lvm__tab-name')?.textContent,
    snap: getComputedStyle(document.getElementById('levelPager')).scrollSnapType,
  })`);
  eq(map.open, true, '点关卡徽标打开地图');
  eq(map.tiers, 15, '15 个档位标签');
  eq(map.pages, 15, '15 档各一页');
  eq(map.progress, '1 / 300', '总进度 1 / 300');
  eq(map.cleared.join(','), '✓', '第 1 关打勾');
  eq(map.current, '2', '第 2 关是当前关');
  eq(map.locked, 298, '其余 298 关还锁着');
  eq(map.pageNodes, 20, '每页 20 关');
  eq(map.activeTab, '幼儿园', '当前档标签高亮');
  ok(/mandatory/.test(map.snap), `滑轨应整页吸附（${map.snap}）`);

  // 点「下一档」：滑轨整页右移，标签同步
  const beforeSwipe = await api.evalJs(`({ left: Math.round(document.getElementById('levelPager').scrollLeft), w: Math.round(document.getElementById('levelPager').clientWidth) })`);
  const nextBox2 = await api.evalJs(`(() => { const b = document.getElementById('levelNext'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await api.tap(nextBox2.x, nextBox2.y);
  await sleep(800);
  const afterSwipe = await api.evalJs(`({
    left: Math.round(document.getElementById('levelPager').scrollLeft),
    w: Math.round(document.getElementById('levelPager').clientWidth),
    activeTab: document.querySelector('.lvm__tab.is-active')?.querySelector('.lvm__tab-name')?.textContent,
    foot: document.getElementById('levelFoot').textContent,
  })`);
  eq(beforeSwipe.left, 0, '打开时停在第 1 档');
  ok(Math.abs(afterSwipe.left - afterSwipe.w) < 4, `点“下一档”后滑轨停在第二页（${afterSwipe.left}/${afterSwipe.w}）`);
  eq(afterSwipe.activeTab, '小学生', '标签跟着切到小学生');
  ok(/第 2 \/ 15 档/.test(afterSwipe.foot), `底部提示同步（${afterSwipe.foot}）`);

  // 点右上角 ✕：关掉地图，但关卡不变
  const closeBox = await api.evalJs(`(() => {
    const b = document.querySelector('.lvm__close');
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) };
  })()`);
  ok(closeBox.w >= 28 && closeBox.h >= 28, `关闭按钮要有 28px 以上的点击区（${closeBox.w}×${closeBox.h}）`);
  await api.tap(closeBox.x, closeBox.y);
  await sleep(600);
  const closed = await api.evalJs(`({
    mapOpen: !document.getElementById('levelModal').hidden,
    level: G24.app.state.level,
  })`);
  eq(closed.mapOpen, false, '点右上角 ✕ 关闭地图');
  eq(closed.level, 2, '关闭不会把关卡打乱');

  // 重新打开，继续测锁着的关
  const chipBox2 = await api.evalJs(`(() => {
    const b = document.getElementById('levelBtn');
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await api.tap(chipBox2.x, chipBox2.y);
  await sleep(700);

  // 点一个还锁着的关（第 5 关）：不该有反应
  const lockedBox = await api.evalJs(`(() => {
    const b = document.querySelector('.lvm__node[data-level="5"]');
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await api.tap(lockedBox.x, lockedBox.y);
  await sleep(900);
  const afterLocked = await api.evalJs(`({
    level: G24.app.state.level,
    mapOpen: !document.getElementById('levelModal').hidden,
  })`);
  eq(afterLocked.level, 2, '锁着的关点不动');
  eq(afterLocked.mapOpen, true, '点锁着的关不会关掉地图');

  // 刷新后接着第 2 关
  const bare = (await api.evalJs('location.href')).split('?')[0];
  await api.goto(bare);
  const resumed = await api.evalJs(`({
    level: G24.app.state.level,
    chip: document.getElementById('level').textContent,
    cards: [...document.querySelectorAll('.card')].map((c) => c.querySelector('.card__center').textContent).join(','),
  })`);
  eq(resumed.level, 2, '刷新后接着第 2 关');
  eq(resumed.chip, '2', '刷新后记分牌仍是 2');
  eq(resumed.cards, deal2, '刷新后还是第 2 关的牌');
  api.close();
}

/* ---------------- 汇总 ---------------- */

console.log(`\n真实输入自检${failures.length ? '未通过' : '全部通过'}（${pass} 组断言）`);
if (failures.length) {
  for (const f of failures) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('');
}
