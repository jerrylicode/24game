/* =========================================================
   solver.js —— 24 点求解器（精确分数，可作为提示 / 出题 / 判死依据）
   对外暴露：G24.Solver
   ========================================================= */
(function (global) {
  'use strict';
  const G24 = global.G24 || (global.G24 = {});
  const F = G24.Fraction;

  /** 四种运算：key 用于内部/键盘，sym 用于展示 */
  const OPS = [
    { key: '+', sym: '+', commutative: true, apply: (a, b) => a.add(b) },
    { key: '-', sym: '−', commutative: false, apply: (a, b) => a.sub(b) },
    { key: '*', sym: '×', commutative: true, apply: (a, b) => a.mul(b) },
    { key: '/', sym: '÷', commutative: false, apply: (a, b) => a.div(b) },
  ];
  const OP_BY_KEY = OPS.reduce((m, o) => (m[o.key] = o, m), {});
  const OP_SYM = OPS.reduce((m, o) => (m[o.key] = o.sym, m), {});

  /** 去掉最外层多余括号：("(3+5)" -> "3+5") */
  function trimOuter(s) {
    if (s && s[0] === '(' && s[s.length - 1] === ')') {
      let depth = 0;
      for (let i = 0; i < s.length; i++) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')') { depth--; if (depth === 0 && i < s.length - 1) return s; }
      }
      return s.slice(1, -1);
    }
    return s;
  }

  const PREC = { '+': 1, '-': 1, '*': 2, '/': 2 };

  /** 子表达式是否需要括号（最小括号原则） */
  function operandText(item, parentOp, isRight) {
    if (!item.op) return item.expr;                       // 叶子：就是一个数，不用括号
    const need = PREC[item.op] < PREC[parentOp]
      || (isRight && parentOp === '/')                    // a ÷ (b × c) 必须带括号
      || (isRight && parentOp === '-' && PREC[item.op] === 1); // a − (b ± c) 必须带括号
    return need ? `(${item.expr})` : item.expr;
  }

  /** 用最小括号拼出算式，例如 "8 ÷ (3 − 8 ÷ 3)" */
  function composeExpr(left, right, opKey) {
    return `${operandText(left, opKey, false)} ${OP_SYM[opKey]} ${operandText(right, opKey, true)}`;
  }

  function leaf(v) {
    const f = F.of(v);
    return { v: f, expr: f.toDisplay(), display: f.toDisplay(), key: '#' + f.toString(), op: null };
  }

  function itemsFromValues(values) {
    return values.map((v) => {
      if (v && v.v instanceof F) {
        return {
          v: v.v,
          expr: v.expr || v.v.toDisplay(),
          display: v.v.toDisplay(),
          key: v.key || '#' + v.v.toString(),
          op: v.op || null,
        };
      }
      return leaf(v);
    });
  }

  /**
   * 计算一步运算。
   * rules: { integerOnly: 中间结果必须是整数 }
   * 返回 { ok, value, reason }
   */
  function compute(opKey, a, b, rules) {
    rules = rules || {};
    const op = OP_BY_KEY[opKey];
    if (!op) return { ok: false, reason: '未知运算' };
    const left = F.of(a && a.v instanceof F ? a.v : a);
    const right = F.of(b && b.v instanceof F ? b.v : b);
    if (opKey === '/' && right.isZero()) return { ok: false, reason: '÷0 不行' };
    let value;
    try { value = op.apply(left, right); } catch (e) { return { ok: false, reason: '不能这样算' }; }
    if (rules.integerOnly && !value.isInteger()) return { ok: false, reason: '要求整数' };
    return { ok: true, value };
  }

  /** 一层内的所有候选；非交换运算两个方向都生成 */
  function* candidates(items, rules) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        for (const op of OPS) {
          const dirs = op.commutative ? [[i, j]] : [[i, j], [j, i]];
          for (const [x, y] of dirs) {
            const r = compute(op.key, items[x].v, items[y].v, rules);
            if (!r.ok) continue;
            const left = items[x], right = items[y];
            const merged = {
              v: r.value,
              expr: composeExpr(left, right, op.key),
              display: r.value.toDisplay(),
              op: op.key,
              key: op.commutative
                ? `(${[left.key, right.key].sort().join(OP_SYM[op.key])})`
                : `(${left.key}${OP_SYM[op.key]}${right.key})`,
            };
            const rest = items.filter((_, k) => k !== i && k !== j);
            yield {
              i: x, j: y, op: op.key, left, right, result: r.value,
              items: rest.concat([merged]),
              score: (r.value.isInteger() ? 0 : 4) + (r.value.isNegative() ? 2 : 0) + OPS.indexOf(op),
            };
          }
        }
      }
    }
  }

  function sortedCandidates(items, rules) {
    const list = Array.from(candidates(items, rules));
    list.sort((a, b) => a.score - b.score);
    return list;
  }

  /**
   * 找一条从当前牌面走到 24 的完整步骤链。
   * 返回 [{ i, j, op, left, right, result, expr }, ...] 或 null
   */
  function findSteps(values, rules) {
    return dfs(itemsFromValues(values), rules || {});
  }

  function dfs(items, rules) {
    if (items.length === 1) return items[0].v.eq(24) ? [] : null;
    for (const cand of sortedCandidates(items, rules)) {
      const sub = dfs(cand.items, rules);
      if (sub) {
        return [{
          i: cand.i, j: cand.j, op: cand.op,
          left: cand.left, right: cand.right,
          result: cand.result,
          expr: cand.items[cand.items.length - 1].expr,
        }].concat(sub);
      }
    }
    return null;
  }

  function isSolvable(values, rules) {
    return findSteps(values, rules) !== null;
  }

  /** 收集至多 limit 条互不相同的解法（按算式结构去重） */
  function solutions(values, limit, rules) {
    const items = itemsFromValues(values);
    const found = new Set();
    const out = [];
    collect(items, rules || {}, found, out, limit || 6);
    return out;
  }

  function collect(items, rules, found, out, limit) {
    if (out.length >= limit) return;
    if (items.length === 1) {
      if (items[0].v.eq(24)) {
        const key = items[0].key;
        if (!found.has(key)) { found.add(key); out.push(items[0].expr); }
      }
      return;
    }
    for (const cand of sortedCandidates(items, rules)) {
      if (out.length >= limit) return;
      collect(cand.items, rules, found, out, limit);
    }
  }

  /** 解法数量（最多数到 limit，用于出题难度控制） */
  function countSolutions(values, limit, rules) {
    const items = itemsFromValues(values);
    const found = new Set();
    const out = [];
    collect(items, rules || {}, found, out, limit || 40);
    return out.length;
  }

  G24.Solver = {
    OPS, OP_BY_KEY, OP_SYM,
    trimOuter, composeExpr, compute, candidates: sortedCandidates,
    findSteps, isSolvable, solutions, countSolutions,
    leaf, itemsFromValues,
    /** 一步运算的可读写法，例如 "7 + 5 = 12" */
    equation(step) {
      return `${step.left.v.toDisplay()} ${OP_SYM[step.op]} ${step.right.v.toDisplay()} = ${step.result.toDisplay()}`;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
