(function () {
  'use strict';

  var CATS = {
    expense: [['餐費', '🍜'], ['購物', '🛍️'], ['交通', '🚌'], ['日用品', '🧴'], ['娛樂', '🎮'], ['醫療', '💊'], ['居住', '🏠'],
      ['禮物', '🎁'], ['稅', '🧾'], ['孝養金', '🧧'], ['旅遊', '✈️'], ['數位', '📱'], ['借錢', '🤝'], ['投資', '💹'], ['保險', '🛡️'], ['其他', '📦']],
    income: [['薪水', '💼'], ['股息', '📈'], ['獎金', '🎁'], ['投資', '💹'], ['定存利息', '🏦'], ['其他', '💰']]
  };
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
    return name + '「' + e.category + ' $' + fmt(e.amount) + '」';
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
        var mid = h('span', { class: 'mid' }, h('span', { class: 'cat', text: e.category }));
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
      ? { id: entry.id, type: entry.type, category: entry.category, expr: String(entry.amount) }
      : { id: null, type: 'expense', category: '', expr: '' };
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
    CATS[form.type].forEach(function (c) {
      var btn = h('button', { class: 'cat-btn', type: 'button', 'aria-pressed': String(form.category === c[0]) },
        h('span', { class: 'e', text: c[1] }), h('span', { text: c[0] }));
      btn.addEventListener('click', function () { form.category = c[0]; paintForm(); });
      wrap.appendChild(btn);
    });
    paintCalc();
  }

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
        record({ kind: 'edit', before: before, after: copy(e) });
      }
    } else {
      var fresh = { id: uid(), date: date, type: form.type, category: form.category, amount: amount, note: note, createdAt: Date.now() };
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

    var list;
    try { list = Backup.parse(text); } catch (e) { toast('備份檔格式不正確'); return; }

    var have = {};
    entries.forEach(function (e) { have[e.id] = true; });
    var added = 0;
    list.forEach(function (e) { if (!have[e.id]) { entries.push(e); added++; } });
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
    openOverlay: openOverlay, closeOverlay: closeOverlay
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
    else if (b.dataset.go === 'settings') $('#btn-settings').click();
  });

  /* ---------- 啟動 ---------- */
  async function start() {
    await Store.init();
    await Backup.init(function () { return entries; }, function () {
      if (openEl && openEl.id === 'settings') paintSettings();
      updateBanner();
    });
    render();
    if (window.Report) Report.init();
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
