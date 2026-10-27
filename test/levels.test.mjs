/* =========================================================
   levels.test.mjs —— 闯关关卡表的数据体检（Node 直接跑，无需浏览器）
   运行： node test/levels.test.mjs
   覆盖：15 档 × 20 关 / 唯一性 / 每关可解 / 规则正确 / 难度单调 / 首尾合理
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const js = (f) => fs.readFileSync(path.join(here, '..', 'js', f), 'utf8');

for (const f of ['fraction.js', 'solver.js', 'levels.js']) {
  vm.runInThisContext(js(f), { filename: f });
}

const { Solver, LEVELS } = globalThis.G24;
const { tiers, levels, perTier } = LEVELS;

let pass = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
}

const TIER_NAMES = ['幼儿园', '小学生', '中学生', '高中生', '大学生', '研究生', '博士生',
  '副教授', '教授', '阿基米德', '祖冲之', '欧拉', '高斯', '图灵', '数学之王'];

/* ---------------- 结构 ---------------- */

test('15 档，每档 20 关，共 300 关', () => {
  assert.equal(tiers.length, 15);
  assert.equal(perTier, 20);
  assert.equal(levels.length, 300);
  for (let t = 0; t < 15; t++) {
    const g = levels.filter((l) => l.t === t);
    assert.equal(g.length, 20, `第 ${t + 1} 档应有 20 关`);
  }
});

test('档位名称与顺序和需求一致', () => {
  assert.deepEqual(tiers.map((t) => t.name), TIER_NAMES);
});

test('关号 = 下标 + 1，且按档位顺序排列', () => {
  levels.forEach((l, i) => {
    assert.equal(l.t, Math.floor(i / 20), `第 ${i + 1} 关的档位不对`);
  });
});

/* ---------------- 内容 ---------------- */

test('每关 4 张牌，都是 1..13 的整数，升序排列', () => {
  levels.forEach((l, i) => {
    assert.equal(l.n.length, 4, `第 ${i + 1} 关不是 4 张牌`);
    l.n.forEach((v) => {
      assert.ok(Number.isInteger(v) && v >= 1 && v <= 13, `第 ${i + 1} 关有非法点数 ${v}`);
    });
    assert.deepEqual(l.n, l.n.slice().sort((a, b) => a - b), `第 ${i + 1} 关没排序`);
  });
});

test('300 关互不相同（没有重复牌面）', () => {
  const seen = new Set();
  levels.forEach((l, i) => {
    const k = l.n.join(',');
    assert.ok(!seen.has(k), `第 ${i + 1} 关与前面重复：${k}`);
    seen.add(k);
  });
  assert.equal(seen.size, 300);
});

test('每关在本关规则下都有解', () => {
  levels.forEach((l, i) => {
    const ok = Solver.isSolvable(l.n, { integerOnly: l.r === 'int' });
    assert.ok(ok, `第 ${i + 1} 关 ${l.n.join('·')}（规则 ${l.r}）无解`);
  });
});

test('规则字段只有 int / frac；只有前两档强制整数', () => {
  levels.forEach((l, i) => {
    assert.ok(l.r === 'int' || l.r === 'frac', `第 ${i + 1} 关规则非法`);
    if (l.t >= 2) assert.equal(l.r, 'frac', `第 ${i + 1} 关不该强制整数`);
    if (l.t <= 1) assert.equal(l.r, 'int', `第 ${i + 1} 关应强制整数`);
  });
});

/* ---------------- 难度 ---------------- */

test('难度分逐关不下降（越往后越难）', () => {
  for (let i = 1; i < levels.length; i++) {
    assert.ok(levels[i].h >= levels[i - 1].h - 1e-9,
      `第 ${i + 1} 关（${levels[i].h}）比第 ${i} 关（${levels[i - 1].h}）容易`);
  }
});

test('幼儿园都是小数字，第一关是经典入门', () => {
  const g = levels.slice(0, 20);
  g.forEach((l, i) => {
    assert.ok(Math.max(...l.n) <= 9, `第 ${i + 1} 关不是个位数：${l.n.join('·')}`);
  });
  assert.deepEqual(levels[0].n, [1, 2, 3, 4], '第 1 关应是 1·2·3·4');
});

test('数学之王是最难的 20 副：平均解法很少，且要除以式子/必须用分数', () => {
  const g = levels.slice(-20);
  const avgSol = g.reduce((a, l) => a + l.sol, 0) / 20;
  assert.ok(avgSol <= 4, `最后一档平均解法数偏多：${avgSol}`);
  const nasty = g.filter((l) => {
    const sols = Solver.solutions(l.n, 20, {});
    const intSol = Solver.countSolutions(l.n, 20, { integerOnly: true });
    return intSol === 0 || sols.every((e) => e.indexOf('÷') >= 0 && e.indexOf('÷ (') >= 0);
  }).length;
  assert.ok(nasty >= 12, `最后一档只有 ${nasty}/20 副是“必须分数/除以式子”的硬题`);
});

test('后 10 档的牌面要求明显高于前 5 档', () => {
  const avg = (arr) => arr.reduce((a, l) => a + l.sol, 0) / arr.length;
  const easy = avg(levels.slice(0, 100));
  const hard = avg(levels.slice(200));
  assert.ok(easy > hard * 2, `前 100 关平均解法 ${easy.toFixed(1)}，后 100 关 ${hard.toFixed(1)}，差距不够`);
});

/* ---------------- 输出 ---------------- */

console.log(pass ? `\n全部通过：${pass} 组断言\n` : '\n有失败\n');
