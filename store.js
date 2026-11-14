/* 資料層：主要存 IndexedDB，同步寫一份 localStorage 當保險。全部只存在本機。 */
var Store = (function () {
  'use strict';

  var DB_NAME = 'bookkeeper';
  var KV = 'kv';
  var LS_KEY = 'bookkeeper.v1';
  var db = null;
  var entries = []; // 永遠是同一個陣列物件，原地修改

  function openDb() {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(KV); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = req.onblocked = function () { resolve(null); };
      } catch (e) {
        resolve(null);
      }
    });
  }

  function kvGet(key) {
    return new Promise(function (resolve) {
      if (!db) return resolve(undefined);
      try {
        var r = db.transaction(KV).objectStore(KV).get(key);
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { resolve(undefined); };
      } catch (e) {
        resolve(undefined);
      }
    });
  }

  function kvSet(key, value) {
    return new Promise(function (resolve) {
      if (!db) return resolve(false);
      try {
        var tx = db.transaction(KV, 'readwrite');
        tx.objectStore(KV).put(value, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = tx.onabort = function () { resolve(false); };
      } catch (e) {
        resolve(false);
      }
    });
  }

  function lsRead() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      var arr = raw ? JSON.parse(raw) : null;
      return Array.isArray(arr) ? arr : null;
    } catch (e) {
      return null;
    }
  }

  function lsWrite() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(entries)); } catch (e) { /* 無痕模式等 */ }
  }

  async function init() {
    db = await openDb();
    try {
      // 請瀏覽器把資料標為「持久」，降低空間不足時被自動清除的機率
      if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
    } catch (e) { /* ignore */ }

    var fromDb = await kvGet('entries');
    var loaded = Array.isArray(fromDb) ? fromDb : lsRead() || [];
    entries.length = 0;
    Array.prototype.push.apply(entries, loaded);
    if (!Array.isArray(fromDb) && loaded.length) await kvSet('entries', entries);
  }

  async function save() {
    lsWrite();
    return kvSet('entries', entries);
  }

  return { init: init, save: save, entries: entries, kvGet: kvGet, kvSet: kvSet };
})();
