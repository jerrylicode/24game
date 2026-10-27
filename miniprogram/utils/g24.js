/* =========================================================
   g24.js —— 逻辑层加载器
   把 H5 版的四个纯逻辑模块挂到 G24 命名空间上，原文件零改动。
   依赖顺序：fraction → solver → dealer（dealer 用 Solver 出题）
   ========================================================= */
const G = typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof GameGlobal !== 'undefined' ? GameGlobal : {});

if (!G.G24) G.G24 = {};

require('./fraction.js');
require('./solver.js');
require('./dealer.js');
require('./levels.js');

module.exports = G.G24;
