/* =========================================================
   logic.test.mjs —— 纯逻辑层测试（Node 直接跑，无需浏览器）
   运行： node test/logic.test.mjs
   覆盖：分数运算 / 求解器 / 提示步骤链 / 出题器难度约束
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const js = (f) => fs.readFileSync(path.join(here, '..', 'js', f), 'utf8');

for (const f of ['fraction.js', 'solver.js', 'dealer.js']) {
  vm.runInThisContext(js(f), { filename: f });
}

const { Fraction: F, Solver, Dealer } = globalThis.G24;

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

console.log('\nFraction 精确分数');
test('约分与四则运算', () => {
  assert.equal(new F(6, 8).toString(), '3/4');
  assert.equal(new F(1, 3).add(new F(1, 6)).toString(), '1/2');
  assert.equal(new F(3, 4).sub(new F(1, 4)).toString(), '1/2');
  assert.equal(new F(2, 3).mul(new F(3, 4)).toString(), '1/2');
  assert.equal(new F(8, 3).div(new F(4, 3)).toString(), '2');
  assert.equal(new F(-1, 2).toDisplay(), '−1/2');
});
test('除以 0 抛错，parse 支持 "8/3"', () => {
  assert.throws(() => new F(1).div(new F(0)));
  assert.equal(F.parse('8/3').toString(), '8/3');
  assert.equal(F.parse(2.5).toString(), '5/2');
});

console.log('\nSolver 求解');
const KNOWN_SOLVABLE = [[3, 3, 8, 8], [1, 5, 5, 5], [1, 3, 4, 6], [4, 4, 10, 10], [2, 7, 8, 8], [5, 5, 5, 1]];
const KNOWN_UNSOLVABLE = [[1, 1, 1, 1], [1, 1, 1, 2], [7, 7, 7, 7], [13, 13, 13, 13]];

test('经典可解牌面都能解出', () => {
  for (const v of KNOWN_SOLVABLE) {
    assert.ok(Solver.isSolvable(v), `${v} 应可解`);
  }
});
test('经典无解牌面判为无解', () => {
  for (const v of KNOWN_UNSOLVABLE) {
    assert.ok(!Solver.isSolvable(v), `${v} 应无解`);
  }
});
test('[3,3,8,8] 需要分数中间值：8 ÷ (3 − 8 ÷ 3)', () => {
  const steps = Solver.findSteps([3, 3, 8, 8]);
  assert.ok(steps && steps.length === 3);
  // 关掉分数中间值就应当无解
  assert.ok(!Solver.isSolvable([3, 3, 8, 8], { integerOnly: true }));
});
test('提示步骤链可逐步执行并最终得到 24', () => {
  for (const v of KNOWN_SOLVABLE) {
    let items = v.map((n) => F.of(n));
    const steps = Solver.findSteps(items);
    assert.ok(steps, `${v} 无解?`);
    for (const s of steps) {
      assert.ok(s.i >= 0 && s.i < items.length && s.j >= 0 && s.j < items.length && s.i !== s.j, '索引越界');
      const r = Solver.compute(s.op, items[s.i], items[s.j], {});
      assert.ok(r.ok, '步骤不可执行');
      assert.equal(r.value.toString(), s.result.toString(), '步骤结果与求解器不一致');
      const rest = items.filter((_, k) => k !== s.i && k !== s.j);
      items = rest.concat([r.value]);
    }
    assert.equal(items.length, 1);
    assert.equal(items[0].toString(), '24', `${v} 最终不是 24`);
  }
});
test('solutions() 去重且算式合法', () => {
  const list = Solver.solutions([3, 3, 8, 8], 6);
  assert.ok(list.length >= 1);
  assert.equal(new Set(list).size, list.length, '存在重复解法');
  assert.ok(list.every((e) => e.includes('÷') || e.includes('×') || e.includes('+') || e.includes('−')));
});
test('integerOnly 规则下不会给出分数中间结果', () => {
  const steps = Solver.findSteps([2, 3, 4, 6], { integerOnly: true });
  assert.ok(steps);
  for (const s of steps) assert.ok(s.result.isInteger());
});
test('除数为 0 不可选', () => {
  const r = Solver.compute('/', F.of(5), F.of(0), {});
  assert.equal(r.ok, false);
});

/* ---- 算式字符串的括号必须正确（回归：曾经生成过 "8 ÷ 3 − 8 ÷ 3"） ---- */
function evalExpr(src) {
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  let i = 0;
  const skip = () => { while (s[i] === ' ') i++; };
  function expr() {
    let v = term();
    for (;;) {
      skip();
      if (s[i] === '+') { i++; v = v.add(term()); }
      else if (s[i] === '-') { i++; v = v.sub(term()); }
      else return v;
    }
  }
  function term() {
    let v = factor();
    for (;;) {
      skip();
      if (s[i] === '*') { i++; v = v.mul(factor()); }
      else if (s[i] === '/') { i++; v = v.div(factor()); }
      else return v;
    }
  }
  function factor() {
    skip();
    if (s[i] === '(') { i++; const v = expr(); skip(); assert.equal(s[i], ')', `括号不匹配: ${src}`); i++; return v; }
    if (s[i] === '-') { i++; return factor().mul(F.of(-1)); }
    const start = i;
    while (i < s.length && /[0-9/]/.test(s[i])) i++;
    assert.ok(i > start, `无法解析: ${src}`);
    return F.parse(s.slice(start, i));
  }
  const v = expr();
  skip();
  assert.equal(i, s.length, `算式有剩余字符: ${src}`);
  return v;
}

console.log('\n算式字符串');
test('经典解法的算式字符串求值等于 24', () => {
  assert.equal(evalExpr('8 ÷ (3 − 8 ÷ 3)').toString(), '24');
  assert.equal(evalExpr('(3 + 5) × (7 − 4)').toString(), '24');
  assert.equal(evalExpr('5 × (5 − 1 ÷ 5)').toString(), '24');
});
test('求解器产出的所有解法算式都能正确求值为 24', () => {
  const deals = [[3, 3, 8, 8], [1, 5, 5, 5], [1, 3, 4, 6], [4, 4, 10, 10], [2, 3, 4, 6], [6, 6, 6, 6], [12, 12, 1, 1]];
  let checked = 0;
  for (const d of deals) {
    const list = Solver.solutions(d, 8);
    assert.ok(list.length > 0, `${d} 应该有解`);
    for (const s of list) {
      assert.equal(evalExpr(s).toString(), '24', `${d} 的解法算式错误: ${s}`);
      checked++;
    }
  }
  assert.ok(checked >= 10, `检查样本太少: ${checked}`);
});
test('提示步骤链每一步的算式都能还原出该步的结果', () => {
  for (const d of [[3, 3, 8, 8], [1, 5, 5, 5], [4, 4, 10, 10]]) {
    const steps = Solver.findSteps(d);
    for (const s of steps) {
      assert.equal(evalExpr(s.expr).toString(), s.result.toString(), `步骤算式错误: ${s.expr} 应为 ${s.result}`);
    }
    assert.equal(evalExpr(steps[steps.length - 1].expr).toString(), '24');
  }
});
test('最小括号：不出现多余的嵌套括号', () => {
  const s = Solver.findSteps([3, 3, 8, 8]).pop().expr;
  assert.equal(s, '8 ÷ (3 − 8 ÷ 3)');
  const s2 = Solver.findSteps([1, 5, 5, 5]).pop().expr;
  assert.equal(evalExpr(s2).toString(), '24');
  assert.ok(!s2.includes('(('), `出现多余括号: ${s2}`);
});

console.log('\nDealer 出题');
test('每个难度都出有解的牌（各 40 局）', () => {
  for (const key of Object.keys(Dealer.DIFFICULTIES)) {
    for (let i = 0; i < 40; i++) {
      const d = Dealer.deal(key, {}, null);
      assert.equal(d.values.length, 4);
      assert.ok(d.values.every((n) => n >= 1 && n <= 13), '数字越界');
      assert.ok(Solver.isSolvable(d.values), `${key} 出了无解牌面 ${d.values}`);
    }
  }
});
test('难度约束：休闲解法多、挑战解法少', () => {
  const easy = Dealer.deal('easy', {}, null);
  const easyCount = Solver.countSolutions(easy.values, 20);
  assert.ok(easyCount >= 10, `休闲局解法应 ≥10，实得 ${easyCount}`);
  for (let i = 0; i < 15; i++) {
    const hard = Dealer.deal('hard', {}, null);
    const hardCount = Solver.countSolutions(hard.values, 20);
    assert.ok(hardCount >= 1 && hardCount <= 4, `挑战局解法应 1~4，实得 ${hardCount} (${hard.values})`);
  }
});
test('不会连续发出同一副牌', () => {
  let prev = null;
  for (let i = 0; i < 30; i++) {
    const d = Dealer.deal('normal', {}, prev);
    assert.ok(!Dealer.sameDeal(d.values, prev), `重复发牌 ${d.values}`);
    prev = d.values;
  }
});
test('开启整数限制时出的牌仍可解', () => {
  for (let i = 0; i < 20; i++) {
    const d = Dealer.deal('normal', { integerOnly: true }, null);
    assert.ok(Solver.isSolvable(d.values.map(F.of), { integerOnly: true }), `${d.values} 在整数规则下无解`);
  }
});

console.log(`\n全部通过：${pass} 组断言${process.exitCode ? '（有失败）' : ''}\n`);
