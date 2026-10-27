/* =========================================================
   make-levels.mjs —— 生成闯关模式的 300 关（15 档 × 20 关）
   运行： node tools/make-levels.mjs
   产物： js/levels.js（纯数据，浏览器直接 <script> 引入）

   难度怎么排（人类眼里的难，不是“解法数量少”）：
     a. 只用 + − × 就能凑出来               → 最容易（幼儿园）
     b. 必须用 ÷，但只是“除以一个数”         → 中等
     c. 必须“除以一个式子”（a ÷ (b − c ÷ d)）→ 难
     d. 整数中间值走不通、必须用分数          → 再加一档
   再叠加解法数量（越多越简单）、数字大小、四数之和，得到一个硬度分，
   按分数从低到高排序，等距抽出 300 关，每 20 关一档。
   整个流程是确定性的：同样的代码永远生成同一份 levels.js。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const js = (f) => fs.readFileSync(path.join(root, 'js', f), 'utf8');

for (const f of ['fraction.js', 'solver.js']) {
  vm.runInThisContext(js(f), { filename: f });
}
const { Solver } = globalThis.G24;

const TIERS = [
  { name: '幼儿园',   rule: 'int',  note: '只用加减乘，数字都是个位数' },
  { name: '小学生',   rule: 'int',  note: '整数算得出来，开始要试两步' },
  { name: '中学生',   rule: 'frac', note: '除法登场，答案可能是分数' },
  { name: '高中生',   rule: 'frac', note: '解法变少，得先想好顺序' },
  { name: '大学生',   rule: 'frac', note: '一条路走错就绕不回来' },
  { name: '研究生',   rule: 'frac', note: '要垫一两步' },
  { name: '博士生',   rule: 'frac', note: '常见的坑都埋在这一档' },
  { name: '副教授',   rule: 'frac', note: '解法只剩个位数' },
  { name: '教授',     rule: 'frac', note: '分数中间值开始常驻' },
  { name: '阿基米德', rule: 'frac', note: '得把式子反过来用' },
  { name: '祖冲之',   rule: 'frac', note: '一眼看不出门道' },
  { name: '欧拉',     rule: 'frac', note: '层层嵌套' },
  { name: '高斯',     rule: 'frac', note: '几乎没有试错空间' },
  { name: '图灵',     rule: 'frac', note: '往往只有唯一解' },
  { name: '数学之王', rule: 'frac', note: '全库最难的 20 副' },
];
const PER_TIER = 20;
const TOTAL = TIERS.length * PER_TIER;   // 300

/* ---------------- 1. 枚举所有牌面 ---------------- */

const deals = [];
for (let a = 1; a <= 13; a++) {
  for (let b = a; b <= 13; b++) {
    for (let c = b; c <= 13; c++) {
      for (let d = c; d <= 13; d++) deals.push([a, b, c, d]);
    }
  }
}

/* ---------------- 2. 给每副牌打难度分 ---------------- */

const items = [];
for (const v of deals) {
  const sols = Solver.solutions(v, 80, {});
  if (!sols.length) continue;

  const sol = sols.length;
  const intSol = Solver.countSolutions(v, 200, { integerOnly: true });
  const noDiv = sols.some((e) => e.indexOf('÷') < 0);
  const plainDiv = sols.some((e) => e.indexOf('÷') >= 0 && e.indexOf('÷ (') < 0);
  const fracOnly = intSol === 0;
  const max = Math.max(...v);
  const sum = v.reduce((a, b) => a + b, 0);

  // 难度分（越小越简单）——分三段，段与段之间不重叠：
  //   0xxx 只用加减乘   1xxx 要除法   2xxx 必须“除以一个式子”
  // 同一段里：数字越大越难（max×3），解法越少越难（-min(sol,20)），必须分数再 +300
  const struct = noDiv ? 0 : plainDiv ? 1 : 2;
  const hardness =
    struct * 1000
    + (fracOnly ? 300 : 0)
    + (max * 3 - Math.min(20, sol)) * 2
    + sum * 0.05;

  items.push({ v, sol, intSol, noDiv, nested: struct === 2, fracOnly, max, sum, hardness, struct });
}

items.sort((x, y) => (x.hardness - y.hardness) || (x.v.join(',') < y.v.join(',') ? -1 : 1));

/* ---------------- 3. 挑 300 关 ----------------
   两头的档位用“连续的 20 副”，保证名副其实：
     幼儿园 = 难度队列最前面 20 副（1·2·3·4 起步）
     数学之王 = 队列最后 20 副（全库最难）
   中间的 13 档在剩下的队列里等距抽，越往后越难。 */

const queue = items.slice().sort((a, b) => (a.hardness - b.hardness) || (a.v.join(',') < b.v.join(',') ? -1 : 1));
const used = new Set();
const take = (list, out) => {
  for (const m of list) {
    const k = m.v.join(',');
    if (used.has(k)) continue;
    used.add(k);
    out.push(m);
    if (out.length >= PER_TIER) return;
  }
};

const first = [];
const last = [];
take(queue, first);                                   // 幼儿园
take(queue.slice().reverse(), last);                  // 数学之王（倒着取最难的）
last.reverse();

const middle = queue.filter((m) => !used.has(m.v.join(',')));
const need = TOTAL - PER_TIER * 2;                    // 260 关
const picked = first.concat();
const step = (middle.length - 1) / (need - 1);
for (let i = 0; i < need; i++) {
  let k = Math.round(i * step);
  while (used.has(middle[k].v.join(','))) k = Math.min(middle.length - 1, k + 1);
  used.add(middle[k].v.join(','));
  picked.push(middle[k]);
}

picked.push(...last);

const levelList = picked.map((d, i) => {
  const tier = Math.floor(i / PER_TIER);
  // 整数档里万一这副牌整数算不出来（理论上不会，前面按“不用除法”优先），就放宽为允许分数
  const intOk = Solver.isSolvable(d.v, { integerOnly: true });
  return {
    t: tier,
    n: d.v.slice(),
    r: TIERS[tier].rule === 'int' && !intOk ? 'frac' : TIERS[tier].rule,
    sol: d.sol,
    h: Math.round(d.hardness * 10) / 10,
  };
});

/* ---------------- 4. 落成 levels.js ---------------- */

const lines = [];
lines.push('/* =========================================================');
lines.push('   levels.js —— 闯关模式关卡表（由 tools/make-levels.mjs 生成，别手改）');
lines.push(`   ${TOTAL} 关 = ${TIERS.length} 档 × ${PER_TIER} 关；难度从最容易排到最难。`);
lines.push('   字段：t=档位下标，n=四张牌，r=本关规则（int=只许整数中间值 / frac=允许分数）');
lines.push('        sol=标准规则下的解法数，h=难度分（只用于自检与说明，不影响玩法）');
lines.push('   ========================================================= */');
lines.push('(function (global) {');
lines.push("  'use strict';");
lines.push('  const G24 = global.G24 || (global.G24 = {});');
lines.push('  G24.LEVELS = {');
lines.push('    perTier: ' + PER_TIER + ',');
lines.push('    tiers: [');
for (const t of TIERS) {
  lines.push(`      { name: ${JSON.stringify(t.name)}, rule: ${JSON.stringify(t.rule)}, note: ${JSON.stringify(t.note)} },`);
}
lines.push('    ],');
lines.push('    levels: [');
for (const l of levelList) {
  lines.push(`      { t: ${l.t}, n: [${l.n.join(', ')}], r: '${l.r}', sol: ${l.sol}, h: ${l.h} },`);
}
lines.push('    ],');
lines.push('  };');
lines.push("})(typeof window !== 'undefined' ? window : globalThis);");
lines.push('');

fs.writeFileSync(path.join(root, 'js', 'levels.js'), lines.join('\n'), 'utf8');

/* ---------------- 5. 体检报告 ---------------- */

const perTier = TIERS.map((_, t) => levelList.filter((l) => l.t === t));
const meta = new Map(items.map((m) => [m.v.join(','), m]));
const STRUCT = ['加减乘', '要除法', '除以式子'];
console.log(`已生成 ${levelList.length} 关 → js/levels.js`);
console.log(`候选牌面 ${deals.length} 种，有解 ${items.length} 种，抽中 ${used.size} 种`);
console.log('档位          均解   分数题  结构分布                     前 3 关');
for (let t = 0; t < TIERS.length; t++) {
  const g = perTier[t];
  const sols = g.map((l) => l.sol);
  const m = g.map((l) => meta.get(l.n.join(',')));
  const fo = m.filter((x) => x.fracOnly).length;
  const st = [0, 1, 2].map((k) => m.filter((x) => x.struct === k).length);
  console.log(
    `${TIERS[t].name.padEnd(4, '　')}  ${String((sols.reduce((a, b) => a + b, 0) / 20).toFixed(1)).padStart(5)}`
    + `  ${String(fo).padStart(5)}/20`
    + `   ${st.map((n, k) => `${STRUCT[k]}${n}`).join(' / ').padEnd(26)}`
    + `  ${g.slice(0, 3).map((l) => l.n.join('·')).join('  ')}`,
  );
}
const bad = levelList.filter((l) => !Solver.isSolvable(l.n, { integerOnly: l.r === 'int' }));
console.log(bad.length ? `✗ ${bad.length} 关在本关规则下无解` : '✓ 300 关在本关规则下全部有解');

let mono = true;
for (let i = 1; i < levelList.length; i++) {
  if (levelList[i].h < levelList[i - 1].h) { mono = false; break; }
}
console.log(mono ? '✓ 300 关难度分严格不降（越往后越难）' : '✗ 难度分出现倒挂');
console.log(`   第 1 关 ${levelList[0].n.join('·')}（难度 ${levelList[0].h}） → 第 300 关 ${levelList[299].n.join('·')}（难度 ${levelList[299].h}）`);
