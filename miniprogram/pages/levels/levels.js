/* =========================================================
   levels.js —— 关卡地图：15 档 × 20 关
   横向滑动的档位页（swiper）+ 每页 5×4 的格子，和 H5 版一致。
   一次把 300 个格子都渲染出来：数据 20KB、节点 300，
   一次性 setData 可以接受，真正会卡的是高频 setData，这里没有。
   ========================================================= */
const G24 = require('../../utils/g24.js');
const Progress = require('../../utils/progress.js');

const LEVELS = G24.LEVELS;
const PER = LEVELS.perTier;
const TOTAL = LEVELS.levels.length;

Page({
  data: {
    tiers: [],
    active: 0,
    cleared: 0,
    total: TOTAL,
    pct: 0,
    topPad: 20,
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ topPad: (info.statusBarHeight || 20) + 8 });
    this.build();
  },

  onShow() {
    // 从游戏页返回时要刷新进度
    if (this.data.tiers.length) this.build();
  },

  build() {
    const p = Progress.load();
    const cleared = Math.min(p.cleared, TOTAL);

    const tiers = LEVELS.tiers.map((tier, ti) => {
      const start = ti * PER;
      const list = [];
      let done = 0;
      for (let k = 0; k < PER; k++) {
        const gi = start + k;
        let state = 'lock';
        if (gi < cleared) {
          state = 'done';
          done++;
        } else if (gi === cleared) {
          state = 'current';
        }
        list.push({ gi, label: k + 1, state });
      }
      return {
        i: ti,
        name: tier.name,
        note: tier.note,
        rule: tier.rule,
        done,
        levels: list,
      };
    });

    this.setData({
      tiers,
      cleared,
      pct: Math.round((cleared / TOTAL) * 100),
      // 默认停在「当前关」所在的那一档
      active: Math.min(Math.floor(cleared / PER), LEVELS.tiers.length - 1),
    });
  },

  onSwiper(e) {
    this.setData({ active: e.detail.current });
  },

  pickTab(e) {
    this.setData({ active: Number(e.currentTarget.dataset.i) });
  },

  prev() {
    if (this.data.active > 0) this.setData({ active: this.data.active - 1 });
  },

  next() {
    if (this.data.active < LEVELS.tiers.length - 1) {
      this.setData({ active: this.data.active + 1 });
    }
  },

  pick(e) {
    const ds = e.currentTarget.dataset;
    if (ds.state === 'lock') {
      wx.showToast({ title: '先过前面的关卡', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/game/game?level=${ds.gi}&from=levels` });
  },

  back() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pages/home/home' }),
    });
  },

  onShareAppMessage() {
    return {
      title: '24Game · 15 档 300 关，你能打到第几档？',
      path: '/pages/home/home',
    };
  },
});
