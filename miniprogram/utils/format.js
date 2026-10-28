/* =========================================================
   format.js —— 时间格式化（mm:ss）
   主界面、游戏页、关卡地图共用，避免三处各写一份
   ========================================================= */

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
}

module.exports = { fmtTime };
