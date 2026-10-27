/* =========================================================
   fx.js —— 视觉特效层（粒子 / 光环 / 飘字 / 彩带 / 震屏）
   全部用 Web Animations API 驱动，元素用完即删。
   对外暴露：G24.Fx
   ========================================================= */
(function (global) {
  'use strict';
  const G24 = global.G24 || (global.G24 = {});

  const REDUCED = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const N = (n) => (REDUCED ? Math.max(3, Math.round(n * 0.35)) : n);

  const PALETTE = ['#ffd166', '#ef476f', '#06d6a0', '#8ecae6', '#f4c260', '#ffffff'];

  let layer = null;
  let lastConfetti = 0;          // 最近一次撒了多少条（自检用，与动画生命周期无关）
  function fxLayer() {
    if (!layer || !layer.isConnected) layer = document.getElementById('fxLayer');
    return layer;
  }

  function put(el, x, y) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    fxLayer().appendChild(el);
    return el;
  }

  function cleanup(anim, el) {
    Promise.resolve(anim.finished).catch(() => {}).then(() => el.remove());
  }

  /** 合成撞击的粒子爆开 */
  function burst(x, y, opts) {
    opts = opts || {};
    const count = N(opts.count || 24);
    const colors = opts.colors || PALETTE;
    const power = opts.power || 1;
    for (let i = 0; i < count; i++) {
      const size = 4 + Math.random() * 8;
      const el = document.createElement('span');
      el.className = 'fx-particle';
      el.style.width = size + 'px';
      el.style.height = size + 'px';
      el.style.background = colors[i % colors.length];
      el.style.boxShadow = '0 0 8px ' + colors[i % colors.length];
      if (Math.random() < 0.5) el.style.borderRadius = '2px';
      put(el, x - size / 2, y - size / 2);

      const angle = Math.random() * Math.PI * 2;
      const dist = (40 + Math.random() * 120) * power;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist + 30;
      const dur = (REDUCED ? 200 : 520) + Math.random() * 420;

      const anim = el.animate([
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.35}px, ${dy * 0.35}px) scale(1.05)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.2) rotate(${Math.random() * 540 - 270}deg)`, opacity: 0 },
      ], { duration: dur, easing: 'cubic-bezier(.2,.7,.3,1)' });
      cleanup(anim, el);
    }
  }

  /** 撞击光环 */
  function ring(x, y, opts) {
    opts = opts || {};
    const size = opts.size || 60;
    const el = document.createElement('span');
    el.className = 'fx-ring';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.marginLeft = -size / 2 + 'px';
    el.style.marginTop = -size / 2 + 'px';
    if (opts.color) el.style.borderColor = opts.color;
    put(el, x, y);
    const anim = el.animate([
      { transform: 'scale(0.2)', opacity: 0.95 },
      { transform: 'scale(2.4)', opacity: 0, offset: 1 },
    ], { duration: REDUCED ? 180 : 460, easing: 'cubic-bezier(.16,.8,.3,1)' });
    cleanup(anim, el);
  }

  /** 算式飘字，例如 "7 + 5 = 12" */
  function floatText(x, y, text) {
    const el = document.createElement('span');
    el.className = 'fx-text';
    el.textContent = text;
    put(el, x, y);
    center(el);
    const anim = el.animate([
      { transform: 'scale(0.7)', opacity: 0 },
      { transform: 'scale(1.06)', opacity: 1, offset: 0.22 },
      { transform: 'scale(1)', opacity: 1, offset: 0.7 },
      { transform: 'translateY(-92px) scale(0.94)', opacity: 0 },
    ], { duration: REDUCED ? 420 : 1000, easing: 'cubic-bezier(.2,.8,.25,1)' });
    cleanup(anim, el);
  }

  /** 用负 margin 抵消自身尺寸，使 (x, y) 成为元素中心 */
  function center(el) {
    el.style.marginLeft = -el.offsetWidth / 2 + 'px';
    el.style.marginTop = -el.offsetHeight / 2 + 'px';
  }

  /** 大字盖章（胜利时 "24" 砸在牌上） */
  function stamp(x, y, text, ms) {
    const el = document.createElement('span');
    el.className = 'fx-stamp';
    el.textContent = text;
    put(el, x, y);
    center(el);
    const anim = el.animate([
      { transform: 'scale(2.6) rotate(-18deg)', opacity: 0 },
      { transform: 'scale(0.92) rotate(-8deg)', opacity: 1, offset: 0.35 },
      { transform: 'scale(1) rotate(-8deg)', opacity: 1, offset: 0.7 },
      { transform: 'translateY(-40px) scale(1.12) rotate(-8deg)', opacity: 0 },
    ], { duration: REDUCED ? 500 : (ms || 1300), easing: 'cubic-bezier(.2,1.3,.3,1)' });
    cleanup(anim, el);
  }

  /** 彩带雨 */
  function confetti(opts) {
    opts = opts || {};
    const count = N(opts.count || 90);
    // 彩带是短命的（2~4 秒后自行移除），自检不能靠“dump 那一刻还在不在”，
    // 所以这里把“撒过多少”记下来，由 game.js 写进 debug 面板。
    lastConfetti = count;
    const w = global.innerWidth, h = global.innerHeight;
    for (let i = 0; i < count; i++) {
      const el = document.createElement('span');
      el.className = 'fx-confetti';
      el.style.background = PALETTE[i % PALETTE.length];
      el.style.width = 6 + Math.random() * 8 + 'px';
      el.style.height = 10 + Math.random() * 12 + 'px';
      put(el, Math.random() * w, -20 - Math.random() * h * 0.4);
      const dx = (Math.random() - 0.5) * 220;
      const dur = (REDUCED ? 900 : 2200) + Math.random() * 1800;
      const anim = el.animate([
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx}px, ${h * 1.15}px) rotate(${720 + Math.random() * 720}deg)`, opacity: 0.9 },
      ], { duration: dur, easing: 'cubic-bezier(.35,.1,.6,1)', delay: Math.random() * 500 });
      cleanup(anim, el);
    }
  }

  /** 牌桌轻微震动 */
  function shake(el, px) {
    if (!el || REDUCED) return;
    el.style.setProperty('--shake', (px || 4) + 'px');
    el.classList.remove('is-shaking');
    void el.offsetWidth;
    el.classList.add('is-shaking');
    setTimeout(() => el.classList.remove('is-shaking'), 400);
  }

  G24.Fx = {
    burst, ring, floatText, stamp, confetti, shake, REDUCED,
    get lastConfetti() { return lastConfetti; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
