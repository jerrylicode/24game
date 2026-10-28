/* =========================================================
   nav.js —— 自定义导航栏的度量
   页面都开了 navigationStyle: custom（不要微信那根灰标题栏），
   代价是「状态栏」和右上角「胶囊按钮」的位置得自己算：

     statusBar   状态栏高度，内容不能压到它下面
     navH        导航条高度（状态栏下沿 → 导航条下沿），胶囊在它里面居中
     capRight    胶囊从屏幕右边吃掉多少宽度；右侧控件要躲开这一段

   胶囊位置只能用 wx.getMenuButtonBoundingClientRect() 拿。
   它偶尔会返回 0（某些基础库 / 真机首帧），所以每个值都有兜底，
   兜底取 iPhone 上的常见值，宁可多留白也不要压住按钮。
   ========================================================= */

/* 兜底值：iPhone 8/13 这一档的常见尺寸 */
const FALLBACK = {
  statusBar: 20,
  navH: 44,
  capRight: 96, // 胶囊宽 87 + 右边距 7，再留 2px 余量
};

function readInfo() {
  try {
    return wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  } catch (e) {
    return {};
  }
}

function readCapsule() {
  try {
    if (typeof wx.getMenuButtonBoundingClientRect !== 'function') return null;
    const c = wx.getMenuButtonBoundingClientRect();
    if (!c || !c.width || !c.height) return null;
    return c;
  } catch (e) {
    return null;
  }
}

/**
 * @returns {{statusBar:number, ww:number, wh:number, navH:number,
 *            capRight:number, capWidth:number, capHeight:number,
 *            safeBottom:number}}
 */
function metrics() {
  const info = readInfo();
  const statusBar = info.statusBarHeight || FALLBACK.statusBar;
  const ww = info.windowWidth || 375;
  const wh = info.windowHeight || 667;
  const safeBottom = info.safeArea ? Math.max(0, wh - info.safeArea.bottom) : 0;

  const cap = readCapsule();
  /* 胶囊必须整个落在状态栏下面才算有效数据 */
  const valid = cap && cap.top >= statusBar && cap.left > 0 && cap.left < ww;

  let navH = FALLBACK.navH;
  let capRight = FALLBACK.capRight;
  if (valid) {
    /* 胶囊上下留白相等 → 导航条高度 = 上留白 × 2 + 胶囊高 */
    navH = (cap.top - statusBar) * 2 + cap.height;
    capRight = Math.round(ww - cap.left);
  }

  return {
    statusBar,
    ww,
    wh,
    navH,
    capRight,
    capWidth: valid ? Math.round(cap.width) : 87,
    capHeight: valid ? Math.round(cap.height) : 32,
    safeBottom,
  };
}

/**
 * 顶部要留多少 padding：让「第一行内容」和胶囊垂直居中。
 * @param {number} rowH 第一行内容的高度
 */
function topPad(rowH) {
  const m = metrics();
  const gap = Math.max(0, Math.round((m.navH - (rowH || 44)) / 2));
  return m.statusBar + gap;
}

module.exports = { metrics, topPad, FALLBACK };
