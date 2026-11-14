(function () {
  'use strict';

  var CATS = {
    expense: [['餐費', '🍜'], ['購物', '🛍️'], ['交通', '🚌'], ['日用品', '🧴'], ['娛樂', '🎮'], ['醫療', '💊'], ['居住', '🏠'], ['其他', '📦']],
    income: [['薪水', '💼'], ['股息', '📈'], ['獎金', '🎁'], ['投資', '💹'], ['其他', '💰']]
  };
  var WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  var STALE_DAYS = 7;

  var entries = Store.entries;
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

  /* ---------- 列表 ---------- */
  function render() {
    var now = new Date();
    var ym = ymd(now).slice(0, 7);
    var inc = 0, exp = 0;
    entries.forEach(function (e) {
      if (e.date.indexOf(ym) === 0) { if (e.type === 'income') inc += e.amount; else exp += e.amount; }
    });
    $('#sum-title').textContent = now.getFullYear() + ' 年 ' + (now.getMonth() + 1) + ' 月';
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

    var sorted = entries.slice().sort(function (a, b) {
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
    } else if (!st.linked) {
      var days = st.last ? (Date.now() - st.last) / 86400000 : Infinity;
      if (st.supported) {
        msg = '尚未設定自動備份。';
        label = '設定';
        act = doLink;
      } else if (days > STALE_DAYS) {
        msg = '已經很久沒備份了。';
        label = '匯出';
        act = function () { Backup.exportDownload(); toast('已下載備份檔'); };
      }
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
      if (e) { e.date = date; e.type = form.type; e.category = form.category; e.amount = amount; e.note = note; }
    } else {
      entries.push({ id: uid(), date: date, type: form.type, category: form.category, amount: amount, note: note, createdAt: Date.now() });
    }
    closeOverlay();
    render();
    await Store.save();
    permP.then(function () { Backup.schedule(); });
  }

  $('#s-close').addEventListener('click', closeOverlay);
  $('#s-del').addEventListener('click', async function () {
    if (!form || !form.id || !confirm('確定要刪除這筆帳嗎？')) return;
    var i = entries.findIndex(function (x) { return x.id === form.id; });
    if (i >= 0) entries.splice(i, 1);
    closeOverlay();
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
    await Store.save();
    render();
    paintSettings();
    toast(added ? '已還原 ' + added + ' 筆' : '備份檔中沒有新的帳目');
    Backup.schedule();
  }

  /* ---------- 啟動 ---------- */
  async function start() {
    await Store.init();
    await Backup.init(function () { return entries; }, function () {
      if (openEl && openEl.id === 'settings') paintSettings();
      updateBanner();
    });
    render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () { /* http 環境下不支援 */ });
  }
  start();
})();
