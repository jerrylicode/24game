/* =========================================================
   fraction.js —— 精确分数运算
   24 点里会出现 8/(3-8/3) 这类需要分数的解，
   用浮点数判断相等会出错，所以全程用分数。
   对外暴露：G24.Fraction
   ========================================================= */
(function (global) {
  'use strict';
  const G24 = (global.G24 = global.G24 || {});

  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { const t = a % b; a = b; b = t; }
    return a || 1;
  }

  class Fraction {
    constructor(n, d = 1) {
      if (!Number.isFinite(n) || !Number.isFinite(d)) throw new Error('Fraction: 非法数值');
      if (d === 0) throw new Error('Fraction: 分母不能为 0');
      if (d < 0) { n = -n; d = -d; }
      const g = gcd(n, d);
      this.n = n / g;
      this.d = d / g;
      Object.freeze(this);
    }

    static of(v) { return v instanceof Fraction ? v : new Fraction(v); }

    add(o) { o = Fraction.of(o); return new Fraction(this.n * o.d + o.n * this.d, this.d * o.d); }
    sub(o) { o = Fraction.of(o); return new Fraction(this.n * o.d - o.n * this.d, this.d * o.d); }
    mul(o) { o = Fraction.of(o); return new Fraction(this.n * o.n, this.d * o.d); }
    div(o) {
      o = Fraction.of(o);
      if (o.n === 0) throw new Error('除数为 0');
      return new Fraction(this.n * o.d, this.d * o.n);
    }

    eq(o) { o = Fraction.of(o); return this.n === o.n && this.d === o.d; }
    isZero() { return this.n === 0; }
    isInteger() { return this.d === 1; }
    isNegative() { return this.n < 0; }
    valueOf() { return this.n / this.d; }
    toString() { return this.d === 1 ? String(this.n) : `${this.n}/${this.d}`; }

    /** 牌面/界面展示：负号用排版减号，分数用 “8/3” */
    toDisplay() {
      const sign = this.n < 0 ? '−' : '';
      const n = Math.abs(this.n);
      return this.d === 1 ? sign + n : `${sign}${n}/${this.d}`;
    }

    /** 从任意值解析："3/4"、2.5、Fraction 都可以 */
    static parse(v) {
      if (v instanceof Fraction) return v;
      if (typeof v === 'string') {
        const s = v.trim().replace('−', '-');
        if (s.includes('/')) {
          const [a, b] = s.split('/');
          return new Fraction(Number(a), Number(b));
        }
        v = Number(s);
      }
      if (!Number.isFinite(v)) throw new Error('Fraction.parse: 无法解析 ' + v);
      if (Number.isInteger(v)) return new Fraction(v);
      // 把小数展开成精确分数（支持 1 位~6 位小数）
      const s = String(v);
      const dec = s.split('.')[1] || '';
      const pow = Math.pow(10, dec.length);
      return new Fraction(Math.round(v * pow), pow);
    }
  }

  G24.Fraction = Fraction;
  G24.gcd = gcd;
})(typeof window !== 'undefined' ? window : globalThis);
