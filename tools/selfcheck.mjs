/* =========================================================
   selfcheck.mjs —— 真机集成自检：用无头 Chrome 跑完整个交互流程并断言结果
   运行： node tools/selfcheck.mjs            （全部场景）
         node tools/selfcheck.mjs h5         （只跑 H5/移动端场景）
         node tools/selfcheck.mjs core       （只跑核心玩法场景）
   覆盖：开局发牌 / 拖拽→弹窗 / 选运算符合成 / 撤销 / 重开 / 提示 / 答案 /
        自动演示通关 / 死路检测 / 移动端视口适配（竖屏·横屏·超窄屏·触摸拖拽）
   ========================================================= */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { dumpDom, debugState, root } from './dom-check.mjs';

// 关卡表是生成物：测试从同一份数据里取期望值，关卡重排后不会白挂
vm.runInThisContext(fs.readFileSync(path.join(root, 'js', 'levels.js'), 'utf8'), { filename: 'levels.js' });
const LV = globalThis.G24.LEVELS;
const dealOf = (n) => LV.levels[n - 1].n.join(',');

const OUT = path.join(root, '.shots');
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv[2] || null;         // 可选：只跑某一组（h5 / core）

/* 常见机型视口 */
/* 无头 Chrome 有两个坑：
   1) 窗口宽度被系统钳在 ~500px，所以“320/360/390”实际渲染都是 500 宽；
      窄屏（<500px）的排布由 test/layout.test.mjs 用解析 CSS + 算账守住。
   2) 窗口高度比请求值少 143px（无头窗口的边框/标签栏），所以这里请求
      “机型高度 + 143”，让页面拿到的是真机该有的可用高度，
      否则 iPhone 12 会被当成一台只有 701px 高的矮屏机。 */
const CHROME_H = 143;
const vp = (w, h, extra = {}) => ({ windowSize: `${w},${h + CHROME_H}`, mobile: true, ...extra });
const IPHONE_12 = vp(390, 844, { deviceScale: 3 });   // 可用 500×844
const IPHONE_SE = vp(375, 667, { deviceScale: 2 });   // 可用 500×667
const ANDROID = vp(360, 640, { deviceScale: 3 });     // 可用 500×640
const TINY = vp(320, 568, { deviceScale: 2 });        // 可用 500×568
const LANDSCAPE = vp(844, 390, { deviceScale: 3 });   // 可用 844×390
const DESKTOP = { windowSize: `1280,${880 + CHROME_H}` }; // 可用 1280×880

const scenarios = [];
function scenario(group, name, url, check, opts = {}) {
  scenarios.push({ group, name, url, check, opts });
}

const cardsOf = (st) => st.cards.join(',');

/* ---------------- 核心玩法 ---------------- */

scenario('core', '开局发牌：4 张牌、无脚本错误', 'index.html?debug=1', (st) => {
  assert.equal(st.cards.length, 4, '应有 4 张牌');
  assert.ok(st.cards.every((v) => /^\d+$/.test(v) && +v >= 1 && +v <= 13), '牌面应为 1~13');
  assert.deepEqual(st.errors, [], '页面有错误');
  assert.equal(st.moves, 0);
});

scenario('core', '拖拽落下 → 在两张牌中点展开运算符圆环', 'index.html?deal=7,5,6,2&demo=drag&debug=1', (st, html) => {
  assert.equal(st.popupOpen, true, '圆环应已打开');
  assert.equal(st.busy, false);
  assert.equal(st.ringItems, 4, '圆环应恰好是 4 个运算符');
  assert.equal(st.ringOpen, true, '弹出动画的 is-open 应已加上');
  const syms = [...html.matchAll(/class="op-ring__item"[^>]*data-op="([+\-*/])"[^>]*>([^<]+)</g)].map((m) => m[2]);
  assert.deepEqual(syms, ['+', '−', '×', '÷'], '符号应正好是加、减、乘、除');
  assert.equal((html.match(/op-ring__cancel/g) || []).length, 1, '圆心应有“取消”');
  // 明确要求：面板上不再出现任何运算结果
  assert.ok(!/op-btn__res|op-btn__swap|op-popup/.test(html), '不该再有结果数字/反向按钮/旧面板结构');
  assert.ok(!/= 35/.test(html) && !/>35</.test(html.split('op-ring')[0]), '不该预先显示 7 × 5 = 35');
  assert.ok(!/is-dragging|is-target/.test(html), '拖拽态类名应已清理');
});

scenario('core', '选择乘号 → 合成新牌、两张旧牌消失、判定死路',
  'index.html?deal=7,5,6,2&demo=dragmerge&op=%2A&debug=1', (st, html) => {
    assert.equal(cardsOf(st), '35,6,2');
    assert.equal(st.moves, 1);
    assert.equal(st.history, 1, '应有一条撤销记录');
    assert.deepEqual(st.errors, []);
    assert.ok(!/class="card__expr"/.test(html), '牌面不该再出现算式贴纸');
    assert.ok(/title="7 × 5"/.test(html), '算式只留在 title 里（悬停可见）');
    assert.ok(html.includes('凑不出 24'), '应提示走进死路');
  });

scenario('core', '撤销 → 复原成 4 张牌',
  'index.html?deal=7,5,6,2&demo=dragmerge&op=%2A&then=undo&debug=1', (st, html) => {
    assert.equal(cardsOf(st), '7,5,6,2');
    assert.equal(st.moves, 0);
    assert.equal(st.history, 0);
    assert.equal(st.busy, false, '动画结束后不应卡在 busy');
    assert.deepEqual(st.errors, []);
    assert.ok(/id="undoBtn"[^>]*disabled/.test(html), '撤销按钮应变灰');
  });

scenario('core', '重开本局 → 回到同样的 4 张牌',
  'index.html?deal=7,5,6,2&demo=dragmerge&op=%2A&then=restart&debug=1', (st) => {
    assert.equal(cardsOf(st), '7,5,6,2');
    assert.equal(st.moves, 0);
    assert.equal(st.history, 0);
    assert.equal(st.busy, false);
    assert.deepEqual(st.errors, []);
  });

scenario('core', '提示 → 高亮两张牌', 'index.html?deal=3,3,8,8&demo=idle&then=hint&debug=1', (st, html) => {
  assert.ok((html.match(/is-hint/g) || []).length >= 2, '应有两张牌被高亮');
  assert.ok(/试试 \d+ 和 \d+/.test(html), '提示只需指出两张牌（“试试 A 和 B”）');
  assert.ok(!/再点一次给运算符/.test(html), '不该再解释怎么用提示');
  assert.deepEqual(st.errors, []);
});

scenario('core', '答案面板 → 列出合法解法', 'index.html?deal=1,5,5,5&demo=answers&debug=1', (st, html) => {
  assert.ok(!/id="answerModal" hidden/.test(html), '答案面板应打开');
  assert.ok(html.includes('5 × (5 − 1 ÷ 5) = 24'), '应给出最小括号的正确解法');
  assert.deepEqual(st.errors, []);
});

scenario('core', '没凑到 24：只给结论，不给算式',
  'index.html?deal=7,5,6,2&demo=lose&debug=1', (st, html) => {
    assert.ok(!/id="loseModal" hidden/.test(html), '失败面板应打开');
    const modal = (html.match(/<div class="modal" id="loseModal"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/) || [''])[0];
    assert.ok(modal, '应能找到失败面板');
    const text = modal.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    assert.ok(text.includes('21'), '应显示最后那张牌的点数：' + text);
    assert.ok(text.includes('≠ 24'), '应显示“≠ 24”：' + text);
    assert.ok(!/\d\s*[+\-×÷]\s*\d/.test(text), '不该出现任何算式：' + text);
    assert.ok(!/howto__tip/.test(modal), '不该再有解释段落');
    assert.ok(text.length <= 30, `失败面板应只有几个字，实际 ${text.length} 字：${text}`);
    assert.ok(html.includes('不是 24'), '横幅只说“不是 24”');
    assert.ok(!/最后一张是/.test(html), '横幅不该再念一遍牌面');
    assert.deepEqual(st.errors, []);
  });

scenario('core', '无解时点答案：一句话，不列解法',
  'index.html?deal=7,5,6,2&demo=dragmerge&op=%2A&then=answers&debug=1', (st, html) => {
    assert.ok(!/id="answerModal" hidden/.test(html), '答案面板应打开');
    assert.ok(html.includes('当前牌面无解'), '应只给一句“当前牌面无解”');
    assert.ok(!/解法\s*\d/.test(html), '无解时不该列出解法');
    assert.ok(!/撤销一步或者换一批牌吧/.test(html), '不该再长篇劝退');
    assert.deepEqual(st.errors, []);
  });

scenario('core', '闯关：第 1 关是「幼儿园」的 1·2·3·4，只许整数',
  'index.html?reset=1&level=1&debug=1', (st, html) => {
    assert.equal(st.level, 1, '应从第 1 关开始');
    assert.equal(st.cleared, 0, '还没通关任何一关');
    assert.equal(st.unlocked, 1, '只解锁第 1 关');
    assert.equal(st.tier, '幼儿园');
    assert.equal(st.levelText, '1', '记分牌应显示第 1 关');
    assert.equal(st.tierText, '幼儿园', '记分牌应显示档位');
    assert.equal(cardsOf(st), dealOf(1), '第 1 关的牌面应与关卡表一致');
    assert.equal(st.integerOnly, true, '幼儿园只许整数中间值');
    assert.deepEqual(st.errors, []);
  });

scenario('core', '闯关：第 21 关进入「小学生」，仍是整数关',
  'index.html?level=21&debug=1', (st) => {
    assert.equal(st.level, 21);
    assert.equal(st.tier, '小学生');
    assert.equal(cardsOf(st), dealOf(21), '第 21 关的牌面应与关卡表一致');
    assert.equal(st.integerOnly, true);
    assert.deepEqual(st.errors, []);
  });

scenario('core', '闯关：第 100 关在「大学生」，允许分数',
  'index.html?level=100&debug=1', (st) => {
    assert.equal(st.level, 100);
    assert.equal(st.tier, '大学生');
    assert.equal(st.integerOnly, false, '中学生以后就允许分数中间值');
    assert.equal(st.cards.length, 4);
    assert.deepEqual(st.errors, []);
  });

scenario('core', '闯关：第 300 关是「数学之王」的最难一副',
  'index.html?level=300&debug=1', (st) => {
    assert.equal(st.level, 300);
    assert.equal(st.tier, '数学之王');
    assert.equal(cardsOf(st), dealOf(300), '最后一关的牌面应与关卡表一致');
    assert.equal(st.integerOnly, false);
  });

scenario('core', '闯关：赢了之后点“下一关” → 关卡 +1、换成下一副牌',
  'index.html?reset=1&level=1&demo=nextlevel&debug=1', (st, html) => {
    assert.equal(st.level, 2, '应进入第 2 关');
    assert.equal(st.cleared, 1, '第 1 关记为已通关');
    assert.equal(cardsOf(st), dealOf(2), '第 2 关的牌面应与关卡表一致');
    assert.equal(st.moves, 0, '步数应清零');
    assert.equal(st.finished, false, '不应停留在通关态');
    assert.equal(st.levelText, '2', '记分牌应跳到 2');
    assert.equal(st.savedLevel, '2', '当前关应写入本地存档');
    assert.equal(st.savedCleared, '1', '通关数应写入本地存档');
    assert.ok(/第 2 关/.test(html), '应播报“第 2 关”');
    assert.ok(/id="winModal" hidden/.test(html), '通关面板应已关闭');
    assert.deepEqual(st.errors, []);
  });

scenario('core', '闯关：第 20 关通关 → 播报档位完成，按钮换成下一档',
  'index.html?reset=1&level=20&demo=win&debug=1', (st, html) => {
    assert.equal(st.cleared, 20);
    assert.ok(/幼儿园 通关/.test(html), '应播报「幼儿园 通关」');
    assert.ok(/进入「小学生」/.test(html), '通关面板按钮应指向下一档');
    assert.equal(st.savedLevel, '21', '通关后下一关存档应为 21');
  });

scenario('core', '自动演示 → 三连合成并通关（含分数中间值）',
  'index.html?deal=3,3,8,8&demo=auto&debug=1', (st, html) => {
    assert.equal(cardsOf(st), '24');
    assert.equal(st.finished, true);
    assert.equal(st.moves, 3, '3,3,8,8 需要 3 步');
    assert.deepEqual(st.errors, []);
    assert.ok(!/id="winModal" hidden/.test(html), '应弹出胜利面板');
    // 合成成功只给结果：面板里不许再出现算式
    const winModal = (html.match(/<div class="modal" id="winModal"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/) || [''])[0];
    assert.ok(winModal, '应能找到胜利面板');
    assert.ok(!/win-expr/.test(winModal), '通关面板不该再有算式容器');
    const winBody = winModal.replace(/<div class="modal__actions">[\s\S]*?<\/div>\s*<\/div>/, '');
    const winText = winBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    assert.ok(!/[=÷×+−]/.test(winText), '通关面板不该出现算式符号：' + winText);
    assert.ok(/步/.test(winText), '通关面板保留成绩：' + winText);
    assert.ok(winText.length <= 40, `通关面板字数应很少，实际 ${winText.length}：${winText}`);
    // 彩带 2~4 秒后自行销毁，dump 时机不可靠，改看“撒过没有 + 撒了多少”
    const conf = (st.notes || []).find((n) => /^confetti=/.test(n));
    assert.ok(conf, '通关时应撒彩带（见 debug 诊断信息）');
    assert.ok(Number(conf.split('=')[1]) > 10, '彩带数量太少: ' + conf);
  });

/* ---------------- H5 / 移动端 ---------------- */

scenario('h5', 'iPhone 竖屏：布局不溢出、牌桌不裁切、识别为触摸设备',
  'index.html?deal=7,5,6,2&debug=1&touch=1', (st) => {
    const v = st.view;
    assert.ok(v, '缺少视口信息');
    assert.equal(v.overflowX, 0, `横向溢出了 ${v.overflowX}px`);
    assert.equal(v.overflowY, 0, `纵向溢出了 ${v.overflowY}px`);
    assert.ok(v.boardFits, '卡牌区超出了牌桌范围（会被裁掉）');
    assert.equal(v.cardCount, 4);
    assert.ok(v.cardW >= 140 && v.cardH >= 190, `牌太小: ${v.cardW}x${v.cardH}（手机上两张一行，应该做得大）`);
    assert.ok(v.boardH > v.cardH * 1.5, `4 张牌应排成 2×2，实际棋盘高 ${v.boardH} / 牌高 ${v.cardH}`);
    assert.ok(v.boardW <= v.cardW * 2 + 40, `一行只该有两张，实际棋盘宽 ${v.boardW}`);
    assert.ok(v.boardTop >= v.tableTop - 1 && v.boardBottom <= v.tableBottom + 1, '两行牌超出了牌桌');
    assert.ok(v.appH > 0 && Math.abs(v.appH - v.vh) <= 2, `.app 高度(${v.appH}) 与视口(${v.vh}) 不一致`);
    assert.equal(v.isTouch, true, '应识别为触摸设备');
    assert.deepEqual(st.errors, []);
  }, IPHONE_12);

scenario('h5', '手机竖屏：圆环在两牌中点展开、小球够大、整圈不出屏',
  'index.html?deal=7,5,6,2&demo=drag&touch=1&debug=1', (st, html) => {
    assert.equal(st.popupOpen, true);
    assert.equal(st.ringItems, 4, '圆环应恰好是 4 个运算符');
    assert.equal(st.ringOpen, true);
    assert.ok(!html.includes('op-popup'), '不该再出现底部抽屉那套结构');
    assert.ok(st.view.ringBtnH >= 48, `运算符小球 ${st.view.ringBtnH}px 偏小，拇指不好点`);
    // 圆心必须落在安全区内，否则圆环会被屏幕边缘切掉
    const safe = 132;
    assert.ok(st.ringX >= safe - 1 && st.ringX <= st.view.vw - safe + 1, `圆心 x=${st.ringX} 超出安全范围`);
    assert.ok(st.ringY >= safe - 1 && st.ringY <= st.view.vh - safe + 1, `圆心 y=${st.ringY} 超出安全范围`);
    // 两牌中点：拖拽演示是第 1 张拖到第 2 张上，圆心该落在两牌的中间高度
    assert.ok(Math.abs(st.ringX - st.view.vw / 2) < st.view.vw / 3, '圆心应靠近两牌中点');
    assert.equal(st.view.overflowX, 0);
    assert.deepEqual(st.errors, []);
  }, IPHONE_SE);

scenario('h5', '触摸拖拽：合成成功（抬牌偏移不影响落点判定）',
  'index.html?deal=7,5,6,2&demo=dragmerge&op=%2A&touch=1&debug=1', (st) => {
    assert.equal(cardsOf(st), '35,6,2', '触摸拖拽应能正常合成');
    assert.equal(st.moves, 1);
    assert.deepEqual(st.errors, []);
  }, IPHONE_SE);

scenario('h5', '小屏竖屏（可用 500×640）：不溢出、牌桌完整、仍是两行两列',
  'index.html?deal=1,5,5,5&demo=drag&touch=1&debug=1', (st) => {
    assert.equal(st.view.overflowX, 0);
    assert.equal(st.view.overflowY, 0);
    assert.ok(st.view.boardFits, '卡牌区被裁切');
    assert.equal(st.ringItems, 4, '小屏上也应是 4 个符号的圆环');
    assert.ok(st.view.boardH > st.view.cardH * 1.5, '小屏也应两张一行');
    assert.deepEqual(st.errors, []);
  }, ANDROID);

scenario('h5', '最窄可用高度（可用 500×568）：仍然两张一行且放得下',
  'index.html?deal=3,3,8,8&debug=1&touch=1', (st) => {
    assert.equal(st.view.overflowX, 0, `横向溢出 ${st.view.overflowX}px`);
    assert.ok(st.view.boardFits, '卡牌区被裁切');
    assert.ok(st.view.cardW >= 90, `牌太小: ${st.view.cardW}`);
    assert.ok(st.view.boardH > st.view.cardH * 1.5, '矮屏也应两张一行');
    assert.deepEqual(st.errors, []);
  }, TINY);

scenario('h5', '手机横屏（844×390）：压缩布局后仍然不溢出',
  'index.html?deal=3,3,8,8&debug=1&touch=1', (st) => {
    assert.equal(st.view.overflowX, 0, `横向溢出 ${st.view.overflowX}px`);
    assert.equal(st.view.overflowY, 0, `纵向溢出 ${st.view.overflowY}px`);
    assert.ok(st.view.boardFits, '横屏下卡牌区被裁切');
    assert.ok(st.view.vh < 500 && st.view.cardH <= 120, '横屏应使用紧凑牌面');
    assert.ok(st.view.boardH < st.view.cardH * 1.5, '横屏高度不够两行，应排成一行四张');
    assert.deepEqual(st.errors, []);
  }, LANDSCAPE);

scenario('h5', '横屏也能正常合成（落点判定不被任何浮层挡住）',
  'index.html?deal=7,5,6,2&demo=dragmerge&op=%2B&touch=1&debug=1', (st) => {
    assert.equal(cardsOf(st), '12,6,2', '横屏下拖拽合成应正常');
    assert.deepEqual(st.errors, []);
    assert.ok((st.notes || []).some((n) => /命中=5/.test(n)), '松手位置应正确命中第二张牌');
  }, LANDSCAPE);

scenario('h5', '浮层不抢交互：拖拽时提示条 / 调试面板都不挡落点',
  'index.html?deal=7,5,6,2&demo=drag&touch=1&debug=1', (st, html) => {
    assert.equal(st.popupOpen, true, '浮层不该吃掉落点');
    assert.ok((st.notes || []).some((n) => /命中=5/.test(n)), '命中判定应落在牌上');
    assert.ok(!/元素=(banner|PRE|rotate-hint)/.test((st.notes || []).join(' ')), '命中的元素不该是浮层');
    assert.deepEqual(st.errors, []);
  }, LANDSCAPE);

scenario('h5', '真实能力探测：模拟 iPhone 触摸环境（不靠 URL 强制）也能识别为触摸设备',
  'index.html?deal=3,3,8,8&debug=1', (st, html) => {
    assert.equal(st.view.isTouch, true, '应通过 ontouchstart/pointer:coarse 识别出触摸设备');
    assert.ok(/<html[^>]*class="[^"]*is-touch/.test(html), 'html 上应带 is-touch 标记');
    assert.ok(/--app-h:\s*\d+px/.test(html), '应由 JS 写入 --app-h 兜底 100vh');
    assert.equal(st.view.overflowX, 0);
    assert.deepEqual(st.errors, []);
  }, IPHONE_12);

scenario('h5', '桌面端不误判为触摸设备，圆环同样是弹出形态',
  'index.html?deal=7,5,6,2&demo=drag&touch=0&debug=1', (st) => {
    assert.equal(st.ringItems, 4, '桌面上也是同一套圆环');
    assert.equal(st.view.isTouch, false);
    assert.equal(st.view.overflowX, 0);
    // 桌面空间足够，牌回到一行四张（手机才是两张一行）
    assert.ok(st.view.boardH < st.view.cardH * 1.5, `桌面应一行四张，实际棋盘 ${st.view.boardW}×${st.view.boardH}`);
    assert.ok(st.view.boardW > st.view.cardW * 3, '一行应有四张牌');
    assert.deepEqual(st.errors, []);
  }, DESKTOP);

/* ---------------- 视觉风格：明快糖果街机 ---------------- */

// 把 "rgb(r, g, b)"/"#rgb"/"#rrggbb" 统一成 0~255 三元组
function rgbOf(v) {
  if (!v) return null;
  const hex = String(v).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const m = String(v).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  return m[1].split(',').slice(0, 3).map((n) => Math.round(parseFloat(n)));
}
const lin = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : Math.pow((c / 255 + 0.055) / 1.055, 2.4));
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
function contrast(a, b) {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

scenario('theme', '配色是明快的纸面：浅底 + 深墨字，没有整块深色压着',
  'index.html?deal=7,5,6,2&debug=1&touch=1', (st) => {
    const th = st.theme;
    assert.ok(th, '调试面板应给出配色探针');
    const bg = rgbOf(th.bodyBg);
    assert.ok(bg, 'body 应有实底色，而不是全透明：' + th.bodyBg);
    assert.ok(lum(bg) > 0.72, `页面底色偏暗（亮度 ${lum(bg).toFixed(2)}），要明快纸面`);
    const text = rgbOf(th.text), dim = rgbOf(th.textDim);
    assert.ok(contrast(text, bg) >= 7, `正文对比度只有 ${contrast(text, bg).toFixed(1)}:1`);
    assert.ok(contrast(dim, bg) >= 4.5, `次级文字对比度只有 ${contrast(dim, bg).toFixed(1)}:1`);
    // 牌面：白卡上的数字（第一张是红桃/方块，红也要够清楚）
    const cardR = contrast(rgbOf(th.cardInk), [255, 255, 255]);
    assert.ok(cardR >= 4.5, `牌面数字对比度只有 ${cardR.toFixed(1)}:1`);
    assert.deepEqual(st.errors, []);
  }, IPHONE_SE);

scenario('theme', '四个运算符各自一颗糖果色，符号都看得清（≥4.5:1）',
  'index.html?deal=7,5,6,2&demo=drag&touch=1&debug=1', (st) => {
    const th = st.theme;
    const ink = rgbOf(th.ringInk);
    assert.ok(ink, '圆环符号应有实色');
    for (const name of ['mint', 'coral', 'amber', 'sky']) {
      const c = rgbOf(th[name]);
      assert.ok(c, `缺少糖果色 --${name}`);
      const r = contrast(ink, c);
      assert.ok(r >= 4.5, `${name} 上的符号对比度只有 ${r.toFixed(1)}:1`);
    }
    assert.equal(st.ringItems, 4, '四个符号都在');
    assert.deepEqual(st.errors, []);
  }, IPHONE_SE);

scenario('theme', '背景有缓慢漂移的光晕（动态但只是 transform/opacity）',
  'index.html?deal=3,3,8,8&debug=1', (st) => {
    assert.match(st.theme.drift, /drift-/, '两团光晕的漂移动画没生效');
    assert.match(st.theme.bodyImg, /radial-gradient/, '背景应是多层光晕而不是纯色');
    assert.deepEqual(st.errors, []);
  }, DESKTOP);

scenario('theme', '主按钮：薄荷底 + 深墨字，按下去会“沉”下去',
  'index.html?deal=3,3,8,8&debug=1&touch=1', (st, html) => {
    const ink = rgbOf(st.theme.primaryInk);
    const mint = rgbOf(st.theme.mint);
    assert.ok(contrast(ink, mint) >= 4.5, `主按钮文字对比度只有 ${contrast(ink, mint).toFixed(1)}:1`);
    // 街机手感：本体有厚底边（4px 实体阴影），按下去才会“沉”
    assert.match(st.theme.primaryShadow || '', /4px 0px 0px|4px 0 0/, '主按钮缺少厚底边：' + st.theme.primaryShadow);
    assert.deepEqual(st.errors, []);
  }, IPHONE_SE);

/* ---------------- 圆环取消 / 横屏引导 / 分享 / PWA ---------------- */

scenario('h5', '界面上找不到任何快捷键提示（已全部移除）',
  'index.html?deal=6,6,6,6&demo=drag&debug=1&touch=1', (st, html) => {
    assert.ok(!/<kbd/i.test(html), '页面里还有 <kbd>');
    assert.ok(!/快捷键/i.test(html), '页面里还提到“快捷键”');
    assert.ok(!/\bShift\b|\bEsc\b|\bCtrl\b/.test(html), '还残留按键名');
    assert.equal(st.popupOpen, true, '圆环应已打开（用来检查面板里没有多余文字）');
    assert.equal(st.ringItems, 4, '面板里只该有 4 个符号');
    // 圆环里除了符号和“取消”，不该再有任何说明/快捷键文案
    const ringHtml = (html.split('id="opRing"')[1] || '').split('id="fxLayer"')[0];
    assert.ok(!/kbd|快捷键|Shift|Ctrl/.test(ringHtml), '圆环里残留了提示文案');
    assert.deepEqual(st.errors, []);
  }, IPHONE_SE);

scenario('h5', '点圆环外面（或“取消”）→ 收起圆环，两张牌回到原位',
  'index.html?deal=7,5,6,2&demo=ringcancel&touch=1&debug=1', (st, html) => {
    assert.equal(st.popupOpen, false, '点遮罩后圆环应已关闭');
    assert.equal(cardsOf(st), '7,5,6,2', '取消合成不应改变牌面');
    assert.equal(st.moves, 0);
    assert.ok(!/is-open/.test(html.split('op-ring')[1] || ''), '圆环不该还处于展开态');
    assert.ok(!/is-pending/.test(html), '两张牌不应还处于待合成态');
    assert.deepEqual(st.errors, []);
  }, IPHONE_SE);

scenario('h5', '横屏且空间很矮：出现“转回竖屏”引导',
  'index.html?deal=3,3,8,8&debug=1&touch=1', (st, html) => {
    assert.equal(st.view.orientation, 'landscape');
    assert.equal(st.view.crampedLandscape, true);
    assert.equal(st.view.rotateHint.everShown, true, '横屏挤的时候应弹出引导条（会自动退场，所以看“出现过”标记）');
    assert.ok(html.includes('转回竖屏'), '引导文案应说明为什么');
    assert.deepEqual(st.errors, []);
  }, LANDSCAPE);

scenario('h5', '竖屏不打扰用户：不显示横屏引导',
  'index.html?deal=3,3,8,8&debug=1&touch=1', (st, html) => {
    assert.equal(st.view.orientation, 'portrait');
    assert.equal(st.view.crampedLandscape, false);
    assert.notEqual(st.view.rotateHint.everShown, true, '竖屏不该弹引导条');
    assert.deepEqual(st.errors, []);
  }, IPHONE_12);

scenario('h5', '微信内分享：弹出右上角“···”引导而不是系统分享',
  'index.html?demo=share&wx=1&debug=1&touch=1', (st, html) => {
    assert.equal(st.view.wechat, true, '应识别为微信环境');
    assert.ok(!/id="shareGuide"[^>]*hidden/.test(html), '应显示分享引导');
    assert.ok(html.includes('点右上角'), '引导应指向右上角菜单');
    assert.ok(/id="installBtn"[^>]*hidden/.test(html), '微信里不显示“安装到桌面”');
    assert.deepEqual(st.errors, []);
  }, IPHONE_12);

scenario('h5', '非微信（file://）不弹分享引导，走系统分享/复制链接',
  'index.html?demo=share&wx=0&debug=1', (st, html) => {
    assert.equal(st.view.wechat, false);
    assert.ok(/id="shareGuide"[^>]*hidden/.test(html), '非微信不应弹引导');
    assert.ok(st.view.swError, 'file:// 下应记录“无法注册 Service Worker”的原因');
    assert.match(st.view.swError, /http/, '原因应说明需要 http(s)');
    assert.deepEqual(st.errors, []);
  }, DESKTOP);

/* ---------------- 执行 ---------------- */

const jobs = only ? scenarios.filter((s) => s.group === only) : scenarios;
if (only === 'pwa') console.log('（pwa 组：先在线首访装 Service Worker，再关掉服务器验证离线）');
let failed = 0;
let done = 0;

async function runOne(job, profile) {
  const html = await dumpDom(job.url, {
    budget: 14000,
    timeout: Number(process.env.TIMEOUT || 14000),
    profile,
    ...job.opts,
  });
  done++;
  const st = debugState(html);
  try {
    assert.ok(st, '未拿到 debug 面板（页面可能没跑起来）');
    assert.ok(html.includes('id="board"'), 'DOM 不完整');
    job.check(st, html);
    console.log(`  ✓ ${job.name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${job.name}\n    ${e.message}`);
    console.error('    状态:', JSON.stringify(st && st.view ? { cards: st.cards, view: st.view } : st));
    fs.writeFileSync(path.join(OUT, `fail-${job.name.replace(/\W+/g, '_')}.html`), html);
  }
}

/* PWA 离线能力：本沙箱里 Chrome 的网络服务起不来（http 页面恒为 0 字节），
   所以离线行为改由 test/pwa.test.mjs 直接执行 sw.js 的事件处理函数来验证，
   这里只检查“在不满足条件的环境下是否正确跳过注册并说明原因”。 */
async function runPwaOffline() {
  if (only && only !== 'pwa') return;
  const html = await dumpDom('index.html?debug=1&sw=1', { budget: 9000, timeout: 11000, profile: 'profile-pwa', windowSize: '390,844', mobile: true, deviceScale: 3 });
  const st = debugState(html);
  done++;
  try {
    assert.ok(st, '页面没跑起来');
    assert.equal(st.view.swReady, false, 'file:// 下不应注册成功');
    assert.match(st.view.swError, /http/, '应说明需要 http(s) 环境');
    assert.deepEqual(st.errors, [], '这种“预期内的跳过”不应算作页面错误');
    console.log('  ✓ PWA：file:// 下正确跳过 Service Worker 并说明原因（离线逻辑见 test/pwa.test.mjs）');
  } catch (e) {
    failed++;
    console.error(`  ✗ PWA 环境判定\n    ${e.message}`);
    console.error('    状态:', JSON.stringify(st && st.view));
  }
}

await runPwaOffline();

const queue = jobs.slice();
const WORKERS = Math.min(3, queue.length);
await Promise.all(Array.from({ length: WORKERS }, async (_, wi) => {
  while (queue.length) {
    const job = queue.shift();
    await runOne(job, `profile-${wi}`);
  }
}));

console.log(failed
  ? `\n真机自检结束：${done - failed}/${done} 通过，${failed} 个场景失败\n`
  : `\n真机自检全部通过（${done} 个场景）\n`);
process.exit(failed ? 1 : 0);
