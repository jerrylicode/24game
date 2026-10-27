/* =========================================================
   layout.test.mjs —— “移动端优先 + 两张一行”的静态契约（不需要浏览器）
   运行： node test/layout.test.mjs

   为什么要有这份测试：
   无头 Chrome 的窗口宽度会被系统钳在 500px 左右，320/375/390 这些
   真机宽度其实测不到。所以窄屏这一档改用“解析 CSS + 算账”的方式守住：
   两张一行、牌尽量大、且两行必须塞得进牌桌。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const cssRaw = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
// 解析前先去掉注释：注释里提到 @media(...) 会被误当成媒体查询
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const game = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');

let pass = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
};

/** 取出某个 @media 块的内容（只处理不嵌套的单层块） */
function mediaBlocks(src) {
  const out = [];
  const re = /@media([^{]+)\{/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex;
    let depth = 1;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    out.push({ condition: m[1].trim(), body: src.slice(re.lastIndex, i - 1) });
    re.lastIndex = i;
  }
  return out;
}

const blocks = mediaBlocks(css);
const minWidth = (cond) => {
  const m = cond.match(/min-width:\s*(\d+)px/);
  return m ? Number(m[1]) : null;
};
const boardRule = (css.match(/\n\.board\s*\{([\s\S]*?)\n\}/) || [])[1] || '';

/* ---------- 1. 真正的“移动端优先”：不该再有给手机打补丁的 max-width ---------- */
test('没有针对手机的 max-width 补丁（宽屏才是增强方向）', () => {
  const offenders = blocks.filter((b) => /max-width:/.test(b.condition)).map((b) => b.condition);
  assert.deepEqual(offenders, [], '这些媒体查询还在用 max-width: ' + offenders.join(' | '));
});

test('保留的媒体查询只有“能力 / 姿态 / 高度”这几类', () => {
  const allowed = blocks
    .map((b) => b.condition)
    .filter((c) => !minWidth(c))
    .filter((c) => !/prefers-reduced-motion|orientation|max-height|hover/.test(c));
  assert.deepEqual(allowed, [], '出现了意料之外的查询条件: ' + allowed.join(' | '));
});

/* ---------- 2. 两张一行：靠棋盘的 max-width 锁死 ---------- */
const boardOffset = Number((boardRule.match(/max-width:\s*calc\(var\(--card-w\) \* 2 \+ (\d+)px\)/) || [])[1]);
const boardGap = Number((boardRule.match(/gap:\s*(\d+)px/) || [])[1]);
const boardPad = Number((boardRule.match(/padding:\s*(\d+)px/) || [])[1]);

test('棋盘宽度只够放两张牌（4 张牌必然是 2×2）', () => {
  assert.ok(boardOffset > 0, '棋盘 max-width 应写成 calc(var(--card-w) * 2 + Npx)');
  assert.equal(boardOffset, boardGap + boardPad * 2,
    `max-width 的余量应正好等于 牌距 ${boardGap} + 两侧内边距 ${boardPad * 2}`);
  assert.match(boardRule, /flex-wrap:\s*wrap/, '必须允许换行，否则会横向溢出');
});

test('剩 1 张 / 3 张时仍然居中（靠 justify-content，不是写死位置）', () => {
  assert.match(boardRule, /justify-content:\s*center/);
  assert.ok(!/grid-template-columns/.test(boardRule), '不要用固定列数的 grid，单张牌会贴边');
});

test('桌面/平板横屏才回到一行四张', () => {
  const wide = blocks.find((b) => minWidth(b.condition) === 721);
  assert.match(wide.body, /\.board\s*\{[^}]*max-width:\s*720px/, '≥721px 应放开到一行四张');
  assert.match(wide.body, /\.board\s*\{[^}]*gap:\s*18px 22px/);
});

test('横屏手机也是四张一行（高度只有 300 上下，摆不下两行）', () => {
  // 横屏规则有两块（一块调横屏引导条），取动了牌尺寸的那块
  const land = blocks.find((b) => /orientation:\s*landscape/.test(b.condition) && /--card-w/.test(b.body));
  assert.match(land.body, /\.board\s*\{[^}]*max-width:\s*720px/);
});

/* ---------- 3. 牌尺寸：宽度和高度谁先到听谁的 ---------- */
const fluid = css.match(
  /--card-w:\s*min\((\d+)px,\s*calc\(\(100vw - (\d+)px\)\s*\/\s*2\),\s*calc\(\(100vh - (\d+)px\)\s*\/\s*([\d.]+)\)\)/);
const fallbackW = Number((css.match(/--card-w:\s*(\d+)px;/) || [])[1]);
const aspect = Number((css.match(/--card-h:\s*calc\(var\(--card-w\) \* ([\d.]+)\)/) || [])[1]);

test('牌尺寸按可用空间自适应（宽度、高度取最小值），并留老内核定值兜底', () => {
  assert.ok(fluid, '应有 min(上限, 宽度约束, 高度约束) 形式的 --card-w');
  assert.ok(fallbackW >= 100, `老内核兜底牌宽偏小: ${fallbackW}`);
  assert.ok(Math.abs(aspect - 1.42) < 0.01, `宽高比应为 1.42，实际 ${aspect}`);
  assert.equal(Number(fluid[1]), 152, '牌宽上限应为 152px');
});

test('没有 min() 的老内核：矮窗口另给一档小牌（用 @supports 判能力，不猜 UA）', () => {
  assert.match(css, /@supports not \(width: min\(1px, 2px\)\)/, '缺少 @supports 能力判断');
  const guard = css.slice(css.indexOf('@supports not (width: min(1px, 2px))'));
  assert.match(guard, /--card-w:\s*92px/, '矮窗口兜底档缺失');
});

/* ---------- 4. 算账：两行牌必须塞得进牌桌 ---------- */
// 常数来自 CSS 与实测：牌桌 padding 16×2；顶栏（两行）+ 底栏 ≈199px
const CHROME = 199;
const TABLE_PAD = 32;
const SIZE = { max: Number(fluid[1]), wPad: Number(fluid[2]), hPad: Number(fluid[3]), hr: Number(fluid[4]) };

const cardAt = (vw, vh) => {
  const w = Math.min(SIZE.max, (vw - SIZE.wPad) / 2, (vh - SIZE.hPad) / SIZE.hr);
  return { w: Math.round(w), h: Math.round(w * aspect) };
};

test('常见手机上：两张一行、牌明显变大（≥130px）、两行都在牌桌内', () => {
  for (const [vw, vh, minCard] of [[390, 844, 150], [414, 896, 150], [430, 932, 150], [375, 667, 130], [360, 640, 120]]) {
    const c = cardAt(vw, vh);
    assert.ok(c.w >= minCard, `${vw}×${vh} 的牌只有 ${c.w}px，应该 ≥${minCard}px`);
    assert.ok(2 * c.w + boardOffset <= vw - TABLE_PAD, `${vw}×${vh} 两列放不下`);
    assert.ok(2 * c.h + boardOffset <= vh - CHROME - TABLE_PAD, `${vw}×${vh} 两行放不下（两行高 ${2 * c.h}）`);
  }
});

test('小屏也不溢出：320×568 仍然两张一行', () => {
  const c = cardAt(320, 568);
  assert.ok(c.w >= 95, `320×568 的牌只有 ${c.w}px`);
  assert.ok(2 * c.w + boardOffset <= 320 - TABLE_PAD, '两列放不下');
  assert.ok(2 * c.h + boardOffset <= 568 - CHROME - TABLE_PAD, `两行放不下（两行高 ${2 * c.h}）`);
});

test('桌面 1280×880 回到一行四张（104px 手牌尺寸）', () => {
  const c = cardAt(1280, 880);
  assert.ok(c.w >= SIZE.max, '桌面会顶到 152 上限，需要媒体查询改回 104');
  const wide = blocks.find((b) => minWidth(b.condition) === 721);
  const cardW = Number((wide.body.match(/--card-w:\s*(\d+)px/) || [])[1]);
  assert.equal(cardW, 104, '桌面牌宽应回到 104px');
  assert.ok(4 * cardW + 3 * 22 <= 720, '720px 棋盘要能放下四张 104px 牌');
});

/* ---------- 5. 主界面：图标为主、文字为辅 ---------- */
const headerHtml = () => html.slice(html.indexOf('<header'), html.indexOf('</header>'));
const footerHtml = () => html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));

test('顶栏是两段式：一排图标工具 + 一条四格记分牌', () => {
  const topbar = (css.match(/\n\.topbar\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
  assert.match(topbar, /flex-direction:\s*column/, '顶栏应纵向分两段');
  assert.match(headerHtml(), /class="topbar__row"/, '第一段应是 logo + 图标工具');
  const stats = (css.match(/\n\.stats\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
  assert.match(stats, /grid-template-columns:\s*1\.3fr 1fr 1fr 1fr/, '记分牌四格（关卡那格略宽）');
  const rowPart = headerHtml().slice(headerHtml().indexOf('topbar__row'), headerHtml().indexOf('class="stats"'));
  assert.equal((rowPart.match(/class="tool /g) || []).length, 4, '四个设置工具全在第一段（难度已换成关卡档位）');
});

test('主界面按钮全是“图标 + 一行小字”，没有纯文字按钮', () => {
  const chrome = headerHtml() + footerHtml();
  const tools = chrome.match(/<button[^>]*class="tool[^"]*"[\s\S]*?<\/button>/g) || [];
  assert.equal(tools.length, 9, `主界面应有 9 个图标按钮（实际 ${tools.length}）`);
  for (const b of tools) {
    assert.match(b, /<svg class="icon/, '每个按钮都要有 SVG 图标');
    assert.match(b, /class="tool__cap"/, '每个按钮都要跟一行小字');
  }
  assert.ok(!/[\u{1F0CF}\u{1F4A1}\u{1F9E0}\u{1F50A}\u{1F4E4}\u{1F4F2}\u21A9\u21BA]/u.test(chrome),
    '主界面还在用 emoji / 箭头字符当图标（应统一成 SVG）');
});

test('图标统一线宽，并按功能分色', () => {
  assert.match(css, /\.icon\s*\{[\s\S]*?stroke:\s*currentColor[\s\S]*?stroke-width:\s*2\.1/, '图标统一 2.1 线宽');
  for (const id of ['undoBtn', 'restartBtn', 'hintBtn', 'solveBtn']) {
    assert.match(css, new RegExp(`#${id} \\.icon \\{ color: var\\(--`), `${id} 应有自己的强调色`);
  }
});

test('换牌是工具坞的主按钮：正中间、更高、轻轻浮动', () => {
  const ids = (footerHtml().match(/id="(\w+Btn)"/g) || []).map((b) => b.slice(4, -1));
  assert.deepEqual(ids, ['undoBtn', 'restartBtn', 'mapBtn', 'hintBtn', 'solveBtn'], '顺序固定，关卡地图在正中间');
  assert.match(html, /id="mapBtn" class="tool tool--hero"/, '主按钮是关卡地图');
  assert.match(css, /\.tool--hero\s*\{[\s\S]*?min-height:\s*64px/);
  assert.match(css, /@keyframes heroFloat/);
  assert.match(css, /--dock-h:\s*84px/, '工具坞高度要写成变量');
  assert.match(css, /bottom:\s*calc\(var\(--dock-h\)/, '横幅要贴在工具坞上方，不能压住按钮');
});

test('难度不再由玩家选：关卡自带档位与规则', () => {
  assert.ok(!/<select id="difficulty"/.test(html), '不该再有难度下拉框');
  assert.ok(!/id="difficulty"/.test(html), '不该再有难度按钮');
  const lv = fs.readFileSync(path.join(root, 'js', 'levels.js'), 'utf8');
  assert.match(lv, /G24\.LEVELS = \{/, '应有独立的关卡数据文件');
  assert.equal((lv.match(/name: "/g) || []).length, 15, '关卡表应有 15 个档位');
  assert.match(html, /<script src="js\/levels\.js"><\/script>/, '页面要加载关卡数据');
  assert.match(game, /function startLevel\(n, opts\)/, '游戏里要有“开始某一关”');
  assert.match(game, /setIntegerOnly\(levelDef\(state\.level\)\.r === 'int'/, '每关按自己的规则设置整数限制');
});

test('关卡地图：15 档横向滑轨，每档 20 个关卡格子', () => {
  assert.match(html, /id="levelModal"/);
  assert.match(html, /id="levelPager"/);
  assert.match(html, /id="levelTabs"/);
  assert.match(css, /\.lvm__pager\s*\{[\s\S]*?scroll-snap-type:\s*x mandatory/, '滑轨要能整页吸附');
  assert.match(css, /\.lvm__page\s*\{[\s\S]*?flex:\s*0 0 100%/, '每档占满一页');
  assert.match(css, /\.lvm__grid\s*\{[^}]*repeat\(5/, '每档 5 列 × 4 行');
  assert.match(css, /\.lvm__node\.is-current/, '当前关要单独高亮');
  assert.match(game, /function renderLevelList\(\)/, '列表由 JS 渲染进度');
  assert.match(game, /function setActiveTier\(/, '切档由 JS 负责（滑轨 + 标签同步）');
  assert.match(game, /data-level="\$\{n\}"/, '每个格子带关号');
  assert.match(game, /data-tab="\$\{ti\}"/, '每个档位标签带下标');
});

test('答案面板：右上角关闭，不再占底部一行', () => {
  const ans = html.slice(html.indexOf('id="answerModal"'), html.indexOf('id="winModal"'));
  assert.match(ans, /class="modal__close"[^>]*data-close="answerModal"/, '答案面板要有右上角关闭按钮');
  assert.match(ans, /class="modal__close"[^>]*aria-label="关闭"/, '关闭按钮要能被读屏念出来');
  assert.ok(!/data-close="answerModal">关闭</.test(ans), '底部不该再有“关闭”按钮');
  assert.equal((ans.match(/class="modal__actions"/g) || []).length, 1, '底部只留一行操作');
  assert.match(ans, /id="demoBtn"/, '自动演示按钮要保留');
  assert.match(css, /\.mhd \.modal__close \{ margin-left: auto/, '关闭按钮要贴到右上角');
});

test('关卡弹层在移动端完整居中：限高 + 两段式滑轨', () => {
  assert.match(css, /max-height:\s*min\(88dvh, 660px\)/, '用 dvh 限高，避免地址栏把弹层顶出屏幕');
  assert.match(html, /class="lvm__close"[^>]*data-close="levelModal"/, '右上角要有关闭按钮');
  assert.match(html, /class="lvm__close"[^>]*aria-label="关闭"/, '关闭按钮要能被读屏念出来');
  assert.match(css, /\.lvm__close,[\s\S]*?\.modal__close \{[\s\S]*?border-radius:\s*50%/, '关闭按钮是圆钮（两处共用一套样式）');
  const card = (css.match(/\n\.modal \.modal__card--levels\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
  assert.match(card, /overflow:\s*hidden/, '弹层自身不滚，只有标签条和滑轨滚');
  assert.match(card, /flex-direction:\s*column/, '上下结构：标题 / 标签 / 滑轨 / 底部');
  assert.match(css, /@media \(max-height: 560px\)[\s\S]*?\.lvm__node \{[^}]*min-height: 26px/, '矮屏缩小格子保证完整显示');
});

test('规则开关搬进说明面板，主界面不放规则文字', () => {
  assert.ok(!/ruleBtn/.test(headerHtml()), '顶栏不该再有“整数中间值”文字按钮');
  const help = html.slice(html.indexOf('id="helpModal"'), html.indexOf('id="answerModal"'));
  assert.match(help, /id="ruleBtn"[^>]*role="switch"/, '规则开关应在说明面板里');
  assert.match(help, /class="switch__knob"/);
  assert.match(game, /dom\.ruleBtn\.setAttribute\('aria-checked'/, '开关用 aria-checked 表达状态');
});

test('运算符圆心的“取消”也是一枚图标', () => {
  const ring = html.slice(html.indexOf('id="opRing"'), html.indexOf('id="fxLayer"'));
  assert.match(ring, /class="op-ring__cancel"[\s\S]*?<svg class="icon"/, '取消按钮里应是 SVG 图标');
  assert.match(ring, /d="M9 14\.5 4 9\.5l5-5"/, '取消图标应是回退箭头的箭头');
  assert.match(ring, /a5\.8 5\.8 0 0 1 0 11\.6/, '取消图标应带向右绕下去的弯钩');
  assert.ok(!/m6\.5 6\.5 11 11/.test(ring), '不该再用 ✕ 叉号');
  assert.match(ring, /aria-label="取消这次合成"/);
});

/* ---------- 6. 快捷键已经彻底移除 ---------- */
test('页面里没有任何快捷键提示（kbd / 括号里的按键名）', () => {
  assert.ok(!/<kbd/i.test(html), 'index.html 里还有 <kbd>');
  assert.ok(!/快捷键/.test(html), 'index.html 里还提到快捷键');
  assert.ok(!/\([A-Z]\)|（[A-Z]）/.test(html), '标题里还带着按键名');
  assert.ok(!/^kbd\s*\{/m.test(css), 'CSS 里还留着 kbd 样式');
  assert.ok(!/op-popup__tip--kb/.test(css + html + game), '还留着键盘提示的样式类');
});

test('JS 不再有字母快捷键，只保留 Esc 关闭浮层', () => {
  const letterShortcuts = [...game.matchAll(/key\s*===\s*'([a-z])'/g)].map((m) => m[1]);
  assert.deepEqual(letterShortcuts, [], '还残留字母快捷键: ' + letterShortcuts.join(','));
  assert.match(game, /e\.key !== 'Escape'/, 'Esc 应保留（关浮层，防止被困住）');
  assert.ok(!/addEventListener\('keydown', onPopupKey/.test(game), '面板不应再监听键盘');
});

/* ---------- 7. 运算符圆环（参考 Filee 的格式圆环） ---------- */
const ringItem = (css.match(/\n\.op-ring__item\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
const ringSafe = Number((game.match(/const RING_SAFE = (\d+)/) || [])[1]);
const ringR = Number((css.match(/\.op-ring\s*\{[^}]*--r:\s*(\d+)px/) || [])[1]);

test('面板只有 4 个运算符 + 取消，且不显示任何运算结果', () => {
  const ops = [...html.matchAll(/class="op-ring__item"[^>]*data-op="([+\-*/])"/g)].map((m) => m[1]);
  assert.deepEqual(ops, ['+', '-', '*', '/'], 'HTML 里应正好是 + − × ÷ 四个符号');
  assert.equal((html.match(/op-ring__cancel/g) || []).length, 1, '圆心应有“取消”');
  const syms = [...html.matchAll(/class="op-ring__item"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(syms, ['+', '−', '×', '÷'], '按钮上只写符号，不带结果');
  assert.ok(!/op-btn__res|op-btn__swap|op-popup|is-sheet/.test(html + css + game),
    '结果数字 / 反向按钮 / 旧抽屉面板都不该再出现');
  assert.ok(!/= 35|结果预览/.test(html), '不该在面板里预先显示运算结果');
});

test('是“弹出”而不是“抽屉”：固定层 + 遮罩，没有贴底抽屉', () => {
  const ring = (css.match(/\n\.op-ring\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
  assert.match(ring, /position:\s*fixed/);
  assert.match(ring, /inset:\s*0/);
  assert.match(css, /\.op-ring__scrim\s*\{[^}]*opacity:\s*0/, '遮罩应从透明淡入');
  assert.match(css, /\.op-ring\.is-open \.op-ring__scrim\s*\{[^}]*opacity:\s*1/);
  assert.ok(!/bottom:\s*calc\(10px \+ env\(safe-area-inset-bottom/.test(css),
    '不该再有贴着安全区的底部抽屉');
  assert.ok(!/op-popup/.test(css), '旧面板样式应删干净');
});

test('弹出动画：小球从圆心弹出、错开时间、带回弹', () => {
  // 收起态：缩在圆心、透明
  assert.match(ringItem, /transform:\s*translate\(0, 0\) scale\(0\.35\)/);
  assert.match(ringItem, /opacity:\s*0/);
  // 展开态：飞到各自方位
  assert.match(css, /\.op-ring\.is-open \.op-ring__item\s*\{[^}]*translate\(var\(--tx\), var\(--ty\)\)/);
  // 回弹曲线 + 错峰延迟
  assert.match(ringItem, /cubic-bezier\(0\.34,\s*1\.56,\s*0\.64,\s*1\)/, '应有回弹（过冲）曲线');
  const delays = [...css.matchAll(/--d:\s*(\d+)ms/g)].map((m) => Number(m[1]));
  assert.deepEqual(delays, [0, 45, 90, 135], '四个小球应依次错开弹出');
  // 圓心那个“取消”最后出来
  assert.match(css, /\.op-ring__cancel\s*\{[\s\S]*?transition-delay:\s*60ms/);
  // 四个方位：两两对称
  for (const [i, sx, sy] of [[1, -1, -1], [2, 1, -1], [3, 1, 1], [4, -1, 1]]) {
    const rule = (css.match(new RegExp(`\\.op-ring__item:nth-of-type\\(${i}\\)\\s*\\{([\\s\\S]*?)\\}`)) || [])[1] || '';
    assert.match(rule, new RegExp(`--tx:\\s*calc\\(var\\(--r\\) \\* ${sx < 0 ? '-' : ''}0\\.72\\)`), `第 ${i} 个 x 方向不对`);
    assert.match(rule, new RegExp(`--ty:\\s*calc\\(var\\(--r\\) \\* ${sy < 0 ? '-' : ''}0\\.72\\)`), `第 ${i} 个 y 方向不对`);
  }
});

test('圆环在 320px 窄屏上也放得下（半径 + 小球 ≤ 安全区）', () => {
  assert.ok(ringSafe > 0, 'JS 里应有 RING_SAFE');
  assert.ok(ringR > 0, 'CSS 里应有 --r');
  const itemHalf = 28;                       // 56px 小球的一半
  assert.ok(ringR + itemHalf <= ringSafe, `半径 ${ringR} + 小球 ${itemHalf} 超出安全区 ${ringSafe}`);
  assert.ok(ringSafe * 2 <= 320, `安全区 ${ringSafe} 太大，320px 屏放不下整圈`);
});

test('圆环圆心落在两张牌的中点，并被夹在安全区内', () => {
  assert.match(game, /function positionRing\(\)/);
  assert.match(game, /midpoint\(popup\.a\.el, popup\.b\.el\)/, '圆心应取两张牌的中点');
  assert.match(game, /Math\.min\(Math\.max\(mid\.x, RING_SAFE\)/, 'x 方向要夹取');
  assert.match(game, /Math\.min\(Math\.max\(mid\.y, RING_SAFE\)/, 'y 方向要夹取');
  assert.match(game, /--x/, '圆心坐标写到 CSS 变量上');
});

test('点小球选符号；点“取消”或圆环外即放弃', () => {
  assert.match(game, /closest\('\.op-ring__item'\)/);
  assert.match(game, /closest\('\.op-ring__cancel'\)/);
  assert.match(game, /closest\('\.op-ring__scrim'\)/);
  assert.match(game, /e\.key !== 'Escape'/, 'Esc 仍可关闭');
});

test('左右操作数由拖拽/点选方向决定（不再有“反过来算”按钮）', () => {
  assert.ok(!/popup\.swap|toggleSwap|swap-btn/.test(game + html), '反向切换应已移除');
  assert.match(game, /const left = a;\s*\n\s*const right = b;/, '先拖（点）的那张是左操作数');
  assert.match(game, /async function executeMerge\(a, b, opKey\)/);
});

console.log(`\n全部通过：${pass} 组断言${process.exitCode ? '（有失败）' : ''}\n`);
