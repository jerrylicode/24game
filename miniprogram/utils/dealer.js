/* =========================================================
   dealer.js —— 出题：保证有解，并按难度控制解法数量
   对外暴露：G24.Dealer
   ========================================================= */
(function (global) {
  'use strict';
  const G24 = global.G24 || (global.G24 = {});
  const Solver = G24.Solver;

  const DIFFICULTIES = {
    easy:   { key: 'easy',   label: '休闲', min: 1, max: 9,  minSolutions: 10, limit: 12 },
    normal: { key: 'normal', label: '标准', min: 1, max: 10, minSolutions: 3,  limit: 6 },
    hard:   { key: 'hard',   label: '挑战', min: 1, max: 13, minSolutions: 1,  maxSolutions: 4, limit: 5 },
  };

  function randomInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

  function randomValues(cfg) {
    const vals = [];
    for (let k = 0; k < 4; k++) vals.push(randomInt(cfg.min, cfg.max));
    return vals;
  }

  function sameDeal(a, b) {
    return !!a && !!b && a.slice().sort().join(',') === b.slice().sort().join(',');
  }

  /**
   * 生成一副牌。
   * @param {string} difficulty easy | normal | hard
   * @param {object} rules { integerOnly }
   * @param {number[]} avoid 避免与它相同（上一次的牌面）
   */
  function deal(difficulty, rules, avoid) {
    const cfg = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
    let fallback = null;

    for (let attempt = 0; attempt < 500; attempt++) {
      const values = randomValues(cfg);
      if (sameDeal(values, avoid)) continue;

      const count = Solver.countSolutions(values, cfg.limit, rules);
      if (count === 0) { if (!fallback) fallback = values; continue; }

      const enough = count >= cfg.minSolutions;
      const fewEnough = cfg.maxSolutions ? count <= cfg.maxSolutions : true;
      if (enough && fewEnough) return { values, difficulty: cfg.key, solutionCount: count };
      if (!fallback && enough) fallback = values;
    }

    // 极端情况兜底：给一副一定有解的牌
    const safety = [3, 3, 8, 8];
    return { values: fallback || safety, difficulty: cfg.key, solutionCount: Solver.countSolutions(fallback || safety, 12, rules) };
  }

  G24.Dealer = { DIFFICULTIES, deal, randomInt, sameDeal };
})(typeof window !== 'undefined' ? window : globalThis);
