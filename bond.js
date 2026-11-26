/* 債券區（債券 ETF）：持倉、買賣記錄、配息、價格刷新。運算全在 bond-core.js，這裡只管畫面與網路。
 * 由 invest.js 在「債券」分頁呼叫 Bond.render(body, rerender)。
 * 唯一會連網的地方是「刷新價格」：只把 ETF 代號與日期送到 FinMind，不送任何持股數量或金額；失敗只提示，保留舊價。 */
var Bond = (function () {
  'use strict';

  var view = { mode: 'list', id: null, editTrade: null, type: 'buy' }; // mode: list | add | fund
  var redo = function () {};
  var busy = false;

  function BK() { return window.BK; }
  function today() { return BK().ymd(new Date()); }
  function money(n) { return '$' + BK().fmt(n); }
  function sign(n) { return (n > 0 ? '+' : (n < 0 ? '−' : '')) + money(Math.abs(n)); }
  function pct(x) { return x === null || x === undefined || !isFinite(x) ? '無法計算' : (Math.round(x * 10000) / 100) + '%'; }
  function cls(n) { return n > 0 ? 'inc' : (n < 0 ? 'exp' : ''); }
  function p4(n) { return String(Math.round(n * 10000) / 10000); }
  function stamp(ms) {
    var d = new Date(ms), p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return BK().ymd(d) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function data() { return BK().bonds(); }
  function fundOf(id) { return BondCore.fundById(data(), id); }
  function go(v) { view = Object.assign({ mode: 'list', id: null, editTrade: null, type: 'buy' }, v); redo(); }

  function row(k, v, c) {
    var h = BK().h;
    return h('div', { class: 'iv-row' }, h('span', { class: 'k', text: k }), h('span', { class: 'v' + (c ? ' ' + c : ''), text: v }));
  }
  function field(label, input, hint) {
    var h = BK().h;
    return h('label', { class: 'iv-field' }, h('span', { class: 'iv-label', text: label }), input, hint ? h('span', { class: 'iv-hint', text: hint }) : null);
  }
  function textInput(value, ph, mode) {
    var el = BK().h('input', { type: 'text', inputmode: mode || 'decimal', placeholder: ph || '', autocomplete: 'off' });
    el.value = value === null || value === undefined ? '' : String(value);
    return el;
  }
  function button(text, c, onClick) {
    var b = BK().h('button', { type: 'button', class: c, text: text });
    b.addEventListener('click', onClick);
    return b;
  }

  /* ---------- 價格刷新（唯一連網處） ---------- */
  async function fetchPrice(code) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 15000) : null;
    try {
      var res = await fetch(BondCore.finMindUrl(code, today()), ctl ? { signal: ctl.signal, cache: 'no-store' } : { cache: 'no-store' });
      if (!res.ok) return { error: '查詢失敗（HTTP ' + res.status + '）' };
      var got = BondCore.parseFinMind(await res.json());
      return got ? { ok: got } : { error: '查無近期價格' };
    } catch (e) {
      return { error: navigator.onLine === false ? '目前沒有網路' : '無法連線' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function refresh(funds) {
    if (busy || !funds.length) return;
    busy = true; redo();
    var okCount = 0, fails = [];
    for (var i = 0; i < funds.length; i++) {
      var r = await fetchPrice(funds[i].code);
      if (r.ok) {
        funds[i].price = r.ok.price; funds[i].priceDate = r.ok.date; funds[i].priceAt = Date.now();
        okCount++;
      } else {
        fails.push(funds[i].code + '：' + r.error);
        if (r.error === '目前沒有網路' || r.error === '無法連線') break; // 連線問題不必每檔都試
      }
    }
    if (okCount) await BK().saveBonds(true);
    busy = false;
    BK().toast(fails.length ? (okCount ? '已更新 ' + okCount + ' 檔；' : '') + fails[0] + '，保留上次價格' : '已更新 ' + okCount + ' 檔價格');
    redo();
  }

  /* ---------- 列表 ---------- */
  function summaryCard(s) {
    var h = BK().h, card = h('div', { class: 'card iv-card' });
    card.appendChild(h('div', { class: 'iv-sum-title', text: '整體（債券）' }));
    card.appendChild(row('累計投入', money(s.boughtTotal)));
    card.appendChild(row('目前持有成本', money(s.cost)));
    if (s.missingPrice) {
      card.appendChild(row('市值與損益', '請先刷新價格'));
    } else {
      card.appendChild(row('總市值', money(s.marketValue)));
      card.appendChild(row('未實現損益', sign(s.unrealized), cls(s.unrealized)));
    }
    card.appendChild(row('已實現損益', sign(s.realized), cls(s.realized)));
    card.appendChild(row('累計配息', money(s.dividends)));
    if (!s.missingPrice && s.totalReturn !== null) {
      card.appendChild(h('div', { class: 'iv-sep' }));
      card.appendChild(row('總報酬', sign(s.totalReturn), cls(s.totalReturn)));
      card.appendChild(row('總報酬率', pct(s.roi), cls(s.roi)));
      card.appendChild(row('年化報酬率（XIRR）', pct(s.xirr), cls(s.xirr)));
    }
    if (s.avgBuyYtm !== null) card.appendChild(row('加權平均買入 YTM', s.avgBuyYtm + '%'));
    if (s.weightedDuration !== null) card.appendChild(row('市值加權存續期間', s.weightedDuration + ' 年'));
    var dep = InvestCore.summary(BK().invest().deposits, BK().entries, today());
    if (dep.doneCount && dep.annual !== null) card.appendChild(row('對照：定存年化（已完結）', pct(dep.annual)));
    return card;
  }

  function fundCard(f, st) {
    var h = BK().h;
    var card = h('button', { type: 'button', class: 'card iv-dep', 'aria-label': '查看 ETF：' + f.code });
    var head = h('div', { class: 'iv-dep-head' },
      h('span', { class: 'iv-dep-name', text: f.code + (f.name ? '　' + f.name : '') }));
    if (st.duration && st.duration.stale) head.appendChild(h('span', { class: 'iv-badge matured', text: '存續期間待更新' }));
    card.appendChild(head);
    if (st.error) {
      card.appendChild(h('div', { class: 'iv-dep-sub', text: '資料有誤：' + st.error }));
    } else {
      card.appendChild(h('div', { class: 'iv-dep-sub', text: '持股 ' + BK().fmt(st.shares) + ' 股・均價 ' + (st.shares ? p4(Math.round(st.avgCost * 100) / 100) : '—') +
        '・現價 ' + (st.price === null ? '未刷新' : p4(st.price)) }));
      if (st.unrealized !== null && st.shares > 0) {
        card.appendChild(h('div', { class: 'iv-dep-sub ' + cls(st.unrealized), text: '市值 ' + money(st.marketValue) + '・未實現 ' + sign(st.unrealized) +
          (st.cost > 0 ? '（' + pct(st.unrealized / st.cost) + '）' : '') }));
      } else if (st.shares > 0) {
        card.appendChild(h('div', { class: 'iv-dep-sub', text: '請先刷新價格' }));
      } else {
        card.appendChild(h('div', { class: 'iv-dep-sub', text: '已賣光・已實現 ' + sign(st.realized) }));
      }
    }
    card.addEventListener('click', function () { go({ mode: 'fund', id: f.id }); });
    return card;
  }

  function renderList(body) {
    var h = BK().h, d = data(), entries = BK().entries;
    body.appendChild(h('p', { class: 'note', text: '台股債券 ETF。買賣只記成交價、股數、實際總金額；配息會同步記進流水帳收入（債券）。價格要按「刷新價格」才會更新，其餘功能離線可用。' }));
    var bar = h('div', { class: 'iv-btnrow' });
    var rb = button(busy ? '刷新中…' : '刷新價格', 'btn', function () { refresh(d.funds); });
    if (busy || !d.funds.length) rb.disabled = true;
    bar.appendChild(rb);
    bar.appendChild(button('＋ 新增 ETF', 'btn primary', function () { go({ mode: 'add' }); }));
    body.appendChild(bar);
    if (!d.funds.length) { body.appendChild(h('p', { class: 'ce-empty', text: '還沒有任何 ETF。' })); return; }
    var latest = 0, latestDate = '';
    d.funds.forEach(function (f) { if (f.priceAt && f.priceAt > latest) { latest = f.priceAt; latestDate = f.priceDate || ''; } });
    body.appendChild(h('p', { class: 'note', text: latest ? '價格更新於 ' + stamp(latest) + '（資料日 ' + latestDate + '）' : '尚未刷新過價格' }));
    body.appendChild(summaryCard(BondCore.summary(d, entries, today())));
    body.appendChild(h('h3', { class: 'ce-title', text: 'ETF 明細' }));
    d.funds.forEach(function (f) { body.appendChild(fundCard(f, BondCore.fundStats(f, d.trades, entries, today()))); });
  }

  /* ---------- 新增 ETF ---------- */
  function renderAdd(body) {
    var h = BK().h;
    body.appendChild(button('← 返回列表', 'txt-btn', function () { go({}); }));
    body.appendChild(h('h3', { class: 'ce-title', text: '新增 ETF' }));
    var code = textInput('', '例如：00679B', 'text');
    code.setAttribute('maxlength', '10');
    var name = textInput('', '例如：元大美債20年', 'text');
    name.setAttribute('maxlength', String(BondCore.MAX_NAME));
    body.appendChild(h('div', { class: 'card iv-form' },
      field('代號', code, '台股代號，會當作流水帳「收入 › 債券」底下的子類別名稱。'),
      field('名稱（選填）', name)));
    body.appendChild(button('新增', 'btn primary', async function () {
      var c = BondCore.codeOf(code.value);
      if (!c) { BK().toast('請輸入正確的代號（英數字 3～10 碼）'); return; }
      if (data().funds.some(function (f) { return f.code === c; })) { BK().toast('這檔 ETF 已經存在'); return; }
      var f = { id: BK().uid(), code: c, createdAt: Date.now() };
      var nm = name.value.trim().slice(0, BondCore.MAX_NAME);
      if (nm) f.name = nm;
      data().funds.push(f);
      await BK().saveBonds();
      BK().toast('已新增 ' + c);
      go({ mode: 'fund', id: f.id });
    }));
  }

  /* ---------- 單檔內頁 ---------- */
  function statsCard(f, st) {
    var h = BK().h, card = h('div', { class: 'card iv-card' });
    card.appendChild(h('div', { class: 'iv-sum-title', text: '統計' }));
    if (st.error) { card.appendChild(h('div', { class: 'iv-dep-sub', text: '資料有誤：' + st.error })); return card; }
    card.appendChild(row('持股', BK().fmt(st.shares) + ' 股'));
    card.appendChild(row('平均成本', st.shares ? p4(Math.round(st.avgCost * 100) / 100) : '—'));
    card.appendChild(row('持有成本', money(st.cost)));
    card.appendChild(row('現價', st.price === null ? '尚未有價格' : p4(f.price) + (f.priceDate ? '（' + f.priceDate + '）' : '')));
    if (st.marketValue !== null) {
      card.appendChild(row('市值', money(st.marketValue)));
      card.appendChild(row('未實現損益', sign(st.unrealized), cls(st.unrealized)));
    } else if (st.shares > 0) {
      card.appendChild(row('市值與損益', '請先刷新價格'));
    }
    card.appendChild(row('已實現損益', sign(st.realized), cls(st.realized)));
    card.appendChild(row('累計配息', money(st.dividends) + (st.dividendCount ? '（' + st.dividendCount + ' 筆）' : '')));
    if (st.totalReturn !== null) {
      card.appendChild(h('div', { class: 'iv-sep' }));
      card.appendChild(row('總報酬', sign(st.totalReturn), cls(st.totalReturn)));
      card.appendChild(row('總報酬率', pct(st.roi), cls(st.roi)));
      card.appendChild(row('年化報酬率（XIRR）', pct(st.xirr), cls(st.xirr)));
    }
    if (st.avgBuyYtm !== null) card.appendChild(row('加權平均買入 YTM', st.avgBuyYtm + '%'));
    if (st.holdYears !== null) {
      card.appendChild(row('平均持有', (Math.round(st.holdYears * 10) / 10) + ' 年' + (st.duration ? ' ／ 存續期間 ' + st.duration.value + ' 年' : '')));
    }
    return card;
  }

  function priceCard(f) {
    var h = BK().h, card = h('div', { class: 'card iv-form' });
    card.appendChild(h('div', { class: 'iv-sum-title', text: '價格' }));
    var price = textInput(typeof f.price === 'number' ? f.price : '', '手動輸入現價');
    card.appendChild(field('現價', price, '「刷新價格」會連網更新；也可以自己輸入。' + (f.priceAt ? '上次更新 ' + stamp(f.priceAt) : '')));
    var bar = h('div', { class: 'iv-btnrow' });
    bar.appendChild(button('儲存價格', 'btn', async function () {
      var p = BondCore.priceOf(price.value);
      if (p === null) { BK().toast('請輸入大於 0 的價格'); return; }
      f.price = p; f.priceDate = today(); f.priceAt = Date.now();
      await BK().saveBonds(true);
      BK().toast('已儲存價格');
      redo();
    }));
    var rb = button(busy ? '刷新中…' : '刷新此檔', 'btn', function () { refresh([f]); });
    if (busy) rb.disabled = true;
    bar.appendChild(rb);
    card.appendChild(bar);
    return card;
  }

  function paramsCard(f, st) {
    var h = BK().h, card = h('div', { class: 'card iv-form' });
    card.appendChild(h('div', { class: 'iv-sum-title', text: '參數（手動）' }));
    var url = textInput(f.url || '', 'https://…', 'url');
    url.setAttribute('maxlength', '300');
    var dur = textInput(f.duration ? f.duration.value : '', '例如：15.25');
    card.appendChild(field('官網連結（選填）', url));
    card.appendChild(field('目前存續期間（年）', dur, f.duration ? '更新於 ' + f.duration.date : '到投信官網查詢後填入'));
    if (st.duration && st.duration.stale) card.appendChild(h('p', { class: 'note iv-warn', text: '已超過一季（90 天）沒更新存續期間，建議到官網查看。' }));
    var bar = h('div', { class: 'iv-btnrow' });
    bar.appendChild(button('儲存參數', 'btn', async function () {
      var u = url.value.trim() ? BondCore.urlOf(url.value) : null;
      if (url.value.trim() && !u) { BK().toast('官網連結需以 http:// 或 https:// 開頭'); return; }
      var dv = dur.value.trim() ? BondCore.durationOf(dur.value) : null;
      if (dur.value.trim() && dv === null) { BK().toast('存續期間請輸入大於 0 的數字（年）'); return; }
      if (u) f.url = u; else delete f.url;
      if (dv === null) delete f.duration;
      else if (!f.duration || f.duration.value !== dv) f.duration = { value: dv, date: today() };
      await BK().saveBonds();
      BK().toast('已儲存');
      redo();
    }));
    var ob = button('開啟官網', 'btn', function () {
      var u = BondCore.urlOf(url.value);
      if (!u) { BK().toast('請先填入有效的官網連結'); return; }
      window.open(u, '_blank', 'noopener');
    });
    bar.appendChild(ob);
    card.appendChild(bar);
    return card;
  }

  function tradeForm(f) {
    var h = BK().h;
    var editing = view.editTrade ? data().trades.filter(function (t) { return t.id === view.editTrade; })[0] : null;
    var type = editing ? editing.type : view.type;
    var card = h('div', { class: 'card iv-form' });
    card.appendChild(h('div', { class: 'iv-sum-title', text: editing ? '編輯交易' : '新增交易' }));
    var seg = h('div', { class: 'seg', role: 'group', 'aria-label': '買入或賣出' });
    [['buy', '買入'], ['sell', '賣出']].forEach(function (x) {
      var b = h('button', { type: 'button', 'aria-pressed': String(type === x[0]), text: x[1] });
      b.addEventListener('click', function () { if (editing) return; view.type = x[0]; redo(); });
      seg.appendChild(b);
    });
    card.appendChild(seg);
    var date = h('input', { type: 'date' });
    date.value = editing ? editing.date : today();
    var price = textInput(editing ? editing.price : '', '每股成交價');
    var shares = textInput(editing ? editing.shares : '', '成交股數', 'numeric');
    var amount = textInput(editing ? editing.amount : '', type === 'buy' ? '實際付出的總金額' : '實際收到的總金額');
    var ytm = type === 'buy' ? textInput(editing && typeof editing.ytm === 'number' ? editing.ytm : '', '例如：5.3') : null;
    var fee = h('div', { class: 'note iv-preview' });
    function paintFee() {
      var p = BondCore.priceOf(price.value), s = BondCore.sharesOf(shares.value), a = BondCore.amountOf(amount.value);
      if (p === null || s === null || a === null) { fee.textContent = '填好成交價、股數、實際總金額後，這裡會顯示推算的手續費。'; return; }
      var diff = Math.round((type === 'buy' ? a - s * p : s * p - a) * 100) / 100;
      fee.textContent = diff >= 0 ? '推算手續費／稅 ' + money(diff) : '實際金額' + (type === 'buy' ? '低於' : '高於') + '成交金額 ' + money(-diff) + '，請確認是否填錯';
    }
    [price, shares, amount].forEach(function (el) { el.addEventListener('input', paintFee); });
    paintFee();
    card.appendChild(field('日期', date));
    card.appendChild(field('成交價', price));
    card.appendChild(field('股數', shares));
    card.appendChild(field(type === 'buy' ? '實際總金額（實付）' : '實際總金額（實收）', amount));
    if (ytm) card.appendChild(field('買入時 YTM（%，選填）', ytm, '到官網查到的買入當時到期殖利率'));
    card.appendChild(fee);
    var bar = h('div', { class: 'iv-btnrow' });
    bar.appendChild(button(editing ? '儲存修改' : '新增交易', 'btn primary', async function () {
      var p = BondCore.priceOf(price.value), s = BondCore.sharesOf(shares.value), a = BondCore.amountOf(amount.value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value) || !InvestCore.parseYmd(date.value)) { BK().toast('請選擇日期'); return; }
      if (date.value > today()) { BK().toast('日期不可晚於今天'); return; }
      if (p === null) { BK().toast('請輸入大於 0 的成交價'); return; }
      if (s === null) { BK().toast('股數請輸入正整數'); return; }
      if (a === null) { BK().toast('請輸入大於 0 的實際總金額'); return; }
      var y = null;
      if (ytm && ytm.value.trim()) { y = BondCore.ytmOf(ytm.value); if (y === null) { BK().toast('YTM 請輸入 0～100 之間的數字'); return; } }
      var d = data();
      var next = { id: editing ? editing.id : BK().uid(), fundId: f.id, date: date.value, type: type, shares: s, price: p, amount: a, createdAt: editing ? editing.createdAt : Date.now() };
      if (y !== null) next.ytm = y;
      var list = d.trades.filter(function (t) { return !editing || t.id !== editing.id; }).concat([next]);
      var chk = BondCore.validate(list, f.id);
      if (!chk.ok) { BK().toast(chk.error); return; }
      d.trades = list;
      await BK().saveBonds();
      BK().toast(editing ? '已儲存修改' : '已新增交易');
      go({ mode: 'fund', id: f.id });
    }));
    if (editing) bar.appendChild(button('取消', 'btn', function () { go({ mode: 'fund', id: f.id }); }));
    card.appendChild(bar);
    return card;
  }

  function tradeList(f) {
    var h = BK().h;
    var mine = BondCore.sortTrades(BondCore.fundTrades(data().trades, f.id)).reverse();
    var wrap = h('div', { class: 'iv-list' });
    if (!mine.length) { wrap.appendChild(h('p', { class: 'ce-empty', text: '還沒有交易記錄。' })); return wrap; }
    mine.forEach(function (t) {
      var line = h('div', { class: 'card iv-dep' });
      line.appendChild(h('div', { class: 'iv-dep-head' },
        h('span', { class: 'iv-dep-name', text: t.date + '　' + (t.type === 'buy' ? '買入' : '賣出') }),
        h('span', { class: 'iv-dep-sub', text: money(t.amount) })));
      line.appendChild(h('div', { class: 'iv-dep-sub', text: BK().fmt(t.shares) + ' 股 @ ' + p4(t.price) + (typeof t.ytm === 'number' ? '・買入 YTM ' + t.ytm + '%' : '') }));
      var bar = h('div', { class: 'iv-btnrow' });
      bar.appendChild(button('編輯', 'ce-btn', function () { go({ mode: 'fund', id: f.id, editTrade: t.id }); }));
      bar.appendChild(button('刪除', 'ce-btn danger', async function () {
        if (!confirm('刪除這筆' + (t.type === 'buy' ? '買入' : '賣出') + '記錄（' + t.date + '，' + BK().fmt(t.shares) + ' 股）？')) return;
        var d = data();
        var list = d.trades.filter(function (x) { return x.id !== t.id; });
        var chk = BondCore.validate(list, f.id);
        if (!chk.ok) { BK().toast('不能刪除：刪掉後' + chk.error); return; }
        d.trades = list;
        await BK().saveBonds();
        BK().toast('已刪除');
        redo();
      }));
      line.appendChild(bar);
      wrap.appendChild(line);
    });
    return wrap;
  }

  function dividendCard(f) {
    var h = BK().h, card = h('div', { class: 'card iv-form' });
    card.appendChild(h('div', { class: 'iv-sum-title', text: '登記配息' }));
    var date = h('input', { type: 'date' });
    date.value = today();
    var amount = textInput('', '實際入帳的配息金額');
    card.appendChild(field('入帳日', date));
    card.appendChild(field('配息金額', amount, '登記後會同時在流水帳記一筆收入（債券 › ' + f.code + '）。'));
    card.appendChild(button('登記配息', 'btn', async function () {
      var a = BondCore.amountOf(amount.value);
      if (a === null) { BK().toast('請輸入大於 0 的配息金額'); return; }
      if (!InvestCore.parseYmd(date.value)) { BK().toast('請選擇入帳日'); return; }
      await BK().addEntry({ date: date.value, amount: a, category: BondCore.CATEGORY, sub: f.code, note: '債券ETF配息' });
      BK().toast('已登記配息 ' + money(a));
      redo();
    }));
    return card;
  }

  async function deleteFund(f) {
    var entries = BK().entries, divs = BondCore.dividendEntries(f, entries);
    var total = BondCore.dividendsOf(f, entries).total;
    var tradeCount = BondCore.fundTrades(data().trades, f.id).length;
    var msg = '刪除 ' + f.code + '？會一併刪除它的 ' + tradeCount + ' 筆交易記錄，且不再計入報酬率與 XIRR。';
    if (divs.length) msg += '\n\n流水帳中已記的 ' + divs.length + ' 筆配息（共 ' + money(total) + '）會保留。';
    if (!confirm(msg)) return;
    var alsoEntries = false;
    if (divs.length) alsoEntries = confirm('要同時刪除這 ' + divs.length + ' 筆配息帳目嗎？\n\n按「確定」＝一併刪除（可在流水帳逐筆復原）\n按「取消」＝保留成一般收入');
    var ids = alsoEntries ? divs.map(function (e) { return e.id; }) : [];
    var d = data();
    d.funds = d.funds.filter(function (x) { return x.id !== f.id; });
    d.trades = d.trades.filter(function (x) { return x.fundId !== f.id; });
    window.Categories.removeSub(BK().catData(), 'income', BondCore.CATEGORY, f.code);
    await BK().saveBonds();
    if (ids.length) await BK().removeEntries(ids);
    BK().toast('已刪除 ' + f.code);
    go({});
  }

  function renderFund(body) {
    var h = BK().h, f = fundOf(view.id);
    if (!f) { go({}); return; }
    var st = BondCore.fundStats(f, data().trades, BK().entries, today());
    body.appendChild(button('← 返回列表', 'txt-btn', function () { go({}); }));
    body.appendChild(h('h3', { class: 'ce-title', text: f.code + (f.name ? '　' + f.name : '') }));
    body.appendChild(statsCard(f, st));
    body.appendChild(priceCard(f));
    body.appendChild(tradeForm(f));
    body.appendChild(dividendCard(f));
    body.appendChild(paramsCard(f, st));
    body.appendChild(h('h3', { class: 'ce-title', text: '交易記錄' }));
    body.appendChild(tradeList(f));
    body.appendChild(button('刪除這檔 ETF', 'btn danger', function () { deleteFund(f); }));
  }

  /* ---------- 對外 ---------- */
  function render(body, rerender) {
    redo = rerender;
    if (view.mode === 'add') renderAdd(body);
    else if (view.mode === 'fund') renderFund(body);
    else renderList(body);
  }
  function reset() { view = { mode: 'list', id: null, editTrade: null, type: 'buy' }; }

  return { render: render, reset: reset };
})();
