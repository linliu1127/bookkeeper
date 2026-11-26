/* 債券 ETF 的純運算（不碰 DOM，可用 node 測試）。
 * 資料：{ version:1, funds:[{ id, code, name?, url?, price?, priceDate?, priceAt?, duration?:{value,date}, createdAt }],
 *         trades:[{ id, fundId, date, type:'buy'|'sell', shares, price, amount, ytm?, createdAt }] }
 *
 * 配息不存在這裡：某檔配息 = 流水帳中 收入 › 債券 › code 的帳目（與定存同一套推導做法）。
 * 成本用平均成本法；amount 是實際收付總金額（買＝實付、賣＝實收），手續費自然含在成本內。 */
(function (root) {
  'use strict';

  var IC = typeof require === 'function' && typeof module !== 'undefined' && module.exports
    ? require('./invest-core.js') : root.InvestCore;

  var CATEGORY = '債券';        // 連動用的收入類別名稱
  var MAX_NAME = 20;
  var MAX_AMOUNT = 1e12;
  var STALE_DAYS = 90;          // 目前存續期間超過一季沒更新就提醒
  var CODE_RE = /^[0-9A-Z]{3,10}$/;

  function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function blank(v) { return v === null || v === undefined || String(v).trim() === ''; }

  /* ---------- 欄位驗證（回傳清理後的值，不合法回傳 null） ---------- */
  function codeOf(v) {
    var s = String(v === null || v === undefined ? '' : v).trim().toUpperCase();
    return CODE_RE.test(s) ? s : null;
  }
  function amountOf(v) {
    if (blank(v)) return null;
    var n = Number(v);
    if (!isFinite(n) || n <= 0 || n > MAX_AMOUNT) return null;
    return r2(n);
  }
  function priceOf(v) {
    if (blank(v)) return null;
    var n = Number(v);
    if (!isFinite(n) || n <= 0 || n > 1e6) return null;
    return Math.round(n * 10000) / 10000;
  }
  function sharesOf(v) {
    if (blank(v)) return null;
    var n = Number(v);
    if (!isFinite(n) || n < 1 || n > 1e9 || Math.floor(n) !== n) return null;
    return n;
  }
  function ytmOf(v) {
    if (blank(v)) return null;
    var n = Number(v);
    if (!isFinite(n) || n <= 0 || n > 100) return null;
    return Math.round(n * 100) / 100;
  }
  function durationOf(v) {
    if (blank(v)) return null;
    var n = Number(v);
    if (!isFinite(n) || n <= 0 || n > 100) return null;
    return Math.round(n * 100) / 100;
  }
  function urlOf(v) {
    var s = String(v === null || v === undefined ? '' : v).trim();
    if (!s || s.length > 300 || !/^https?:\/\/[^\s]+$/i.test(s)) return null;
    return s;
  }

  /* ---------- 日期 ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function addDays(s, n) {
    var p = IC.parseYmd(s);
    var t = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
  }
  function years(from, to) { return IC.daysBetween(from, to) / 365; }

  /* ---------- 資料 ---------- */
  function empty() { return { version: 1, funds: [], trades: [] }; }

  function normalize(raw) {
    var out = empty();
    if (!raw || typeof raw !== 'object') return out;
    var fundIds = {}, codes = {};
    (Array.isArray(raw.funds) ? raw.funds : []).forEach(function (f) {
      if (!f || typeof f !== 'object') return;
      var id = typeof f.id === 'string' ? f.id : '', code = codeOf(f.code);
      if (!id || fundIds[id] || !code || codes[code]) return;
      fundIds[id] = true; codes[code] = true;
      var item = { id: id, code: code, createdAt: Number(f.createdAt) || 0 };
      var name = typeof f.name === 'string' ? f.name.trim().slice(0, MAX_NAME) : '';
      if (name) item.name = name;
      var url = urlOf(f.url);
      if (url) item.url = url;
      var price = priceOf(f.price);
      if (price !== null) {
        item.price = price;
        if (typeof f.priceDate === 'string' && IC.parseYmd(f.priceDate)) item.priceDate = f.priceDate;
        if (Number(f.priceAt) > 0) item.priceAt = Number(f.priceAt);
      }
      if (f.duration && typeof f.duration === 'object') {
        var dv = durationOf(f.duration.value);
        if (dv !== null && typeof f.duration.date === 'string' && IC.parseYmd(f.duration.date)) item.duration = { value: dv, date: f.duration.date };
      }
      out.funds.push(item);
    });
    var tradeIds = {};
    (Array.isArray(raw.trades) ? raw.trades : []).forEach(function (t) {
      if (!t || typeof t !== 'object') return;
      var id = typeof t.id === 'string' ? t.id : '';
      var shares = sharesOf(t.shares), price = priceOf(t.price), amount = amountOf(t.amount);
      if (!id || tradeIds[id] || !fundIds[t.fundId] || !IC.parseYmd(t.date)) return;
      if (t.type !== 'buy' && t.type !== 'sell') return;
      if (shares === null || price === null || amount === null) return;
      tradeIds[id] = true;
      var item = { id: id, fundId: t.fundId, date: t.date, type: t.type, shares: shares, price: price, amount: amount, createdAt: Number(t.createdAt) || 0 };
      var y = t.type === 'buy' ? ytmOf(t.ytm) : null;
      if (y !== null) item.ytm = y;
      out.trades.push(item);
    });
    return out;
  }

  function isEmpty(data) { return !data.funds.length && !data.trades.length; }

  // 還原備份：只補本機沒有的（以 id 判斷），本機優先。代號相同但 id 不同的 ETF 視為同一檔，交易改掛到本機那檔。回傳是否有變動
  function merge(local, incoming) {
    var changed = false, idMap = {};
    var byCode = {}, byId = {};
    local.funds.forEach(function (f) { byCode[f.code] = f; byId[f.id] = f; });
    incoming.funds.forEach(function (f) {
      if (byId[f.id]) { idMap[f.id] = f.id; return; }
      if (byCode[f.code]) { idMap[f.id] = byCode[f.code].id; return; }
      var copy = JSON.parse(JSON.stringify(f));
      local.funds.push(copy); byId[copy.id] = copy; byCode[copy.code] = copy; idMap[f.id] = copy.id;
      changed = true;
    });
    var have = {};
    local.trades.forEach(function (t) { have[t.id] = true; });
    incoming.trades.forEach(function (t) {
      if (have[t.id] || !idMap[t.fundId]) return;
      var copy = Object.assign({}, t, { fundId: idMap[t.fundId] });
      local.trades.push(copy); have[t.id] = true; changed = true;
    });
    return changed;
  }

  function fundById(data, id) { return data.funds.filter(function (f) { return f.id === id; })[0]; }
  function fundTrades(trades, fundId) { return trades.filter(function (t) { return t.fundId === fundId; }); }

  /* ---------- 持倉（平均成本法） ---------- */
  function sortTrades(list) {
    return list.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.type !== b.type) return a.type === 'buy' ? -1 : 1; // 同一天先買後賣
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.id < b.id ? -1 : 1;
    });
  }

  // trades 須為同一檔。回傳 {ok, shares, cost, avgCost, realized, boughtTotal, soldTotal}；賣超過時 {ok:false, error, date}
  function position(trades) {
    var shares = 0, cost = 0, realized = 0, bought = 0, sold = 0;
    var list = sortTrades(trades);
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (t.type === 'buy') {
        shares += t.shares; cost += t.amount; bought += t.amount;
      } else {
        if (t.shares > shares) return { ok: false, error: '賣出股數超過當時持股（' + t.date + '）', date: t.date };
        var avg = cost / shares, removed = avg * t.shares;
        realized += t.amount - removed;
        shares -= t.shares; cost -= removed; sold += t.amount;
        if (shares === 0) cost = 0;
      }
    }
    return { ok: true, shares: shares, cost: r2(cost), avgCost: shares > 0 ? cost / shares : 0, realized: r2(realized), boughtTotal: r2(bought), soldTotal: r2(sold) };
  }

  // 新增／編輯／刪除交易前先檢查整檔是否仍合法（trades 是變更後的完整清單）
  function validate(trades, fundId) { return position(fundTrades(trades, fundId)); }

  /* ---------- 配息（由流水帳推導） ---------- */
  function dividendEntries(fund, entries) {
    return entries.filter(function (e) { return e.type === 'income' && e.category === CATEGORY && e.sub === fund.code; });
  }
  function dividendsOf(fund, entries) {
    var list = dividendEntries(fund, entries), sum = 0, last = null;
    list.forEach(function (e) { sum += e.amount; if (last === null || e.date > last) last = e.date; });
    return { total: r2(sum), count: list.length, lastDate: last };
  }

  /* ---------- 現金流與 XIRR ---------- */
  function marketValueOf(fund, pos) {
    if (pos.shares === 0) return 0;
    return typeof fund.price === 'number' ? r2(pos.shares * fund.price) : null;
  }

  // 回傳 [{date, amount, ref, label, type}]；type: buy / sell / dividend / value（今日持股市值）。只含日期 ≤ today 的
  function cashflows(funds, trades, entries, today) {
    var out = [];
    funds.forEach(function (f) {
      function push(date, amount, type) { out.push({ date: date, amount: r2(amount), ref: f.id, label: f.code, type: type }); }
      var mine = fundTrades(trades, f.id);
      mine.forEach(function (t) {
        if (t.date > today) return;
        push(t.date, t.type === 'buy' ? -t.amount : t.amount, t.type);
      });
      dividendEntries(f, entries).forEach(function (e) { if (e.date <= today) push(e.date, e.amount, 'dividend'); });
      var pos = position(mine);
      if (pos.ok && pos.shares > 0) {
        var mv = marketValueOf(f, pos);
        if (mv !== null) push(today, mv, 'value');
      }
    });
    return out;
  }

  /* ---------- 統計 ---------- */
  function weightedBuyYtm(mine) {
    var w = 0, s = 0;
    mine.forEach(function (t) { if (t.type === 'buy' && typeof t.ytm === 'number') { w += t.amount; s += t.amount * t.ytm; } });
    return w > 0 ? Math.round(s / w * 100) / 100 : null;
  }
  function weightedHoldYears(mine, today) {
    var w = 0, s = 0;
    mine.forEach(function (t) { if (t.type === 'buy' && t.date <= today) { w += t.amount; s += t.amount * years(t.date, today); } });
    return w > 0 ? s / w : null;
  }
  function durationInfo(fund, today) {
    if (!fund.duration) return null;
    var age = IC.daysBetween(fund.duration.date, today);
    return { value: fund.duration.value, date: fund.duration.date, ageDays: age, stale: age > STALE_DAYS };
  }

  // 單檔統計。沒有價格且仍有持股時，市值、損益、報酬率、XIRR 都是 null（畫面顯示「請先刷新價格」）
  function fundStats(fund, trades, entries, today) {
    var mine = fundTrades(trades, fund.id);
    var pos = position(mine);
    if (!pos.ok) return { error: pos.error };
    var mv = marketValueOf(fund, pos);
    var div = dividendsOf(fund, entries);
    var unrealized = mv === null ? null : r2(mv - pos.cost);
    var totalReturn = unrealized === null ? null : r2(unrealized + pos.realized + div.total);
    return {
      shares: pos.shares, avgCost: pos.avgCost, cost: pos.cost,
      boughtTotal: pos.boughtTotal, soldTotal: pos.soldTotal, realized: pos.realized,
      price: typeof fund.price === 'number' ? fund.price : null,
      marketValue: mv, unrealized: unrealized,
      dividends: div.total, dividendCount: div.count, lastDividend: div.lastDate,
      totalReturn: totalReturn,
      roi: totalReturn === null || pos.boughtTotal <= 0 ? null : totalReturn / pos.boughtTotal,
      xirr: mv === null || !mine.length ? null : IC.xirr(cashflows([fund], trades, entries, today)),
      avgBuyYtm: weightedBuyYtm(mine),
      holdYears: weightedHoldYears(mine, today),
      duration: durationInfo(fund, today),
      tradeCount: mine.length
    };
  }

  // 全部 ETF 合計。有持股卻沒價格的 ETF 數量放在 missingPrice，此時合計的市值／損益／XIRR 都是 null
  function summary(data, entries, today) {
    var s = {
      fundCount: data.funds.length, missingPrice: 0, errors: 0,
      cost: 0, boughtTotal: 0, marketValue: 0, unrealized: 0, realized: 0, dividends: 0,
      totalReturn: null, roi: null, xirr: null, avgBuyYtm: null, weightedDuration: null
    };
    var durW = 0, durS = 0, ytmW = 0, ytmS = 0, usable = [];
    data.funds.forEach(function (f) {
      var st = fundStats(f, data.trades, entries, today);
      if (st.error) { s.errors++; return; }
      s.cost += st.cost; s.boughtTotal += st.boughtTotal; s.realized += st.realized; s.dividends += st.dividends;
      if (st.marketValue === null) { s.missingPrice++; } else {
        s.marketValue += st.marketValue; s.unrealized += st.unrealized;
        if (st.duration && st.marketValue > 0) { durW += st.marketValue; durS += st.marketValue * st.duration.value; }
      }
      fundTrades(data.trades, f.id).forEach(function (t) { if (t.type === 'buy' && typeof t.ytm === 'number') { ytmW += t.amount; ytmS += t.amount * t.ytm; } });
      usable.push(f);
    });
    s.cost = r2(s.cost); s.boughtTotal = r2(s.boughtTotal); s.realized = r2(s.realized); s.dividends = r2(s.dividends);
    s.marketValue = r2(s.marketValue); s.unrealized = r2(s.unrealized);
    if (durW > 0) s.weightedDuration = Math.round(durS / durW * 100) / 100;
    if (ytmW > 0) s.avgBuyYtm = Math.round(ytmS / ytmW * 100) / 100;
    if (!s.missingPrice && !s.errors && s.fundCount) {
      s.totalReturn = r2(s.unrealized + s.realized + s.dividends);
      s.roi = s.boughtTotal > 0 ? s.totalReturn / s.boughtTotal : null;
      s.xirr = IC.xirr(cashflows(usable, data.trades, entries, today));
    }
    return s;
  }

  /* ---------- 價格（FinMind） ---------- */
  function finMindUrl(code, today) {
    return 'https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=' + encodeURIComponent(code) +
      '&start_date=' + addDays(today, -14);
  }
  // 取最近一個交易日的收盤價；格式不符、無資料回傳 null
  function parseFinMind(json) {
    if (!json || json.status !== 200 || !Array.isArray(json.data) || !json.data.length) return null;
    var best = null;
    json.data.forEach(function (r) {
      if (!r || typeof r.date !== 'string' || !IC.parseYmd(r.date)) return;
      var p = priceOf(r.close);
      if (p === null) return;
      if (!best || r.date > best.date) best = { price: p, date: r.date };
    });
    return best;
  }

  var api = {
    CATEGORY: CATEGORY, STALE_DAYS: STALE_DAYS, MAX_NAME: MAX_NAME,
    empty: empty, normalize: normalize, isEmpty: isEmpty, merge: merge,
    codeOf: codeOf, amountOf: amountOf, priceOf: priceOf, sharesOf: sharesOf, ytmOf: ytmOf, durationOf: durationOf, urlOf: urlOf,
    fundById: fundById, fundTrades: fundTrades, sortTrades: sortTrades,
    position: position, validate: validate,
    dividendEntries: dividendEntries, dividendsOf: dividendsOf,
    cashflows: cashflows, fundStats: fundStats, summary: summary, durationInfo: durationInfo,
    finMindUrl: finMindUrl, parseFinMind: parseFinMind, addDays: addDays
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BondCore = api;
})(typeof window !== 'undefined' ? window : this);
