App({
  onLaunch() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.globalData = {
      windowWidth: info.windowWidth,
      statusBarHeight: info.statusBarHeight || 20,
    };
  },
  globalData: {
    windowWidth: 375,
    statusBarHeight: 20,
  },
});
