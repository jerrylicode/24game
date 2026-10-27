/* =========================================================
   game.js —— 24Game 主逻辑
   交互主线：拖动一张牌 → 落到另一张牌上 → 自动弹出运算符面板 →
            选择运算符 → 两牌飞向中点撞击消失 → 新牌弹出 → 其余牌重排
   对外暴露：G24.app（调试用）
   ========================================================= */
(function (global) {
  'use strict';

  const G24 = global.G24 || (global.G24 = {});
  const F = G24.Fraction;
  const Solver = G24.Solver;
  const Dealer = G24.Dealer;
  const Sfx = G24.Sfx;
  const Fx = G24.Fx;
  const H5 = G24.H5 || { setup() {}, isTouch: false, onViewportChange() { return () => {}; } };
  const OP_SYM = Solver.OP_SYM;

  const REDUCED = Fx.REDUCED;
  const SC = REDUCED ? 0.35 : 1;

  /* 动画时间轴（单位 ms）—— 调这里就能整体改节奏 */
  const T = {
    fly: Math.round(300 * SC),      // 两张牌飞向中点
    reflow: Math.round(380 * SC),   // 剩余牌重排（FLIP）
    spawn: Math.round(560 * SC),    // 新牌弹出
    spring: Math.round(440 * SC),   // 拖拽回弹
    stagger: REDUCED ? 0 : 60,      // 发牌错落
  };

  const $ = (id) => document.getElementById(id);
  const dom = {
    table: $('table'),
    board: $('board'),
    banner: $('banner'),
    bannerText: $('bannerText'),
    bannerIcon: $('bannerIcon'),
    bannerAction: $('bannerAction'),
    timer: $('timer'),
    moves: $('moves'),
    level: $('level'),
    tierName: $('tierName'),
    levelBtn: $('levelBtn'),
    levelTabs: $('levelTabs'),
    levelPager: $('levelPager'),
    levelPrev: $('levelPrev'),
    levelNext: $('levelNext'),
    levelFoot: $('levelFoot'),
    levelProgress: $('levelProgress'),
    winTitle: $('winTitle'),
    mapBtn: $('mapBtn'),
    best: $('best'),

    ruleBtn: $('ruleBtn'),
    soundBtn: $('soundBtn'),
    helpBtn: $('helpBtn'),
    undoBtn: $('undoBtn'),
    restartBtn: $('restartBtn'),
    levelModal: $('levelModal'),
    hintBtn: $('hintBtn'),
    solveBtn: $('solveBtn'),
    popup: $('opRing'),
    ringHub: $('ringHub'),
    ringScrim: $('ringScrim'),
    ringCancel: $('ringCancel'),
    shareBtn: $('shareBtn'),
    installBtn: $('installBtn'),
    rotateHint: $('rotateHint'),
    rotateHintOk: $('rotateHintOk'),
    rotateHintNever: $('rotateHintNever'),
    shareGuide: $('shareGuide'),
    shareGuideOk: $('shareGuideOk'),
    answerList: $('answerList'),
    answerNote: $('answerNote'),
    demoBtn: $('demoBtn'),
    diffCap: $('diffCap'),
    winStats: $('winStats'),
    winNext: $('winNext'),
    loseValue: $('loseValue'),
    loseUndo: $('loseUndo'),
    loseRestart: $('loseRestart'),
  };

  const SUITS = ['♠', '♥', '♦', '♣'];
  const isRedSuit = (s) => s === '♥' || s === '♦';
  const LS = {
    get(k, d) { try { const v = global.localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { global.localStorage.setItem(k, v); } catch (e) { /* 忽略隐私模式 */ } },
  };

  let uid = 1;

  const state = {
    cards: [],            // [{ id, v: Fraction, expr, display, suit, el }]
    history: [],          // 每一步合并前的快照
    moves: 0,
    level: 1,            // 当前关卡（1..300）
    cleared: 0,          // 已通关的关卡数（0..300）
    ruleOverride: false, // ?integerOnly= 强制规则时，不被关卡规则覆盖
    integerOnly: false,
    hintLevel: 0,
    selectedId: null,
    busy: false,          // 动画进行中
    finished: false,
    demo: false,
    values: null,         // 本局开局的 4 个数字
    initialDeal: null,
    elapsedMs: 0,
    resumeTs: 0,
    running: false,
    timerStarted: false,
    timerId: 0,
  };

  const popup = { open: false, a: null, b: null };
  let drag = null;
  let bannerTimer = 0;
  let DEBUG = false;
  let debugEl = null;
  const debugLog = [];      // 真正的页面错误
  const debugNotes = [];    // 诊断信息（不算错误）

  /** ?debug=1 时在右下角显示状态与页面错误，便于自检 */
  function debugTick() {
    if (!DEBUG) return;
    if (!debugEl) {
      debugEl = document.createElement('pre');
      debugEl.id = 'debugPanel';
      // 只读诊断面板：绝不能挡住拖拽，所以 pointer-events:none
      debugEl.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:999;margin:0;padding:6px 8px;'
        + 'font:11px/1.5 ui-monospace,Menlo,monospace;color:#9fe8d0;background:rgba(0,0,0,.72);'
        + 'border:1px solid rgba(255,255,255,.15);border-radius:8px;'
        + 'max-width:min(560px,92vw);max-height:38vh;overflow:hidden;white-space:pre-wrap;pointer-events:none';
      document.body.appendChild(debugEl);
    }
    debugEl.textContent = JSON.stringify({
      cards: state.cards.map((c) => c.display),
      exprs: state.cards.map((c) => c.expr),
      busy: state.busy,
      finished: state.finished,
      demo: state.demo,
      moves: state.moves,
      level: state.level,
      cleared: state.cleared,
      unlocked: unlockedTo(),
      tier: tierOf(state.level).name,
      levelText: dom.level ? dom.level.textContent : null,
      tierText: dom.tierName ? dom.tierName.textContent : null,
      savedLevel: LS.get('g24.level', ''),
      savedCleared: LS.get('g24.cleared', ''),
      integerOnly: state.integerOnly,
      history: state.history.length,
      popupOpen: popup.open,
      ringItems: dom.popup.querySelectorAll('.op-ring__item').length,
      ringX: dom.ringHub ? Math.round(parseFloat(dom.ringHub.style.getPropertyValue('--x')) || 0) : 0,
      ringY: dom.ringHub ? Math.round(parseFloat(dom.ringHub.style.getPropertyValue('--y')) || 0) : 0,
      ringEnabled: dom.popup.querySelectorAll('.op-ring__item:not(:disabled)').length,
      ringOpen: dom.popup.classList.contains('is-open'),
      timerStarted: state.timerStarted,
      view: H5.debugInfo ? H5.debugInfo(dom, state) : null,
      theme: (function () {
        // 只读：把设计变量与几处实际计算值抖出来，供自检核对明暗与对比度
        const root = getComputedStyle(document.documentElement);
        const pick = (el, prop) => (el ? getComputedStyle(el)[prop] : null);
        const card = dom.board.querySelector('.card');
        const ring = dom.popup.querySelector('.op-ring__item');
        const primary = document.querySelector('.btn--primary');
        return {
          text: root.getPropertyValue('--text').trim(),
          textDim: root.getPropertyValue('--text-dim').trim(),
          mint: root.getPropertyValue('--mint').trim(),
          coral: root.getPropertyValue('--coral').trim(),
          amber: root.getPropertyValue('--amber').trim(),
          sky: root.getPropertyValue('--sky').trim(),
          bodyBg: getComputedStyle(document.body).backgroundColor,
          bodyImg: getComputedStyle(document.body).backgroundImage.slice(0, 40),
          cardInk: pick(card && card.querySelector('.card__center'), 'color'),
          ringInk: pick(ring, 'color'),
          primaryInk: pick(primary, 'color'),
          primaryShadow: pick(primary, 'boxShadow'),
          drift: getComputedStyle(document.body, '::before').animationName,
        };
      })(),
      errors: debugLog.slice(-4),
      notes: debugNotes.slice(-4),
    }, null, 1);
  }
  function debugError(msg) {
    if (!DEBUG) return;
    debugLog.push(msg);
    debugTick();
  }
  /** 诊断信息：会显示在面板里，但不算页面错误（自检只对 errors 断言为空） */
  function debugNote(msg) {
    if (!DEBUG) return;
    debugNotes.push(msg);
    debugTick();
  }

  /* ---------------- 小工具 ---------------- */

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  /**
   * 等动画结束，但带超时兜底：
   * 万一某个环境不产出合成帧（后台标签页/无头浏览器），animation.finished 可能
   * 永远不 resolve，会把 busy 卡死导致整局不能操作。这里用时长兜底保证一定能继续。
   */
  function done(anim, ms) {
    const fin = anim && anim.finished ? anim.finished.catch(() => {}) : Promise.resolve();
    return Promise.race([fin, wait(ms)]);
  }
  function haptic(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* 忽略 */ } }
  function rules() { return { integerOnly: state.integerOnly }; }
  function cardById(id) { return state.cards.find((c) => c.id === id) || null; }
  /** 卡牌 → 求解器可用的项（保留来源算式，提示/答案里会显示得更完整） */
  function solverItem(card) {
    return { v: card.v, expr: card.expr || card.display, op: card.op || null };
  }
  function itemsOf() { return state.cards.map(solverItem); }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }
  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r };
  }
  function midpoint(elA, elB) {
    const a = centerOf(elA), b = centerOf(elB);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  /* ---------------- 卡牌模型 ---------------- */

  function makeCard(value, expr, op) {
    const v = value instanceof F ? value : F.of(value);
    return {
      id: 'c' + (uid++),
      v,
      expr: expr || null,          // 合成来源算式，例如 "7 + 5"
      op: op || null,              // 生成这张牌用到的运算符（叶子为 null）
      display: v.toDisplay(),
      suit: SUITS[Math.floor(Math.random() * SUITS.length)],
      el: null,
    };
  }

  function createCardEl(card) {
    const el = document.createElement('div');
    el.className = 'card ' + (isRedSuit(card.suit) ? 'card--red' : 'card--black');
    el.dataset.id = card.id;
    el.dataset.value = card.display;
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.setAttribute('aria-label', `牌 ${card.display}${card.expr ? '，来自 ' + card.expr : ''}`);
    // 牌面只显示点数：算式（来源过程）不画在牌上，最多留在 title 里，鼠标悬停才露出来
    if (card.expr) el.title = card.expr;
    el.innerHTML =
      `<span class="card__corner card__corner--tl"><b>${card.display}</b><i>${card.suit}</i></span>` +
      `<span class="card__center">${card.display}</span>` +
      `<span class="card__corner card__corner--br"><b>${card.display}</b><i>${card.suit}</i></span>`;
    card.el = el;
    return el;
  }

  /* ---------------- 渲染 / FLIP ---------------- */

  function renderBoard(cards, opts) {
    opts = opts || {};
    dom.board.innerHTML = '';
    cards.forEach((card, i) => {
      const el = createCardEl(card);
      dom.board.appendChild(el);
      if (opts.spawn) {
        el.animate([
          { transform: 'translateY(-44px) rotate(-9deg) scale(.72)', opacity: 0 },
          { transform: 'translateY(0) rotate(0deg) scale(1)', opacity: 1 },
        ], {
          duration: REDUCED ? 120 : 440,
          delay: i * T.stagger,
          easing: 'cubic-bezier(.2,1.25,.3,1)',
          fill: 'backwards',
        });
      }
    });
  }

  function rectMap(exclude) {
    const m = new Map();
    for (const el of dom.board.children) {
      if (exclude && exclude.indexOf(el) >= 0) continue;
      m.set(el.dataset.id, el.getBoundingClientRect());
    }
    return m;
  }

  /** FLIP：让没被移除的牌从旧位置滑动到新位置 */
  function playFlip(first) {
    if (REDUCED) return;
    for (const el of dom.board.children) {
      const from = first.get(el.dataset.id);
      if (!from) continue;
      const to = el.getBoundingClientRect();
      const dx = from.left - to.left, dy = from.top - to.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      el.animate([
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: 'translate(0, 0)' },
      ], { duration: T.reflow, easing: 'cubic-bezier(.2,.85,.25,1)' });
    }
  }

  function spawnAnim(el) {
    const anim = el.animate([
      { transform: 'scale(.34) rotate(-15deg)', opacity: 0, filter: 'brightness(2.4)' },
      { transform: 'scale(1.13) rotate(3.5deg)', opacity: 1, filter: 'brightness(1.35)', offset: 0.55 },
      { transform: 'scale(.97) rotate(-1deg)', filter: 'brightness(1)', offset: 0.82 },
      { transform: 'scale(1) rotate(0deg)', opacity: 1 },
    ], { duration: T.spawn, easing: 'cubic-bezier(.2,1.05,.3,1)' });
    return done(anim, T.spawn + 260);
  }

  /* ---------------- 提示条 ---------------- */

  function showBanner(text, kind, action) {
    dom.banner.hidden = false;
    dom.banner.className = 'banner' + (kind ? ' is-' + kind : '');
    dom.bannerText.textContent = text;
    dom.bannerIcon.textContent = kind === 'warn' ? '⚠️' : kind === 'win' ? '🎉' : '💡';
    if (action) {
      dom.bannerAction.hidden = false;
      dom.bannerAction.textContent = action.label;
      dom.bannerAction.onclick = action.handler;
    } else {
      dom.bannerAction.hidden = true;
      dom.bannerAction.onclick = null;
    }
    dom.banner.style.animation = 'none';
    void dom.banner.offsetWidth;
    dom.banner.style.animation = '';
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { if (!state.finished && !state.demo) dom.banner.hidden = true; }, 5600);
  }
  function hideBanner() { dom.banner.hidden = true; clearTimeout(bannerTimer); }
  /** 短提示：过一会儿自动收（回合播报用），复用同一个 timer，不会打架 */
  function flashBanner(text, ms) {
    showBanner(text, null);
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { if (!state.finished && !state.demo) dom.banner.hidden = true; }, ms || 1600);
  }

  function nudge(el) {
    if (!el || REDUCED) return;
    el.classList.remove('is-nudged');
    void el.offsetWidth;
    el.classList.add('is-nudged');
    setTimeout(() => el.classList.remove('is-nudged'), 1100);
  }

  /* ---------------- 计时 / HUD ---------------- */

  function resumeTimer() {
    if (state.running) return;
    state.resumeTs = performance.now();
    state.running = true;
    clearInterval(state.timerId);
    state.timerId = setInterval(updateTimer, 200);
    updateTimer();
  }
  function pauseTimer() {
    if (state.running) {
      state.elapsedMs += performance.now() - state.resumeTs;
      state.running = false;
    }
    clearInterval(state.timerId);
    state.timerId = 0;
    updateTimer();
  }
  function elapsedSec() {
    return (state.elapsedMs + (state.running ? performance.now() - state.resumeTs : 0)) / 1000;
  }
  function updateTimer() { dom.timer.textContent = fmtTime(elapsedSec()); }

  /* ---------------- 闯关模式（15 档 × 20 关 = 300 关） ---------------- */

  const LV = (global.G24 && global.G24.LEVELS) || { tiers: [], levels: [], perTier: 20 };
  const TOTAL_LEVELS = LV.levels.length || 300;

  /** 第 n 关的定义（1 起） */
  function levelDef(n) {
    const i = Math.max(0, Math.min(TOTAL_LEVELS - 1, Math.round(Number(n) || 1) - 1));
    return LV.levels[i];
  }
  function tierOf(n) { return LV.tiers[levelDef(n).t] || { name: '未知', rule: 'frac' }; }
  function levelName(n) { return `第 ${n} 关 · ${tierOf(n).name}`; }
  /** 已经解锁到第几关：通关数 + 1，封顶 300 */
  function unlockedTo() { return Math.min(TOTAL_LEVELS, Math.max(1, state.cleared + 1)); }

  /** 只改“现在在第几关”：存档、本关规则、记分牌；牌面交给 newDeal */
  function setLevel(n, opts) {
    const lim = (opts && opts.force) ? TOTAL_LEVELS : unlockedTo();
    state.level = Math.max(1, Math.min(lim, Math.round(Number(n)) || 1));
    LS.set('g24.level', String(state.level));
    if (!state.ruleOverride) setIntegerOnly(levelDef(state.level).r === 'int', { silent: true });
    const tier = tierOf(state.level);
    if (dom.tierName) dom.tierName.textContent = tier.name;
    if (dom.level) bump(dom.level, String(state.level));
    updateHud();
  }

  /** 开始第 n 关：换成这一关固定的 4 张牌 */
  async function startLevel(n, opts) {
    closeModal('levelModal');
    setLevel(n, opts);
    await newDeal(Object.assign({ values: levelDef(state.level).n, shuffle: true, announce: false }, opts || {}));
    flashBanner(levelName(state.level), 2200);
  }

  /** 通关 → 下一关（第 300 关通关后停在原地） */
  async function nextLevel() {
    if (state.busy) return;
    closeModal('winModal');
    if (state.level >= TOTAL_LEVELS) return;
    await startLevel(state.level + 1);
  }

  /** 关卡地图：15 档横向排成一条滑轨，左右滑动 / 点档位标签切换 */
  let lvmTier = 0;
  let lvmScrollTimer = 0;

  function renderLevelList() {
    if (!dom.levelPager) return;
    const per = LV.perTier || 20;
    const unlocked = unlockedTo();
    const cur = state.level;
    const curTi = Math.floor((cur - 1) / per);
    lvmTier = curTi;
    if (dom.levelProgress) dom.levelProgress.textContent = `${state.cleared} / ${TOTAL_LEVELS}`;

    // 档位标签条
    dom.levelTabs.innerHTML = LV.tiers.map((tier, ti) => {
      const from = ti * per + 1;
      const clearedHere = Math.max(0, Math.min(per, state.cleared - from + 1));
      const locked = unlocked < from;
      return `<button class="lvm__tab${ti === curTi ? ' is-active' : ''}${locked ? ' is-locked' : ''}"`
        + ` data-tab="${ti}" role="tab" aria-selected="${ti === curTi}"`
        + ` aria-label="第 ${ti + 1} 档 ${tier.name}">`
        + `<span class="lvm__tab-name">${tier.name}</span>`
        + `<span class="lvm__tab-count">${clearedHere}/${per}</span>`
        + '</button>';
    }).join('');

    // 每一档一页
    dom.levelPager.innerHTML = LV.tiers.map((tier, ti) => {
      const from = ti * per + 1;
      const locked = unlocked < from;
      let nodes = '';
      for (let n = from; n < from + per; n++) {
        const cls = n === cur ? 'is-current' : n <= state.cleared ? 'is-cleared' : n <= unlocked ? 'is-todo' : 'is-locked';
        nodes += `<button class="lvm__node ${cls}" data-level="${n}" aria-label="第 ${n} 关"`
          + `${n > unlocked ? ' disabled' : ''}>${n <= state.cleared ? '✓' : n}</button>`;
      }
      return `<section class="lvm__page${locked ? ' is-locked' : ''}" data-page="${ti}">`
        + `<div class="lvm__page-head"><b>${ti + 1}. ${tier.name}</b><span>${tier.note}</span></div>`
        + `<div class="lvm__grid">${nodes}</div>`
        + '</section>';
    }).join('');

    // 等布局完成再定位（此时 clientWidth 才有值）
    requestAnimationFrame(() => setActiveTier(curTi, true));
  }

  /** 切到第 ti 档：滑轨滚过去 + 标签高亮 */
  function setActiveTier(ti, instant) {
    if (!dom.levelPager || !LV.tiers.length) return;
    ti = Math.max(0, Math.min(LV.tiers.length - 1, Math.round(Number(ti)) || 0));
    lvmTier = ti;
    const w = dom.levelPager.clientWidth || 1;
    if (instant) dom.levelPager.scrollLeft = w * ti;
    else dom.levelPager.scrollTo({ left: w * ti, behavior: 'smooth' });

    const tabs = dom.levelTabs.querySelectorAll('.lvm__tab');
    tabs.forEach((b, i) => {
      b.classList.toggle('is-active', i === ti);
      b.setAttribute('aria-selected', String(i === ti));
    });
    const tab = tabs[ti];
    if (tab) {
      // 让当前档位的标签滚到标签条中间（只滚标签条，不动页面）
      dom.levelTabs.scrollTo({
        left: Math.max(0, tab.offsetLeft - (dom.levelTabs.clientWidth - tab.offsetWidth) / 2),
        behavior: instant ? 'auto' : 'smooth',
      });
    }
    if (dom.levelFoot) dom.levelFoot.textContent = `第 ${ti + 1} / ${LV.tiers.length} 档 · 左右滑动切换`;
    if (dom.levelPrev) dom.levelPrev.disabled = ti === 0;
    if (dom.levelNext) dom.levelNext.disabled = ti === LV.tiers.length - 1;
  }

  function openLevels() {
    Sfx.unlock();
    renderLevelList();
    openModal('levelModal');
  }

  /** 每关各自的最好成绩：g24.bests = { "12": 9.4, ... } */
  function bestMap() {
    try { const m = JSON.parse(LS.get('g24.bests', '{}')); return m && typeof m === 'object' ? m : {}; }
    catch (e) { return {}; }
  }
  function getBest() { const v = Number(bestMap()[state.level] || 0); return v > 0 ? v : 0; }
  function setBest(sec) {
    const m = bestMap();
    m[state.level] = Number(sec.toFixed(1));
    LS.set('g24.bests', JSON.stringify(m));
  }

  /** 记分牌数字一变就弹一下（纯 CSS 动画，这里只负责挂/摘类名） */
  function bump(el, next) {
    if (!el || REDUCED) return;
    if (el.textContent === next) return;
    el.textContent = next;
    el.classList.remove('is-bump');
    void el.offsetWidth;            // 重新触发动画
    el.classList.add('is-bump');
  }

  function updateHud() {
    bump(dom.moves, String(state.moves));
    if (dom.level) bump(dom.level, String(state.level));
    if (dom.tierName) dom.tierName.textContent = tierOf(state.level).name;
    const b = getBest();
    dom.best.textContent = b ? fmtTime(b) : '--:--';
    dom.undoBtn.disabled = state.history.length === 0;
    dom.timer.textContent = fmtTime(elapsedSec());   // 秒表每秒跳，不做弹跳免得晃眼
    debugTick();
  }

  /* ---------------- 发牌 ---------------- */

  async function shuffleOut() {
    const els = Array.from(dom.board.children);
    if (!els.length || REDUCED) return;
    await Promise.all(els.map((el, i) => done(el.animate([
      { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
      { transform: `translateY(-30px) rotate(${i % 2 ? 14 : -14}deg)`, opacity: 0 },
    ], { duration: 240, delay: i * 30, easing: 'ease-in', fill: 'forwards' }), 240 + i * 30 + 260)));
  }

  async function newDeal(opts) {
    opts = opts || {};
    state.busy = true;
    state.demo = false;
    clearHint();
    hideBanner();
    closeModal('winModal');
    closeModal('loseModal');
    closeOpPopup({ silent: true });
    if (opts.shuffle) { await shuffleOut(); Sfx.deal(); }

    // 闯关模式：每关的 4 张牌是固定的（?deal= 可临时换成指定牌面）
    const vals = (opts.values || levelDef(state.level).n || [1, 2, 3, 4]).slice();
    state.values = vals;
    state.initialDeal = vals.slice();
    state.cards = vals.map((v) => makeCard(v, null));
    state.history = [];
    state.moves = 0;
    state.hintLevel = 0;
    state.finished = false;
    state.selectedId = null;
    state.elapsedMs = 0;
    state.running = false;
    state.timerStarted = false;
    clearInterval(state.timerId);
    state.timerId = 0;

    renderBoard(state.cards, { spawn: true });
    if (!opts.shuffle) Sfx.deal();
    updateHud();
    updateTimer();
    if (opts.announce !== false) showBanner('拖一张牌到另一张上', null);

    await wait(REDUCED ? 80 : 520 + T.stagger * 3);
    state.busy = false;
  }

  function restartDeal() {
    if (state.busy) return;
    state.busy = true;
    clearHint(); hideBanner();
    closeModal('winModal'); closeModal('loseModal');
    closeOpPopup({ silent: true });
    state.cards = state.initialDeal.map((v) => makeCard(v, null));
    state.history = [];
    state.moves = 0;
    state.hintLevel = 0;
    state.finished = false;
    state.selectedId = null;
    state.elapsedMs = 0;
    state.running = false;
    state.timerStarted = false;
    clearInterval(state.timerId);
    state.timerId = 0;
    renderBoard(state.cards, { spawn: true });
    Sfx.deal();
    updateHud(); updateTimer();
    setTimeout(() => { state.busy = false; }, REDUCED ? 80 : 560);
  }

  /* ---------------- 拖拽 ---------------- */

  function onPointerDown(e) {
    Sfx.unlock();
    if (state.demo) { stopDemo(); return; }
    if (state.busy || state.finished) return;

    const cardEl = e.target.closest ? e.target.closest('.card') : null;
    if (!cardEl || !dom.board.contains(cardEl)) {
      if (popup.open) closeOpPopup();
      return;
    }
    if (popup.open) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const card = cardById(cardEl.dataset.id);
    if (!card) return;

    drag = {
      card, el: cardEl, id: card.id,
      startX: e.clientX, startY: e.clientY,
      x: e.clientX, y: e.clientY,
      dx: 0, dy: 0,
      moved: false, target: null,
      pointerType: e.pointerType || (H5.isTouch ? 'touch' : 'mouse'),
    };
    global.addEventListener('pointermove', onPointerMove, { passive: false });
    global.addEventListener('pointerup', onPointerUp);
    global.addEventListener('pointercancel', onPointerUp);
    e.preventDefault();
  }

  function startDrag() {
    drag.moved = true;
    drag.el.classList.add('is-dragging');
    if (state.selectedId === drag.id) deselect(true);
    startTimerIfNeeded();
    Sfx.pickup();
    haptic(8);
  }

  function onPointerMove(e) {
    if (!drag) return;
    e.preventDefault();
    drag.x = e.clientX; drag.y = e.clientY;
    drag.dx = e.clientX - drag.startX;
    drag.dy = e.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(drag.dx, drag.dy) < 6) return;
      startDrag();
    }
    // pointermove 本身已经是按帧合并的，直接写样式；
    // 命中判定不使用 requestAnimationFrame —— 后台标签页/无头环境可能不产出帧。
    paintDrag();
    setTarget(hitTest(drag.x, drag.y, drag.el));
  }

  function paintDrag() {
    if (!drag) return;
    const rot = Math.max(-14, Math.min(14, drag.dx * 0.06));
    // 手指会挡住牌，触摸时把牌往上抬一截；命中判定仍然按手指位置算
    const lift = drag.pointerType === 'touch' ? -34 : 0;
    drag.el.style.transform = `translate3d(${drag.dx}px, ${drag.dy + lift}px, 0) rotate(${rot}deg) scale(1.05)`;
  }

  /** 落点判定：指针下面“除了被拖那张牌”以外的第一张牌。
      注意：被拖的牌是跟着手指走的，所以指针永远压在它自己身上 ——
      只取最顶层元素（elementFromPoint）会永远命中自己，落点永远是空的。
      这里取整条命中链（elementsFromPoint）跳过自己；老内核没有这个 API，
      就临时把被拖的牌设成 pointer-events:none 再量一次。 */
  function hitTest(x, y, ignoreEl) {
    const canPoint = typeof document.elementFromPoint === 'function';
    if (!canPoint) return null;
    let chain = null;
    if (typeof document.elementsFromPoint === 'function') {
      chain = document.elementsFromPoint(x, y);
    } else {
      const top = document.elementFromPoint(x, y);
      chain = top ? [top] : [];
      if (top && ignoreEl && (top === ignoreEl || ignoreEl.contains(top))) {
        const prev = ignoreEl.style.pointerEvents;
        ignoreEl.style.pointerEvents = 'none';
        const under = document.elementFromPoint(x, y);
        ignoreEl.style.pointerEvents = prev;
        chain = under ? [under] : [];
      }
    }
    for (let i = 0; i < chain.length; i++) {
      const el = chain[i];
      const cardEl = el && el.closest ? el.closest('.card') : null;
      if (!cardEl || cardEl === ignoreEl) continue;
      if (!dom.board.contains(cardEl)) continue;
      const card = cardById(cardEl.dataset.id);
      if (card) return card;
    }
    return null;
  }

  function setTarget(card) {
    if (!drag || drag.target === card) return;
    if (drag.target && drag.target.el) drag.target.el.classList.remove('is-target');
    drag.target = card;
    if (card) {
      card.el.classList.add('is-target');
      Sfx.targetOn();
      haptic(6);
    }
  }

  function onPointerUp(e) {
    global.removeEventListener('pointermove', onPointerMove);
    global.removeEventListener('pointerup', onPointerUp);
    global.removeEventListener('pointercancel', onPointerUp);
    const d = drag;
    drag = null;
    if (!d) return;

    const el = d.el;
    if (!d.moved) { handleTap(d.card); return; }

    // 以松手瞬间的坐标重新判定落点，避免悬停状态过期
    const x = e && typeof e.clientX === 'number' ? e.clientX : d.x;
    const y = e && typeof e.clientY === 'number' ? e.clientY : d.y;
    const target = hitTest(x, y, el) || d.target;
    if (d.target && d.target !== target && d.target.el) d.target.el.classList.remove('is-target');

    if (target) {
      if (target.el) target.el.classList.remove('is-target');
      el.classList.remove('is-dragging');
      el.style.transform = '';
      el.classList.add('is-settling');
      setTimeout(() => el.classList.remove('is-settling'), 460);
      Sfx.snap();
      openOpPopup(d.card, target);
      return;
    }

    // 没落在牌上：弹回原位
    el.classList.remove('is-dragging');
    Sfx.release();
    const rot = Math.max(-14, Math.min(14, d.dx * 0.06));
    const lift = d.pointerType === 'touch' ? -34 : 0;
    const from = `translate3d(${d.dx}px, ${d.dy + lift}px, 0) rotate(${rot}deg) scale(1.05)`;
    el.style.transform = '';
    el.animate([
      { transform: from },
      { transform: 'translate3d(0,0,0) rotate(0deg) scale(1)' },
    ], { duration: T.spring, easing: 'cubic-bezier(.18,1.5,.4,1)' });
  }

  /** 点击选牌（触屏/键盘的等价交互） */
  function handleTap(card) {
    startTimerIfNeeded();
    if (state.selectedId === card.id) { deselect(); Sfx.softTick(); return; }
    if (!state.selectedId) { select(card); return; }
    const first = cardById(state.selectedId);
    deselect(true);
    if (!first) return;
    Sfx.snap();
    openOpPopup(first, card);
  }

  function select(card) {
    state.selectedId = card.id;
    card.el.classList.add('is-selected');
    Sfx.pickup();
    haptic(6);
  }
  function deselect(silent) {
    if (!state.selectedId) return;
    const c = cardById(state.selectedId);
    if (c && c.el) c.el.classList.remove('is-selected');
    state.selectedId = null;
    if (!silent) Sfx.softTick();
  }

  function startTimerIfNeeded() {
    if (state.timerStarted || state.finished) return;
    state.timerStarted = true;
    resumeTimer();
  }

    /* ---------------- 运算符圆环 ----------------
     参考 Filee 的“格式圆环”：拖到目标上，就在落点展开一圈选项。
     这里两张牌一合上，就在两牌中点展开 + − × ÷ 加一个“取消”，
     小球错开时间从圆心弹出（动画在 CSS 里，JS 只负责定位与禁用态）。 */

  /** 圆环半径 + 小球半径 + 安全边距：保证整圈都在屏幕内 */
  const RING_SAFE = 132;

  function openOpPopup(a, b) {
    if (popup.open || state.busy || state.finished || !a || !b) return;
    if (a === b) return;
    popup.open = true; popup.a = a; popup.b = b;
    deselect(true);
    clearHint();
    a.el.classList.add('is-pending');
    b.el.classList.add('is-pending');
    renderRing();
    dom.popup.hidden = false;
    dom.popup.classList.remove('is-open');
    positionRing();
    void dom.popup.offsetWidth;                  // 先落一次“收起态”，连点也能重播动画
    dom.popup.classList.add('is-open');
    Sfx.popupOpen();
    haptic(10);
    global.addEventListener('resize', positionRing);
    global.addEventListener('scroll', positionRing, true);
    const firstBtn = dom.popup.querySelector('.op-ring__item:not(:disabled)');
    if (firstBtn) firstBtn.focus({ preventScroll: true });
  }

  function closeOpPopup(opts) {
    opts = opts || {};
    if (!popup.open) return;
    const a = popup.a, b = popup.b;
    if (a && a.el) a.el.classList.remove('is-pending');
    if (b && b.el) b.el.classList.remove('is-pending');
    popup.open = false; popup.a = null; popup.b = null;
    dom.popup.classList.remove('is-open');
    setTimeout(() => {
      if (!popup.open) dom.popup.hidden = true;   // 期间又打开了就别藏
    }, REDUCED ? 40 : 220);
    global.removeEventListener('resize', positionRing);
    global.removeEventListener('scroll', positionRing, true);
    if (!opts.silent) Sfx.popupClose();
  }

  /** 圆心 = 两张牌的中点；夹到安全范围内，圆环不会被屏幕边缘切掉 */
  function positionRing() {
    if (!popup.open || !popup.a || !popup.b) return;
    const mid = midpoint(popup.a.el, popup.b.el);
    const vh = (global.visualViewport && global.visualViewport.height) || global.innerHeight;
    const vw = global.innerWidth;
    const x = Math.min(Math.max(mid.x, RING_SAFE), Math.max(RING_SAFE, vw - RING_SAFE));
    const y = Math.min(Math.max(mid.y, RING_SAFE), Math.max(RING_SAFE, vh - RING_SAFE));
    dom.ringHub.style.setProperty('--x', Math.round(x) + 'px');
    dom.ringHub.style.setProperty('--y', Math.round(y) + 'px');
  }

  /** 只做一件事：算出哪几个符号这次算不了（比如除以 0），把它灰掉。
      面板上不再显示任何运算结果。 */
  function renderRing() {
    const L = popup.a, R = popup.b;
    const items = dom.popup.querySelectorAll('.op-ring__item');
    for (let i = 0; i < items.length; i++) {
      const btn = items[i];
      const r = Solver.compute(btn.dataset.op, L.v, R.v, rules());
      btn.disabled = !r.ok;
      // 提示文案留在 title 里，鼠标用户能看到为什么不可用
      btn.title = r.ok ? `用 ${btn.textContent} 把 ${L.display} 和 ${R.display} 合起来` : r.reason;
    }
  }

  function chooseOp(opKey) {
    const a = popup.a, b = popup.b;
    if (!a || !b) return;
    const comp = Solver.compute(opKey, a.v, b.v, rules());
    if (!comp.ok) { Sfx.invalid(); return; }
    Sfx.choose();
    haptic(12);
    executeMerge(a, b, opKey);
  }

  /* ---------------- 分享 ---------------- */

  async function shareGame() {
    const steps = state.moves > 0 ? `我用了 ${state.moves} 步` : '四张牌凑 24 点';
    const payload = {
      title: '24Game · 拖拽合成',
      text: `${steps} —— 拖一张牌到另一张上，弹出运算符直接合成，你能凑出 24 吗？`,
      url: global.location.href.split('#')[0],
    };
    const r = await H5.share(payload);
    if (r.via === 'guide') { openShareGuide(); return; }
    if (r.via === 'share') { Sfx.softTick(); return; }
    if (r.via === 'clipboard') { Sfx.choose(); showBanner('链接已复制，去粘贴给朋友吧 🎉'); return; }
    showBanner('复制下面的链接分享：' + (r.url || global.location.href));
  }

  function openShareGuide() {
    dom.shareGuide.hidden = false;
    Sfx.popupOpen();
  }
  function closeShareGuide() {
    if (dom.shareGuide.hidden) return;
    dom.shareGuide.hidden = true;
    Sfx.popupClose();
  }

  /* ---------------- 横屏引导 / 安装到桌面 ---------------- */

  let rotateHintTimer = 0;
  function updateRotateHint() {
    const dismissed = LS.get('g24.rotateHint', '') === 'off';
    const show = !dismissed && H5.isCrampedLandscape();
    dom.rotateHint.hidden = !show;
    if (show) dom.rotateHint.dataset.everShown = '1';
    clearTimeout(rotateHintTimer);
    if (show) {
      // 只是提示一下，过一会儿自己退场，别一直占着屏幕
      rotateHintTimer = setTimeout(() => { dom.rotateHint.hidden = true; }, 12000);
    }
  }

  function dismissRotateHint(forever) {
    clearTimeout(rotateHintTimer);
    dom.rotateHint.hidden = true;
    if (forever) LS.set('g24.rotateHint', 'off');
    Sfx.softTick();
  }

  function updateInstallBtn(canInstall) {
    // 微信内无法安装 PWA，直接不显示
    dom.installBtn.hidden = !canInstall || H5.isWeChat;
  }

  /* ---------------- 合成：动画时间轴 ---------------- */

  function snapshot() {
    return state.cards.map((c) => ({ v: c.v, expr: c.expr, op: c.op, display: c.display, suit: c.suit }));
  }

  /** 注意：左右操作数由“拖拽方向 / 点选顺序”决定 —— 先拖（点）的是左边。
      面板上只有 4 个符号，想反过来算就把另一张牌拖过去。 */
  async function executeMerge(a, b, opKey) {
    if (state.busy || state.finished) return;
    const left = a;
    const right = b;
    const comp = Solver.compute(opKey, left.v, right.v, rules());
    if (!comp.ok) { Sfx.invalid(); return; }

    state.busy = true;
    startTimerIfNeeded();
    closeOpPopup({ silent: true });
    clearHint();
    state.history.push({ cards: snapshot(), moves: state.moves });
    hideBanner();

    const result = comp.value;
    const sym = OP_SYM[opKey];
    const label = `${left.display} ${sym} ${right.display}`;
    const elA = a.el, elB = b.el;
    const mid = midpoint(elA, elB);
    const rectA = elA.getBoundingClientRect();
    const rectB = elB.getBoundingClientRect();

    // 1) 两张牌飞向中点（此时 DOM 未变动，其余牌不抖）
    const flyTo = (el, rect, rot) => {
      const dx = mid.x - (rect.left + rect.width / 2);
      const dy = mid.y - (rect.top + rect.height / 2);
      el.classList.add('is-flying');
      const anim = el.animate([
        { transform: 'translate3d(0,0,0) rotate(0deg) scale(1)', opacity: 1 },
        { transform: `translate3d(${dx}px, ${dy}px, 0) rotate(${rot}deg) scale(.6)`, opacity: 0.96 },
      ], { duration: T.fly, easing: 'cubic-bezier(.55,0,.35,1)', fill: 'forwards' });
      return done(anim, T.fly + 260);
    };
    await Promise.all([flyTo(elA, rectA, -9), flyTo(elB, rectB, 9)]);

    // 2) 撞击：粒子 + 光环 + 飘字 + 震屏 + 音效
    Fx.burst(mid.x, mid.y, { count: 26, power: 1 });
    Fx.ring(mid.x, mid.y, { size: 64 });
    Fx.floatText(mid.x, mid.y - 58, `${label} = ${result.toDisplay()}`);
    Fx.shake(dom.table, 5);
    Sfx.merge();
    haptic(18);
    if (!REDUCED) await wait(90);

    // 3) 移除两张旧牌，放入新牌，其余牌 FLIP 重排
    const first = rectMap([elA, elB]);
    const idx = Math.min(state.cards.indexOf(a), state.cards.indexOf(b));
    elA.remove();
    elB.remove();
    state.cards = state.cards.filter((c) => c !== a && c !== b);

    const expr = Solver.composeExpr(solverItem(left), solverItem(right), opKey);
    const card = makeCard(result, expr, opKey);
    state.cards.splice(idx, 0, card);
    const el = createCardEl(card);
    dom.board.insertBefore(el, dom.board.children[idx] || null);

    playFlip(first);
    Sfx.spawn();
    // 4) 新牌弹出
    spawnAnim(el);

    state.moves += 1;
    updateHud();
    await wait(REDUCED ? 60 : T.spawn * 0.8);
    state.busy = false;
    checkEndState();
  }

  /* “24”盖章飘字的时长；面板等它演完再弹，避免被更高层级的面板盖住 */
  const STAMP_MS = 1300;

  /* ---------------- 胜负 / 死路 ---------------- */

  function checkEndState() {
    if (state.finished) return;
    if (state.cards.length === 1) {
      const c = state.cards[0];
      if (c.v.eq(24)) win(); else lose(c);
      return;
    }
    if (!Solver.isSolvable(itemsOf(), rules())) {
      Fx.shake(dom.table, 4);
      Sfx.dead();
      nudge(dom.undoBtn);
      showBanner('凑不出 24 了', 'warn', { label: '撤销', handler: () => undo() });
    } else {
      hideBanner();
    }
  }

  function win() {
    state.finished = true;
    state.demo = false;
    pauseTimer();
    const card = state.cards[0];
    card.el.classList.add('is-won');
    card.el.classList.remove('is-hint');

    const c = centerOf(card.el);
    Fx.ring(c.x, c.y, { size: 140, color: '#f4c260' });
    Fx.stamp(c.x, c.y - 46, '24', STAMP_MS);
    Fx.burst(c.x, c.y, { count: 40, power: 1.4 });
    Fx.confetti({ count: 110 });
    debugNote('confetti=' + (Fx.lastConfetti || 0));
    Sfx.win();
    haptic([14, 50, 14, 50, 26]);

    const sec = elapsedSec();
    const prev = getBest();
    const isBest = !prev || sec < prev;
    if (isBest) setBest(sec);

    // 闯关进度：通关数至少推到本关，下一关随之解锁
    const finishedLevel = state.level;
    const lastOfTier = finishedLevel % (LV.perTier || 20) === 0;
    const allDone = finishedLevel >= TOTAL_LEVELS;
    state.cleared = Math.max(state.cleared, finishedLevel);
    LS.set('g24.cleared', String(state.cleared));
    if (!allDone) LS.set('g24.level', String(finishedLevel + 1));
    updateHud();

    const nextTierName = allDone ? '' : tierOf(finishedLevel + 1).name;
    const bannerText = allDone
      ? `🎉 300 关全部通关！用时 ${fmtTime(sec)}`
      : lastOfTier
        ? `🎉 ${tierOf(finishedLevel).name} 通关 · 下一档「${nextTierName}」`
        : `${levelName(finishedLevel)} · ${fmtTime(sec)} · ${state.moves} 步${isBest ? ' · 新纪录 ⭐' : ''}`;
    showBanner(bannerText, 'win', allDone ? null : { label: '下一关', handler: () => nextLevel() });

    setTimeout(() => {
      dom.winTitle.textContent = allDone ? '全部通关！' : lastOfTier ? `${tierOf(finishedLevel).name} 通关！` : '合成成功！';
      dom.winNext.textContent = allDone ? '看看牌面' : lastOfTier ? `进入「${nextTierName}」→` : '下一关 →';
      dom.winStats.textContent = `第${finishedLevel}关 · ${fmtTime(sec)} · ${state.moves}步`
        + (isBest ? ' · 新纪录 ⭐' : '');
      // 等“24”盖章飘字演完再弹面板：面板 z-index 更高，早弹会把飘字盖住（看起来像只显示了一半）
      openModal('winModal');
    }, REDUCED ? 560 : STAMP_MS + 60);   // 减动效模式飘字 500ms，面板必须更晚
  }

  function lose(card) {
    state.finished = true;
    state.demo = false;
    pauseTimer();
    card.el.classList.add('is-lost');
    Fx.burst(centerOf(card.el).x, centerOf(card.el).y, { count: 12, colors: ['#ff6b6b', '#8b98a1'] });
    Sfx.dead();
    showBanner('不是 24', 'warn', { label: '撤销', handler: () => undo() });
    setTimeout(() => {
      dom.loseValue.textContent = card.display;
      openModal('loseModal');
    }, REDUCED ? 260 : 620);
  }

  /* ---------------- 撤销 / 提示 / 答案 ---------------- */

  async function undo() {
    if (popup.open) closeOpPopup({ silent: true });
    if (state.busy) return;
    const entry = state.history.pop();
    if (!entry) {
      Sfx.invalid();
      nudge(dom.undoBtn);
      showBanner('已经回到开局啦');
      return;
    }
    state.busy = true;
    closeModal('winModal');
    closeModal('loseModal');
    clearHint();
    Sfx.undo();
    haptic(10);

    state.cards = entry.cards.map((d) => {
      const c = makeCard(d.v, d.expr, d.op);
      c.display = d.display;
      c.suit = d.suit;
      return c;
    });
    state.moves = typeof entry.moves === 'number' ? entry.moves : Math.max(0, state.moves - 1);
    state.finished = false;
    state.selectedId = null;
    renderBoard(state.cards, { spawn: true });
    const won = state.cards.find((c) => c.el.classList.contains('is-won'));
    if (won) won.el.classList.remove('is-won');
    updateHud();
    hideBanner();
    if (state.timerStarted) resumeTimer();
    await wait(REDUCED ? 60 : 420);
    state.busy = false;
    checkEndState();
  }

  function clearHint() {
    state.hintLevel = 0;
    for (const c of state.cards) if (c.el) c.el.classList.remove('is-hint');
  }

  function hint() {
    if (state.busy || state.finished || popup.open || state.cards.length < 2) return;
    startTimerIfNeeded();
    const steps = Solver.findSteps(itemsOf(), rules());
    clearHint();
    if (!steps || !steps.length) {
      Sfx.invalid();
      nudge(dom.undoBtn);
      showBanner('算不出 24 了', 'warn', { label: '撤销', handler: () => undo() });
      return;
    }
    // 逐级加码：先指牌 → 再给运算符 → 最后给完整解法
    state.hintLevel = Math.min(3, state.hintLevel + 1);
    const step = steps[0];
    const a = state.cards[step.i], b = state.cards[step.j];
    a.el.classList.add('is-hint');
    b.el.classList.add('is-hint');
    Sfx.hoverTick();
    haptic(8);

    if (state.hintLevel === 1) {
      showBanner(`试试 ${a.display} 和 ${b.display}`);
    } else if (state.hintLevel === 2) {
      showBanner(`用「${OP_SYM[step.op]}」 ${Solver.equation(step)}`);
    } else {
      showBanner(`${steps[steps.length - 1].expr} = 24`);
    }
  }

  function showAnswers() {
    if (state.busy) return;
    const list = Solver.solutions(itemsOf(), 6, rules());
    dom.answerList.innerHTML = '';
    if (!list.length) {
      const d = document.createElement('div');
      d.className = 'answer-item';
      d.textContent = '当前牌面无解';
      dom.answerList.appendChild(d);
      dom.demoBtn.disabled = true;
    } else {
      list.forEach((expr, i) => {
        const d = document.createElement('div');
        d.className = 'answer-item';
        d.innerHTML = `<span>解法 ${i + 1}</span>${expr} = 24`;
        dom.answerList.appendChild(d);
      });
      dom.demoBtn.disabled = state.cards.length < 2;
    }
    dom.answerNote.textContent = state.integerOnly ? '只列整数中间值' : '含分数中间值';
    openModal('answerModal');
  }

  async function autoDemo() {
    if (state.busy) return;
    closeModal('answerModal');
    state.demo = true;
    showBanner('自动演示中 · 点任意位置停止');
    let guard = 0;
    while (state.demo && state.cards.length > 1 && guard++ < 6) {
      const steps = Solver.findSteps(itemsOf(), rules());
      if (!steps || !steps.length) break;
      const s = steps[0];
      await wait(REDUCED ? 120 : 320);
      if (!state.demo) break;
      await executeMerge(state.cards[s.i], state.cards[s.j], s.op, false);
      await wait(REDUCED ? 100 : 220);
    }
    state.demo = false;
    if (state.cards.length > 1 && !state.finished) hideBanner();
  }

  function stopDemo() {
    state.demo = false;
    hideBanner();
  }

  /* ---------------- 弹层 ---------------- */

  function openModal(id) {
    const m = $(id);
    if (!m) return;
    m.hidden = false;
    Sfx.softTick();
  }
  function closeModal(id) {
    const m = $(id);
    if (!m) return;
    if (!m.hidden) Sfx.softTick();
    m.hidden = true;
  }
  function closeAllModals() {
    ['helpModal', 'answerModal', 'winModal', 'loseModal', 'levelModal'].forEach(closeModal);
  }

  /* ---------------- 设置持久化 ---------------- */

  function setIntegerOnly(on, opts) {
    state.integerOnly = !!on;
    dom.ruleBtn.setAttribute('aria-checked', String(!!on));
    dom.ruleBtn.classList.toggle('is-on', !!on);
    LS.set('g24.integerOnly', on ? '1' : '0');
    if (!opts || !opts.silent) {
      showBanner(on ? '已开启：每步中间结果必须是整数' : '已关闭整数限制（允许分数中间值）');
      if (state.cards.length > 1 && !Solver.isSolvable(itemsOf(), rules())) {
        showBanner('此规则下无解', 'warn', { label: '撤销', handler: () => undo() });
      }
    }
    updateHud();
  }
  function setSound(on) {
    Sfx.setEnabled(on);
    dom.soundBtn.setAttribute('aria-pressed', String(!!on));
    LS.set('g24.sound', on ? '1' : '0');
    if (on) { Sfx.unlock(); Sfx.softTick(); }
  }

  /* ---------------- 事件绑定 ---------------- */

  function bind() {
    dom.board.addEventListener('pointerdown', onPointerDown);
    dom.board.addEventListener('keydown', (e) => {
      const cardEl = e.target.closest ? e.target.closest('.card') : null;
      if (!cardEl) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const card = cardById(cardEl.dataset.id);
        if (card && !state.busy && !popup.open) handleTap(card);
      }
    });

    // 圆环：点小球选符号；点“取消”或点圆环外的遮罩都算放弃
    dom.popup.addEventListener('click', (e) => {
      const item = e.target.closest('.op-ring__item');
      if (item) {
        if (item.disabled) { Sfx.invalid(); return; }
        chooseOp(item.dataset.op);
        return;
      }
      if (e.target.closest('.op-ring__cancel') || e.target.closest('.op-ring__scrim')) {
        closeOpPopup();
      }
    });

    dom.shareBtn.addEventListener('click', () => { Sfx.unlock(); shareGame(); });
    dom.installBtn.addEventListener('click', async () => {
      const ok = await H5.promptInstall();
      showBanner(ok ? '已开始安装，之后可从桌面直接打开 📲' : '好的，随时可以在浏览器菜单里安装');
    });
    dom.rotateHintOk.addEventListener('click', () => dismissRotateHint(false));
    dom.rotateHintNever.addEventListener('click', () => dismissRotateHint(true));
    dom.shareGuide.addEventListener('click', closeShareGuide);
    dom.shareGuideOk.addEventListener('click', (e) => { e.stopPropagation(); closeShareGuide(); });

    dom.undoBtn.addEventListener('click', () => undo());
    dom.restartBtn.addEventListener('click', () => restartDeal());
    dom.hintBtn.addEventListener('click', hint);
    dom.solveBtn.addEventListener('click', showAnswers);
    dom.demoBtn.addEventListener('click', autoDemo);

    dom.ruleBtn.addEventListener('click', () => setIntegerOnly(!state.integerOnly));
    dom.soundBtn.addEventListener('click', () => setSound(!Sfx.enabled));
    dom.helpBtn.addEventListener('click', () => openModal('helpModal'));

    dom.winNext.addEventListener('click', () => {
      if (state.level >= TOTAL_LEVELS) { closeModal('winModal'); return; }
      nextLevel();
    });
    dom.levelBtn.addEventListener('click', openLevels);
    dom.mapBtn.addEventListener('click', openLevels);
    // 关卡地图：点档位标签跳档
    dom.levelTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (!tab) return;
      Sfx.softTick();
      setActiveTier(Number(tab.dataset.tab));
    });
    // 点格子进关（锁着的关点不动）
    dom.levelPager.addEventListener('click', (e) => {
      const node = e.target.closest('[data-level]');
      if (!node) return;
      if (node.disabled) { Sfx.invalid(); return; }
      Sfx.softTick();
      startLevel(Number(node.dataset.level));
    });
    // 手指滑完一页：把标签条同步过来
    dom.levelPager.addEventListener('scroll', () => {
      clearTimeout(lvmScrollTimer);
      lvmScrollTimer = setTimeout(() => {
        const w = dom.levelPager.clientWidth || 1;
        const ti = Math.round(dom.levelPager.scrollLeft / w);
        if (ti !== lvmTier) setActiveTier(ti, true);
      }, 90);
    }, { passive: true });
    dom.levelPrev.addEventListener('click', () => { Sfx.softTick(); setActiveTier(lvmTier - 1); });
    dom.levelNext.addEventListener('click', () => { Sfx.softTick(); setActiveTier(lvmTier + 1); });
    // 转屏 / 视口变化：按新宽度重新对齐当前档
    global.addEventListener('resize', () => {
      if (dom.levelModal && !dom.levelModal.hidden) setActiveTier(lvmTier, true);
    });
    dom.loseUndo.addEventListener('click', () => { closeModal('loseModal'); undo(); });
    dom.loseRestart.addEventListener('click', () => { closeModal('loseModal'); restartDeal(); });

    document.querySelectorAll('[data-close]').forEach((b) => {
      b.addEventListener('click', () => closeModal(b.dataset.close));
    });

    // 点遮罩关闭
    ['helpModal', 'answerModal', 'winModal', 'loseModal', 'levelModal'].forEach((id) => {
      const m = $(id);
      m.addEventListener('pointerdown', (e) => { if (e.target === m) { stopDemo(); closeModal(id); } });
    });

    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      // 只保留 Esc：关掉浮层/取消选牌，避免用户被弹层困住（不对外宣传成快捷键）
      if (e.key !== 'Escape') return;
      if (!dom.shareGuide.hidden) { closeShareGuide(); return; }
      if (popup.open) { closeOpPopup(); return; }
      const open = ['helpModal', 'answerModal', 'winModal', 'loseModal', 'levelModal'].find((id) => !$(id).hidden);
      if (open) { stopDemo(); closeModal(open); return; }
      if (state.demo) { stopDemo(); return; }
      deselect();
    });

    // 首次手势解锁音频
    const unlock = () => { Sfx.unlock(); global.removeEventListener('pointerdown', unlock); global.removeEventListener('keydown', unlock); };
    global.addEventListener('pointerdown', unlock);
    global.addEventListener('keydown', unlock);
  }

  /* ---------------- 启动 ---------------- */

  /** 用合成 PointerEvent 走一遍“拖动 A 到 B”的交互（自检/演示用） */
  function simulateDrag(i, j, pointerType) {
    const a = state.cards[i], b = state.cards[j];
    if (!a || !b || !a.el || !b.el) return false;
    const ra = a.el.getBoundingClientRect();
    const rb = b.el.getBoundingClientRect();
    const ax = ra.left + ra.width / 2, ay = ra.top + ra.height / 2;
    const bx = rb.left + rb.width / 2, by = rb.top + rb.height / 2;
    const ev = (type, x, y) => new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, pointerId: 1, pointerType: pointerType || 'mouse', isPrimary: true,
      buttons: type === 'pointerup' ? 0 : 1,
    });
    // 自检辅助：把落点命中情况记进 debug 面板（?debug=1 时才写）
    if (DEBUG) {
      const probe = hitTest(bx, by, a.el);
      const at = document.elementFromPoint(bx, by);
      debugNote('drag 落点(' + Math.round(bx) + ',' + Math.round(by) + ') 命中='
        + (probe ? probe.display : '无') + ' 元素=' + (at ? (at.className || at.tagName) : 'null'));
    }
    a.el.dispatchEvent(ev('pointerdown', ax, ay));
    for (let s = 1; s <= 6; s++) {
      global.dispatchEvent(ev('pointermove', ax + (bx - ax) * s / 6, ay + (by - ay) * s / 6));
    }
    global.dispatchEvent(ev('pointerup', bx, by));
    return true;
  }

  /** ?then=undo|restart|hint|answers|deal —— 演示/自检用：过一会儿再触发某个操作 */
  function scheduleThen(params, delay) {
    const then = params.get('then');
    if (!then) return;
    setTimeout(() => {
      if (then === 'undo') undo();
      else if (then === 'restart') restartDeal();
      else if (then === 'hint') hint();
      else if (then === 'answers') showAnswers();
      else if (then === 'deal') newDeal({ shuffle: true });
      else if (then === 'next') nextLevel();
    }, delay);
  }

  async function start() {
    // URL 参数：?deal=3,3,8,8 &difficulty=hard &sound=off &demo=popup|win
    const params = new URLSearchParams(global.location.search);
    DEBUG = params.get('debug') === '1';
    if (DEBUG) {
      global.addEventListener('error', (e) => debugError('ERROR ' + e.message + ' @line' + e.lineno));
      global.addEventListener('unhandledrejection', (e) => debugError('REJECT ' + (e.reason && e.reason.message || e.reason)));
      setInterval(() => { debugTick(); }, 500);
    }
    // ?reset=1：清空闯关进度（自检/演示/想从头再来时用）
    if (params.get('reset') === '1') {
      LS.set('g24.level', '1');
      LS.set('g24.cleared', '0');
      LS.set('g24.bests', '{}');
    }

    // ?cleared=N：直接把“已通关数”铺到 N（截图/演示用）
    if (params.get('cleared') != null) {
      const n = Math.max(0, Math.min(TOTAL_LEVELS, Number(params.get('cleared')) || 0));
      LS.set('g24.cleared', String(n));
      LS.set('g24.level', String(Math.min(TOTAL_LEVELS, n + 1)));
    }

    // 闯关进度：从存档恢复；?level=N 可指定（自检/演示用）
    state.cleared = Math.max(0, Math.min(TOTAL_LEVELS, Number(LS.get('g24.cleared', 0)) || 0));
    const levelParam = params.get('level');
    const startAt = levelParam != null
      ? Math.max(1, Number(levelParam) || 1)
      : Math.max(1, Number(LS.get('g24.level', 1)) || 1);

    const intParam = params.get('integerOnly');
    state.ruleOverride = intParam != null;      // 调试参数优先，不被关卡规则覆盖
    setIntegerOnly(intParam == null ? LS.get('g24.integerOnly', '0') === '1' : intParam === '1', { silent: true });
    setSound(LS.get('g24.sound', '1') === '1');
    bind();
    setLevel(startAt, { force: levelParam != null });

    // H5 适配：视口高度、转屏、软键盘、地址栏伸缩都会触发重新定位
    H5.setup();
    H5.onViewportChange(() => {
      positionRing();
      updateRotateHint();
    });
    // 安装到桌面（Chrome/安卓）；微信内不显示
    H5.onInstallChange(updateInstallBtn);
    updateInstallBtn(H5.canInstall);
    updateRotateHint();
    // 微信：桥就绪后再解锁一次音频，并提示“首音偶发不出声”的兜底
    H5.onWeixinReady(() => { Sfx.unlock(); });
    // 离线缓存：file:// 或 http 非 localhost 会自动跳过并记录原因
    if (params.get('sw') !== 'off') {
      H5.registerServiceWorker({
        onUpdate: () => showBanner('新版本已就绪，下次打开自动生效 🔄'),
      }).then(async (ok) => {
        if (ok) await H5.inspectCache();
        // file:// 或 http 非 localhost 时注册不上是正常现象（浏览器安全策略），
        // 只在“本该能注册却失败”时才算异常。
        else if (DEBUG && /^https?:$/.test(global.location.protocol)
          && !/localhost|127\.0\.0\.1/.test(global.location.hostname)) {
          debugError('SW 未注册: ' + H5.swError);
        }
      });
    }
    // 触摸设备首次点按再解锁一次音频（iOS 上 pointerdown 偶尔拿不到手势上下文）
    if (H5.isTouch) {
      const unlockTouch = () => { Sfx.unlock(); global.removeEventListener('touchend', unlockTouch); };
      global.addEventListener('touchend', unlockTouch);
    }
    updateHud();

    const fixed = params.get('deal');
    if (fixed) {
      const vals = fixed.split(',').map((n) => Number(n.trim())).filter((n) => Number.isFinite(n) && n > 0);
      if (vals.length === 4) {
        if (intParam == null) setIntegerOnly(false, { silent: true });
        state.busy = true;
        state.values = vals;
        state.initialDeal = vals.slice();
        state.cards = vals.map((v) => makeCard(v, null));
        renderBoard(state.cards, { spawn: true });
        updateHud(); updateTimer();
        showBanner(levelName(state.level), null);
        state.busy = false;
      } else {
        await startLevel(state.level, { force: true });
      }
    } else {
      await newDeal({ values: levelDef(state.level).n, announce: false });
      flashBanner(levelName(state.level), 2200);
    }

    const demo = params.get('demo');
    const wantOp = params.get('op');
    if (demo === 'popup' || demo === 'ring') {
      setTimeout(() => { if (state.cards.length >= 2) openOpPopup(state.cards[0], state.cards[1]); }, 700);
    } else if (demo === 'ringcancel') {
      // 打开圆环 → 点一下遮罩（= 取消），验证“点外面就放弃”
      setTimeout(() => {
        if (state.cards.length >= 2) openOpPopup(state.cards[0], state.cards[1]);
        setTimeout(() => {
          const ev = new PointerEvent('click', { bubbles: true, cancelable: true, composed: true });
          dom.ringScrim.dispatchEvent(ev);
        }, 900);
      }, 600);
    } else if (demo === 'share') {
      setTimeout(shareGame, 600);
    } else if (demo === 'idle') {
      scheduleThen(params, 600);
    } else if (demo === 'drag' || demo === 'dragmerge') {
      setTimeout(() => {
        // ?touch=1 时用触摸指针类型跑一遍，验证手指拖拽路径（含抬牌偏移）
        const touchDemo = params.get('touch') === '1' ? 'touch' : 'mouse';
        simulateDrag(0, 1, touchDemo);
        if (demo === 'dragmerge') {
          setTimeout(() => {
            const op = wantOp || '+';
            const btn = dom.popup.querySelector(`.op-ring__item[data-op="${op}"]:not(:disabled)`);
            if (btn) btn.click();
            scheduleThen(params, 1600);
          }, 800);
        }
      }, 800);
    } else if (demo === 'lose') {
      setTimeout(() => {
        if (popup.open) closeOpPopup({ silent: true });
        state.cards = [makeCard(F.of(21), '7 × 3', '*')];
        state.moves = 3;
        state.timerStarted = true;
        state.elapsedMs = 26000;
        renderBoard(state.cards, { spawn: true });
        state.busy = false;
        lose(state.cards[0]);
      }, 700);
    } else if (demo === 'win') {
      setTimeout(() => {
        if (popup.open) closeOpPopup({ silent: true });
        state.cards = [makeCard(F.of(24), '8 ÷ (3 − 8 ÷ 3)', '/')];
        state.moves = 4;
        state.timerStarted = true;
        state.elapsedMs = 41000;
        renderBoard(state.cards, { spawn: true });
        state.busy = false;
        win();
      }, 700);
    } else if (demo === 'nextlevel') {
      setTimeout(async () => {
        await autoDemo();
        await wait(1500);
        nextLevel();
      }, 500);
    } else if (demo === 'levels') {
      setTimeout(openLevels, 600);
    } else if (demo === 'answers') {
      setTimeout(showAnswers, 600);
    } else if (demo === 'auto') {
      setTimeout(autoDemo, 600);
    }
  }

  G24.app = {
    state, popup, T, newDeal, executeMerge, undo, hint, showAnswers, autoDemo,
    openOpPopup, closeOpPopup, startLevel, nextLevel, setLevel, levelDef, tierOf,
    openLevels, renderLevelList, levels: LV, TOTAL_LEVELS, unlockedTo,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof window !== 'undefined' ? window : globalThis);
