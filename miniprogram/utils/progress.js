/* =========================================================
   progress.js —— 闯关进度 + 每档最佳用时
   cleared：已通关数量（0 起，等于「当前该打的关」）
   best：  { [档位序号]: 秒数 }，只存更快的那次
   ========================================================= */
const KEY = 'g24_progress';

function load() {
  try {
    const v = wx.getStorageSync(KEY);
    if (v && typeof v.cleared === 'number' && v.cleared >= 0) {
      return {
        cleared: v.cleared,
        best: v.best && typeof v.best === 'object' ? v.best : {},
      };
    }
  } catch (e) {
    // 读不出来就当新玩家
  }
  return { cleared: 0, best: {} };
}

function save(p) {
  try {
    wx.setStorageSync(KEY, p);
  } catch (e) {
    // 存储满了也不能影响玩
  }
}

/** 通关第 idx 关（0 起）：只前进不后退，重复通关不会把进度打回去 */
function markCleared(idx) {
  const p = load();
  if (idx + 1 > p.cleared) {
    p.cleared = idx + 1;
    save(p);
  }
  return p;
}

/** 某一档的最佳用时（秒），没打过返回 null */
function loadBest(tier) {
  const v = load().best[tier];
  return typeof v === 'number' && v >= 0 ? v : null;
}

/** 记录最佳用时：更快才写入，返回是否刷新了纪录 */
function saveBest(tier, sec) {
  const p = load();
  const cur = p.best[tier];
  if (typeof cur !== 'number' || sec < cur) {
    p.best[tier] = sec;
    save(p);
    return true;
  }
  return false;
}

function reset() {
  save({ cleared: 0, best: {} });
  return { cleared: 0, best: {} };
}

module.exports = { KEY, load, save, markCleared, loadBest, saveBest, reset };
