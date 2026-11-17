/* 預算設定頁：年度總預算、每月總預算、各支出類別月預算。運算全在 budget-core.js，這裡只管畫面。 */
var Budget = (function () {
  'use strict';

  function BK() { return window.BK; }
  function $(s) { return document.querySelector(s); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function bar(spent, budget) {
    var p = BudgetCore.progress(spent, budget);
    var fill = BK().h('span', { class: 'bg-fill' + (p.over ? ' over' : '') });
    fill.style.width = p.pct + '%';
    return BK().h('span', { class: 'bg-bar', role: 'img', 'aria-label': '已使用 ' + Math.round(p.pct) + '%' }, fill);
  }

  function statusText(spent, budget) {
    var p = BudgetCore.progress(spent, budget);
    return '已支出 $' + BK().fmt(spent) + ' / $' + BK().fmt(budget) +
      (p.over ? '，超支 $' + BK().fmt(-p.left) : '，剩 $' + BK().fmt(p.left));
  }

  // 金額輸入列：清空＝取消該預算；填入無效數字時退回原值
  function field(label, value, spentAmt, onSet) {
    var h = BK().h;
    var input = h('input', { type: 'text', inputmode: 'decimal', placeholder: '未設定', autocomplete: 'off', 'aria-label': label });
    input.value = value === null || value === undefined ? '' : String(value);
    var info = h('div', { class: 'bg-info' });
    function paintInfo(v) {
      info.textContent = '';
      if (v !== null && v !== undefined) {
        info.appendChild(bar(spentAmt, v));
        info.appendChild(h('span', { class: 'bg-text' + (BudgetCore.progress(spentAmt, v).over ? ' over' : ''), text: statusText(spentAmt, v) }));
      } else {
        info.appendChild(h('span', { class: 'bg-text', text: '已支出 $' + BK().fmt(spentAmt) }));
      }
    }
    paintInfo(value);
    input.addEventListener('change', function () {
      var raw = input.value.trim();
      var n = raw === '' ? null : BudgetCore.amountOf(raw);
      if (raw !== '' && n === null) {
        BK().toast('請輸入大於 0 的金額');
        input.value = value === null || value === undefined ? '' : String(value);
        return;
      }
      value = n;
      input.value = n === null ? '' : String(n);
      paintInfo(n);
      onSet(n);
    });
    return h('div', { class: 'bg-field' },
      h('div', { class: 'bg-head' }, h('span', { class: 'bg-label', text: label }), input), info);
  }

  function render() {
    var h = BK().h;
    var b = BK().budgets();
    var entries = BK().entries;
    var now = new Date();
    var ym = now.getFullYear() + '-' + pad(now.getMonth() + 1);
    var body = $('#bg-body');
    body.textContent = '';

    function set(key, cat) {
      return function (n) {
        if (cat) { if (n === null) delete b.cats[cat]; else b.cats[cat] = n; }
        else b[key] = n;
        BK().saveBudgets();
      };
    }

    body.appendChild(h('p', { class: 'note', text: '預算只計算支出，金額留空代表不設定。進度以今天所在的月份／年度計算。' }));
    body.appendChild(h('h3', { class: 'ce-title', text: '總預算' }));
    body.appendChild(h('div', { class: 'card bg-card' },
      field('年度總預算（' + now.getFullYear() + ' 年）', b.year, BudgetCore.spentYear(entries, now.getFullYear()), set('year')),
      field('每月總預算（' + (now.getMonth() + 1) + ' 月）', b.month, BudgetCore.spent(entries, { ym: ym }), set('month'))));

    body.appendChild(h('h3', { class: 'ce-title', text: '各類別月預算' }));
    var cats = BK().reportCats().expense;
    var card = h('div', { class: 'card bg-card' });
    if (!cats.length) card.appendChild(h('p', { class: 'ce-empty', text: '還沒有任何支出類別。' }));
    cats.forEach(function (c) {
      card.appendChild(field(c[1] + ' ' + c[0], Object.prototype.hasOwnProperty.call(b.cats, c[0]) ? b.cats[c[0]] : null,
        BudgetCore.spent(entries, { ym: ym, category: c[0] }), set(null, c[0])));
    });
    body.appendChild(card);
  }

  function open() {
    BK().openOverlay($('#budget'));
    render();
  }

  function init() {
    $('#bg-close').addEventListener('click', function () { BK().closeOverlay(); });
  }

  return { open: open, init: init };
})();
