/* =========================================================
   game.js —— 主玩法页（demo：单关可玩）
   逻辑层全部复用 H5 版的 utils，这一层只做三件事：
     1. 把牌算成绝对坐标（拖拽吸附要用）
     2. 接住 WXS 抛上来的落点，做命中判定
     3. 合成、重排、判胜负 / 判死局
   注意：Fraction 对象不能进 setData，逻辑数据留在 this.cards
   ========================================================= */
const G24 = require('../../utils/g24.js');
const Progress = require('../../utils/progress.js');

const F = G24.Fraction;
const Solver = G24.Solver;
const LEVELS = G24.LEVELS;

const OPS = [
  { key: '+', sym: '+' },
  { key: '-', sym: '−' },
  { key: '*', sym: '×' },
  { key: '/', sym: '÷' },
];

const SNAP = 0.85; // 吸附半径 = 牌宽 × 0.85
const GAP = 12;    // 牌间距

Page({
  data: {
    cards: [],
    cardSize: 80,
    ops: OPS,
    pending: null,
    status: 'playing',
    levelName: '',
    tierName: '',
    isLast: false,
    expr: '',
    solCount: 0,
    topPad: 24,
    boardH: 300,
    dead: false,
  },

  onLoad(options) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.ww = info.windowWidth;
    const cardSize = Math.min(88, Math.floor((this.ww - 64 - GAP * 3) / 4));
    this.setData({
      cardSize,
      topPad: (info.statusBarHeight || 20) + 16,
      boardH: Math.round(cardSize * 2.4),
    });
    // 从关卡地图点进来会带 ?level=全局索引；直接打开则从第一关开始
    const gi = Number(options && options.level);
    const valid = Number.isInteger(gi) && gi >= 0 && gi < LEVELS.levels.length;
    this.loadLevel(valid ? gi : 0);
  },

  /* ---------- 关卡 ---------- */

  loadLevel(index) {
    const lv = LEVELS.levels[index];
    const tier = LEVELS.tiers[lv.t] || { name: '' };
    this.levelIndex = index;
    this.rule = { integerOnly: lv.r === 'int' };
    this.setData({
      levelName: `第 ${index + 1} 关`,
      tierName: tier.name,
      isLast: index === LEVELS.levels.length - 1,
      status: 'playing',
      expr: '',
      pending: null,
      dead: false,
      solCount: lv.sol,
    });
    const cards = lv.n.map((v, k) => {
      const f = F.of(v);
      return { id: `c${index}_${k}`, v: f, disp: f.toDisplay() };
    });
    this.layout(cards);
  },

  /* ---------- 布局：牌排成一行居中 ---------- */

  layout(list) {
    const size = this.data.cardSize;
    const n = list.length;
    const total = n * size + (n - 1) * GAP;
    const startX = Math.max(16, (this.ww - total) / 2);
    const y = Math.round((this.data.boardH - size) / 2);
    list.forEach((c, i) => {
      c.x = Math.round(startX + i * (size + GAP));
      c.y = y;
    });
    this.cards = list;
    this.setData({
      cards: list.map((c) => ({ id: c.id, disp: c.disp, x: c.x, y: c.y })),
    });
  },

  /* ---------- 拖拽落点（WXS 调上来） ----------
     WXS 的 callMethod 只收一个参数对象，所以这里是 {idx, dx, dy} */

  onDrop(payload) {
    if (this.data.status !== 'playing' || this.data.pending) return;
    if (!payload) return;
    const i = Number(payload.idx);
    const dx = Number(payload.dx) || 0;
    const dy = Number(payload.dy) || 0;
    const cards = this.cards;
    const from = cards[i];
    if (!from) return;

    const size = this.data.cardSize;
    const cx = from.x + size / 2 + dx;
    const cy = from.y + size / 2 + dy;
    const R = size * SNAP;

    // 用中心点距离判定，比矩形相交宽容，手感更顺
    let hit = -1;
    let best = Infinity;
    cards.forEach((c, k) => {
      if (k === i) return;
      const ox = c.x + size / 2 - cx;
      const oy = c.y + size / 2 - cy;
      const d = Math.sqrt(ox * ox + oy * oy);
      if (d < R && d < best) {
        best = d;
        hit = k;
      }
    });
    if (hit < 0) return;

    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' });
    this.setData({
      pending: {
        from: i,
        to: hit,
        fromDisp: from.disp,
        toDisp: cards[hit].disp,
      },
    });
  },

  /* ---------- 选运算符 ---------- */

  applyOp(e) {
    const key = e.currentTarget.dataset.key;
    const p = this.data.pending;
    if (!p) return;

    const cards = this.cards;
    const a = cards[p.from];
    const b = cards[p.to];

    let res;
    let text;
    try {
      const op = Solver.OP_BY_KEY[key];
      res = op.apply(a.v, b.v);
      text = `${a.v.toDisplay()} ${op.sym} ${b.v.toDisplay()} = ${res.toDisplay()}`;
    } catch (err) {
      wx.showToast({ title: '这一步算不了', icon: 'none' });
      return;
    }

    if (this.rule.integerOnly && !res.isInteger()) {
      wx.showToast({ title: '本关只许整数', icon: 'none' });
      return;
    }

    const merged = { id: `m${Date.now()}`, v: res, disp: res.toDisplay() };
    const rest = cards.filter((_, k) => k !== p.from && k !== p.to);
    // 插回被合并的靠前位置，新牌不会视觉上"跳"到最右边
    rest.splice(Math.min(p.from, p.to), 0, merged);

    this.setData({ pending: null, expr: text });
    this.layout(rest);
    this.judge(rest);
  },

  cancelPending() {
    this.setData({ pending: null });
  },

  noop() {},

  /* ---------- 判胜负 / 判死局 ---------- */

  judge(list) {
    if (list.length === 1) {
      const ok = list[0].v.eq(F.of(24));
      if (ok) Progress.markCleared(this.levelIndex); // 进度只前进不后退
      this.setData({ status: ok ? 'win' : 'lose' });
      if (ok && wx.vibrateShort) wx.vibrateShort({ type: 'heavy' });
      return;
    }
    // 剩下的牌无论怎么合都到不了 24，提前告诉玩家别白试
    if (!Solver.isSolvable(list.map((c) => c.v), this.rule)) {
      this.setData({ dead: true });
    }
  },

  retry() {
    this.loadLevel(this.levelIndex);
  },

  nextLevel() {
    const next = this.levelIndex + 1;
    if (next >= LEVELS.levels.length) {
      this.goBack();
      return;
    }
    this.loadLevel(next);
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pages/levels/levels' }),
    });
  },

  onShareAppMessage() {
    return { title: '24Game · 拖两张牌合成 24 点', path: '/pages/game/game' };
  },
});
