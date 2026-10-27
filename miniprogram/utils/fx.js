/* =========================================================
   fx.js —— 视觉特效层（粒子 / 光环 / 飘字 / 盖章 / 彩带）
   移植自 H5 版 js/fx.js，但驱动方式换了：

     H5  ：每个粒子一个 DOM 元素 + element.animate()
     小程序：一块全屏 canvas，所有粒子画在同一张画布上

   为什么不用 view + CSS animation：粒子一次几十个，
   用 setData 增删会频繁跨层通信，正好是小程序最怕的。
   canvas 只在有粒子时跑 rAF，画完自动停，不耗电。

   对外暴露：Fx（单例，attach 之后才真正工作）
   ========================================================= */

const PALETTE = ['#ffd166', '#ef476f', '#06d6a0', '#8ecae6', '#f4c260', '#ffffff'];

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

/** 分段线性插值：segs = [[t0,v0],[t1,v1],...] */
function seg(t, segs) {
  if (t <= segs[0][0]) return segs[0][1];
  for (let i = 1; i < segs.length; i++) {
    const [t1, v1] = segs[i];
    const [t0, v0] = segs[i - 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0 || 1);
      return v0 + (v1 - v0) * k;
    }
  }
  return segs[segs.length - 1][1];
}

const Fx = {
  canvas: null,
  ctx: null,
  w: 0,
  h: 0,
  parts: [],
  raf: null,
  running: false,
  last: 0,
  reduced: false,

  /** 绑定 canvas（页面 onReady 后调用） */
  attach(canvas, ctx, w, h, opts) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.w = w;
    this.h = h;
    this.reduced = !!(opts && opts.reduced);
  },

  ready() {
    return !!(this.canvas && this.ctx);
  },

  /** 减少动效时砍掉一部分粒子数 */
  _n(n) {
    return this.reduced ? Math.max(3, Math.round(n * 0.35)) : n;
  },

  /* ---------- 五种效果 ---------- */

  /** 合成撞击：粒子向四周爆开 */
  burst(x, y, opts) {
    if (!this.ready()) return;
    opts = opts || {};
    const count = this._n(opts.count || 24);
    const colors = opts.colors || PALETTE;
    const power = opts.power || 1;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = (40 + Math.random() * 120) * power;
      const dur = (this.reduced ? 0.2 : 0.52) + Math.random() * 0.42;
      this._push({
        kind: 'dot',
        x0: x,
        y0: y,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist + 30,
        size: 4 + Math.random() * 8,
        color: colors[i % colors.length],
        rot: 0,
        vrot: Math.random() * 540 - 270,
        square: Math.random() < 0.5,
        life: dur,
        max: dur,
      });
    }
  },

  /** 撞击光环 */
  ring(x, y, opts) {
    if (!this.ready()) return;
    opts = opts || {};
    const dur = this.reduced ? 0.18 : 0.46;
    this._push({
      kind: 'ring',
      x0: x,
      y0: y,
      size: opts.size || 60,
      color: opts.color || '#0b8f6d',
      life: dur,
      max: dur,
    });
  },

  /** 算式飘字，例如 "7 + 5 = 12" */
  floatText(x, y, text, opts) {
    if (!this.ready()) return;
    opts = opts || {};
    const dur = this.reduced ? 0.42 : 1;
    this._push({
      kind: 'text',
      x0: x,
      y0: y,
      text: String(text),
      size: opts.size || 18,
      color: opts.color || '#0b8f6d',
      life: dur,
      max: dur,
    });
  },

  /** 大字盖章（胜利时 "24" 砸在牌上） */
  stamp(x, y, text, opts) {
    if (!this.ready()) return;
    opts = opts || {};
    const dur = this.reduced ? 0.5 : (opts.ms || 1.3) / 1000;
    this._push({
      kind: 'stamp',
      x0: x,
      y0: y,
      text: String(text),
      size: opts.size || 64,
      color: opts.color || '#0b8f6d',
      life: dur,
      max: dur,
    });
  },

  /** 彩带雨：从屏幕上方落满 */
  confetti(opts) {
    if (!this.ready()) return;
    opts = opts || {};
    const count = this._n(opts.count || 90);
    const w = this.w;
    const h = this.h;
    for (let i = 0; i < count; i++) {
      const dur = (this.reduced ? 0.9 : 2.2) + Math.random() * 1.8;
      const delay = Math.random() * 0.5;
      this._push({
        kind: 'confetti',
        x0: Math.random() * w,
        y0: -20 - Math.random() * h * 0.4,
        dx: (Math.random() - 0.5) * 220,
        dy: h * 1.15,
        w: 6 + Math.random() * 8,
        h: 10 + Math.random() * 12,
        color: PALETTE[i % PALETTE.length],
        rot: Math.random() * Math.PI * 2,
        vrot: (720 + Math.random() * 720) * Math.PI / 180,
        delay,
        dur,
        life: dur + delay,
        max: dur + delay,
      });
    }
  },

  /* ---------- 粒子池与渲染循环 ---------- */

  _push(p) {
    this.parts.push(p);
    this._ensureLoop();
  },

  _ensureLoop() {
    if (this.running) return;
    if (!this.canvas || typeof this.canvas.requestAnimationFrame !== 'function') return;
    this.running = true;
    this.last = Date.now();
    this.raf = this.canvas.requestAnimationFrame(() => this._loop());
  },

  _loop() {
    // 页面销毁后 canvas 会失效，但已排队的回调还会进来一次
    if (!this.ready()) {
      this.running = false;
      return;
    }
    const now = Date.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.05) dt = 0.05; // 掉帧保护，避免一帧跳太远

    const alive = [];
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life > 0) alive.push(p);
    }
    this.parts = alive;

    try {
      this._draw();
    } catch (e) {
      this.parts = [];
      this.running = false;
      return;
    }

    if (this.parts.length && typeof this.canvas.requestAnimationFrame === 'function') {
      this.raf = this.canvas.requestAnimationFrame(() => this._loop());
    } else {
      this.running = false;
      try { this.ctx.clearRect(0, 0, this.w, this.h); } catch (e) { /* 忽略 */ }
    }
  },

  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      const t = clamp01(1 - p.life / p.max);

      if (p.kind === 'dot') {
        const e = easeOut(t);
        const x = p.x0 + p.dx * e;
        const y = p.y0 + p.dy * e;
        const scale = 1 - 0.8 * t;
        ctx.globalAlpha = 1 - Math.pow(t, 1.6);
        ctx.fillStyle = p.color;
        const s = p.size * scale;
        if (p.square) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate((p.rot + p.vrot * t) * Math.PI / 180);
          ctx.fillRect(-s / 2, -s / 2, s, s);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(x, y, Math.max(0.5, s / 2), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (p.kind === 'ring') {
        const r = p.size * (0.2 + 2.2 * easeOut(t));
        ctx.globalAlpha = 0.95 * (1 - t);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x0, p.y0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (p.kind === 'text') {
        const scale = seg(t, [[0, 0.7], [0.22, 1.06], [0.7, 1], [1, 0.94]]);
        const alpha = seg(t, [[0, 0], [0.22, 1], [0.7, 1], [1, 0]]);
        const dy = seg(t, [[0, 0], [0.7, 0], [1, -92]]);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x0, p.y0 + dy);
        ctx.scale(scale, scale);
        ctx.fillStyle = p.color;
        ctx.font = '500 ' + p.size + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (p.kind === 'stamp') {
        const scale = seg(t, [[0, 2.6], [0.35, 0.92], [0.7, 1], [1, 1.12]]);
        const alpha = seg(t, [[0, 0], [0.35, 1], [0.7, 1], [1, 0]]);
        const dy = seg(t, [[0, 0], [0.7, 0], [1, -40]]);
        const rot = seg(t, [[0, -18], [0.35, -8], [1, -8]]) * Math.PI / 180;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x0, p.y0 + dy);
        ctx.rotate(rot);
        ctx.scale(scale, scale);
        ctx.fillStyle = p.color;
        ctx.font = '500 ' + p.size + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (p.kind === 'confetti') {
        // 延迟是算进总时长的，延迟期间不画，之后从 0 开始走
        const elapsed = p.max - p.life;
        if (elapsed < p.delay) continue;
        const ct = clamp01((elapsed - p.delay) / p.dur);
        const x = p.x0 + p.dx * ct;
        const y = p.y0 + p.dy * ct;
        ctx.globalAlpha = ct > 0.9 ? (1 - ct) / 0.1 : 1;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.rot + p.vrot * ct);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }
  },

  /** 立刻清空所有粒子（切关卡 / 页面卸载时用） */
  clear() {
    this.parts = [];
    if (this.ctx) {
      try { this.ctx.clearRect(0, 0, this.w, this.h); } catch (e) { /* 忽略 */ }
    }
  },

  /** 页面卸载时解绑，避免已排队的 rAF 回调碰到失效节点 */
  detach() {
    this.clear();
    this.canvas = null;
    this.ctx = null;
    this.running = false;
  },
};

module.exports = Fx;
