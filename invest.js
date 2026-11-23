/* 投資理財頁：定存／債券／股票三個分頁。運算全在 invest-core.js，這裡只管畫面。
 * 目前只有定存（定期儲蓄存款・整存整付・按月複利）；債券、股票先留空。 */
var Invest = (function () {
  'use strict';

  var tab = 'deposit';
  var view = { mode: 'list', id: null }; // mode: list | form（id 為 null 表示新增）

  function BK() { return window.BK; }
  function $(s) { return document.querySelector(s); }
  function today() { return BK().ymd(new Date()); }
  function money(n) { return '$' + BK().fmt(n); }
  function pct(x) { return x === null || x === undefined || !isFinite(x) ? '無法計算' : (Math.round(x * 10000) / 100) + '%'; }
  function find(id) { return BK().invest().deposits.filter(function (d) { return d.id === id; })[0]; }

  var STATUS = { active: '進行中', matured: '已到期・未完結', done: '已完結' };

  function row(k, v, cls) {
    var h = BK().h;
    return h('div', { class: 'iv-row' }, h('span', { class: 'k', text: k }), h('span', { class: 'v' + (cls ? ' ' + cls : ''), text: v }));
  }

  function bar(pctNum) {
    var h = BK().h;
    var fill = h('span', { class: 'bg-fill' });
    fill.style.width = Math.max(0, Math.min(100, pctNum)) + '%';
    return h('span', { class: 'bg-bar', role: 'img', 'aria-label': '已過 ' + Math.round(pctNum) + '%' }, fill);
  }

  /* ---------- 列表 ---------- */
  function summaryCard(deposits, entries) {
    var h = BK().h;
    var s = InvestCore.summary(deposits, entries, today());
    var card = h('div', { class: 'card iv-card' });
    card.appendChild(h('div', { class: 'iv-sum-title', text: '整體（定存）' }));
    card.appendChild(row('進行中', s.activeCount + ' 筆・本金 ' + money(s.activePrincipal)));
    card.appendChild(row('進行中預期利息', money(s.activeExpected)));
    card.appendChild(row('累計已領利息', money(s.paidAll)));
    card.appendChild(h('div', { class: 'iv-sep' }));
    card.appendChild(row('已完結', s.doneCount + ' 筆・本金 ' + money(s.donePrincipal)));
    card.appendChild(row('總報酬率', s.roi === null ? '—' : pct(s.roi), s.roi > 0 ? 'inc' : ''));
    card.appendChild(row('年化報酬率（XIRR）', s.roi === null ? '—' : pct(s.annual), s.annual > 0 ? 'inc' : ''));
    card.appendChild(h('p', { class: 'note', text: '報酬率與年化只計算「已完結」的定存；進行中的不混進去。' }));
    return card;
  }

  function depositCard(d, entries) {
    var h = BK().h;
    var st = InvestCore.depositStats(d, entries, today());
    var card = h('button', { type: 'button', class: 'card iv-dep', 'aria-label': '編輯定存：' + (d.name || d.label) });
    card.appendChild(h('div', { class: 'iv-dep-head' },
      h('span', { class: 'iv-dep-name', text: d.name || d.label }),
      h('span', { class: 'iv-badge ' + st.status, text: STATUS[st.status] })));
    card.appendChild(h('div', { class: 'iv-dep-sub', text: money(d.principal) + '・年利率 ' + d.rate + '%・' + d.months + ' 個月' }));
    card.appendChild(h('div', { class: 'iv-dep-sub', text: d.startDate + ' → ' + st.maturity }));
    if (st.status === 'active') {
      var total = InvestCore.daysBetween(d.startDate, st.maturity);
      var passed = InvestCore.daysBetween(d.startDate, today());
      card.appendChild(bar(total > 0 ? passed / total * 100 : 0));
      card.appendChild(h('div', { class: 'iv-dep-sub', text: '預期利息 ' + money(st.expected) + '・目前約 ' + money(st.accrued) }));
    } else if (st.status === 'matured') {
      card.appendChild(h('div', { class: 'iv-dep-sub', text: '預期利息 ' + money(st.expected) + (st.paid.count ? '・已領 ' + money(st.paid.interest) : '・尚未登記領息') }));
    } else {
      card.appendChild(h('div', { class: 'iv-dep-sub', text: '已領利息 ' + money(st.paid.interest) + '・報酬率 ' + pct(st.roi) + '・年化 ' + pct(st.annual) }));
    }
    card.addEventListener('click', function () { view = { mode: 'form', id: d.id }; render(); });
    return card;
  }

  function renderList(body) {
    var h = BK().h;
    var deposits = BK().invest().deposits, entries = BK().entries;
    body.appendChild(h('p', { class: 'note', text: '定期儲蓄存款・整存整付・按月複利。在流水帳「收入 › 定存利息」選某一筆定存記帳，也等於登記領息。' }));
    var add = h('button', { type: 'button', class: 'btn primary', text: '＋ 新增定存' });
    add.addEventListener('click', function () { view = { mode: 'form', id: null }; render(); });
    body.appendChild(add);
    if (!deposits.length) {
      body.appendChild(h('p', { class: 'ce-empty', text: '還沒有任何定存。' }));
      return;
    }
    body.appendChild(summaryCard(deposits, entries));
    var order = { matured: 0, active: 1, done: 2 };
    var items = deposits.map(function (d) { return { d: d, st: InvestCore.depositStats(d, entries, today()) }; });
    items.sort(function (a, b) {
      if (order[a.st.status] !== order[b.st.status]) return order[a.st.status] - order[b.st.status];
      return a.st.status === 'done' ? (a.st.maturity < b.st.maturity ? 1 : -1) : (a.st.maturity > b.st.maturity ? 1 : -1);
    });
    body.appendChild(h('h3', { class: 'ce-title', text: '定存明細' }));
    items.forEach(function (it) { body.appendChild(depositCard(it.d, entries)); });
  }

  /* ---------- 表單 ---------- */
  function field(label, input, hint) {
    var h = BK().h;
    return h('label', { class: 'iv-field' }, h('span', { class: 'iv-label', text: label }), input, hint ? h('span', { class: 'iv-hint', text: hint }) : null);
  }

  function textInput(value, ph, mode) {
    var el = BK().h('input', { type: 'text', inputmode: mode || 'decimal', placeholder: ph || '', autocomplete: 'off' });
    el.value = value === null || value === undefined ? '' : String(value);
    return el;
  }

  async function dropSub(label) {
    var C = window.Categories;
    C.removeSub(BK().catData(), 'income', InvestCore.CATEGORY, label);
  }

  function renderForm(body) {
    var h = BK().h;
    var data = BK().invest();
    var d = view.id ? find(view.id) : null;
    if (view.id && !d) { view = { mode: 'list', id: null }; render(); return; }
    var entries = BK().entries;

    var back = h('button', { type: 'button', class: 'txt-btn', text: '← 返回列表' });
    back.addEventListener('click', function () { view = { mode: 'list', id: null }; render(); });
    body.appendChild(back);
    body.appendChild(h('h3', { class: 'ce-title', text: d ? '編輯定存' : '新增定存' }));

    var name = textInput(d ? d.name || '' : '', '例如：台銀 1 年期', 'text');
    name.setAttribute('maxlength', String(InvestCore.MAX_LABEL));
    var principal = textInput(d ? d.principal : '', '例如：100000');
    var start = h('input', { type: 'date' });
    start.value = d ? d.startDate : today();
    var months = textInput(d ? d.months : '', '例如：12', 'numeric');
    var rate = textInput(d ? d.rate : '', '例如：1.6');
    var preview = h('div', { class: 'note iv-preview' });

    function paintPreview() {
      var p = InvestCore.amountOf(principal.value.trim()), m = InvestCore.monthsOf(months.value.trim());
      var r = InvestCore.rateOf(rate.value.trim()), s = start.value;
      if (p === null || m === null || r === null || !InvestCore.parseYmd(s)) { preview.textContent = '填好本金、開始日、月數、年利率後，這裡會顯示到期日與預期利息。'; return; }
      var tmp = { principal: p, months: m, rate: r, startDate: s };
      var ex = InvestCore.expectedInterest(tmp);
      preview.textContent = '到期日 ' + InvestCore.maturityDate(s, m) + '・預期利息 ' + money(ex) + '・預期本利和 ' + money(p + ex);
    }
    [principal, months, rate, start].forEach(function (el) { el.addEventListener('input', paintPreview); el.addEventListener('change', paintPreview); });
    paintPreview();

    var done = h('input', { type: 'checkbox' });
    done.checked = !!(d && d.done);

    body.appendChild(h('div', { class: 'card iv-form' },
      field('名稱（選填）', name, '留空時以「金額・開始日」當名稱；在流水帳選類別時會用這個名稱。'),
      field('本金', principal),
      field('開始日', start),
      field('存款期間（月）', months),
      field('年利率（%）', rate, '固定利率；按月複利＝年利率 ÷ 12 逐月滾入本金。'),
      preview));

    if (d) {
      body.appendChild(h('label', { class: 'iv-check' }, done, h('span', { text: '這筆定存已完結（完結後會從流水帳的子類別選單移除，仍保留在報酬率統計）' })));
    }

    var save = h('button', { type: 'button', class: 'btn primary', text: d ? '儲存' : '新增' });
    save.addEventListener('click', async function () {
      var p = InvestCore.amountOf(principal.value.trim());
      var m = InvestCore.monthsOf(months.value.trim());
      var r = InvestCore.rateOf(rate.value.trim());
      if (p === null) { BK().toast('請輸入大於 0 的本金'); return; }
      if (!InvestCore.parseYmd(start.value)) { BK().toast('請選擇開始日'); return; }
      if (m === null) { BK().toast('存款期間請輸入整數月數（1～600）'); return; }
      if (r === null) { BK().toast('年利率請輸入 0～100 之間的數字'); return; }
      var nm = name.value.trim().slice(0, InvestCore.MAX_LABEL);

      if (!d) {
        var label = InvestCore.makeLabel(nm, p, start.value, BK().labelTaken(null));
        var fresh = { id: BK().uid(), label: label, principal: p, startDate: start.value, months: m, rate: r, done: false, createdAt: Date.now() };
        if (nm) fresh.name = nm;
        data.deposits.push(fresh);
        await BK().saveInvest();
        BK().toast('已新增定存「' + label + '」');
      } else {
        d.principal = p; d.startDate = start.value; d.months = m; d.rate = r; d.done = done.checked;
        if (nm !== (d.name || '')) {
          // 名稱有變動 → label 跟著變，流水帳上同名的利息帳目一併改名
          var want = InvestCore.makeLabel(nm, p, start.value, BK().labelTaken(d.id));
          if (nm) d.name = nm; else delete d.name;
          if (want !== d.label) {
            var old = d.label;
            await dropSub(old);
            d.label = want;
            await BK().relabelEntries(old, want);
          }
        }
        await BK().saveInvest();
        BK().toast('已儲存');
      }
      view = { mode: 'list', id: null };
      render();
    });
    body.appendChild(save);

    if (d) {
      renderPayout(body, d, entries);
      var del = h('button', { type: 'button', class: 'btn danger', text: '刪除這筆定存' });
      del.addEventListener('click', function () { deleteDeposit(d); });
      body.appendChild(del);
    }
  }

  function renderPayout(body, d, entries) {
    var h = BK().h;
    var st = InvestCore.depositStats(d, entries, today());
    var card = h('div', { class: 'card iv-form' });
    card.appendChild(h('div', { class: 'iv-sum-title', text: '領息' }));
    card.appendChild(row('預期利息', money(st.expected)));
    card.appendChild(row('已領利息', st.paid.count ? money(st.paid.interest) + '（' + st.paid.count + ' 筆，最近 ' + st.paid.lastDate + '）' : '尚未登記'));
    var date = h('input', { type: 'date' });
    date.value = st.maturity;
    var amount = textInput('', '實際領到的利息');
    var finish = h('input', { type: 'checkbox' });
    finish.checked = !d.done;
    card.appendChild(field('領息日', date));
    card.appendChild(field('利息金額', amount, '登記後會同時在流水帳記一筆收入（定存利息 › ' + d.label + '）。'));
    card.appendChild(h('label', { class: 'iv-check' }, finish, h('span', { text: '同時標記這筆定存已完結' })));
    var go = h('button', { type: 'button', class: 'btn', text: '登記領息' });
    go.addEventListener('click', async function () {
      var n = InvestCore.amountOf(amount.value.trim());
      if (n === null) { BK().toast('請輸入大於 0 的利息金額'); return; }
      if (!InvestCore.parseYmd(date.value)) { BK().toast('請選擇領息日'); return; }
      await BK().addEntry({ date: date.value, amount: n, category: InvestCore.CATEGORY, sub: d.label, note: '定存領息' });
      if (finish.checked && !d.done) d.done = true;
      await BK().saveInvest();
      BK().toast('已登記領息 ' + money(n));
      render();
    });
    card.appendChild(go);
    body.appendChild(card);
  }

  async function deleteDeposit(d) {
    var entries = BK().entries;
    var paid = InvestCore.payoutOf(d, entries);
    var msg = '刪除定存「' + (d.name || d.label) + '」？這筆將不再計入報酬率與 XIRR。';
    if (paid.count) msg += '\n\n流水帳中已記的 ' + paid.count + ' 筆利息（共 ' + money(paid.interest) + '）會保留。';
    if (!confirm(msg)) return;
    var alsoEntries = false;
    if (paid.count) alsoEntries = confirm('要同時刪除這 ' + paid.count + ' 筆利息帳目嗎？\n\n按「確定」＝一併刪除（可在流水帳逐筆復原）\n按「取消」＝保留成一般收入');
    var data = BK().invest();
    var ids = alsoEntries ? InvestCore.payoutEntries(d.label, entries).map(function (e) { return e.id; }) : [];
    data.deposits = data.deposits.filter(function (x) { return x.id !== d.id; });
    await dropSub(d.label);
    await BK().saveInvest();
    if (ids.length) await BK().removeEntries(ids);
    BK().toast('已刪除定存');
    view = { mode: 'list', id: null };
    render();
  }

  /* ---------- 外框 ---------- */
  function render() {
    var h = BK().h;
    var body = $('#iv-body');
    body.textContent = '';
    Array.prototype.forEach.call(document.querySelectorAll('#iv-tabs button'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
    });
    if (tab === 'deposit') {
      if (view.mode === 'form') renderForm(body); else renderList(body);
    } else {
      body.appendChild(h('p', { class: 'ce-empty', text: (tab === 'bond' ? '債券' : '股票') + '區規劃中。' }));
    }
  }

  function open() {
    view = { mode: 'list', id: null };
    BK().openOverlay($('#invest'));
    render();
  }

  function init() {
    $('#iv-close').addEventListener('click', function () { BK().closeOverlay(); });
    $('#iv-tabs').addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b || b.dataset.tab === tab) return;
      tab = b.dataset.tab;
      view = { mode: 'list', id: null };
      render();
    });
  }

  return { open: open, init: init };
})();
