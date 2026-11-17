/* 預算的純運算（不碰 DOM，可用 node 測試）。
 * 資料：{ year: 數字|null, month: 數字|null, cats: { 類別名稱: 月預算 } }，只針對支出。 */
(function (root) {
  'use strict';

  var MAX_AMOUNT = 1e12;

  function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  function amountOf(v) {
    var n = Number(v);
    if (v === null || v === '' || !isFinite(n) || n <= 0 || n > MAX_AMOUNT) return null;
    return r2(n);
  }

  function empty() { return { year: null, month: null, cats: {} }; }

  // 清理壞資料（舊備份、手改檔案）；非正數／非數字的預算一律視為未設定
  function normalize(raw) {
    var out = empty();
    if (!raw || typeof raw !== 'object') return out;
    out.year = amountOf(raw.year);
    out.month = amountOf(raw.month);
    if (raw.cats && typeof raw.cats === 'object') {
      Object.keys(raw.cats).forEach(function (k) {
        var n = amountOf(raw.cats[k]);
        if (k && n !== null) out.cats[k] = n;
      });
    }
    return out;
  }

  function isEmpty(b) {
    return b.year === null && b.month === null && !Object.keys(b.cats).length;
  }

  // 月份 ym = 'YYYY-MM'；category 省略則為全部支出；excludeId 用於編輯時扣掉自己那筆
  function spent(entries, opts) {
    var total = 0;
    entries.forEach(function (e) {
      if (e.type !== 'expense' || e.date.indexOf(opts.ym) !== 0) return;
      if (opts.category && e.category !== opts.category) return;
      if (opts.excludeId && e.id === opts.excludeId) return;
      total += e.amount;
    });
    return r2(total);
  }

  function spentYear(entries, year, excludeId) {
    var pre = year + '-', total = 0;
    entries.forEach(function (e) {
      if (e.type !== 'expense' || e.date.indexOf(pre) !== 0) return;
      if (excludeId && e.id === excludeId) return;
      total += e.amount;
    });
    return r2(total);
  }

  // 類別改名時讓預算跟著走；新名稱已有預算則保留新名稱既有的
  function renameCat(b, from, to) {
    if (from === to || !Object.prototype.hasOwnProperty.call(b.cats, from)) return false;
    if (!Object.prototype.hasOwnProperty.call(b.cats, to)) b.cats[to] = b.cats[from];
    delete b.cats[from];
    return true;
  }

  // 還原備份：只補本機沒有的欄位，不覆蓋本機設定。回傳是否有變動
  function merge(local, incoming) {
    var changed = false;
    if (local.year === null && incoming.year !== null) { local.year = incoming.year; changed = true; }
    if (local.month === null && incoming.month !== null) { local.month = incoming.month; changed = true; }
    Object.keys(incoming.cats).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(local.cats, k)) { local.cats[k] = incoming.cats[k]; changed = true; }
    });
    return changed;
  }

  // 進度：回傳 {pct 0~100（封頂）, over 是否超支, left 剩餘（可為負）}
  function progress(spentAmt, budget) {
    return {
      pct: budget > 0 ? Math.min(100, spentAmt / budget * 100) : 0,
      over: spentAmt > budget,
      left: r2(budget - spentAmt)
    };
  }

  var api = {
    empty: empty, normalize: normalize, isEmpty: isEmpty, amountOf: amountOf,
    spent: spent, spentYear: spentYear, renameCat: renameCat, merge: merge, progress: progress
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BudgetCore = api;
})(typeof window !== 'undefined' ? window : this);
