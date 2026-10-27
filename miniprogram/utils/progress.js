/* =========================================================
   progress.js —— 闯关进度
   只记一个数字：已通关的关卡数量。
   可玩范围 = 0 ~ cleared（cleared 这一关就是当前关）
   ========================================================= */
const KEY = 'g24_progress';

function load() {
  try {
    const v = wx.getStorageSync(KEY);
    if (v && typeof v.cleared === 'number' && v.cleared >= 0) return v;
  } catch (e) {
    // 读不出来就当新玩家
  }
  return { cleared: 0 };
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

function reset() {
  save({ cleared: 0 });
  return { cleared: 0 };
}

module.exports = { KEY, load, save, markCleared, reset };
