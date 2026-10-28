/* =========================================================
   home.js —— 主界面
   一张「今天该打哪关」的进度卡 + 一颗大按钮。
   所有数据来自 Progress，进页面就刷新，从游戏页返回立刻更新。
   ========================================================= */
const G24 = require('../../utils/g24.js');
const Progress = require('../../utils/progress.js');
const { fmtTime } = require('../../utils/format.js');

const LEVELS = G24.LEVELS;
const TOTAL = LEVELS.levels.length;

Page({
  data: {
    topPad: 20,
    cleared: 0,
    total: TOTAL,
    pct: 0,
    nextNo: 1,
    tierName: '',
    tierRule: '',
    bestText: '--:--',
    allDone: false,
    showHelp: false,
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ topPad: info.statusBarHeight || 20 });
    this.refresh();
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const p = Progress.load();
    const cleared = Math.min(p.cleared, TOTAL);
    const allDone = cleared >= TOTAL;
    const gi = allDone ? TOTAL - 1 : cleared;
    const lv = LEVELS.levels[gi];
    const tier = LEVELS.tiers[lv.t] || { name: '', rule: '' };
    const best = p.best[lv.t];

    this.setData({
      cleared,
      pct: Math.round((cleared / TOTAL) * 100),
      nextNo: gi + 1,
      tierName: tier.name,
      tierRule: tier.rule || '',
      bestText: typeof best === 'number' ? fmtTime(best) : '--:--',
      allDone,
    });
  },

  start() {
    const gi = this.data.allDone ? 0 : this.data.nextNo - 1;
    wx.navigateTo({ url: `/pages/game/game?level=${gi}&from=home` });
  },

  map() {
    wx.navigateTo({ url: '/pages/levels/levels' });
  },

  openHelp() {
    this.setData({ showHelp: true });
  },

  closeHelp() {
    this.setData({ showHelp: false });
  },

  noop() {},

  onShareAppMessage() {
    return {
      title: '24Game · 拖两张牌，凑出 24 点',
      path: '/pages/home/home',
    };
  },
});
