/* 投資理財的純運算（不碰 DOM，可用 node 測試）。目前只有定存（定期儲蓄存款・整存整付・按月複利）。
 * 資料：{ version:1, deposits:[{ id, name?, label, principal, startDate:'YYYY-MM-DD', months, rate(年利率%), done, createdAt }] }
 *
 * 與流水帳的連動靠「推導」：已領利息 = 流水帳中 收入 › 定存利息 › label 的帳目加總，不另存同步欄位。
 * 現金流（cashflows）每筆帶 ref = 定存 id，供之後的整合總報酬率／XIRR 過濾使用。 */
(function (root) {
  'use strict';

  var CATEGORY = '定存利息';   // 連動用的收入類別名稱
  var MAX_LABEL = 20;          // 與 categories.js 的 MAX_SUB 一致
  var MAX_AMOUNT = 1e12;
  var MAX_MONTHS = 600;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function amountOf(v) {
    var n = Number(v);
    if (v === null || v === '' || !isFinite(n) || n <= 0 || n > MAX_AMOUNT) return null;
    return r2(n);
  }
  function rateOf(v) {
    var n = Number(v);
    if (v === null || v === '' || !isFinite(n) || n <= 0 || n > 100) return null;
    return Math.round(n * 10000) / 10000;
  }
  function monthsOf(v) {
    var n = Number(v);
    if (v === null || v === '' || !isFinite(n) || n < 1 || n > MAX_MONTHS || Math.floor(n) !== n) return null;
    return n;
  }

  /* ---------- 日期（一律本地字串，不用 toISOString） ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function parseYmd(s) {
    if (typeof s !== 'string' || !DATE_RE.test(s)) return null;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    var t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
    return [y, m, d];
  }
  function dayNum(s) { var p = parseYmd(s); return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000); }
  function daysBetween(a, b) { return dayNum(b) - dayNum(a); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m 為 1~12
  // 加 n 個月；日期超過該月天數就收斂到月底（1/31 + 1 月 = 2/28）
  function addMonths(s, n) {
    var p = parseYmd(s);
    var idx = p[0] * 12 + (p[1] - 1) + n;
    var y = Math.floor(idx / 12), m = idx % 12 + 1;
    return y + '-' + pad(m) + '-' + pad(Math.min(p[2], daysInMonth(y, m)));
  }
  function maturityDate(start, months) { return addMonths(start, months); }

  /* ---------- 利息（年利率 ÷ 12 按月複利） ---------- */
  function monthly(d) { return d.rate / 100 / 12; }
  function expectedInterest(d) {
    return r2(d.principal * (Math.pow(1 + monthly(d), d.months) - 1));
  }
  // 到 today 為止的應計利息：已滿的整月逐月複利，當月未滿部分按日單利；上限為到期全額
  function accruedInterest(d, today) {
    if (daysBetween(d.startDate, today) <= 0) return 0;
    var k = 0;
    while (k < d.months && daysBetween(addMonths(d.startDate, k + 1), today) >= 0) k++;
    if (k >= d.months) return expectedInterest(d);
    var balance = d.principal * Math.pow(1 + monthly(d), k);
    var from = addMonths(d.startDate, k), to = addMonths(d.startDate, k + 1);
    var frac = daysBetween(from, today) / daysBetween(from, to);
    return r2(balance * (1 + monthly(d) * frac) - d.principal);
  }

  /* ---------- 與流水帳的連動 ---------- */
  function payoutEntries(label, entries) {
    return entries.filter(function (e) {
      return e.type === 'income' && e.category === CATEGORY && e.sub === label;
    });
  }
  // 已領利息：{ interest, count, lastDate }
  function payoutOf(d, entries) {
    var list = payoutEntries(d.label, entries), sum = 0, last = null;
    list.forEach(function (e) { sum += e.amount; if (last === null || e.date > last) last = e.date; });
    return { interest: r2(sum), count: list.length, lastDate: last };
  }
  // 流水帳「定存利息」底下已被帳目用掉的 sub（新定存的 label 必須避開，免得誤認舊帳目）
  function usedSubs(entries) {
    var out = [];
    entries.forEach(function (e) {
      if (e.type === 'income' && e.category === CATEGORY && e.sub && out.indexOf(e.sub) < 0) out.push(e.sub);
    });
    return out;
  }

  function shortAmount(p) {
    if (p >= 10000) return String(Math.round(p / 100) / 100) + '萬';
    return String(p);
  }
  // 產生唯一 label：taken 為所有已用名稱（含已完結定存與流水帳殘留 sub）
  function makeLabel(name, principal, startDate, taken) {
    var base = String(name || '').trim() || (shortAmount(principal) + '・' + startDate);
    base = base.slice(0, MAX_LABEL);
    if (taken.indexOf(base) < 0) return base;
    for (var i = 2; i < 10000; i++) {
      var suffix = ' #' + i;
      var cand = base.slice(0, MAX_LABEL - suffix.length) + suffix;
      if (taken.indexOf(cand) < 0) return cand;
    }
    return base;
  }
  function takenLabels(data, entries, exceptId) {
    var out = [];
    data.deposits.forEach(function (d) { if (d.id !== exceptId) out.push(d.label); });
    usedSubs(entries || []).forEach(function (s) {
      // 自己現有的 label 不算「被別人佔用」
      var own = exceptId && data.deposits.some(function (d) { return d.id === exceptId && d.label === s; });
      if (!own && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }

  /* ---------- 資料 ---------- */
  function empty() { return { version: 1, deposits: [] }; }

  // 清理壞資料（舊備份、手改檔案）
  function normalize(raw) {
    var out = empty();
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.deposits)) return out;
    var ids = {}, labels = [];
    raw.deposits.forEach(function (d) {
      if (!d || typeof d !== 'object') return;
      var id = typeof d.id === 'string' ? d.id : '';
      var principal = amountOf(d.principal), months = monthsOf(d.months), rate = rateOf(d.rate);
      if (!id || ids[id] || principal === null || months === null || rate === null || !parseYmd(d.startDate)) return;
      ids[id] = true;
      var name = typeof d.name === 'string' ? d.name.trim().slice(0, MAX_LABEL) : '';
      var label = typeof d.label === 'string' ? d.label.trim().slice(0, MAX_LABEL) : '';
      if (!label || labels.indexOf(label) >= 0) label = makeLabel(name, principal, d.startDate, labels);
      labels.push(label);
      var item = {
        id: id, label: label, principal: principal, startDate: d.startDate, months: months, rate: rate,
        done: d.done === true, createdAt: Number(d.createdAt) || 0
      };
      if (name) item.name = name;
      out.deposits.push(item);
    });
    return out;
  }

  function isEmpty(data) { return !data.deposits.length; }

  // 還原備份：只補本機沒有的定存（以 id 判斷），本機優先。回傳是否有變動
  function merge(local, incoming) {
    var changed = false;
    var ids = {};
    local.deposits.forEach(function (d) { ids[d.id] = true; });
    incoming.deposits.forEach(function (d) {
      if (ids[d.id]) return;
      var item = Object.assign({}, d);
      var taken = local.deposits.map(function (x) { return x.label; });
      if (taken.indexOf(item.label) >= 0) item.label = makeLabel(item.name, item.principal, item.startDate, taken);
      local.deposits.push(item);
      changed = true;
    });
    return changed;
  }

  /* ---------- 現金流與 XIRR ---------- */
  // 回傳 [{date, amount, ref, label, type}]；type: invest / interest / maturity / value（未完結的今日現值）
  function cashflows(deposits, entries, today) {
    var out = [];
    deposits.forEach(function (d) {
      if (daysBetween(d.startDate, today) < 0) return; // 還沒開始的定存不計
      var paid = payoutOf(d, entries);
      function push(date, amount, type) { out.push({ date: date, amount: r2(amount), ref: d.id, label: d.label, type: type }); }
      push(d.startDate, -d.principal, 'invest');
      payoutEntries(d.label, entries).forEach(function (e) { push(e.date, e.amount, 'interest'); });
      if (d.done) {
        push(maturityDate(d.startDate, d.months), d.principal, 'maturity');
      } else {
        push(today, d.principal + Math.max(accruedInterest(d, today) - paid.interest, 0), 'value');
      }
    });
    return out;
  }

  // XIRR：以 365 天為一年；全同號、少於 2 筆、跨度不到 1 天回傳 null
  function xirr(flows) {
    if (!flows || flows.length < 2) return null;
    var pos = false, neg = false, min = Infinity, max = -Infinity;
    flows.forEach(function (f) {
      if (f.amount > 0) pos = true; else if (f.amount < 0) neg = true;
      var n = dayNum(f.date);
      if (n < min) min = n;
      if (n > max) max = n;
    });
    if (!pos || !neg || max - min < 1) return null;
    var items = flows.map(function (f) { return { a: f.amount, t: (dayNum(f.date) - min) / 365 }; });
    function f(r) {
      var s = 0;
      for (var i = 0; i < items.length; i++) s += items[i].a * Math.pow(1 + r, -items[i].t);
      return s;
    }
    var lo = -0.999999, hi = 1, flo = f(lo), fhi = f(hi);
    while (flo * fhi > 0 && hi < 1e9) { hi *= 2; fhi = f(hi); }
    if (flo * fhi > 0) return null;
    for (var i = 0; i < 300; i++) {
      var mid = (lo + hi) / 2, fm = f(mid);
      if (fm === 0) return mid;
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
      if (hi - lo < 1e-12) break;
    }
    var r = (lo + hi) / 2;
    return isFinite(r) ? r : null;
  }

  /* ---------- 統計 ---------- */
  // 單筆：status = done / matured（已到期未完結）/ active
  function depositStats(d, entries, today) {
    var maturity = maturityDate(d.startDate, d.months);
    var paid = payoutOf(d, entries);
    var status = d.done ? 'done' : (daysBetween(maturity, today) >= 0 ? 'matured' : 'active');
    var out = {
      maturity: maturity, status: status, paid: paid,
      expected: expectedInterest(d), accrued: accruedInterest(d, today),
      roi: null, annual: null
    };
    if (d.done) {
      out.roi = paid.interest / d.principal;
      out.annual = xirr(cashflows([d], entries, today));
    }
    return out;
  }

  // 整體：只有「已完結」的定存計入報酬率與年化；進行中者另列本金與預期利息
  function summary(deposits, entries, today) {
    var s = {
      count: deposits.length, doneCount: 0, activeCount: 0,
      activePrincipal: 0, activeExpected: 0, paidAll: 0,
      donePrincipal: 0, doneInterest: 0, roi: null, annual: null
    };
    var done = [];
    deposits.forEach(function (d) {
      var paid = payoutOf(d, entries);
      s.paidAll += paid.interest;
      if (d.done) {
        s.doneCount++;
        s.donePrincipal += d.principal;
        s.doneInterest += paid.interest;
        done.push(d);
      } else {
        s.activeCount++;
        s.activePrincipal += d.principal;
        s.activeExpected += expectedInterest(d);
      }
    });
    s.activePrincipal = r2(s.activePrincipal);
    s.activeExpected = r2(s.activeExpected);
    s.paidAll = r2(s.paidAll);
    s.donePrincipal = r2(s.donePrincipal);
    s.doneInterest = r2(s.doneInterest);
    if (s.donePrincipal > 0) {
      s.roi = s.doneInterest / s.donePrincipal;
      s.annual = xirr(cashflows(done, entries, today));
    }
    return s;
  }

  var api = {
    CATEGORY: CATEGORY, MAX_LABEL: MAX_LABEL,
    empty: empty, normalize: normalize, isEmpty: isEmpty, merge: merge,
    amountOf: amountOf, rateOf: rateOf, monthsOf: monthsOf, parseYmd: parseYmd,
    addMonths: addMonths, maturityDate: maturityDate, daysBetween: daysBetween,
    expectedInterest: expectedInterest, accruedInterest: accruedInterest,
    payoutEntries: payoutEntries, payoutOf: payoutOf, usedSubs: usedSubs,
    makeLabel: makeLabel, takenLabels: takenLabels,
    cashflows: cashflows, xirr: xirr, depositStats: depositStats, summary: summary
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InvestCore = api;
})(typeof window !== 'undefined' ? window : this);
