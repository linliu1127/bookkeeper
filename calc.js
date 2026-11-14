/* 計算機：純函式，不使用 eval。先乘除後加減，結果四捨五入到 2 位小數。 */
(function (root) {
  'use strict';

  var OPS = '+−×÷';

  function isOp(ch) {
    return ch !== '' && OPS.indexOf(ch) !== -1;
  }

  // 算式（如 "12+3×4"）→ 數字；算式不完整或無法計算（除以 0）回傳 null
  function evaluate(expr) {
    var s = String(expr).replace(/[+−×÷]+$/, '');
    if (!s) return null;
    var t = s.match(/\d+\.?\d*|\.\d+|[+−×÷]/g);
    if (!t || t.length % 2 === 0) return null;

    var term = parseFloat(t[0]);
    if (isNaN(term)) return null;
    var total = 0;
    var sign = 1;

    for (var i = 1; i < t.length; i += 2) {
      var op = t[i];
      var n = parseFloat(t[i + 1]);
      if (isNaN(n)) return null;
      if (op === '×') {
        term *= n;
      } else if (op === '÷') {
        if (n === 0) return null;
        term /= n;
      } else {
        total += sign * term;
        sign = op === '+' ? 1 : -1;
        term = n;
      }
    }
    total += sign * term;
    if (!isFinite(total)) return null;
    return Math.round((total + Number.EPSILON) * 100) / 100;
  }

  // 按鍵 → 新的算式字串
  function press(expr, key) {
    var last = expr.charAt(expr.length - 1);

    if (key === 'C') return '';
    if (key === 'back') return expr.slice(0, -1);

    if (key === '=') {
      var v = evaluate(expr);
      return v === null ? expr : String(v);
    }

    if (isOp(key)) {
      if (expr === '') return expr;
      if (isOp(last)) return expr.slice(0, -1) + key;
      return expr + key;
    }

    if (key === '.') {
      var cur = expr.split(/[+−×÷]/).pop();
      if (cur.indexOf('.') !== -1) return expr;
      if (cur === '') return expr + '0.';
      return expr + '.';
    }

    if (/^\d$/.test(key)) {
      var curNum = expr.split(/[+−×÷]/).pop();
      if (curNum === '0') return expr.slice(0, -1) + key; // 避免 "007"
      if (expr.length >= 24) return expr;
      return expr + key;
    }

    return expr;
  }

  var api = { evaluate: evaluate, press: press, isOp: isOp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof window !== 'undefined' ? window : this);
