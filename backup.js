/* 備份模組：用 File System Access API 寫入使用者選定的固定 JSON 檔（Android Chrome）。
 * 不支援時退回手動匯出下載 / 檔案選擇匯入。 */
var Backup = (function () {
  'use strict';

  var LAST_KEY = 'bookkeeper.lastBackup';
  var FILE_TYPES = [{ description: 'JSON 備份檔', accept: { 'application/json': ['.json'] } }];
  var handle = null;
  var getData = null;
  var timer = null;
  var perm = 'unknown';
  var asked = false; // 本次開啟是否已自動詢問過授權
  var lastError = '';
  var listener = function () {};

  function supported() {
    return 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;
  }

  async function init(dataFn, onChange) {
    getData = dataFn;
    if (onChange) listener = onChange;
    handle = (await Store.kvGet('backupHandle')) || null;
    if (handle) {
      try { perm = await handle.queryPermission({ mode: 'readwrite' }); } catch (e) { perm = 'prompt'; }
    }
  }

  function payload() {
    return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries: getData() }, null, 1);
  }

  function lastTime() {
    var n = Number(localStorage.getItem(LAST_KEY));
    return n > 0 ? n : 0;
  }

  function markDone() {
    try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch (e) { /* ignore */ }
  }

  function status() {
    return {
      supported: supported(),
      linked: !!handle,
      name: handle ? handle.name : '',
      needsPermission: !!handle && perm !== 'granted',
      last: lastTime(),
      error: lastError
    };
  }

  // 已連結檔案、但本次開啟尚未授權，且還沒自動詢問過
  function shouldAsk() {
    return !!handle && perm !== 'granted' && !asked;
  }

  // 必須在使用者點擊的事件處理中呼叫
  async function requestPermission() {
    if (!handle) return false;
    asked = true;
    try {
      perm = await handle.requestPermission({ mode: 'readwrite' });
    } catch (e) {
      perm = 'prompt';
    }
    listener();
    return perm === 'granted';
  }

  async function write() {
    if (!handle) return false;
    try {
      perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return false;
      var w = await handle.createWritable();
      await w.write(payload());
      await w.close();
      lastError = '';
      markDone();
      return true;
    } catch (e) {
      lastError = e && e.message ? e.message : String(e);
      return false;
    } finally {
      listener();
    }
  }

  // 資料變動後呼叫：防抖後寫入
  function schedule() {
    if (!handle) return;
    clearTimeout(timer);
    timer = setTimeout(write, 800);
  }

  async function linkFile() {
    var h = await window.showSaveFilePicker({ suggestedName: 'bookkeeper-backup.json', types: FILE_TYPES });
    handle = h;
    perm = 'granted';
    asked = false;
    await Store.kvSet('backupHandle', h);
    return write();
  }

  // 讀取備份檔文字。必須在使用者點擊中呼叫。回傳 null 表示需改用 <input type=file>
  async function readText() {
    if (handle) {
      try {
        if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
          if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
            var err = new Error('未取得檔案授權');
            err.name = 'NotAllowedError';
            throw err;
          }
        }
        perm = 'granted';
        listener();
        return await (await handle.getFile()).text();
      } catch (e) {
        if (e.name === 'NotAllowedError') throw e;
        // 檔案被刪除或移動：改讓使用者重新選
      }
    }
    if (supported()) {
      var picked = await window.showOpenFilePicker({ types: FILE_TYPES });
      handle = picked[0];
      perm = 'prompt';
      await Store.kvSet('backupHandle', handle);
      asked = false;
      return (await handle.getFile()).text();
    }
    return null;
  }

  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function parse(text) {
    var obj = JSON.parse(text);
    var list = Array.isArray(obj) ? obj : obj && obj.entries;
    if (!Array.isArray(list)) throw new Error('格式不正確');
    return list.filter(function (e) {
      return e && typeof e.id === 'string' && DATE_RE.test(e.date) &&
        (e.type === 'expense' || e.type === 'income') &&
        typeof e.category === 'string' && isFinite(e.amount) && e.amount > 0;
    }).map(function (e) {
      return {
        id: e.id, date: e.date, type: e.type, category: e.category,
        amount: Math.round(e.amount * 100) / 100,
        note: typeof e.note === 'string' ? e.note.slice(0, 60) : '',
        createdAt: Number(e.createdAt) || 0
      };
    });
  }

  function exportDownload() {
    var blob = new Blob([payload()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bookkeeper-backup.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    markDone();
    listener();
  }

  return {
    init: init, supported: supported, status: status, shouldAsk: shouldAsk,
    requestPermission: requestPermission, write: write, schedule: schedule,
    linkFile: linkFile, readText: readText, parse: parse, exportDownload: exportDownload
  };
})();
