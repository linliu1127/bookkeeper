(function () {
  'use strict';

  // CATS 是 catData 的「[名稱, 圖示]」視圖，供選單與 iconOf 使用；由 syncCats() 就地重建
  var CATS = { expense: [], income: [] };
  var CATS_LS = 'bookkeeper.categories'; // localStorage 保險副本，IndexedDB 失效時仍有類別清單
  var catData = Categories.defaults();
  function syncCats() {
    ['expense', 'income'].forEach(function (t) {
      CATS[t].length = 0;
      catData[t].forEach(function (c) { CATS[t].push([c.name, c.icon]); });
    });
  }
  // 只寫入，不算「未備份變更」（還原備份時用：資料本來就來自備份檔）
  async function persistCats() {
    syncCats();
    try { localStorage.setItem(CATS_LS, JSON.stringify(catData)); } catch (e) { /* 保險用，失敗就算了 */ }
    await Store.kvSet('categories', catData);
  }
  async function saveCats() {
    Backup.bump();
    Backup.schedule();
    await persistCats();
  }
  // 預算：{year, month, cats}，存法同類別（IndexedDB + localStorage 保險副本）
  var BUDGETS_LS = 'bookkeeper.budgets';
  var budgets = BudgetCore.empty();
  async function persistBudgets() {
    try { localStorage.setItem(BUDGETS_LS, JSON.stringify(budgets)); } catch (e) { /* 保險用，失敗就算了 */ }
    await Store.kvSet('budgets', budgets);
  }
  async function saveBudgets() {
    Backup.bump();
    Backup.schedule();
    await persistBudgets();
    render();
  }
  // 投資理財（目前只有定存）：{version, deposits[]}，存法同預算。
  // 與流水帳的連動見 invest-core.js：已領利息 = 收入›定存利息›label 的帳目加總（推導，不另存）
  var INVEST_LS = 'bookkeeper.invest';
  var invest = InvestCore.empty();
  async function persistInvest() {
    try { localStorage.setItem(INVEST_LS, JSON.stringify(invest)); } catch (e) { /* 保險用，失敗就算了 */ }
    await Store.kvSet('invest', invest);
  }
  // 讓「收入›定存利息」的子類別 = 手動子類別 ∪ 進行中定存的 label − 已完結定存的 label。回傳類別清單是否有變
  function syncDepositSubs() {
    var active = invest.deposits.filter(function (d) { return !d.done; }).map(function (d) { return d.label; });
    var all = invest.deposits.map(function (d) { return d.label; });
    var cat = catData.income.filter(function (c) { return c.name === InvestCore.CATEGORY; })[0];
    if (!cat) {
      if (!active.length) return false;
      cat = { name: InvestCore.CATEGORY, icon: '🏦', subs: [] };
      catData.income.push(cat);
    }
    var next = cat.subs.filter(function (s) { return all.indexOf(s) < 0 || active.indexOf(s) >= 0; });
    active.forEach(function (s) { if (next.indexOf(s) < 0) next.push(s); });
    var changed = next.length !== cat.subs.length || next.some(function (s, i) { return s !== cat.subs[i]; });
    cat.subs = next;
    return changed;
  }
  async function saveInvest() {
    Backup.bump();
    Backup.schedule();
    syncDepositSubs();
    await persistCats(); // 投資區也會直接動類別清單（移除舊 label），一律存
    await persistInvest();
  }
  // 新定存 label 要避開：所有定存、流水帳「定存利息」底下已用過的 sub、類別清單裡手動建的子類別
  function labelTaken(exceptId) {
    var taken = InvestCore.takenLabels(invest, entries, exceptId);
    var cat = catData.income.filter(function (c) { return c.name === InvestCore.CATEGORY; })[0];
    var own = invest.deposits.filter(function (d) { return d.id === exceptId; }).map(function (d) { return d.label; });
    if (cat) cat.subs.forEach(function (s) {
      var isDeposit = invest.deposits.some(function (d) { return d.label === s; });
      if (!isDeposit && own.indexOf(s) < 0 && taken.indexOf(s) < 0) taken.push(s);
    });
    return taken;
  }
  // 類別改名對照：舊帳目只在第一次啟動時轉成新名稱（見 start()）
  var RENAMES = { '投資': '股票' };
  function migrateCats(list) {
    var n = 0;
    list.forEach(function (e) {
      if (RENAMES[e.category]) { e.category = RENAMES[e.category]; n++; }
    });
    return n;
  }
  var WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  var entries = Store.entries;
  var view = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 }; // month 0 = 整年
  var form = null; // { id, type, category, expr }
  var openEl = null;
  var bannerDismissed = false;

  var $ = function (s) { return document.querySelector(s); };

  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'class') el.className = props[k];
      else if (k === 'text') el.textContent = props[k];
      else el.setAttribute(k, props[k]);
    });
    for (var i = 2; i < arguments.length; i++) if (arguments[i]) el.appendChild(arguments[i]);
    return el;
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fmt(n) { return (Math.round(n * 100) / 100).toLocaleString('zh-TW', { maximumFractionDigits: 2 }); }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function iconOf(type, cat) {
    var f = (CATS[type] || []).filter(function (c) { return c[0] === cat; })[0];
    return f ? f[1] : '📝';
  }

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* ---------- 復原 / 重做（記錄操作，僅限本次開啟期間） ---------- */
  var MAX_HISTORY = 100;
  var undoStack = [];
  var redoStack = [];

  function copy(e) { return Object.assign({}, e); }
  function indexOfId(id) { return entries.findIndex(function (x) { return x.id === id; }); }
  function removeById(id) { var i = indexOfId(id); if (i >= 0) entries.splice(i, 1); }
  function putEntry(e) {
    var i = indexOfId(e.id);
    if (i >= 0) entries[i] = copy(e); else entries.push(copy(e));
  }

  function describe(op) {
    var e = op.after || op.entry;
    var name = { add: '新增', edit: '編輯', del: '刪除' }[op.kind];
    return name + '「' + e.category + (e.sub ? ' › ' + e.sub : '') + ' $' + fmt(e.amount) + '」';
  }

  function paintHistory() {
    $('#btn-undo').disabled = !undoStack.length;
    $('#btn-redo').disabled = !redoStack.length;
  }

  function record(op) {
    undoStack.push(op);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    paintHistory();
  }

  async function afterChange() {
    bannerDismissed = false;
    Backup.bump();
    render();
    paintHistory();
    await Store.save();
    Backup.schedule();
  }

  async function undo() {
    var op = undoStack.pop();
    if (!op) return;
    if (op.kind === 'add') removeById(op.entry.id);
    else if (op.kind === 'del') putEntry(op.entry);
    else putEntry(op.before);
    redoStack.push(op);
    focusDate((op.before || op.entry).date);
    toast('已復原：' + describe(op));
    await afterChange();
  }

  async function redo() {
    var op = redoStack.pop();
    if (!op) return;
    if (op.kind === 'add') putEntry(op.entry);
    else if (op.kind === 'del') removeById(op.entry.id);
    else putEntry(op.after);
    undoStack.push(op);
    focusDate((op.after || op.entry).date);
    toast('已重做：' + describe(op));
    await afterChange();
  }

  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);

  /* ---------- 全螢幕頁面（支援 Android 返回鍵） ---------- */
  function openOverlay(el) {
    el.hidden = false;
    openEl = el;
    history.pushState({ overlay: true }, '');
  }
  function closeOverlay() {
    if (openEl) history.back();
  }
  window.addEventListener('popstate', function () {
    if (openEl) { openEl.hidden = true; openEl = null; }
  });

  /* ---------- 期間選擇（某月 / 整年） ---------- */
  function prefix() { return view.year + '-' + (view.month ? pad(view.month) + '-' : ''); }

  function focusDate(d) {
    var y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
    if (view.year !== y || (view.month && view.month !== m)) {
      view.year = y;
      if (view.month) view.month = m;
    }
  }

  function buildPeriod() {
    var thisYear = new Date().getFullYear();
    var min = thisYear, max = thisYear;
    entries.forEach(function (e) {
      var y = Number(e.date.slice(0, 4));
      if (y < min) min = y;
      if (y > max) max = y;
    });
    min = Math.min(min, view.year);
    max = Math.max(max, view.year);
    var ys = $('#sel-year');
    ys.textContent = '';
    for (var y = max; y >= min; y--) ys.appendChild(h('option', { value: String(y), text: y + ' 年' }));
    ys.value = String(view.year);

    var ms = $('#sel-month');
    if (!ms.options.length) {
      ms.appendChild(h('option', { value: '0', text: '整年' }));
      for (var m = 1; m <= 12; m++) ms.appendChild(h('option', { value: String(m), text: m + ' 月' }));
    }
    ms.value = String(view.month);
  }

  $('#sel-year').addEventListener('change', function () { view.year = Number(this.value); render(); });
  $('#sel-month').addEventListener('change', function () { view.month = Number(this.value); render(); });

  function step(dir) {
    if (!view.month) { view.year += dir; }
    else {
      view.month += dir;
      if (view.month < 1) { view.month = 12; view.year--; }
      if (view.month > 12) { view.month = 1; view.year++; }
    }
    render();
  }
  $('#p-prev').addEventListener('click', function () { step(-1); });
  $('#p-next').addEventListener('click', function () { step(1); });

  /* ---------- 預算摘要列（列表頂端，點一下進預算頁） ---------- */
  function budgetLine(label, spentAmt, budget) {
    var p = BudgetCore.progress(spentAmt, budget);
    var fill = h('span', { class: 'bg-fill' + (p.over ? ' over' : '') });
    fill.style.width = p.pct + '%';
    return h('span', { class: 'bb-line' },
      h('span', { class: 'bb-text' },
        h('span', { text: label + ' $' + fmt(spentAmt) + ' / $' + fmt(budget) }),
        h('span', { class: p.over ? 'over' : '', text: p.over ? '超支 $' + fmt(-p.left) : '剩 $' + fmt(p.left) })),
      h('span', { class: 'bg-bar' }, fill));
  }

  function paintBudgetBar() {
    var bar = $('#budget-bar');
    bar.textContent = '';
    var spentAmt;
    if (view.month && budgets.month !== null) {
      spentAmt = BudgetCore.spent(entries, { ym: view.year + '-' + pad(view.month) });
      bar.appendChild(budgetLine(view.month + ' 月支出', spentAmt, budgets.month));
    } else if (!view.month && budgets.year !== null) {
      bar.appendChild(budgetLine(view.year + ' 年支出', BudgetCore.spentYear(entries, view.year), budgets.year));
    } else if (view.month && budgets.year !== null) {
      bar.appendChild(budgetLine(view.year + ' 年支出', BudgetCore.spentYear(entries, view.year), budgets.year));
    } else {
      bar.appendChild(h('span', { class: 'bb-empty', text: BudgetCore.isEmpty(budgets) ? '💰 設定預算 ›' : '💰 預算 ›' }));
    }
  }
  $('#budget-bar').addEventListener('click', function () { if (window.Budget) Budget.open(); });

  /* ---------- 列表 ---------- */
  function render() {
    var now = new Date();
    var pre = prefix();
    var visible = entries.filter(function (e) { return e.date.indexOf(pre) === 0; });
    var inc = 0, exp = 0;
    visible.forEach(function (e) { if (e.type === 'income') inc += e.amount; else exp += e.amount; });
    buildPeriod();
    $('#sum-inc').textContent = '$' + fmt(inc);
    $('#sum-exp').textContent = '$' + fmt(exp);
    var bal = inc - exp;
    var balEl = $('#sum-bal');
    balEl.textContent = (bal < 0 ? '-' : '') + '$' + fmt(Math.abs(bal));
    balEl.className = bal < 0 ? 'exp' : 'inc';
    paintBudgetBar();

    var list = $('#list');
    list.textContent = '';
    if (!entries.length) {
      list.appendChild(h('div', { class: 'empty' },
        h('b', { text: '還沒有任何帳' }),
        h('span', { text: '點下方「＋」記下第一筆' })));
      updateBanner();
      return;
    }

    if (!visible.length) {
      list.appendChild(h('div', { class: 'empty' },
        h('b', { text: view.month ? '這個月沒有帳目' : '這一年沒有帳目' }),
        h('span', { text: '可以切換上方的月份或年份' })));
      updateBanner();
      return;
    }

    var sorted = visible.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    var today = ymd(now);
    var groups = [];
    sorted.forEach(function (e) {
      var g = groups[groups.length - 1];
      if (!g || g.date !== e.date) { g = { date: e.date, items: [], inc: 0, exp: 0 }; groups.push(g); }
      g.items.push(e);
      if (e.type === 'income') g.inc += e.amount; else g.exp += e.amount;
    });

    groups.forEach(function (g) {
      var p = g.date.split('-').map(Number);
      var dow = WEEK[new Date(p[0], p[1] - 1, p[2]).getDay()];
      var title = p[1] + '/' + p[2] + ' 週' + dow + (g.date === today ? ' · 今天' : '');
      var sums = h('div', { class: 'sums' });
      if (g.inc) sums.appendChild(h('span', { class: 'inc', text: '收 +' + fmt(g.inc) }));
      if (g.exp) sums.appendChild(h('span', { class: 'exp', text: '支 -' + fmt(g.exp) }));
      var card = h('div', { class: 'day-card' });
      g.items.forEach(function (e) {
        var mid = h('span', { class: 'mid' }, h('span', { class: 'cat', text: e.sub ? e.category + ' › ' + e.sub : e.category }));
        if (e.note) mid.appendChild(h('span', { class: 'memo', text: e.note }));
        var btn = h('button', { class: 'item', type: 'button' },
          h('span', { class: 'ico', text: iconOf(e.type, e.category) }),
          mid,
          h('span', { class: 'amt ' + (e.type === 'income' ? 'inc' : 'exp'), text: (e.type === 'income' ? '+' : '-') + fmt(e.amount) }));
        btn.addEventListener('click', function () { openForm(e); });
        card.appendChild(btn);
      });
      list.appendChild(h('section', { class: 'day' },
        h('div', { class: 'day-head' }, h('span', { text: title }), sums), card));
    });
    updateBanner();
  }

  /* ---------- 提示橫幅 ---------- */
  var bannerAction = null;
  function updateBanner() {
    var b = $('#banner');
    var st = Backup.status();
    var msg = '', label = '', act = null;
    if (!entries.length) {
      msg = '換手機或資料不見了？可以從備份檔還原。';
      label = '還原';
      act = doRestore;
    } else if (!st.linked && st.pending > 0) {
      msg = '有 ' + st.pending + ' 筆新增或變更還沒備份。';
      label = '備份';
      act = function () { Backup.exportDownload(); toast('已下載備份檔'); };
    }
    if (!msg || bannerDismissed) { b.hidden = true; bannerAction = null; return; }
    $('#banner-text').textContent = msg;
    $('#banner-act').textContent = label;
    bannerAction = act;
    b.hidden = false;
  }
  $('#banner-act').addEventListener('click', function () { if (bannerAction) bannerAction(); });
  $('#banner-x').addEventListener('click', function () { bannerDismissed = true; updateBanner(); });

  /* ---------- 新增 / 編輯 ---------- */
  function openForm(entry) {
    form = entry
      ? { id: entry.id, type: entry.type, category: entry.category, sub: entry.sub || '', expr: String(entry.amount) }
      : { id: null, type: 'expense', category: '', sub: '', expr: '' };
    $('#f-date').value = entry ? entry.date : ymd(new Date());
    $('#f-note').value = entry ? entry.note || '' : '';
    $('#s-title').textContent = entry ? '編輯帳目' : '新增一筆';
    $('#s-del').hidden = !entry;
    paintForm();
    openOverlay($('#sheet'));
  }

  function paintForm() {
    Array.prototype.forEach.call(document.querySelectorAll('#f-type button'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.type === form.type));
    });
    var wrap = $('#f-cats');
    wrap.textContent = '';
    var list = CATS[form.type].slice();
    // 編輯舊帳目時，類別若已被刪除仍要能看到並保留，避免存檔時被默默改掉
    if (form.category && !list.some(function (c) { return c[0] === form.category; })) list.push([form.category, '📝']);
    if (!list.length) wrap.appendChild(h('p', { class: 'cats-empty', text: '尚無類別，請到選單的類別編輯器新增' }));
    list.forEach(function (c) {
      var btn = h('button', { class: 'cat-btn', type: 'button', 'aria-pressed': String(form.category === c[0]) },
        h('span', { class: 'e', text: c[1] }), h('span', { text: c[0] }));
      btn.addEventListener('click', function () {
        if (form.category !== c[0]) form.sub = '';
        form.category = c[0];
        paintForm();
        var sw = $('#f-subs');
        if (!sw.hidden) sw.scrollIntoView({ block: 'nearest' }); // 子類別在長長的類別格下方，選完要讓它露出來
      });
      wrap.appendChild(btn);
    });
    var subWrap = $('#f-subs');
    subWrap.textContent = '';
    var cur = catData[form.type].filter(function (c) { return c.name === form.category; })[0];
    var subs = cur ? cur.subs.slice() : [];
    if (form.sub && subs.indexOf(form.sub) < 0) subs.push(form.sub);
    subWrap.hidden = !subs.length;
    subs.forEach(function (name) {
      var b = h('button', { class: 'sub-btn', type: 'button', 'aria-pressed': String(form.sub === name), text: name });
      b.addEventListener('click', function () { form.sub = form.sub === name ? '' : name; paintForm(); });
      subWrap.appendChild(b);
    });
    paintFormBudget();
    paintCalc();
  }

  // 選到支出類別時顯示：該類別本月已支出 / 月預算（月份依表單日期；編輯時扣掉自己那筆）
  function paintFormBudget() {
    var box = $('#f-budget');
    box.textContent = '';
    var date = $('#f-date').value;
    if (!form || form.type !== 'expense' || !form.category || !/^\d{4}-\d{2}/.test(date)) { box.hidden = true; return; }
    var ym = date.slice(0, 7);
    var m = Number(ym.slice(5, 7));
    function line(label, spentAmt, budget) {
      var over = budget !== null && spentAmt > budget;
      var txt = label + '已支出 $' + fmt(spentAmt);
      if (budget === null) txt += '・未設定預算';
      else txt += ' / 預算 $' + fmt(budget) + (over ? '（超支 $' + fmt(spentAmt - budget) + '）' : '（剩 $' + fmt(budget - spentAmt) + '）');
      box.appendChild(h('div', { class: over ? 'over' : '', text: txt }));
    }
    var catBudget = Object.prototype.hasOwnProperty.call(budgets.cats, form.category) ? budgets.cats[form.category] : null;
    line(form.category + ' ' + m + ' 月', BudgetCore.spent(entries, { ym: ym, category: form.category, excludeId: form.id }), catBudget);
    if (budgets.month !== null) line('全部支出 ' + m + ' 月', BudgetCore.spent(entries, { ym: ym, excludeId: form.id }), budgets.month);
    box.hidden = false;
  }
  $('#f-date').addEventListener('change', paintFormBudget);

  function paintCalc() {
    $('#c-expr').textContent = form.expr || '0';
    var res = '';
    if (/[+−×÷]/.test(form.expr)) {
      var v = Calc.evaluate(form.expr);
      if (v !== null) res = '= ' + fmt(v);
    }
    $('#c-res').textContent = res;
  }

  $('#f-type').addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b || b.dataset.type === form.type) return;
    form.type = b.dataset.type;
    form.sub = '';
    if (!CATS[form.type].some(function (c) { return c[0] === form.category; })) form.category = '';
    paintForm();
  });

  $('#keys').addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    var k = b.dataset.k;
    if (k === 'save') { onSave(); return; }
    form.expr = Calc.press(form.expr, k);
    paintCalc();
  });

  async function onSave() {
    // 必須先於任何 await：在這次點擊中順便詢問備份檔授權
    var permP = Backup.shouldAsk() ? Backup.requestPermission() : Promise.resolve();

    var amount = Calc.evaluate(form.expr);
    if (amount === null || amount <= 0) { toast('請輸入大於 0 的金額'); return; }
    if (!form.category) { toast('請選擇類別'); return; }
    var date = $('#f-date').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('請選擇日期'); return; }
    var note = $('#f-note').value.trim();

    if (form.id) {
      var e = entries.filter(function (x) { return x.id === form.id; })[0];
      if (e) {
        var before = copy(e);
        e.date = date; e.type = form.type; e.category = form.category; e.amount = amount; e.note = note;
        if (form.sub) e.sub = form.sub; else delete e.sub;
        record({ kind: 'edit', before: before, after: copy(e) });
      }
    } else {
      var fresh = { id: uid(), date: date, type: form.type, category: form.category, amount: amount, note: note, createdAt: Date.now() };
      if (form.sub) fresh.sub = form.sub;
      entries.push(fresh);
      record({ kind: 'add', entry: copy(fresh) });
    }
    focusDate(date);
    closeOverlay();
    bannerDismissed = false;
    Backup.bump();
    render();
    await Store.save();
    permP.then(function () { Backup.schedule(); });
  }

  $('#s-close').addEventListener('click', closeOverlay);
  $('#s-del').addEventListener('click', async function () {
    if (!form || !form.id || !confirm('確定要刪除這筆帳嗎？')) return;
    var i = entries.findIndex(function (x) { return x.id === form.id; });
    if (i >= 0) {
      record({ kind: 'del', entry: copy(entries[i]) });
      entries.splice(i, 1);
    }
    closeOverlay();
    bannerDismissed = false;
    Backup.bump();
    render();
    await Store.save();
    Backup.schedule();
  });
  $('#fab').addEventListener('click', function () { openForm(null); });

  /* ---------- 設定與備份 ---------- */
  function timeText(ms) {
    if (!ms) return '尚未備份';
    var d = new Date(ms);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function paintSettings() {
    var st = Backup.status();
    var box = $('#st-status');
    box.textContent = '';
    function line(k, v) { box.appendChild(h('div', null, h('span', { class: 'k', text: k + '：' }), h('span', { text: v }))); }
    line('備份檔', st.linked ? st.name : (st.supported ? '尚未設定' : '此瀏覽器不支援自動寫檔'));
    if (st.linked) line('授權', st.needsPermission ? '待授權（下次按儲存時會詢問）' : '已授權');
    line('上次備份', timeText(st.last));
    line('未備份的變更', st.pending + ' 筆');
    if (st.error) line('錯誤', st.error);
    line('帳目筆數', entries.length + ' 筆');
    $('#st-link').hidden = !st.supported;
    $('#st-link').textContent = st.linked ? '更換備份檔' : '設定自動備份檔';
    $('#st-now').hidden = !(st.supported && st.linked);
  }

  $('#btn-settings').addEventListener('click', function () { paintSettings(); openOverlay($('#settings')); });
  $('#st-close').addEventListener('click', closeOverlay);

  async function doLink() {
    try {
      var ok = await Backup.linkFile();
      toast(ok ? '已設定，之後記帳會自動備份' : '已設定備份檔');
    } catch (e) {
      if (e.name !== 'AbortError') toast('無法設定備份檔：' + e.message);
    }
    paintSettings();
    updateBanner();
  }
  $('#st-link').addEventListener('click', doLink);

  $('#st-now').addEventListener('click', async function () {
    if (Backup.status().needsPermission) await Backup.requestPermission();
    var ok = await Backup.write();
    toast(ok ? '備份完成' : '備份失敗，請確認授權');
    paintSettings();
  });
  $('#st-export').addEventListener('click', function () { Backup.exportDownload(); toast('已下載備份檔'); });
  $('#st-restore').addEventListener('click', doRestore);

  function pickViaInput() {
    return new Promise(function (resolve) {
      var inp = $('#file-input');
      inp.value = '';
      inp.onchange = function () {
        var f = inp.files && inp.files[0];
        if (!f) return resolve(null);
        f.text().then(resolve, function () { resolve(null); });
      };
      inp.oncancel = function () { resolve(null); };
      inp.click();
    });
  }

  async function doRestore() {
    var text;
    try {
      text = await Backup.readText();
      if (text == null) text = await pickViaInput();
    } catch (e) {
      if (e.name !== 'AbortError') toast('無法讀取備份：' + e.message);
      return;
    }
    if (text == null) return;

    var parsed;
    try { parsed = Backup.parse(text); } catch (e) { toast('備份檔格式不正確'); return; }
    var list = parsed.entries;

    var have = {};
    entries.forEach(function (e) { have[e.id] = true; });
    var added = 0;
    list.forEach(function (e) { if (!have[e.id]) { entries.push(e); added++; } });
    Categories.merge(catData, parsed.categories);
    Categories.ensureUsed(catData, entries);
    if (InvestCore.merge(invest, parsed.invest)) await persistInvest();
    syncDepositSubs(); // ensureUsed 會把已完結定存的 sub 補回清單，須在其後修剪
    await persistCats();
    if (BudgetCore.merge(budgets, parsed.budgets)) await persistBudgets();
    undoStack.length = 0; // 還原是整批匯入，不納入復原
    redoStack.length = 0;
    paintHistory();
    await Store.save();
    render();
    paintSettings();
    toast(added ? '已還原 ' + added + ' 筆' : '備份檔中沒有新的帳目');
    Backup.schedule();
  }

  /* ---------- 側邊選單與財務報表 ---------- */
  window.BK = {
    CATS: CATS, entries: entries, fmt: fmt, h: h, iconOf: iconOf, toast: toast,
    openOverlay: openOverlay, closeOverlay: closeOverlay,
    catData: function () { return catData; },
    budgets: function () { return budgets; },
    saveBudgets: saveBudgets,
    invest: function () { return invest; },
    saveInvest: saveInvest,
    labelTaken: labelTaken,
    uid: uid, ymd: ymd,
    // 定存的子類別由投資區管理，類別編輯器不可改名／刪除
    isManagedSub: function (type, cat, sub) {
      return type === 'income' && cat === InvestCore.CATEGORY && invest.deposits.some(function (d) { return d.label === sub; });
    },
    // 投資區登記領息：新增一筆收入帳目（可復原）
    addEntry: async function (spec) {
      var fresh = { id: uid(), date: spec.date, type: 'income', category: spec.category, amount: spec.amount, note: spec.note || '', createdAt: Date.now() };
      if (spec.sub) fresh.sub = spec.sub;
      entries.push(fresh);
      record({ kind: 'add', entry: copy(fresh) });
      await afterChange();
    },
    // 刪除定存時一併刪除利息帳目：每筆各記一筆 del，仍可逐筆復原
    removeEntries: async function (ids) {
      ids.forEach(function (id) {
        var i = indexOfId(id);
        if (i < 0) return;
        record({ kind: 'del', entry: copy(entries[i]) });
        entries.splice(i, 1);
      });
      await afterChange();
    },
    // 定存改名：把帳目的 sub 一併換掉。舊操作裡存的是舊名稱，須清空復原紀錄
    relabelEntries: async function (from, to) {
      entries.forEach(function (e) {
        if (e.type === 'income' && e.category === InvestCore.CATEGORY && e.sub === from) e.sub = to;
      });
      undoStack.length = 0;
      redoStack.length = 0;
      paintHistory();
      await Store.save();
      render();
    },
    // 類別有變動後呼叫；改名會動到帳目（entriesChanged），此時復原紀錄已失效，須清空
    catsChanged: async function (opts) {
      syncDepositSubs(); // 使用者刪掉「定存利息」之類的操作後，仍要讓進行中定存的子類別回來
      await saveCats();
      if (opts && opts.entriesChanged) {
        undoStack.length = 0;
        redoStack.length = 0;
        paintHistory();
        await Store.save();
      }
      render();
    },
    reportCats: function () {
      var v = Categories.withUsed(catData, entries), out = {};
      ['expense', 'income'].forEach(function (t) { out[t] = v[t].map(function (c) { return [c.name, c.icon]; }); });
      return out;
    }
  };

  function setDrawer(open) {
    $('#drawer').hidden = !open;
    $('#btn-menu').setAttribute('aria-expanded', String(open));
  }
  $('#btn-menu').addEventListener('click', function () { setDrawer($('#drawer').hidden); });
  $('#drawer-scrim').addEventListener('click', function () { setDrawer(false); });
  $('.drawer-panel').addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    setDrawer(false);
    if (b.dataset.go === 'report') Report.open();
    else if (b.dataset.go === 'catedit') CatEditor.open();
    else if (b.dataset.go === 'budget') Budget.open();
    else if (b.dataset.go === 'invest') Invest.open();
    else if (b.dataset.go === 'settings') $('#btn-settings').click();
  });

  /* ---------- 啟動 ---------- */
  async function start() {
    await Store.init();
    var rawCats = await Store.kvGet('categories');
    if (!rawCats) { try { rawCats = JSON.parse(localStorage.getItem(CATS_LS)); } catch (e) { rawCats = null; } }
    catData = Categories.normalize(rawCats);
    syncCats();
    var rawBudgets = await Store.kvGet('budgets');
    if (!rawBudgets) { try { rawBudgets = JSON.parse(localStorage.getItem(BUDGETS_LS)); } catch (e) { rawBudgets = null; } }
    budgets = BudgetCore.normalize(rawBudgets);
    var rawInvest = await Store.kvGet('invest');
    if (!rawInvest) { try { rawInvest = JSON.parse(localStorage.getItem(INVEST_LS)); } catch (e) { rawInvest = null; } }
    invest = InvestCore.normalize(rawInvest);
    if (syncDepositSubs()) await persistCats();
    // 舊帳目的「投資」→「股票」只做一次（之後使用者可以自己建立名為「投資」的類別）
    if (!(await Store.kvGet('migrated.invest'))) {
      await Store.kvSet('migrated.invest', true);
      if (migrateCats(entries)) { await Store.save(); Backup.bump(); }
    }
    await Backup.init(function () { return entries; }, function () {
      if (openEl && openEl.id === 'settings') paintSettings();
      updateBanner();
    }, function () { return catData; }, function () { return budgets; }, function () { return invest; });
    render();
    if (window.Report) Report.init();
    if (window.CatEditor) CatEditor.init();
    if (window.Budget) Budget.init();
    if (window.Invest) Invest.init();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        // 新版已下載完、等待切換：提示使用者
        function offer(w) {
          var bar = h('div', { class: 'update-bar' },
            h('span', { text: '有新版可用' }),
            h('button', { class: 'btn primary', text: '立即更新' }));
          bar.querySelector('button').addEventListener('click', function () { w.postMessage('SKIP_WAITING'); });
          document.body.appendChild(bar);
        }
        if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
        reg.addEventListener('updatefound', function () {
          var w = reg.installing;
          w.addEventListener('statechange', function () {
            if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
          });
        });
        var reloaded = !navigator.serviceWorker.controller; // 首次安裝取得控制權時不重載
        navigator.serviceWorker.addEventListener('controllerchange', function () {
          if (reloaded) return;
          reloaded = true;
          location.reload();
        });
      }).catch(function () { /* http 環境下不支援 */ });
    }
  }
  start();
})();
