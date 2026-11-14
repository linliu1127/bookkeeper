/* 財務報表頁：支出 / 收入圓餅圖 + 趨勢折線圖。圖表皆為手寫 inline SVG。 */
var Report = (function () {
  'use strict';

  var Core = window.ReportCore;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var MAX_LINES = 8;
  var tab = 'expense'; // expense | income | trend
  var now = new Date();
  var pieScope = { year: now.getFullYear(), month: now.getMonth() + 1 };
  var trend = { range: String(now.getFullYear()), from: '', to: '', selected: ['balance'], slot: { balance: 0 } };
  var resizeTimer = null;

  function BK() { return window.BK; }
  function $(s) { return document.querySelector(s); }
  function fmt(n) { return BK().fmt(n); }
  function money(n) { return (n < 0 ? '-' : '') + '$' + fmt(Math.abs(n)); }
  function h() { return BK().h.apply(null, arguments); }

  function svg(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    for (var i = 2; i < arguments.length; i++) if (arguments[i]) el.appendChild(arguments[i]);
    return el;
  }

  function colorVar(i) { return i < 0 ? 'var(--c-other)' : 'var(--c' + (i + 1) + ')'; }

  function yearsInData() {
    var cur = now.getFullYear();
    var min = cur, max = cur;
    BK().entries.forEach(function (e) {
      var y = Number(e.date.slice(0, 4));
      if (y < min) min = y;
      if (y > max) max = y;
    });
    var out = [];
    for (var y = max; y >= min; y--) out.push(y);
    return out;
  }

  function option(value, text) { return h('option', { value: String(value), text: text }); }

  /* ---------- tooltip ---------- */
  function makeTip(wrap) {
    var tip = h('div', { class: 'tip', hidden: '' });
    tip.hidden = true;
    wrap.appendChild(tip);
    return tip;
  }

  function placeTip(tip, wrap, x, y) {
    tip.hidden = false;
    var w = tip.offsetWidth, ww = wrap.clientWidth;
    var left = x + 12;
    if (left + w > ww - 4) left = x - 12 - w;
    if (left < 4) left = 4;
    tip.style.left = left + 'px';
    tip.style.top = Math.max(0, y) + 'px';
  }

  /* ---------- 支出 / 收入 ---------- */
  function buildPie(host, type) {
    host.textContent = '';
    var years = yearsInData();
    if (pieScope.year && years.indexOf(pieScope.year) < 0) years.push(pieScope.year);

    var ySel = h('select', { 'aria-label': '年份' });
    ySel.appendChild(option(0, '所有資料'));
    years.forEach(function (y) { ySel.appendChild(option(y, y + ' 年')); });
    ySel.value = String(pieScope.year);

    var mSel = h('select', { 'aria-label': '月份（或整年）' });
    mSel.appendChild(option(0, '整年'));
    for (var m = 1; m <= 12; m++) mSel.appendChild(option(m, m + ' 月'));
    mSel.value = String(pieScope.month);
    mSel.disabled = !pieScope.year;

    var content = h('div', { class: 'r-content' });
    ySel.addEventListener('change', function () {
      pieScope.year = Number(ySel.value);
      mSel.disabled = !pieScope.year;
      drawPie(content, type);
    });
    mSel.addEventListener('change', function () {
      pieScope.month = Number(mSel.value);
      drawPie(content, type);
    });

    host.appendChild(h('div', { class: 'r-filters' }, ySel, mSel));
    host.appendChild(content);
    drawPie(content, type);
  }

  function drawPie(content, type) {
    content.textContent = '';
    var label = type === 'expense' ? '支出' : '收入';
    var agg = Core.aggregate(BK().entries, type, pieScope);
    if (!agg.total) {
      content.appendChild(h('div', { class: 'empty' },
        h('b', { text: '這個期間沒有' + label }),
        h('span', { text: '可以切換上方的年份或月份' })));
      return;
    }

    var pie = Core.pieSlices(agg.items, 8);
    var SIZE = 240, C = SIZE / 2, R = 108;
    var wrap = h('div', { class: 'chart-wrap pie-wrap' });
    var tip = makeTip(wrap);
    var selected = -1;
    var nodes = [];

    var root = svg('svg', { viewBox: '0 0 ' + SIZE + ' ' + SIZE, class: 'pie', role: 'img',
      'aria-label': label + '佔比圓餅圖，詳細數字見下方表格' });

    function pick(i, ev) {
      selected = selected === i ? -1 : i;
      nodes.forEach(function (n, j) {
        var s = pie.slices[j];
        var mid = (s.a0 + s.a1) / 2;
        var on = j === selected && !s.full;
        n.setAttribute('transform', on ? 'translate(' + (Math.cos(mid) * 5).toFixed(2) + ' ' + (Math.sin(mid) * 5).toFixed(2) + ')' : '');
      });
      if (selected < 0) { tip.hidden = true; return; }
      var s2 = pie.slices[i];
      tip.textContent = '';
      tip.appendChild(h('div', { class: 'tip-title', text: s2.label + (s2.merged ? '（' + s2.count + ' 類）' : '') }));
      tip.appendChild(h('div', { class: 'tip-val', text: money(s2.amount) }));
      tip.appendChild(h('div', { class: 'tip-sub', text: s2.pct.toFixed(1) + '%' }));
      var box = wrap.getBoundingClientRect();
      placeTip(tip, wrap, ev.clientX - box.left, ev.clientY - box.top - 70);
    }

    pie.slices.forEach(function (s, i) {
      var node;
      if (s.full) {
        node = svg('circle', { cx: C, cy: C, r: R });
      } else {
        node = svg('path', { d: Core.arcPath(C, C, R, s.a0, s.a1) });
      }
      node.style.fill = colorVar(s.colorIndex);
      node.style.stroke = 'var(--card)';
      node.style.strokeWidth = '2';
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', s.label + ' ' + s.pct.toFixed(1) + '%，' + money(s.amount));
      node.addEventListener('click', function (ev) { ev.stopPropagation(); pick(i, ev); });
      node.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          var r = node.getBoundingClientRect();
          pick(i, { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
        }
      });
      nodes.push(node);
      root.appendChild(node);
    });
    wrap.appendChild(root);
    wrap.addEventListener('click', function () { if (selected >= 0) pick(selected, { clientX: 0, clientY: 0 }); });
    content.appendChild(wrap);

    // 文字版：色塊、類別、佔比、金額（也是圓餅圖的資料表）
    var table = h('table', { class: 'rtable' });
    table.appendChild(h('caption', { class: 'sr', text: label + '各類別佔比與金額' }));
    table.appendChild(h('thead', null, h('tr', null,
      h('th', { scope: 'col', text: '類別' }),
      h('th', { scope: 'col', class: 'num', text: '佔比' }),
      h('th', { scope: 'col', class: 'num', text: '金額' }))));
    var body = h('tbody');
    agg.items.forEach(function (it, i) {
      var sw = h('span', { class: 'swatch' });
      sw.style.background = colorVar(Core.colorIndexFor(i, agg.items.length, 8));
      body.appendChild(h('tr', null,
        h('td', null, h('div', { class: 'rcell' }, sw, h('span', { text: BK().iconOf(type, it.category) + ' ' + it.category }))),
        h('td', { class: 'num', text: it.pct.toFixed(1) + '%' }),
        h('td', { class: 'num', text: '$' + fmt(it.amount) })));
    });
    table.appendChild(body);
    table.appendChild(h('tfoot', null, h('tr', null,
      h('th', { scope: 'row', text: '總計' }),
      h('td', { class: 'num', text: '100%' }),
      h('td', { class: 'num', text: '$' + fmt(agg.total) }))));
    content.appendChild(h('div', { class: 'card' }, table));
    if (pie.merged) {
      content.appendChild(h('p', { class: 'note', text: '灰色色塊的類別在圓餅圖中合併為「其他類別（合併）」。' }));
    }
  }

  /* ---------- 趨勢 ---------- */
  function seriesDefs() {
    var cats = BK().reportCats();
    var defs = [
      { id: 'balance', label: '結餘', group: '綜合' },
      { id: 'exp:*', label: '總支出', group: '綜合' },
      { id: 'inc:*', label: '總收入', group: '綜合' }
    ];
    cats.expense.forEach(function (c) { defs.push({ id: 'exp:' + c[0], label: c[0] + '（支出）', short: c[1] + ' ' + c[0], group: '支出類別' }); });
    cats.income.forEach(function (c) { defs.push({ id: 'inc:' + c[0], label: c[0] + '（收入）', short: c[1] + ' ' + c[0], group: '收入類別' }); });
    return defs;
  }

  function dataBounds() {
    var min = '', max = '';
    BK().entries.forEach(function (e) {
      var ym = e.date.slice(0, 7);
      if (!min || ym < min) min = ym;
      if (!max || ym > max) max = ym;
    });
    var cur = now.getFullYear() + '-' + (now.getMonth() < 9 ? '0' : '') + (now.getMonth() + 1);
    return { from: min || cur, to: max || cur };
  }

  function nowYM() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1);
  }

  function valText(v) { return v === null ? '—' : money(v); }

  function currentMonths() {
    if (trend.range === 'custom') return Core.monthRange({ from: trend.from, to: trend.to });
    return Core.monthRange(Number(trend.range));
  }

  function nextFreeSlot() {
    var used = {};
    trend.selected.forEach(function (id) { used[trend.slot[id]] = true; });
    for (var i = 0; i < MAX_LINES; i++) if (!used[i]) return i;
    return -1;
  }

  function buildTrend(host) {
    host.textContent = '';
    var defs = seriesDefs();
    var byId = {};
    defs.forEach(function (d) { byId[d.id] = d; });

    var years = yearsInData();
    var rSel = h('select', { 'aria-label': '期間' });
    years.forEach(function (y) { rSel.appendChild(option(y, y + ' 年')); });
    rSel.appendChild(option('custom', '自訂…'));
    if (trend.range !== 'custom' && years.indexOf(Number(trend.range)) < 0) trend.range = String(years[0]);
    rSel.value = trend.range;

    var bounds = dataBounds();
    if (!trend.from) trend.from = bounds.from;
    if (!trend.to) trend.to = bounds.to;
    var fromIn = h('input', { type: 'month', 'aria-label': '起始月份', value: trend.from });
    var toIn = h('input', { type: 'month', 'aria-label': '結束月份', value: trend.to });
    var custom = h('div', { class: 'r-filters custom-range' }, fromIn, h('span', { text: '至' }), toIn);
    custom.hidden = trend.range !== 'custom';

    var chartHost = h('div', { class: 'r-content' });

    // 項目多選
    var summary = h('summary');
    var pick = h('details', { class: 'pick' }, summary);
    var boxes = {};
    ['綜合', '支出類別', '收入類別'].forEach(function (g) {
      var grid = h('div', { class: 'pick-grid' });
      defs.filter(function (d) { return d.group === g; }).forEach(function (d) {
        var cb = h('input', { type: 'checkbox' });
        cb.checked = trend.selected.indexOf(d.id) >= 0;
        boxes[d.id] = cb;
        cb.addEventListener('change', function () {
          if (cb.checked) {
            if (trend.selected.length >= MAX_LINES) {
              cb.checked = false;
              BK().toast('最多同時顯示 ' + MAX_LINES + ' 條');
              return;
            }
            trend.slot[d.id] = nextFreeSlot();
            trend.selected.push(d.id);
          } else {
            trend.selected.splice(trend.selected.indexOf(d.id), 1);
            delete trend.slot[d.id];
          }
          paintSummary();
          drawTrend(chartHost, byId);
        });
        grid.appendChild(h('label', { class: 'chk' }, cb, h('span', { text: d.short || d.label })));
      });
      pick.appendChild(h('div', { class: 'pick-group', text: g }));
      pick.appendChild(grid);
    });
    function paintSummary() { summary.textContent = '選擇項目（已選 ' + trend.selected.length + '）'; }
    paintSummary();

    rSel.addEventListener('change', function () {
      trend.range = rSel.value;
      custom.hidden = trend.range !== 'custom';
      drawTrend(chartHost, byId);
    });
    fromIn.addEventListener('change', function () { trend.from = fromIn.value; drawTrend(chartHost, byId); });
    toIn.addEventListener('change', function () { trend.to = toIn.value; drawTrend(chartHost, byId); });

    host.appendChild(h('div', { class: 'r-filters' }, rSel));
    host.appendChild(custom);
    host.appendChild(pick);
    host.appendChild(chartHost);
    drawTrend(chartHost, byId);
  }

  function drawTrend(host, byId) {
    host.textContent = '';
    if (!trend.selected.length) {
      host.appendChild(h('div', { class: 'empty' }, h('b', { text: '請選擇至少一個項目' })));
      return;
    }
    var months = currentMonths();
    if (!months.length) {
      host.appendChild(h('div', { class: 'empty' }, h('b', { text: '請選擇有效的起訖月份' })));
      return;
    }

    var lines = trend.selected.map(function (id) {
      return { id: id, label: byId[id].label, slot: trend.slot[id], vals: Core.monthlySeries(BK().entries, months, id, nowYM()) };
    });

    var legend = null;
    if (lines.length >= 2) {
      legend = h('ul', { class: 'legend' });
      lines.forEach(function (ln) {
        var key = h('span', { class: 'lkey' });
        key.style.background = colorVar(ln.slot);
        legend.appendChild(h('li', null, key, h('span', { text: ln.label })));
      });
    } else {
      host.appendChild(h('div', { class: 'chart-title', text: lines[0].label + ' 趨勢' }));
    }
    if (legend) host.appendChild(legend);

    var wrap = h('div', { class: 'chart-wrap line-wrap' });
    host.appendChild(wrap);
    var W = Math.max(280, wrap.clientWidth || host.clientWidth || 340);
    drawLines(wrap, W, months, lines);

    // 文字版
    var tbl = h('table', { class: 'rtable data' });
    var hr = h('tr', null, h('th', { scope: 'col', text: '月份' }));
    lines.forEach(function (ln) { hr.appendChild(h('th', { scope: 'col', class: 'num', text: ln.label })); });
    tbl.appendChild(h('thead', null, hr));
    var tb = h('tbody');
    months.forEach(function (mo, i) {
      var tr = h('tr', null, h('th', { scope: 'row', text: mo.y + '-' + (mo.m < 10 ? '0' : '') + mo.m }));
      lines.forEach(function (ln) { tr.appendChild(h('td', { class: 'num', text: valText(ln.vals[i]) })); });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    host.appendChild(h('details', { class: 'pick data-view' },
      h('summary', { text: '查看數據（表格）' }),
      h('div', { class: 'tscroll' }, tbl)));
  }

  function drawLines(wrap, W, months, lines) {
    var H = 260;
    var L = 48, Rm = 14, T = 12, B = 34;
    var pw = W - L - Rm, ph = H - T - B;
    var n = months.length;
    var min = 0, max = 0;
    lines.forEach(function (ln) { ln.vals.forEach(function (v) { if (v === null) return; if (v < min) min = v; if (v > max) max = v; }); });
    var tk = Core.niceTicks(min, max, 5);
    function X(i) { return L + (n === 1 ? pw / 2 : i * pw / (n - 1)); }
    function Y(v) { return T + ph - (v - tk.min) / (tk.max - tk.min) * ph; }

    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, class: 'line-chart', role: 'img',
      'aria-label': '月別趨勢折線圖，數值見下方「查看數據」表格' });

    // 格線與縱軸刻度
    tk.ticks.forEach(function (v) {
      var y = Y(v);
      root.appendChild(svg('line', { x1: L, x2: W - Rm, y1: y, y2: y, class: v === 0 ? 'axis' : 'grid' }));
      var t = svg('text', { x: L - 6, y: y + 4, 'text-anchor': 'end', class: 'tick' });
      t.textContent = Core.compact(v);
      root.appendChild(t);
    });

    // 橫軸刻度（月份稀疏化；1 月或起點標註年份）
    var pitch = n > 1 ? pw / (n - 1) : pw;
    var every = Math.max(1, Math.ceil(30 / pitch));
    months.forEach(function (mo, i) {
      if (i % every !== 0) return;
      var t = svg('text', { x: X(i), y: H - B + 16, 'text-anchor': 'middle', class: 'tick' });
      t.textContent = mo.m + '月';
      root.appendChild(t);
      if (i === 0 || mo.m === 1) {
        var yr = svg('text', { x: X(i), y: H - B + 29, 'text-anchor': 'middle', class: 'tick year' });
        yr.textContent = String(mo.y);
        root.appendChild(yr);
      }
    });

    var r = n > 24 ? 2.5 : 4;
    lines.forEach(function (ln) {
      // 遇到 null（尚未到來的月份）就斷線，不補 0
      var d = '';
      var pen = false;
      ln.vals.forEach(function (v, i) {
        if (v === null) { pen = false; return; }
        d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
        pen = true;
      });
      var path = svg('path', { d: d, class: 'ln', fill: 'none' });
      path.style.stroke = colorVar(ln.slot);
      root.appendChild(path);
      ln.vals.forEach(function (v, i) {
        if (v === null) return;
        var c = svg('circle', { cx: X(i), cy: Y(v), r: r, class: 'pt' });
        c.style.fill = colorVar(ln.slot);
        root.appendChild(c);
      });
    });

    // ≤4 條時於線尾直接標示名稱（文字用內文色，色線在圖例）
    if (lines.length <= 4) {
      var ends = [];
      lines.forEach(function (ln) {
        var last = -1;
        ln.vals.forEach(function (v, i) { if (v !== null) last = i; });
        if (last >= 0) ends.push({ ln: ln, x: X(last), y: Y(ln.vals[last]) - 9 });
      });
      ends.sort(function (a, b) { return a.y - b.y; });
      for (var k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;
      ends.forEach(function (e) {
        // 標籤右緣對齊線尾；夾在繪圖區內，不蓋住橫軸刻度
        var t = svg('text', { x: Math.min(W - Rm, e.x + 4), y: Math.min(T + ph - 5, Math.max(T + 8, e.y)), 'text-anchor': 'end', class: 'dlabel' });
        t.textContent = e.ln.label;
        root.appendChild(t);
      });
    }

    // 準線與高亮點
    var cross = svg('line', { y1: T, y2: T + ph, class: 'cross' });
    cross.style.display = 'none';
    root.appendChild(cross);
    var halos = lines.map(function (ln) {
      var c = svg('circle', { r: r + 2.5, class: 'halo' });
      c.style.fill = colorVar(ln.slot);
      c.style.display = 'none';
      root.appendChild(c);
      return c;
    });

    var hit = svg('rect', { x: L - 10, y: T, width: pw + 20, height: ph, fill: 'transparent', class: 'hit' });
    root.appendChild(hit);
    wrap.appendChild(root);
    var tip = makeTip(wrap);

    function show(ev) {
      var box = root.getBoundingClientRect();
      var px = (ev.clientX - box.left) * (W / box.width);
      var i = n === 1 ? 0 : Math.round((px - L) / pitch);
      i = Math.max(0, Math.min(n - 1, i));
      var x = X(i);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.style.display = '';
      lines.forEach(function (ln, k) {
        if (ln.vals[i] === null) { halos[k].style.display = 'none'; return; }
        halos[k].setAttribute('cx', x); halos[k].setAttribute('cy', Y(ln.vals[i])); halos[k].style.display = '';
      });
      tip.textContent = '';
      tip.appendChild(h('div', { class: 'tip-title', text: months[i].y + ' 年 ' + months[i].m + ' 月' }));
      lines.forEach(function (ln) {
        var key = h('span', { class: 'lkey' });
        key.style.background = colorVar(ln.slot);
        tip.appendChild(h('div', { class: 'tip-row' }, key,
          h('span', { class: 'tip-name', text: ln.label }),
          h('b', { class: 'tip-val', text: valText(ln.vals[i]) })));
      });
      placeTip(tip, wrap, x * (box.width / W), T + 4);
    }

    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointermove', function (ev) { if (ev.pointerType === 'mouse' || ev.buttons) show(ev); });
    hit.addEventListener('pointerleave', function (ev) {
      if (ev.pointerType !== 'mouse') return;
      cross.style.display = 'none';
      halos.forEach(function (c) { c.style.display = 'none'; });
      tip.hidden = true;
    });
  }

  /* ---------- 頁面 ---------- */
  function render() {
    var host = $('#r-body');
    Array.prototype.forEach.call(document.querySelectorAll('#r-tabs button'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
    });
    if (tab === 'trend') buildTrend(host); else buildPie(host, tab);
  }

  function open() {
    BK().openOverlay($('#report')); // 先顯示頁面，圖表才量得到寬度
    render();
  }

  function init() {
    $('#r-tabs').addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b || b.dataset.tab === tab) return;
      tab = b.dataset.tab;
      render();
    });
    $('#r-close').addEventListener('click', function () { BK().closeOverlay(); });
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (tab === 'trend' && !$('#report').hidden) {
          var host = $('#r-body').querySelector('.r-content');
          if (host) {
            var defs = {};
            seriesDefs().forEach(function (d) { defs[d.id] = d; });
            drawTrend(host, defs);
          }
        }
      }, 150);
    });
  }

  return { open: open, init: init };
})();
