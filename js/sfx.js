/* =========================================================
   sfx.js —— 纯 Web Audio 合成音效（不依赖任何音频文件）
   设计：所有音色都用振荡器 + 噪声 + 包络现场合成，
        这样零资源、可离线、可随动画时长微调。
   对外暴露：G24.Sfx
   ========================================================= */
(function (global) {
  'use strict';
  const G24 = global.G24 || (global.G24 = {});

  const Sfx = {
    ctx: null,
    master: null,
    shimmer: null,
    noiseBuf: null,
    enabled: true,
    _unlocked: false,

    /** 首次用户手势时调用（浏览器自动播放策略要求） */
    init() {
      if (this.ctx) return this.ctx;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) { this.enabled = false; return null; }
      const ctx = new AC();

      const master = ctx.createGain();
      master.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      master.connect(comp);
      comp.connect(ctx.destination);

      // 一条轻混响（延迟反馈）总线，给“碎片/胜利”加光泽
      const shimmer = ctx.createGain();
      shimmer.gain.value = 1;
      const delay = ctx.createDelay(0.6);
      delay.delayTime.value = 0.17;
      const fb = ctx.createGain();
      fb.gain.value = 0.3;
      shimmer.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(master);

      this.ctx = ctx;
      this.master = master;
      this.shimmer = shimmer;
      return ctx;
    },

    unlock() {
      const ctx = this.init();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      if (!this._unlocked) {
        this._unlocked = true;
        // 用一次听不见的脉冲把音频线程叫醒（部分浏览器首音会丢）
        this.tone({ freq: 60, dur: 0.02, gain: 0.0001 });
      }
    },

    setEnabled(on) {
      this.enabled = !!on;
      if (this.master) {
        const ctx = this.ctx;
        this.master.gain.cancelScheduledValues(ctx.currentTime);
        this.master.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.02);
      }
    },

    /* ---------- 合成基元 ---------- */

    tone(o) {
      if (!this.enabled) return;
      const ctx = this.init();
      if (!ctx) return;
      const t0 = ctx.currentTime + (o.when || 0);
      const dur = o.dur || 0.12;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(Math.max(20, o.freq), t0);
      if (o.to) {
        const to = Math.max(20, o.to);
        if (o.linear) osc.frequency.linearRampToValueAtTime(to, t0 + dur);
        else osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
      }
      const peak = o.gain == null ? 0.14 : o.gain;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + Math.min(0.02, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      let node = g;
      if (o.filter) {
        const lp = ctx.createBiquadFilter();
        lp.type = o.filter;
        lp.frequency.value = o.filterFreq || 1200;
        g.connect(lp);
        node = lp;
      }
      osc.connect(g);
      node.connect(o.bus === 'shimmer' ? this.shimmer : this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.06);
    },

    noise(o) {
      if (!this.enabled) return;
      const ctx = this.init();
      if (!ctx) return;
      const t0 = ctx.currentTime + (o.when || 0);
      const dur = o.dur || 0.15;
      if (!this.noiseBuf) {
        const len = Math.floor(ctx.sampleRate * 0.7);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
      }
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = o.filter || 'bandpass';
      bp.Q.value = o.q == null ? 1.1 : o.q;
      const f0 = o.freq || 900;
      const f1 = o.to || f0;
      bp.frequency.setValueAtTime(f0, t0);
      if (f1 !== f0) bp.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(o.gain == null ? 0.1 : o.gain, t0 + Math.min(0.02, dur * 0.25));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(bp);
      bp.connect(g);
      g.connect(o.bus === 'shimmer' ? this.shimmer : this.master);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
    },

    /* ---------- 语义化音效 ---------- */

    /** 拿起一张牌：木质轻响 + 上滑 */
    pickup() {
      this.tone({ freq: 300, to: 620, type: 'triangle', dur: 0.13, gain: 0.1 });
      this.noise({ freq: 2600, to: 1200, dur: 0.05, gain: 0.035 });
    },

    /** 拖过一张候选牌：极轻的“嗒” */
    hoverTick() {
      this.tone({ freq: 1500, to: 1180, type: 'sine', dur: 0.045, gain: 0.045 });
    },

    /** 松手落到牌上（还没选运算符）：咔哒 */
    snap() {
      this.tone({ freq: 520, to: 900, type: 'square', dur: 0.06, gain: 0.055, filter: 'lowpass', filterFreq: 2200 });
      this.noise({ freq: 1800, dur: 0.045, gain: 0.05, q: 0.9 });
    },

    /** 没落到牌上，弹回原位 */
    release() {
      this.tone({ freq: 620, to: 260, type: 'sine', dur: 0.16, gain: 0.07 });
    },

    /** 运算符面板弹出：清脆双音 */
    popupOpen() {
      this.tone({ freq: 660, type: 'triangle', dur: 0.1, gain: 0.09 });
      this.tone({ freq: 990, type: 'triangle', dur: 0.12, gain: 0.07, when: 0.06, bus: 'shimmer' });
      this.noise({ freq: 3200, to: 2000, dur: 0.07, gain: 0.03 });
    },

    /** 面板收起（取消） */
    popupClose() {
      this.tone({ freq: 700, to: 420, type: 'triangle', dur: 0.11, gain: 0.06 });
    },

    /** 选中某个运算符：确认音 */
    choose() {
      this.tone({ freq: 880, type: 'square', dur: 0.06, gain: 0.05, filter: 'lowpass', filterFreq: 2600 });
      this.tone({ freq: 1320, type: 'sine', dur: 0.09, gain: 0.04, when: 0.03 });
    },

    /** 命中目标牌（悬停到可落下的牌上） */
    targetOn() { this.tone({ freq: 1046, type: 'sine', dur: 0.06, gain: 0.05 }); },
    targetOff() { this.tone({ freq: 700, type: 'sine', dur: 0.05, gain: 0.03 }); },

    /** 合成：呼啸 + 撞击 + 余韵 */
    merge() {
      this.noise({ freq: 500, to: 3600, dur: 0.22, gain: 0.09, q: 0.8 });
      this.tone({ freq: 170, to: 58, type: 'sine', dur: 0.3, gain: 0.22 });
      this.tone({ freq: 1180, type: 'sine', dur: 0.34, gain: 0.05, when: 0.03, bus: 'shimmer' });
      this.noise({ freq: 4200, to: 2600, dur: 0.18, gain: 0.045, when: 0.02, bus: 'shimmer' });
    },

    /** 新牌诞生：上扬的“叮” */
    spawn() {
      this.tone({ freq: 700, to: 1400, type: 'triangle', dur: 0.16, gain: 0.09 });
      this.tone({ freq: 2100, type: 'sine', dur: 0.12, gain: 0.035, when: 0.05, bus: 'shimmer' });
    },

    /** 非法操作：低频“嘟” */
    invalid() {
      this.tone({ freq: 220, to: 160, type: 'sawtooth', dur: 0.16, gain: 0.07, filter: 'lowpass', filterFreq: 900 });
      this.tone({ freq: 233, to: 170, type: 'sawtooth', dur: 0.16, gain: 0.05, when: 0.02, filter: 'lowpass', filterFreq: 900 });
    },

    /** 撤销：倒带感 */
    undo() {
      this.tone({ freq: 760, to: 340, type: 'triangle', dur: 0.18, gain: 0.08 });
      this.noise({ freq: 2400, to: 700, dur: 0.16, gain: 0.04 });
    },

    /** 发牌：洗牌摩擦声 */
    deal() {
      for (let i = 0; i < 5; i++) {
        this.noise({ freq: 1800 + Math.random() * 1600, to: 900, dur: 0.06, gain: 0.05, when: i * 0.055 });
      }
    },

    /** 走进死路：下行小二度 */
    dead() {
      this.tone({ freq: 392, to: 330, type: 'sine', dur: 0.26, gain: 0.09 });
      this.tone({ freq: 311, to: 262, type: 'sine', dur: 0.3, gain: 0.07, when: 0.14 });
    },

    /** 达成 24：上行琶音 + 闪光 */
    win() {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      notes.forEach((f, i) => {
        this.tone({ freq: f, type: 'triangle', dur: 0.36, gain: 0.11, when: i * 0.085, bus: 'shimmer' });
        this.tone({ freq: f * 2, type: 'sine', dur: 0.22, gain: 0.03, when: i * 0.085 + 0.02 });
      });
      this.noise({ freq: 3000, to: 8000, dur: 0.5, gain: 0.05, when: 0.1, bus: 'shimmer' });
    },

    /** 点错/空格提示 */
    softTick() { this.tone({ freq: 520, type: 'sine', dur: 0.04, gain: 0.035 }); },
  };

  G24.Sfx = Sfx;
})(typeof window !== 'undefined' ? window : globalThis);
