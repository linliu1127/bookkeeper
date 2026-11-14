/* 類別資料規則（不碰 DOM，可用 node 測試）。
 * Data = { expense: Cat[], income: Cat[] }，Cat = { name, icon, subs: string[] } */
(function (root) {
  'use strict';

  var DEFAULT_ICON = '🏷️';
  var MAX_CAT = 12;
  var MAX_SUB = 20;
  var TYPES = ['expense', 'income'];

  var DEFAULT_LIST = {
    expense: [['餐費', '🍜'], ['購物', '🛍️'], ['交通', '🚌'], ['日用品', '🧴'], ['娛樂', '🎮'], ['醫療', '💊'], ['居住', '🏠'],
      ['禮物', '🎁'], ['稅', '🧾'], ['孝養金', '🧧'], ['旅遊', '✈️'], ['數位', '📱'], ['借錢', '🤝'], ['股票', '💹'],
      ['債券', '📜'], ['外幣', '💱'], ['保險', '🛡️'], ['其他', '📦']],
    income: [['薪水', '💼'], ['股息', '📈'], ['獎金', '🎁'], ['股票', '💹'], ['債券', '📜'], ['外幣', '💱'], ['定存利息', '🏦'], ['其他', '💰']]
  };

  function defaults() {
    var d = {};
    TYPES.forEach(function (t) {
      d[t] = DEFAULT_LIST[t].map(function (c) { return { name: c[0], icon: c[1], subs: [] }; });
    });
    return d;
  }

  function cleanSubs(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (s) {
      if (typeof s !== 'string') return;
      s = s.trim();
      if (s && s.length <= MAX_SUB && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }

  // emptyMissing：缺項時回傳空清單（還原備份用，避免把使用者刪掉的預設類別補回來）；預設則補內建類別（啟動用）
  function normalize(raw, emptyMissing) {
    var def = emptyMissing ? { expense: [], income: [] } : defaults();
    var out = {};
    TYPES.forEach(function (t) {
      var src = raw && typeof raw === 'object' ? raw[t] : null;
      if (!Array.isArray(src)) { out[t] = def[t]; return; }
      var seen = Object.create(null); // 不用 {}：'constructor' 等名稱會被誤判為重複
      out[t] = [];
      src.forEach(function (c) {
        if (!c || typeof c.name !== 'string') return;
        var name = c.name.trim();
        if (!name || name.length > MAX_CAT || seen[name]) return;
        seen[name] = true;
        var icon = typeof c.icon === 'string' && c.icon.trim() ? c.icon.trim() : DEFAULT_ICON;
        out[t].push({ name: name, icon: icon, subs: cleanSubs(c.subs) });
      });
    });
    return out;
  }

  function find(data, type, name) {
    var list = data[type] || [];
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
  }

  function checkName(raw, max) {
    var name = String(raw == null ? '' : raw).trim();
    if (!name) return { error: '名稱不可空白' };
    if (name.length > max) return { error: '名稱太長（最多 ' + max + ' 字）' };
    return { name: name };
  }
  function fail(error) { return { ok: false, error: error }; }

  function add(data, type, name, icon) {
    var c = checkName(name, MAX_CAT);
    if (c.error) return fail(c.error);
    if (find(data, type, c.name)) return fail('名稱已存在');
    data[type].push({ name: c.name, icon: String(icon || '').trim() || DEFAULT_ICON, subs: [] });
    return { ok: true };
  }

  function remove(data, type, name) {
    var list = data[type] || [];
    for (var i = 0; i < list.length; i++) if (list[i].name === name) { list.splice(i, 1); return true; }
    return false;
  }

  function rename(data, entries, type, oldName, newName) {
    var cat = find(data, type, oldName);
    if (!cat) return fail('找不到類別');
    var c = checkName(newName, MAX_CAT);
    if (c.error) return fail(c.error);
    if (c.name === oldName) return { ok: true, changed: 0 };
    if (find(data, type, c.name)) return fail('名稱已存在');
    cat.name = c.name;
    var changed = 0;
    entries.forEach(function (e) {
      if (e.type === type && e.category === oldName) { e.category = c.name; changed++; }
    });
    return { ok: true, changed: changed };
  }

  function addSub(data, type, catName, name) {
    var cat = find(data, type, catName);
    if (!cat) return fail('找不到類別');
    var c = checkName(name, MAX_SUB);
    if (c.error) return fail(c.error);
    if (cat.subs.indexOf(c.name) >= 0) return fail('名稱已存在');
    cat.subs.push(c.name);
    return { ok: true };
  }

  function removeSub(data, type, catName, sub) {
    var cat = find(data, type, catName);
    if (!cat) return false;
    var i = cat.subs.indexOf(sub);
    if (i < 0) return false;
    cat.subs.splice(i, 1);
    return true;
  }

  function renameSub(data, entries, type, catName, oldSub, newSub) {
    var cat = find(data, type, catName);
    if (!cat || cat.subs.indexOf(oldSub) < 0) return fail('找不到類別');
    var c = checkName(newSub, MAX_SUB);
    if (c.error) return fail(c.error);
    if (c.name === oldSub) return { ok: true, changed: 0 };
    if (cat.subs.indexOf(c.name) >= 0) return fail('名稱已存在');
    cat.subs[cat.subs.indexOf(oldSub)] = c.name;
    var changed = 0;
    entries.forEach(function (e) {
      if (e.type === type && e.category === catName && e.sub === oldSub) { e.sub = c.name; changed++; }
    });
    return { ok: true, changed: changed };
  }

  function merge(data, incoming) {
    TYPES.forEach(function (t) {
      (incoming[t] || []).forEach(function (ic) {
        var cat = find(data, t, ic.name);
        if (!cat) { cat = { name: ic.name, icon: ic.icon, subs: [] }; data[t].push(cat); }
        (ic.subs || []).forEach(function (s) { if (cat.subs.indexOf(s) < 0) cat.subs.push(s); });
      });
    });
  }

  function ensureUsed(data, entries) {
    entries.forEach(function (e) {
      if (TYPES.indexOf(e.type) < 0 || !e.category) return;
      var cat = find(data, e.type, e.category);
      if (!cat) { cat = { name: e.category, icon: DEFAULT_ICON, subs: [] }; data[e.type].push(cat); }
      if (e.sub && cat.subs.indexOf(e.sub) < 0) cat.subs.push(e.sub);
    });
  }

  function withUsed(data, entries) {
    var copy = {};
    TYPES.forEach(function (t) {
      copy[t] = data[t].map(function (c) { return { name: c.name, icon: c.icon, subs: c.subs.slice() }; });
    });
    ensureUsed(copy, entries);
    return copy;
  }

  var api = {
    defaults: defaults, normalize: normalize, add: add, remove: remove, rename: rename,
    addSub: addSub, removeSub: removeSub, renameSub: renameSub,
    merge: merge, ensureUsed: ensureUsed, withUsed: withUsed
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Categories = api;
})(typeof window !== 'undefined' ? window : this);
