/* =========================================================
   game.js —— 主玩法页（照 H5 版重写 UI 层）
   逻辑层仍然全部复用 utils（分数 / 求解 / 关卡数据），这一层只做：
     1. 按屏幕算牌尺寸，排成「两张一行」的牌桌
     2. 接住 WXS 抛上来的落点，做命中判定（手指压在谁身上就是谁）
     3. 合成 / 撤销 / 提示 / 答案 / 计时 / 判胜负
   注意：Fraction 对象不能进 setData，逻辑数据留在 this.cards
   ========================================================= */
const G24 = require('../../utils/g24.js');
const Progress = require('../../utils/progress.js');
const Nav = require('../../utils/nav.js');
const Sfx = require('../../utils/sfx.js');
const Fx = require('../../utils/fx.js');
const { fmtTime } = require('../../utils/format.js');

const F = G24.Fraction;
const Solver = G24.Solver;
const LEVELS = G24.LEVELS;

/* 布局常量：和 game.wxss 里的 padding 必须对得上 */
const GAP = 12;          // 牌间距
const RATIO = 1.42;      // 牌宽高比（H5 版一致）
const TABLE_PAD = 14;    // 牌桌内边距
const BOARD_PAD = 10;    // 棋盘内边距
/* 顶栏内容高度（不含状态栏）：导航条 44 + 间距 6 + 记分牌 38
   + 间距 6 + 工具行 30 + 底内边距 8 —— 必须和 game.wxss 对上 */
const TOPBAR_H = 132;
const DOCK_H = 84;       // 底部工具坞高度（不含安全区）

const SUITS = ['♠', '♥', '♦', '♣'];
const RED_SUITS = { '♥': 1, '♦': 1 };

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

Page({
  data: {
    /* 牌桌 */
    cards: [],
    cardW: 120,
    cardH: 170,
    boardW: 340,
    boardH: 420,
    fsC: 50,      // 牌心字号
    fsV: 17,      // 角标数字字号
    fsS: 14,      // 角标花色字号
    padX: 9,      // 角标左右内缩
    padY: 8,      // 角标上下内缩
    ww: 375,
    wh: 667,

    /* 顶栏 / 坞 */
    topPad: 24,
    toolsTop: 118,    // 工具行上沿：必须 ≥ 胶囊下沿
    navBottom: 64,    // 胶囊下沿
    bannerBottom: 110,
    soundOn: true,
    levelNo: 1,
    tierName: '',
    timer: '00:00',
    moves: 0,
    best: '--:--',

    /* 交互状态 */
    ring: null,          // 运算符圆环 {x, y, from, to}
    status: 'playing',   // playing | win | lose
    modal: '',           // '' | 'win' | 'lose' | 'answer' | 'help'
    answers: [],
    winStats: '',
    loseValue: '0',
    canUndo: false,
    dead: false,
    shaking: false,
    banner: null,
    expr: '',
  },

  /* =========================================================
     生命周期
     ========================================================= */

  onLoad(options) {
    /* 状态栏 / 胶囊按钮的位置都自己算（开了 navigationStyle: custom） */
    const nav = Nav.metrics();
    const ww = nav.ww;
    const wh = nav.wh;
    const statusBar = nav.statusBar;
    const safeBottom = nav.safeBottom;
    /* 第一行（招牌）和胶囊垂直居中对齐；胶囊右边不放东西 */
    const topPad = Nav.topPad(44);
    /* 顶栏从屏幕顶端算起的实际高度：上内边距 + 内容 */
    const topbarBottom = topPad + TOPBAR_H;

    /* 牌能占多大：宽度够放两张、高度够放两行，取小的那个 */
    const tableH = Math.max(280, wh - topbarBottom - DOCK_H - safeBottom);
    const boardW = ww - TABLE_PAD * 2;
    const boardH = tableH - TABLE_PAD * 2;
    const availW = boardW - BOARD_PAD * 2 - GAP;
    const availH = boardH - BOARD_PAD * 2 - GAP;
    const cardW = Math.max(72, Math.floor(Math.min(152, availW / 2, availH / 2 / RATIO)));
    const cardH = Math.round(cardW * RATIO);

    this.ww = ww;
    this.wh = wh;
    this.uid = 0;
    this.moves = 0;
    this.elapsed = 0;
    this.history = [];
    this.selIndex = -1;
    /* 牌桌在屏幕上的位置：先按常量估一个，onReady 再量准 */
    this.boardRect = { left: TABLE_PAD, top: topbarBottom + TABLE_PAD };

    this.setData({
      ww,
      wh,
      cardW,
      cardH,
      boardW,
      boardH,
      fsC: Math.round(cardW * 0.42),
      fsV: Math.max(12, Math.round(cardW * 0.145)),
      fsS: Math.max(10, Math.round(cardW * 0.115)),
      padX: Math.max(7, Math.round(cardW * 0.077)),
      padY: Math.max(6, Math.round(cardW * 0.068)),
      topPad,
      /* 工具行的上沿（用来保证它整行都在胶囊下面） */
      toolsTop: topPad + 44 + 6 + 38 + 6,
      navBottom: nav.statusBar + nav.navH,
      bannerBottom: DOCK_H + safeBottom + 16,
      soundOn: Sfx.enabled !== false,
    });

    /* 带 ?level=全局索引 就进那一关，否则接着打 */
    const gi = Number(options && options.level);
    const valid = Number.isInteger(gi) && gi >= 0 && gi < LEVELS.levels.length;
    this.from = (options && options.from) || 'home';
    this.loadLevel(valid ? gi : Math.min(Progress.load().cleared, LEVELS.levels.length - 1));
  },

  onReady() {
    /* canvas 节点要等渲染完成才拿得到，onReady 是最早时机。
       顺便量一次牌桌：一是粒子要画在牌的屏幕位置上，
       二是用真实尺寸校正布局（估算值和真值只差几像素） */
    wx.createSelectorQuery()
      .select('#fxCanvas')
      .fields({ node: true, size: true })
      .select('.board')
      .boundingClientRect()
      .exec((res) => {
        const cv = res && res[0];
        const br = res && res[1];

        if (br) {
          this.boardRect = { left: br.left, top: br.top };
          const w = Math.round(br.width);
          const h = Math.round(br.height);
          if (Math.abs(w - this.data.boardW) > 1 || Math.abs(h - this.data.boardH) > 1) {
            this.setData({ boardW: w, boardH: h }, () => this.layout(this.cards));
          }
        }

        if (!cv || !cv.node) return;
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const dpr = info.pixelRatio || 2;
        const canvas = cv.node;
        canvas.width = cv.width * dpr;
        canvas.height = cv.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        Fx.attach(canvas, ctx, cv.width, cv.height);
      });
  },

  onShow() {
    if (this.data.status === 'playing' && !this.timerId) this.resumeTimer();
  },

  onHide() {
    this.stopTimer();
  },

  onUnload() {
    this.stopTimer();
    clearTimeout(this.flashTimer);
    clearTimeout(this.hintTimer);
    Fx.detach();
  },

  /* =========================================================
     关卡
     ========================================================= */

  loadLevel(index) {
    const lv = LEVELS.levels[index];
    if (!lv) return;
    const tier = LEVELS.tiers[lv.t] || { name: '', rule: '' };

    this.levelIndex = index;
    this.tierIndex = lv.t;
    this.rule = { integerOnly: lv.r === 'int' };
    this.history = [];
    this.moves = 0;
    this.elapsed = 0;
    this.selIndex = -1;

    const cards = lv.n.map((v) => this.makeCard(F.of(v)));

    this.setData({
      levelNo: index + 1,
      tierName: tier.name,
      isLast: index === LEVELS.levels.length - 1,
      status: 'playing',
      modal: '',
      ring: null,
      dead: false,
      moves: 0,
      timer: '00:00',
      canUndo: false,
      expr: '',
      banner: null,
      winStats: '',
      loseValue: '0',
      answers: [],
      best: this.bestText(lv.t),
    });

    Fx.clear();
    this.layout(cards, true);
    this.restartTimer();
    Sfx.deal();
  },

  bestText(tier) {
    const sec = Progress.loadBest(tier);
    return sec === null ? '--:--' : fmtTime(sec);
  },

  /** 造一张牌：数值 + 花色（花色只影响颜色，不参与运算） */
  makeCard(v, expr) {
    const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
    this.uid += 1;
    return {
      id: 'c' + this.uid,
      v,
      disp: v.toDisplay(),
      expr: expr || null,
      suit,
      red: !!RED_SUITS[suit],
    };
  },

  /* =========================================================
     布局：两张一行，整块居中
     H5 版是 flex-wrap + max-width 两倍牌宽，这里用绝对坐标复刻，
     好处是重排时 left/top 有过渡，等于免费的 FLIP 动画
     ========================================================= */

  layout(list, spawn) {
    if (!list || !list.length) return;
    const { cardW, cardH, boardW, boardH } = this.data;

    const rows = [];
    for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2));
    const blockH = rows.length * cardH + (rows.length - 1) * GAP;
    const top0 = Math.round((boardH - blockH) / 2);

    rows.forEach((row, r) => {
      const rowW = row.length * cardW + (row.length - 1) * GAP;
      const startX = Math.round((boardW - rowW) / 2);
      row.forEach((c, i) => {
        c.x = startX + i * (cardW + GAP);
        c.y = top0 + r * (cardH + GAP);
        c.spawn = !!spawn;
      });
    });

    this.cards = list;
    this.sync();
  },

  /** 把逻辑层数据摊平成视图数据（Fraction 不进 setData） */
  sync() {
    const { cardW, cardH, fsC } = this.data;
    this.setData({
      cards: this.cards.map((c) => {
        const cls = [
          c.red ? 'card--red' : '',
          c.sel ? 'is-selected' : '',
          c.pending ? 'is-pending' : '',
          c.target ? 'is-target' : '',
          c.won ? 'is-won' : '',
          c.lost ? 'is-lost' : '',
          c.hint ? 'is-hint' : '',
        ].filter(Boolean).join(' ');

        return {
          id: c.id,
          disp: c.disp,
          suit: c.suit,
          cls,
          spawn: !!c.spawn,
          /* 三字符以上（8/3、12/5）收小字号，否则会顶出牌边 */
          fsc: c.disp.length > 2 ? Math.round(fsC * 0.66) : fsC,
          st: `left:${c.x}px;top:${c.y}px;width:${cardW}px;height:${cardH}px`,
        };
      }),
    });
  },

  /** 牌心在屏幕坐标系里的位置（特效要用） */
  centerOf(card) {
    const r = this.boardRect;
    return {
      x: r.left + card.x + this.data.cardW / 2,
      y: r.top + card.y + this.data.cardH / 2,
    };
  },

  /* =========================================================
     拖拽 / 点选
     ========================================================= */

  /** WXS 按下时回调：解锁音频 + 拿起音效 */
  onGrab() {
    Sfx.unlock();
    Sfx.pickup();
  },

  /** 手指落点在棋盘坐标系里的位置 */
  fingerPoint(p) {
    const r = this.boardRect;
    if (typeof p.x === 'number' && typeof p.y === 'number') {
      return { x: p.x - r.left, y: p.y - r.top };
    }
    /* 兜底（也方便测试）：从牌心加位移推算 */
    const c = this.cards[Number(p.idx)];
    if (!c) return { x: -1, y: -1 };
    return {
      x: c.x + this.data.cardW / 2 + (Number(p.dx) || 0),
      y: c.y + this.data.cardH / 2 + (Number(p.dy) || 0),
    };
  },

  /** 手指压在哪张牌上（H5 版用 elementFromPoint，这里等价地做矩形命中） */
  hitTest(selfIdx, px, py) {
    const { cardW, cardH } = this.data;
    for (let k = 0; k < this.cards.length; k++) {
      if (k === selfIdx) continue;
      const c = this.cards[k];
      if (px >= c.x && px <= c.x + cardW && py >= c.y && py <= c.y + cardH) return k;
    }
    return -1;
  },

  /** 松手（WXS 抛上来）：{idx, dx, dy, x, y} */
  onDrop(p) {
    if (!p) return;
    if (this.data.status !== 'playing' || this.data.ring || this.busy) return;
    const i = Number(p.idx);
    if (!this.cards[i]) return;

    const pt = this.fingerPoint(p);
    const hit = this.hitTest(i, pt.x, pt.y);
    if (hit < 0) {
      Sfx.release();
      return;
    }
    this.openRing(i, hit);
  },

  /** 纯点击：依次点两张牌也能合成 */
  onTap(p) {
    if (!p) return;
    if (this.data.status !== 'playing' || this.data.ring || this.busy) return;
    const i = Number(p.idx);
    const c = this.cards[i];
    if (!c) return;

    if (this.selIndex === i) {
      this.selIndex = -1;
      this.cards.forEach((x) => { x.sel = false; });
      this.sync();
      Sfx.softTick();
      return;
    }
    if (this.selIndex < 0) {
      this.selIndex = i;
      this.cards.forEach((x) => { x.sel = false; });
      c.sel = true;
      this.sync();
      Sfx.hoverTick();
      return;
    }
    const first = this.selIndex;
    this.selIndex = -1;
    this.cards.forEach((x) => { x.sel = false; });
    this.openRing(first, i);
  },

  /* =========================================================
     运算符圆环
     ========================================================= */

  openRing(i, j) {
    const a = this.cards[i];
    const b = this.cards[j];
    if (!a || !b) return;

    this.selIndex = -1;
    this.cards.forEach((c) => { c.sel = false; c.pending = false; });
    a.pending = true;
    b.pending = true;

    /* 圆心 = 两张牌中点，夹在安全范围内，圆环不会被屏幕边缘切掉。
       132 和 H5 版同一个值：83 是圆环实际半径，多留的余量让它不压顶栏 */
    const ca = this.centerOf(a);
    const cb = this.centerOf(b);
    const RING_SAFE = 132;
    const x = clamp((ca.x + cb.x) / 2, RING_SAFE, Math.max(RING_SAFE, this.data.ww - RING_SAFE));
    const y = clamp((ca.y + cb.y) / 2, RING_SAFE, Math.max(RING_SAFE, this.data.wh - RING_SAFE));

    this.sync();
    Sfx.snap();
    Sfx.popupOpen();
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' });

    this.setData({ ring: { x, y, from: i, to: j } });
  },

  cancelPending() {
    if (!this.data.ring) return;
    Sfx.popupClose();
    this.cards.forEach((c) => { c.pending = false; });
    this.sync();
    this.setData({ ring: null });
  },

  applyOp(e) {
    const key = e.currentTarget.dataset.key;
    const r = this.data.ring;
    if (!r) return;
    const a = this.cards[r.from];
    const b = this.cards[r.to];
    if (!a || !b) {
      this.setData({ ring: null });
      return;
    }

    let res;
    let text;
    try {
      const op = Solver.OP_BY_KEY[key];
      res = op.apply(a.v, b.v);
      text = `${a.v.toDisplay()} ${op.sym} ${b.v.toDisplay()} = ${res.toDisplay()}`;
    } catch (err) {
      Sfx.invalid();
      this.shake();
      this.flash('这一步算不了', 'warn');
      return;
    }

    if (this.rule.integerOnly && !res.isInteger()) {
      Sfx.invalid();
      this.shake();
      this.flash('本关只许整数', 'warn');
      return;
    }

    /* 撤销快照：记下合成前的牌面 */
    this.history.push({
      cards: this.cards.map((c) => ({
        id: c.id, v: c.v, disp: c.disp, suit: c.suit, red: c.red,
      })),
      moves: this.moves,
    });

    const ca = this.centerOf(a);
    const cb = this.centerOf(b);
    const mx = (ca.x + cb.x) / 2;
    const my = (ca.y + cb.y) / 2;

    const merged = this.makeCard(res, text);
    merged.spawn = true;
    const rest = this.cards.filter((_, k) => k !== r.from && k !== r.to);
    /* 插回被合并的靠前位置，新牌不会视觉上「跳」到最右边 */
    rest.splice(Math.min(r.from, r.to), 0, merged);

    this.moves += 1;
    this.setData({
      ring: null,
      expr: text,
      moves: this.moves,
      canUndo: true,
      dead: false,
    });
    this.layout(rest);

    Sfx.choose();
    Sfx.merge();
    Fx.burst(mx, my);
    Fx.ring(mx, my, { size: this.data.cardW * 1.2, color: '#ff7a6b' });
    Fx.floatText(mx, my - 10, text, { size: text.length > 12 ? 15 : 18 });
    setTimeout(() => Sfx.spawn(), 120);

    this.judge(rest);
  },

  /* =========================================================
     判胜负 / 判死局
     ========================================================= */

  judge(list) {
    if (list.length === 1) {
      const ok = list[0].v.eq(F.of(24));
      this.stopTimer();

      if (ok) {
        list[0].won = true;
        Progress.markCleared(this.levelIndex); // 进度只前进不后退
        const isBest = Progress.saveBest(this.tierIndex, this.elapsed);
        this.setData({
          status: 'win',
          modal: 'win',
          canUndo: false,
          best: this.bestText(this.tierIndex),
          winStats: `${fmtTime(this.elapsed)} · ${this.moves} 步${isBest ? ' · 新纪录' : ''}`,
        });
        if (wx.vibrateShort) wx.vibrateShort({ type: 'heavy' });
        Sfx.win();
        const c = this.centerOf(list[0]);
        Fx.confetti({ count: 90 });
        Fx.stamp(c.x, c.y, '24', { size: 64 });
      } else {
        list[0].lost = true;
        this.setData({
          status: 'lose',
          modal: 'lose',
          loseValue: list[0].disp,
        });
        Sfx.dead();
        this.shake();
      }
      this.sync();
      return;
    }

    /* 剩下的牌无论怎么合都到不了 24，提前告诉玩家别白试 */
    if (!Solver.isSolvable(list.map((c) => c.v), this.rule)) {
      this.setData({ dead: true });
      Sfx.dead();
      this.shake();
      this.flash('剩下的牌凑不出 24 了', 'warn');
    }
  },

  /* =========================================================
     工具栏
     ========================================================= */

  undo() {
    const h = this.history.pop();
    if (!h) return;
    this.cards = h.cards.map((c) => ({
      id: c.id, v: c.v, disp: c.disp, suit: c.suit, red: c.red,
    }));
    this.moves = h.moves;
    this.setData({
      status: 'playing',
      modal: '',
      dead: false,
      expr: '',
      moves: this.moves,
      canUndo: this.history.length > 0,
    });
    this.layout(this.cards);
    if (!this.timerId) this.resumeTimer();
    Sfx.undo();
  },

  hint() {
    if (this.data.status !== 'playing') return;
    const steps = Solver.findSteps(this.cards.map((c) => c.v), this.rule);
    if (!steps || !steps.length) {
      Sfx.invalid();
      this.flash('这局已经凑不出 24 了', 'warn');
      return;
    }
    const s = steps[0];
    const i = Math.min(s.i, s.j);
    const j = Math.max(s.i, s.j);
    this.cards.forEach((c, k) => { c.hint = (k === i || k === j); });
    this.sync();
    Sfx.softTick();
    this.flash(`试试 ${this.cards[i].disp} 和 ${this.cards[j].disp} 这一对`);

    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => {
      this.cards.forEach((c) => { c.hint = false; });
      this.sync();
    }, 1800);
  },

  answers() {
    if (this.data.status !== 'playing') return;
    const list = Solver.solutions(this.cards.map((c) => c.v), 8, this.rule);
    this.setData({
      modal: 'answer',
      answers: list.length ? list : ['这局已经凑不出 24 了'],
    });
  },

  closeModal() {
    this.setData({ modal: '' });
  },

  openHelp() {
    this.setData({ modal: 'help' });
  },

  toggleSound() {
    const on = !this.data.soundOn;
    Sfx.setEnabled(on);
    Sfx.unlock();
    this.setData({ soundOn: on });
    if (on) Sfx.softTick();
  },

  retry() {
    this.loadLevel(this.levelIndex);
  },

  nextLevel() {
    const next = this.levelIndex + 1;
    if (next >= LEVELS.levels.length) {
      this.openLevels();
      return;
    }
    this.loadLevel(next);
  },

  openLevels() {
    if (this.from === 'levels') {
      wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/levels/levels' }) });
      return;
    }
    wx.redirectTo({ url: '/pages/levels/levels' });
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pages/home/home' }),
    });
  },

  /* =========================================================
     计时 / 提示条 / 震屏
     ========================================================= */

  restartTimer() {
    this.stopTimer();
    this.startedAt = Date.now();
    this.elapsed = 0;
    this.startTimer();
  },

  resumeTimer() {
    this.startedAt = Date.now() - this.elapsed * 1000;
    this.startTimer();
  },

  startTimer() {
    this.stopTimer();
    this.timerId = setInterval(() => {
      this.elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
      const t = fmtTime(this.elapsed);
      if (t !== this.data.timer) this.setData({ timer: t });
    }, 500);
  },

  stopTimer() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  },

  /** 底部胶囊提示条 */
  flash(text, kind) {
    clearTimeout(this.flashTimer);
    this.setData({ banner: { text, kind: kind || 'info' } });
    this.flashTimer = setTimeout(() => {
      this.setData({ banner: null });
    }, 2400);
  },

  shake() {
    if (this.data.shaking) return;
    this.setData({ shaking: true });
    setTimeout(() => this.setData({ shaking: false }), 420);
  },

  noop() {},

  onShareAppMessage() {
    return {
      title: `24Game · 第 ${this.data.levelNo} 关，你能凑出 24 吗？`,
      path: `/pages/game/game?level=${this.levelIndex}`,
    };
  },
});
