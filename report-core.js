/* 財務報表的純運算（不碰 DOM，可用 node 測試）。 */
(function (root) {
  'use strict';

  var MAX_MONTHS = 120;

  function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  // scope: { year, month }；year = 0 → 所有資料；month = 0 → 整年
  function inScope(date, scope) {
    if (!scope || !scope.year) return true;
    var pre = scope.year + '-' + (scope.month ? (scope.month < 10 ? '0' : '') + scope.month + '-' : '');
    return date.indexOf(pre) === 0;
  }

  // 依類別加總，金額由大到小。pct 為 0~100 的原始比例（未四捨五入）
  function aggregate(entries, type, scope) {
    var sums = {};
    var total = 0;
    entries.forEach(function (e) {
      if (e.type !== type || !inScope(e.date, scope)) return;
      sums[e.category] = (sums[e.category] || 0) + e.amount;
      total += e.amount;
    });
    var items = Object.keys(sums).map(function (k) {
      return { category: k, amount: r2(sums[k]), pct: total > 0 ? sums[k] / total * 100 : 0 };
    }).sort(function (a, b) { return b.amount - a.amount || (a.category < b.category ? -1 : 1); });
    return { total: r2(total), items: items };
  }

  function parseYM(s) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    var mo = Number(m[2]);
    if (mo < 1 || mo > 12) return null;
    return { y: Number(m[1]), m: mo };
  }

  // spec：數字（某一年的 12 個月）或 { from:'YYYY-MM', to:'YYYY-MM' }
  function monthRange(spec) {
    var out = [];
    if (typeof spec === 'number') {
      for (var m = 1; m <= 12; m++) out.push({ y: spec, m: m });
      return out;
    }
    var a = parseYM(spec && spec.from);
    var b = parseYM(spec && spec.to);
    if (!a || !b) return out;
    if (a.y * 12 + a.m > b.y * 12 + b.m) { var t = a; a = b; b = t; }
    var idx = a.y * 12 + (a.m - 1);
    var end = b.y * 12 + (b.m - 1);
    while (idx <= end && out.length < MAX_MONTHS) {
      out.push({ y: Math.floor(idx / 12), m: (idx % 12) + 1 });
      idx++;
    }
    return out;
  }

  // seriesId：balance | exp:* | inc:* | exp:<類別> | inc:<類別>
  // until（'YYYY-MM'，選填）：晚於該月、且沒有任何資料的月份回傳 null（尚未到來，不畫成 0）
  function monthlySeries(entries, months, seriesId, until) {
    var pos = {};
    months.forEach(function (mo, i) { pos[mo.y * 12 + mo.m] = i; });
    var vals = months.map(function () { return 0; });
    var kind = seriesId === 'balance' ? 'balance' : seriesId.split(':')[0];
    var cat = seriesId === 'balance' ? '*' : seriesId.slice(seriesId.indexOf(':') + 1);

    entries.forEach(function (e) {
      var y = Number(e.date.slice(0, 4));
      var m = Number(e.date.slice(5, 7));
      var i = pos[y * 12 + m];
      if (i === undefined) return;
      if (kind === 'balance') {
        vals[i] += e.type === 'income' ? e.amount : -e.amount;
      } else {
        var t = kind === 'exp' ? 'expense' : 'income';
        if (e.type !== t) return;
        if (cat !== '*' && e.category !== cat) return;
        vals[i] += e.amount;
      }
    });
    var cut = parseYM(until);
    return vals.map(function (v, i) {
      var future = cut && months[i].y * 12 + months[i].m > cut.y * 12 + cut.m;
      return future && v === 0 ? null : r2(v);
    });
  }

  // 圓餅圖：超過 maxSlices 時，前 maxSlices-1 名各一片，其餘合併為灰色片
  function colorIndexFor(i, n, maxSlices) {
    maxSlices = maxSlices || 8;
    if (n <= maxSlices) return i;
    return i < maxSlices - 1 ? i : -1;
  }

  function pieSlices(items, maxSlices) {
    maxSlices = maxSlices || 8;
    var list = items.slice();
    var merged = false;
    if (list.length > maxSlices) {
      var head = list.slice(0, maxSlices - 1);
      var tail = list.slice(maxSlices - 1);
      var tailAmt = 0, tailPct = 0;
      tail.forEach(function (x) { tailAmt += x.amount; tailPct += x.pct; });
      head.push({ category: '其他類別（合併）', amount: r2(tailAmt), pct: tailPct, merged: true, count: tail.length });
      list = head;
      merged = true;
    }
    var total = 0;
    list.forEach(function (x) { total += x.amount; });
    var angle = -Math.PI / 2;
    var slices = list.map(function (x, i) {
      var sweep = total > 0 ? x.amount / total * Math.PI * 2 : 0;
      var s = {
        label: x.category, amount: x.amount, pct: x.pct,
        merged: !!x.merged, count: x.count || 1,
        colorIndex: x.merged ? -1 : i,
        a0: angle, a1: angle + sweep, full: list.length === 1
      };
      angle += sweep;
      return s;
    });
    return { slices: slices, merged: merged };
  }

  function arcPath(cx, cy, r, a0, a1) {
    var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    var large = a1 - a0 > Math.PI ? 1 : 0;
    function f(n) { return Math.round(n * 100) / 100; }
    return 'M' + f(cx) + ' ' + f(cy) + 'L' + f(x0) + ' ' + f(y0) +
      'A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + f(x1) + ' ' + f(y1) + 'Z';
  }

  // 縱軸刻度，一定包含 0
  function niceTicks(min, max, count) {
    count = count || 5;
    if (min > 0) min = 0;
    if (max < 0) max = 0;
    if (max === min) max = min + 1;
    var raw = (max - min) / (count - 1);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    var lo = Math.floor(min / step + 1e-9) * step + 0; // + 0 把 -0 變成 0
    var hi = Math.ceil(max / step - 1e-9) * step + 0;
    var ticks = [];
    for (var v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v / step) * step + 0);
    return { ticks: ticks, min: lo, max: hi, step: step };
  }

  // 軸標籤用的精簡數字：12000 → 1.2萬
  function compact(n) {
    var sign = n < 0 ? '-' : '';
    var a = Math.abs(n);
    function trim(x) { return String(Math.round(x * 10) / 10); }
    if (a >= 1e8) return sign + trim(a / 1e8) + '億';
    if (a >= 1e4) return sign + trim(a / 1e4) + '萬';
    return sign + String(Math.round(a));
  }

  var api = {
    aggregate: aggregate, monthRange: monthRange, monthlySeries: monthlySeries,
    pieSlices: pieSlices, colorIndexFor: colorIndexFor, arcPath: arcPath,
    niceTicks: niceTicks, compact: compact, MAX_MONTHS: MAX_MONTHS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReportCore = api;
})(typeof window !== 'undefined' ? window : this);
